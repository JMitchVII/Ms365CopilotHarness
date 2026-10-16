import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRouter } from '../../extension/lib/router.js';
import { createLedger } from '../../extension/lib/ledger.js';
import { findFences } from '../../extension/lib/parser.js';
import { createStorageArea } from './helpers/chrome-fake.mjs';

const { tools: TOOLS } = JSON.parse(await readFile(new URL('../../protocol/tools.json', import.meta.url), 'utf8'));

const call = (id, tool, args = {}) => '```json\n' + JSON.stringify({ w365: 1, id, tool, args }) + '\n```';
const resultsIn = message => findFences(message).map(b => JSON.parse(b.body));

// Fake transport: records calls and answers with ok results (or whatever `respond` returns).
function fakeTransport(respond = c => ({ id: c.id, ok: true, data: { echo: c.tool } })) {
  const sent = [];
  return { sent, async send(c) { sent.push(c); return respond(c); }, cancel() {} };
}

// Fake panel: approvals are answered by `approve`, recorded in `asked`.
function fakeUi({ approve = () => true, answer = () => 'answer', confirm = () => true } = {}) {
  const ui = { asked: [], questions: [], events: [], statuses: [] };
  ui.requestApproval = async c => { ui.asked.push(c); return approve(c); };
  ui.askUser = async c => { ui.questions.push(c); return answer(c); };
  ui.taskDone = summary => ui.events.push({ taskDone: summary });
  ui.status = s => ui.statuses.push(s);
  ui.confirmContinue = async turns => { ui.events.push({ confirm: turns }); return confirm(turns); };
  return ui;
}

function setup({ mode = 'tiered', transport = fakeTransport(), ui = fakeUi(), maxAutoTurns } = {}) {
  const router = createRouter({
    tools: TOOLS, transport, ui, ledger: createLedger(createStorageArea()),
    getMode: async () => mode, maxAutoTurns,
  });
  return { router, transport, ui };
}

test('RT-01 a read call in tiered mode is sent to the transport and its result formatted', async () => {
  const { router, transport } = setup();
  const out = await router.handleReply({ conversation: 'c', text: 'Looking.\n' + call('t1', 'list_dir') });
  assert.deepEqual(transport.sent, [{ id: 't1', tool: 'list_dir', args: {} }]);
  assert.deepEqual(resultsIn(out.message), [{ id: 't1', ok: true, data: { echo: 'list_dir' } }]);
});

test('RT-02 a write call in tiered mode waits for approval before anything is sent', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const ui = fakeUi({ approve: () => gate });
  const { router, transport } = setup({ ui });
  const pending = router.handleReply({ conversation: 'c', text: call('w1', 'write_file', { path: 'a.txt', content: 'x' }) });
  await new Promise(r => setImmediate(r));
  assert.equal(ui.asked.length, 1);
  assert.equal(ui.asked[0].id, 'w1');
  assert.equal(transport.sent.length, 0, 'nothing sent before approval');
  release(true);
  const out = await pending;
  assert.equal(transport.sent.length, 1);
  assert.equal(resultsIn(out.message)[0].ok, true);
});

test('RT-03 a denied call is not sent and returns E_DENIED so Copilot can adapt', async () => {
  const { router, transport } = setup({ ui: fakeUi({ approve: () => false }) });
  const out = await router.handleReply({ conversation: 'c', text: call('x1', 'run_ps', { command: 'rm -r *' }) });
  assert.equal(transport.sent.length, 0);
  const [r] = resultsIn(out.message);
  assert.equal(r.id, 'x1');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'E_DENIED');
});
