// Notes from the chat: select text in the conversation and a small button
// offers to save it as a note. The note keeps what was selected as Markdown
// (code blocks, lists, links; markdown.js toMarkdown()), each message's part
// labelled by who wrote it when the selection spans several, and a link back
// to the chat and the message it starts at (<chat>#message-<id>). Following
// that link brings the message into view, in place when the chat is on this
// agent, after a full load otherwise.
//
// Nothing is requested until the button is pressed.

import { el, apiBase, reducedMotion } from "./util.js";
import { toMarkdown } from "./markdown.js";

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
// A notebook, a plus at its corner.
const SAVE_ICON = svg('<path d="M14 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v7"/><path d="M8 3v18"/><path d="M19 15v6M16 18h6"/>');
const DONE_ICON = svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>');

const MESSAGE_HASH = /^#message-([\w-]{1,64})$/;
// Page parts that are not what was said.
const CHROME = [
  ".author-byline", ".message-meta", ".usage-line", ".turn-action-panel", ".code-copy-btn", ".visually-hidden",
  ".vn-code-head", ".vn-user-actions", "[aria-hidden='true']",
].join(", ");
// The block a selection end sits in, when the whole selection is one phrase.
const LEAF = "p, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd, figcaption, summary, pre";
const RECORD = "[data-message-id], .tool-group";

const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement ?? null);

// A link or image address as an absolute http(s) or mailto URL.
function absolute(value) {
  try {
    const url = new URL(value, location.href);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------- chat links */

// Bring a message into view once its chat shows it, with a brief mark.
export function revealMessage(root, id, { timeout = 8000 } = {}) {
  const selector = `.messages > [data-durable-id="${CSS.escape(String(id))}"]`;
  return new Promise((resolve) => {
    let observer = null;
    let timer = 0;
    const finish = (found) => {
      observer?.disconnect();
      clearTimeout(timer);
      resolve(found);
    };
    const look = () => {
      const target = root.querySelector(selector);
      // A chat scrolls to its newest message as it loads; go after that.
      if (!target || root.querySelector(".messages[aria-busy='true']")) return false;
      finish(true);
      // Centred, or from its start when it is taller than the chat shows.
      const scroller = target.closest(".chat-scroll");
      const show = (behavior) => target.scrollIntoView({
        block: scroller && target.offsetHeight > scroller.clientHeight * 0.8 ? "start" : "center", behavior,
      });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        target.setAttribute("data-vn-flash", "");
        // Smooth for a short way; a long one is quicker to take in at once.
        const far = !scroller ||
          Math.abs(target.getBoundingClientRect().top - scroller.getBoundingClientRect().top) > scroller.clientHeight * 1.5;
        show(reducedMotion.matches || far ? "auto" : "smooth");
        setTimeout(() => target.removeAttribute("data-vn-flash"), 2200);
        // Late layout (images, code) can still pull the chat to its end once.
        setTimeout(() => {
          const view = target.closest(".chat-scroll")?.getBoundingClientRect();
          const box = target.getBoundingClientRect();
          if (view && (box.bottom < view.top || box.top > view.bottom)) show("auto");
        }, 700);
      }));
      return true;
    };
    if (look()) return;
    observer = new MutationObserver(look);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
    timer = setTimeout(() => finish(false), timeout);
  });
}

// Follow a note's link to its chat: in place for this agent's chats (the
// app follows history), a full load for anything else. False if it is not
// a web link.
export function openChatLink(root, href) {
  let url;
  try {
    url = new URL(href, location.href);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.origin !== location.origin || !url.pathname.startsWith(`${apiBase()}/chat/`)) {
    location.assign(url.href); // another agent: Hacker there reads #message-<id>
    return true;
  }
  if (url.pathname !== location.pathname) {
    history.pushState(null, "", url.pathname);
    dispatchEvent(new PopStateEvent("popstate", { state: null }));
  }
  const id = url.hash.match(MESSAGE_HASH)?.[1];
  if (id) revealMessage(root, id);
  return true;
}

// A chat link opened from elsewhere: show its message, then tidy the address.
export function revealFromAddress(root) {
  const id = location.hash.match(MESSAGE_HASH)?.[1];
  if (!id) return;
  history.replaceState(history.state, "", location.pathname + location.search);
  revealMessage(root, id);
}

/* ------------------------------------------------------- the button */

