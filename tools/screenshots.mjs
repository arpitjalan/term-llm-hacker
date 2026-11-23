#!/usr/bin/env node
// Regenerates docs/screenshots/ with neutral demo content.
//
//   node tools/screenshots.mjs
//
// Runs against your local `term-llm serve` (same discovery as check.mjs), or
// the server that HACKER_URL and TERM_LLM_TOKEN name. It opens an unsaved new
// chat and replaces everything visible (sidebar, thread, title, node name,
// project picker) with injected demo markup in the same structure the app
// renders, styled by the installed extension. The server's providers,
// routines and notes are answered with demo data, so the model, the Routines
// count and the notes panel look the same on any server, and no real note is
// read or written. Nothing is sent and none of your conversations appear in
// the images. The home-screen GIF needs ffmpeg on PATH and is skipped without.

import { createRequire } from "module";
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { THEMES, DEFAULT_DARK } from "../themes.js";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, "../docs/screenshots");
const SERVE = (() => {
  try {
    return execSync("ps -axo args", { encoding: "utf8" }).split("\n")
      .find((l) => /^(\S*\/)?term-llm serve\b/.test(l.trim())) ?? "";
  } catch {
    return "";
  }
})();
const START = process.env.HACKER_URL || `http://localhost:${SERVE.match(/--port (\d+)/)?.[1] || "8080"}/`;
const TOKEN = process.env.TERM_LLM_TOKEN || SERVE.match(/--token (\S+)/)?.[1] || "";
const require = createRequire(process.env.PLAYWRIGHT_DIR || `${HERE}/`);
const { chromium } = require("playwright");
fs.mkdirSync(OUT, { recursive: true });

const base = (await fetch(START, { redirect: "follow" })).url;
const now = Date.now();
const min = 60_000;

const SESSIONS = [
  ["Today", [
    ["Refactor the billing worker", "18 messages · just now · payments-api", true],
    ["Why is the flaky spec flaky?", "9 messages · 25m ago · web-app"],
    ["Draft release notes for v2.4", "6 messages · 2h ago · Chat"],
  ]],
  ["Older", [
    ["Migrate cron jobs to the queue", "31 messages · 12 Oct · infra"],
    ["Tidy up the onboarding emails", "12 messages · 9 Oct · Chat"],
    ["Profile the search endpoint", "22 messages · 2 Oct · web-app"],
    ["Explain the auth middleware", "7 messages · 28 Sep · payments-api"],
  ]],
];

// Accent roles: each agent's tile takes that colour from the current theme.
const AGENTS = [
  ["macbook", "macbook", "accent", true, false],
  ["cloud", "cloud", "blue", false, true],
  ["docker-dev", "docker-dev", "green", false, false],
  ["assistant", "assistant", "magenta", false, false],
];

// What the server is asked about, answered here: one provider and its models
// (the model the composer and home panel name), and how many routines it runs.
const PROVIDERS = { object: "list", data: [{ name: "claude-bin", type: "claude-bin", configured: true, is_default: true,
  is_builtin: true, default_model: "opus", models: ["opus", "sonnet", "haiku"], service_tier: "" }] };
const MODELS = { object: "list", data: ["opus", "sonnet", "haiku"].map((id) => ({ id, object: "model", created: 0, owned_by: "term-llm" })) };
const ROUTINES = 4;

// The notes panel's notes, in the widget's order (pinned, then newest), with
// the title and snippet the widget would derive. The second was saved from
// the demo chat.
const NOTES = [
  ["release", true, 9, "Release checklist v2.4", "Cap billing retries", null,
    "# Release checklist v2.4\n\n- [x] Cap billing retries\n- [x] Spec the permanent-failure path\n- [ ] Backfill `attempt_count`\n- [ ] Draft the release notes\n"],
  ["rollout", false, 2, "Billing retries: rollout",
    "Retries are now capped at 5 attempts with jittered exponential backoff. Charges that keep failing move to failed_permanently instead of looping.",
    "Refactor the billing worker",
    "# Billing retries: rollout\n\nRetries are now capped at **5 attempts** with jittered exponential backoff. Charges that keep failing move to `failed_permanently` instead of looping.\n\n" +
    "```ruby\ndef retry_delay(attempt)\n  base = 2**attempt * 30\n  base + rand(0..base / 4)\nend\n```\n\n" +
    "- [x] Attempt count lives on the charge\n- [x] Spec: cap, jitter, permanent failure\n- [ ] Alert when `failed_permanently` > 0.5%\n- [ ] Ship behind `BILLING_RETRY_CAP`\n"],
  ["standup", false, 26, "Standup, Tuesday", "Billing worker: retries capped, spec green", null,
    "# Standup, Tuesday\n\n- Billing worker: retries capped, spec green\n- Flaky spec: a timezone at midnight UTC\n- Next: release notes for **v2.4**\n"],
  ["reading", false, 26 * 60, "Reading list", "Designing Data-Intensive Applications, ch. 8", null,
    "# Reading list\n\n- [ ] *Designing Data-Intensive Applications*, ch. 8\n- [x] The twelve-factor app\n- [ ] SQLite's WAL mode docs\n"],
].map(([id, pinned, age, title, snippet, from, body]) => ({
  id: `demo-${id}`, title, snippet, pinned, age, version: 1,
  source: from ? { url: new URL("chat/demo#message-demo", base).href, title: from } : null, body,
}));

