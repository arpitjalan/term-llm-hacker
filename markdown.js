// Markdown for notes (notes.js), as pure functions: no imports, no DOM.
//
// - highlight(): the note coloured as Markdown. It keeps every character, so
//   the coloured copy lines up exactly under the textarea you type in.
// - renderMarkdown(): a small, safe renderer for preview. Text is escaped
//   first; only known tags come out, and links only for http(s) and mailto.
// - noteText(): a note's title and preview line, as the notes widget
//   (widget/server.py) derives them; tools/ci/fixtures/note-text.json keeps
//   the two in step.
// - Editing helpers return { from, to, insert, select } for the editor to
//   apply as one undoable step.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/* -------------------------------------------------------- title, preview */

const MARKER = /^\s*(?:#{1,6}\s+|>+\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+(?:\[[ xX]\]\s+)?)/;
const LINK_TEXT = /!?\[([^\]]*)\]\([^)]*\)/g;
const EMPHASIS = /[*`~]+/g;
// Underscores only where they open or close emphasis, not inside snake_case.
const UNDERSCORE = /(^|\W)_+|_+(?=\W|$)/g;
const FENCE_LINE = /^\s*(```|~~~)/;

function plainLine(line) {
  return line.replace(MARKER, "").replace(LINK_TEXT, "$1").replace(EMPHASIS, "").replace(UNDERSCORE, "$1")
    .split(/\s+/).filter(Boolean).join(" ");
}

const cut = (text, n) => [...text].slice(0, n).join("");

// The first line with text is the title; the next one is the preview.
export function noteText(body) {
  let title = "";
  for (const line of String(body ?? "").replace(/\r\n/g, "\n").split("\n")) {
    if (FENCE_LINE.test(line)) continue;
    const text = plainLine(line);
    if (!text) continue;
    if (!title) title = cut(text, 120);
    else return { title, snippet: cut(text, 160) };
  }
  return { title, snippet: "" };
}

/* ------------------------------------------------------------- highlight */

const span = (cls, text) => (text ? `<span class="vn-md-${cls}">${esc(text)}</span>` : "");

// Inline marks, leftmost first: code, bold, italic, strikethrough, links and
// bare URLs. Each keeps its markers, dimmed.
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)|(~~[^~\n]+~~)|(!?\[[^\]\n]*\]\([^)\s]*\))|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_~])/g;
const WORD = /[A-Za-z0-9]/;

function inlineMarks(text) {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const token = m[0];
    const at = m.index;
    out += esc(text.slice(last, at));
    last = at + token.length;
    const wrap = (cls, size) =>
      `<span class="vn-md-${cls}">${span("mark", token.slice(0, size))}${inlineMarks(token.slice(size, -size))}${span("mark", token.slice(-size))}</span>`;
    if (m[1]) out += span("code", token);
    else if (m[2]) out += wrap("bold", 2);
    else if (m[3]) {
      // snake_case_names are not emphasis.
      const inWord = token[0] === "_" && (WORD.test(text[at - 1] ?? "") || WORD.test(text[last] ?? ""));
      out += inWord ? esc(token) : wrap("italic", 1);
    } else if (m[4]) out += wrap("strike", 2);
    else if (m[5]) {
      const open = token[0] === "!" ? 2 : 1;
      const mid = token.indexOf("](");
      out += span("mark", token.slice(0, open)) + span("link", token.slice(open, mid)) + span("mark", "](") +
        span("url", token.slice(mid + 2, -1)) + span("mark", ")");
    } else out += span("url", token);
  }
  return out + esc(text.slice(last));
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\](?=\s|$))?(.*)$/;

