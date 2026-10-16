import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../../extension/lib/ledger.js';
import { createStorageArea } from './helpers/chrome-fake.mjs';

test('LG-01 a new (conversation, id) is not seen; after markDone it is', async () => {
  const ledger = createLedger(createStorageArea());
  assert.equal(await ledger.has('conv-a', 't1'), false);
  await ledger.markDone('conv-a', 't1');
  assert.equal(await ledger.has('conv-a', 't1'), true);
});

test('LG-02 the same id in another conversation is independent', async () => {
  const ledger = createLedger(createStorageArea());
  await ledger.markDone('conv-a', 't1');
  assert.equal(await ledger.has('conv-b', 't1'), false);
});

test('LG-03 the ledger survives a service worker restart (new instance, same storage)', async () => {
  const session = createStorageArea();
  await createLedger(session).markDone('conv-a', 't1');
  const revived = createLedger(session);
  assert.equal(await revived.has('conv-a', 't1'), true);
  assert.equal(await revived.has('conv-a', 't2'), false);
});
