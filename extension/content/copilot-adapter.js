// Everything that knows about Copilot's page structure lives here. Selectors use only data-*, role, aria-*
// and fai-/scriptor- classes; the hashed CSS classes change between Copilot builds.

export const SELECTORS = {
  feed: '[role="feed"]',
  input: '#m365-chat-editor-target-element',
  sendButton: '.fai-SendButton',
  securityCheck: '[role="dialog"][aria-label="Security check required"]',
  turn:'[data-testid="m365-chat-llm-web-ui-chat-message"][data-message-index]',
  reply: '[data-testid="copilot-message-div"] [data-testid="markdown-reply"][data-message-id]',
  replyArticle: '.fai-CopilotMessage',
  stopButton: 'button[aria-label="Stop generating"]',
  codeBlock: '.scriptor-component-code-block',
  codeLabel: '[data-testid="one-copilot-code-identity"] span',
  codeLine: '[data-line-index]',
};

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'PRE', 'TABLE', 'TR', 'BLOCKQUOTE']);
const FENCE = '```';

// A rendered code block: { lang, text }. Copilot shows the fence language as a display name ("JSON").
export function readCodeBlock(block) {
  const lang = (block.querySelector(SELECTORS.codeLabel)?.textContent ?? '').trim().toLowerCase();
  const rows = [...block.querySelectorAll(SELECTORS.codeLine)]
    .map(row => ({ index: Number(row.getAttribute('data-line-index')), row }))
    .sort((a, b) => a.index - b.index);
  const lines = rows.map(({ row }) =>
    row.getAttribute('data-line-empty') === 'true' ? '' : row.textContent.replace(/ /g, ' '));
  // The block is virtualized: rows scrolled out of view may not be in the DOM. A gap in the indexes means
  // we can't trust the text. (Rows missing from the very end can't be detected this way.)
  const incomplete = rows.some(({ index }, i) => index !== i);
  return { lang, text: lines.join('\n'), incomplete };
}

// Plain text of a rendered reply, keeping paragraph breaks. Code blocks come back as fenced blocks;
// any incomplete block sets state.incomplete.
function textOf(node, state) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType !== 1) return '';
  if (node.matches(SELECTORS.codeBlock)) {
    const { lang, text, incomplete } = readCodeBlock(node);
    if (incomplete) state.incomplete = true;
    return `\n${FENCE}${lang}\n${text}\n${FENCE}\n`;
  }
  if (node.tagName === 'BR') return '\n';
  const inner = [...node.childNodes].map(child => textOf(child, state)).join('');
  return BLOCK_TAGS.has(node.tagName) ? `\n${inner}\n` : inner;
}

const tidy = text => text.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// Checks the elements the harness can't work without. A non-empty `missing` means Copilot's layout changed
// and SELECTORS needs updating; the panel shows "selector broken". The send button isn't checked: Copilot only
// shows it once the editor has text.
export function checkPage(doc) {
  const missing = ['feed', 'input'].filter(key => !doc.querySelector(SELECTORS[key]));
  return { ok: missing.length === 0, missing };
}

// Copilot can keep the dialog in the page while it isn't showing, so only a rendered one counts.
function isShown(el) {
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;
  if (typeof el.checkVisibility !== 'function') return true;  // jsdom: the attribute checks are all we have
  return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

export function hasSecurityCheck(doc) {
  return [...doc.querySelectorAll(SELECTORS.securityCheck)].some(isShown);
}

// Copilot's editor is Lexical, which ignores text set directly; it does accept a paste event.
function makePasteEvent(win, text) {
  if (win.DataTransfer && win.ClipboardEvent) {
    const data = new win.DataTransfer();
    data.setData('text/plain', text);
    return new win.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  }
  // Fallback (and tests): a plain event carrying clipboardData, which is all Lexical reads.
  const event = new win.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { types: ['text/plain'], getData: type => (type === 'text/plain' ? text : '') },
  });
  return event;
}

// Lexical renders each line as its own <p>, so newlines don't survive in textContent: compare without whitespace.
const normalise = s => s.replace(/\s+/g, '');

// Pastes `text` into the composer and clicks send once the editor shows it and the send button has appeared.
// Never sends half a message.
export async function injectAndSend(doc, text, { timeoutMs = 3000, pollMs = 25 } = {}) {
  const input = doc.querySelector(SELECTORS.input);
  if (!input) return { ok: false, reason: 'selector-broken' };
  if (hasSecurityCheck(doc)) return { ok: false, reason: 'security-check' };
  if (doc.querySelector(SELECTORS.stopButton)) return { ok: false, reason: 'busy' };
  input.focus?.();
  input.dispatchEvent(makePasteEvent(doc.defaultView, text));
  const want = normalise(text);
  let pasted = false;
  for (let waited = 0; waited <= timeoutMs; waited += pollMs) {
    pasted = normalise(input.textContent) === want;
    const send = doc.querySelector(SELECTORS.sendButton);
    if (pasted && send) {
      send.click();
      return { ok: true };
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  return { ok: false, reason: pasted ? 'selector-broken' : 'paste-ignored' };
}

export function readLatestReply(doc) {
  const turns = doc.querySelectorAll(SELECTORS.turn);
  const turn = turns[turns.length - 1];
  const reply = turn?.querySelector(SELECTORS.reply);
  if (!reply) return null;
  const article = reply.closest(SELECTORS.replyArticle);
  const busy = article?.getAttribute('aria-busy') === 'true'
    || reply.getAttribute('aria-hidden') === 'true'
    || !!doc.querySelector(SELECTORS.stopButton);
  const state = { incomplete: false };
  const text = tidy(textOf(reply, state));
  return { messageId: reply.getAttribute('data-message-id'), role: 'assistant', text, busy, incomplete: state.incomplete };
}
