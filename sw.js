// sw.js — Service Worker (PWA offline support)
// ─────────────────────────────────────────────
// Step 7 will fully implement offline caching and background sync.
// This skeleton registers cleanly without breaking the app.
//
// In Step 7 this will:
//   - Cache the app shell on install (index.html + all JS files)
//   - Serve cached shell when offline
//   - Queue HACCP records created offline and sync when back online

const CACHE_NAME = 'mise-v1';

// App shell files to cache on install (Step 7)
const APP_SHELL = [
  '/',
  '/index.html',
  '/supabase.js',
  '/auth.js',
  '/sync.js',
  '/subscription.js',
  '/manifest.json'
];

self.addEventListener('install', function (event) {
  // TODO (Step 7): pre-cache app shell
  // event.waitUntil(
  //   caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  // );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  // TODO (Step 7): delete old caches when a new SW version deploys
  // event.waitUntil(
  //   caches.keys().then(keys =>
  //     Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  //   )
  // );
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', function (event) {
  // TODO (Step 7): cache-first for app shell, network-first for Supabase API calls
  // For now all requests pass through to the network unchanged
});
