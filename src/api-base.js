// API base URL for the backend server.
//
// Development: Vite proxies /api/* to :3000 (see vite.config.js), so the base is
// empty (same-origin fetch works).
//
// Production (Netlify): the Vite build reads VITE_API_URL and compiles it as
// the base for all API calls. If missing, falls back to window.__API_CONFIG
// (set by the Node server when it injects API_BASE_URL into index.html), or
// empty string (same-origin / self-hosted).
//
// Every fetch('/api/...') call should go through apiFetch(path) or API_BASE so
// the same bundle works deployed anywhere without changing call sites.

let BASE = '';

// Vite compile-time env (build with VITE_API_URL=... npm run build).
if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) {
  BASE = String(import.meta.env.VITE_API_URL).replace(/\/+$/, '');
}
// Server-injected config (window.__API_CONFIG.baseUrl) — fallback.
if (!BASE && typeof window !== 'undefined' && window.__API_CONFIG && window.__API_CONFIG.baseUrl) {
  BASE = String(window.__API_CONFIG.baseUrl).replace(/\/+$/, '');
}

window.__API_BASE = BASE;

// Wrapper: fetch() with the base URL prepended. Replace fetch('/api/...') with
// apiFetch('/api/...') — same shape, same return (a Promise<Response>).
window.apiFetch = (path, options = {}) => {
  return fetch(BASE + path, options);
};

// Full URL builder (for EventSource / WebSocket URLs that need a string).
window.apiUrl = (path) => BASE + path;