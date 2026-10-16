// Turns one completed Copilot reply into the message to paste back: parse, apply policy, run, format.
import { parseReply } from './parser.js';
import { formatResults } from './formatter.js';
import { decide } from './policy.js';

export function createRouter({ tools, transport, ui, ledger, getMode }) {
  const tierOf = new Map(tools.map(t => [t.name, t.tier]));

  async function handleReply({ conversation, text }) {
    const { calls } = parseReply(text, tools);
    const mode = await getMode();
    const results = [];
    for (const call of calls) {
      if (decide(mode, tierOf.get(call.tool)) === 'ask') await ui.requestApproval(call);
      results.push(await transport.send(call));
    }
    return { message: formatResults(results) };
  }
  return { handleReply };
}
