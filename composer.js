// Composer extras: a context-usage ring, and a Compact button near the limit.

import { el, formatTokens, isRunning } from "./util.js";
import { setComposerText } from "./thread.js";

const COMPACT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/></svg>';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

// The ring sits in the composer, inside the subtree main.js observes: write
// its text only when it changes, or every pass would start another one.
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

export function createComposerExtras(root, api) {
  let ring = null;
  let compact = null;
  let compacting = false;
  let usage = api.getContextUsage?.() ?? null;
  const R = 7;
  const C = 2 * Math.PI * R;

  function build() {
    ring = el("button", { type: "button", class: "vn-context", "aria-label": "Context usage" });
    ring.innerHTML = `
      <svg class="vn-context-ring" viewBox="0 0 18 18" aria-hidden="true">
        <circle class="vn-context-track" cx="9" cy="9" r="${R}"/>
        <circle class="vn-context-fill" cx="9" cy="9" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}"/>
      </svg>
      <span class="vn-context-label"></span>
      <span class="vn-context-tip" role="tooltip"></span>`;
    // Hover/focus shows the tip; a click opens the app's own context card
    // (Compact now, Session stats). Without that card, a tap pins the tip.
    ring.addEventListener("click", openCard);
    ring.addEventListener("blur", () => ring.removeAttribute("data-pinned"));

    // Near the limit: one click runs the app's own /compact command.
    compact = el("button", {
      type: "button",
      class: "vn-compact",
      title: "Compact the conversation to free up context",
      "aria-label": "Compact conversation now",
      hidden: true,
    });
    compact.innerHTML = `${COMPACT_ICON}<span class="vn-compact-label">Compact</span>`;
    compact.addEventListener("click", compactNow);
  }

  // The app's header meter owns the card. Hacker hides that meter while the
  // composer bar is up (style.css) and anchors the card above this ring.
  const headerMeter = () => root.querySelector(".main-header .context-meter");

  function openCard() {
    const meter = headerMeter();
    if (!meter || !document.documentElement.hasAttribute("data-vn-composer-bar")) {
      ring.toggleAttribute("data-pinned");
      return;
    }
    ring.removeAttribute("data-pinned");
    const box = ring.closest(".composer-box") || ring;
    const ringRect = ring.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - ringRect.right - 4);
    const style = document.documentElement.style;
    style.setProperty("--vn-ctx-right", `${Math.round(right)}px`);
    style.setProperty("--vn-ctx-bottom", `${Math.round(window.innerHeight - boxRect.top + 8)}px`);
    meter.click();
  }

  // Runs /compact through the composer's own command path, then restores
  // whatever the user had typed. Attachments are never touched.
  async function compactNow() {
    const ta = root.querySelector(".composer .prompt");
    if (!ta || compacting) return;
    compacting = true;
    compact.disabled = true;
    const draft = ta.value;
    try {
      setComposerText(root, "/compact", { focus: false });
      await nextFrame();
      // Never press the send button while it is a Stop button (a run started).
      const send = root.querySelector("#sendBtn");
      if (send && !send.disabled && !send.classList.contains("live") && !send.classList.contains("stop")) send.click();
      await nextFrame();
      if (ta.value !== draft) setComposerText(root, draft, { focus: false });
    } finally {
      compacting = false;
      compact.disabled = false;
      render();
    }
  }

  // Compaction cannot start while a reply runs or another compaction is
  // in progress (the app ignores it), so only offer it when it will work.
  function canCompact() {
    return !isRunning(root) && !root.querySelector(".composer .compaction-status");
  }

  function render() {
    const bar = root.querySelector(".composer .vn-composer-bar");
    if (!bar) return;
    if (!ring) build();
    if (ring.parentElement !== bar) bar.append(ring);
    if (compact.nextElementSibling !== ring) ring.before(compact);

    const used = usage?.usedTokens ?? 0;
    const limit = usage?.inputLimit ?? 0;
    if (!usage || (!used && !limit)) {
      ring.hidden = true;
      compact.hidden = true;
      return;
    }
    ring.hidden = false;
    const pct = limit ? Math.min(100, (used / limit) * 100) : null;
    // Same bands as the app's meter: red at term-llm's auto-compaction
    // point (90% without one), amber from 70% (pulled down with it).
    const compactAt = limit && usage.autoCompactAt > 0 && usage.autoCompactAt <= limit
      ? usage.autoCompactAt : null;
    const hotAt = compactAt ?? limit * 0.9;
    const warmAt = Math.min(limit * 0.7, hotAt * (0.7 / 0.9));
    const level = pct == null ? "unknown" : used >= hotAt ? "critical" : used >= warmAt ? "warn" : "ok";
    ring.dataset.level = level;
    const meter = headerMeter();
    const expanded = meter?.getAttribute("aria-expanded") === "true" ? "true" : "false";
    if (meter) ring.setAttribute("aria-haspopup", "dialog");
    else ring.removeAttribute("aria-haspopup");
    if (ring.getAttribute("aria-expanded") !== expanded) {
      // The app returns focus to its (hidden) meter on close; land on the ring.
      const active = document.activeElement;
      const closed = ring.getAttribute("aria-expanded") === "true" && expanded === "false";
      if (closed && (active === meter || active === document.body))
        ring.focus({ preventScroll: true });
      ring.setAttribute("aria-expanded", expanded);
    }
    const fill = ring.querySelector(".vn-context-fill");
    fill.setAttribute("stroke-dashoffset", String(pct == null ? C : C * (1 - pct / 100)));
    setText(ring.querySelector(".vn-context-label"), pct == null ? formatTokens(used) : `${Math.round(pct)}%`);

    const lines = [
      pct == null
        ? `${formatTokens(used)} tokens in context`
        : `${formatTokens(used)} of ${formatTokens(limit)} tokens (${Math.round(pct)}%)`,
    ];
    if (usage.cachedInputTokens) lines.push(`${formatTokens(usage.cachedInputTokens)} cached`);
    if (compactAt && used < compactAt) lines.push(`Auto-compacts at ${formatTokens(compactAt)}`);
    if (usage.estimated) lines.push("Estimated");
    const offerCompact = level === "critical" && (compacting || canCompact());
    compact.hidden = !offerCompact;
    if (level === "critical") lines.push(offerCompact ? "Near the limit" : "Near the limit: consider /compact");
    setText(ring.querySelector(".vn-context-tip"), lines.join(" · "));
    ring.setAttribute("aria-label", `Context usage: ${lines.join(", ")}`);
  }

  const off = api.onContextUsageChanged?.((u) => {
    usage = u;
    render();
  });

  return {
    sync: render,
    dispose() {
      if (typeof off === "function") off();
      ring?.remove();
      compact?.remove();
    },
  };
}