export function highlight(src) {
  const out = [];
  let fence = null;
  for (const line of String(src ?? "").split("\n")) {
    if (fence) {
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      out.push(span(fence ? "codeblock" : "fence", line));
      continue;
    }
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (open) {
      fence = open[1];
      out.push(span("fence", line));
      continue;
    }
    let m = line.match(/^(\s{0,3})(#{1,6})(\s.*)?$/);
    if (m) {
      out.push(`${esc(m[1])}<span class="vn-md-heading">${span("mark", m[2])}${inlineMarks(m[3] ?? "")}</span>`);
      continue;
    }
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      out.push(span("hr", line));
      continue;
    }
    m = line.match(/^(\s*)(>+)(.*)$/);
    if (m) {
      out.push(`${esc(m[1])}${span("quote-mark", m[2])}<span class="vn-md-quote">${inlineMarks(m[3])}</span>`);
      continue;
    }
    m = line.match(LIST_ITEM);
    if (m) {
      const [, indent, marker, space, box, rest] = m;
      const done = Boolean(box) && box[1] !== " ";
      const gap = done ? rest.match(/^\s*/)[0] : ""; // the strike starts at the words
      out.push(esc(indent) + span("bullet", marker) + esc(space) + (box ? span(done ? "box-done" : "box", box) : "") +
        (done ? `${esc(gap)}<span class="vn-md-done">${inlineMarks(rest.slice(gap.length))}</span>` : inlineMarks(rest)));
      continue;
    }
    out.push(inlineMarks(line));
  }
  return out.join("\n");
}

/* ---------------------------------------------------------------- render */

const safeUrl = (url) => /^(https?:\/\/|mailto:)/i.test(url);
const anchor = (url, inner) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;

function inlineHtml(raw) {
  const slots = [];
  const keep = (htmlText) => `\u0001${slots.push(htmlText) - 1}\u0002`;
  let s = String(raw).replace(/[\u0001\u0002]/g, "");
  s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${esc(code)}</code>`));
  // Images are not fetched: a preview should not load anything by itself.
  s = s.replace(/(!?)\[([^\]\n]*)\]\(([^()\s]+)\)/g, (whole, bang, label, url) =>
    safeUrl(url) ? keep(anchor(url, label ? inlineHtml(label) : esc(url))) : whole);
  s = s.replace(/https?:\/\/[^\s<>()\u0001\u0002]*[^\s<>().,;:!?'"*_~\u0001\u0002]/g, (url) => keep(anchor(url, esc(url))));
  s = esc(s)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?=[^\w]|$)/g, "$1<strong>$2</strong>")
    .replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?=[^\w]|$)/g, "$1<em>$2</em>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>");
  return s.replace(/\u0001(\d+)\u0002/g, (_, i) => slots[Number(i)]);
}

const BLANK = /^\s*$/;
const HEADING = /^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(?:\[([ xX])\](?:\s+|$))?(.*)$/;
const OPEN_FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/;

function list(lines, i, base) {
  let out = "";
  const stack = []; // open lists: { indent, tag }
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(ITEM);
    if (!m) {
      if (BLANK.test(line) && i + 1 < lines.length && ITEM.test(lines[i + 1])) {
        i++;
        continue;
      }
      if (!BLANK.test(line) && /^\s{2,}\S/.test(line) && stack.length) {
        out += `<br>${inlineHtml(line.trim())}`; // a continuation of the item
        i++;
        continue;
      }
      break;
    }
    const indent = m[1].replace(/\t/g, "    ").length;
    const tag = /\d/.test(m[2]) ? "ol" : "ul";
    while (stack.length && indent < stack[stack.length - 1].indent) out += `</li></${stack.pop().tag}>`;
    const top = stack[stack.length - 1];
    if (top && indent === top.indent && top.tag !== tag) out += `</li></${stack.pop().tag}>`;
    const parent = stack[stack.length - 1];
    if (!parent || indent > parent.indent) {
      const start = tag === "ol" ? parseInt(m[2], 10) : 1;
      out += `<${tag}${start !== 1 ? ` start="${start}"` : ""}>`;
      stack.push({ indent, tag });
    } else {
      out += "</li>";
    }
    if (m[3] === undefined) out += `<li>${inlineHtml(m[4])}`;
    else {
      const done = m[3] !== " ";
      out += `<li class="task-list-item"><input type="checkbox" data-line="${base + i}"${done ? " checked" : ""}> ${inlineHtml(m[4])}`;
    }
    i++;
  }
  while (stack.length) out += `</li></${stack.pop().tag}>`;
  return [out, i];
}

function blocks(lines, base) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(OPEN_FENCE);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence[1][0].repeat(3)) && lines[i].trim().replace(/[`~]/g, "") === "")) {
        code.push(lines[i]);
        i++;
      }
      i++; // the closing fence, if any
      const lang = fence[2] ? ` class="language-${esc(fence[2])}"` : "";
      out.push(`<pre><code${lang}>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (BLANK.test(line)) {
      i++;
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineHtml(heading[2] ?? "")}</h${level}>`);
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const start = i;
      const inner = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${blocks(inner, base + start)}</blockquote>`);
      continue;
    }
    if (ITEM.test(line)) {
      const [listHtml, next] = list(lines, i, base);
      out.push(listHtml);
      i = next;
      continue;
    }
    const para = [];
    while (i < lines.length && !BLANK.test(lines[i]) && !OPEN_FENCE.test(lines[i]) && !HEADING.test(lines[i]) &&
      !RULE.test(lines[i]) && !/^\s*>/.test(lines[i]) && !ITEM.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${para.map((l) => inlineHtml(l.trim())).join("<br>")}</p>`);
  }
  return out.join("");
}

