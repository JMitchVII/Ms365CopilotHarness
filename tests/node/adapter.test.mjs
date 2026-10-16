import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { readLatestReply, readCodeBlock } from '../../extension/content/copilot-adapter.js';

const fixture = async name =>
  new JSDOM(await readFile(new URL(`../../protocol/fixtures/dom/${name}`, import.meta.url), 'utf8')).window.document;

test('CA-01 reads the newest Copilot reply: id, text and busy state', async () => {
  const doc = await fixture('chat-page-streaming.html');
  const reply = readLatestReply(doc);
  assert.equal(reply.messageId, '39a4c0cc-b54e-4aeb-997a-f818aa1c3471');
  assert.equal(reply.role, 'assistant');
  assert.match(reply.text, /Keep the card focused/);
  assert.doesNotMatch(reply.text, /design guidelines for adaptive cards\?/, 'user text is not part of the reply');
  assert.equal(reply.busy, true);
});

test('CA-02 code blocks are rebuilt from their line rows, with the label as the fence language', async () => {
  const doc = await fixture('codeblock-html-preview.html');
  const block = readCodeBlock(doc.querySelector('.scriptor-component-code-block'));
  const lines = block.text.split('\n');
  assert.equal(block.lang, 'html');
  assert.equal(block.incomplete, false);
  assert.equal(lines.length, 43);
  assert.equal(lines[0], '<!DOCTYPE html>');
  assert.equal(lines[7], '', 'nbsp-only empty lines become empty strings');
  assert.equal(lines[42], '</html>');

  // In a reply, the block becomes a fence the parser can find.
  const chat = await fixture('chat-page-streaming.html');
  chat.querySelector('[data-message-index="1"]').remove();
  const reply = readLatestReply(chat);
  assert.ok(reply.text.includes('```json\n{\n  "type": "AdaptiveCard",\n\n  "version": "1.5"\n}\n```'), reply.text);
});

test('CA-07 a virtualized code block with missing line rows is flagged incomplete', async () => {
  const doc = await fixture('codeblock-html-preview.html');
  const block = doc.querySelector('.scriptor-component-code-block');
  block.querySelector('[data-line-index="20"]').remove();
  assert.equal(readCodeBlock(block).incomplete, true);

  const chat = await fixture('chat-page-streaming.html');
  chat.querySelector('[data-message-index="1"]').remove();
  chat.querySelector('[data-line-index="1"]').remove();
  assert.equal(readLatestReply(chat).incomplete, true, 'the reply as a whole is incomplete');
});
