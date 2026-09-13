// API base URL for the backend server.
//
// Resolution order:
//   1) Vite compile-time env var VITE_API_URL (set in Netlify UI as:
//      VITE_API_URL=https://chess.singdevelopments.com)
//   2) window.__API_CONFIG.baseUrl — set by the Node server serving index.html
//   3) window.__API_URL — set by a <script> tag in the HTML
//   4) '' (empty string) — same-origin (server also serves static files, or
//      local dev with Vite proxy)
//
// Every fetch('/api/...') call goes through apiFetch(path) so the same bundle
// works deployed anywhere.

let BASE = '';

// 1) Vite compile-time env var (set in Netlify UI as VITE_API_URL).
if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) {
  BASE = String(import.meta.env.VITE_API_URL).replace(/\/+$/, '');
}
// 2) Runtime: server-injected config (window.__API_CONFIG.baseUrl).
if (!BASE && typeof window !== 'undefined' && window.__API_CONFIG && window.__API_CONFIG.baseUrl) {
  BASE = String(window.__API_CONFIG.baseUrl).replace(/\/+$/, '');
}
// 3) Runtime: direct window.__API_URL.
if (!BASE && typeof window !== 'undefined' && window.__API_URL) {
  BASE = String(window.__API_URL).replace(/\/+$/, '');
}

// Auto-prepend protocol if one is missing (common mistake: set VITE_API_URL
// to "chess.singdevelopments.com" without "https://"). Without this, apiFetch
// constructs relative URLs like "chess.singdevelopments.com/api/..." instead of
// absolute "https://chess.singdevelopments.com/api/...".
if (BASE && !/^https?:\/\//i.test(BASE)) {
  BASE = 'https://' + BASE;
}

// Dev diagnostic: log which base was resolved.
if (BASE && typeof console !== 'undefined' && console.log) {
  console.log('[api-base] API base resolved to:', BASE);
}

window.__API_BASE = BASE;

// Wrapper: fetch() with the base URL prepended. Replace fetch('/api/...') with
// apiFetch('/api/...') — same return (a Promise<Response>).
//
// Default timeout: a hung connection used to spin forever — the analysis
// button stayed in its "Analyzing…" state with no error until the user
// refreshed. Callers that legitimately stream for minutes (analyze/anticheat
// SSE-style POSTs, coach chat) pass { timeoutMs: 0 } to opt out; the server
// response itself aborts those via its own client-disconnect handling.
const DEFAULT_TIMEOUT_MS = 60000;

window.apiFetch = (path, options = {}) => {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  if (!timeoutMs || typeof AbortSignal?.timeout !== 'function') {
    return fetch(BASE + path, options);
  }
  const { timeoutMs: _omit, ...fetchOptions } = options;
  // Prefer the caller's own signal if present: abort whichever fires first by
  // linking the timeout controller to it.
  if (fetchOptions.signal) return fetch(BASE + path, fetchOptions);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(BASE + path, { ...fetchOptions, signal: controller.signal })
    .finally(() => clearTimeout(timer));
};

// Full URL builder (for EventSource / WebSocket URLs).
window.apiUrl = (path) => BASE + path;