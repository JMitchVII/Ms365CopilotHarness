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

test('PM-03 the custom instructions state the core rules', async () => {
  const text = (await read('prompt/copilot-instructions.md')).toLowerCase();
  const rules = {
    'one code block per call': /own code block/,
    'the w365 marker': /"w365":1/,
    'unique ids': /new id|unique id|never reuse/,
    'wait for results': /wait for (the )?results/,
    'ask_user for questions and risky steps': /ask_user/,
    'finish with task_done': /task_done/,
    'wait for the bootstrap': /bootstrap/,
  };
  for (const [rule, pattern] of Object.entries(rules)) assert.match(text, pattern, rule);
});

test('PM-04/06 the custom instructions fit in Copilot\'s box', async () => {
  const text = await read('prompt/copilot-instructions.md');
  assert.ok(text.length <= CUSTOM_INSTRUCTIONS_LIMIT, `${text.length} chars > ${CUSTOM_INSTRUCTIONS_LIMIT}`);
});
