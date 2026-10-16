import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReply } from '../../extension/lib/parser.js';

test('PR-02 parseReply("") returns no calls and no errors', () => {
  assert.deepEqual(parseReply(''), { calls: [], errors: [] });
});

test('PR-03 plain prose with no fences yields no calls', () => {
  const reply = 'Sure, I can help with that.\nFirst I will look at the folder structure.';
  assert.deepEqual(parseReply(reply), { calls: [], errors: [] });
});

const fence = (lang, body) => '```' + lang + '\n' + body + '\n```';

test('PR-04 single w365 block with valid JSON yields one call', () => {
  const reply = 'Reading it now.\n' +
    fence('w365', '{"w365":1,"id":"t1","tool":"read_file","args":{"path":"README.md"}}') +
    '\nWaiting for the result.';
  assert.deepEqual(parseReply(reply), {
    calls: [{ id: 't1', tool: 'read_file', args: { path: 'README.md' } }],
    errors: [],
  });
});

test('PR-05 other fenced languages are ignored', () => {
  const reply = fence('powershell', 'Get-ChildItem') + '\n' + fence('json', '{"a":1}');
  assert.deepEqual(parseReply(reply), { calls: [], errors: [] });
});
