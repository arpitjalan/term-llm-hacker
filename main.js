// Hacker behaviour.
//
// Ground rules: never restructure nodes the app (Preact) owns. We only add
// attributes, append small self-contained elements, and drive the app's own
// controls (e.g. clicking the real runtime-settings trigger) so app logic and
// state stay the single source of truth.

import {
  KEYS, ACCENTS, NODE_ID, html, reducedMotion, read, write, nodeAccent, normalizeAccent,
  THEMES, DEFAULT_DARK, DEFAULT_LIGHT, themeById, roleColor, applyPalette, clearPalette, glyphUrl,
  setApiPrefix, loadLocalConfig, restoreLocalConfig, NODE_ICONS, NODE_IMAGES,
} from "./util.js";
import { createThread } from "./thread.js";
import { createComposerExtras } from "./composer.js";
import { createPalette } from "./palette.js";
import { createTabNotifier } from "./notify.js";
import { createNodeFavicon } from "./favicon.js";
import { createHome } from "./home.js";
import { createSidebarNav } from "./nav.js";
// The modules above import these. Naming them here too makes the browser
// request every module as soon as main.js arrives, instead of finding these
// one round trip later: on a distant agent that delays the theme by a few
// hundred ms on every switch. tools/ci/source-check.mjs keeps this list whole.
import "./themes.js";
import "./colors.js";
import "./arrivals.js";

