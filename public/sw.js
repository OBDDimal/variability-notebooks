const PYODIDE_VERSION = '314.0.6';
const CACHE_NAME = `pyodide-runtime-${PYODIDE_VERSION}-v1`;
const PYODIDE_RUNTIME_PREFIX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// Hosts that micropip talks to when resolving/downloading PyPI wheels for the
// dependency fallback (see js/pyodide-worker.js). Cached with the same
// cache-first strategy as the Pyodide runtime so repeat visits work offline and
// without re-downloading wheels.
const MICROPIP_PREFIXES = [
  'https://pypi.org/pypi/',
  'https://files.pythonhosted.org/'
];

function isCacheable(url) {
  if (url.href.startsWith(PYODIDE_RUNTIME_PREFIX)) {
    return true;
  }

  return MICROPIP_PREFIXES.some(prefix => url.href.startsWith(prefix));
}

const PRECACHE_URLS = [
  `${PYODIDE_RUNTIME_PREFIX}pyodide.mjs`,
  `${PYODIDE_RUNTIME_PREFIX}pyodide.asm.mjs`,
  `${PYODIDE_RUNTIME_PREFIX}pyodide.asm.wasm`,
  `${PYODIDE_RUNTIME_PREFIX}pyodide-lock.json`,
  `${PYODIDE_RUNTIME_PREFIX}python_stdlib.zip`
];

// Log when the service worker starts
console.log('[ServiceWorker] Script loaded');

self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...');
  // Skip waiting to activate immediately
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ServiceWorker] Cache opened');
        return cache.addAll(PRECACHE_URLS);
      })
      .catch(error => {
        console.error('[ServiceWorker] Cache pre-fetch failed:', error);
        // Don't fail the installation if cache fails
        return Promise.resolve();
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activated');
  // Claim clients to ensure the service worker controls all pages
  event.waitUntil(
    Promise.all([
      // Claim all clients
      clients.claim(),
      // Clean up old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('[ServiceWorker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.href.endsWith('.map') || url.href.startsWith('wasm:')) {
    return;
  }

  if (isCacheable(url)) {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          if (response) {
            return response;
          }

          return fetch(event.request)
            .then(networkResponse => {
              if (!networkResponse || networkResponse.status !== 200) {
                return networkResponse;
              }

              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache);
              });

              return networkResponse;
            })
            .catch(error => {
              return caches.match(event.request).then(cachedResponse => {
                if (cachedResponse) {
                  return cachedResponse;
                }

                throw error;
              });
            });
        })
    );
  }
});