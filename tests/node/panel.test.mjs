import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPanelState } from '../../extension/panel/state.js';
import { createStorageArea } from './helpers/chrome-fake.mjs';

function setup(initial = {}) {
  const storage = createStorageArea(initial);
  const sent = [];
  const panel = createPanelState({ storage, send: msg => sent.push(msg) });
  return { storage, sent, panel };
}

test('PN-01 the mode switcher shows the stored mode and saves changes', async () => {
  const { panel, storage } = setup({ mode: 'approveAll' });
  await panel.load();
  assert.equal(panel.view().mode, 'approveAll');
  await panel.setMode('fullAuto');
  assert.equal(panel.view().mode, 'fullAuto');
  assert.equal(storage.data.mode, 'fullAuto');
});
