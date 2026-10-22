// The service worker's wiring: content script replies -> router -> results pasted back; router questions and
// approvals -> side panel and back. Kept free of chrome.* so it can be tested; background.js supplies the I/O.
import { createRouter } from './router.js';

export function createSession({ tools, transport, ledger, getMode, getCheckLines, bootstrap, injectInto, findCopilotTab = async () => null,
  retryDelayMs = 1000, maxAutoTurns }) {
  const tierOf = new Map(tools.map(t => [t.name, t.tier]));
  let panel = null;
  let status = 'unknown';
  let nextRequest = 0;
  let copilotTab = null;
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
  const router = createRouter({ tools, transport, ui, ledger, getMode, getCheckLines, maxAutoTurns });

  function onPanelMessage(msg) {
    switch (msg.type) {
      case 'approval': answer(msg.requestId, !!msg.approved); break;
      case 'answer': answer(msg.requestId, String(msg.text ?? '')); break;
      case 'continue': answer(msg.requestId, !!msg.go); break;
      case 'stop': stop(); break;
      case 'start-session': startSession(); break;
    }
  }

  // Kill switch: the router drops the reply it is on; every open prompt is answered "no".
  function stop() {
    router.stop();
    for (const requestId of [...pending.keys()]) {
      const { event } = pending.get(requestId);
      answer(requestId, event.type === 'question' ? '' : false);
    }
  }

  async function startSession() {
    // The noted tab is lost when Chrome restarts the service worker, so look for one.
    copilotTab ??= await findCopilotTab();
    if (copilotTab == null) return setStatus('no-copilot-tab');
    router.resetTurns();
    await paste(copilotTab, bootstrap);
  }

  // Pastes into the Copilot tab, waiting out "still generating"; other failures are shown in the panel.
  async function paste(tabId, text) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const outcome = await injectInto(tabId, text);
      if (outcome?.ok) return true;
      if (outcome?.reason !== 'busy') {
        setStatus(outcome?.reason ?? 'inject-failed');
        return false;
      }
      await new Promise(r => setTimeout(r, retryDelayMs));
    }
    setStatus('inject-failed');
    return false;
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
    copilotTab = tabId;
    if (out.message) await paste(tabId, out.message);
    return out;
  }

  return {
    onReply,
    attachPanel,
    setStatus,
    noteCopilotTab(tabId) { copilotTab = tabId; },
    // The user typed in Copilot themselves: the run of automatic turns is over.
    onUserTurn() { router.resetTurns(); },
  };
}
