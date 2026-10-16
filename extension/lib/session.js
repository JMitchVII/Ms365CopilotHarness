// The service worker's wiring: content script replies -> router -> results pasted back; router questions and
// approvals -> side panel and back. Kept free of chrome.* so it can be tested; background.js supplies the I/O.
import { createRouter } from './router.js';

export function createSession({ tools, transport, ledger, getMode, bootstrap, injectInto, retryDelayMs = 1000, maxAutoTurns }) {
  const tierOf = new Map(tools.map(t => [t.name, t.tier]));
  let panel = null;
  let status = 'unknown';
  let nextRequest = 0;
  const pending = new Map();  // requestId -> { event, resolve } for prompts waiting on the panel

  function emit(event) {
    try { panel?.postMessage(event); } catch { panel = null; }  // panel closed: events are replayed on reconnect
  }

  // Sends a prompt to the panel and waits for its answer. Kept until answered so a reopened panel sees it.
  function askPanel(event) {
    const requestId = `r${++nextRequest}`;
    return new Promise(resolve => {
      const full = { ...event, requestId };
      pending.set(requestId, { event: full, resolve });
      emit(full);
    });
  }

  function answer(requestId, value) {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    entry.resolve(value);
  }

  function setStatus(s) {
    status = s;
    emit({ type: 'status', status: s });
  }

  const ui = {
    requestApproval: call => askPanel({ type: 'approval-request', call, tier: tierOf.get(call.tool) }),
    askUser: call => askPanel({ type: 'question', question: call.args.question }),
    confirmContinue: turns => askPanel({ type: 'confirm-continue', turns }),
    taskDone: summary => emit({ type: 'task-done', summary }),
    status: setStatus,
    activity: (call, result) => emit({
      type: 'activity', call, ok: result.ok,
      summary: result.ok ? 'ok' : `${result.error?.code}: ${result.error?.message ?? ''}`.slice(0, 200),
    }),
  };
  const router = createRouter({ tools, transport, ui, ledger, getMode, maxAutoTurns });

  function onPanelMessage(msg) {
    switch (msg.type) {
      case 'approval': answer(msg.requestId, !!msg.approved); break;
      case 'answer': answer(msg.requestId, String(msg.text ?? '')); break;
      case 'continue': answer(msg.requestId, !!msg.go); break;
    }
  }

  function attachPanel(port) {
    panel = port;
    port.onMessage.addListener(onPanelMessage);
    port.onDisconnect.addListener(() => { if (panel === port) panel = null; });
    emit({ type: 'status', status });
    for (const { event } of pending.values()) emit(event);
  }

  async function onReply({ tabId, conversation, messageId, text }) {
    const out = await router.handleReply({ conversation, messageId, text });
    if (out.message) await injectInto(tabId, out.message);
    return out;
  }

  return { onReply, attachPanel, setStatus };
}
