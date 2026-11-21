#!/usr/bin/env python3
"""Hacker notes: a small JSON API over SQLite, run by term-llm as a widget.

term-llm starts this process on demand, proxies <base>/widgets/hacker-notes/
to it behind the Web UI's own authentication, and stops it when idle. Hacker's
notes panel (notes.js) is the client. Standard library only.

Notes live in one SQLite database per machine and user, by default
$XDG_DATA_HOME/term-llm/hacker/notes.db (~/.local/share/...), outside the
widget folder so reinstalling never touches them. HACKER_NOTES_DB overrides
the path.
"""

import argparse
import json
import os
import re
import secrets
import signal
import socketserver
import sqlite3
import sys
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlsplit

MAX_BODY_CHARS = 1_000_000  # one note
MAX_REQUEST_BYTES = 8 * 1024 * 1024  # a full note as JSON, escapes and all
LIST_LIMIT = 500
TRASH_DAYS = 30
ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,32}$")
NOTE_PATH = re.compile(r"^/api/notes/([^/]+)(/restore)?$")
# A note saved from a chat keeps a link back to it (Hacker's clip.js).
MAX_SOURCE_URL = 2048
MAX_SOURCE_TITLE = 200
SCHEMA_VERSION = 2

SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at INTEGER,
  source_url TEXT,
  source_title TEXT
);
CREATE INDEX IF NOT EXISTS notes_live ON notes (deleted_at, pinned, updated_at);
"""

# Opening the widget from term-llm's Widgets list leads back to the chat,
# where Hacker opens its notes panel (#notes).
ROOT_PAGE = b"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0; url=../../#notes">
<title>Notes</title></head>
<body><p>Notes open in the chat's sidebar. <a href="../../#notes">Open notes</a></p></body></html>
"""


def default_db_path():
    explicit = os.environ.get("HACKER_NOTES_DB")
    if explicit:
        return explicit
    data = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(data, "term-llm", "hacker", "notes.db")


def now_ms():
    return int(time.time() * 1000)


# --- titles and previews -------------------------------------------------
# Kept in step with noteTitle/noteSnippet in markdown.js; both suites test
# tools/ci/fixtures/note-text.json.

_MARKER = re.compile(r"^\s*(?:#{1,6}\s+|>+\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+(?:\[[ xX]\]\s+)?)")
_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_EMPHASIS = re.compile(r"[*`~]+")
# Underscores only where they open or close emphasis, not inside snake_case.
_UNDERSCORE = re.compile(r"(^|\W)_+|_+(?=\W|$)", re.ASCII)
_FENCE = re.compile(r"^\s*(```|~~~)")


def plain_line(line):
    line = _MARKER.sub("", line, count=1)
    line = _LINK.sub(r"\1", line)
    line = _EMPHASIS.sub("", line)
    line = _UNDERSCORE.sub(r"\1", line)
    return " ".join(line.split())


def derive(body):
    """The first line with text is the title; the next one is the preview."""
    title = ""
    for line in body.replace("\r\n", "\n").split("\n"):
        if _FENCE.match(line):
            continue
        text = plain_line(line)
        if not text:
            continue
        if not title:
            title = text[:120]
        else:
            return title, text[:160]
    return title, ""


# --- storage ---------------------------------------------------------------

