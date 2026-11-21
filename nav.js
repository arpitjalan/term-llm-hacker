// Section links under New chat, as term-llm's personal-assistant sidebar has
// them: Activity, Conversations, Projects, Routines and Widgets.
//
// Each one drives what the app already has. Activity narrows the chat list
// to chats that need you, read from the rows' own state classes; it is a
// filter in CSS, so the app's list is never touched. Conversations and
// Projects press the app's Recent/Projects switch, which is hidden while
// these links stand in for it. Widgets presses the app's own button.
// Routines lists the server's scheduled jobs (term-llm serve jobs), and its
// code loads only when it is first opened.

import { el, html, apiGet } from "./util.js";

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  activity: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  chats: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  projects: svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  routines: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  widgets: svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'),
};

// The states the sidebar marks on its rows: waiting for you, running, unread.
const ATTENTION = ".session-row:is(.is-input-required, .is-active, .is-unseen)";

export function createSidebarNav(root) {
  let nav = null;
  let note = null;
  const items = {};
  let routines = null; // null: not checked yet; false: no jobs here; else a count
  let dialog = null; // the routines dialog, once loaded
  let dialogOpen = false;
  let routineList = []; // for the launcher, loaded when it opens

  // Row states arrive as class changes, which add no nodes; watch for them.
  // Only attributes: the app's own pass (main.js) covers added rows.
  let watched = null;
  let frame = 0;
  const watcher = new MutationObserver(() => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  });
  function watch(sidebar) {
    if (sidebar === watched) return;
    watcher.disconnect();
    watched = sidebar;
    if (sidebar) {
      watcher.observe(sidebar, { attributes: true, attributeFilter: ["class", "aria-selected"], subtree: true });
    }
  }

  const list = () => html.getAttribute("data-vn-list");
  function setList(mode) {
    if (mode) html.setAttribute("data-vn-list", mode);
    else html.removeAttribute("data-vn-list");
    sync();
  }

  // The app's Recent / Projects switch, pressed for real.
  const view = (name) => root.querySelector(name === "projects" ? "#sidebarViewProjects" : "#sidebarViewRecent")?.click();

  async function openRoutines() {
    dialog ??= import("./routines.js").then((m) =>
      m.createRoutines({
        onOpen() {
          dialogOpen = true;
          sync();
        },
        onClose(total) {
          dialogOpen = false;
          if (typeof total === "number") routines = total;
          sync();
        },
      }),
    );
    (await dialog).open(items.routines);
  }

  function item(key, label, onClick) {
    const b = el("button", { type: "button", class: "vn-nav-item", "data-nav": key, html: ICONS[key] }, [
      el("span", { class: "vn-nav-label", text: label }),
      el("span", { class: "vn-nav-count" }),
    ]);
    b.addEventListener("click", onClick);
    items[key] = b;
    return b;
  }

  function build() {
    nav = el("nav", { class: "vn-nav", "aria-label": "Sections" }, [
      item("activity", "Activity", () => setList("activity")),
      item("chats", "Conversations", () => {
        setList(null);
        view("recent");
      }),
      item("projects", "Projects", () => {
        setList(null);
        view("projects");
      }),
      item("routines", "Routines", openRoutines),
      item("widgets", "Widgets", () => root.querySelector("#widgetsOpenBtn")?.click()),
    ]);
    note = el("p", { class: "vn-activity-empty", role: "status", text: "Nothing needs you right now." });
    // Whether this server runs jobs: one small request, once the page is idle.
    const later = window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 3000 }) : (f) => setTimeout(f, 1500);
    later(() =>
      apiGet("/v2/jobs?limit=1&offset=0")
        .then((d) => {
          routines = Number.isFinite(d?.total) ? d.total : false;
        })
        .catch(() => {
          routines = false;
        })
        .finally(sync),
    );
  }

  // Write only what changed: these nodes sit inside observed subtrees.
  function set(node, attr, value) {
    if (value == null || value === false) {
      if (node.hasAttribute(attr)) node.removeAttribute(attr);
    } else if (node.getAttribute(attr) !== String(value)) node.setAttribute(attr, value);
  }
  function count(key, n) {
    const c = items[key].querySelector(".vn-nav-count");
    const text = n ? String(n) : "";
    if (c.textContent !== text) c.textContent = text;
  }

  function sync() {
    // The standard sidebar only; the personal assistant has its own links.
    const actions = root.querySelector(".sidebar .sidebar-actions");
    const content = actions?.closest(".sidebar-content");
    if (!actions || !content) {
      nav?.remove();
      note?.remove();
      watch(null);
      return;
    }
    if (!nav) build();
    if (nav.parentElement !== actions) actions.append(nav);
    watch(root.querySelector(".sidebar"));

    const searching = Boolean(root.querySelector(".sidebar-search-input")?.value);
    const projectsTab = root.querySelector("#sidebarViewProjects");
    const inProjects = projectsTab?.getAttribute("aria-selected") === "true";
    const attention = root.querySelectorAll(`#sessionGroups ${ATTENTION}`).length;
    const mode = list();
    const current = dialogOpen ? "routines" : mode === "activity" ? "activity" : inProjects ? "projects" : "chats";

    set(items.projects, "hidden", !projectsTab);
    set(items.widgets, "hidden", !root.querySelector("#widgetsOpenBtn"));
    set(items.routines, "hidden", typeof routines !== "number");
    for (const [key, b] of Object.entries(items)) set(b, "aria-current", key === current ? "page" : null);
    count("activity", attention);
    count("routines", typeof routines === "number" ? routines : 0);

    // An empty Activity list says so, rather than showing nothing.
    const quiet = mode === "activity" && !searching && attention === 0;
    if (quiet && note.parentElement !== content) content.append(note);
    else if (!quiet && note.parentElement) note.remove();
  }

  // Show the sidebar wherever it is tucked away (collapsed, or the closed
  // drawer on phones), through the app's own buttons.
  function reveal() {
    const sidebar = root.querySelector(".sidebar");
    const menu = root.querySelector("#mobileMenuBtn");
    if (sidebar?.classList.contains("collapsed")) root.querySelector("#sidebarToggleBtn")?.click();
    if (menu?.getClientRects().length && !sidebar?.classList.contains("open")) menu.click();
  }

  return {
    sync,
    // For the launcher (palette.js).
    shown: () => Boolean(nav?.isConnected),
    hasRoutines: () => typeof routines === "number",
    openRoutines,
    showActivity() {
      reveal();
      setList("activity");
    },
    routineItems: () => routineList,
    async loadRoutineItems() {
      if (typeof routines !== "number") return routineList;
      try {
        routineList = await (await import("./routines.js")).listRoutines();
      } catch {
        // Keep what the launcher had.
      }
      return routineList;
    },
    async openRoutine(item) {
      if (!item.sessionId) return openRoutines();
      (await import("./routines.js")).openChat(item.sessionId);
    },
    dispose() {
      watch(null);
      cancelAnimationFrame(frame);
      html.removeAttribute("data-vn-list");
      nav?.remove();
      note?.remove();
      dialog?.then((d) => d.dispose());
    },
  };
}
