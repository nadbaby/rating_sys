// sw.js — Cache-First with Background Revalidation (Stale-While-Revalidate)
// Version bump to bust old cache
const CACHE_NAME = 'feedback-portal-v4';
const STATIC_ASSETS = [
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

// Install: pre-cache all static assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches immediately
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: Cache-First for static assets, Network-Only for API/Firebase
self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // Always bypass cache for API calls and Firebase
  if (
    url.includes('/api/') ||
    url.includes('firestore.googleapis.com') ||
    url.includes('firebase') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    e.request.method !== 'GET'
  ) {
    return; // let browser handle it normally
  }

  // Stale-While-Revalidate for HTML pages (always get fresh content)
  if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(e.request);
        const fetchPromise = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => null);

        // Return cached immediately if available; also revalidate in background
        return cached || fetchPromise || caches.match('/index.html');
      })
    );
    return;
  }

  // Cache-First for all other static assets (JS, CSS, images, fonts)
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) {
        // Serve from cache instantly; revalidate in background
        fetch(e.request).then(res => {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, res));
          }
        }).catch(() => {});
        return cached;
      }

      // Not in cache — fetch from network and cache it
      return fetch(e.request).then(res => {
        if (res && res.ok) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, resClone));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