class Store:
    def __init__(self, path):
        self.path = path
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, mode=0o700, exist_ok=True)
        with self.session() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)
            # Databases from before notes had sources (version 1) gain the
            # columns. Two agents starting at once may race to add them.
            have = {row["name"] for row in db.execute("PRAGMA table_info(notes)")}
            for column in ("source_url", "source_title"):
                if column not in have:
                    try:
                        db.execute(f"ALTER TABLE notes ADD COLUMN {column} TEXT")
                    except sqlite3.OperationalError as error:
                        if "duplicate column" not in str(error):
                            raise
            db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
            # Deleted notes can be restored for a while, then they go.
            db.execute(
                "DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?",
                (now_ms() - TRASH_DAYS * 86_400_000,),
            )
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass

    @contextmanager
    def session(self):
        """One connection per request: commits on success, always closes."""
        db = sqlite3.connect(self.path, timeout=5)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA busy_timeout=5000")
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def note(row, full=True):
        out = {
            "id": row["id"],
            "title": row["title"],
            "snippet": row["snippet"],
            "pinned": bool(row["pinned"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "version": row["version"],
            "source": {"url": row["source_url"], "title": row["source_title"] or ""} if row["source_url"] else None,
        }
        if full:
            out["body"] = row["body"]
        return out

    def list(self, query="", limit=LIST_LIMIT):
        where = ["deleted_at IS NULL"]
        args = []
        terms = query.split()[:8]
        for term in terms:
            like = "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            where.append("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR source_title LIKE ? ESCAPE '\\')")
            args += [like, like, like]
        order = "pinned DESC, updated_at DESC"
        if terms:
            # Notes whose title matches the first word come first.
            first = "%" + terms[0].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            order = "(title LIKE ? ESCAPE '\\') DESC, " + order
            args.append(first)
        sql = (
            "SELECT id, title, snippet, pinned, created_at, updated_at, version, source_url, source_title FROM notes WHERE "
            + " AND ".join(where) + " ORDER BY " + order + " LIMIT ?"
        )
        args.append(limit)
        with self.session() as db:
            rows = db.execute(sql, args).fetchall()
            total = db.execute("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL").fetchone()[0]
        return [self.note(row, full=False) for row in rows], total

    def get(self, note_id, include_deleted=False):
        with self.session() as db:
            row = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
        if row is None or (row["deleted_at"] is not None and not include_deleted):
            return None
        return row

    def create(self, body, pinned, source=None):
        title, snippet = derive(body)
        stamp = now_ms()
        source_url, source_title = source or (None, None)
        with self.session() as db:
            for _ in range(5):
                note_id = secrets.token_urlsafe(9)
                try:
                    db.execute(
                        "INSERT INTO notes (id, title, snippet, body, pinned, created_at, updated_at, source_url, source_title) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (note_id, title, snippet, body, int(pinned), stamp, stamp, source_url, source_title),
                    )
                    break
                except sqlite3.IntegrityError:
                    continue
            else:
                raise RuntimeError("could not allocate a note id")
        return self.get(note_id)

    def update(self, note_id, version, body=None, pinned=None):
        """Returns (row, conflict). Body edits move a note up; pinning does not."""
        sets, args = [], []
        if body is not None:
            title, snippet = derive(body)
            sets += ["body = ?", "title = ?", "snippet = ?", "updated_at = ?"]
            args += [body, title, snippet, now_ms()]
        if pinned is not None:
            sets.append("pinned = ?")
            args.append(int(pinned))
        sets.append("version = version + 1")
        with self.session() as db:
            changed = db.execute(
                "UPDATE notes SET " + ", ".join(sets) + " WHERE id = ? AND deleted_at IS NULL AND version = ?",
                args + [note_id, version],
            ).rowcount
        current = self.get(note_id)
        return current, bool(current) and not changed

    def delete(self, note_id):
        with self.session() as db:
            return db.execute(
                "UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", (now_ms(), note_id)
            ).rowcount > 0

    def restore(self, note_id):
        with self.session() as db:
            db.execute(
                "UPDATE notes SET deleted_at = NULL, version = version + 1 WHERE id = ? AND deleted_at IS NOT NULL",
                (note_id,),
            )
        return self.get(note_id)


# --- HTTP ------------------------------------------------------------------

class HTTPError(Exception):
    def __init__(self, status, message, extra=None):
        super().__init__(message)
        self.status = status
        self.payload = {"error": message, **(extra or {})}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "hacker-notes"
    sys_version = ""
    store = None  # set by serve()

    def log_message(self, format, *args):  # noqa: A002 - BaseHTTPRequestHandler's name
        pass  # Never log requests: paths and bodies can carry note text.

    def do_GET(self):
        self.dispatch("GET")

    def do_HEAD(self):
        self.dispatch("HEAD")

    def do_POST(self):
        self.dispatch("POST")

    def do_PATCH(self):
        self.dispatch("PATCH")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def do_PUT(self):
        self.dispatch("PUT")

    def dispatch(self, method):
        try:
            self.request_body = self.read_body()
            self.route(method, urlsplit(self.path))
        except HTTPError as error:
            self.send_json(error.status, error.payload)
        except Exception as error:  # A bug must not take the process down.
            print(f"hacker-notes: {type(error).__name__}: {error}", file=sys.stderr)
            self.send_json(500, {"error": "internal error"})

    def route(self, method, url):
        path = url.path
        if path == "/":
            if method not in ("GET", "HEAD"):
                raise HTTPError(405, "method not allowed")
            return self.send_bytes(200, ROOT_PAGE, "text/html; charset=utf-8", head=method == "HEAD")
        if path == "/api/notes":
            if method == "GET":
                params = parse_qs(url.query)
                query = params.get("q", [""])[0][:200]
                try:
                    limit = max(1, min(LIST_LIMIT, int(params.get("limit", [LIST_LIMIT])[0])))
                except ValueError:
                    raise HTTPError(400, "limit must be a number")
                notes, total = self.store.list(query, limit)
                return self.send_json(200, {"notes": notes, "total": total})
            if method == "POST":
                data = self.read_json()
                body = self.body_field(data, required=False) or ""
                pinned = self.pinned_field(data)
                source = self.source_field(data)
                return self.send_json(201, Store.note(self.store.create(body, bool(pinned), source)))
            raise HTTPError(405, "method not allowed")
        match = NOTE_PATH.match(path)
        if not match or not ID_RE.match(match.group(1)):
            raise HTTPError(404, "not found")
        note_id, restore = match.group(1), match.group(2)
        if restore:
            if method != "POST":
                raise HTTPError(405, "method not allowed")
            row = self.store.restore(note_id)
            if row is None:
                raise HTTPError(404, "note not found")
            return self.send_json(200, Store.note(row))
        if method == "GET":
            row = self.store.get(note_id)
            if row is None:
                raise HTTPError(404, "note not found")
            return self.send_json(200, Store.note(row))
        if method == "PATCH":
            data = self.read_json()
            version = data.get("version")
            if not isinstance(version, int) or isinstance(version, bool):
                raise HTTPError(400, "version must be an integer")
            body = self.body_field(data, required=False)
            pinned = self.pinned_field(data)
            if body is None and pinned is None:
                raise HTTPError(400, "nothing to change")
            row, conflict = self.store.update(note_id, version, body, pinned)
            if row is None:
                raise HTTPError(404, "note not found")
            if conflict:
                raise HTTPError(409, "note changed elsewhere", {"note": Store.note(row)})
            return self.send_json(200, Store.note(row))
        if method == "DELETE":
            if not self.store.delete(note_id):
                raise HTTPError(404, "note not found")
            return self.send_json(200, {"ok": True})
        raise HTTPError(405, "method not allowed")

    # --- request and response helpers

    def read_body(self):
        if "Transfer-Encoding" in self.headers:
            self.close_connection = True
            raise HTTPError(411, "content length required")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_REQUEST_BYTES:
            self.close_connection = True  # the rest of it is still unread
            raise HTTPError(413, "request too large")
        return self.rfile.read(length) if length else b""

    def read_json(self):
        try:
            data = json.loads(self.request_body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise HTTPError(400, "body must be JSON")
        if not isinstance(data, dict):
            raise HTTPError(400, "body must be a JSON object")
        return data

    @staticmethod
    def body_field(data, required):
        if "body" not in data:
            if required:
                raise HTTPError(400, "body is required")
            return None
        body = data["body"]
        if not isinstance(body, str):
            raise HTTPError(400, "body must be a string")
        if len(body) > MAX_BODY_CHARS:
            raise HTTPError(413, "note is too long")
        return body.replace("\r\n", "\n").replace("\x00", "")

    @staticmethod
    def pinned_field(data):
        if "pinned" not in data:
            return None
        if not isinstance(data["pinned"], bool):
            raise HTTPError(400, "pinned must be true or false")
        return data["pinned"]

    @staticmethod
    def source_field(data):
        """The chat a note was saved from: {"url": http(s) link, "title": text}."""
        source = data.get("source")
        if source is None:
            return None
        if not isinstance(source, dict):
            raise HTTPError(400, "source must be an object")
        url, title = source.get("url"), source.get("title", "")
        if not isinstance(url, str) or not isinstance(title, str):
            raise HTTPError(400, "source needs a url and a title")
        parts = urlsplit(url)
        if (
            len(url) > MAX_SOURCE_URL
            or parts.scheme not in ("http", "https")
            or not parts.netloc
            or any(c.isspace() or ord(c) < 32 for c in url)
        ):
            raise HTTPError(400, "source url must be an http(s) link")
        return url, " ".join(title.split())[:MAX_SOURCE_TITLE]

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_bytes(status, body, "application/json; charset=utf-8")

    def send_bytes(self, status, body, content_type, head=False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        if not head:
            self.wfile.write(body)


class UnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def get_request(self):
        conn, _ = super().get_request()
        return conn, ("unix", 0)  # BaseHTTPRequestHandler expects a pair


class TCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_server(socket_path=None, port=None, db_path=None):
    Handler.store = Store(db_path or default_db_path())
    if socket_path:
        try:
            os.unlink(socket_path)
        except FileNotFoundError:
            pass
        old_umask = os.umask(0o177)  # the socket is for this user only
        try:
            server = UnixServer(socket_path, Handler)
        finally:
            os.umask(old_umask)
    else:
        server = TCPServer(("127.0.0.1", port), Handler)
    return server


def serve(socket_path=None, port=None, db_path=None):
    server = make_server(socket_path, port, db_path)

    def stop(*_):
        raise SystemExit(0)

    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, stop)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if socket_path:
            try:
                os.unlink(socket_path)
            except OSError:
                pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    where = parser.add_mutually_exclusive_group(required=True)
    where.add_argument("--socket", help="Unix socket path ($SOCKET from term-llm)")
    where.add_argument("--port", type=int, help="loopback TCP port ($PORT from term-llm)")
    parser.add_argument("--db", help="SQLite database path (default: %(default)s)", default=None)
    args = parser.parse_args(argv)
    serve(socket_path=args.socket, port=args.port, db_path=args.db)


if __name__ == "__main__":
    main()
