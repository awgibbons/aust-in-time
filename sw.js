// Service worker: keeps the app working offline, and handles the notification's Stop button.
// The ?v= makes an updated worker fetch these, not reuse copies the browser still holds
// from the previous version. Change it together with CACHE.
import { normalize, rollover, stop } from './core.js?v=2';
import { load, save } from './store.js?v=2';

const CACHE = 'aust-in-time-v2';
const ASSETS = [
  './', 'style.css', 'app.js', 'core.js', 'store.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // 'reload' fetches every file from the server, so the cache never mixes two versions.
  const fresh = ASSETS.map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const old = (await caches.keys()).filter((name) => name !== CACHE);
    await Promise.all(old.map((name) => caches.delete(name)));
    await self.clients.claim();
    if (old.length === 0) return;
    // This is an update. Pages still running the previous version load this one now,
    // so two versions never work on the same data.
    for (const page of await self.clients.matchAll({ type: 'window' })) {
      page.navigate?.(page.url)?.catch(() => {});
    }
  })());
});

// Answer from the cache at once and refresh the cache in the background:
// the app opens instantly and offline, and an update shows up the next time it is opened.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = url.origin + url.pathname;
    const cached = await cache.match(key);
    const fresh = fetch(event.request, { cache: 'no-cache' }).then((response) => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    });
    if (!cached) return fresh;
    event.waitUntil(fresh.catch(() => {}));
    return cached;
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(event.action === 'stop' ? stopTimer() : openApp());
});

async function stopTimer() {
  const stored = await load();
  if (!stored) return;
  const now = Date.now();
  await save(stop(rollover(normalize(stored, now), now), now)); // open pages hear about the save and redraw
}

async function openApp() {
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (pages.length > 0) return pages[0].focus();
  return self.clients.openWindow('./');
}