// The notes widget's API, read-only: the list and each note, aged from the
// moment they are asked for. Nothing reaches the server's widget.
function notesRoute(route) {
  const request = route.request();
  if (request.method() !== "GET") return route.fulfill({ status: 405, json: { error: "demo notes are read-only" } });
  const dated = ({ age, ...note }) => ({ ...note, created_at: Date.now() - age * min, updated_at: Date.now() - age * min });
  const id = new URL(request.url()).pathname.match(/\/api\/notes\/([^/]+)$/)?.[1];
  if (!id) return route.fulfill({ json: { notes: NOTES.map(({ body, ...summary }) => dated(summary)), total: NOTES.length } });
  const note = NOTES.find((n) => n.id === decodeURIComponent(id));
  return note ? route.fulfill({ json: dated(note) }) : route.fulfill({ status: 404, json: { error: "note not found" } });
}

const ICON_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path></svg>';

function sidebarHTML() {
  const agents = AGENTS.map(([id, name, , here, attention]) => `
    <div class="hub-agent-row" data-reorder-id="${id}"><a class="hub-agent-link" href="#" ${here ? 'aria-current="true"' : ""}>
      <svg class="hub-agent-icon" data-icon="bot" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><use href="#bot"></use></svg><span class="hub-agent-name">${name}</span>
      ${attention ? '<span class="hub-agent-attention" aria-hidden="true"></span>' : ""}</a>
      <div class="hub-agent-menu"><button class="hub-agent-menu-trigger" type="button">⋯</button></div></div>`).join("");
  const groups = SESSIONS.map(([label, rows]) => `
    <section class="session-group"><h3>${label}</h3>${rows.map(([title, meta, active]) => `
      <div class="session-row ${active ? "is-active" : ""}"><button class="session-btn ${active ? "active" : ""}" type="button" title="${title}">
        <span class="session-title">${title}</span><span class="session-meta">${meta}</span></button>
        <div class="session-row-menu"><button class="session-menu-trigger" type="button">⋯</button></div></div>`).join("")}
    </section>`).join("");
  return `
    <section class="session-group hub-agent-group">
      <h3 class="collapsible-session-group-heading"><button type="button" class="session-group-toggle" aria-expanded="true">
        <span class="session-group-chevron">${ICON_CHEVRON}</span><span>Agents</span></button></h3>
      <nav class="hub-agent-links reorder-list">${agents}</nav>
    </section>
    <div class="flat-session-date-groups sidebar-recent-groups">${groups}</div>`;
}