const SCHEMES = [
  { id: "system", name: "System" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];

const ICONS = {
  system:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8 20h8M12 16v4"/></svg>',
  light:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  palette:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor"/><circle cx="10.5" cy="7.2" r="1.1" fill="currentColor"/><circle cx="15" cy="7.4" r="1.1" fill="currentColor"/></svg>',
  sparkle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></svg>',
  gear:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  caret:
    '<svg class="vn-chip-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
};

const EFFORT = {
  auto: { label: "Auto", bars: 0 },
  none: { label: "None", bars: 0 },
  minimal: { label: "Minimal", bars: 1 },
  low: { label: "Low", bars: 1 },
  medium: { label: "Medium", bars: 2 },
  high: { label: "High", bars: 3 },
  xhigh: { label: "X-High", bars: 4 },
  max: { label: "Max", bars: 4 },
};

const TYPE_SCALES = [
  { id: "compact", name: "Compact" },
  { id: "comfortable", name: "Comfortable" },
];

// Hyprland's rounding: square by default, Omarchy's 6px when rounded.
const CORNERS = [
  { id: "sharp", name: "Sharp" },
  { id: "rounded", name: "Rounded" },
];

// Appearance is System, Light or Dark, as before; each mode shows its own
// Omarchy theme, so there is a dark theme and a light theme to choose.
function createTheme() {
  const systemDark = matchMedia("(prefers-color-scheme: dark)");
  const accentKey = NODE_ID ? `${KEYS.accent}:${NODE_ID}` : KEYS.accent;
  const saved = (key, mode, fallback) => {
    const theme = themeById(read(key, fallback));
    return theme?.mode === mode ? theme.id : fallback;
  };
  let scheme = read(KEYS.scheme, "system");
  if (!SCHEMES.some((s) => s.id === scheme)) scheme = "system";
  let darkTheme = saved(KEYS.themeDark, "dark", DEFAULT_DARK);
  let lightTheme = saved(KEYS.themeLight, "light", DEFAULT_LIGHT);
  let accent = nodeAccent(NODE_ID);
  let toolbar = read(KEYS.toolbar, "neutral") === "accent" ? "accent" : "neutral";
  let type = read(KEYS.type, "comfortable") === "compact" ? "compact" : "comfortable";
  let corners = read(KEYS.corners, "sharp") === "rounded" ? "rounded" : "sharp";
  // The fetch-style panel on new chats (home.js); on unless switched off.
  let home = read(KEYS.home, "on") !== "off";
  html.setAttribute("data-vn-type", type);
  let switchTimer = 0;
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());

  const resolved = () =>
    scheme === "system" ? (systemDark.matches ? "dark" : "light") : scheme;
  const current = () => themeById(resolved() === "dark" ? darkTheme : lightTheme);

  function apply(animate) {
    if (animate && !reducedMotion.matches) {
      html.setAttribute("data-vn-switching", "");
      clearTimeout(switchTimer);
      switchTimer = setTimeout(() => html.removeAttribute("data-vn-switching"), 240);
    }
    const theme = current();
    applyPalette(theme);
    html.setAttribute("data-vn-theme", theme.id);
    html.setAttribute("data-vn-scheme", theme.mode);
    html.setAttribute("data-vn-accent", accent);
    html.setAttribute("data-vn-corners", corners);
    applyToolbar();
  }

  // Browser chrome colour (installed Chrome/Edge app windows, Android Chrome,
  // Safari's tab bar). The page ships two OS-keyed metas; point both at our
  // colour so an explicit Light/Dark choice wins over the OS setting. Omarchy
  // themes Chromium's toolbar with the theme background, so that is the
  // default; the switch uses the accent instead.
  function toolbarColor() {
    const theme = current();
    return toolbar === "accent" ? roleColor(theme, accent) : theme.colors.background;
  }

  function applyToolbar() {
    let metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    if (!metas.length) {
      const m = document.createElement("meta");
      m.name = "theme-color";
      document.head.append(m);
      metas = [m];
    }
    const color = toolbarColor();
    for (const m of metas) {
      if (!m.hasAttribute("data-vn-original")) {
        m.setAttribute("data-vn-original", m.getAttribute("content") || "");
      }
      if (m.getAttribute("content") !== color) m.setAttribute("content", color);
    }
  }

  const onSystem = () => {
    if (scheme !== "system") return;
    apply(true);
    notify();
  };
  systemDark.addEventListener("change", onSystem);
  apply(false);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get scheme() { return scheme; },
    get accent() { return accent; },
    get resolved() { return resolved(); },
    // The theme on screen, and the one chosen for each mode.
    get theme() { return current(); },
    get darkTheme() { return darkTheme; },
    get lightTheme() { return lightTheme; },
    get toolbar() { return toolbar; },
    get corners() { return corners; },
    setToolbar(next) {
      toolbar = next === "accent" ? "accent" : "neutral";
      write(KEYS.toolbar, toolbar);
      applyToolbar();
      notify();
    },
    setScheme(next) {
      scheme = SCHEMES.some((s) => s.id === next) ? next : "system";
      write(KEYS.scheme, scheme);
      apply(true);
      notify();
    },
    // Choosing a theme shows it now: it becomes its mode's theme, and if the
    // page is showing the other mode, Appearance switches to this one.
    setTheme(id) {
      const theme = themeById(id);
      if (!theme) return;
      if (theme.mode === "dark") {
        darkTheme = theme.id;
        write(KEYS.themeDark, theme.id);
      } else {
        lightTheme = theme.id;
        write(KEYS.themeLight, theme.id);
      }
      if (resolved() !== theme.mode) {
        scheme = theme.mode;
        write(KEYS.scheme, scheme);
      }
      apply(true);
      notify();
    },
    setAccent(next) {
      accent = normalizeAccent(next) ?? "accent";
      write(accentKey, accent);
      apply(true);
      document.dispatchEvent(new CustomEvent("vn:accent-change"));
      notify();
    },
    // A changed local.json arrives after the first paint.
    refreshAccent() {
      const next = nodeAccent(NODE_ID);
      if (next === accent) return;
      accent = next;
      apply(false);
      notify();
    },
    get type() { return type; },
    setType(next) {
      type = next === "compact" ? "compact" : "comfortable";
      write(KEYS.type, type);
      html.setAttribute("data-vn-type", type);
      notify();
    },
    setCorners(next) {
      corners = next === "rounded" ? "rounded" : "sharp";
      write(KEYS.corners, corners);
      apply(true);
      notify();
    },
    get home() { return home; },
    setHome(next) {
      home = Boolean(next);
      write(KEYS.home, home ? "on" : "off");
      notify();
    },
    dispose() {
      listeners.clear();
      systemDark.removeEventListener("change", onSystem);
      clearPalette();
      for (const name of ["data-vn-theme", "data-vn-scheme", "data-vn-accent", "data-vn-corners", "data-vn-type"]) {
        html.removeAttribute(name);
      }
      for (const m of document.querySelectorAll('meta[name="theme-color"][data-vn-original]')) {
        m.setAttribute("content", m.getAttribute("data-vn-original"));
        m.removeAttribute("data-vn-original");
      }
    },
  };
}

