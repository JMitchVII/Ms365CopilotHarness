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