function threadHTML() {
  const t0 = now - 14 * min;
  const tool = (name, summary) => `
    <div class="tool-group-entry"><span class="tool-entry-icon" aria-hidden="true">•</span><div class="tool-group-entry-body">
      <article class="message tool tool-done"><div class="tool-card"><button class="tool-toggle" type="button" aria-expanded="false">
        <span class="tool-name">${name}</span><span class="tool-summary">${summary}</span><span class="tool-status done">✓</span>
      </button></div></article></div></div>`;
  return `
  <article class="message user" data-created="${t0}"><div class="message-body"><div class="message-text">The billing worker retries failed charges forever. Can you cap retries with exponential backoff and add a spec? Think about the edge cases.</div></div>
    <div class="message-meta"><time>14m</time></div></article>
  <article class="message thought"><button class="thought-toggle" type="button" aria-expanded="true">
    <span class="thought-arrow">${ICON_CHEVRON}</span>
    <span class="thought-label"><strong class="thought-prefix">Thought:</strong> Capping retries without losing charges</span></button>
    <div class="thought-body"><div class="markdown-body"><p>A restart must not reset the attempt count, so it belongs on the charge row. Charges past the cap need a terminal state instead of silently dropping.</p></div></div></article>
  <article class="message assistant" data-created="${t0 + 40_000}"><div class="message-body"><div class="markdown-body">
    <p>I'll look at how retries are scheduled today, then add a capped backoff.</p></div></div></article>
  <div class="tool-group"><article class="tool-group-card"><button class="tool-group-toggle" type="button" aria-expanded="true">
    <span class="tool-arrow">${ICON_CHEVRON}</span><span class="tool-group-summary">4 tool calls · grep, read_file, edit_file, shell</span>
    <span class="tool-status done">✓</span></button>
    <div class="tool-group-details open">
      ${tool("grep", "pattern: retry_charge  path: app/workers")}
      ${tool("read_file", "app/workers/billing_worker.rb")}
      ${tool("edit_file", "app/workers/billing_worker.rb  +18 −4")}
      ${tool("shell", "command: bundle exec rspec spec/workers/billing_worker_spec.rb")}
    </div></article></div>
  <article class="message assistant" data-created="${t0 + 112_000}"><div class="message-body"><div class="markdown-body">
    <p>Retries are now capped at <strong>5 attempts</strong> with jittered exponential backoff. Charges that keep failing move to <code>failed_permanently</code> instead of looping.</p>
    <pre><code class="language-ruby hljs"><span class="hljs-keyword">def</span> <span class="hljs-title function_">retry_delay</span>(attempt)
  base = <span class="hljs-number">2</span>**attempt * <span class="hljs-number">30</span>
  base + rand(<span class="hljs-number">0</span>..base / <span class="hljs-number">4</span>) <span class="hljs-comment"># jitter so retries don't stampede</span>
<span class="hljs-keyword">end</span></code><button class="code-copy-btn" type="button" aria-label="Copy code">${ICON_COPY}</button></pre>
    <ul><li>Attempt counts live on the charge, so restarts don't reset them.</li><li>New spec covers the cap, the jitter range, and the permanent-failure path.</li></ul>
  </div></div>
  <div class="turn-action-panel"><button class="turn-action-btn" type="button">${ICON_COPY}</button></div>
  <div class="message-meta"><time>12m</time></div></article>`;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function setup({ width, height, scheme, mobile = false, thread = true, theme = null }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme,
    isMobile: mobile, hasTouch: mobile,
    extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}` },
  });
  await ctx.addInitScript(([agents, theme, scheme]) => {
    localStorage.setItem("term_llm_selected_provider", "claude-bin");
    localStorage.setItem("term_llm_selected_model", "opus");
    for (const [id, , accent] of agents) localStorage.setItem(`term-llm:hacker:accent:${id}`, accent);
    // A chosen Omarchy theme for this shot (its mode decides the scheme).
    if (theme) localStorage.setItem(`term-llm:hacker:theme-${scheme}`, theme);
  }, [AGENTS, theme, scheme]);
  // Only Hacker runs: other extensions on this server may render real
  // account or workspace data into the page. Their files load empty (an
  // aborted request would show the app's extension-error toast).
  await ctx.route(/\/extensions\/[^/]+\/[^/]+\//, (route) => {
    const url = route.request().url();
    if (/\/extensions\/[^/]+\/hacker\//.test(url)) return route.continue();
    const js = /\.m?js(\?|$)/.test(url);
    return route.fulfill({ status: 200, contentType: js ? "text/javascript" : "text/css", body: js ? "export default {};" : "" });
  });
  await ctx.route(/\/v1\/providers(\?|$)/, (route) => route.fulfill({ json: PROVIDERS }));
  await ctx.route(/\/v1\/models(\?|$)/, (route) => route.fulfill({ json: MODELS }));
  await ctx.route(/\/v2\/jobs(\?|$)/, (route) => route.fulfill({ json: { total: ROUTINES, data: [] } }));
  await ctx.route(/\/widgets\/hacker-notes\/api\/notes(\/|\?|$)/, notesRoute);
  const p = await ctx.newPage();
  await p.goto(base, { waitUntil: "load" });
  await p.waitForTimeout(2500);
  // Start from an unsaved draft so the header carries no real session state.
  await p.evaluate(() => document.getElementById("newChatBtn").click());
  await p.waitForTimeout(900);
  await p.evaluate(({ sidebar, threadHtml, thread }) => {
    const project = document.querySelector(".new-chat-project-value");
    if (project) project.textContent = "Chat";
    document.querySelectorAll(".new-chat-project-label, .new-chat-project-kind").forEach((n) => n.remove());
    const groups = document.querySelector("#sessionGroups");
    if (groups) groups.innerHTML = sidebar;
    const brand = document.querySelector("#sidebarBrandText");
    if (brand) brand.textContent = "macbook";
    // The app's own heading (the home panel brings its own h2).
    const emptyTitle = document.querySelector(".empty-chat > h2");
    if (emptyTitle) emptyTitle.textContent = "macbook";
    // Hide the draft's real project/worktree crumbs; demo shots add their own.
    document.querySelectorAll(".header-title-context .header-crumb, .header-title-context .header-title-badge")
      .forEach((n) => { n.style.display = "none"; });
    if (thread) {
      const msgs = document.querySelector("#messages");
      msgs.innerHTML = threadHtml;
      const title = document.querySelector("#activeSessionTitle");
      if (title) {
        title.textContent = "Refactor the billing worker";
        // The app's project breadcrumb markup, with a demo project name.
        const crumb = document.createElement("button");
        crumb.type = "button";
        crumb.className = "header-crumb header-crumb-project";
        crumb.setAttribute("aria-label", "Project billing-service");
        crumb.innerHTML = '<span>billing-service</span><svg class="icon header-crumb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
        title.before(crumb);
        title.parentElement.classList.add("has-context");
      }
    }
  }, { sidebar: sidebarHTML(), threadHtml: threadHTML(), thread });
  await p.waitForTimeout(800);
  return { p, ctx };
}

async function save(p, name, clip) {
  await p.screenshot({ path: path.join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
  console.log("wrote", name);
}

// Hero shots: tall enough that the reply's last line clears the composer.
for (const scheme of ["dark", "light"]) {
  const { p, ctx } = await setup({ width: 1440, height: 940, scheme });
  await p.evaluate(() => { const s = document.querySelector(".chat-scroll"); s.scrollTop = 0; });
  await save(p, `hero-${scheme}`);
  await ctx.close();
}

// Composer with the context ring
{
  const { p, ctx } = await setup({ width: 1440, height: 900, scheme: "dark" });
  await p.click(".composer .prompt");
  await p.keyboard.type("Now think about how to roll this out safely", { delay: 4 });
  const url = await p.evaluate(() => document.querySelector('link[data-extension="hacker"]').href.replace(/style\.css$/, "composer.js"));
  await p.evaluate(async (u) => {
    const m = await import(u);
    m.createComposerExtras(document.getElementById("root"), {
      getContextUsage: () => ({ usedTokens: 68400, inputLimit: 200000, cachedInputTokens: 51000, estimated: false, autoCompactAt: 180000 }),
      onContextUsageChanged: () => () => {},
    }).sync();
  }, url);
  await p.waitForTimeout(900);
  const b = await p.locator(".composer-box").boundingBox();
  await save(p, "composer", { x: b.x - 24, y: b.y - 24, width: b.width + 48, height: b.height + 48 });
  await ctx.close();
}

// Command palette
{
  const { p, ctx } = await setup({ width: 1440, height: 900, scheme: "dark" });
  await p.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await p.waitForTimeout(350);
  await p.keyboard.type("re");
  await p.waitForTimeout(400);
  await save(p, "palette");
  await ctx.close();
}

// Appearance popover
{
  const { p, ctx } = await setup({ width: 1440, height: 900, scheme: "dark" });
  await p.click(".vn-theme-btn");
  await p.waitForTimeout(500);
  const b = await p.locator(".vn-popover").boundingBox();
  await save(p, "appearance", { x: b.x - 20, y: b.y - 64, width: b.width + 40, height: b.height + 84 });
  await ctx.close();
}

// Agents in the sidebar
{
  const { p, ctx } = await setup({ width: 1440, height: 900, scheme: "dark" });
  const b = await p.locator(".hub-agent-group").boundingBox();
  await p.hover(".hub-agent-row:nth-child(2) .hub-agent-link");
  await p.waitForTimeout(300);
  await save(p, "agents-list", { x: 0, y: b.y - 12, width: 300, height: b.height + 24 });
  await ctx.close();
}

// Themes: the same chat in a dozen Omarchy themes, laid out in a page.
{
  const ids = ["tokyo-night", "catppuccin", "gruvbox", "nord", "everforest", "kanagawa",
    "matte-black", "ristretto", "hackerman", "catppuccin-latte", "rose-pine", "flexoki-light"];
  const tiles = [];
  for (const id of ids) {
    const theme = THEMES.find((t) => t.id === id);
    const { p, ctx } = await setup({ width: 1440, height: 900, scheme: theme.mode, theme: id });
    await p.evaluate(() => { const s = document.querySelector(".chat-scroll"); s.scrollTop = 0; });
    tiles.push([theme.name, (await p.screenshot()).toString("base64")]);
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
  const p = await ctx.newPage();
  await p.setContent(`<!doctype html><body style="margin:0;padding:14px;background:#0e0e14;color:#a9b1d6;
    font:600 13px/1 ui-monospace,Menlo,monospace;display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
    ${tiles.map(([name, png]) => `<figure style="margin:0"><img src="data:image/png;base64,${png}"
      style="display:block;width:100%;border:1px solid #2a2e42"><figcaption style="padding:8px 1px 0">${name}</figcaption></figure>`).join("")}</body>`);
  await p.waitForTimeout(300);
  const height = await p.evaluate(() => document.body.scrollHeight);
  await save(p, "themes", { x: 0, y: 0, width: 1600, height });
  await ctx.close();
}

// The home screen in every theme, as a GIF: the default dark theme, the other
// dark ones, then the light ones, 1.3 s each. The panel names each theme.
if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) {
  console.log("skipped home-themes (needs ffmpeg)");
} else {
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), "hacker-frames-"));
  const order = [
    THEMES.find((t) => t.id === DEFAULT_DARK),
    ...THEMES.filter((t) => t.mode === "dark" && t.id !== DEFAULT_DARK),
    ...THEMES.filter((t) => t.mode === "light"),
  ];
  for (const [i, theme] of order.entries()) {
    const { p, ctx } = await setup({ width: 1440, height: 900, scheme: theme.mode, theme: theme.id, thread: false });
    // The block cursor shown in every frame, not caught mid-blink.
    await p.addStyleTag({ content: ".vn-home-cursor { animation: none !important; opacity: 1 !important; }" });
    await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(frames, `${String(i).padStart(2, "0")}.png`) });
    await ctx.close();
  }
  // A palette per frame, so each theme keeps its own colours.
  const gif = spawnSync("ffmpeg", ["-v", "error", "-y", "-framerate", "10/13", "-i", path.join(frames, "%02d.png"),
    "-vf", "scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=single:reserve_transparent=0[p];[b][p]paletteuse=new=1:dither=none",
    "-loop", "0", path.join(OUT, "home-themes.gif")], { stdio: "inherit" });
  fs.rmSync(frames, { recursive: true, force: true });
  if (gif.status !== 0) throw new Error("ffmpeg could not write home-themes.gif");
  console.log("wrote home-themes");
}

// Notes beside the chat, open on the note saved from it.
{
  const { p, ctx } = await setup({ width: 1440, height: 900, scheme: "light", theme: "catppuccin-latte" });
  if (!(await p.$(".vn-notes:not([hidden])"))) await p.click(".vn-notes-toggle");
  await p.locator(".vn-note-row-title", { hasText: /^Billing retries: rollout$/ }).click();
  await p.waitForFunction(() => document.querySelector(".vn-note-text")?.value.length > 0);
  // No caret in the editor; the narrower chat back at its first message.
  await p.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector(".chat-scroll").scrollTop = 0;
  });
  await p.waitForTimeout(400);
  await save(p, "notes");
  await ctx.close();
}

// Empty state
{
  const { p, ctx } = await setup({ width: 1440, height: 900, scheme: "light", thread: false });
  await p.waitForTimeout(600);
  await save(p, "empty");
  await ctx.close();
}

// Mobile
{
  const { p, ctx } = await setup({ width: 390, height: 844, scheme: "dark", mobile: true });
  await p.evaluate(() => { const s = document.querySelector(".chat-scroll"); s.scrollTop = s.scrollHeight; });
  await p.waitForTimeout(400);
  await save(p, "mobile");
  await ctx.close();
}

await browser.close();
