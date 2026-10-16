// The fake Copilot page must look like the real one to the adapter, or E2E runs on it prove nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { readLatestReply, checkPage, injectAndSend } from '../../extension/content/copilot-adapter.js';
import { parseReply } from '../../extension/lib/parser.js';

const html = await readFile(new URL('../../extension/test-pages/fake-copilot.html', import.meta.url), 'utf8');
const { tools: TOOLS } = JSON.parse(await readFile(new URL('../../protocol/tools.json', import.meta.url), 'utf8'));
const until = async (check, ms = 5000) => {
  for (let t = 0; t < ms; t += 20) { const v = check(); if (v) return v; await new Promise(r => setTimeout(r, 20)); }
  throw new Error('condition not met');
};

test('FK-01 the adapter can drive the fake page: paste, send, see it stream, read the finished reply', async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/fake-copilot.html?script=read' });
  const doc = dom.window.document;
  // jsdom has no innerText; the page uses it to read the composer.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  assert.deepEqual(checkPage(doc), { ok: true, missing: [] });

  assert.deepEqual(await injectAndSend(doc, 'Please list the workspace'), { ok: true });
  await until(() => readLatestReply(doc)?.busy);
  const reply = await until(() => { const r = readLatestReply(doc); return r && !r.busy && r; });

  const { calls, errors } = parseReply(reply.text, TOOLS);
  assert.deepEqual(errors, []);
  assert.equal(calls.length, 1);
  assert.match(calls[0].id, /^c1-/);
  assert.deepEqual({ ...calls[0], id: 'c1' }, { id: 'c1', tool: 'list_dir', args: {} });
  dom.window.close();
});

test('FK-02 like the real page, the fake shows its send button only once the editor has text', async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/fake-copilot.html' });
  const doc = dom.window.document;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  assert.equal(doc.querySelector('.fai-SendButton'), null);
  assert.deepEqual(await injectAndSend(doc, 'hello'), { ok: true });
  dom.window.close();
});

test('FK-03 each page load gives the scripted calls fresh ids, so a rerun is not skipped by the ledger', async () => {
  const ids = () => {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/fake-copilot.html?script=read' });
    const found = dom.window.fakeCopilot.queue.join('\n').match(/"id":"[^"]+"/g);
    dom.window.close();
    return found;
  };
  const first = ids();
  const second = ids();
  assert.equal(first.length, 4);
  assert.notDeepEqual(first, second);
});
