# term-llm core: to-do

Changes to term-llm itself that would let Hacker drop workarounds, or fix
problems an extension can't fix from the outside. Each item says what happens
today, why the fix belongs in core, a proposed change, and what Hacker does
meanwhile.

Checked on 2026-11-22 against the installed term-llm v0.9.114 and the fork at
`~/work/term-llm` (v0.9.114 plus one commit, 9399544f). Upstream v0.9.117 has
no extension-loading changes since v0.9.114. Nothing here has been proposed
upstream yet.

- [ ] **1. Let extensions restore their look before the first paint.** High priority; medium change.
- [ ] **2. Fetch extension code while the app starts.** High; small to medium.
- [ ] **3. Cache and compress extension files.** Medium; small.
- [ ] **4. Give extensions app state instead of making them read markup.** Medium; medium.
- [ ] **5. Per-user, per-server widget socket paths.** Medium (safety); small.
- [ ] **6. 404, not 410, for a file an extension doesn't have.** Low; small.
- [ ] **7. Menus inside dialogs in the top layer, not `position: fixed`.** Low; small to medium.
- [ ] **8. A CLI to enable and reload extensions; symlinked extension folders.** Low; medium.

Items 1–3 are about the same load: on an agent switch through the Hub with
250 ms added to each request (a distant server, like the droplet), the page
first paints at about 540 ms, but Hacker's script runs at about 2,020 ms:

| ms | What happens |
| --- | --- |
| ~540 | First paint, with Hacker's stylesheet (linked in `<head>` since term-llm #1291) |
| ~1,230 | The app finishes starting (`startupDone`) |
| ~1,230 → 1,490 | `GET admin/extensions/status` |
| ~1,490 → 1,750 | Hacker's `main.js` |
| ~1,750 → 2,010 | The modules `main.js` imports, in one batch |
| ~2,020 | Hacker applies the saved theme and adds its own controls |

On localhost the same gap is a few hundred milliseconds; it grows with latency.

## 1. Let extensions restore their look before the first paint

**Today.** The server links enabled stylesheets in the page's `<head>`
(`internal/app/serve/serve_extension_styles.go`), so they apply from the first
paint. Extension JavaScript loads only after the app has started
(`frontend/src/main.tsx`: it waits for `store.startupDone`, then a frame, then
the status request, then the module). Anything an extension restores from the
browser, such as a chosen theme, accent, text size or corners, shows the
stylesheet's defaults for about 1.5 s and then switches. #1291 listed this
under "Not addressed", and the extensions guide
(`docs-site/content/guides/extensions.md`) tells authors to put the default
look in plain CSS. A choice made in the browser can't be expressed in CSS.

**Why in core.** Every theme extension with a user-selectable look has this
flash (Hacker, Varnish, anything the extension builder makes), and an extension
can't fix it: the server serves one snapshot of the extension's files to every
browser, so per-browser state can only be applied by script, and the only
script hook runs after startup.

**Proposed change.** An optional manifest key, for example `head: boot.js`.
For the same requests that get stylesheet links (signed in, no
`?safe-mode=1`, extension enabled and valid), the shell also gets
`<script src="extensions/<generation>/<id>/boot.js" data-extension-head="<id>">`
after those links. It's a classic, parser-blocking script: the browser fetches
it alongside the stylesheets and runs it before the body, so the first paint
already has the restored state. Fetched in parallel with the stylesheets, it
shouldn't delay that paint.

- Keep the logic in `internal/extensions` beside `StylesheetLinks`;
  `internal/app/serve` is at its package-size allowance.
- Validate it at load like `css` and `js`: a `.js` file, with a size cap (for
  example 8 KB).
- Safe mode can also be stored in `sessionStorage`
  (`term-llm:safe-mode:<node>:<prefix>`, `frontend/src/stores/extension-runtime.ts`),
  which the server can't see. Either a tiny core-owned inline loader checks it
  before writing the head scripts, or the docs say only `?safe-mode=1` skips
  them (`recoveryURL()` already uses it).
- Contract: restore appearance only (attributes and custom properties on
  `<html>`), with no DOM building and no requests.
- Tests like the stylesheet ones: linked when signed in, not in safe mode or
  for unauthorized requests, follows a reload. A guide section with an example.

