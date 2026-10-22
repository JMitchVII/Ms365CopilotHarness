// Side panel view: renders panel/state.js and hosts the file transport (it needs a page for folder access).
import { createPanelState } from './state.js';
import { createFileTransport } from '../transport/file.js';
import { saveSharedFolder, loadSharedFolder } from '../transport/file-handle-store.js';
import { idbKv } from '../transport/idb-kv.js';

const $ = id => document.getElementById(id);
const port = chrome.runtime.connect({ name: 'panel' });
const panel = createPanelState({ storage: chrome.storage.local, send: msg => port.postMessage(msg) });

// --- File transport (runs here, relayed by the service worker) -----------------------------------------------

let sharedDir = null;
let fileTransport = null;

async function useFolder(dir) {
  sharedDir = dir;
  fileTransport = dir ? createFileTransport({ dir, onStatus: status => { panel.handle({ type: 'status', status }); render(); } }) : null;
  $('folder-name').textContent = dir ? dir.name : 'No folder chosen';
}

port.onMessage.addListener(async msg => {
  if (msg.type === 'file-send') {
    try {
      if (!fileTransport) throw Object.assign(new Error('Choose the shared folder in the side panel first'), { code: 'E_TRANSPORT' });
      const result = await fileTransport.send(msg.call);
      port.postMessage({ type: 'file-result', id: msg.call.id, result });
    } catch (e) {
      port.postMessage({ type: 'file-result', id: msg.call.id, error: { code: e.code ?? 'E_TRANSPORT', message: e.message } });
    }
    return;
  }
  if (msg.type === 'file-cancel') {
    fileTransport?.cancel(msg.id);
    return;
  }
  panel.handle(msg);
  render();
});

$('pick-folder').addEventListener('click', async () => {
  const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
  await saveSharedFolder(idbKv, dir);
  await useFolder(dir);
  $('grant-folder').hidden = true;
});

$('grant-folder').addEventListener('click', async () => {
  if (sharedDir && (await sharedDir.requestPermission({ mode: 'readwrite' })) === 'granted') {
    $('grant-folder').hidden = true;
    await useFolder(sharedDir);
  }
});

// --- Controls ---------------------------------------------------------------------------------------------

document.querySelectorAll('input[name="mode"]').forEach(input =>
  input.addEventListener('change', async () => { await panel.setMode(input.value); render(); }));
$('check-lines').addEventListener('change', async e => { await panel.setCheckLines(e.target.checked); render(); });
$('transport').addEventListener('change', async e => { await panel.setTransport(e.target.value); render(); });
$('start').addEventListener('click', () => port.postMessage({ type: 'start-session' }));
$('stop').addEventListener('click', () => { panel.stop(); render(); });

// --- Rendering --------------------------------------------------------------------------------------------

const STATUS_CLASS = {
  connected: 'good', 'page-ok': 'good',
  disconnected: 'bad', 'selector-broken': 'bad', 'inject-failed': 'bad', 'no-copilot-tab': 'bad',
  'security-check': 'warn', 'reply-incomplete': 'warn', busy: 'warn',
};

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function render() {
  const view = panel.view();
  $('status').textContent = view.status;
  $('status').className = `status ${STATUS_CLASS[view.status.split(/[: ]/)[0]] ?? ''}`;  // e.g. 'selector-broken: input'
  document.querySelectorAll('input[name="mode"]').forEach(input => { input.checked = input.value === view.mode; });
  $('check-lines').checked = view.checkLines;
  $('transport').value = view.transport;
  $('file-controls').hidden = view.transport !== 'file';

  $('done').hidden = !view.done;
  $('done').textContent = view.done ? `Task done: ${view.done}` : '';

  $('confirm').hidden = !view.confirm;
  $('confirm').replaceChildren(...(view.confirm ? [
    el('div', { textContent: `Copilot has run ${view.confirm.turns} turns on its own. Keep going?` }),
    el('div', { className: 'row' },
      el('button', { className: 'primary', textContent: 'Keep going', onclick: () => { panel.continueRun(true); render(); } }),
      el('button', { textContent: 'Pause', onclick: () => { panel.continueRun(false); render(); } })),
  ] : []));

  $('questions').replaceChildren(...view.questions.map(q => {
    const box = el('textarea', { placeholder: 'Your answer' });
    return el('div', { className: 'card' },
      el('strong', { textContent: 'Copilot asks: ' }), el('span', { textContent: q.question }), box,
      el('div', { className: 'row' },
        el('button', { className: 'primary', textContent: 'Send answer', onclick: () => { panel.answer(q.requestId, box.value); render(); } })));
  }));

  const approvals = view.approvals.map(a => el('div', { className: 'card' },
    el('strong', { textContent: a.call.tool }), el('span', { className: 'tier', textContent: a.tier }),
    el('pre', { textContent: JSON.stringify(a.call.args, null, 2) }),
    el('div', { className: 'row' },
      el('button', { className: 'primary', textContent: 'Approve', onclick: () => { panel.approve(a.requestId); render(); } }),
      el('button', { className: 'danger', textContent: 'Deny', onclick: () => { panel.deny(a.requestId); render(); } }))));
  if (view.approvals.length > 1) {
    approvals.push(el('button', { textContent: `Approve all ${view.approvals.length}`, onclick: () => { panel.approveAll(); render(); } }));
  }
  $('approvals').replaceChildren(...approvals);

  $('log').replaceChildren(...view.log.slice().reverse().map(entry =>
    el('li', { className: entry.ok ? '' : 'fail', textContent: `${entry.id} ${entry.tool}: ${entry.summary}` })));
}

// --- Start ------------------------------------------------------------------------------------------------

await panel.load();
const saved = await loadSharedFolder(idbKv);
await useFolder(saved.dir);
$('grant-folder').hidden = !saved.needsPermission;
render();
