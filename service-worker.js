/* Minimal offline cache so the calculators still open without a connection.
   Live fund search / NAV check still need the internet — those are separate,
   deliberate network calls and aren't cached here. */
const CACHE_NAME = 'sip-calc-v1';
const CORE_FILES = [
  'index.html',
  'swp.html',
  'sipswp.html',
  'calculators.html',
  'privacy-policy.html',
  'style.css',
  'common.js',
  'hero-bg.png',
  'icon-192.png',
  'icon-512.png',
  'manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin GET requests — never intercept the live
  // mfapi.in fund-search / NAV calls, those must always hit the network.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok){
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