Hacker would use it like this: `main.js` saves the resolved appearance (its
`data-vn-*` attributes and the palette's `--om-*` values) to localStorage
whenever it applies a theme, and a `boot.js` of about 1 KB copies them onto
`<html>`. The boot script needs no theme data.

**Hacker meanwhile.**

- `local.json` takes `"defaults"` (appearance, dark and light theme, text size,
  corners). `install.sh` runs `tools/bake_defaults.py`, which writes them into
  the installed `style.css` (the pre-script palette, the text-size and corner
  rules, and `--vn-default-*` properties that `main.js` reads back through
  `bakedDefaults()` in `util.js`). Commit 03d0d93.
- The stylesheet's attribute rules treat a missing attribute as the default
  (comfortable text), and CSS placeholders keep the space for code-block
  headers and the sidebar links until the script adds them. Commit 744f44f.
- Result at 250 ms per request: with defaults matching the browser's choice,
  Kanagawa from the first frame (542 ms instead of 2,019 ms); layout shift
  after first paint 0.227 → 0.023.
- Limits: per server, not per browser; re-run `install.sh` after a change; needs
  python3; set on each Hub node; a browser whose choice differs from the
  defaults still flashes.

**Once fixed.** Keep `defaults` for a browser's first visit (nothing saved yet)
and for older term-llm versions; the flash for differing choices goes away.

## 2. Fetch extension code while the app starts

**Today.** The status request, the entry module and its imports (three round
trips, about 0.8 s at 250 ms per request) all start after `startupDone`,
although the server knows when it renders the page which extensions are
enabled and where their entry modules are: it already renders their
stylesheet links.

**Why in core.** Only the loader can start these requests earlier; for every
extension, its UI arrives late on every page load and agent switch.

**Proposed change**, with no change to when extensions activate:

- Render `<link rel="modulepreload" href="extensions/<generation>/<id>/<js>">`
  for each enabled entry, under the same conditions as the stylesheet links,
  so the browser fetches the entry (and then its imports) during startup.
- Put the status (generation, enabled entries with their `css`, `js` and
  icons) in the shell, like the other injected `window.TERM_LLM_*` values, so
  `loadExtensions` can skip `admin/extensions/status` on first load. Keep the
  request as a fallback and for `watchExtensionActivation`.
- Activate at `startupDone` as today; the modules are already loaded, so it
  happens straight away. Estimate at 250 ms per request: extension UI at about
  1.23 s instead of 2.02 s.
- Later, and only with maintainer agreement: activating before `startupDone`
  would bring extension UI close to first paint, but changes what state
  extensions see when `activate()` runs.

**Hacker meanwhile.** `main.js` imports every module directly, enforced by
`checkFlatImports` in `tools/ci/source-check.mjs`, so they arrive in one batch
instead of a chain (one round trip per level saved). `local.json` is kept in
localStorage (`term-llm:hacker:local-json`) and refreshed in the background
instead of awaited. Bundling into one file would save one more round trip but
needs a build step, so it wasn't done.

**Once fixed.** The flat-import rule can stay; it just stops mattering much.

## 3. Cache and compress extension files

**Today.** `handleExtensionAsset` (`internal/app/serve/serve_extensions.go`)
serves every extension file with `Cache-Control: private, no-store` and
uncompressed, although each URL contains the generation, a hash of the enabled
ids, entry points and file contents (`snapshotGeneration` in
`internal/extensions/manager.go`), and a stale generation already gets 410. So
every page load and agent switch downloads all of Hacker again: a 149 KB
render-blocking stylesheet and 231 KB of JavaScript in 14 modules (32 KB and
75 KB gzipped). Cloudflare compresses them on the droplet, but nothing caches
them.

**Why in core.** The server sets these headers; an extension can't.

**Proposed change.** For files of the current generation,
`Cache-Control: private, max-age=31536000, immutable`, and gzip for text types
(`wire.WriteGzipBody` already does this for the page). Keep `no-store` on 410
responses.

**Expected.** On repeat loads the entry and its imports come from the browser
cache: about 0.5 s sooner at 250 ms per request with today's loading order
(less once item 2 lands), and the stylesheet's bytes leave the critical path.

**Hacker meanwhile.** Nothing an extension can do. A stopgap for the droplet
would be a Cloudflare response-header rule on `/hub/node/*/extensions/*` (not
done).

## 4. Give extensions app state instead of making them read markup

**Today.** The extension API (`extensionHost` in
`frontend/src/stores/extension-runtime.ts`) offers `root`, `mount`,
`getContext()`, `onSessionChanged()`, context usage, `insertComposerText()` and
`icon`. Everything else Hacker needs, it reads from the app's markup, which can
break without warning on upgrade:

- Whether a reply is running: `isRunning()` in `util.js` looks for
  `.composer .stop-btn.visible` or `.composer #sendBtn.stop`. term-llm 0.9.92
  moved Stop into the send button, which broke it until 265bf00. Used by
  `notify.js` (tab title and favicon when a reply ends), `composer.js` (the
  Compact button) and `thread.js` (editing a message).
- Which chats need you: the sidebar rows' `.is-input-required`, `.is-active`
  and `.is-unseen` classes (`nav.js` Activity, `home.js` status counts,
  `notify.js`).
- Model and effort: attributes of
  `.header-stats .model-chip-primary .chip-trigger` (`main.js` composer chip,
  `home.js`).
- Noticing changes at all: a MutationObserver on all of `document.body` plus a
  throttled whole-UI pass (`main.js`).

**Why in core.** Markup isn't an API, and Hacker's CI can't catch drift because
it pins term-llm 0.9.88. Read-only signals would keep extensions working across
upgrades and spare each one its own whole-document observer.

**Proposed change.** Read-only, signal-backed like `onContextUsageChanged`:

- `getRunState()` / `onRunStateChanged()` for the active session: idle,
  running, or waiting for input.
- `onSessionsChanged()` with each listed session's attention state (waiting,
  running, unread).
