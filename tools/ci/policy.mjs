// CI-only policy: no discovery, tokens, arbitrary origins, provider or mutation API.
export const BASE = 'http://127.0.0.1:18080/ui/';
const reads = new Set([
  'v1/capabilities', 'v1/providers', 'v1/models', 'v1/sessions',
  'v1/sessions/status', 'v1/sidebar', 'admin/extensions/status',
  // Observed pinned bootstrap reads: synthetic event stream/poll and disabled-widget metadata.
  'v1/events', 'v1/events/poll', 'admin/widgets/status',
  // Hacker's sidebar asks once whether the server runs scheduled jobs.
  'v2/jobs',
]);
export function allowedRequest(url, method) {
  if (method !== 'GET') return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.origin !== new URL(BASE).origin || parsed.username || parsed.password) return false;
  if (!parsed.pathname.startsWith('/ui/')) return false;
  const relative = parsed.pathname.slice('/ui/'.length);
  if (/^(v1|v2|admin)\//.test(relative)) return reads.has(relative);
  // Static shell and bundled extension assets only, not arbitrary API paths.
  return relative === '' || relative === 'manifest.webmanifest' || relative === 'icon-512.png' ||
    /^dist\/[\w./-]+\.(js|css|woff2?|png|svg)$/.test(relative) ||
    /^extensions\/[\w-]+\/hacker\/[\w./-]+\.(js|css|json|png|svg)$/.test(relative);
}
