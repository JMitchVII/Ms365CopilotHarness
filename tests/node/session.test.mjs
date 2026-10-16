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
