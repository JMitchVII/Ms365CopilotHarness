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
  assert.deepEqual(checkPage(doc), { ok: false, missing: ['input'] });

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

test('CA-09 a second capture (idle reply, json block labelled "JSON") reads as a finished json fence', async () => {
  const doc = await fixture('chat-idle-json.html');
  const reply = readLatestReply(doc);
  assert.equal(reply.messageId, '23290a81-392b-4804-9830-eda87b9fdb4f');
  assert.equal(reply.busy, false);
  assert.equal(reply.incomplete, false);
  assert.ok(reply.text.includes('```json\n{\n  "name": "Alice",'), reply.text);
  assert.ok(reply.text.includes('    "country": "Australia"\n  }\n}\n```'), reply.text);
});

test('CA-10 the send button only exists once the editor has text: injector waits for it', async () => {
  const { doc, input, log } = await idlePage();
  const button = doc.querySelector(SELECTORS.sendButton);
  const parent = button.parentNode;
  button.remove();
  assert.deepEqual(checkPage(doc), { ok: true, missing: [] }, 'an empty composer without a send button is normal');
  input.addEventListener('paste', () => setTimeout(() => parent.appendChild(button), 30));
  assert.deepEqual(await injectAndSend(doc, 'hello'), { ok: true });
  assert.deepEqual(log, [{ paste: 'hello' }, { click: 'hello' }]);
});

test('CA-11 a security check dialog that is in the page but not shown does not block sending', async () => {
  const { doc, log } = await idlePage();
  doc.body.insertAdjacentHTML('beforeend', '<div hidden><div role="dialog" aria-label="Security check required"></div></div>');
  assert.equal(hasSecurityCheck(doc), false, 'inside a hidden container');

  doc.querySelector('[hidden]').removeAttribute('hidden');
  const dialog = doc.querySelector(SELECTORS.securityCheck);
  dialog.checkVisibility = () => false;  // Chrome's own answer, e.g. display:none or visibility:hidden
  assert.equal(hasSecurityCheck(doc), false, 'Chrome says it is not visible');

  dialog.checkVisibility = () => true;
  assert.equal(hasSecurityCheck(doc), true, 'shown');
  assert.deepEqual(log, []);
});

test('CA-12 a new chat has no feed until the first message: only the message box is required', async () => {
  const doc = new JSDOM('<main><h1>Hi, what can I help you with?</h1>'
    + '<span role="textbox" contenteditable="true" id="m365-chat-editor-target-element"></span></main>').window.document;
  assert.deepEqual(checkPage(doc), { ok: true, missing: [] });
  assert.equal(readLatestReply(doc), null);
});

// Like Copilot's editor turning markdown into formatting: fences, headings and emphasis marks drop out of the text.
async function markdownEditorPage() {
  const { doc, input, log } = await idlePage();
  const fresh = input.cloneNode(true);  // drop idlePage's plain-copy listener
  input.replaceWith(fresh);
  fresh.addEventListener('paste', e => {
    const text = e.clipboardData.getData('text/plain');
    log.push({ paste: text });
    setTimeout(() => { fresh.textContent = text.replace(/[`#*]/g, ''); }, 10);
  });
  return { doc, input: fresh, log };
}

test('CA-13 sends when the editor shows the text minus markdown symbols', async () => {
  const { doc, log } = await markdownEditorPage();
  doc.querySelector(SELECTORS.sendButton).addEventListener('click', () => log.push({ click: true }));
  const text = '## How to work\n\n```json\n{"w365":1,"id":"c0"}\n```\nUse **small** steps.';
  assert.deepEqual(await injectAndSend(doc, text), { ok: true });
  assert.ok(log.some(e => e.click));
});

test('CA-14 text that arrived but does not match is reported with how much arrived, and not sent', async () => {
  const { doc, input, log } = await idlePage();
  const fresh = input.cloneNode(true);
  input.replaceWith(fresh);
  fresh.addEventListener('paste', e => { setTimeout(() => { fresh.textContent = e.clipboardData.getData('text/plain').slice(0, 5); }, 10); });
  const outcome = await injectAndSend(doc, 'abcdefghij', { timeoutMs: 100 });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /^paste-mismatch \(got 5 of 10 characters\)/);
  assert.deepEqual(log.filter(e => e.click), []);
});

test('CA-15 a mismatch shows where the editor text first differs from what was pasted', async () => {
  const { doc, input } = await idlePage();
  const fresh = input.cloneNode(true);
  input.replaceWith(fresh);
  fresh.addEventListener('paste', e => {
    setTimeout(() => { fresh.textContent = e.clipboardData.getData('text/plain').replace('"w365":1', 'w365:1'); }, 10);
  });
  const outcome = await injectAndSend(doc, 'Call tools like {"w365":1,"id":"c0"} and wait.', { timeoutMs: 100 });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /^paste-mismatch \(got 39 of 41 characters\)/);
  assert.match(outcome.reason, /expected «"w365":1,"id":"c0"}andwait\.» but box has «w365:1,"id":"c0"}andwait\.»/);
});
