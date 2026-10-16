// Extracts w365 tool calls from the text of a Copilot reply.

const OPEN_FENCE = /^(`{3,})\s*([^`]*?)\s*$/;
const MARKER_HINT = /["“”]w365["“”]\s*:/;

// Splits text into fenced blocks: [{ lang, body }], in document order.
export function findFences(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
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

// Copilot sometimes turns straight quotes into smart quotes. Only repair them if the JSON doesn't parse as-is,
// so smart quotes inside valid string values are kept.
function parseLenient(body) {
  try {
    return JSON.parse(body);
  } catch (e) {
    const repaired = body.replace(/[“”„‟″]/g, '"');
    if (repaired === body) throw e;
    try { return JSON.parse(repaired); } catch { throw e; }
  }
}

// Returns a description of the first problem with args, or null if they match the tool's schema.
function checkArgs(spec, args) {
  for (const [name, arg] of Object.entries(spec.args)) {
    if (!(name in args)) {
      if (arg.required) return `missing required arg "${name}"`;
      continue;
    }
    if (!TYPE_CHECKS[arg.type](args[name])) return `arg "${name}" must be ${arg.type}`;
  }
  return null;
}

const TYPE_CHECKS = {
  string: v => typeof v === 'string',
  integer: v => Number.isInteger(v),
  boolean: v => typeof v === 'boolean',
};

// tools: the `tools` array from protocol/tools.json. When given, tool names and args are validated.
export function parseReply(text, tools) {
  const byName = tools ? new Map(tools.map(t => [t.name, t])) : null;
  const calls = [];
  const errors = [];
  const seenIds = new Set();
  findFences(text).forEach((block, index) => {
    // Copilot's rendered label may not be the fence tag we asked for, so any block can hold a call;
    // the "w365":1 marker is what identifies one. Our own result blocks are never calls.
    if (block.lang === 'w365-result') return;
    const tagged = block.lang === 'w365';
    let obj;
    try {
      obj = parseLenient(block.body);
    } catch (e) {
      if (tagged || MARKER_HINT.test(block.body)) {
        errors.push({ code: 'E_PARSE', block: index, message: `Block ${index} is not valid JSON: ${e.message}` });
      }
      return;
    }
    if (obj === null || typeof obj !== 'object' || obj.w365 !== 1) {
      if (tagged) {
        errors.push({ code: 'E_BAD_ARGS', block: index, message: `Block ${index}: tool calls must include "w365":1` });
      }
      return;
    }
    if (typeof obj.id !== 'string' || obj.id === '') {
      errors.push({ code: 'E_BAD_ARGS', block: index, message: `Block ${index}: call is missing a string "id"` });
      return;
    }
    if (seenIds.has(obj.id)) {
      // No `id` on this error: it would clash with the earlier call that owns the id.
      errors.push({ code: 'E_BAD_ARGS', block: index, message: `Block ${index}: duplicate id "${obj.id}" in this reply` });
      return;
    }
    seenIds.add(obj.id);
    const spec = byName && byName.get(obj.tool);
    if (byName && !spec) {
      errors.push({ code: 'E_UNKNOWN_TOOL', block: index, id: obj.id, message: `Unknown tool "${obj.tool}"` });
      return;
    }
    if (spec) {
      const problem = checkArgs(spec, obj.args ?? {});
      if (problem) {
        errors.push({ code: 'E_BAD_ARGS', block: index, id: obj.id, message: `${obj.tool}: ${problem}` });
        return;
      }
    }
    calls.push({ id: obj.id, tool: obj.tool, args: obj.args });
  });
  return { calls, errors };
}