export function createClipper(root, { mount, notes }) {
  let box = null;
  let saveBtn = null;
  let label = null;
  let openBtn = null;
  let range = null; // what the button saves
  let backward = false;
  let saved = null; // { range, id } once saved
  let busy = false;
  let pressing = false;
  let timer = 0;
  let frame = 0;
  let hideTimer = 0;
  const coarse = matchMedia("(pointer: coarse)");

  function build() {
    if (box) return;
    label = el("span", { class: "vn-clip-label" });
    saveBtn = el("button", { type: "button", class: "vn-clip-save" }, [label]);
    openBtn = el("button", { type: "button", class: "vn-clip-open", text: "Open", hidden: true });
    box = el("div", { class: "vn-clip", hidden: true, "data-state": "idle" }, [saveBtn, openBtn]);
    // Pressing it must not take focus or the selection.
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("pointerdown", () => { pressing = true; });
    box.addEventListener("click", () => { pressing = false; });
    box.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    box.addEventListener("pointerleave", () => { if (saved) hideLater(); });
    saveBtn.addEventListener("click", save);
    openBtn.addEventListener("click", () => {
      const id = saved?.id;
      hide();
      if (id) notes.openNote(id);
    });
    mount.append(box);
  }

  function setState(state, message = "") {
    box.dataset.state = state;
    const text = { idle: "Save note", saving: "Saving…", saved: "Saved to notes", error: message || "Couldn't save" }[state];
    saveBtn.innerHTML = state === "saved" ? DONE_ICON : SAVE_ICON;
    label.textContent = text;
    saveBtn.append(label);
    saveBtn.disabled = state === "saving" || state === "saved";
    saveBtn.setAttribute("aria-label", state === "idle" ? "Save the selection as a note" : state === "error" ? `${text}. Try again` : text);
    saveBtn.title = state === "error" ? "Try again" : "";
    openBtn.hidden = state !== "saved";
  }

  /* --- what is selected */

  // The selection, cut to the conversation, if it holds any of it.
  function selected() {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const messages = root.querySelector(".messages");
    if (!messages) return null;
    const r = sel.getRangeAt(0).cloneRange();
    const all = document.createRange();
    all.selectNodeContents(messages);
    if (r.compareBoundaryPoints(Range.START_TO_START, all) < 0) r.setStart(all.startContainer, all.startOffset);
    if (r.compareBoundaryPoints(Range.END_TO_END, all) > 0) r.setEnd(all.endContainer, all.endOffset);
    if (r.collapsed || !records(r).length || !r.toString().trim()) return null;
    backward = isBackward(sel);
    return r;
  }

  function isBackward(sel) {
    const { anchorNode: a, focusNode: f } = sel;
    if (!a || !f) return false;
    if (a === f) return sel.focusOffset < sel.anchorOffset;
    return Boolean(a.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_PRECEDING);
  }

  const records = (r) => [...(root.querySelector(".messages")?.children ?? [])].filter((c) => c.matches(RECORD) && r.intersectsNode(c));

  function speaker(record) {
    if (record.matches(".message.user")) {
      const name = record.querySelector(":scope > .author-byline > span:not(.author-avatar)")?.textContent.trim();
      return name || "You";
    }
    if (record.matches(".message.assistant")) {
      return root.querySelector('.hub-agent-link[aria-current="true"] .hub-agent-name')?.textContent.trim() || "Assistant";
    }
    return "";
  }

  // The selection as Markdown. One message gives its text; several are
  // each labelled with who wrote them.
  function markdown(r) {
    const options = {
      skip: (n) => !r.intersectsNode(n) || n.matches(CHROME) || n.checkVisibility?.() === false,
      text: (n) => {
        if (!r.intersectsNode(n)) return "";
        const value = n.nodeValue ?? "";
        return value.slice(n === r.startContainer ? r.startOffset : 0, n === r.endContainer ? r.endOffset : value.length);
      },
      url: absolute,
    };
    const parts = records(r);
    if (parts.length === 1) {
      const a = elementOf(r.startContainer)?.closest(LEAF);
      const phrase = a && a === elementOf(r.endContainer)?.closest(LEAF) && parts[0].contains(a) &&
        !(a.matches("li") && a.querySelector(":scope > :is(ul, ol, p, pre, blockquote, table, div)"));
      return toMarkdown(phrase ? a : parts[0], { ...options, inline: Boolean(phrase) });
    }
    return parts.map((record) => {
      const text = toMarkdown(record, options);
      const who = text && speaker(record);
      if (!who) return text;
      // A paragraph takes the name in front; a list or code goes under it.
      return /^(?:[-*+] |\d+[.)] |#{1,6} |>|`{3}|\|)/.test(text) ? `**${who}:**\n${text}` : `**${who}:** ${text}`;
    }).filter(Boolean).join("\n\n");
  }

  // Where it came from: this chat, at the first message selected.
  function source(r) {
    if (!location.pathname.startsWith(`${apiBase()}/chat/`)) return null;
    const id = records(r).find((record) => record.dataset.durableId)?.dataset.durableId;
    const btn = root.querySelector('.sidebar .session-btn[aria-current="page"]') ?? root.querySelector(".sidebar .session-btn.active");
    const title = btn?.getAttribute("title")?.trim() || btn?.querySelector(".session-title")?.textContent.trim() ||
      document.title.split(" · ")[0].trim() || "Chat";
    return { url: `${location.origin}${location.pathname}${id ? `#message-${id}` : ""}`, title };
  }

  /* --- showing it */

  function update() {
    timer = 0;
    if (busy || pressing) return;
    const r = selected();
    if (!r) {
      hide();
      return;
    }
    build();
    range = r;
    const same = saved && saved.range.compareBoundaryPoints(Range.START_TO_START, r) === 0 &&
      saved.range.compareBoundaryPoints(Range.END_TO_END, r) === 0;
    if (!same) {
      saved = null;
      clearTimeout(hideTimer);
      setState("idle");
    }
    if (box.hidden) box.hidden = false;
    place();
  }

  // The character at the selection's moving end, when that is in text.
  function edgeRect() {
    const node = backward ? range.startContainer : range.endContainer;
    const offset = backward ? range.startOffset : range.endOffset;
    if (node.nodeType !== 3 || (backward ? offset >= node.length : offset <= 0)) return null;
    const one = document.createRange();
    one.setStart(node, backward ? offset : offset - 1);
    one.setEnd(node, backward ? offset + 1 : offset);
    const rects = one.getClientRects();
    return rects.length ? rects[backward ? 0 : rects.length - 1] : null;
  }

  // Above the end of the selection (below it on touch screens, where the
  // system's own menu sits above), kept inside the visible chat.
  function place() {
    frame = 0;
    if (!box || box.hidden || !range) return;
    const scroller = root.querySelector(".chat-scroll");
    const area = scroller?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
    const view = { top: Math.max(area.top, 0), bottom: Math.min(area.bottom, innerHeight), left: Math.max(area.left, 0), right: Math.min(area.right, innerWidth) };
    const shown = (r) => r && r.bottom > view.top && r.top < view.bottom;
    let end = edgeRect();
    if (!shown(end)) {
      // The end is out of view (or between blocks): the nearest line that is not.
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0 && shown(r));
      end = rects[backward ? 0 : rects.length - 1] ?? null;
    }
    if (!end) {
      box.style.visibility = "hidden"; // scrolled out of view: back when it returns
      return;
    }
    box.style.visibility = "";
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const x = Math.min(Math.max((backward ? end.left : end.right) - w / 2, view.left + 8), view.right - w - 8);
    let y = coarse.matches ? end.bottom + 12 : end.top - h - 8;
    if (!coarse.matches && y < view.top + 4) y = end.bottom + 8;
    if (coarse.matches && y + h > view.bottom - 4) y = end.top - h - 12;
    y = Math.min(Math.max(y, view.top + 4), view.bottom - h - 4);
    box.style.left = `${Math.round(x)}px`; // not transform: it pops in with one
    box.style.top = `${Math.round(y)}px`;
  }

  function hide() {
    clearTimeout(hideTimer);
    range = null;
    saved = null;
    if (box && !box.hidden) box.hidden = true;
  }

  function hideLater(ms = 2500) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!box?.matches(":hover, :focus-within")) hide();
    }, ms);
  }

  async function save() {
    const r = range;
    if (busy || !r) return;
    let body = "";
    try {
      body = markdown(r).trim();
    } catch {
      body = r.toString().trim(); // never lose the words to a conversion bug
    }
    if (!body) return;
    busy = true;
    setState("saving");
    try {
      const note = await notes.clip(body, source(r));
      saved = { range: r, id: note.id };
      setState("saved");
      hideLater(4000);
    } catch (error) {
      setState("error", error.reason);
    } finally {
      busy = false;
      place();
    }
  }

  /* --- events */

  const schedule = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(update, ms);
  };
  let pointerDown = false;
  const onSelection = () => {
    if (!pointerDown) schedule(coarse.matches ? 320 : 140);
  };
  const onPointerDown = (event) => {
    if (box?.contains(event.target)) return;
    pointerDown = true;
    pressing = false;
    if (box && !box.hidden && !busy) hide(); // a new selection, or a click away
  };
  const onPointerUp = () => {
    if (!pointerDown) return;
    pointerDown = false;
    schedule(10);
  };
  const onKey = (event) => {
    if (event.key === "Escape" && box && !box.hidden && !busy) hide();
  };
  const onMove = () => {
    if (box && !box.hidden) frame ||= requestAnimationFrame(place);
  };
  document.addEventListener("selectionchange", onSelection);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerUp, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("scroll", onMove, { capture: true, passive: true });
  window.addEventListener("resize", onMove);

  return {
    dispose() {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onMove, { capture: true });
      window.removeEventListener("resize", onMove);
      box?.remove();
    },
  };
}
