// sw.js — Service Worker (PWA offline support)
// ─────────────────────────────────────────────
// Strategy:
//   App shell (HTML + JS files) → cache-first (loads instantly offline)
//   Supabase API calls          → network-first (sync when online, skip offline)
//   Everything else             → network with cache fallback

const CACHE = 'veriqo-v2';

const APP_SHELL = [
  './',
  './index.html',
  './supabase.js',
  './auth.js',
  './sync.js',
  './subscription.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// ── Install ────────────────────────────────────────────────────────────────
// Pre-cache the app shell so it loads offline from the very first visit.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting(); // activate immediately without waiting for old SW to die
    })
  );
});

// ── Activate ───────────────────────────────────────────────────────────────
// Delete old caches so stale files don't linger after an update.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return clients.claim(); // take control of all open tabs immediately
    })
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function (event) {
  var url = event.request.url;

  // Let Supabase and Stripe requests go straight to network — don't cache API calls
  if (url.includes('supabase.co') || url.includes('stripe.com') || url.includes('cdn.jsdelivr.net')) {
    return; // fall through to normal network fetch
  }

  // For navigation requests (loading the page) and app shell assets: cache-first
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then(function (cached) {
        if (cached) {
          // Return cached version immediately, but also refresh cache in background
          var networkFetch = fetch(event.request).then(function (response) {
            if (response && response.status === 200) {
              var clone = response.clone();
              caches.open(CACHE).then(function (cache) { cache.put(event.request, clone); });
            }
            return response;
          }).catch(function () {});
          return cached;
        }

        // Not in cache — fetch from network and cache it
        return fetch(event.request).then(function (response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE).then(function (cache) { cache.put(event.request, clone); });
          }
          return response;
        }).catch(function () {
          // Offline and not cached — return the cached index.html as fallback
          return caches.match('/index.html');
        });
      })
    );
  }
});
