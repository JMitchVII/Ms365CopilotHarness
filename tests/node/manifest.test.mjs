import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const EXT = new URL('../../extension/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', EXT), 'utf8'));

// The installer needs the extension id up front; the manifest key pins it.
export const EXTENSION_ID = 'mibjgjdclpgkohlepnkfpemcddpbcjbb';

test('MF-01 the manifest key gives the fixed extension id', () => {
  const hex = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  const id = [...hex].map(h => String.fromCharCode(97 + parseInt(h, 16))).join('');
  assert.equal(id, EXTENSION_ID);
});

test('MF-02 every file the manifest names exists, and Copilot is a host permission', async () => {
  const files = [
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    ...manifest.content_scripts.flatMap(c => c.js),
  ];
  for (const file of files) await access(new URL(file, EXT));
  assert.ok(manifest.host_permissions.includes('https://m365.cloud.microsoft/*'));
  assert.ok(manifest.permissions.includes('nativeMessaging'));
});
