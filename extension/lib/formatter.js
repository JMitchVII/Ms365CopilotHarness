// Turns tool results into the text pasted back into the Copilot chat.

export const DEFAULT_CAP = 12_000;
export const TRUNCATION_HINT =
  'Output truncated to fit the chat. Use read_file offset/limit, a narrower search, or filter run_ps output.';

export function formatResult(result) {
  return '```w365-result\n' + JSON.stringify(result) + '\n```';
}

// Converts a parser error ({code, message, block, id?}) into a result Copilot can match to its call.
export function errorResult({ code, message, block, id }) {
  return { id: id ?? `block-${block}`, ok: false, error: { code, message } };
}

// All results for one Copilot turn, as a single message no longer than `cap` characters.
// Over the cap, the longest string values are cut down and their results flagged truncated.
export function formatResults(results, { cap = DEFAULT_CAP } = {}) {
  let text = join(results);
  if (text.length <= cap) return text;

  const copy = structuredClone(results);
  for (let i = 0; i < 100 && text.length > cap; i++) {
    const leaf = longestString(copy);
    if (!leaf || leaf.value.length === 0) break;
    const result = copy[leaf.index];
    const slack = result.truncated ? 0 : TRUNCATION_HINT.length + 40;
    const keep = Math.max(0, leaf.value.length - (text.length - cap) - slack);
    leaf.set(leaf.value.slice(0, keep));
    result.truncated = true;
    result.hint = TRUNCATION_HINT;
    text = join(copy);
  }
  return text;
}

function join(results) {
  return results.map(formatResult).join('\n\n');
}

// Finds the longest string inside any result's data, with a setter to replace it.
function longestString(results) {
  let best = null;
  const visit = (holder, key, index) => {
    const value = holder[key];
    if (typeof value === 'string') {
      if (!best || value.length > best.value.length) {
        best = { value, index, set: v => { holder[key] = v; } };
      }
    } else if (value && typeof value === 'object') {
      for (const k of Object.keys(value)) visit(value, k, index);
    }
  };
  results.forEach((r, index) => { if (r.data !== undefined) visit(r, 'data', index); });
  return best;
}
