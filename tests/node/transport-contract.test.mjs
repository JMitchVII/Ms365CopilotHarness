// TF-01: both transports honour the same contract, so the router can use either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeTransport } from '../../extension/transport/native.js';
import { createFileTransport } from '../../extension/transport/file.js';
import { createNativeHost, createDirectoryHandle } from './helpers/chrome-fake.mjs';

const until = async check => {
  for (let t = 0; t < 2000; t += 5) { const v = await check(); if (v) return v; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('condition not met');
};

// Each harness gives a transport plus `answer(id, result)`, which plays the agent replying to call `id`.
const harnesses = {
  native(timeoutMs) {
    const host = createNativeHost();
    const transport = createNativeTransport({ connectNative: host.connectNative, getLastError: () => host.runtime.lastError, timeoutMs });
    return {
      transport,
      async answer(id, result) {
        const port = await until(() => host.ports.find(p => p.posted.some(m => m.id === id)));
        port.reply({ v: 1, kind: 'result', ...result });
      },
    };
  },
  async file(timeoutMs) {
    const dir = createDirectoryHandle();
    const inbox = await dir.getDirectoryHandle('inbox', { create: true });
    const outbox = await dir.getDirectoryHandle('outbox', { create: true });
    dir.writeText('heartbeat.json', JSON.stringify({ at: new Date().toISOString() }));
    const transport = createFileTransport({ dir, pollMs: 5, timeoutMs });
    return {
      transport,
      async answer(id, result) {
        const name = await until(() => inbox.names().find(n => n.endsWith(`-${id}.json`)));
        await inbox.removeEntry(name);
        outbox.writeText(name, JSON.stringify({ v: 1, kind: 'result', ...result }));
      },
    };
  },
};

for (const [kind, make] of Object.entries(harnesses)) {
  test(`TF-01 [${kind}] send resolves with the agent's result, without the envelope fields`, async () => {
    const { transport, answer } = await make(2000);
    const p = transport.send({ id: 'k1', tool: 'list_dir', args: {} });
    await answer('k1', { id: 'k1', ok: true, data: { n: 1 } });
    assert.deepEqual(await p, { id: 'k1', ok: true, data: { n: 1 } });
  });

  test(`TF-01 [${kind}] no answer rejects with E_TIMEOUT`, async () => {
    const { transport } = await make(40);
    await assert.rejects(transport.send({ id: 'k2', tool: 'list_dir', args: {} }), e => e.code === 'E_TIMEOUT');
  });

  test(`TF-01 [${kind}] cancel(id) rejects that call with E_TRANSPORT`, async () => {
    const { transport } = await make(2000);
    const p = transport.send({ id: 'k3', tool: 'run_ps', args: { command: 'x' } });
    await new Promise(r => setTimeout(r, 20));
    transport.cancel('k3');
    await assert.rejects(p, e => e.code === 'E_TRANSPORT');
  });
}
