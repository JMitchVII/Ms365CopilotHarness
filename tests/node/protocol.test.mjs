import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const TOOLS_URL = new URL('../../protocol/tools.json', import.meta.url);
const TIERS = ['read', 'write', 'exec', 'ui'];
const ARG_TYPES = ['string', 'integer', 'boolean'];

async function loadTools() {
  return JSON.parse(await readFile(TOOLS_URL, 'utf8'));
}

test('PR-01 tools.json loads and every tool has name, tier and args schema', async () => {
  const { tools } = await loadTools();

  assert.ok(Array.isArray(tools) && tools.length > 0, 'tools must be a non-empty array');

  for (const tool of tools) {
    assert.match(tool.name, /^[a-z_]+$/, `bad tool name: ${tool.name}`);
    assert.ok(TIERS.includes(tool.tier), `${tool.name}: tier must be one of ${TIERS}`);
    assert.equal(typeof tool.args, 'object', `${tool.name}: args must be an object`);
    for (const [argName, spec] of Object.entries(tool.args)) {
      assert.ok(ARG_TYPES.includes(spec.type), `${tool.name}.${argName}: bad type ${spec.type}`);
      assert.equal(typeof spec.required, 'boolean', `${tool.name}.${argName}: required must be boolean`);
    }
  }

  const names = tools.map(t => t.name);
  assert.equal(new Set(names).size, names.length, 'tool names must be unique');
});
