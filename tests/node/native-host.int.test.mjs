import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { startHost } from './helpers/native-host.mjs';

test('NI-01 hello round-trips over real stdin/stdout framing', async (t) => {
  const host = startHost();
  t.after(() => host.kill());
  host.send({ v: 1, kind: 'hello' });
  const hello = await host.receive();
  assert.equal(hello.kind, 'hello');
  assert.equal(hello.v, 1);
  assert.equal(hello.root.toLowerCase(), realpathSync.native(host.root).toLowerCase());
  assert.ok(hello.tools.includes('run_ps'));
});
