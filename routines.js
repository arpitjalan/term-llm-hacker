// Routines: the work this server runs on a schedule (term-llm serve jobs), in
// a dialog framed like the launcher. Each routine shows its schedule, when it
// runs next and how its last run went, with that run's chat a click away.
// It only reads: adding or changing a routine stays with the agent, in a
// chat. nav.js loads this module the first time Routines is opened.

import { el, apiGet, apiBase } from "./util.js";

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
// Run states, coloured as the sidebar colours its rows.
const TONES = {
  succeeded: "green",
  failed: "red",
  timed_out: "red",
  queued: "yellow",
  claimed: "yellow",
  running: "yellow",
  cancel_requested: "yellow",
};

const pad = (n) => String(n).padStart(2, "0");

// "in 14h", "2m ago": enough to place a run in the day.
function when(iso) {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  const s = Math.round((t - Date.now()) / 1000);
  const a = Math.abs(s);
  if (a < 60) return "just now";
  const v = a < 3600 ? `${Math.round(a / 60)}m` : a < 86400 ? `${Math.round(a / 3600)}h` : `${Math.round(a / 86400)}d`;
  return s > 0 ? `in ${v}` : `${v} ago`;
}

function schedule(job) {
  const c = job.trigger_config ?? {};
  if (job.trigger_type === "manual") return "When you run it";
  if (job.trigger_type === "once") {
    const d = new Date(c.run_at ?? "");
    return Number.isFinite(d.getTime())
      ? `Once, ${d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
      : "Once";
  }
  const tz = c.timezone || job.schedule_timezone || "UTC";
  const m = /^(\d+) (\d+) \* \* (\*|[0-6])$/.exec((c.expression ?? "").trim());
  if (m) return `${m[3] === "*" ? "Daily" : DAYS[m[3]]} at ${pad(m[2])}:${pad(m[1])} · ${tz}`;
  return `${c.expression || job.trigger_type || "Scheduled"} · ${tz}`;
}

// Soonest first; on-demand routines next; paused and finished ones last.
function order(a, b) {
  const rank = (j) => (!j.enabled ? 2 : j.next_run_at ? 0 : 1);
  const next = (j) => Date.parse(j.next_run_at ?? "") || Infinity;
  return rank(a) - rank(b) || next(a) - next(b) || String(a.name).localeCompare(String(b.name));
}

// Open a chat by id through the app's own router (it listens for popstate).
export function openChat(id) {
  history.pushState(null, "", `${apiBase()}/chat/${encodeURIComponent(id)}`);
  dispatchEvent(new PopStateEvent("popstate"));
}

// Routines for the launcher: name, a one-line summary, and the chat of the
// last run (if any). Kept for half a minute so typing doesn't refetch.
let cached = null;
export async function listRoutines() {
  if (cached && Date.now() - cached.at < 30000) return cached.list;
  const d = await apiGet("/v2/jobs?limit=100&offset=0");
  const list = (Array.isArray(d?.data) ? d.data : []).sort(order).map((job) => ({
    id: job.id,
    name: job.name || job.id,
    hint: [schedule(job), !job.enabled ? "paused" : job.next_run_at ? `next ${when(job.next_run_at)}` : ""]
      .filter(Boolean).join(" · "),
    sessionId: job.last_run?.session_id ?? null,
  }));
  cached = { at: Date.now(), list };
  return list;
}

export function createRoutines({ onOpen, onClose }) {
  let overlay = null;
  let opener = null;
  let total;

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    onClose(total);
    opener?.focus?.();
  }

  function row(job) {
    const finished = job.trigger_type === "once" && !job.enabled && !job.next_run_at;
    const last = job.last_run;
    const meta = [schedule(job), job.enabled && job.next_run_at ? `next ${when(job.next_run_at)}` : ""];
    let lastLine = null;
    if (last) {
      const status = String(last.status ?? "").replaceAll("_", " ");
      lastLine = el("div", { class: "vn-rt-last" }, [
        el("span", { class: `vn-rt-dot vn-rt-${TONES[last.status] ?? "muted"}`, "aria-hidden": "true" }),
        el("span", { text: `Last run ${status} ${when(last.finished_at || last.started_at || last.created_at)}` }),
      ]);
      if (last.session_id) {
        const open = el("button", { type: "button", class: "vn-rt-open", text: "Open chat" });
        open.addEventListener("click", () => {
          close();
          openChat(last.session_id);
        });
        lastLine.append(open);
      }
    }
    return el("li", { class: job.enabled ? "vn-rt" : "vn-rt is-off" }, [
      el("div", { class: "vn-rt-title" }, [
        el("span", { class: "vn-rt-name", text: job.name || job.id }),
        job.enabled ? null : el("span", { class: "vn-rt-tag", text: finished ? "done" : "paused" }),
      ]),
      el("div", { class: "vn-rt-meta", text: meta.filter(Boolean).join(" · ") }),
      lastLine,
    ]);
  }

  async function load(body, count) {
    try {
      const d = await apiGet("/v2/jobs?limit=100&offset=0");
      const jobs = (Array.isArray(d?.data) ? d.data : []).sort(order);
      total = Number.isFinite(d?.total) ? d.total : jobs.length;
      if (!overlay) return;
      count.textContent = total ? String(total) : "";
      body.replaceChildren(
        jobs.length
          ? el("ul", { class: "vn-rt-list" }, jobs.map(row))
          : el("p", { class: "vn-rt-state", text: "No routines yet." }),
      );
    } catch {
      if (overlay) body.replaceChildren(el("p", { class: "vn-rt-state", text: "Couldn't load routines. Try again in a moment." }));
    }
  }

  function open(from) {
    if (overlay) return;
    opener = from;
    const agent = document.querySelector("#sidebarBrandText")?.textContent.trim() || "the agent";
    const count = el("span", { class: "vn-rt-count" });
    const shut = el("button", { type: "button", class: "vn-rt-close", "aria-label": "Close", text: "✕" });
    const body = el("div", { class: "vn-rt-body" }, [el("p", { class: "vn-rt-state", text: "Loading…" })]);
    const card = el("section", { class: "vn-rt-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "vn-rt-heading", tabindex: "-1" }, [
      el("header", { class: "vn-rt-header" }, [el("h2", { id: "vn-rt-heading", text: "Routines" }), count, shut]),
      body,
      el("p", { class: "vn-rt-foot", text: `To add, change or pause a routine, ask ${agent} in a chat.` }),
    ]);
    overlay = el("div", { class: "vn-rt-overlay" }, [card]);
    shut.addEventListener("click", close);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "Tab") {
        // Keep focus inside the dialog while it is open.
        const stops = [...card.querySelectorAll("button")];
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    document.body.append(overlay);
    card.focus();
    onOpen();
    load(body, count);
  }

  return { open, close, dispose: close };
}
