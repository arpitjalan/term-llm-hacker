// Notes: a panel on the right for notes kept in SQLite by Hacker's notes
// widget (widget/server.py), which term-llm starts on demand behind its own
// login and proxies at <base>/widgets/hacker-notes/. A searchable list, and a
// Markdown editor that colours as you type, saves as you go, and previews
// with working checklists. Nothing is requested until the panel opens.
//
// The editor is a plain textarea (native undo, spellcheck, IME, mobile
// keyboards) with transparent text over a coloured copy of the same text
// (markdown.js highlight()), laid out identically so the two line up.

import { KEYS, NODE_ID, html, read, write, el, apiRequest, isMac } from "./util.js";
import { composerText, setComposerText } from "./thread.js";
import { openChatLink } from "./clip.js";
import {
  highlight, renderMarkdown, noteText, continueList, shiftLines, isListLine, toggleTask, toggleTaskAt, wrapSelection,
} from "./markdown.js";

const API = "/widgets/hacker-notes/api/notes";
const SAVE_DELAY = 600;
const WIDTH = { min: 280, max: 720, initial: 380 };
// Long notes repaint on the next frame instead of on every keystroke.
const SYNC_PAINT_LIMIT = 40_000;

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  // A notebook: its spine on the left, a page of lines.
  notes: svg('<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 3v18M12.5 8h4M12.5 12h4M12.5 16h2.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  pin: svg('<path d="M12 17v5"/><path d="M8.5 3.5h7L14 9.5l3.5 3.5v2h-11v-2L10 9.5z"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
  insert: svg('<path d="M4 4v7a3 3 0 0 0 3 3h12"/><path d="m15 10 4 4-4 4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  // Back to where it came from.
  source: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
};

function ago(ms) {
  if (!ms) return "";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d`;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
}

const edited = (ms) => {
  const when = ago(ms);
  return !when ? "" : when === "now" ? "edited just now" : /^\d/.test(when) ? `edited ${when} ago` : `edited ${when}`;
};

const words = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const applyEdit = (value, { from, to, insert }) => value.slice(0, from) + insert + value.slice(to);

// Why the list could not load, in words someone can act on.
function problem(error) {
  if (error.status === 0) return { title: "Offline", detail: "Notes load again when the connection is back." };
  if (error.status === 401 || error.status === 403) return { title: "Signed out", detail: "Sign in to term-llm again to see notes." };
  if (error.notJson && (error.status === 404 || error.status < 300)) {
    return {
      title: "Notes aren't set up for this agent",
      detail: "Hacker keeps notes with a small term-llm widget. Run ./install.sh from Hacker's folder on the machine this agent runs on, then reload.",
    };
  }
  if (error.status === 502 || error.status === 503) {
    return { title: "The notes service didn't start", detail: error.text?.trim() || "It needs python3 on the machine this agent runs on." };
  }
  return { title: "Couldn't load notes", detail: error.data?.error || error.text?.trim() || `HTTP ${error.status}` };
}

// Why a note from the chat (clip.js) was not saved, in a few words.
function clipProblem(error) {
  if (error.status === 413) return "Too long for a note";
  if (error.status === 0) return "Offline: not saved";
  if (error.status === 401 || error.status === 403) return "Signed out";
  if (error.notJson && (error.status === 404 || error.status < 300)) return "Notes aren't set up here";
  if (error.status === 502 || error.status === 503) return "Notes didn't start";
  return "Couldn't save";
}

export function createNotes(root, { mount }) {
  const lastKey = NODE_ID ? `${KEYS.notesLast}:${NODE_ID}` : KEYS.notesLast;
  let open = false;
  let view = "list"; // "list" | "note"
  let button = null;
  let panel = null;
  // Parts of the panel, made by build().
  let grip, countEl, listEl, stateEl, searchInput, whereEl, status, pinBtn, previewBtn, sourceEl, sourceTitle, scroller, editorBox, hl, ta, preview, conflictBar, metaEl, toast;

  // The list: summaries from the widget, in its order (pinned, then newest).
  let notes = [];
  let total = 0;
  let query = "";
  let active = 0;
  let listState = { kind: "idle" }; // idle | loading | ready | problem
  let listSeq = 0;
  let searchTimer = 0;
  let available = false; // the widget has answered on this page
  let paletteNotes = [];

  // The open note: { id, body, saved, version, pinned, updated_at, ... }.
  let note = null;
  const unsaved = new Set(); // notes with edits still to send
  let saveTimer = 0;
  let paintFrame = 0;
  let toastTimer = 0;
  // Preview is remembered for opening notes; a new note always starts in the editor.
  let prefersPreview = read(KEYS.notesPreview, "0") === "1";
  let previewMode = false;
  let width = Math.max(WIDTH.min, Math.min(WIDTH.max, Number(read(KEYS.notesWidth, "")) || WIDTH.initial));
  html.style.setProperty("--vn-notes-user-w", `${width}px`);

  /* ------------------------------------------------------------ build */

  function iconButton(name, label, onClick, { cls = "", text = "", pressed } = {}) {
    const b = el("button", { type: "button", class: `vn-notes-btn${cls ? ` ${cls}` : ""}`, "aria-label": label, title: label, html: ICONS[name] });
    if (text) b.append(el("span", { class: "vn-notes-btn-text", text }));
    if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
    b.addEventListener("click", onClick);
    return b;
  }

  function build() {
    if (panel) return;
    grip = el("div", {
      class: "vn-notes-grip", role: "separator", tabindex: "0", "aria-orientation": "vertical",
      "aria-label": "Resize notes", "aria-valuemin": WIDTH.min, "aria-valuemax": WIDTH.max, "aria-valuenow": width,
    });
    countEl = el("span", { class: "vn-notes-count" });
    status = el("span", { class: "vn-notes-status", role: "status", "aria-live": "polite" });
    pinBtn = iconButton("pin", "Pin note", togglePin, { pressed: false });
    previewBtn = iconButton("eye", "Preview", () => setPreview(!previewMode, { remember: true, focus: true }), { pressed: false });
    const head = el("header", { class: "vn-notes-head" }, [
      el("div", { class: "vn-notes-head-list" }, [
        el("h2", { class: "vn-notes-title", id: "vn-notes-title", text: "Notes" }),
        countEl,
        iconButton("plus", "New note", () => startNew(), { cls: "vn-notes-new", text: "New" }),
      ]),
      el("div", { class: "vn-notes-head-note" }, [
        iconButton("back", "Back to notes", () => showList({ focus: true }), { cls: "vn-notes-back", text: "Notes" }),
        status,
        iconButton("plus", "New note", () => startNew()),
        pinBtn,
        previewBtn,
      ]),
      iconButton("close", "Close notes", () => setOpen(false, { focus: true }), { cls: "vn-notes-close" }),
    ]);

    searchInput = el("input", {
      class: "vn-notes-search", type: "search", placeholder: "Search notes", "aria-label": "Search notes",
      role: "combobox", "aria-controls": "vn-notes-list", "aria-expanded": "true", "aria-autocomplete": "list",
      autocomplete: "off", spellcheck: "false",
    });
    listEl = el("div", { class: "vn-notes-list", id: "vn-notes-list", role: "listbox", "aria-label": "Notes" });
    stateEl = el("div", { class: "vn-notes-states" });
    whereEl = el("p", { class: "vn-notes-where" });
    const listView = el("section", { class: "vn-notes-view vn-notes-view-list" }, [
      el("div", { class: "vn-notes-searchbar" }, [searchInput]),
      el("div", { class: "vn-notes-scroll" }, [listEl, stateEl]),
      whereEl,
    ]);

    hl = el("div", { class: "vn-note-hl", "aria-hidden": "true" });
    ta = el("textarea", {
      class: "vn-note-text", "aria-label": "Note", spellcheck: "true",
      placeholder: "Title on the first line, then anything. Markdown works.",
    });
    editorBox = el("div", { class: "vn-note-editor" }, [hl, ta]);
    preview = el("div", { class: "vn-note-preview markdown-body", hidden: true });
    scroller = el("div", { class: "vn-note-scroll" }, [editorBox, preview]);
    conflictBar = el("div", { class: "vn-note-conflict", role: "alert", hidden: true });
    sourceTitle = el("span", { class: "vn-note-source-title" });
    sourceEl = el("a", { class: "vn-note-source", hidden: true }, [
      el("span", { class: "vn-note-source-icon", html: ICONS.source }),
      el("span", { class: "vn-note-source-from", text: "from" }),
      sourceTitle,
    ]);
    metaEl = el("span", { class: "vn-note-meta" });
    const foot = el("footer", { class: "vn-note-foot" }, [
      metaEl,
      iconButton("copy", "Copy note", copyNote),
      iconButton("insert", "Insert into message", insertNote),
      iconButton("trash", "Delete note", deleteNote, { cls: "is-danger" }),
    ]);
    const noteView = el("section", { class: "vn-notes-view vn-notes-view-note" }, [conflictBar, sourceEl, scroller, foot]);
    toast = el("div", { class: "vn-notes-toast", role: "status", hidden: true });

    panel = el("aside", { class: "vn-notes", id: "vn-notes", "aria-labelledby": "vn-notes-title", "data-view": view, tabindex: "-1", hidden: true },
      [grip, head, listView, noteView, toast]);
    mount.append(panel);

    searchInput.addEventListener("input", () => {
      query = searchInput.value;
      active = 0;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(refresh, 140);
    });
    searchInput.addEventListener("keydown", onSearchKey);
    listEl.addEventListener("click", (event) => {
      const row = event.target.closest(".vn-note-row");
      if (row) openNote(row.dataset.id);
    });
    stateEl.addEventListener("click", (event) => {
      if (event.target.closest(".vn-notes-retry")) refresh();
      else if (event.target.closest(".vn-notes-empty-new")) startNew(query.trim());
    });
    listEl.addEventListener("pointermove", (event) => {
      const row = event.target.closest(".vn-note-row");
      if (row) select(Number(row.dataset.index), false);
    });
    ta.addEventListener("input", onInput);
    ta.addEventListener("keydown", onEditorKey);
    ta.addEventListener("compositionstart", () => editorBox.setAttribute("data-composing", ""));
    ta.addEventListener("compositionend", () => {
      editorBox.removeAttribute("data-composing");
      paint();
    });
    ta.addEventListener("blur", () => note && save(note));
    preview.addEventListener("click", onPreviewClick);
    sourceEl.addEventListener("click", onSourceClick);
    preview.addEventListener("dblclick", (event) => {
      if (!event.target.closest("a, input")) setPreview(false, { focus: true });
    });
    panel.addEventListener("keydown", onPanelKey);
    grip.addEventListener("pointerdown", onGripDown);
    grip.addEventListener("keydown", onGripKey);
  }

  /* --------------------------------------------- header button, open */

  // The panel's head matches the chat header's height, so their rules meet.
  let header = null;
  const headerSize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(([entry]) => {
    const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.offsetHeight;
    if (h) html.style.setProperty("--vn-notes-head-h", `${h}px`);
  });

  function ensureButton() {
    const nextHeader = root.querySelector(".main-header");
    if (nextHeader !== header && headerSize) {
      if (header) headerSize.unobserve(header);
      header = nextHeader;
      if (header) headerSize.observe(header);
    }
    const row = root.querySelector(".main-header .header-controls-row");
    if (!row) return;
    if (!button) {
      button = el("button", { type: "button", class: "vn-notes-toggle", "aria-controls": "vn-notes", title: "Notes", html: ICONS.notes });
      button.addEventListener("click", () => setOpen(!open, { focus: true }));
      syncButton();
    }
    // Last in the row: just after the appearance button, beside the panel it opens.
    const themeBtn = row.querySelector(":scope > .vn-theme-btn");
    if (themeBtn) {
      if (themeBtn.nextElementSibling !== button) themeBtn.after(button);
    } else if (button.parentElement !== row || button.nextElementSibling) {
      row.append(button);
    }
  }

  function syncButton() {
    if (!button) return;
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Close notes" : "Open notes");
  }

  function setOpen(next, { focus = false } = {}) {
    if (next === open) {
      if (next && focus) focusView();
      return;
    }
    open = next;
    write(KEYS.notesOpen, open ? "1" : "0");
    if (open) {
      build();
      panel.hidden = false;
      html.setAttribute("data-vn-notes", "");
      if (view === "list") refresh();
      else if (note?.id) reloadNote(note);
      if (focus) focusView();
    } else {
      flushAll();
      hideToast();
      const hadFocus = panel?.contains(document.activeElement);
      if (panel) panel.hidden = true;
      html.removeAttribute("data-vn-notes");
      if (focus || hadFocus) button?.focus({ preventScroll: true });
    }
    syncButton();
  }

  // On touch screens focus goes to the panel itself: focusing the search
  // field would bring up the keyboard every time the panel opens.
  const coarse = matchMedia("(pointer: coarse)");

  function focusView() {
    if (view === "list") (coarse.matches ? panel : searchInput).focus({ preventScroll: true });
    else if (previewMode) previewBtn.focus({ preventScroll: true });
    else ta.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------- the list */

  async function refresh() {
    const seq = ++listSeq;
    if (listState.kind !== "ready") {
      listState = { kind: "loading" };
      renderList();
    }
    const q = query.trim();
    try {
      const data = await apiRequest("GET", `${API}${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      if (seq !== listSeq) return;
      available = true;
      notes = Array.isArray(data.notes) ? data.notes : [];
      total = Number(data.total) || 0;
      if (!q) paletteNotes = notes;
      listState = { kind: "ready" };
    } catch (error) {
      if (seq !== listSeq) return;
      if (error.notJson || error.status === 0 || error.status >= 500) available = false;
      listState = { kind: "problem", ...problem(error) };
    }
    renderList();
  }

  // A note's new summary, in its place: pinned first, then newest. A search
  // result keeps its members; the full list takes in new ones.
  function upsert(summary) {
    const { body: _body, ...rest } = summary;
    const place = (list, add) => {
      const at = list.findIndex((n) => n.id === rest.id);
      if (at >= 0) list.splice(at, 1);
      else if (!add) return;
      const to = list.findIndex((n) => (n.pinned !== rest.pinned ? rest.pinned : rest.updated_at >= n.updated_at));
      list.splice(to < 0 ? list.length : to, 0, rest);
    };
    place(notes, !query.trim());
    if (paletteNotes !== notes) place(paletteNotes, true);
  }

  function forget(id) {
    notes = notes.filter((n) => n.id !== id);
    paletteNotes = paletteNotes.filter((n) => n.id !== id);
    total = Math.max(0, total - 1);
  }

  function row(n, index) {
    const title = n.title || "Untitled";
    const stamp = Number.isFinite(n.updated_at) ? new Date(n.updated_at) : null;
    const time = el("time", { class: "vn-note-row-time", text: ago(n.updated_at), datetime: stamp?.toISOString() ?? null });
    if (stamp) time.title = stamp.toLocaleString();
    return el("div", {
      class: "vn-note-row", role: "option", id: `vn-note-${index}`, "aria-selected": String(index === active),
      "data-id": n.id, "data-index": index, "data-pinned": n.pinned ? "" : null,
    }, [
      el("span", { class: "vn-note-row-title", text: title }),
      time,
      el("span", { class: "vn-note-row-snippet", text: n.snippet || "No more text" }),
    ]);
  }

  function renderList() {
    if (!panel) return;
    countEl.textContent = listState.kind === "ready" && total ? String(total) : "";
    const label = root.querySelector('.hub-agent-link[aria-current="true"] .hub-agent-name')?.textContent.trim() || NODE_ID;
    whereEl.textContent = available ? `Saved in SQLite on ${label || "this machine"}` : "";
    active = Math.max(0, Math.min(active, notes.length - 1));
    const parts = [];
    let state = null;
    const q = query.trim();
    if (listState.kind === "problem") {
      state = el("div", { class: "vn-notes-state is-problem" }, [
        el("p", { class: "vn-notes-state-title", text: listState.title }),
        el("p", { text: listState.detail }),
        el("button", { type: "button", class: "vn-notes-action vn-notes-retry", text: "Try again" }),
      ]);
    } else if (listState.kind === "loading" && !notes.length) {
      state = el("p", { class: "vn-notes-state", text: "Loading…" });
    } else if (!notes.length) {
      state = el("div", { class: "vn-notes-state" }, [
        el("p", { class: "vn-notes-state-title", text: q ? `No notes match “${q}”` : "No notes yet" }),
        el("p", { text: q ? "Press Enter to start one with that title." : "Notes stay on this agent, kept between chats. Markdown works, with checklists." }),
        el("button", { type: "button", class: "vn-notes-action vn-notes-empty-new", text: q ? `New note “${q}”` : "New note" }),
      ]);
    }
    // Rows already loaded stay, even when a later refresh fails.
    const pinned = notes.some((n) => n.pinned) && notes.some((n) => !n.pinned);
    notes.forEach((n, i) => {
      if (pinned && (i === 0 || n.pinned !== notes[i - 1].pinned)) {
        parts.push(el("div", { class: "vn-notes-group", role: "presentation", text: n.pinned ? "Pinned" : "Notes" }));
      }
      parts.push(row(n, i));
    });
    listEl.replaceChildren(...parts);
    listEl.hidden = !parts.length;
    stateEl.replaceChildren(...(state ? [state] : []));
    searchInput.setAttribute("aria-activedescendant", notes.length ? `vn-note-${active}` : "");
  }

  function select(index, scroll = true) {
    if (!notes.length || index === active) return;
    listEl.querySelector(`#vn-note-${active}`)?.setAttribute("aria-selected", "false");
    active = (index + notes.length) % notes.length;
    const rowEl = listEl.querySelector(`#vn-note-${active}`);
    rowEl?.setAttribute("aria-selected", "true");
    searchInput.setAttribute("aria-activedescendant", `vn-note-${active}`);
    if (scroll) rowEl?.scrollIntoView({ block: "nearest" });
  }

  function onSearchKey(event) {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      select(active + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (mod || !notes.length) startNew(query.trim());
      else openNote(notes[active].id);
    }
  }

  function showList({ focus = false } = {}) {
    if (note) leaveNote();
    view = "list";
    if (!panel) return;
    panel.dataset.view = "list";
    hideConflict();
    write(lastKey, "");
    renderList();
    refresh();
    if (focus) searchInput.focus({ preventScroll: true });
  }

  /* -------------------------------------------------------- the editor */

  function showNote() {
    view = "note";
    panel.dataset.view = "note";
    hideConflict();
  }

  const fromServer = (data) => ({
    id: data.id, body: data.body, saved: data.body, version: data.version, pinned: Boolean(data.pinned),
    created_at: data.created_at, updated_at: data.updated_at, source: data.source ?? null,
  });

  async function openNote(id, { focus = true } = {}) {
    if (!id) return;
    build();
    if (!open) setOpen(true);
    if (note?.id === id && view === "note") {
      if (focus) focusView();
      return;
    }
    if (note) leaveNote();
    const summary = notes.find((n) => n.id === id);
    const n = { id, body: "", saved: "", version: 0, pinned: Boolean(summary?.pinned), updated_at: summary?.updated_at ?? 0, loading: true };
    note = n;
    showNote();
    write(lastKey, id);
    setBody("");
    ta.readOnly = true;
    renderPin();
    renderSource();
    setStatus("Opening…");
    try {
      const data = await apiRequest("GET", `${API}/${encodeURIComponent(id)}`);
      if (note !== n) return;
      Object.assign(n, fromServer(data), { loading: false });
      ta.readOnly = false;
      setPreview(prefersPreview);
      setBody(n.body);
      renderPin();
      renderSource();
      setStatus("");
      upsert(data);
      if (focus) {
        focusView();
        ta.setSelectionRange(0, 0);
        scroller.scrollTop = 0;
      }
    } catch (error) {
      if (note !== n) return;
      note = null;
      ta.readOnly = false;
      if (error.status === 404 && error.data) {
        forget(id);
        showToast("That note was deleted.");
      } else {
        showToast(problem(error).title);
      }
      showList({ focus });
    }
  }

  // Back from the panel or the tab: pick up edits made elsewhere, unless
  // this tab has its own still to send.
  async function reloadNote(n) {
    if (n.loading || n.saving || unsaved.has(n) || n.conflict) return;
    try {
      const data = await apiRequest("GET", `${API}/${encodeURIComponent(n.id)}`);
      if (note !== n || unsaved.has(n) || n.saving || data.version === n.version) return;
      Object.assign(n, fromServer(data));
      const [a, b] = [ta.selectionStart, ta.selectionEnd];
      setBody(n.body);
      ta.setSelectionRange(Math.min(a, ta.value.length), Math.min(b, ta.value.length)); // keep the caret
      renderPin();
      renderSource();
      upsert(data);
    } catch (error) {
      if (note === n && error.status === 404 && error.data) showDeleted(n);
    }
  }

  function startNew(text = "") {
    build();
    if (!open) setOpen(true);
    if (note) leaveNote();
    note = { id: null, body: text ? `${text}\n` : "", saved: "", version: 0, pinned: false, updated_at: 0 };
    showNote();
    write(lastKey, "");
    setPreview(false);
    setBody(note.body);
    renderPin();
    renderSource();
    setStatus("New note");
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
    if (text) scheduleSave();
  }

  // Leaving a note (back, another note, closing): send what is left. A note
  // emptied out is deleted, with Undo, rather than kept as a blank row.
  function leaveNote() {
    const n = note;
    note = null;
    clearTimeout(saveTimer);
    if (!n || n.loading) return;
    if (n.id && !n.body.trim() && !n.conflict) {
      removeNote(n, { message: "Deleted the empty note" });
      return;
    }
    save(n);
  }

  function setBody(value) {
    ta.value = value;
    if (note) note.body = value;
    paint();
    if (previewMode) renderPreview();
  }

  function paint() {
    cancelAnimationFrame(paintFrame);
    paintFrame = 0;
    // The trailing space gives a final empty line its height, as the textarea has.
    hl.innerHTML = `${highlight(ta.value)} `;
    ta.scrollTop = 0;
    renderMeta();
  }

  function onInput() {
    if (!note) return;
    note.body = ta.value;
    if (ta.value.length > SYNC_PAINT_LIMIT) paintFrame ||= requestAnimationFrame(paint);
    else paint();
    scheduleSave();
  }

  function renderMeta() {
    if (!note) return;
    const n = words(note.body);
    metaEl.textContent = [`${n} ${n === 1 ? "word" : "words"}`, edited(note.updated_at)].filter(Boolean).join(" · ");
  }

  function renderPin() {
    pinBtn.setAttribute("aria-pressed", String(Boolean(note?.pinned)));
  }

  // A note saved from a chat links back to it (and to the message).
  function renderSource() {
    let url = null;
    try {
      url = note?.source?.url ? new URL(note.source.url) : null;
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
      sourceEl.hidden = true;
      sourceEl.removeAttribute("href");
      return;
    }
    const elsewhere = url.origin !== location.origin;
    sourceEl.href = url.href;
    if (elsewhere) {
      sourceEl.target = "_blank";
      sourceEl.rel = "noopener noreferrer";
    } else {
      sourceEl.removeAttribute("target");
      sourceEl.removeAttribute("rel");
    }
    sourceTitle.textContent = note.source.title || "a chat";
    sourceEl.title = `Open the chat this came from\n${url.href}`;
    sourceEl.hidden = false;
  }

  function onSourceClick(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || sourceEl.target) return;
    event.preventDefault();
    if (note) save(note);
    if (!openChatLink(root, sourceEl.href)) return;
    if (matchMedia("(width <= 767px)").matches) setOpen(false); // the chat is under the panel here
  }

  function setStatus(text, tone = "") {
    if (!status) return;
    if (status.textContent !== text) status.textContent = text;
    status.dataset.tone = tone;
  }

  // Apply one edit as a single undoable step where the browser allows it.
  function edit(change) {
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(change.from, change.to);
    const expected = applyEdit(ta.value, change);
    let done = false;
    try {
      done = document.execCommand("insertText", false, change.insert) && ta.value === expected;
    } catch {
      done = false;
    }
    if (!done) {
      ta.value = expected;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (change.select) ta.setSelectionRange(change.select[0], change.select[1]);
  }

  function onEditorKey(event) {
    if (event.isComposing || event.keyCode === 229) return;
    const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const { selectionStart: a, selectionEnd: b, value } = ta;
    let change = null;
    if (mod && !event.altKey && !event.shiftKey && key === "s") {
      event.preventDefault();
      if (note) save(note);
      return;
    }
    if (mod && !event.altKey && !event.shiftKey && key === "b") change = wrapSelection(value, a, b, "**");
    else if (mod && !event.altKey && !event.shiftKey && key === "i") change = wrapSelection(value, a, b, "_");
    else if (mod && !event.altKey && key === "Enter") change = toggleTaskAt(value, a);
    else if (key === "Enter" && !mod && !event.shiftKey && !event.altKey && a === b) change = continueList(value, a);
    else if (key === "Tab" && !mod && !event.altKey && ((b > a && value.slice(a, b).includes("\n")) || isListLine(value, a))) {
      change = shiftLines(value, a, b, event.shiftKey);
    }
    if (!change) return;
    event.preventDefault();
    edit(change);
  }

  function onPanelKey(event) {
    if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    if (view === "note") showList({ focus: true });
    else if (searchInput.value) {
      searchInput.value = "";
      query = "";
      refresh();
    } else setOpen(false, { focus: true });
  }

  /* ------------------------------------------------------------ saving */

  function scheduleSave() {
    const n = note;
    if (!n || n.loading) return;
    unsaved.add(n);
    clearTimeout(saveTimer);
    if (!n.conflict) setStatus(n.id || n.body.trim() ? "Saving…" : "New note");
    saveTimer = setTimeout(() => save(n), SAVE_DELAY);
  }

  // Send a note's edits. One request per note at a time; edits made while
  // it is out go in the next. Failed saves retry, backing off.
  function save(n, { keepalive = false } = {}) {
    if (!n) return Promise.resolve();
    if (n === note) clearTimeout(saveTimer);
    if (n.saving) {
      n.queued = true;
      return n.saving;
    }
    if (n.loading || n.conflict || n.gone) return Promise.resolve();
    const body = n.body;
    if (n.id ? body === n.saved : !body.trim()) {
      unsaved.delete(n);
      if (n === note && n.id) setStatus("Saved", "quiet");
      return Promise.resolve();
    }
    clearTimeout(n.retryTimer);
    if (n === note) setStatus("Saving…");
    n.saving = (async () => {
      try {
        const data = n.id
          ? await apiRequest("PATCH", `${API}/${encodeURIComponent(n.id)}`, { body, version: n.version }, { keepalive })
          : await apiRequest("POST", API, { body, pinned: n.pinned, ...(n.source ? { source: n.source } : {}) }, { keepalive });
        if (!n.id) total += 1;
        Object.assign(n, { id: data.id, version: data.version, saved: body, created_at: data.created_at, updated_at: data.updated_at });
        n.retryDelay = 0;
        upsert(data);
        if (n === note) {
          write(lastKey, n.id);
          renderMeta();
        }
        if (n.body === n.saved) unsaved.delete(n);
        if (n === note) setStatus(n.body === n.saved ? "Saved" : "Saving…", n.body === n.saved ? "quiet" : "");
      } catch (error) {
        if (error.status === 409 && error.data?.note) conflict(n, error.data.note);
        else if (error.status === 404 && error.data && n.id) showDeleted(n);
        else if (error.status === 413 || error.status === 400) {
          // Refused, not failed: trying again would get the same answer. The
          // next edit tries again.
          if (n === note) setStatus(error.status === 413 ? "Too long to save" : "Not saved", "warn");
        } else {
          n.retryDelay = Math.min(30_000, (n.retryDelay || 1000) * 2);
          if (n === note) setStatus(error.status === 0 ? "Offline · will retry" : "Not saved · retrying", "warn");
          n.retryTimer = setTimeout(() => save(n), n.retryDelay);
        }
      }
    })().finally(() => {
      n.saving = null;
      if (n.queued) {
        n.queued = false;
        save(n);
      }
    });
    return n.saving;
  }

  function flushAll({ keepalive = false } = {}) {
    if (note) unsaved.add(note);
    for (const n of unsaved) save(n, { keepalive });
  }

  function conflict(n, server) {
    if (server.body === n.body) {
      Object.assign(n, fromServer(server));
      unsaved.delete(n);
      if (n === note) setStatus("Saved", "quiet");
      return;
    }
    n.conflict = server;
    if (n !== note) return; // kept for when it is opened again
    setStatus("Changed elsewhere", "warn");
    showConflict("This note changed in another tab or agent.", [
      ["Keep mine", () => {
        n.version = server.version;
        n.conflict = null;
        hideConflict();
        save(n);
      }],
      ["Load theirs", () => {
        Object.assign(n, fromServer(server));
        n.conflict = null;
        unsaved.delete(n);
        hideConflict();
        setBody(n.body);
        renderPin();
        renderSource();
        setStatus("Saved", "quiet");
      }],
    ]);
  }

  function showDeleted(n) {
    n.gone = true;
    if (n !== note) return;
    setStatus("Deleted elsewhere", "warn");
    showConflict("This note was deleted in another tab or agent.", [
      ["Keep as a new note", () => {
        Object.assign(n, { id: null, version: 0, saved: "", gone: false });
        hideConflict();
        save(n);
      }],
      ["Discard", () => {
        unsaved.delete(n);
        hideConflict();
        note = null;
        showList({ focus: true });
      }],
    ]);
  }

  function showConflict(message, actions) {
    conflictBar.replaceChildren(
      el("span", { class: "vn-note-conflict-text", text: message }),
      ...actions.map(([label, run]) => {
        const b = el("button", { type: "button", class: "vn-notes-action", text: label });
        b.addEventListener("click", run);
        return b;
      }),
    );
    conflictBar.hidden = false;
  }

  function hideConflict() {
    if (conflictBar) conflictBar.hidden = true;
  }

  /* ----------------------------------------------- pin, preview, actions */

  async function togglePin() {
    const n = note;
    if (!n || n.loading) return;
    n.pinned = !n.pinned;
    renderPin();
    if (!n.id) return; // sent when the note is created
    await save(n);
    if (!n.id || n.conflict || n.gone) return;
    try {
      const data = await apiRequest("PATCH", `${API}/${encodeURIComponent(n.id)}`, { pinned: n.pinned, version: n.version });
      n.version = data.version;
      upsert(data);
    } catch (error) {
      if (error.status === 409 && error.data?.note) {
        n.version = error.data.note.version; // pinning is not worth a conflict: try once more
        try {
          const data = await apiRequest("PATCH", `${API}/${encodeURIComponent(n.id)}`, { pinned: n.pinned, version: n.version });
          n.version = data.version;
          upsert(data);
          return;
        } catch {}
      }
      n.pinned = !n.pinned;
      if (n === note) {
        renderPin();
        setStatus("Couldn't pin", "warn");
      }
    }
  }

  function setPreview(on, { remember = false, focus = false } = {}) {
    previewMode = on;
    if (remember) {
      prefersPreview = on;
      write(KEYS.notesPreview, on ? "1" : "0");
    }
    if (!panel) return;
    previewBtn.setAttribute("aria-pressed", String(on));
    editorBox.hidden = on;
    preview.hidden = !on;
    if (on) renderPreview();
    else paint();
    if (focus) (on ? previewBtn : ta).focus({ preventScroll: true });
  }

  function renderPreview() {
    preview.innerHTML = renderMarkdown(note?.body ?? "") || '<p class="vn-note-empty">Nothing to preview yet.</p>';
  }

  function onPreviewClick(event) {
    const box = event.target.closest('input[type="checkbox"][data-line]');
    if (!box || !note || note.loading) return;
    const change = toggleTask(note.body, Number(box.dataset.line));
    if (!change) return;
    setBody(applyEdit(note.body, change));
    scheduleSave();
  }

  async function copyNote() {
    if (!note) return;
    try {
      await navigator.clipboard.writeText(note.body);
      flash("Copied");
    } catch {
      flash("Couldn't copy");
    }
  }

  function insertNote() {
    const body = note?.body.trim();
    if (!body) return;
    const draft = composerText(root).replace(/\s+$/, "");
    if (!setComposerText(root, draft ? `${draft}\n\n${body}` : body)) {
      flash("No message box here");
      return;
    }
    if (matchMedia("(width <= 767px)").matches) setOpen(false);
  }

  function flash(text) {
    setStatus(text, "quiet");
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => {
      if (status.textContent === text) setStatus("");
    }, 1600);
  }

  async function deleteNote() {
    const n = note;
    if (!n || n.loading) return;
    note = null;
    clearTimeout(saveTimer);
    showList({ focus: true });
    await n.saving; // a first save still out gives the note its id
    if (!n.id) {
      unsaved.delete(n);
      return;
    }
    await removeNote(n, {});
  }

  async function removeNote(n, { message }) {
    unsaved.delete(n);
    clearTimeout(n.retryTimer);
    if (n.body !== n.saved && n.body.trim()) await save(n); // Undo brings back what was typed
    await n.saving;
    try {
      await apiRequest("DELETE", `${API}/${encodeURIComponent(n.id)}`);
    } catch (error) {
      if (!(error.status === 404 && error.data)) {
        showToast(problem(error).title === "Offline" ? "Offline: the note was not deleted." : "Couldn't delete the note.");
        return;
      }
    }
    forget(n.id);
    renderList();
    const title = noteText(n.saved).title || "Untitled";
    showToast(message ?? `Deleted “${title}”`, "Undo", async () => {
      try {
        upsert(await apiRequest("POST", `${API}/${encodeURIComponent(n.id)}/restore`));
        renderList();
      } catch {
        showToast("Couldn't restore the note.");
      }
    });
  }

  function showToast(message, action, run) {
    if (!toast) return;
    clearTimeout(toastTimer);
    const parts = [el("span", { class: "vn-notes-toast-text", text: message })];
    if (action) {
      const b = el("button", { type: "button", class: "vn-notes-action", text: action });
      b.addEventListener("click", () => {
        hideToast();
        run();
      });
      parts.push(b);
    }
    toast.replaceChildren(...parts);
    toast.hidden = false;
    toastTimer = setTimeout(hideToast, action ? 7000 : 3500);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    if (toast) toast.hidden = true;
  }

  /* ------------------------------------------------------------ resize */

  function setWidth(px) {
    width = Math.round(Math.max(WIDTH.min, Math.min(WIDTH.max, px)));
    html.style.setProperty("--vn-notes-user-w", `${width}px`);
    grip?.setAttribute("aria-valuenow", String(width));
  }

  function onGripDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    html.setAttribute("data-vn-notes-resizing", "");
    const move = (e) => setWidth(window.innerWidth - e.clientX);
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      html.removeAttribute("data-vn-notes-resizing");
      write(KEYS.notesWidth, String(width));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }

  function onGripKey(event) {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowLeft") setWidth(width + step);
    else if (event.key === "ArrowRight") setWidth(width - step);
    else if (event.key === "Home") setWidth(WIDTH.max);
    else if (event.key === "End") setWidth(WIDTH.min);
    else return;
    event.preventDefault();
    write(KEYS.notesWidth, String(width));
  }

  /* --------------------------------------------------------- lifecycle */

  // Coming back to the tab: pick up what changed elsewhere meanwhile.
  const onFocus = () => {
    if (!open) return;
    if (view === "list") refresh();
    else if (note?.id) reloadNote(note);
  };
  const onHidden = () => {
    if (document.hidden) flushAll({ keepalive: true });
  };
  const onPageHide = () => flushAll({ keepalive: true });
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", onPageHide);

  // Open as it was left: the panel, and on this agent the note last open.
  if (read(KEYS.notesOpen, "0") === "1") {
    const last = read(lastKey, "");
    setOpen(true);
    if (last) openNote(last, { focus: false });
  }

  return {
    sync: ensureButton,
    shown: () => open,
    toggle: () => setOpen(!open, { focus: true }),
    openPanel: () => setOpen(true, { focus: true }),
    newNote: (text = "") => startNew(text),
    openNote: (id) => openNote(id),
    // A note made from a chat selection (clip.js). Rejects with a short
    // `reason` the button can show.
    async clip(body, source) {
      try {
        const data = await apiRequest("POST", API, source ? { body, source } : { body });
        available = true;
        if (listState.kind === "ready") {
          total += 1;
          upsert(data);
          renderList();
        }
        return data;
      } catch (error) {
        throw Object.assign(error, { reason: clipProblem(error) });
      }
    },
    // For the launcher (palette.js): known only once the widget has answered.
    items: () => (available ? paletteNotes : []),
    async loadItems() {
      if (!available) return [];
      try {
        const data = await apiRequest("GET", API);
        paletteNotes = Array.isArray(data.notes) ? data.notes : paletteNotes;
      } catch {
        // Keep what the launcher had.
      }
      return paletteNotes;
    },
    dispose() {
      flushAll({ keepalive: true });
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      clearTimeout(saveTimer);
      clearTimeout(searchTimer);
      hideToast();
      cancelAnimationFrame(paintFrame);
      headerSize?.disconnect();
      button?.remove();
      panel?.remove();
      html.removeAttribute("data-vn-notes");
      html.removeAttribute("data-vn-notes-resizing");
      html.style.removeProperty("--vn-notes-user-w");
      html.style.removeProperty("--vn-notes-head-h");
    },
  };
}