/* ------------------------------------------------------- theme popover */

function createThemePicker(theme, mount) {
  let popover = null;
  let backdrop = null;
  let anchor = null;

  function close({ restoreFocus = true } = {}) {
    if (!popover) return;
    const p = popover;
    const b = backdrop;
    popover = null;
    backdrop = null;
    // The exit animation keeps the panel mounted, but dismissal ends its
    // interaction lifetime immediately (including pointer and keyboard focus).
    p.inert = true;
    anchor?.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKey);
    if (restoreFocus) anchor?.focus({ preventScroll: true });
    if (reducedMotion.matches) {
      p.remove();
      b.remove();
      return;
    }
    p.setAttribute("data-leaving", "");
    // Keep the dismissing backdrop as a click shield until the inert panel is
    // gone; otherwise a click on its exit frame can activate the page below.
    b.setAttribute("data-leaving", "");
    setTimeout(() => {
      p.remove();
      b.remove();
    }, 220);
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      close();
    }
  }

  const esc = (text) => String(text).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]);

  // A theme's tile: a tiny terminal in its own colours (see .vn-theme-tile).
  const tileStyle = ({ colors: c }) =>
    `--t-bg:${c.background};--t-fg:${c.foreground};--t-accent:${c.accent};` +
    `--t-c1:${c.green};--t-c2:${c.yellow};--t-c3:${c.magenta};--t-c4:${c.blue}`;

  const segment = (key, label, choices, glyph, extraClass = "") => `
      <span class="vn-popover-label" id="vn-${key}-label">${label}</span>
      <div class="vn-segment${extraClass}" role="radiogroup" aria-labelledby="vn-${key}-label" style="--vn-seg-count:${choices.length};--vn-seg-index:${choices.findIndex((c) => c.id === theme[key])}">
        <span class="vn-segment-thumb" aria-hidden="true"></span>
        ${choices.map((c) => `<button type="button" role="radio" data-${key}="${c.id}" aria-checked="${c.id === theme[key]}">${glyph(c)}<span>${c.name}</span></button>`).join("")}
      </div>`;

  const themeGroup = (mode) => {
    const chosen = mode === "dark" ? theme.darkTheme : theme.lightTheme;
    return `
      <span class="vn-popover-label" id="vn-${mode}-theme-label"${theme.resolved === mode ? " data-active" : ""}>${mode === "dark" ? "Dark theme" : "Light theme"}</span>
      <div class="vn-themes" role="radiogroup" aria-labelledby="vn-${mode}-theme-label" data-mode="${mode}">
        ${THEMES.filter((t) => t.mode === mode).map((t) => `<button type="button" class="vn-theme-tile" role="radio" data-theme="${t.id}" aria-label="${esc(t.name)}" title="${esc(t.name)}" aria-checked="${t.id === chosen}" style="${tileStyle(t)}"></button>`).join("")}
      </div>
      <div class="vn-theme-name" data-mode="${mode}" aria-hidden="true"></div>`;
  };

  function render() {
    popover.innerHTML = `
      ${segment("scheme", "Appearance", SCHEMES, (s) => ICONS[s.id])}
      ${themeGroup("dark")}
      ${themeGroup("light")}
      <span class="vn-popover-label" id="vn-accent-label">Accent</span>
      <div class="vn-swatches" role="radiogroup" aria-labelledby="vn-accent-label">
        ${ACCENTS.map(
          (a) => `<button type="button" class="vn-swatch" role="radio" data-accent="${a.id}" aria-label="${a.name}" title="${a.name}" aria-checked="${a.id === theme.accent}" style="--sw:var(--om-${a.id})"></button>`,
        ).join("")}
      </div>
      <div class="vn-swatch-name" aria-live="polite"></div>
      ${segment("type", "Text size", TYPE_SCALES, (t) => `<span class="vn-type-glyph ${t.id === "compact" ? "vn-type-glyph-sm" : "vn-type-glyph-lg"}" aria-hidden="true">Aa</span>`, " vn-segment-type")}
      ${segment("corners", "Corners", CORNERS, (c) => `<span class="vn-corner-glyph vn-corner-glyph-${c.id}" aria-hidden="true"></span>`, " vn-segment-corners")}
      <div class="vn-popover-divider" aria-hidden="true"></div>
      <button type="button" class="vn-switch-row" role="switch" data-toolbar aria-checked="${theme.toolbar === "accent"}">
        <span class="vn-switch-copy"><span class="vn-switch-title">Tint browser toolbar</span><span class="vn-switch-hint">Use the accent for the window bar</span></span>
        <span class="vn-switch" aria-hidden="true"><span></span></span>
      </button>
      <button type="button" class="vn-switch-row" role="switch" data-home aria-checked="${theme.home}">
        <span class="vn-switch-copy"><span class="vn-switch-title">Home panel</span><span class="vn-switch-hint">Agent, status and theme on new chats</span></span>
        <span class="vn-switch" aria-hidden="true"><span></span></span>
      </button>`;
    showNames();
  }

  // Under each theme group: the chosen theme's name, or the one being
  // pointed at or focused.
  function showNames(preview = null) {
    // A departing panel still gets pointer and focus events; it has no names.
    if (!popover) return;
    for (const mode of ["dark", "light"]) {
      const line = popover.querySelector(`.vn-theme-name[data-mode="${mode}"]`);
      const shown = preview?.mode === mode ? preview : themeById(mode === "dark" ? theme.darkTheme : theme.lightTheme);
      if (line.textContent !== shown.name) line.textContent = shown.name;
    }
    const accentName = ACCENTS.find((a) => a.id === theme.accent)?.name ?? "";
    const swatchName = popover.querySelector(".vn-swatch-name");
    if (swatchName.textContent !== accentName) swatchName.textContent = accentName;
  }

  function updateTabStops() {
    popover.querySelectorAll('[role="radio"]').forEach((radio) => {
      radio.tabIndex = radio.getAttribute("aria-checked") === "true" ? 0 : -1;
    });
  }
  // Update controls in place: palette actions must not replace the focused radio.
  function sync() {
    if (!popover) return;
    for (const [key, choices] of [["scheme", SCHEMES], ["type", TYPE_SCALES], ["corners", CORNERS]]) {
      popover.querySelectorAll(`[data-${key}]`).forEach((button) =>
        button.setAttribute("aria-checked", String(button.dataset[key] === theme[key])),
      );
      popover.querySelector(`[data-${key}]`).closest(".vn-segment").style.setProperty(
        "--vn-seg-index", String(choices.findIndex((choice) => choice.id === theme[key])),
      );
    }
    popover.querySelectorAll("[data-theme]").forEach((button) => {
      const chosen = themeById(button.dataset.theme)?.mode === "dark" ? theme.darkTheme : theme.lightTheme;
      button.setAttribute("aria-checked", String(button.dataset.theme === chosen));
    });
    for (const mode of ["dark", "light"]) {
      popover.querySelector(`#vn-${mode}-theme-label`).toggleAttribute("data-active", theme.resolved === mode);
    }
    popover.querySelectorAll("[data-accent]").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.accent === theme.accent));
    });
    showNames();
    popover.querySelector("[data-toolbar]").setAttribute("aria-checked", String(theme.toolbar === "accent"));
    popover.querySelector("[data-home]").setAttribute("aria-checked", String(theme.home));
    updateTabStops();
  }
  const unsubscribe = theme.subscribe(sync);

  function position() {
    if (!popover || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = popover.offsetWidth || 268;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
    const top = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - popover.offsetHeight - 8));
    popover.style.top = `${Math.round(top)}px`;
    popover.style.left = `${Math.round(left)}px`;
  }

  function open(button) {
    if (popover) return close();
    anchor = button;
    backdrop = document.createElement("div");
    backdrop.className = "vn-popover-backdrop";
    backdrop.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      close();
    });
    popover = document.createElement("div");
    popover.className = "vn-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Appearance");
    render();
    updateTabStops();
    popover.addEventListener("click", (event) => {
      const schemeBtn = event.target.closest("[data-scheme]");
      const themeBtn = event.target.closest("[data-theme]");
      const accentBtn = event.target.closest("[data-accent]");
      const toolbarBtn = event.target.closest("[data-toolbar]");
      const homeBtn = event.target.closest("[data-home]");
      const typeBtn = event.target.closest("[data-type]");
      const cornersBtn = event.target.closest("[data-corners]");
      if (typeBtn) {
        theme.setType(typeBtn.dataset.type);
      } else if (cornersBtn) {
        theme.setCorners(cornersBtn.dataset.corners);
      } else if (toolbarBtn) {
        theme.setToolbar(theme.toolbar === "accent" ? "neutral" : "accent");
      } else if (homeBtn) {
        theme.setHome(!theme.home);
      } else if (schemeBtn) {
        theme.setScheme(schemeBtn.dataset.scheme);
      } else if (themeBtn) {
        theme.setTheme(themeBtn.dataset.theme);
      } else if (accentBtn) {
        theme.setAccent(accentBtn.dataset.accent);
      }
      updateTabStops();
    });
    // Point at (or tab to) a theme to read its name.
    const previewName = (event) => {
      const tile = event.target.closest?.("[data-theme]");
      showNames(tile ? themeById(tile.dataset.theme) : null);
    };
    popover.addEventListener("pointerover", previewName);
    popover.addEventListener("focusin", previewName);
    popover.addEventListener("pointerleave", () => showNames());
    // Arrow keys select within each radio group; Tab visits only its checked radio.
    popover.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const group = event.target.closest('[role="radiogroup"]');
      if (!group) return;
      const items = [...group.querySelectorAll('[role="radio"]')];
      const i = items.indexOf(event.target);
      if (i < 0) return;
      event.preventDefault();
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      const next = items[(i + (forward ? 1 : -1) + items.length) % items.length];
      next.focus();
      next.click();
    });
    mount.append(backdrop, popover);
    position();
    button.setAttribute("aria-expanded", "true");
    // Foreground dialogs handle Escape before the underlying picker sees it.
    document.addEventListener("keydown", onKey);
    popover.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
  }

  function ensureButton(root) {
    const row = root.querySelector(".main-header .header-controls-row");
    if (!row || row.querySelector(":scope > .vn-theme-btn")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vn-theme-btn";
    button.setAttribute("aria-label", "Appearance and accent color");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.title = "Appearance";
    button.innerHTML = ICONS.palette;
    button.addEventListener("click", () => open(button));
    row.append(button);
  }

  function onResize() {
    position();
    const focused = document.activeElement;
    if (!popover || !popover.contains(focused)) return;
    // Resizing does not refocus a control, so native focus scrolling will not
    // reveal it when the panel becomes shorter. Scroll only this panel and
    // retain the same focused node, leaving room for its focus outline.
    const panelRect = popover.getBoundingClientRect();
    const controlRect = focused.getBoundingClientRect();
    const top = panelRect.top + popover.clientTop + 4;
    const bottom = panelRect.top + popover.clientTop + popover.clientHeight - 4;
    if (controlRect.bottom > bottom) {
      popover.scrollTop += controlRect.bottom - bottom;
    } else if (controlRect.top < top) {
      popover.scrollTop -= top - controlRect.top;
    }
  }

  window.addEventListener("resize", onResize);

  return {
    ensureButton,
    dispose() {
      unsubscribe();
      close({ restoreFocus: false });
      window.removeEventListener("resize", onResize);
      document.querySelectorAll(".vn-theme-btn").forEach((b) => b.remove());
    },
  };
}

