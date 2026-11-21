// Shared helpers for Hacker modules.

import { THEMES, DEFAULT_DARK, DEFAULT_LIGHT } from "./themes.js";
import { paletteVars } from "./colors.js";

export { THEMES, DEFAULT_DARK, DEFAULT_LIGHT };

export const KEYS = {
  scheme: "term-llm:hacker:scheme",
  themeDark: "term-llm:hacker:theme-dark",
  themeLight: "term-llm:hacker:theme-light",
  corners: "term-llm:hacker:corners",
  home: "term-llm:hacker:home",
  accent: "term-llm:hacker:accent",
  toolbar: "term-llm:hacker:toolbar",
  type: "term-llm:hacker:type-scale",
  codeWrap: "term-llm:hacker:code-wrap",
  local: "term-llm:hacker:local-json",
};

// Accent roles: the theme's own accent, or one of its palette colours, so the
// accent always belongs to the theme being shown.
export const ACCENTS = [
  { id: "accent", name: "Theme accent" },
  { id: "red", name: "Red" },
  { id: "orange", name: "Orange" },
  { id: "yellow", name: "Yellow" },
  { id: "green", name: "Green" },
  { id: "cyan", name: "Cyan" },
  { id: "blue", name: "Blue" },
  { id: "magenta", name: "Magenta" },
];

// Older accent ids (as found in older local.json files) map onto the nearest
// role.
const ACCENT_ALIASES = { indigo: "accent", graphite: "accent", theme: "accent", pink: "magenta", purple: "magenta" };

export function normalizeAccent(id) {
  const role = ACCENT_ALIASES[id] ?? id;
  return ACCENTS.some((a) => a.id === role) ? role : null;
}

export function themeById(id) {
  return THEMES.find((t) => t.id === id) ?? null;
}

// The colour an accent role has in a theme.
export function roleColor(theme, role) {
  const t = typeof theme === "string" ? themeById(theme) : theme;
  return t?.colors[normalizeAccent(role) ?? "accent"] ?? t?.colors.accent ?? "#7aa2f7";
}

// Paint a theme's palette onto <html> as the --om-* custom properties the
// stylesheet reads (it carries Tokyo Night and Catppuccin Latte itself for
// the moment before this runs).
export function applyPalette(theme) {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(paletteVars(theme.colors))) {
    if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
  }
}

export function clearPalette() {
  const style = document.documentElement.style;
  for (const name of Object.keys(paletteVars(THEMES[0].colors))) style.removeProperty(name);
}

// Optional per-node default accents, keyed by Hub node id, from an untracked
// `local.json` next to this file (see local.example.json). Picking an accent
// in the popover still overrides the default for that node.
export const NODE_ACCENTS = {};

// Optional per-node tile glyphs, keyed by Hub node id or display name, also
// from local.json. Values are glyph names from GLYPHS; anything else is ignored.
export const NODE_ICONS = {};
const GLYPHS = ["laptop", "cloud", "box", "sparkle", "home", "server", "core", "monogram"];

// Tile glyphs, drawn white on transparent: the sidebar cuts them out of the
// tile (a mask, so only their shape counts) and the favicon recolours them.
export const GLYPH_SVGS = {
  laptop: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><rect x='4' y='5' width='16' height='11' rx='2'/><path d='M2 19h20'/></svg>",
  cloud: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.75 4.75 0 0 1-.5 9.5z'/></svg>",
  box: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 3 4 7v10l8 4 8-4V7z'/><path d='m4 7 8 4 8-4M12 11v10'/></svg>",
  sparkle: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'><path d='M12 2.5 14.2 9.8 21.5 12l-7.3 2.2L12 21.5l-2.2-7.3L2.5 12l7.3-2.2z'/></svg>",
  home: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='m3 11 9-7 9 7'/><path d='M5 10v10h14V10'/></svg>",
  core: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='9.5'/><polygon points='12.00,5.40 17.72,15.30 6.28,15.30'/><circle cx='12' cy='12' r='1.8' fill='white' stroke='none'/></svg>",
  server: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><rect x='4' y='4' width='16' height='7' rx='2'/><rect x='4' y='13' width='16' height='7' rx='2'/><path d='M8 7.5h.01M8 16.5h.01'/></svg>",
};

// A glyph as a CSS url(), or null for kinds drawn another way.
export function glyphUrl(kind) {
  const svg = GLYPH_SVGS[kind];
  return svg ? `url("data:image/svg+xml,${encodeURIComponent(svg)}")` : null;
}

// Optional per-node tile pictures, keyed by Hub node id or display name, also
// from local.json. Values are image paths relative to this extension (put the
// files in an untracked local/ folder; install.sh copies it) or data:image URIs.
// A picture replaces the glyph and wins over nodeIcons.
export const NODE_IMAGES = {};

