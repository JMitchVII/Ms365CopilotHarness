import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('PR-06 two w365 blocks yield two calls in document order', () => {
  const reply = fence('w365', '{"w365":1,"id":"a","tool":"list_dir","args":{}}') + '\nthen\n' +
    fence('w365', '{"w365":1,"id":"b","tool":"read_file","args":{"path":"x.txt"}}');
  assert.deepEqual(parseReply(reply).calls.map(c => c.id), ['a', 'b']);
});

test('PR-07 invalid JSON yields no call and an E_PARSE error with the block index', () => {
  const reply = fence('w365', '{"w365":1,"id":"a","tool":"list_dir","args":{}}') + '\n' +
    fence('w365', '{"w365":1,"id":"b", tool: oops}');
  const { calls, errors } = parseReply(reply);
  assert.deepEqual(calls.map(c => c.id), ['a']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'E_PARSE');
  assert.equal(errors[0].block, 1);
  assert.equal(typeof errors[0].message, 'string');
});

test('PR-08 missing id yields E_BAD_ARGS and no call', () => {
  const { calls, errors } = parseReply(fence('w365', '{"w365":1,"tool":"list_dir","args":{}}'));
  assert.deepEqual(calls, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'E_BAD_ARGS');
  assert.match(errors[0].message, /\bid\b/);
});

const { tools: TOOLS } = JSON.parse(
  await readFile(new URL('../../protocol/tools.json', import.meta.url), 'utf8'));

test('PR-09 unknown tool yields E_UNKNOWN_TOOL carrying the call id', () => {
  const { calls, errors } = parseReply(
    fence('w365', '{"w365":1,"id":"t9","tool":"delete_everything","args":{}}'), TOOLS);
  assert.deepEqual(calls, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'E_UNKNOWN_TOOL');
  assert.equal(errors[0].id, 't9');
  assert.match(errors[0].message, /delete_everything/);
});

test('PR-10 missing required arg yields E_BAD_ARGS naming the arg', () => {
  const { calls, errors } = parseReply(
    fence('w365', '{"w365":1,"id":"t10","tool":"read_file","args":{}}'), TOOLS);
  assert.deepEqual(calls, []);
  assert.equal(errors[0].code, 'E_BAD_ARGS');
  assert.equal(errors[0].id, 't10');
  assert.match(errors[0].message, /\bpath\b/);
});

test('PR-11 wrong arg type yields E_BAD_ARGS', () => {
  const cases = [
    '{"w365":1,"id":"a","tool":"read_file","args":{"path":5}}',
    '{"w365":1,"id":"b","tool":"read_file","args":{"path":"x","limit":"10"}}',
    '{"w365":1,"id":"c","tool":"read_file","args":{"path":"x","limit":1.5}}',
    '{"w365":1,"id":"d","tool":"edit_file","args":{"path":"x","oldText":"a","newText":"b","replaceAll":"yes"}}',
  ];
  for (const body of cases) {
    const { calls, errors } = parseReply(fence('w365', body), TOOLS);
    assert.deepEqual(calls, [], body);
    assert.equal(errors[0]?.code, 'E_BAD_ARGS', body);
  }
});

test('PR-12 duplicate id in one reply: first runs, second is E_BAD_ARGS', () => {
  const reply = fence('w365', '{"w365":1,"id":"d","tool":"list_dir","args":{}}') + '\n' +
    fence('w365', '{"w365":1,"id":"d","tool":"read_file","args":{"path":"x"}}');
  const { calls, errors } = parseReply(reply, TOOLS);
  assert.deepEqual(calls.map(c => c.tool), ['list_dir']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'E_BAD_ARGS');
  assert.equal(errors[0].block, 1);
  assert.match(errors[0].message, /duplicate/i);
});

test('PR-13 tolerates CRLF, trailing whitespace, 4-backtick fences and smart quotes', () => {
  const call = '{"w365":1,"id":"q","tool":"list_dir","args":{}}';
  const variants = {
    crlf: ('Text\n' + fence('w365', call) + '\nmore').replace(/\n/g, '\r\n'),
    trailingSpace: '```w365   \n' + call + '   \n```  ',
    fourTicks: '````w365\n' + call + '\n````',
    smartQuotes: fence('w365', call.replace(/"/g, (_, i) => (i % 2 ? '”' : '“'))),
  };
  for (const [name, reply] of Object.entries(variants)) {
    const { calls, errors } = parseReply(reply, TOOLS);
    assert.deepEqual(errors, [], name);
    assert.deepEqual(calls, [{ id: 'q', tool: 'list_dir', args: {} }], name);
  }
});

test('PR-13b smart quotes inside string values are left alone when JSON is already valid', () => {
  const body = '{"w365":1,"id":"s","tool":"write_file","args":{"path":"a.txt","content":"say “hi”"}}';
  const { calls } = parseReply(fence('w365', body), TOOLS);
  assert.equal(calls[0].args.content, 'say “hi”');
});
