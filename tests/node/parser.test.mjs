import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReply } from '../../extension/lib/parser.js';

test('PR-02 parseReply("") returns no calls and no errors', () => {
  assert.deepEqual(parseReply(''), { calls: [], errors: [] });
});
