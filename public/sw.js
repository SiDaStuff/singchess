const CACHE_NAME = 'sing-chess-shell-v3';
const SHELL_URLS = [
  '/',
  '/site.webmanifest',
  '/assets/icon.png',
  '/assets/brand-mark.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Only cache responses that are actually useful offline: successful HTML/asset
// responses from this origin. Never cache API responses, opaque redirects, or
// error bodies — a stored 503 would poison every offline visit.
function cacheable(response, request) {
  if (!response || response.status !== 200) return false;
  if (response.type !== 'basic' && response.type !== 'default') return false;
  return request.destination === 'document'
    || request.destination === 'script'
    || request.destination === 'style'
    || request.destination === 'font'
    || request.destination === 'image'
    || /\.(wasm|json|webmanifest|svg|png|avif|webp|woff2?|mp3|js|css)$/.test(new URL(request.url).pathname);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Navigations: network first, page shell/an earlier copy from cache as a
  // fallback. A real network failure OR a transient server error (503 during a
  // deploy) must surface as the cached shell — never as a raw error page or a
  // synthesized response that breaks the app.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(async response => {
        const url = new URL(request.url);
        if (response.status === 200) {
          if (cacheable(response, request)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(url.pathname === '/' ? '/' : url.pathname, copy)).catch(() => {});
          }
          return response;
        }
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(url.pathname)) || (await cache.match('/')) || response;
      }).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const url = new URL(request.url);
        // The current route's own cached copy (so /auth, /play, … still work
        // offline after one successful visit), otherwise the app shell.
        return (await cache.match(url.pathname)) || (await cache.match('/')) || Response.error();
      })
    );
    return;
  }

  if (new URL(request.url).origin !== self.location.origin) return;

  // Same-origin subresources: try the network first so hashed assets are
  // always fresh-in-cache when reachable; fall back to the cached copy when
  // the network fails. If there is no cached copy, let the request fail with
  // its natural error — returning an empty 503 would surface as a confusing
  // "server responded with a status of 503" to the page.
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (cacheable(response, request)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
        } else if (!response.ok) {
          // A non-OK server response for a previously-cached asset (e.g. the
          // host returned 503 during a deploy) should not evict the good copy.
          if (cached) return cached;
        }
        return response;
      }).catch(() => cached || Promise.reject(new TypeError('Network request failed')));
      return network;
    })
  );
});