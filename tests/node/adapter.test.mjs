import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { readLatestReply } from '../../extension/content/copilot-adapter.js';

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
