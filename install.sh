#!/usr/bin/env bash
# Install (or update) Hacker and its notes widget for term-llm.
#
#   ./install.sh                 # copy into ~/.config/term-llm/{extensions/hacker,widgets/hacker-notes}
#   ./install.sh --enable        # ...and enable/reload them on the running local server
#   TERM_LLM_EXTENSIONS_DIR=/path TERM_LLM_WIDGETS_DIR=/path ./install.sh
#
# term-llm does not follow symlinked extension folders, so this copies the
# runtime files (it never touches your other extensions, widgets or
# extensions.yaml unless you pass --enable). Notes themselves live outside
# both folders, in ~/.local/share/term-llm/hacker/notes.db.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_ROOT="${TERM_LLM_EXTENSIONS_DIR:-$HOME/.config/term-llm/extensions}"
DEST="$DEST_ROOT/hacker"
WIDGET_DEST="${TERM_LLM_WIDGETS_DIR:-$HOME/.config/term-llm/widgets}/hacker-notes"
QUIET=0
ENABLE=0
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    --enable) ENABLE=1 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { [ "$QUIET" = 1 ] || echo "$@"; }

mkdir -p "$DEST"
FILES=(extension.yaml style.css main.js util.js colors.js themes.js thread.js arrivals.js composer.js palette.js notify.js favicon.js home.js nav.js routines.js notes.js markdown.js clip.js)
for f in "${FILES[@]}"; do cp "$HERE/$f" "$DEST/$f"; done
# Optional, untracked per-machine config (node default accents).
if [ -f "$HERE/local.json" ]; then cp "$HERE/local.json" "$DEST/local.json"; fi
# Optional, untracked pictures that local.json's nodeImages points at.
if [ -d "$HERE/local" ]; then mkdir -p "$DEST/local" && cp -R "$HERE/local/." "$DEST/local/"; fi
# Remove files from older versions that are no longer shipped.
for f in "$DEST"/*.js; do
  name="$(basename "$f")"
  printf '%s\n' "${FILES[@]}" | grep -qx "$name" || rm -f "$f"
done
# Fonts are no longer bundled: the system's monospace (JetBrains Mono where
# installed) is used instead.
rm -rf "$DEST/fonts"

# The notes widget: a small python3 server term-llm runs on demand.
mkdir -p "$WIDGET_DEST"
cp "$HERE/widget/widget.yaml" "$HERE/widget/server.py" "$WIDGET_DEST/"

say "Installed Hacker to $DEST"
say "Installed its notes widget to $WIDGET_DEST"
command -v python3 >/dev/null 2>&1 || say "Note: notes need python3, which was not found on PATH."

if [ "$ENABLE" = 1 ]; then
  # The local Web UI process (not a Hub): its port, and its token from
  # --token or, failing that, its TERM_LLM_SERVE_TOKEN.
  line="$(ps -axo pid=,args= | grep -E '^ *[0-9]+ ([^ ]*/)?term-llm serve( [a-z]+)* web( |$)' | head -1 || true)"
  pid="$(awk '{print $1}' <<<"$line")"
  tok="$(sed -n 's/.*--token[ =]\([^ ]*\).*/\1/p' <<<"$line")"
  if [ -z "$tok" ] && [ -n "$pid" ]; then
    tok="$(ps eww -o command= -p "$pid" 2>/dev/null | tr ' ' '\n' | sed -n 's/^TERM_LLM_SERVE_TOKEN=//p' | head -1 || true)"
  fi
  port="$(sed -n 's/.*--port[ =]\([0-9]*\).*/\1/p' <<<"$line")"
  if [ -z "$line" ] || [ -z "$tok" ]; then
    say "No running 'term-llm serve web' with a token found; enable it in Settings → Extensions."
    exit 0
  fi
  base="$(curl -fsSL -o /dev/null -w '%{url_effective}' "http://127.0.0.1:${port:-8080}/")"
  base="${base%/}"
  hdr=(-H "Authorization: Bearer $tok" -H 'Content-Type: application/json')
  status="$(curl -fsS -X POST "${hdr[@]}" -d '{}' "$base/admin/extensions/reload")"
  printf '%s' "$tok" | python3 -c '
import json, sys, urllib.request
tok = sys.stdin.read().strip()
status, base = json.loads(sys.argv[1]), sys.argv[2]
enabled = status.get("enabled", [])
if "hacker" not in enabled:
    enabled.append("hacker")
    req = urllib.request.Request(f"{base}/admin/extensions/config", method="POST",
        data=json.dumps({"enabled": enabled, "revision": status["config_revision"]}).encode(),
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    status = json.load(urllib.request.urlopen(req))
print("Enabled:", ", ".join(status.get("enabled", [])), "| errors:", status.get("errors") or "none")
' "$status" "$base"
  # Pick up the widget, and restart it if an older copy is running.
  if curl -fsS -X POST "${hdr[@]}" -d '{}' "$base/admin/widgets/reload" >/dev/null 2>&1; then
    curl -fsS -X POST "${hdr[@]}" -d '{}' "$base/admin/widgets/hacker-notes/stop" >/dev/null 2>&1 || true
    say "Notes widget loaded."
  else
    say "Widgets look disabled on this server (--disable-widgets); notes need them."
  fi
  say "Reload the web UI to see it."
else
  say "Next: open Settings → Extensions in the term-llm web UI and enable Hacker (or run ./install.sh --enable)."
fi
