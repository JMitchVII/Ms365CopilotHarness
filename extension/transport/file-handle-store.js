// Remembers the shared folder the user picked for the file transport. Directory handles survive in IndexedDB
// (not chrome.storage). Chrome may drop the permission between sessions; re-granting needs a user click.

const KEY = 'sharedFolder';

// kv: { get(key), set(key, value) } backed by IndexedDB (see idb-kv.js).
export async function saveSharedFolder(kv, dir) {
  await kv.set(KEY, dir);
}

export async function loadSharedFolder(kv) {
  const dir = (await kv.get(KEY)) ?? null;
  if (!dir) return { dir: null, needsPermission: false };
  const permission = await dir.queryPermission({ mode: 'readwrite' });
  return { dir, needsPermission: permission !== 'granted' };
}
