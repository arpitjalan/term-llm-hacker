"""The notes widget's API, over a real Unix socket and a throwaway database."""
import http.client
import importlib.util
import json
import os
import socket
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("hacker_notes_server", ROOT / "widget/server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("widget", timeout=5)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(5)
        self.sock.connect(self.path)


class NotesAPITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        # macOS caps Unix socket paths near 104 bytes; keep this one short.
        self.sock_dir = tempfile.mkdtemp(prefix="hn", dir="/tmp")
        self.sock = os.path.join(self.sock_dir, "s")
        self.db = os.path.join(self.tmp.name, "data", "notes.db")
        self.server = server.make_server(socket_path=self.sock, db_path=self.db)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self.thread.start()
        self.conn = UnixConnection(self.sock)

    def tearDown(self):
        self.conn.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        try:
            os.unlink(self.sock)
        except FileNotFoundError:
            pass
        os.rmdir(self.sock_dir)
        self.tmp.cleanup()

    def call(self, method, path, body=None, raw=None, headers=None):
        payload = raw if raw is not None else (None if body is None else json.dumps(body).encode())
        all_headers = dict(headers or {})
        if payload is not None:
            all_headers.setdefault("Content-Type", "application/json")
        self.conn.request(method, path, body=payload, headers=all_headers)
        res = self.conn.getresponse()
        data = res.read()
        ctype = res.getheader("Content-Type", "")
        if res.getheader("Connection", "").lower() == "close":
            self.conn.close()
        return res.status, (json.loads(data) if "json" in ctype else data), res

    def create(self, body, **extra):
        status, note, _ = self.call("POST", "/api/notes", {"body": body, **extra})
        self.assertEqual(status, 201, note)
        return note

    def test_titles_and_previews_match_the_shared_fixture(self):
        cases = json.loads((ROOT / "tools/ci/fixtures/note-text.json").read_text())
        for case in cases:
            self.assertEqual(server.derive(case["body"]), (case["title"], case["snippet"]), case["body"])
        self.assertEqual(len(server.derive("x" * 300)[0]), 120)

    def test_create_read_update_and_list(self):
        note = self.create("# Groceries\nmilk, eggs")
        self.assertEqual((note["title"], note["snippet"], note["version"], note["pinned"]), ("Groceries", "milk, eggs", 1, False))
        status, got, _ = self.call("GET", f"/api/notes/{note['id']}")
        self.assertEqual((status, got["body"]), (200, "# Groceries\nmilk, eggs"))
        status, updated, _ = self.call("PATCH", f"/api/notes/{note['id']}", {"body": "# Groceries\nmilk, eggs, tea", "version": 1})
        self.assertEqual((status, updated["version"], updated["snippet"]), (200, 2, "milk, eggs, tea"))
        self.assertGreaterEqual(updated["updated_at"], note["updated_at"])
        status, listed, _ = self.call("GET", "/api/notes")
        self.assertEqual((status, listed["total"], len(listed["notes"])), (200, 1, 1))
        self.assertNotIn("body", listed["notes"][0], "lists carry previews, not whole notes")

    def test_stale_versions_conflict_and_return_the_current_note(self):
        note = self.create("first")
        self.call("PATCH", f"/api/notes/{note['id']}", {"body": "second", "version": 1})
        status, err, _ = self.call("PATCH", f"/api/notes/{note['id']}", {"body": "from another tab", "version": 1})
        self.assertEqual(status, 409)
        self.assertEqual((err["note"]["body"], err["note"]["version"]), ("second", 2))
        status, kept, _ = self.call("PATCH", f"/api/notes/{note['id']}", {"body": "from another tab", "version": 2})
        self.assertEqual((status, kept["body"], kept["version"]), (200, "from another tab", 3))

    def test_pinning_orders_first_without_counting_as_an_edit(self):
        old = self.create("older")
        new = self.create("newer")
        status, pinned, _ = self.call("PATCH", f"/api/notes/{old['id']}", {"pinned": True, "version": 1})
        self.assertEqual((status, pinned["pinned"], pinned["updated_at"]), (200, True, old["updated_at"]))
        _, listed, _ = self.call("GET", "/api/notes")
        self.assertEqual([n["id"] for n in listed["notes"]], [old["id"], new["id"]])

    def test_search_matches_every_word_in_title_or_body(self):
        a = self.create("Deploy checklist\nrotate the tokens")
        self.create("Groceries\ntea")
        c = self.create("Tokens\nnotes on deploy")
        _, found, _ = self.call("GET", "/api/notes?q=deploy%20tokens")
        self.assertEqual({n["id"] for n in found["notes"]}, {a["id"], c["id"]})
        self.assertEqual(found["notes"][0]["id"], a["id"], "a title match on the first word ranks first")
        _, none, _ = self.call("GET", "/api/notes?q=100%25_")
        self.assertEqual(none["notes"], [], "LIKE wildcards are matched literally")

    def test_delete_hides_a_note_until_restored(self):
        note = self.create("temporary")
        status, _, _ = self.call("DELETE", f"/api/notes/{note['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(self.call("GET", f"/api/notes/{note['id']}")[0], 404)
        self.assertEqual(self.call("GET", "/api/notes")[1]["total"], 0)
        self.assertEqual(self.call("DELETE", f"/api/notes/{note['id']}")[0], 404)
        status, restored, _ = self.call("POST", f"/api/notes/{note['id']}/restore")
        self.assertEqual((status, restored["body"]), (200, "temporary"))
        self.assertEqual(self.call("GET", "/api/notes")[1]["total"], 1)

    def test_old_deleted_notes_are_purged_on_start(self):
        note = self.create("ancient")
        self.call("DELETE", f"/api/notes/{note['id']}")
        with server.Store(self.db).session() as db:
            db.execute("UPDATE notes SET deleted_at = 1 WHERE id = ?", (note["id"],))
        server.Store(self.db)  # what the next start does
        self.assertEqual(self.call("POST", f"/api/notes/{note['id']}/restore")[0], 404)

    def test_bad_requests_are_rejected_without_breaking_the_connection(self):
        cases = [
            ("POST", "/api/notes", {"raw": b"{not json"}, 400),
            ("POST", "/api/notes", {"body": ["a list"]}, 400),
            ("POST", "/api/notes", {"body": {"body": 5}}, 400),
            ("POST", "/api/notes", {"body": {"body": "x", "pinned": "yes"}}, 400),
            ("PATCH", "/api/notes/abcdefgh", {"body": {"body": "x"}}, 400),
            ("PATCH", "/api/notes/abcdefgh", {"body": {"body": "x", "version": 1}}, 404),
            ("GET", "/api/notes/../../etc", {}, 404),
            ("GET", "/api/notes?limit=lots", {}, 400),
            ("PUT", "/api/notes", {}, 405),
            ("GET", "/elsewhere", {}, 404),
        ]
        for method, path, kwargs, want in cases:
            status, err, _ = self.call(method, path, **kwargs)
            self.assertEqual(status, want, (method, path))
            self.assertIn("error", err)
        # Every error above answered on one keep-alive connection; it still works.
        self.assertEqual(self.call("GET", "/api/notes")[0], 200)

    def test_limits(self):
        status, _, _ = self.call("POST", "/api/notes", {"body": "x" * (server.MAX_BODY_CHARS + 1)})
        self.assertEqual(status, 413)
        # A request too large to read is answered at once, and the connection
        # closed, rather than read in. (A raw socket: the reply comes before
        # any body is sent.)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as raw:
            raw.settimeout(5)
            raw.connect(self.sock)
            raw.sendall(f"POST /api/notes HTTP/1.1\r\nHost: w\r\nContent-Length: {server.MAX_REQUEST_BYTES + 1}\r\n\r\n".encode())
            reply = b""
            while chunk := raw.recv(4096):
                reply += chunk
        head = reply.split(b"\r\n\r\n", 1)[0].decode()
        self.assertTrue(head.startswith("HTTP/1.1 413"), head)
        self.assertIn("Connection: close", head)

    def test_notes_saved_from_a_chat_keep_a_link_to_it(self):
        link = "http://localhost:8090/node/local/chat/12#message-345"
        note = self.create("from the chat", source={"url": link, "title": "  Deploy\n plan  "})
        self.assertEqual(note["source"], {"url": link, "title": "Deploy plan"})
        self.assertIsNone(self.create("typed here")["source"])
        self.assertEqual(self.call("GET", f"/api/notes/{note['id']}")[1]["source"]["url"], link)
        _, listed, _ = self.call("GET", "/api/notes")
        self.assertEqual({n["id"]: n["source"] for n in listed["notes"]}[note["id"]]["title"], "Deploy plan")
        _, found, _ = self.call("GET", "/api/notes?q=deploy")
        self.assertEqual([n["id"] for n in found["notes"]], [note["id"]], "search matches the chat's title")
        _, edited, _ = self.call("PATCH", f"/api/notes/{note['id']}", {"body": "rewritten", "version": 1})
        self.assertEqual(edited["source"]["url"], link, "editing keeps the link")

    def test_sources_must_be_web_links(self):
        for source in [
            "https://example.com",
            {"title": "no url"},
            {"url": 5},
            {"url": "https://example.com", "title": 5},
            {"url": "javascript:alert(1)"},
            {"url": "ftp://example.com/x"},
            {"url": "https:///path-only"},
            {"url": "https://example.com/a b"},
            {"url": "https://example.com/" + "a" * server.MAX_SOURCE_URL},
        ]:
            status, err, _ = self.call("POST", "/api/notes", {"body": "x", "source": source})
            self.assertEqual(status, 400, source)
            self.assertIn("error", err)
        note = self.create("x", source={"url": "https://example.com/chat/1", "title": "t" * 500})
        self.assertEqual(len(note["source"]["title"]), server.MAX_SOURCE_TITLE)

    def test_databases_from_before_sources_are_upgraded_in_place(self):
        old = os.path.join(self.tmp.name, "old.db")
        with sqlite3.connect(old) as db:
            db.executescript("""
                CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', snippet TEXT NOT NULL DEFAULT '',
                  body TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
                  updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER);
                INSERT INTO notes (id, title, body, created_at, updated_at) VALUES ('oldnote1', 'Kept', 'Kept', 1, 1);
                PRAGMA user_version=1;
            """)
        store = server.Store(old)
        server.Store(old)  # starting again changes nothing
        row = store.get("oldnote1")
        self.assertEqual((row["body"], server.Store.note(row)["source"]), ("Kept", None))
        with store.session() as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], server.SCHEMA_VERSION)

    def test_text_is_stored_as_given_except_line_endings_and_nul(self):
        note = self.create("tab\there\r\nnul\x00gone 😀 <script>")
        self.assertEqual(note["body"], "tab\there\nnulgone 😀 <script>")

    def test_root_page_leads_back_to_the_chat_with_notes_open(self):
        status, page, res = self.call("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b'url=../../#notes', page)
        self.assertEqual(res.getheader("Cache-Control"), "no-store")

    def test_database_and_socket_are_private(self):
        self.create("private")
        self.assertEqual(os.stat(self.db).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(self.sock).st_mode & 0o077, 0)


if __name__ == "__main__":
    unittest.main()
