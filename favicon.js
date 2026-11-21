// Node favicon: under the Hub, the tab icon becomes this node's own agent
// tile from the sidebar (its accent plus its glyph or initials), so tabs for
// different agents are told apart at a glance.
//
// The tile is read from the sidebar's current agent link once main.js has
// decorated it. notify.js badges whatever base icon this sets (see
// data-vn-base / data-vn-badged on the <link>).

import { THEMES, DEFAULT_DARK, NODE_ID, html, nodeAccent, roleColor, themeById } from "./util.js";

const FALLBACK_AFTER_MS = 4000;

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
}

// The glyph lives in style.css as a white data URL; reuse it so the two never drift.
function glyphFrom(icon) {
  const raw = getComputedStyle(icon).getPropertyValue("--vn-glyph").trim();
  const match = raw.match(/^url\(\s*["']?data:image\/svg\+xml,([\s\S]*?)["']?\s*\)$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

// The sidebar tile, flat: the accent as the current theme paints it, with
// the glyph in the theme's background as if cut out of it (as the sidebar
// draws it), square unless corners are rounded.
export function tileSvg({ accentId, kind, glyph, initials, themeId = html.dataset.vnTheme, rounded = html.dataset.vnCorners === "rounded" }) {
  const theme = themeById(themeId) ?? themeById(DEFAULT_DARK) ?? THEMES[0];
  const fill = roleColor(theme, accentId);
  const ink = theme.colors.background;
  let mark;
  if (kind !== "monogram" && glyph.startsWith("<svg")) {
    mark = glyph
      .replace(/stroke-width='[\d.]+'/, "stroke-width='2.6'") // a touch bolder at 16px
      .replace(/'white'/g, `'${ink}'`)
      .replace("<svg", "<svg x='13' y='13' width='38' height='38'");
  } else {
    const text = escapeXml((initials || "").slice(0, 2).toUpperCase());
    const size = text.length > 1 ? 26 : 32;
    mark = `<text x='32' y='34' text-anchor='middle' dominant-baseline='central' fill='${ink}' font-family='JetBrains Mono,ui-monospace,SF Mono,Menlo,monospace' font-size='${size}' font-weight='800'>${text}</text>`;
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
    `<rect width='64' height='64' rx='${rounded ? 12 : 0}' fill='${fill}'/>` +
    mark + `</svg>`;
}

export function createNodeFavicon(root, nodeId = NODE_ID) {
  if (!nodeId) return { sync() {}, dispose() {} };

  let link = document.querySelector('link[rel="icon"]');
  const original = link?.href ?? null;
  let lastSvg = "";
  const startedAt = performance.now();

  function currentTile() {
    const icon = root.querySelector('.hub-agent-link[aria-current="true"] .hub-agent-icon');
    const kind = icon?.dataset.vnKind;
    if (!icon || !kind) return null;
    if (kind === "image") {
      // A local.json picture is the tab icon as it is: the picture says it all.
      const src = getComputedStyle(icon).getPropertyValue("--vn-glyph").trim().match(/^url\(\s*["']?(.*?)["']?\s*\)$/)?.[1];
      return src ? { kind, src } : null;
    }
    return { kind, glyph: kind === "monogram" ? "" : glyphFrom(icon), initials: icon.dataset.vnInitials || "" };
  }

  function apply(svg, picture = null) {
    const key = picture ?? svg;
    if (key === lastSvg) return;
    lastSvg = key;
    const href = picture ?? `data:image/svg+xml,${encodeURIComponent(svg)}`;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.append(link);
    }
    if (picture) link.removeAttribute("type");
    else link.type = "image/svg+xml";
    link.dataset.vnBase = href;
    if (!link.dataset.vnBadged) link.href = href;
  }

  function sync() {
    const tile = currentTile();
    const accentId = nodeAccent(nodeId);
    if (tile?.kind === "image") {
      apply(null, tile.src);
    } else if (tile) {
      apply(tileSvg({ accentId, ...tile }));
    } else if (!lastSvg && performance.now() - startedAt > FALLBACK_AFTER_MS) {
      // No agent list (e.g. the sidebar is not rendered): initials of the node id.
      apply(tileSvg({ accentId, kind: "monogram", glyph: "", initials: nodeId.split(/[\s_-]+/).map((p) => p[0]).join("") || nodeId }));
    }
  }

  // Theme, accent and corner changes re-render; the sidebar's own changes
  // arrive via sync().
  const accentObserver = new MutationObserver(sync);
  accentObserver.observe(html, { attributes: true, attributeFilter: ["data-vn-accent", "data-vn-theme", "data-vn-corners"] });
  const fallbackTimer = setTimeout(sync, FALLBACK_AFTER_MS + 50);

  return {
    sync,
    dispose() {
      accentObserver.disconnect();
      clearTimeout(fallbackTimer);
      if (link && original) {
        link.href = original;
        delete link.dataset.vnBase;
      }
    },
  };
}
