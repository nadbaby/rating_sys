const CACHE_NAME = 'feedback-portal-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/admin.html',
  '/login.html',
  '/css/styles.css',
  '/js/main.js',
  '/js/admin.js',
  '/js/theme.js',
  '/js/firebase-init.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install Event
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell assets');
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (e) => {
  // Let the browser handle Firebase and API calls normally
  if (e.request.url.includes('/api/') || e.request.url.includes('firebase') || e.request.url.includes('googleapis')) {
    return;
  }

  // Network First, falling back to cache strategy
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache clone of valid response
        if (res.status === 200 && e.request.method === 'GET') {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, resClone);
          });
        }
        return res;
      })
      .catch(() => {
        return caches.match(e.request).then((cachedRes) => {
          if (cachedRes) {
            return cachedRes;
          }
          // Fallback if both HTML request and network fail
          if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
            return caches.match('/index.html');
          }
        });
      })
  );
});
