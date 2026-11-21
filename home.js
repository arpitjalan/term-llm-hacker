// Home: the new-chat screen as Omarchy shows a machine, in the manner of its
// fastfetch screen. A prompt mark beside framed sections whose keys hang off
// tree glyphs (the agent; the workspace with live status and the theme's
// palette), a terminal-prompt headline, and the keys that matter.
//
// Everything here reads what the page already shows (the sidebar's rows and
// their state classes, the runtime chip) and acts through the app's own
// controls, so it never needs an API of its own. The app's heading and
// tagline stay in the DOM, hidden while this panel stands in for them.

import { el, NODE_ID, currentProviderSync, loadProviders } from "./util.js";

// ">_" as pixel art: a chevron and an underscore on a 7 x 5 grid, drawn as
// SVG squares so it stays crisp at any size and in any font.
const LOGO_PIXELS = [
  [0, 0], [1, 0],
  [1, 1], [2, 1],
  [2, 2], [3, 2],
  [1, 3], [2, 3],
  [0, 4], [1, 4], [4, 4], [5, 4], [6, 4],
];
const LOGO = `<svg viewBox="0 0 7 5" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${
  LOGO_PIXELS.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`).join("")}</svg>`;

const LINES = [
  "What are we working on?",
  "What should we build today?",
  "Bring me something to solve.",
  "Ready when you are.",
];

// Section frames, as fastfetch draws them: a rule with the title on it, as
// wide (in characters) as the longest line needs.
const KEY_WIDTH = 12; // "│ ├ " and the longest key
const rule = (title, width) => {
  if (!title) return `└${"─".repeat(width - 2)}┘`;
  const label = ` ${title} `;
  const left = Math.floor((width - 2 - label.length) / 2);
  return `┌${"─".repeat(left)}${label}${"─".repeat(width - 2 - left - label.length)}┐`;
};

// Session states the sidebar marks on its rows, and what they mean here.
const STATES = [
  { key: "waiting", cls: "is-input-required", label: "waiting" },
  { key: "running", cls: "is-active", label: "running" },
  { key: "unread", cls: "is-unseen", label: "unread" },
];

const EFFORTS = { auto: "auto", none: "none", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "x-high", max: "max" };

// One line per page visit, as a terminal greets a new shell.
function pickLine() {
  let n = 0;
  try {
    const key = "term-llm:hacker:home-line";
    const last = Number(sessionStorage.getItem(key));
    if (Number.isInteger(last) && last >= 0) n = (last + 1) % LINES.length;
    sessionStorage.setItem(key, String(n));
  } catch {
    // Storage unavailable: the first line.
  }
  return LINES[n];
}

export function createHome(root, { theme }) {
  const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const line = pickLine();
  let block = null;
  let keys = null;
  let lastKey = "";
  // Row states (running, waiting, unread) arrive as class changes on the
  // sidebar's rows, which add no nodes; watch for them while home shows.
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
    if (sidebar) watcher.observe(sidebar, { attributes: true, attributeFilter: ["class"], subtree: true });
  }

  const text = (sel) => root.querySelector(sel)?.textContent.trim() ?? "";
  const rows = () => [...root.querySelectorAll(".sidebar .session-row")];

  function facts() {
    const all = rows().filter((r) => r.querySelector(".session-title")?.textContent.trim());
    const today = [...root.querySelectorAll(".sidebar .session-group")]
      .find((g) => /^today\b/i.test(g.querySelector(":scope > h3")?.textContent.trim() ?? ""))
      ?.querySelectorAll(":scope > .session-row").length ?? 0;
    const trigger = root.querySelector(".header-stats .model-chip-primary .chip-trigger");
    const provider = currentProviderSync();
    const t = theme.theme;
    return {
      name: text("#sidebarBrandText") || text(".empty-chat > h2") || "term-llm",
      model: [trigger?.querySelector(".chip-label")?.textContent.trim() || "auto", provider?.name].filter(Boolean).join(" · "),
      effort: EFFORTS[trigger?.getAttribute("data-effort-level") || "auto"] ?? trigger?.getAttribute("data-effort-level"),
      chats: all.length ? `${all.length} in the sidebar${today ? ` · ${today} today` : ""}` : "none yet",
      counts: Object.fromEntries(STATES.map((s) => [s.key, all.filter((r) => r.classList.contains(s.cls)).length])),
      theme: t ? `${t.name}${theme.corners === "rounded" ? " · rounded" : ""}` : "",
      node: NODE_ID,
    };
  }

  // The first chat in a given state, opened through its real sidebar row.
  function openFirst(state) {
    const row = rows().find((r) => r.classList.contains(state.cls));
    row?.querySelector(".session-btn")?.click();
  }

  function section(title, tone, entries, width) {
    return el("div", { class: `vn-fetch-section vn-fetch-${tone}`, style: `width:${width}ch` }, [
      el("div", { class: "vn-fetch-rule", "aria-hidden": "true", text: rule(title, width) }),
      el("dl", { class: "vn-fetch-list" }, entries.map(([k, v], i) =>
        el("div", { class: "vn-fetch-row" }, [
          el("dt", {}, [
            el("span", { class: "vn-fetch-tree", "aria-hidden": "true", text: i === entries.length - 1 ? "└ └ " : "│ ├ " }),
            k,
          ]),
          el("dd", {}, [v]),
        ]),
      )),
      el("div", { class: "vn-fetch-rule", "aria-hidden": "true", text: rule("", width) }),
    ]);
  }

  function statusLine(counts) {
    return el("span", { class: "vn-fetch-status" }, STATES.map((s) => {
      const n = counts[s.key];
      const item = el(n ? "button" : "span", {
        class: `vn-fetch-state vn-fetch-state-${s.key}`,
        type: n ? "button" : null,
        title: n ? `Open the first ${s.label} chat` : null,
      }, [el("span", { class: "vn-fetch-dot", "aria-hidden": "true", text: "■" }), ` ${n} ${s.label}`]);
      if (n) item.addEventListener("click", () => openFirst(s));
      return item;
    }));
  }

  function palette() {
    // Omarchy's fastfetch prints the theme's name and a dot in each colour.
    return el("span", { class: "vn-fetch-dots", "aria-hidden": "true" },
      ["fg", "cyan", "magenta", "blue", "yellow", "green", "red", "accent"].map((c) =>
        el("span", { class: `vn-fetch-dot-${c}`, text: "●" })));
  }

  function render(f) {
    // Both frames share one width: the longest line, within reason.
    const status = STATES.map((s) => `■ ${f.counts[s.key]} ${s.label}`).join("   ");
    const longest = Math.max(...[f.name, f.model, f.effort, f.chats, status, `${f.theme} ●●●●●●●●`, f.node ?? ""]
      .map((v) => String(v).length));
    const width = Math.min(64, Math.max(40, KEY_WIDTH + longest + 2));
    const agent = section("agent", "green", [
      ["name", f.name],
      ["model", f.model],
      ["effort", f.effort],
    ], width);
    const workspace = section("workspace", "blue", [
      ["chats", f.chats],
      ["status", statusLine(f.counts)],
      ["theme", el("span", {}, [f.theme, " ", palette()])],
      ...(f.node ? [["node", f.node]] : []),
    ], width);
    block.querySelector(".vn-fetch-info").replaceChildren(agent, workspace);
  }

  function build() {
    // The provider's name comes from the server's provider list, read once.
    loadProviders().then(() => {
      lastKey = "";
      sync();
    });
    block = el("section", { class: "vn-home", "aria-label": "Home" }, [
      el("div", { class: "vn-fetch" }, [
        el("span", { class: "vn-fetch-logo", "aria-hidden": "true", html: LOGO }),
        el("div", { class: "vn-fetch-info" }),
      ]),
      el("h2", { class: "vn-home-line" }, [
        el("span", { class: "vn-home-caret", "aria-hidden": "true", text: "❯ " }),
        line,
        el("span", { class: "vn-home-cursor", "aria-hidden": "true" }),
      ]),
    ]);
    const kbd = (k, label) => el("span", { class: "vn-home-key" }, [el("kbd", { class: "vn-kbd", text: k }), label]);
    keys = el("div", { class: "vn-home-keys", role: "note", "aria-label": "Keyboard shortcuts" }, [
      kbd(mac ? "⌘K" : "Ctrl K", "launcher"),
      kbd("/", "commands"),
      kbd("⏎", "send"),
      kbd(mac ? "⇧⏎" : "Shift ⏎", "new line"),
    ]);
  }

  function sync() {
    // term-llm's personal assistant interface has a home of its own, with
    // live status from the server; this panel stays out of its way there.
    const empty = root.querySelector(".messages > .empty-chat");
    if (!empty || !theme.home || root.querySelector(".personal-bot")) {
      block?.remove();
      keys?.remove();
      lastKey = "";
      watch(null);
      return;
    }
    watch(root.querySelector(".sidebar"));
    if (!block) build();
    if (block.parentElement !== empty) empty.prepend(block);
    if (keys.parentElement !== empty) empty.append(keys);
    const f = facts();
    const key = JSON.stringify(f);
    if (key === lastKey) return;
    lastKey = key;
    render(f);
  }

  const unsubscribe = theme.subscribe(sync);

  return {
    sync,
    dispose() {
      unsubscribe();
      watch(null);
      cancelAnimationFrame(frame);
      block?.remove();
      keys?.remove();
    },
  };
}
