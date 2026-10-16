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
