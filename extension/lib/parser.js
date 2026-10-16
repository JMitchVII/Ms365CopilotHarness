// Extracts w365 tool calls from the text of a Copilot reply.

const OPEN_FENCE = /^(`{3,})\s*([\w-]*)\s*$/;

// Splits text into fenced blocks: [{ lang, body }], in document order.
export function findFences(text) {
  const lines = text.split('\n');
  const blocks = [];
  let open = null;
  for (const line of lines) {
    if (!open) {
      const m = OPEN_FENCE.exec(line);
      if (m) open = { ticks: m[1].length, lang: m[2].toLowerCase(), lines: [] };
      continue;
    }
    const close = /^(`{3,})\s*$/.exec(line);
    if (close && close[1].length >= open.ticks) {
      blocks.push({ lang: open.lang, body: open.lines.join('\n') });
      open = null;
    } else {
      open.lines.push(line);
    }
  }
  return blocks;
}

export function parseReply(text) {
  const calls = [];
  const errors = [];
  findFences(text).forEach((block, index) => {
    if (block.lang !== 'w365') return;
    let obj;
    try {
      obj = JSON.parse(block.body);
    } catch (e) {
      errors.push({ code: 'E_PARSE', block: index, message: `Block ${index} is not valid JSON: ${e.message}` });
      return;
    }
    if (typeof obj.id !== 'string' || obj.id === '') {
      errors.push({ code: 'E_BAD_ARGS', block: index, message: `Block ${index}: call is missing a string "id"` });
      return;
    }
    calls.push({ id: obj.id, tool: obj.tool, args: obj.args });
  });
  return { calls, errors };
}
