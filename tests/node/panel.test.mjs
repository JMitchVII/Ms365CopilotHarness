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

const writeCall = { id: 'w1', tool: 'write_file', args: { path: 'a.txt', content: 'x' } };

test('PN-02 approval requests are queued with tool, args and tier; approve/deny answer the router', async () => {
  const { panel, sent } = setup();
  panel.handle({ type: 'approval-request', requestId: 'r1', call: writeCall, tier: 'write' });
  panel.handle({ type: 'approval-request', requestId: 'r2', call: { id: 'x1', tool: 'run_ps', args: { command: 'ls' } }, tier: 'exec' });
  assert.deepEqual(panel.view().approvals.map(a => [a.requestId, a.call.tool, a.tier]), [['r1', 'write_file', 'write'], ['r2', 'run_ps', 'exec']]);

  panel.approve('r1');
  panel.deny('r2');
  assert.deepEqual(sent, [
    { type: 'approval', requestId: 'r1', approved: true },
    { type: 'approval', requestId: 'r2', approved: false },
  ]);
  assert.deepEqual(panel.view().approvals, []);
});

test('PN-03 "approve all for this turn" approves everything pending', () => {
  const { panel, sent } = setup();
  panel.handle({ type: 'approval-request', requestId: 'r1', call: writeCall, tier: 'write' });
  panel.handle({ type: 'approval-request', requestId: 'r2', call: writeCall, tier: 'write' });
  panel.approveAll();
  assert.deepEqual(sent.map(m => [m.requestId, m.approved]), [['r1', true], ['r2', true]]);
  assert.deepEqual(panel.view().approvals, []);
});

test('PN-04 ask_user shows the question and submitting sends the answer', () => {
  const { panel, sent } = setup();
  panel.handle({ type: 'question', requestId: 'q1', question: 'Which folder?' });
  assert.deepEqual(panel.view().questions, [{ requestId: 'q1', question: 'Which folder?' }]);
  panel.answer('q1', 'src');
  assert.deepEqual(sent, [{ type: 'answer', requestId: 'q1', text: 'src' }]);
  assert.deepEqual(panel.view().questions, []);
});
