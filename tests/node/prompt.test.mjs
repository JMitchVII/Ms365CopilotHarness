import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const { tools: TOOLS } = JSON.parse(await read('protocol/tools.json'));
const CUSTOM_INSTRUCTIONS_LIMIT = 4000;  // Phase 0: Copilot's custom-instructions box

const { parseReply } = await import('../../extension/lib/parser.js');

test('PM-02 every worked example in the bootstrap parses cleanly, and each tool has one', async () => {
  const { calls, errors } = parseReply(await read('prompt/bootstrap.md'), TOOLS);
  assert.deepEqual(errors, []);
  for (const tool of TOOLS) assert.ok(calls.some(c => c.tool === tool.name), `no example for ${tool.name}`);
});

test('PM-01/05 the bootstrap documents every tool with its required args', async () => {
  const bootstrap = await read('prompt/bootstrap.md');
  for (const tool of TOOLS) {
    const section = bootstrap.split(/^### /m).find(s => s.startsWith(tool.name));
    assert.ok(section, `no "### ${tool.name}" section`);
    for (const [arg, spec] of Object.entries(tool.args)) {
      if (spec.required) assert.match(section, new RegExp(`\\b${arg}\\b`), `${tool.name}: required arg ${arg} not described`);
    }
  }
});
