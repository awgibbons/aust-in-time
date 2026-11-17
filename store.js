// Where the data lives: one record in IndexedDB, on this device only.
// IndexedDB rather than localStorage because the service worker has to reach it too
// (the notification's Stop button works while the page is closed).

const DB = 'aust-in-time';
const STORE = 'kv';
const KEY = 'data';

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The stored data, or undefined on first run. */
export async function load() {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function save(data) {
  const db = await open();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, KEY);
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  channel?.postMessage('changed');
}

// Other tabs and the service worker say when they have saved, so nobody works from stale data.
const channel = 'BroadcastChannel' in self ? new BroadcastChannel(DB) : null;

export function onExternalChange(listener) {
  channel?.addEventListener('message', listener);
}
