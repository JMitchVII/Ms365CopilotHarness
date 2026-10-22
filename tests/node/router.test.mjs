import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRouter } from '../../extension/lib/router.js';
import { createLedger } from '../../extension/lib/ledger.js';
import { findFences } from '../../extension/lib/parser.js';
import { createStorageArea } from './helpers/chrome-fake.mjs';

const { tools: TOOLS } = JSON.parse(await readFile(new URL('../../protocol/tools.json', import.meta.url), 'utf8'));

// One call as a fenced block, ending in a newline so blocks can simply be concatenated.
const call = (id, tool, args = {}) => '```json\n' + JSON.stringify({ w365: 1, id, tool, args }) + '\n```\n';
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

function setup({ mode = 'tiered', transport = fakeTransport(), ui = fakeUi(), maxAutoTurns, checkLines } = {}) {
  const router = createRouter({
    tools: TOOLS, transport, ui, ledger: createLedger(createStorageArea()),
    getMode: async () => mode, maxAutoTurns, getCheckLines: checkLines === undefined ? undefined : async () => checkLines,
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

test('RT-04 several calls run one at a time, in order, and come back as one message', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const transport = fakeTransport(async c => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    return { id: c.id, ok: true, data: {} };
  });
  const { router } = setup({ transport, mode: 'fullAuto' });
  const text = call('a', 'list_dir') + '\n' + call('b', 'read_file', { path: 'x' }) + '\n' + call('c', 'run_ps', { command: 'ls' });
  const out = await router.handleReply({ conversation: 'c', text });
  assert.equal(maxInFlight, 1);
  assert.deepEqual(transport.sent.map(c => c.id), ['a', 'b', 'c']);
  assert.deepEqual(resultsIn(out.message).map(r => r.id), ['a', 'b', 'c']);
});

test('RT-05 calls already in the ledger are skipped', async () => {
  const { router, transport } = setup();
  const text = call('t1', 'list_dir');
  await router.handleReply({ conversation: 'c', text });
  const again = await router.handleReply({ conversation: 'c', text });
  assert.equal(transport.sent.length, 1);
  assert.equal(again.message, null, 'nothing new to send');
});

test('RT-06 parse errors go back to Copilot as results without touching the transport', async () => {
  const { router, transport } = setup();
  const text = '```json\n{"w365":1,"id":"bad", oops}\n```\n' + call('u1', 'no_such_tool');
  const out = await router.handleReply({ conversation: 'c', messageId: 'm1', text });
  assert.equal(transport.sent.length, 0);
  const results = resultsIn(out.message);
  assert.deepEqual(results.map(r => r.error.code), ['E_PARSE', 'E_UNKNOWN_TOOL']);
  assert.deepEqual(results.map(r => r.id), ['block-0', 'u1']);

  const again = await router.handleReply({ conversation: 'c', messageId: 'm1', text });
  assert.equal(again.message, null, 'errors for the same reply are reported once');
});

test('RT-07 ask_user waits for the panel answer and returns it as the call result', async () => {
  const ui = fakeUi({ answer: c => `use ${c.args.question.length} chars` });
  const { router, transport } = setup({ ui, mode: 'fullAuto' });
  const out = await router.handleReply({ conversation: 'c', text: call('q1', 'ask_user', { question: 'Which folder?' }) });
  assert.equal(transport.sent.length, 0);
  assert.equal(ui.questions[0].args.question, 'Which folder?');
  assert.deepEqual(resultsIn(out.message), [{ id: 'q1', ok: true, data: { answer: 'use 13 chars' } }]);
});

test('RT-08 task_done notifies the panel and stops auto-continuation', async () => {
  const { router, transport, ui } = setup();
  const out = await router.handleReply({ conversation: 'c', text: 'All done.\n' + call('d1', 'task_done', { summary: 'Fixed it' }) });
  assert.equal(transport.sent.length, 0);
  assert.deepEqual(ui.events, [{ taskDone: 'Fixed it' }]);
  assert.equal(out.done, true);
  assert.equal(out.message, null);
});

test('RT-09 loop guard: after maxAutoTurns automatic turns the router asks before going on', async () => {
  let allow = false;
  const ui = fakeUi({ confirm: () => allow });
  const { router, transport } = setup({ ui, maxAutoTurns: 2 });
  await router.handleReply({ conversation: 'c', text: call('a', 'list_dir') });
  await router.handleReply({ conversation: 'c', text: call('b', 'list_dir') });

  const third = await router.handleReply({ conversation: 'c', text: call('c', 'list_dir') });
  assert.deepEqual(ui.events, [{ confirm: 2 }]);
  assert.equal(third.paused, true);
  assert.equal(third.message, null);
  assert.equal(transport.sent.length, 2, 'the third call did not run');

  allow = true;
  const retry = await router.handleReply({ conversation: 'c', text: call('c', 'list_dir') });
  assert.equal(transport.sent.length, 3, 'runs once the user says go on');
  assert.ok(retry.message);

  router.resetTurns();  // the user typed something themselves
  ui.events.length = 0;
  await router.handleReply({ conversation: 'c', text: call('d', 'list_dir') });
  assert.deepEqual(ui.events, []);
});

test('RT-10 stop cancels a pending approval and an in-flight call; nothing else runs', async () => {
  // Pending approval
  const ui = fakeUi({ approve: () => new Promise(() => {}) });
  const a = setup({ ui });
  const waiting = a.router.handleReply({ conversation: 'c', text: call('w1', 'write_file', { path: 'a', content: '' }) + call('r1', 'list_dir') });
  await new Promise(r => setImmediate(r));
  a.router.stop();
  const out = await waiting;
  assert.equal(out.stopped, true);
  assert.equal(out.message, null);
  assert.equal(a.transport.sent.length, 0);

  // In-flight call
  const cancelled = [];
  const transport = { sent: [], send(c) { this.sent.push(c); return new Promise(() => {}); }, cancel: id => cancelled.push(id) };
  const b = setup({ transport, mode: 'fullAuto' });
  const running = b.router.handleReply({ conversation: 'c', text: call('x1', 'run_ps', { command: 'sleep' }) + call('x2', 'list_dir') });
  await new Promise(r => setImmediate(r));
  b.router.stop();
  const out2 = await running;
  assert.equal(out2.stopped, true);
  assert.deepEqual(cancelled, ['x1']);
  assert.deepEqual(transport.sent.map(c => c.id), ['x1']);
});

test('RT-11 a transport failure becomes an E_TRANSPORT result and the panel shows disconnected', async () => {
  const transport = { sent: [], async send(c) { this.sent.push(c); throw new Error('Native host has exited.'); }, cancel() {} };
  const { router, ui } = setup({ transport });
  const out = await router.handleReply({ conversation: 'c', text: call('t1', 'list_dir') });
  const [r] = resultsIn(out.message);
  assert.equal(r.id, 't1');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'E_TRANSPORT');
  assert.match(r.error.message, /Native host has exited/);
  assert.deepEqual(ui.statuses, ['disconnected']);
});

