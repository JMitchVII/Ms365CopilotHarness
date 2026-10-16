// Service worker: connects the Copilot tab (content script), the side panel and the agent transport.
// The logic lives in lib/session.js; this file only adapts chrome.* APIs to it.
import { createSession } from './lib/session.js';
import { createLedger } from './lib/ledger.js';
import { loadMode } from './lib/policy.js';
import { createNativeTransport } from './transport/native.js';

const getText = async path => (await fetch(chrome.runtime.getURL(path))).text();

// --- Transports -------------------------------------------------------------------------------------------

const native = createNativeTransport({
  connectNative: name => chrome.runtime.connectNative(name),
  getLastError: () => chrome.runtime.lastError,
  onStatus: status => ready.then(s => s.setStatus(status)),
});

// The file transport needs the File System Access API, which the service worker can't use, so it runs in the
// side panel. Calls are relayed over the panel's port.
let panelPort = null;
const fileCalls = new Map();  // call id -> { resolve, reject }
const fileProxy = {
  async send(call) {
    if (!panelPort) throw Object.assign(new Error('Open the side panel to use the file transport'), { code: 'E_TRANSPORT' });
    return new Promise((resolve, reject) => {
      fileCalls.set(call.id, { resolve, reject });
      panelPort.postMessage({ type: 'file-send', call });
    });
  },
  cancel(id) { panelPort?.postMessage({ type: 'file-cancel', id }); },
};

async function currentTransport() {
  const { transport } = await chrome.storage.local.get('transport');
  return transport === 'file' ? fileProxy : native;
}

const transport = {
  send: async call => (await currentTransport()).send(call),
  cancel: id => { native.cancel(id); fileProxy.cancel(id); },
};

// --- Session ----------------------------------------------------------------------------------------------

// Service workers can't use top-level await, so set-up is a promise every handler waits on.
const ready = (async () => {
  const { tools } = JSON.parse(await getText('generated/tools.json'));
  return createSession({
    tools,
    transport,
    ledger: createLedger(chrome.storage.session),
    getMode: () => loadMode(chrome.storage.local),
    bootstrap: await getText('generated/bootstrap.md'),
    injectInto: (tabId, text) => chrome.tabs.sendMessage(tabId, { type: 'inject', text })
      .catch(e => ({ ok: false, reason: `tab-unreachable: ${e.message}` })),
  });
})();

// --- Listeners (registered synchronously, as MV3 requires) ------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  ready.then(session => {
    switch (msg.type) {
      case 'content-ready': session.noteCopilotTab(tabId); break;
      case 'reply': session.onReply({ tabId, conversation: msg.conversation, messageId: msg.messageId, text: msg.text }); break;
      case 'user-turn': session.onUserTurn(); break;
      case 'page-status': session.setStatus(msg.status); break;
    }
  });
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'panel') return;
  panelPort = port;
  port.onMessage.addListener(msg => {
    if (msg.type !== 'file-result') return;
    const entry = fileCalls.get(msg.id);
    if (!entry) return;
    fileCalls.delete(msg.id);
    if (msg.error) entry.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
    else entry.resolve(msg.result);
  });
  port.onDisconnect.addListener(() => {
    if (panelPort !== port) return;
    panelPort = null;
    for (const [id, entry] of fileCalls) {
      entry.reject(Object.assign(new Error('Side panel closed'), { code: 'E_TRANSPORT' }));
      fileCalls.delete(id);
    }
  });
  ready.then(session => session.attachPanel(port));
});
