// Background-tab signal: when a reply finishes (or the agent needs you)
// while this tab is hidden, badge the favicon and prefix the title.
// Cleared as soon as the tab is visible again. It only looks while the tab
// is hidden, so a visible tab pays nothing for it.

import { isRunning } from "./util.js";

const PREFIX = { done: "● ", input: "◐ " };
// Badge colours come from the theme: its green for a finished reply, its
// yellow when input is needed, ringed in its background.
const COLOR = { done: "--om-green", input: "--om-yellow" };
const FALLBACK = { done: "#9ece6a", input: "#e0af68", ring: "#1a1b26" };

function themeColor(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function createTabNotifier(root) {
  let wasRunning = isRunning(root);
  let state = null; // null | "done" | "input"
  let iconLink = null;
  let originalHref = null;
  let badgeCache = {};
  let timer = 0;

  function needsInput() {
    return Boolean(
      root.querySelector(".interaction-attention-banner, .approval-modal, .ask-user-question") ||
      root.querySelector(".session-row.is-input-required .session-btn.active"),
    );
  }

  // favicon.js may swap the base icon for this node's tile (data-vn-base);
  // the badge is drawn on top of whichever base is current.
  const baseHref = () => iconLink?.dataset.vnBase || originalHref;

  async function badgeHref(kind) {
    iconLink ??= document.querySelector('link[rel="icon"]');
    if (!iconLink) return null;
    originalHref ??= iconLink.dataset.vnBadged ? null : iconLink.href;
    const base = baseHref();
    if (!base) return null;
    const fill = themeColor(COLOR[kind], FALLBACK[kind]);
    const ring = themeColor("--om-background", FALLBACK.ring);
    const rounded = document.documentElement.dataset.vnCorners === "rounded";
    const key = `${kind}|${fill}|${ring}|${rounded}|${base}`;
    if (badgeCache[key]) return badgeCache[key];
    const img = new Image();
    img.src = base;
    await img.decode().catch(() => {});
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (img.naturalWidth) ctx.drawImage(img, 0, 0, size, size);
    // A block in the corner (rounded with the theme's corners), ringed so it
    // stands off the tile.
    const block = (inset, color) => {
      ctx.beginPath();
      const x = size - 29 + inset;
      const w = 28 - inset * 2;
      if (rounded && ctx.roundRect) ctx.roundRect(x, x, w, w, 6);
      else ctx.rect(x, x, w, w);
      ctx.fillStyle = color;
      ctx.fill();
    };
    block(0, ring);
    block(4, fill);
    badgeCache = { [key]: canvas.toDataURL("image/png") };
    return badgeCache[key];
  }

  async function setState(next) {
    if (next === state) return;
    state = next;
    if (!next) {
      if (iconLink) {
        delete iconLink.dataset.vnBadged;
        if (baseHref()) iconLink.href = baseHref();
      }
      for (const p of Object.values(PREFIX)) {
        if (document.title.startsWith(p)) document.title = document.title.slice(p.length);
      }
      return;
    }
    const href = await badgeHref(next);
    if (state === next && href && iconLink) {
      iconLink.dataset.vnBadged = "1";
      iconLink.href = href;
    }
    applyTitle();
  }

  function applyTitle() {
    if (!state) return;
    let t = document.title;
    for (const p of Object.values(PREFIX)) if (t.startsWith(p)) t = t.slice(p.length);
    const want = PREFIX[state] + t;
    if (document.title !== want) document.title = want;
  }

  function check() {
    const running = isRunning(root);
    if (document.hidden) {
      if (needsInput()) setState("input");
      else if (wasRunning && !running) setState("done");
      else if (state) applyTitle(); // the app may have rewritten the title
    }
    wasRunning = running;
  }

  const onVisible = () => {
    clearInterval(timer);
    timer = 0;
    if (!document.hidden) {
      setState(null);
      return;
    }
    // Hidden: remember whether a reply is running, then watch for it to end.
    wasRunning = isRunning(root);
    timer = setInterval(check, 700);
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  if (document.hidden) onVisible();

  return {
    sync() {
      if (document.hidden) check();
    },
    dispose() {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      setState(null);
    },
  };
}
