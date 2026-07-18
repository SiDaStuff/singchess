// API base URL for the backend server.
//
// Resolution order:
//   1) Vite compile-time env var VITE_API_URL (set in Netlify UI as:
//      VITE_API_URL=https://chess.sidastuff.com)
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
// 3) Runtime: direct window.__API_URL (manual <script> or build config).
if (!BASE && typeof window !== 'undefined' && window.__API_URL) {
  BASE = String(window.__API_URL).replace(/\/+$/, '');
}

// Dev diagnostic: log which base was resolved.
if (BASE && typeof console !== 'undefined' && console.log) {
  console.log('[api-base] API base resolved to:', BASE);
}

window.__API_BASE = BASE;

// Wrapper: fetch() with the base URL prepended. Replace fetch('/api/...') with
// apiFetch('/api/...') — same return (a Promise<Response>).
window.apiFetch = (path, options = {}) => {
  return fetch(BASE + path, options);
};

// Full URL builder (for EventSource / WebSocket URLs).
window.apiUrl = (path) => BASE + path;