import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFileTransport } from '../../extension/transport/file.js';
import { createDirectoryHandle } from './helpers/chrome-fake.mjs';

async function setup(opts = {}) {
  const shared = createDirectoryHandle();
  const inbox = await shared.getDirectoryHandle('inbox', { create: true });
  const outbox = await shared.getDirectoryHandle('outbox', { create: true });
  shared.writeText('heartbeat.json', JSON.stringify({ at: new Date().toISOString(), pid: 1, version: '0.1.0' }));
  const statuses = [];
  const transport = createFileTransport({ dir: shared, pollMs: 5, timeoutMs: opts.timeoutMs ?? 2000, onStatus: s => statuses.push(s), ...opts });
  return { shared, inbox, outbox, transport, statuses };
}

const until = async (check, ms = 1000) => {
  for (let t = 0; t < ms; t += 5) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('condition not met');
};

// Ids repeat across conversations (c1, c2...), so request files get a unique name ending in the id.
const requestFile = box => box.names().find(n => n.endsWith('.json'));

test('TF-02 send writes the call envelope to a uniquely named inbox file', async () => {
  const { inbox, transport } = await setup({ timeoutMs: 100 });
  const p = transport.send({ id: 't1', tool: 'list_dir', args: {} });
  await until(() => requestFile(inbox));
  const name = requestFile(inbox);
  assert.match(name, /^\d+-\d+-t1\.json$/);
  assert.deepEqual(JSON.parse(inbox.readText(name)), { v: 1, kind: 'call', id: 't1', tool: 'list_dir', args: {} });
  await p.catch(() => {});
});

// Plays the agent: answers the next inbox request by writing the outbox file with the same name.
async function agentAnswers(inbox, outbox, makeResult) {
  await until(() => requestFile(inbox));
  const name = requestFile(inbox);
  const call = JSON.parse(inbox.readText(name));
  await inbox.removeEntry(name);
  outbox.writeText(name, JSON.stringify({ v: 1, kind: 'result', ...makeResult(call) }));
  return name;
}

test('TF-03 polls the outbox, resolves with the matching result and deletes the outbox file', async () => {
  const { inbox, outbox, transport } = await setup();
  const p = transport.send({ id: 't1', tool: 'list_dir', args: {} });
  await agentAnswers(inbox, outbox, c => ({ id: c.id, ok: true, data: { entries: [] } }));
  assert.deepEqual(await p, { id: 't1', ok: true, data: { entries: [] } });
  assert.deepEqual(outbox.names(), []);
});

test('TF-04 no result within the timeout rejects with E_TIMEOUT', async () => {
  const { transport } = await setup({ timeoutMs: 40 });
  await assert.rejects(transport.send({ id: 'slow', tool: 'run_ps', args: { command: 'x' } }), e => e.code === 'E_TIMEOUT');
});

test('TF-05 a stale heartbeat means disconnected: send fails fast with E_TRANSPORT', async () => {
  const { shared, inbox, transport, statuses } = await setup({ heartbeatStaleMs: 5000 });
  shared.writeText('heartbeat.json', JSON.stringify({ at: new Date(Date.now() - 60_000).toISOString(), pid: 1 }));
  const started = Date.now();
  await assert.rejects(transport.send({ id: 't1', tool: 'list_dir', args: {} }),
    e => e.code === 'E_TRANSPORT' && /not running|heartbeat/i.test(e.message));
  assert.ok(Date.now() - started < 500, 'did not wait for the call timeout');
  assert.deepEqual(inbox.names(), [], 'nothing left in the inbox for a dead agent');
  assert.deepEqual(statuses, ['disconnected']);

  shared.writeText('heartbeat.json', JSON.stringify({ at: new Date().toISOString(), pid: 1 }));
  const hello = transport.connect();
  await agentAnswers(inbox, (await shared.getDirectoryHandle('outbox')), c => ({ kind: 'hello', version: '0.1.0', tools: ['list_dir'] }));
  assert.equal((await hello).kind, 'hello');
  assert.deepEqual(statuses, ['disconnected', 'connected']);
});
