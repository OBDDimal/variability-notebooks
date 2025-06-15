const CACHE_NAME = 'pyodide-cache-v1';
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/';

// Pre-cache the main Pyodide files
const PRECACHE_URLS = [
  'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js',
  'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.asm.js',
  'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.asm.wasm',
  'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.asm.data'
];

self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ServiceWorker] Cache opened');
        return cache.addAll(PRECACHE_URLS);
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activated');
  event.waitUntil(
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
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip source map requests and wasm: protocol URLs
  if (url.href.endsWith('.map') || url.href.startsWith('wasm:')) {
    return;
  }
  
  // Only handle Pyodide CDN requests
  if (url.href.startsWith(PYODIDE_CDN)) {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          if (response) {
            console.log('[ServiceWorker] Cache hit:', event.request.url);
            return response;
          }

          console.log('[ServiceWorker] Cache miss:', event.request.url);
          return fetch(event.request)
            .then(networkResponse => {
              if (!networkResponse || networkResponse.status !== 200) {
                return networkResponse;
              }

              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache);
                console.log('[ServiceWorker] Cached:', event.request.url);
              });

              return networkResponse;
            })
            .catch(error => {
              console.error('[ServiceWorker] Fetch failed:', error);
              return caches.match(event.request).then(cachedResponse => {
                if (cachedResponse) {
                  console.log('[ServiceWorker] Serving from cache after network failure:', event.request.url);
                  return cachedResponse;
                }
                throw error;
              });
            });
        })
    );
  }
}); 