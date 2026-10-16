import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveSharedFolder, loadSharedFolder } from '../../extension/transport/file-handle-store.js';
import { createDirectoryHandle } from './helpers/chrome-fake.mjs';

// Stand-in for the IndexedDB key-value store (handles can't go in chrome.storage; IndexedDB can hold them).
const memoryKv = () => { const m = new Map(); return { get: async k => m.get(k), set: async (k, v) => { m.set(k, v); } }; };

test('TF-06 the shared folder handle is remembered, and a lost permission is flagged for a user gesture', async () => {
  const kv = memoryKv();
  assert.deepEqual(await loadSharedFolder(kv), { dir: null, needsPermission: false });

  const dir = createDirectoryHandle('w365-shared');
  await saveSharedFolder(kv, dir);
  const loaded = await loadSharedFolder(kv);
  assert.equal(loaded.dir, dir);
  assert.equal(loaded.needsPermission, false);

  dir.permission = 'prompt';  // e.g. after a browser restart
  assert.equal((await loadSharedFolder(kv)).needsPermission, true);
});
