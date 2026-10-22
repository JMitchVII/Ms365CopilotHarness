import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, loadMode, saveMode, loadCheckLines, saveCheckLines } from '../../extension/lib/policy.js';
import { createStorageArea } from './helpers/chrome-fake.mjs';

const AGENT_TIERS = ['read', 'write', 'exec'];

test('PO-01 fullAuto runs every agent tier', () => {
  for (const tier of AGENT_TIERS) assert.equal(decide('fullAuto', tier), 'run', tier);
});

test('PO-02 approveAll asks for every agent tier', () => {
  for (const tier of AGENT_TIERS) assert.equal(decide('approveAll', tier), 'ask', tier);
});

test('PO-03 tiered runs read, asks for write and exec', () => {
  assert.equal(decide('tiered', 'read'), 'run');
  assert.equal(decide('tiered', 'write'), 'ask');
  assert.equal(decide('tiered', 'exec'), 'ask');
});

test('PO-04 ui tools are handled by the extension in every mode, never sent to the agent', () => {
  for (const mode of ['fullAuto', 'tiered', 'approveAll', 'bogus']) assert.equal(decide(mode, 'ui'), 'ui', mode);
});

test('PO-05 an unknown mode or tier fails safe to ask', () => {
  for (const tier of AGENT_TIERS) assert.equal(decide('yolo', tier), 'ask', tier);
  assert.equal(decide(undefined, 'read'), 'ask');
  assert.equal(decide('fullAuto', 'mystery'), 'ask');
});

test('PO-06 mode defaults to tiered and persists in storage', async () => {
  const storage = createStorageArea();
  assert.equal(await loadMode(storage), 'tiered');
  await saveMode(storage, 'fullAuto');
  assert.equal(await loadMode(storage), 'fullAuto');
  await assert.rejects(saveMode(storage, 'yolo'), /mode/);
  assert.equal(await loadMode(createStorageArea({ mode: 'garbage' })), 'tiered');
});

test('PO-07 the line-count check defaults to on and its setting persists', async () => {
  const storage = createStorageArea();
  assert.equal(await loadCheckLines(storage), true);
  await saveCheckLines(storage, false);
  assert.equal(await loadCheckLines(storage), false);
  await saveCheckLines(storage, true);
  assert.equal(await loadCheckLines(storage), true);
});