function applyLocalConfig(cfg) {
  for (const map of [NODE_ACCENTS, NODE_ICONS, NODE_IMAGES]) {
    for (const key of Object.keys(map)) delete map[key];
  }
  // Anything that isn't an object (missing, null, a typo) counts as empty.
  const entries = (value) => Object.entries(value && typeof value === "object" ? value : {});
  for (const [key, role] of entries(cfg?.nodeAccents)) NODE_ACCENTS[key] = role;
  for (const [key, glyph] of entries(cfg?.nodeIcons)) if (GLYPHS.includes(glyph)) NODE_ICONS[key] = glyph;
  for (const [key, src] of entries(cfg?.nodeImages)) {
    if (typeof src !== "string") continue;
    // Same-origin files or inline images only: nothing is fetched from elsewhere.
    const url = /^data:image\//.test(src) ? src : /^[\w./-]+$/.test(src) && !src.includes("..") ? new URL(src, import.meta.url).href : null;
    if (url) NODE_IMAGES[key] = `url("${url.replace(/"/g, "%22")}")`;
  }
}

// Fetching local.json costs a round trip on every page load, and switching
// agents is a page load. So the copy from the last visit is kept and applied
// straight away, and loadLocalConfig() swaps in the current one. Hub nodes
// usually share a local.json, so they share the kept copy too. Large ones
// (inline pictures) aren't kept, to leave the app its share of localStorage.
const LOCAL_KEEP_MAX = 64 * 1024;

export function restoreLocalConfig() {
  try {
    applyLocalConfig(JSON.parse(read(KEYS.local, "null")));
  } catch {
    // A damaged copy: built-in defaults until loadLocalConfig() replaces it.
  }
}

// Resolves true when local.json differs from the kept copy, so the caller can
// repaint what depends on it.
export async function loadLocalConfig() {
  let res;
  try {
    res = await fetch(new URL("./local.json", import.meta.url), { credentials: "same-origin" });
  } catch {
    return false; // Offline: the kept copy stays.
  }
  // No local.json (the normal case), or one that doesn't parse: built-in defaults.
  const cfg = res.ok ? await res.json().catch(() => null) : null;
  const text = JSON.stringify(cfg);
  if (text === read(KEYS.local, "null")) return false;
  write(KEYS.local, text.length <= LOCAL_KEEP_MAX ? text : "null");
  applyLocalConfig(cfg);
  return true;
}

// Every node shares the Hub's origin, and so its localStorage; the node id in
// /node/<id>/ is what tells them apart. Direct (non-Hub) visits get null.
// A Hub serves each node under .../node/<id>/, at its root or below its own
// base path (e.g. /hub/node/<id>/).
export const NODE_ID = location.pathname.match(/^(?:\/[^/]+)*?\/node\/([^/]+)\//)?.[1] ?? null;

export const html = document.documentElement;
export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

export function read(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: settings last for this page only.
  }
}

// The accent role a node actually shows. Shared with the sidebar's agent
// tiles: all Hub nodes share one origin, so any node can read every node's
// choice.
export function nodeAccent(nodeId) {
  const own = nodeId ? normalizeAccent(read(`${KEYS.accent}:${nodeId}`, null)) : null;
  return own ?? normalizeAccent(NODE_ACCENTS[nodeId]) ?? normalizeAccent(read(KEYS.accent, null)) ?? "accent";
}

// The app suffixes its own storage keys with ":<nodeId>" under the Hub.
function appKey(base) {
  return NODE_ID ? `${base}:${NODE_ID}` : base;
}

/* ----------------------------------------------------- app API access */

let apiPrefix = "";

export function setApiPrefix(prefix) {
  apiPrefix = (prefix || "").replace(/\/+$/, "");
}

// The node's base path, which its routes (e.g. /chat/<id>) hang off.
export function apiBase() {
  return apiPrefix;
}

// Same-origin GET against this node's API, authenticated the way the app is
// (its stored bearer token if any; Hub sessions ride on cookies).
export async function apiGet(path) {
  const headers = { Accept: "application/json" };
  const token = read(appKey("term_llm_token"), null) ?? read("term_llm_token", null);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiPrefix}${path}`, { headers, credentials: "same-origin" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/* ---------------------------------------------------- provider lookup */

let providersPromise = null;
let providersCache = null;

export function loadProviders() {
  providersPromise ??= apiGet("/v1/providers")
    .then((d) => {
      providersCache = Array.isArray(d?.data) ? d.data : [];
      return providersCache;
    })
    .catch(() => {
      providersPromise = null; // allow a retry later
      return [];
    });
  return providersPromise;
}

// Name of the provider the next reply will use: the user's runtime pick (read
// live from the app's own storage key), else the server default from the
// cached provider list. Null when unknown.
export function currentProviderName() {
  return read(appKey("term_llm_selected_provider"), null) ||
    (providersCache ?? []).find((p) => p.is_default)?.name || null;
}

/* ------------------------------------------------------------- misc */

export const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

// Text made safe for HTML or SVG markup, in content and in quoted attributes.
export function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

// The app is "running" while it offers Stop: its own Stop button (beside a
// draft), or, with nothing typed, the send button turned into Stop
// (term-llm 0.9.92 and later).
export function isRunning(root) {
  return Boolean(root.querySelector(".composer .stop-btn.visible, .composer #sendBtn.stop"));
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// Same abbreviations as the app's context card (35.2k, 160k, 1.1B), so the
// ring, its tip and the card agree. The unit is picked after rounding.
export function formatTokens(n) {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  for (const [scale, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "k"]]) {
    if (abs >= scale * 0.9995) return `${(n / scale).toFixed(1).replace(/\.0$/, "")}${suffix}`;
  }
  return String(Math.round(n));
}
