import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../../extension/lib/policy.js';

const AGENT_TIERS = ['read', 'write', 'exec'];

test('PO-01 fullAuto runs every agent tier', () => {
  for (const tier of AGENT_TIERS) assert.equal(decide('fullAuto', tier), 'run', tier);
});
