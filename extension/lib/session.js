// The service worker's wiring: content script replies -> router -> results pasted back; router questions and
// approvals -> side panel and back. Kept free of chrome.* so it can be tested; background.js supplies the I/O.
import { createRouter } from './router.js';

export function createSession({ tools, transport, ledger, getMode, bootstrap, injectInto, retryDelayMs = 1000, maxAutoTurns }) {
  const ui = {
    requestApproval: async () => false,
    askUser: async () => '',
    taskDone() {},
    status() {},
    confirmContinue: async () => false,
  };
  const router = createRouter({ tools, transport, ui, ledger, getMode, maxAutoTurns });

  async function onReply({ tabId, conversation, messageId, text }) {
    const out = await router.handleReply({ conversation, messageId, text });
    if (out.message) await injectInto(tabId, out.message);
    return out;
  }

  return { onReply };
}
