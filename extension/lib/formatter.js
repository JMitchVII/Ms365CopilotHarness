// Turns tool results into the text pasted back into the Copilot chat.

export function formatResult(result) {
  return '```w365-result\n' + JSON.stringify(result) + '\n```';
}

// Converts a parser error ({code, message, block, id?}) into a result Copilot can match to its call.
export function errorResult({ code, message, block, id }) {
  return { id: id ?? `block-${block}`, ok: false, error: { code, message } };
}