test('RT-12 every result is reported to the panel activity log', async () => {
  const activity = [];
  const ui = fakeUi({ approve: () => false });
  ui.activity = (c, r) => activity.push([c.id, r.ok]);
  const { router } = setup({ ui });
  await router.handleReply({ conversation: 'c', text: call('r1', 'list_dir') + call('w1', 'write_file', { path: 'a', content: '' }) });
  assert.deepEqual(activity, [['r1', true], ['w1', false]]);
});

test('RT-13 with the line-count check off, expectLines is dropped before the call reaches the agent', async () => {
  const write = { path: 'a.txt', content: 'x', expectLines: 5 };
  const edit = { path: 'a.txt', oldText: 'x', newText: 'y', expectLines: 2 };
  const off = setup({ mode: 'fullAuto', checkLines: false });
  await off.router.handleReply({ conversation: 'c', text: call('w1', 'write_file', write) + call('e1', 'edit_file', edit) });
  assert.deepEqual(off.transport.sent.map(c => c.args), [{ path: 'a.txt', content: 'x' }, { path: 'a.txt', oldText: 'x', newText: 'y' }]);

  const on = setup({ mode: 'fullAuto', checkLines: true });
  await on.router.handleReply({ conversation: 'c', text: call('w1', 'write_file', write) });
  assert.deepEqual(on.transport.sent[0].args, write);

  const unset = setup({ mode: 'fullAuto' });
  await unset.router.handleReply({ conversation: 'c', text: call('w1', 'write_file', write) });
  assert.deepEqual(unset.transport.sent[0].args, write);
});
