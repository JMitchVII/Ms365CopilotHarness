import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { readLatestReply, readCodeBlock, checkPage, SELECTORS, injectAndSend, hasSecurityCheck } from '../../extension/content/copilot-adapter.js';

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

test('CA-03 when the layout changes, reading returns null and checkPage names what is missing', async () => {
  const doc = new JSDOM('<main><p>Copilot was redesigned</p></main>').window.document;
  assert.equal(readLatestReply(doc), null);
  assert.deepEqual(checkPage(doc), { ok: false, missing: ['feed', 'input', 'sendButton'] });

  const real = await fixture('chat-page-streaming.html');
  assert.deepEqual(checkPage(real), { ok: true, missing: [] });
});

test('CA-06 all selectors live in one config object with the required keys', () => {
  for (const key of ['feed', 'turn', 'reply', 'replyArticle', 'stopButton', 'codeBlock', 'codeLabel', 'codeLine',
    'input', 'sendButton', 'securityCheck']) {
    assert.equal(typeof SELECTORS[key], 'string', key);
  }
});

// Copilot page with an idle composer. The fake "Lexical" copies pasted text into the editor, like the real one.
async function idlePage() {
  const doc = await fixture('chat-page-streaming.html');
  doc.querySelector('[data-message-index="1"]').remove();
  doc.querySelector(SELECTORS.stopButton).setAttribute('aria-label', 'Send');
  doc.querySelector(SELECTORS.securityCheck).remove();
  const input = doc.querySelector(SELECTORS.input);
  const log = [];
  input.addEventListener('paste', e => {
    const text = e.clipboardData.getData('text/plain');
    log.push({ paste: text });
    setTimeout(() => { input.textContent = text; }, 10);  // Lexical updates the DOM a moment later
  });
  doc.querySelector(SELECTORS.sendButton).addEventListener('click', () => log.push({ click: input.textContent }));
  return { doc, input, log };
}

test('CA-04 injector pastes the text into the editor, waits for it to appear, then clicks send', async () => {
  const { doc, log } = await idlePage();
  const payload = '```w365-result\n{"id":"t1","ok":true}\n```';
  const outcome = await injectAndSend(doc, payload);
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(log, [{ paste: payload }, { click: payload }]);
});

test('CA-04b injector gives up without sending if the editor ignores the paste', async () => {
  const { doc, log } = await idlePage();
  doc.querySelector(SELECTORS.input).replaceWith(doc.querySelector(SELECTORS.input).cloneNode(true));  // drops listener
  const outcome = await injectAndSend(doc, 'hello', { timeoutMs: 100 });
  assert.deepEqual(outcome, { ok: false, reason: 'paste-ignored' });
  assert.deepEqual(log.filter(e => e.click), []);
});

test('CA-05 injector refuses to send while Copilot is still generating', async () => {
  const { doc, log } = await idlePage();
  doc.querySelector(SELECTORS.sendButton).setAttribute('aria-label', 'Stop generating');
  assert.deepEqual(await injectAndSend(doc, 'x'), { ok: false, reason: 'busy' });
  assert.deepEqual(log, [], 'nothing pasted, nothing clicked');
});

test('CA-08 a security check dialog is detected and blocks sending', async () => {
  assert.equal(hasSecurityCheck(await fixture('chat-page-streaming.html')), true);
  const { doc, log } = await idlePage();
  assert.equal(hasSecurityCheck(doc), false);
  doc.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-label="Security check required"></div>');
  assert.deepEqual(await injectAndSend(doc, 'x'), { ok: false, reason: 'security-check' });
  assert.deepEqual(log, []);
});
