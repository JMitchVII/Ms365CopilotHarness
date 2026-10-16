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
