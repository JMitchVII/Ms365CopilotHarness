// Everything that knows about Copilot's page structure lives here. Selectors use only data-*, role, aria-*
// and fai-/scriptor- classes; the hashed CSS classes change between Copilot builds.

export const SELECTORS = {
  turn: '[data-testid="m365-chat-llm-web-ui-chat-message"][data-message-index]',
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
  return { lang, text: lines.join('\n'), incomplete: false };
}

// Plain text of a rendered reply, keeping paragraph breaks. Code blocks come back as fenced blocks.
function textOf(node) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType !== 1) return '';
  if (node.matches(SELECTORS.codeBlock)) {
    const { lang, text } = readCodeBlock(node);
    return `\n${FENCE}${lang}\n${text}\n${FENCE}\n`;
  }
  if (node.tagName === 'BR') return '\n';
  const inner = [...node.childNodes].map(textOf).join('');
  return BLOCK_TAGS.has(node.tagName) ? `\n${inner}\n` : inner;
}

const tidy = text => text.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

export function readLatestReply(doc) {
  const turns = doc.querySelectorAll(SELECTORS.turn);
  const turn = turns[turns.length - 1];
  const reply = turn?.querySelector(SELECTORS.reply);
  if (!reply) return null;
  const article = reply.closest(SELECTORS.replyArticle);
  const busy = article?.getAttribute('aria-busy') === 'true'
    || reply.getAttribute('aria-hidden') === 'true'
    || !!doc.querySelector(SELECTORS.stopButton);
  return { messageId: reply.getAttribute('data-message-id'), role: 'assistant', text: tidy(textOf(reply)), busy };
}
