// Turns tool results into the text pasted back into the Copilot chat.

export function formatResult(result) {
  return '```w365-result\n' + JSON.stringify(result) + '\n```';
}
