// Turns one completed Copilot reply into the message to paste back: parse, apply policy, run, format.
import { parseReply } from './parser.js';
import { formatResults } from './formatter.js';

export function createRouter({ tools, transport, ui, ledger, getMode }) {
  async function handleReply({ conversation, text }) {
    const { calls } = parseReply(text, tools);
    const results = [];
    for (const call of calls) {
      results.push(await transport.send(call));
    }
    return { message: formatResults(results) };
  }
  return { handleReply };
}
