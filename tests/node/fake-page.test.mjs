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
  assert.deepEqual(calls, [{ id: 'c1', tool: 'list_dir', args: {} }]);
  dom.window.close();
});
