// A tiny IndexedDB key-value store. Used for things chrome.storage can't hold, like directory handles.

const DB = 'w365-harness';
const STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const idbKv = {
  get: key => run('readonly', store => store.get(key)),
  set: (key, value) => run('readwrite', store => store.put(value, key)),
};
