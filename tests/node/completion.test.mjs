import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompletionDetector } from '../../extension/lib/completion.js';

// Snapshot of the newest Copilot reply, as the content script would read it from the page.
const snap = (at, text, extra = {}) => ({ at, messageId: 'm1', role: 'assistant', text, busy: false, ...extra });

test('CD-01 text that is still changing is not complete', () => {
  const d = createCompletionDetector({ stableMs: 1000 });
  assert.equal(d.update(snap(0, 'Hel')), null);
  assert.equal(d.update(snap(600, 'Hello')), null);
  assert.equal(d.update(snap(1200, 'Hello wor')), null);
});

test('CD-02 text stable for the window and not busy is complete, reported once', () => {
  const d = createCompletionDetector({ stableMs: 1000 });
  d.update(snap(0, 'Done.'));
  assert.equal(d.update(snap(500, 'Done.')), null);
  assert.deepEqual(d.update(snap(1000, 'Done.')), { messageId: 'm1', text: 'Done.' });
  assert.equal(d.update(snap(2000, 'Done.')), null, 'only once');
});

test('CD-03 still busy (aria-busy / Stop generating) is not complete even if text is stable', () => {
  const d = createCompletionDetector({ stableMs: 1000 });
  d.update(snap(0, 'Thinking', { busy: true }));
  assert.equal(d.update(snap(5000, 'Thinking', { busy: true })), null);
  assert.deepEqual(d.update(snap(5100, 'Thinking')), null, 'stability restarts when busy clears');
  assert.deepEqual(d.update(snap(6100, 'Thinking')), { messageId: 'm1', text: 'Thinking' });
});

test('CD-04 a new Copilot message after completion starts a fresh cycle', () => {
  const d = createCompletionDetector({ stableMs: 1000 });
  d.update(snap(0, 'First'));
  assert.ok(d.update(snap(1000, 'First')));
  assert.equal(d.update(snap(1100, 'Second', { messageId: 'm2' })), null);
  assert.deepEqual(d.update(snap(2100, 'Second', { messageId: 'm2' })), { messageId: 'm2', text: 'Second' });
});

test('CD-05 user messages (including our own pasted results) never trigger completion', () => {
  const d = createCompletionDetector({ stableMs: 1000 });
  d.update(snap(0, 'results...', { role: 'user', messageId: 'u1' }));
  assert.equal(d.update(snap(5000, 'results...', { role: 'user', messageId: 'u1' })), null);
});