- `getRuntime()` / `onRuntimeChanged()`: model, provider, effort.

**Hacker meanwhile.** The selectors above, checked by hand against the
installed version (`tools/check.mjs` probes for the host hooks it uses).

**Once fixed.** Read state from the API; decorating the app's markup stays.

## 5. Per-user, per-server widget socket paths

**Today.** A socket widget listens on `/tmp/term-llm-widgets/<folder>.sock`
(`socketRuntimeDir` in `internal/widgets/manager.go`), and the server deletes
any file at that path before starting the widget. So:

- Two `serve web` processes for one user on one machine (for example two nodes
  of a local Hub) that both have a widget folder called `hacker-notes` delete
  each other's socket, and the first server's widget becomes unreachable.
- The directory has a fixed name in a shared `/tmp`, created with
  `os.MkdirAll(…, 0700)`, which accepts an existing directory without checking
  its owner or mode. On a machine shared with other users, someone else can
  create it first: widgets then fail to start, or, if that user left it
  writable, their socket can be swapped for another listener that receives the
  widget's requests (for Hacker, the user's notes).

**Why in core.** The server picks the path; widgets only receive it.

**Proposed change.** Put sockets in a per-user directory (`$XDG_RUNTIME_DIR` on
Linux, `os.TempDir()` on macOS, which is already per user), created 0700, and
refuse one that isn't owned by the user with mode 0700. Name sockets per server
instance (port or node id, for example `<port>/<id>.sock`) so servers never
touch each other's. Mind the socket path limit of about 104 bytes on macOS.

**Hacker meanwhile.** The README asks anyone running two servers on one machine
to rename one widget folder; tests install the widget as
`hacker-notes-<node>`.

## 6. 404, not 410, for a file an extension doesn't have

**Today.** `Manager.Asset` returns "not found" both for a stale generation and
for a name the current generation doesn't have, and the handler answers both
with 410 ("Extension asset unavailable. Reload the page…"). Hacker's
`local.json` is optional, so every page load without one logs "Failed to load
resource: the server responded with a status of 410 (Gone)" in the console,
which reads like a stale page.

**Proposed change.** 404 for a name missing from the current generation; 410
only for a stale generation.

**Hacker meanwhile.** `loadLocalConfig()` in `util.js` treats any non-OK reply
as "no local.json"; `tools/ci/local-config.test.mjs` pins the 410 case.

**Once fixed.** Nothing to change in Hacker; the console stays clean.

## 7. Menus inside dialogs in the top layer, not `position: fixed`

**Today.** Row menus inside dialogs (`.mcp-row-menu-layer` in
`frontend/src/styles/features/mcp.css`, and the widget row menus) are
`position: fixed`, so any transformed ancestor becomes their containing block
and they land off-screen: a hover `translateY`, a `translate(-50%)` centring
wrapper, or an animation that keeps even `transform: none` or `scale(1)` in
effect after it ends.

**Why in core.** Any style change, in core or in an extension, can break these
menus, and the cause is hard to spot.

**Proposed change.** Render them in the top layer (the `popover` attribute, or
a portal at the end of `body`), which ignores ancestor transforms; keep the
existing positioning.

**Hacker meanwhile.** Dialog animations fill backwards only (e687a71), and
since d9da3f5 every entrance animation does. That second change also stopped
every message from holding its own compositor layer: on a 17-message chat
Hacker had 100 layers against stock term-llm's 21, and now has 17.

## 8. A CLI to enable and reload extensions; symlinked extension folders

**Today.**

- There's no command to enable or reload an extension on a running server
  (`term-llm extensions` doesn't exist). `install.sh --enable` finds the first
  `term-llm serve … web` in `ps`, takes its `--token` or reads
  `TERM_LLM_SERVE_TOKEN` from the process environment (`ps eww`), and calls
  `admin/extensions/reload` and `admin/extensions/config`. With more than one
  server it may pick the wrong one.
- Symlinked extension folders are skipped (the scan in
  `internal/extensions/manager.go` uses `DirEntry.IsDir()`, which is false for
  a symlink, inside an `os.Root`). A checkout can't be linked in for
  development, so every edit means re-running `install.sh` and reloading.

**Proposed change.** `term-llm extensions list|enable|disable|reload`, which
edits `extensions.yaml` and tells running servers through the admin API,
finding them by config rather than by scanning processes. Optionally, follow a
symlinked top-level extension folder that resolves to a directory the user
owns, with reads still confined to it; that's a security trade-off to agree
with the maintainers.

**Hacker meanwhile.** `install.sh` copies the files, and `--enable` scans
processes for the server and its token.

## How the numbers were measured

A throwaway Hub with two Hacker nodes on the installed term-llm, behind an
HTTP/2 proxy that compresses like Cloudflare, opened in Chrome with 250 ms
added to each request. Paint and layout-shift times came from
`PerformanceObserver`, streaming cost from the Chrome DevTools Protocol
(performance metrics, CPU profile, trace, layer tree), each compared against
stock term-llm with `?safe-mode=1`.
