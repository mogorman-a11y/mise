// sw.js — Service Worker (PWA offline support)
// ─────────────────────────────────────────────
// Strategy:
//   App pages / JS files       → network-first (updates quickly, falls back offline)
//   Supabase API calls          → network-first (sync when online, skip offline)
//   Everything else             → network with cache fallback

const CACHE = 'veriqo-v5';

const APP_SHELL = [
  './app.html',
  './app',
  './mise.html',
  './supabase.js',
  './auth.js',
  './sync.js',
  './mise-sync.js',
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

// Allow the app to activate a freshly installed service worker immediately.
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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

// ── Push notifications ─────────────────────────────────────────────────────
// Displays a notification when the server sends a push message.
self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}
  var title = data.title || 'Veriqo';
  var options = {
    body:      data.body  || 'You have pending food safety checks.',
    icon:      './icons/icon-192.png',
    badge:     './icons/icon-192.png',
    tag:       data.tag   || 'veriqo-reminder',
    renotify:  false,
    data:      { url: '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification opens/focuses the app.
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
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

  var pathname = new URL(url).pathname;
  var isAppShellAsset = APP_SHELL.some(function(path) {
    var clean = path.replace('./', '/');
    return pathname.endsWith(clean) || pathname.endsWith(clean.replace('/app', '/app.html'));
  });

  // App pages and local shell assets must be network-first so installs pick up changes.
  if (event.request.mode === 'navigate' || isAppShellAsset || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(event.request, clone); });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request).then(function(cached) {
          return cached || caches.match('./app.html');
        });
      })
    );
    return;
  }

  // For other GET assets: stale-while-revalidate
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
          return caches.match('/app.html');
        });
      })
    );
  }
});
