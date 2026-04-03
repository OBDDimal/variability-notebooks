const CACHE_NAME = 'pyodide-runtime-v1';
const PYODIDE_RUNTIME_PREFIX = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';

const PRECACHE_URLS = [
  'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js',
  'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.asm.js',
  'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.asm.wasm',
  'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide-lock.json',
  'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/python_stdlib.zip'
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

  if (url.href.startsWith(PYODIDE_RUNTIME_PREFIX)) {
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