// Task checkboxes carry data-line, the source line they toggle (toggleTask).
export function renderMarkdown(src) {
  return blocks(String(src ?? "").replace(/\r\n?/g, "\n").split("\n"), 0);
}

/* ---------------------------------------------------------- page to note */

// Part of a chat as Markdown, for a note made from a selection (clip.js):
// paragraphs, headings, lists and tasks, quotes, code blocks with their
// language, tables, links and emphasis. It reads nodes only through
// nodeType, nodeName, nodeValue, childNodes and getAttribute, so it runs on
// the page or on plain objects in tests. Options:
//   skip(el)     true leaves an element, and everything in it, out
//   text(node)   a text node's text (clip.js cuts it to the selection)
//   url(value)   where a link or image points, or null to keep only its text
//   inline       the root's text alone, without its own block's markers

const DROP = new Set([
  "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "BUTTON", "SVG", "CANVAS", "IFRAME", "OBJECT", "EMBED",
  "SELECT", "TEXTAREA", "AUDIO", "VIDEO",
]);
const BLOCK = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION",
  "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL",
  "P", "PRE", "SECTION", "SUMMARY", "TABLE", "UL",
]);

const oneLine = (text) => text.replace(/\s+/g, " ").trim();
// Spaces around emphasis go outside its markers: "a<b> b </b>c" is "a **b** c".
const wrapIn = (text, mark) => {
  const [, lead, inner, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return inner ? `${lead}${mark}${inner}${mark}${trail}` : text;
};
const codeSpan = (text) => {
  const t = text.replace(/\n/g, " ");
  if (!t.trim()) return t;
  const longest = Math.max(0, ...(t.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longest + 1);
  return longest ? `${ticks} ${t} ${ticks}` : `${ticks}${t}${ticks}`;
};
// A paragraph's lines, each with its spaces evened out.
const tidy = (text) => text.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/^\n+|\n+$/g, "");

export function toMarkdown(root, { skip = () => false, text = (n) => n.nodeValue ?? "", url = (v) => (safeUrl(v) ? v : null), inline: bare = false } = {}) {
  const tag = (n) => String(n.nodeName ?? "").toUpperCase();
  const attr = (n, name) => (typeof n.getAttribute === "function" ? n.getAttribute(name) : null);
  const kids = (n) => Array.from(n.childNodes ?? []);
  const gone = (n) => n.nodeType === 1 && (DROP.has(tag(n)) || attr(n, "hidden") !== null || skip(n));
  const isBlock = (n) => n.nodeType === 1 && BLOCK.has(tag(n));

  // Code keeps every character.
  const raw = (n) => {
    if (n.nodeType === 3) return text(n);
    if (n.nodeType !== 1 && n.nodeType !== 11) return "";
    if (gone(n)) return "";
    return tag(n) === "BR" ? "\n" : kids(n).map(raw).join("");
  };

  function inline(n) {
    if (n.nodeType === 3) return text(n).replace(/[\t\n\r ]+/g, " ");
    if (n.nodeType !== 1 && n.nodeType !== 11) return "";
    if (gone(n)) return "";
    const inner = () => kids(n).map(inline).join("");
    switch (tag(n)) {
      case "BR": return "\n";
      case "STRONG": case "B": return wrapIn(inner(), "**");
      case "EM": case "I": case "CITE": case "DFN": return wrapIn(inner(), "_");
      case "DEL": case "S": case "STRIKE": return wrapIn(inner(), "~~");
      case "CODE": case "KBD": case "SAMP": return codeSpan(raw(n));
      case "INPUT": return "";
      case "A": {
        const label = inner();
        const href = attr(n, "href");
        const to = href ? url(href) : null;
        if (!to || !label.trim()) return label;
        const [, lead, words, trail] = label.match(/^(\s*)([\s\S]*?)(\s*)$/);
        return `${lead}${words === to ? to : `[${words.replace(/\n/g, " ")}](${to})`}${trail}`;
      }
      case "IMG": {
        const alt = oneLine((attr(n, "alt") ?? "").replace(/[[\]]/g, ""));
        const src = attr(n, "src");
        const to = src ? url(src) : null;
        return to ? `![${alt}](${to})` : alt;
      }
      default: return inner();
    }
  }

  // A container's blocks, each a Markdown string.
  function blocks(n) {
    const out = [];
    let para = "";
    const flush = () => {
      const p = tidy(para);
      if (p.trim()) out.push(p);
      para = "";
    };
    for (const c of kids(n)) {
      if (gone(c)) continue;
      if (isBlock(c)) {
        flush();
        out.push(...block(c));
      } else para += inline(c);
    }
    flush();
    return out;
  }

  function block(n) {
    const name = tag(n);
    if (/^H[1-6]$/.test(name)) {
      const words = oneLine(kids(n).map(inline).join(""));
      return words ? [`${"#".repeat(Number(name[1]))} ${words}`] : [];
    }
    if (name === "PRE") return codeBlock(n);
    if (name === "UL" || name === "OL") return list(n);
    if (name === "LI") {
      const item = listItem(n, "- ");
      return item ? [item] : [];
    }
    if (name === "BLOCKQUOTE") {
      const inner = blocks(n).join("\n\n");
      return inner ? [inner.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n")] : [];
    }
    if (name === "HR") return ["---"];
    if (name === "TABLE") return table(n);
    return blocks(n);
  }

  function codeBlock(pre) {
    const code = kids(pre).find((c) => c.nodeType === 1 && tag(c) === "CODE");
    const classes = `${attr(code ?? pre, "class") ?? ""} ${attr(pre, "class") ?? ""}`;
    const lang = classes.match(/(?:^|\s)lang(?:uage)?-([\w+#.-]+)/)?.[1] ?? attr(pre, "data-lang") ?? "";
    const body = raw(pre).replace(/^\n+/, "").replace(/\s+$/, "");
    if (!body.trim()) return [];
    const longest = Math.max(0, ...(body.match(/`{3,}/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(Math.max(3, longest + 1));
    return [`${fence}${lang}\n${body}\n${fence}`];
  }

  // A task's checkbox leads its item, or the item's first paragraph.
  function checkbox(n) {
    for (const c of kids(n)) {
      if (c.nodeType === 3 && !(c.nodeValue ?? "").trim()) continue;
      if (c.nodeType !== 1) return null;
      const name = tag(c);
      if (name === "INPUT") return (attr(c, "type") ?? "").toLowerCase() === "checkbox" ? c : null;
      return name === "P" || name === "LABEL" || name === "SPAN" ? checkbox(c) : null;
    }
    return null;
  }

  function listItem(li, marker) {
    const box = checkbox(li);
    const done = box && (typeof box.checked === "boolean" ? box.checked : attr(box, "checked") !== null);
    const parts = blocks(li);
    if (!parts.length) return "";
    const pad = " ".repeat(marker.length);
    const body = parts.join("\n").split("\n").map((line, i) => (i && line ? pad + line : line)).join("\n");
    return `${marker}${box ? (done ? "[x] " : "[ ] ") : ""}${body}`;
  }

  function list(n) {
    const ordered = tag(n) === "OL";
    let number = Number.parseInt(attr(n, "start") ?? "1", 10);
    if (!Number.isFinite(number)) number = 1;
    const items = [];
    for (const c of kids(n)) {
      if (c.nodeType !== 1) continue;
      const name = tag(c);
      // Items keep their numbers when the selection starts partway down.
      const marker = ordered ? `${number}. ` : "- ";
      if (name === "LI") number += 1;
      if (gone(c)) continue;
      if (name === "LI") {
        const item = listItem(c, marker);
        if (item) items.push(item);
      } else if (name === "UL" || name === "OL") {
        // A list directly inside a list belongs to the item before it.
        const nested = list(c).join("\n").split("\n").map((line) => (line ? `  ${line}` : line)).join("\n");
        if (nested.trim()) items.push(nested);
      }
    }
    return items.length ? [items.join("\n")] : [];
  }

  function table(n) {
    const rows = [];
    const collect = (parent) => {
      for (const c of kids(parent)) {
        if (c.nodeType !== 1 || gone(c)) continue;
        const name = tag(c);
        if (name === "TR") {
          const cells = kids(c).filter((d) => d.nodeType === 1 && !gone(d) && (tag(d) === "TD" || tag(d) === "TH"));
          if (cells.length) rows.push(cells.map((d) => oneLine(kids(d).map(inline).join("")).replace(/\|/g, "\\|")));
        } else if (name === "THEAD" || name === "TBODY" || name === "TFOOT") collect(c);
      }
    };
    collect(n);
    const width = Math.max(0, ...rows.map((r) => r.length));
    if (!width) return [];
    const line = (cells) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
    return [[line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n")];
  }

  if (gone(root)) return "";
  if (root.nodeType === 3 || (root.nodeType === 1 && !isBlock(root))) return tidy(inline(root));
  if (root.nodeType === 1 && bare && tag(root) !== "PRE") return tidy(kids(root).map(inline).join(""));
  return (root.nodeType === 1 ? block(root) : blocks(root)).join("\n\n");
}

/* --------------------------------------------------------------- editing */

const lineStart = (value, at) => value.lastIndexOf("\n", at - 1) + 1;
const lineEnd = (value, at) => {
  const end = value.indexOf("\n", at);
  return end < 0 ? value.length : end;
};

// Enter at the end of a list item or quote: the next item, numbered on.
// Enter on an empty one ends the list instead. Null: an ordinary Enter.
export function continueList(value, caret) {
  const start = lineStart(value, caret);
  const before = value.slice(start, caret);
  if (value.slice(caret, lineEnd(value, caret)).trim()) return null; // mid-line
  const quote = before.match(/^(\s*>+\s?)(.*)$/);
  const item = before.match(/^(\s*)(?:([-*+])|(\d{1,9})([.)]))(\s+)(\[[ xX]\](?:\s+|$))?(.*)$/);
  if (item) {
    const [, indent, bullet, num, delim, space, box, rest] = item;
    if (!rest.trim()) return { from: start, to: caret, insert: "", select: [start, start] };
    const marker = bullet ?? `${Number(num) + 1}${delim}`;
    const next = `\n${indent}${marker}${space}${box ? "[ ] " : ""}`;
    return { from: caret, to: caret, insert: next, select: [caret + next.length, caret + next.length] };
  }
  if (quote) {
    if (!quote[2].trim()) return { from: start, to: caret, insert: "", select: [start, start] };
    const next = `\n${quote[1]}`;
    return { from: caret, to: caret, insert: next, select: [caret + next.length, caret + next.length] };
  }
  return null;
}

export const isListLine = (value, at) => ITEM.test(value.slice(lineStart(value, at), lineEnd(value, at)));

// Tab and Shift+Tab: indent or outdent every line the selection touches.
export function shiftLines(value, selStart, selEnd, outdent) {
  const from = lineStart(value, selStart);
  const to = lineEnd(value, Math.max(selStart, selEnd - (selEnd > selStart && value[selEnd - 1] === "\n" ? 1 : 0)));
  const lines = value.slice(from, to).split("\n");
  let delta0 = 0;
  let total = 0;
  const changed = lines.map((line, index) => {
    let next;
    if (outdent) next = line.replace(/^( {1,2}|\t)/, "");
    else next = `  ${line}`;
    const delta = next.length - line.length;
    if (index === 0) delta0 = delta;
    total += delta;
    return next;
  });
  const insert = changed.join("\n");
  const start = Math.max(from, selStart + delta0);
  return { from, to, insert, select: [start, Math.max(start, selEnd + total)] };
}

// Check or uncheck the task on one line; null if it is not a task.
export function toggleTask(value, lineIndex) {
  const lines = String(value).split("\n");
  const line = lines[lineIndex];
  const m = line?.match(/^(\s*(?:>\s?)*\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\].*)$/);
  if (!m) return null;
  let from = 0;
  for (let i = 0; i < lineIndex; i++) from += lines[i].length + 1;
  const at = from + m[1].length;
  return { from: at, to: at + 1, insert: m[2] === " " ? "x" : " " };
}

// The task on the caret's line (Mod+Enter).
export function toggleTaskAt(value, caret) {
  const index = value.slice(0, caret).split("\n").length - 1;
  const edit = toggleTask(value, index);
  return edit && { ...edit, select: [caret, caret] };
}

// Mod+B / Mod+I: wrap the selection in a marker, or unwrap it.
export function wrapSelection(value, selStart, selEnd, marker) {
  const n = marker.length;
  const inner = value.slice(selStart, selEnd);
  if (value.slice(selStart - n, selStart) === marker && value.slice(selEnd, selEnd + n) === marker) {
    return { from: selStart - n, to: selEnd + n, insert: inner, select: [selStart - n, selEnd - n] };
  }
  if (inner.length > 2 * n && inner.startsWith(marker) && inner.endsWith(marker)) {
    const bare = inner.slice(n, -n);
    return { from: selStart, to: selEnd, insert: bare, select: [selStart, selStart + bare.length] };
  }
  return { from: selStart, to: selEnd, insert: `${marker}${inner}${marker}`, select: [selStart + n, selEnd + n] };
}