/* ----------------------------------------------------- composer toolbar */

function createComposerBar(root) {
  let bar = null;
  let chip = null;
  let lastKey = "";
  let flashTimer = 0;

  const headerTrigger = () =>
    root.querySelector(".header-stats .model-chip-primary .chip-trigger");

  function build() {
    bar = document.createElement("div");
    bar.className = "vn-composer-bar";

    // One chip for the one popover: "✦ opus · ▂▄▆ High ⌄".
    chip = document.createElement("button");
    chip.type = "button";
    chip.className = "vn-chip vn-chip-runtime";
    chip.setAttribute("aria-haspopup", "dialog");
    chip.innerHTML =
      `<span class="vn-chip-mark" aria-hidden="true">${ICONS.sparkle}</span>` +
      '<span class="vn-chip-label vn-chip-model-label"></span>' +
      '<span class="vn-chip-sep" aria-hidden="true"></span>' +
      '<span class="vn-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
      `<span class="vn-chip-label vn-chip-effort-label"></span>${ICONS.caret}`;
    chip.addEventListener("click", openRuntime);
    bar.append(chip);
  }

  function openRuntime() {
    const trigger = headerTrigger();
    if (!trigger || trigger.disabled) return;
    const box = chip.closest(".composer-box") || chip;
    const chipRect = chip.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - 320, chipRect.left - 4));
    html.style.setProperty("--vn-pop-left", `${Math.round(left)}px`);
    html.style.setProperty("--vn-pop-bottom", `${Math.round(window.innerHeight - boxRect.top + 8)}px`);
    trigger.click();
  }

  function sync() {
    const box = root.querySelector(".composer .composer-box");
    const trigger = headerTrigger();
    if (!box || !trigger) {
      bar?.remove();
      html.removeAttribute("data-vn-composer-bar");
      return;
    }
    if (!bar) build();
    if (bar.parentElement !== box) box.append(bar);
    html.setAttribute("data-vn-composer-bar", "");
    html.setAttribute("data-vn-runtime-anchor", "");

    const model = trigger.querySelector(".chip-label")?.textContent.trim() || "Auto";
    const level = trigger.getAttribute("data-effort-level") || "auto";
    const effort = EFFORT[level] ?? { label: level, bars: 2 };
    const disabled = trigger.disabled || trigger.getAttribute("aria-disabled") === "true";
    const expanded = trigger.getAttribute("aria-expanded") || "false";

    const modelLabel = chip.querySelector(".vn-chip-model-label");
    if (modelLabel.textContent !== model) modelLabel.textContent = model;
    const effortLabel = chip.querySelector(".vn-chip-effort-label");
    const effortText = level === "auto" ? "Auto effort" : effort.label;
    if (effortLabel.textContent !== effortText) effortLabel.textContent = effortText;
    chip.querySelectorAll(".vn-meter i").forEach((b, i) => b.classList.toggle("on", i < effort.bars));

    // Flash when the runtime actually changes (not on first render).
    const key = `${model}|${level}`;
    if (lastKey && key !== lastKey && !reducedMotion.matches) {
      chip.removeAttribute("data-vn-changed");
      void chip.offsetWidth;
      chip.setAttribute("data-vn-changed", "");
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => chip.removeAttribute("data-vn-changed"), 800);
    }
    lastKey = key;

    chip.setAttribute("aria-label", `Model ${model}, effort ${effort.label}. Change model and effort`);
    chip.title = disabled ? "Locked while a reply is running" : "Model and effort";
    chip.disabled = disabled;
    if (chip.getAttribute("aria-expanded") !== expanded) chip.setAttribute("aria-expanded", expanded);
  }

  return {
    sync,
    dispose() {
      bar?.remove();
      html.removeAttribute("data-vn-composer-bar");
      html.removeAttribute("data-vn-runtime-anchor");
    },
  };
}

