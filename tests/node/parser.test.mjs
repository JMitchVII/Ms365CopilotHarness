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
