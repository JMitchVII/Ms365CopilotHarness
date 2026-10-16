// Starts agent/host.bat the way Chrome does and speaks native-messaging frames to it.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_BAT = fileURLToPath(new URL('../../../agent/host.bat', import.meta.url));

export function encodeFrame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function startHost({ root = mkdtempSync(join(tmpdir(), 'w365-ws-')) } = {}) {
  const child = spawn('cmd.exe', ['/d', '/s', '/c', HOST_BAT, 'chrome-extension://testid/'], {
    env: { ...process.env, W365_ROOT: root, W365_LOG: join(root, '..', 'w365-host-test.log') },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let buffer = Buffer.alloc(0);
  const waiting = [];
  const queued = [];
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const len = buffer.readUInt32LE(0);
      if (buffer.length < 4 + len) break;
      const msg = JSON.parse(buffer.subarray(4, 4 + len).toString('utf8'));
      buffer = buffer.subarray(4 + len);
      const next = waiting.shift();
      next ? next(msg) : queued.push(msg);
    }
  });
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
  return {
    root,
    child,
    exited,
    send: message => child.stdin.write(encodeFrame(message)),
    receive: (timeoutMs = 20000) => queued.length
      ? Promise.resolve(queued.shift())
      : new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for host message')), timeoutMs);
        waiting.push(msg => { clearTimeout(timer); resolve(msg); });
      }),
    leftoverBytes: () => buffer.length,
    close: () => child.stdin.end(),
    kill: () => { try { child.kill(); } catch { /* already gone */ } },
  };
}
