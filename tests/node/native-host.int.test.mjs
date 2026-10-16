import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

test('NI-02 read_file on a temp workspace round-trips', async (t) => {
  const host = startHost();
  t.after(() => host.kill());
  writeFileSync(join(host.root, 'note.txt'), 'café\nline two');
  host.send({ v: 1, kind: 'call', id: 'r1', tool: 'read_file', args: { path: 'note.txt' } });
  const result = await host.receive();
  assert.equal(result.kind, 'result');
  assert.equal(result.id, 'r1');
  assert.equal(result.ok, true);
  assert.equal(result.data.content, '1\tcafé\n2\tline two');
});

test('NI-03 run_ps printing lots of text does not corrupt framing', async (t) => {
  const host = startHost();
  t.after(() => host.kill());
  host.send({ v: 1, kind: 'call', id: 'big', tool: 'run_ps',
    args: { command: "1..20000 | ForEach-Object { \"line $_ with some padding text\" }; Write-Host 'host noise'" } });
  host.send({ v: 1, kind: 'call', id: 'after', tool: 'list_dir', args: {} });
  const big = await host.receive(60000);
  const after = await host.receive();
  assert.equal(big.id, 'big');
  assert.equal(big.ok, true);
  assert.equal(big.data.truncated, true);
  assert.match(big.data.stdout, /^line 1 with/);
  assert.match(big.data.stdout, /host noise\s*$/);
  assert.equal(after.id, 'after');
  assert.equal(host.leftoverBytes(), 0);
});

test('NI-04 closing stdin makes the host exit within 2 s', async (t) => {
  const host = startHost();
  t.after(() => host.kill());
  host.send({ v: 1, kind: 'hello' });
  await host.receive();
  const closedAt = Date.now();
  host.close();
  const code = await Promise.race([host.exited, new Promise(r => setTimeout(() => r('timeout'), 5000))]);
  assert.notEqual(code, 'timeout', 'host did not exit');
  assert.ok(Date.now() - closedAt < 2000, `took ${Date.now() - closedAt} ms`);
});