/* --------------------------------------------------- floating composer */

function createFloatingComposer(root) {
  let main = null;
  let composer = null;
  const ro = typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver(() => measure());

  function measure() {
    if (!main || !composer) return;
    main.style.setProperty("--vn-composer-h", `${Math.ceil(composer.offsetHeight)}px`);
  }

  function sync() {
    if (!ro) return;
    const nextMain = root.querySelector("main.main");
    const nextComposer = nextMain?.querySelector(":scope > .composer");
    if (nextMain === main && nextComposer === composer) return;
    if (composer) ro.unobserve(composer);
    main?.removeAttribute("data-vn-float");
    main = nextMain;
    composer = nextComposer;
    if (!main || !composer) return;
    // Stay pinned to the bottom if we were there before the layout change.
    const scroller = main.querySelector(":scope > .chat-scroll");
    const atBottom = scroller
      ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 8
      : false;
    measure();
    main.setAttribute("data-vn-float", "");
    ro.observe(composer);
    if (scroller && atBottom) scroller.scrollTop = scroller.scrollHeight;
  }

  return {
    sync,
    dispose() {
      ro?.disconnect();
      main?.removeAttribute("data-vn-float");
      main?.style.removeProperty("--vn-composer-h");
    },
  };
}

/* --------------------------------------------------- hub agents section */

