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

test('FM-04 output over the cap is truncated with truncated:true and a hint, total length <= cap', () => {
  const big = 'x'.repeat(50_000);
  const results = [
    { id: 'small', ok: true, data: { content: 'keep me' } },
    { id: 'big', ok: true, data: { content: big, totalLines: 1 } },
  ];
  const cap = 2_000;
  const text = formatResults(results, { cap });
  assert.ok(text.length <= cap, `length ${text.length} > ${cap}`);

  const [small, cut] = findFences(text).map(b => JSON.parse(b.body));
  assert.deepEqual(small, results[0]);
  assert.equal(cut.truncated, true);
  assert.match(cut.hint, /offset|limit/);
  assert.ok(big.startsWith(cut.data.content) && cut.data.content.length > 500, 'keeps a useful prefix');
  assert.equal(cut.data.totalLines, 1);
  assert.equal(results[1].data.content, big, 'input is not mutated');
});

test('FM-04b output under the cap is unchanged', () => {
  const results = [{ id: 'a', ok: true, data: { content: 'hi' } }];
  assert.equal(formatResults(results, { cap: 2_000 }), formatResult(results[0]));
});

test('FM-05 content containing backticks cannot close the fence', () => {
  const content = 'before\n```\nafter ``` and `inline`';
  const result = { id: 'bt', ok: true, data: { content } };
  const text = formatResult(result);
  const blocks = findFences(text);
  assert.equal(blocks.length, 1);
  assert.ok(!blocks[0].body.includes('`'), 'no raw backticks inside the block');
  assert.deepEqual(JSON.parse(blocks[0].body), result);
});
