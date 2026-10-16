import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

// Chrome only loads files inside extension/. Run `npm run sync` after editing the sources.
test('SY-01 the extension carries up-to-date copies of tools.json and the bootstrap', async () => {
  assert.equal(await read('extension/generated/tools.json'), await read('protocol/tools.json'), 'run npm run sync');
  assert.equal(await read('extension/generated/bootstrap.md'), await read('prompt/bootstrap.md'), 'run npm run sync');
});