// Gives each Hub agent a tile: its accent role, with a glyph guessed from its
// name (or set in local.json) cut out of it.
function createAgentSection(root) {
  const KINDS = [
    [/local|mac|laptop|book/i, "laptop"],
    [/cloud|droplet|vps|aws|gcp|\bdo\b/i, "cloud"],
    [/\bdv\b|^dv-|docker|container|box/i, "box"],
    [/assist|bot|\bai\b|llm|claude|gpt|copilot|agent/i, "sparkle"],
    [/home|lab|nas|\bpi\b|raspberry/i, "home"],
    [/server|prod|srv|node|host/i, "server"],
  ];

  function initials(name) {
    const parts = name.split(/[\s_-]+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
    return letters.toUpperCase();
  }

  // Monogram tiles show initials. The tile may be an <svg>, which can't host
  // text through ::before, so the letters become the same kind of image the
  // other glyphs are: a shape style.css cuts out of the tile.
  function monogramGlyph(letters) {
    const text = letters.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 22'><text x='11' y='11.5' text-anchor='middle' dominant-baseline='central' fill='white' ` +
      `font-family='ui-monospace,SF Mono,Menlo,monospace' font-size='9.5' font-weight='800'>${text}</text></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }

  function decorate(link) {
    const nameEl = link.querySelector(".hub-agent-name");
    const icon = link.querySelector(".hub-agent-icon");
    if (!nameEl || !icon) return;
    const name = nameEl.textContent.trim();
    if (icon.dataset.vnName === name) return;
    const id = link.closest(".hub-agent-row")?.dataset.reorderId;
    const image = NODE_IMAGES[id] ?? NODE_IMAGES[name];
    const kind = image ? "image" : NODE_ICONS[id] ?? NODE_ICONS[name] ?? KINDS.find(([re]) => re.test(name))?.[1] ?? "monogram";
    icon.dataset.vnName = name;
    icon.dataset.vnKind = kind;
    icon.dataset.vnInitials = initials(name);
    const glyph = kind === "image" ? image : kind === "monogram" ? monogramGlyph(icon.dataset.vnInitials) : glyphUrl(kind);
    if (glyph) icon.style.setProperty("--vn-glyph", glyph);
    else icon.style.removeProperty("--vn-glyph");
    if (!link.title) link.title = name;
  }

  // Tile colour = the accent role that agent's own chat uses (same lookup the
  // node runs for itself), as this theme paints it: the custom property
  // follows theme switches by itself.
  function paintTile(link) {
    const icon = link.querySelector(".hub-agent-icon");
    const id = link.closest(".hub-agent-row")?.dataset.reorderId;
    if (!icon || !id) return;
    const accentId = nodeAccent(id);
    if (icon.dataset.vnAccent === accentId) return;
    icon.dataset.vnAccent = accentId;
    icon.style.setProperty("--vn-tile", `var(--om-${accentId})`);
  }

  function sync() {
    for (const link of root.querySelectorAll(".hub-agent-group .hub-agent-link")) {
      decorate(link);
      paintTile(link);
    }
  }

  // A changed local.json: work out every tile's glyph again.
  function refresh() {
    for (const icon of root.querySelectorAll(".hub-agent-group .hub-agent-icon")) delete icon.dataset.vnName;
    sync();
  }

  // Repaint when this node's accent changes, or another tab/node changes its.
  const onAccent = () => sync();
  const onStorage = (event) => {
    if (!event.key || event.key.startsWith(KEYS.accent)) sync();
  };
  document.addEventListener("vn:accent-change", onAccent);
  window.addEventListener("storage", onStorage);

  return {
    sync,
    refresh,
    dispose() {
      document.removeEventListener("vn:accent-change", onAccent);
      window.removeEventListener("storage", onStorage);
    },
  };
}

/* ------------------------------------------------------ sidebar footer */

// Settings move to the foot of the sidebar, as the personal assistant has
// them, beside the node (under a Hub) or term-llm. The row drives the app's own settings
// button, which stays in the DOM, hidden from the header (style.css).
function createSidebarFoot(root) {
  let foot = null;

  function build() {
    foot = document.createElement("div");
    foot.className = "vn-sidebar-foot";
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "vn-sidebar-foot-btn";
    settings.innerHTML = `${ICONS.gear}<span>Settings</span>`;
    settings.addEventListener("click", () => root.querySelector("#settingsBtn")?.click());
    const label = document.createElement("span");
    label.className = "vn-sidebar-foot-label";
    label.textContent = NODE_ID || "term-llm";
    foot.append(settings, label);
  }

  function sync() {
    const panel = root.querySelector(".sidebar .sidebar-panel");
    if (!panel || !root.querySelector("#settingsBtn")) {
      foot?.remove();
      return;
    }
    if (!foot) build();
    if (foot.parentElement !== panel || foot !== panel.lastElementChild) panel.append(foot);
  }

  return {
    sync,
    dispose() {
      foot?.remove();
    },
  };
}

/* ----------------------------------------------------------- activate */

export async function activate(api) {
  const root = api.root || document.getElementById("root");
  const mount = api.mount || document.body;
  setApiPrefix(api.getContext?.().prefix ?? "");
  // Paint the saved theme, with the kept local.json's accent, straight away:
  // until then the stylesheet's default palette shows. The current local.json
  // loads meanwhile, and the UI is built without waiting for it.
  restoreLocalConfig();
  const theme = createTheme();
  const localConfig = loadLocalConfig();

  const picker = createThemePicker(theme, mount);
  const bar = createComposerBar(root);
  const floating = createFloatingComposer(root);
  const agents = createAgentSection(root);
  const thread = createThread(root);
  const extras = createComposerExtras(root, api);
  const foot = createSidebarFoot(root);
  const nav = createSidebarNav(root);
  const palette = createPalette(root, { theme, thread, nav });
  const notifier = createTabNotifier(root);
  const favicon = createNodeFavicon(root);
  const home = createHome(root, { theme });

  // Whole-UI pass: idempotent and cheap per call, but it walks the thread,
  // so it is throttled while a reply streams (see the observer below).
  function tick() {
    agents.sync();
    foot.sync();
    nav.sync();
    favicon.sync();
    picker.ensureButton(root);
    bar.sync();
    floating.sync();
    extras.sync();
    thread.sync();
    home.sync();
    palette.sync();
    watchTrigger();
  }

  // Mutations inside the transcript are frequent while streaming. New nodes
  // there are decorated directly; the full pass runs at most every 250ms.
  // Anything outside the transcript gets the full pass on the next frame.
  const pending = new Set();
  let frame = 0;
  let fullSoon = false;
  let lastFull = 0;
  let throttle = 0;

  function flush() {
    frame = 0;
    for (const n of pending) if (n.isConnected) thread.process(n);
    pending.clear();
    const now = performance.now();
    if (fullSoon || now - lastFull > 250) {
      fullSoon = false;
      lastFull = now;
      tick();
    } else if (!throttle) {
      throttle = setTimeout(() => {
        throttle = 0;
        lastFull = performance.now();
        tick();
      }, 250);
    }
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType === 1) pending.add(n);
      }
      const t = r.target;
      if (!(t instanceof Element) || !t.closest(".messages")) fullSoon = true;
    }
    frame ||= requestAnimationFrame(flush);
  });

  // Attribute changes on the runtime trigger (label, effort, lock state).
  const attrObserver = new MutationObserver(() => bar.sync());
  let watchedTrigger = null;
  const watchTrigger = () => {
    const t = root.querySelector(".header-stats .model-chip-primary .chip-trigger");
    if (t === watchedTrigger) return;
    attrObserver.disconnect();
    watchedTrigger = t;
    if (t) {
      attrObserver.observe(t, {
        attributes: true,
        attributeFilter: ["aria-expanded", "data-effort-level", "disabled", "aria-label"],
        characterData: true,
        subtree: true,
      });
    }
  };

  thread.process(root);
  tick();
  observer.observe(document.body, { childList: true, subtree: true });

  let disposed = false;
  localConfig.then((changed) => {
    if (!changed || disposed) return;
    theme.refreshAccent();
    agents.refresh();
    tick();
  });

  return () => {
    disposed = true;
    observer.disconnect();
    attrObserver.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(throttle);
    foot.dispose();
    nav.dispose();
    agents.dispose();
    picker.dispose();
    bar.dispose();
    floating.dispose();
    thread.dispose();
    extras.dispose();
    palette.dispose();
    notifier.dispose();
    favicon.dispose();
    home.dispose();
    theme.dispose();
  };
}
