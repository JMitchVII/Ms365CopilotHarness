import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatResult } from '../../extension/lib/formatter.js';
import { findFences } from '../../extension/lib/parser.js';

test('FM-01 formatResult(ok) produces a w365-result block with compact JSON', () => {
  const result = { id: 't1', ok: true, data: { entries: [{ name: 'a.txt', type: 'file', size: 3 }] } };
  const text = formatResult(result);
  const blocks = findFences(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lang, 'w365-result');
  assert.equal(blocks[0].body, JSON.stringify(result));
});
