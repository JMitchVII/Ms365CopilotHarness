import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatResult, formatResults, errorResult } from '../../extension/lib/formatter.js';
import { findFences } from '../../extension/lib/parser.js';

test('FM-01 formatResult(ok) produces a w365-result block with compact JSON', () => {
  const result = { id: 't1', ok: true, data: { entries: [{ name: 'a.txt', type: 'file', size: 3 }] } };
  const text = formatResult(result);
  const blocks = findFences(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lang, 'w365-result');
  assert.equal(blocks[0].body, JSON.stringify(result));
});

test('FM-02 error results include code and message; parse errors without an id get a block id', () => {
  const withId = errorResult({ code: 'E_UNKNOWN_TOOL', id: 't9', block: 0, message: 'Unknown tool "x"' });
  assert.deepEqual(withId, { id: 't9', ok: false, error: { code: 'E_UNKNOWN_TOOL', message: 'Unknown tool "x"' } });

  const noId = errorResult({ code: 'E_PARSE', block: 2, message: 'bad json' });
  assert.equal(noId.id, 'block-2');

  const body = JSON.parse(findFences(formatResult(withId))[0].body);
  assert.equal(body.error.code, 'E_UNKNOWN_TOOL');
  assert.equal(body.error.message, 'Unknown tool "x"');
});

test('FM-03 multiple results become one message in call order', () => {
  const results = [
    { id: 'a', ok: true, data: { n: 1 } },
    { id: 'b', ok: false, error: { code: 'E_NOT_FOUND', message: 'nope' } },
    { id: 'c', ok: true, data: {} },
  ];
  const blocks = findFences(formatResults(results));
  assert.deepEqual(blocks.map(b => b.lang), ['w365-result', 'w365-result', 'w365-result']);
  assert.deepEqual(blocks.map(b => JSON.parse(b.body).id), ['a', 'b', 'c']);
});
