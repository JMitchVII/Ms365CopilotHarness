import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSession } from '../../extension/lib/session.js';
import { createLedger } from '../../extension/lib/ledger.js';
import { findFences } from '../../extension/lib/parser.js';
import { createStorageArea, createPort } from './helpers/chrome-fake.mjs';

const { tools: TOOLS } = JSON.parse(await readFile(new URL('../../protocol/tools.json', import.meta.url), 'utf8'));
const call = (id, tool, args = {}) => '```json\n' + JSON.stringify({ w365: 1, id, tool, args }) + '\n```\n';
const tick = () => new Promise(r => setTimeout(r, 0));
const until = async check => {
  for (let i = 0; i < 400; i++) { const v = check(); if (v) return v; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('condition not met');
};

function setup({ mode = 'tiered', inject = async () => ({ ok: true }) } = {}) {
  const injected = [];
  const transport = { sent: [], async send(c) { this.sent.push(c); return { id: c.id, ok: true, data: {} }; }, cancel() {} };
  const session = createSession({
    tools: TOOLS,
    transport,
    ledger: createLedger(createStorageArea()),
    getMode: async () => mode,
    bootstrap: 'BOOTSTRAP TEXT',
    injectInto: async (tabId, text) => { injected.push({ tabId, text }); return inject(tabId, text); },
    retryDelayMs: 1,
  });
  return { session, transport, injected };
}

test('WR-01 a completed reply with a read call gets its results pasted back into the same tab', async () => {
  const { session, injected } = setup();
  await session.onReply({ tabId: 7, conversation: '/chat/abc', messageId: 'm1', text: call('t1', 'list_dir') });
  assert.equal(injected.length, 1);
  assert.equal(injected[0].tabId, 7);
  assert.deepEqual(findFences(injected[0].text).map(b => JSON.parse(b.body).id), ['t1']);
});

test('WR-02 approvals go to the panel port; the panel answer lets the call run', async () => {
  const { session, transport, injected } = setup();
  const panel = createPort();
  session.attachPanel(panel);
  const done = session.onReply({ tabId: 7, conversation: 'c', messageId: 'm1', text: call('w1', 'write_file', { path: 'a', content: 'x' }) });
  const request = await until(() => panel.posted.find(m => m.type === 'approval-request'));
  assert.equal(request.call.id, 'w1');
  assert.equal(request.tier, 'write');
  assert.equal(transport.sent.length, 0);
  panel.fromOther({ type: 'approval', requestId: request.requestId, approved: true });
  await done;
  assert.deepEqual(transport.sent.map(c => c.id), ['w1']);
  assert.equal(injected.length, 1);
  assert.ok(panel.posted.some(m => m.type === 'activity' && m.call.id === 'w1' && m.ok === true));
});

test('WR-03 a panel that opens later is sent the pending approvals and the current status', async () => {
  const { session } = setup();
  session.onReply({ tabId: 7, conversation: 'c', messageId: 'm1', text: call('w1', 'write_file', { path: 'a', content: 'x' }) });
  await tick();
  session.setStatus('connected');
  const panel = createPort();
  session.attachPanel(panel);
  assert.ok(panel.posted.some(m => m.type === 'approval-request' && m.call.id === 'w1'));
  assert.ok(panel.posted.some(m => m.type === 'status' && m.status === 'connected'));
});

test('WR-04 Stop from the panel abandons the reply: pending prompts close and nothing is pasted', async () => {
  const { session, transport, injected } = setup();
  const panel = createPort();
  session.attachPanel(panel);
  const done = session.onReply({ tabId: 7, conversation: 'c', messageId: 'm1', text: call('w1', 'write_file', { path: 'a', content: 'x' }) });
  await until(() => panel.posted.find(m => m.type === 'approval-request'));
  panel.fromOther({ type: 'stop' });
  const out = await done;
  assert.equal(out.stopped, true);
  assert.equal(transport.sent.length, 0);
  assert.equal(injected.length, 0);

  const late = createPort();
  session.attachPanel(late);
  assert.ok(!late.posted.some(m => m.type === 'approval-request'), 'no stale prompts replayed');
});

test('WR-05 Start session pastes the bootstrap into the Copilot tab and resets the loop guard', async () => {
  const { session, injected } = setup();
  const panel = createPort();
  session.attachPanel(panel);
  session.noteCopilotTab(9);
  panel.fromOther({ type: 'start-session' });
  await until(() => injected.length);
  assert.deepEqual(injected, [{ tabId: 9, text: 'BOOTSTRAP TEXT' }]);
});

test('WR-06 pasting retries while Copilot is busy, and stops with a status on a security check', async () => {
  let attempts = 0;
  const busyTwice = setup({ inject: async () => (++attempts <= 2 ? { ok: false, reason: 'busy' } : { ok: true }) });
  await busyTwice.session.onReply({ tabId: 7, conversation: 'c', messageId: 'm1', text: call('t1', 'list_dir') });
  assert.equal(busyTwice.injected.length, 3);

  const blocked = setup({ inject: async () => ({ ok: false, reason: 'security-check' }) });
  const panel = createPort();
  blocked.session.attachPanel(panel);
  await blocked.session.onReply({ tabId: 7, conversation: 'c', messageId: 'm1', text: call('t1', 'list_dir') });
  assert.equal(blocked.injected.length, 1);
  assert.ok(panel.posted.some(m => m.type === 'status' && m.status === 'security-check'));
});

test('WR-07 Start session finds the Copilot tab itself when none was noted (service worker restarted)', async () => {
  const injected = [];
  const session = createSession({
    tools: TOOLS,
    transport: { async send() {}, cancel() {} },
    ledger: createLedger(createStorageArea()),
    getMode: async () => 'tiered',
    bootstrap: 'BOOTSTRAP TEXT',
    injectInto: async (tabId, text) => { injected.push({ tabId, text }); return { ok: true }; },
    findCopilotTab: async () => 12,
  });
  const panel = createPort();
  session.attachPanel(panel);
  panel.fromOther({ type: 'start-session' });
  await until(() => injected.length);
  assert.deepEqual(injected, [{ tabId: 12, text: 'BOOTSTRAP TEXT' }]);
});
