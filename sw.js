// Service worker: keeps the app working offline, and handles the notification's Stop button.
import { rollover, stop } from './core.js';
import { load, save } from './store.js';

const CACHE = 'aust-in-time-v1';
const ASSETS = [
  './', 'style.css', 'app.js', 'core.js', 'store.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
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
  await save(stop(rollover(stored, now), now)); // open pages hear about the save and redraw
}

async function openApp() {
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (pages.length > 0) return pages[0].focus();
  return self.clients.openWindow('./');
}
