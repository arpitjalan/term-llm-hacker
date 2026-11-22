// Omarchy theme palettes: reading a theme's colors.toml, Omarchy's own
// fallback rules for keys a theme leaves out, and the CSS custom properties
// Hacker paints with. Pure functions for the generator (tools/gen-themes.mjs),
// which writes their results into themes.js and style.css, so the page itself
// never runs this colour maths.
//
// The resolution mirrors Omarchy's bin/omarchy-theme-color, and `mix` is the
// same per-channel sRGB blend its templates use ({{ mix a b 40% }}), so
// colours derived here match the ones Omarchy writes into its own apps.

// The semantic keys of an Omarchy colors.toml, in its own order.
export const PALETTE_KEYS = [
  "accent", "selection", "muted",
  "background", "dark_background", "darker_background", "lighter_background",
  "foreground", "dark_foreground", "light_foreground", "bright_foreground",
  "red", "yellow", "orange", "green", "cyan", "blue", "magenta", "brown",
  "bright_red", "bright_yellow", "bright_green", "bright_cyan", "bright_blue", "bright_magenta",
];

// Colours that can serve as the accent: the theme's own, or one of its
// palette colours, so every choice belongs to the theme.
export const ROLES = ["accent", "red", "orange", "yellow", "green", "cyan", "blue", "magenta"];

const HEX6 = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

function hex(value) {
  const m = String(value ?? "").trim().match(HEX6);
  return m ? `#${m[1].toLowerCase()}` : null;
}

function rgb(color) {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Omarchy's mix: start blended toward end by amount (0..1), per sRGB channel.
export function mix(start, end, amount) {
  const a = rgb(start);
  const b = rgb(end);
  return `#${a.map((x, i) => Math.floor(x * (1 - amount) + b[i] * amount + 0.5).toString(16).padStart(2, "0")).join("")}`;
}

// WCAG relative luminance and contrast ratio.
export function luminance(color) {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// A readable colour to draw on `color`. Omarchy's apps pick black or white
// by luminance (above 0.179 takes black); the theme's own darkest or
// lightest colour is used instead whenever it reads as well.
export function inkOn(color, colors) {
  const dark = luminance(colors.background) <= luminance(colors.bright_foreground)
    ? colors.background : colors.bright_foreground;
  const light = dark === colors.background ? colors.bright_foreground : colors.background;
  const wantsDark = luminance(color) > 0.179;
  const pick = wantsDark ? dark : light;
  return contrast(color, pick) >= 4.5 ? pick : wantsDark ? "#000000" : "#ffffff";
}

// Key = "value" lines, quoted or bare, with or without a trailing comment.
export function parseColorsToml(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const raw = m[2].trim();
    let value;
    if (raw[0] === '"' || raw[0] === "'") {
      const end = raw.indexOf(raw[0], 1);
      value = end > 0 ? raw.slice(1, end) : raw.slice(1);
    } else {
      value = raw.match(/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?/)?.[0] ?? raw.split(/\s/)[0];
    }
    out[m[1]] = value;
  }
  return out;
}

// Omarchy's cascade for missing keys (legacy names, ANSI colorN, derived
// shades), then the mode: the `mode` key, else a light or dark background.
// Returns null without a usable background and foreground.
export function resolveColors(raw) {
  const c = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const color = hex(value);
    if (color) c[key] = color;
  }
  const alias = (key, from) => {
    if (!c[key] && c[from]) c[key] = c[from];
  };
  for (const [key, short] of [
    ["background", "bg"], ["dark_background", "dark_bg"], ["darker_background", "darker_bg"],
    ["lighter_background", "lighter_bg"], ["foreground", "fg"], ["dark_foreground", "dark_fg"],
    ["light_foreground", "light_fg"], ["bright_foreground", "bright_fg"],
  ]) alias(key, short);
  alias("background", "color0");
  alias("foreground", "color7");
  if (!c.background || !c.foreground) return null;
  c.color0 = c.background;
  c.color7 = c.foreground;
  for (const [key, n] of [
    ["red", 1], ["green", 2], ["yellow", 3], ["blue", 4], ["magenta", 5], ["cyan", 6],
    ["bright_red", 9], ["bright_green", 10], ["bright_yellow", 11], ["bright_blue", 12],
    ["bright_magenta", 13], ["bright_cyan", 14],
  ]) alias(key, `color${n}`);
  alias("magenta", "purple");
  alias("bright_magenta", "bright_purple");
  c.light_foreground ||= c.color7 || c.foreground;
  c.bright_foreground ||= c.color15 || c.foreground;
  c.lighter_background ||= c.color0 || c.background;
  c.dark_foreground ||= c.color8 || c.foreground;
  c.muted ||= c.color8 || c.dark_foreground;
  c.selection ||= c.selection_background || c.color8 || c.color0 || c.background;
  // A palette may still lack a hue (very old themes); keep every role usable.
  for (const key of ["red", "yellow", "green", "cyan", "blue", "magenta"]) c[key] ||= c.foreground;
  c.orange ||= c.yellow;
  c.brown ||= mix(c.orange, "#000000", 0.5);
  c.dark_background ||= mix(c.background, "#000000", 0.25);
  c.darker_background ||= mix(c.background, "#000000", 0.5);
  for (const key of ["red", "yellow", "green", "cyan", "blue", "magenta"]) {
    c[`bright_${key}`] ||= mix(c[key], "#ffffff", 0.2);
  }
  c.accent ||= c.color4 || c.blue;

  let mode = String(raw?.mode ?? raw?.theme_type ?? "").trim().toLowerCase();
  if (mode !== "light" && mode !== "dark") {
    mode = rgb(c.background).reduce((sum, v) => sum + v, 0) > 382 ? "light" : "dark";
  }
  const colors = { mode };
  for (const key of PALETTE_KEYS) colors[key] = c[key];
  return colors;
}

// "tokyo-night" -> "Tokyo Night", as `omarchy theme list` prints it.
export function themeName(slug) {
  return String(slug).replace(/(^|-)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase()).replace(/-/g, " ");
}

// A readable ink for each accent role, as themes.js stores it ("on").
export function inks(colors) {
  return Object.fromEntries(ROLES.map((role) => [role, inkOn(colors[role], colors)]));
}

// The --om-* custom properties for a resolved palette: every key, plus a
// readable ink for each accent role (--om-on-blue, ...). util.js builds the
// same list from a themes.js entry.
export function paletteVars(colors) {
  const vars = {};
  for (const key of PALETTE_KEYS) vars[`--om-${key.replace(/_/g, "-")}`] = colors[key];
  for (const [role, ink] of Object.entries(inks(colors))) vars[`--om-on-${role}`] = ink;
  return vars;
}
