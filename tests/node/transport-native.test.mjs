import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeTransport } from '../../extension/transport/native.js';
import { createNativeHost } from './helpers/chrome-fake.mjs';

function setup(opts = {}) {
  const host = createNativeHost(opts);
  const statuses = [];
  const transport = createNativeTransport({
    connectNative: host.connectNative,
    getLastError: () => host.runtime.lastError,
    onStatus: s => statuses.push(s),
    timeoutMs: opts.timeoutMs ?? 1000,
  });
  return { host, transport, statuses };
}

test('TN-01 connects to com.w365.harness and sends hello first', async () => {
  const { host, transport, statuses } = setup();
  const hello = await transport.connect();
  assert.equal(host.ports.length, 1);
  assert.equal(host.ports[0].name, 'com.w365.harness');
  assert.deepEqual(host.ports[0].posted[0], { v: 1, kind: 'hello' });
  assert.equal(hello.root, 'C:\ws');
  assert.deepEqual(statuses, ['connected']);
});

const tick = () => new Promise(r => setImmediate(r));

test('TN-02 send(call) posts a call envelope and resolves with the matching result', async () => {
  const { host, transport } = setup();
  const pending = transport.send({ id: 't1', tool: 'list_dir', args: {} });
  await tick();
  const port = host.ports[0];
  assert.deepEqual(port.posted[1], { v: 1, kind: 'call', id: 't1', tool: 'list_dir', args: {} });
  port.reply({ v: 1, kind: 'result', id: 't1', ok: true, data: { entries: [] } });
  assert.deepEqual(await pending, { id: 't1', ok: true, data: { entries: [] } });
});

test('TN-03 out-of-order results resolve the right promises', async () => {
  const { host, transport } = setup();
  const a = transport.send({ id: 'a', tool: 'list_dir', args: {} });
  const b = transport.send({ id: 'b', tool: 'list_dir', args: {} });
  await tick();
  host.ports[0].reply({ v: 1, kind: 'result', id: 'b', ok: true, data: 'B' });
  host.ports[0].reply({ v: 1, kind: 'result', id: 'a', ok: true, data: 'A' });
  assert.equal((await a).data, 'A');
  assert.equal((await b).data, 'B');
});

test('TN-04 a call with no result within the timeout rejects with E_TIMEOUT', async () => {
  const { transport } = setup({ timeoutMs: 30 });
  await assert.rejects(transport.send({ id: 'slow', tool: 'run_ps', args: { command: 'x' } }),
    e => e.code === 'E_TIMEOUT' && /slow/.test(e.message));
});

test('TN-05 a disconnect rejects every pending call with E_TRANSPORT and the lastError message', async () => {
  const { host, transport, statuses } = setup();
  const a = transport.send({ id: 'a', tool: 'list_dir', args: {} });
  const b = transport.send({ id: 'b', tool: 'list_dir', args: {} });
  await tick();
  host.ports[0].crash('Specified native messaging host not found.');
  for (const p of [a, b]) {
    await assert.rejects(p, e => e.code === 'E_TRANSPORT' && /host not found/.test(e.message));
  }
  assert.deepEqual(statuses, ['connected', 'disconnected']);
});

test('TN-06 the next send after a disconnect reconnects', async () => {
  const { host, transport } = setup();
  await transport.connect();
  host.ports[0].crash();
  const p = transport.send({ id: 'again', tool: 'list_dir', args: {} });
  await tick();
  assert.equal(host.ports.length, 2);
  host.ports[1].reply({ v: 1, kind: 'result', id: 'again', ok: true, data: {} });
  assert.equal((await p).ok, true);
});

test('TN-07 cancel(id) drops the connection (stopping the host and its work) and rejects that call', async () => {
  const { host, transport } = setup();
  const p = transport.send({ id: 'long', tool: 'run_ps', args: { command: 'Start-Sleep 600' } });
  await tick();
  transport.cancel('long');
  await assert.rejects(p, e => e.code === 'E_TRANSPORT' && /cancel/i.test(e.message));
  assert.equal(host.ports[0].connected, false);
});

test('TN-08 restart() fails a stalled call, drops the old host and connects a fresh one', async () => {
  const { host, transport, statuses } = setup();
  const p = transport.send({ id: 'stuck', tool: 'run_ps', args: { command: 'Read-Host' } });
  await tick();
  await transport.restart();
  await assert.rejects(p, e => e.code === 'E_TRANSPORT' && /restart/i.test(e.message));
  assert.equal(host.ports.length, 2);
  assert.equal(host.ports[0].connected, false);
  assert.deepEqual(host.ports[1].posted[0], { v: 1, kind: 'hello' });
  assert.equal(statuses.at(-1), 'connected');

  const next = transport.send({ id: 'n1', tool: 'list_dir', args: {} });
  await tick();
  host.ports[1].reply({ v: 1, kind: 'result', id: 'n1', ok: true, data: {} });
  assert.deepEqual(await next, { id: 'n1', ok: true, data: {} });
});
