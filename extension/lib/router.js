// Turns one completed Copilot reply into the message to paste back: parse, apply policy, run, format.
import { parseReply } from './parser.js';
import { formatResults, errorResult } from './formatter.js';
import { decide } from './policy.js';

const denied = call => ({
  id: call.id, ok: false, error: { code: 'E_DENIED', message: 'The user declined this call. Ask them or try another way.' },
});

export function createRouter({ tools, transport, ui, ledger, getMode }) {
  const tierOf = new Map(tools.map(t => [t.name, t.tier]));

  async function handleReply({ conversation, messageId = '', text }) {
    const { calls, errors } = parseReply(text, tools);
    const mode = await getMode();
    const results = [];
    for (const call of calls) {
      if (await ledger.has(conversation, call.id)) continue;
      // Marked before running: a call must never run twice, even if we crash part way.
      await ledger.markDone(conversation, call.id);
      if (decide(mode, tierOf.get(call.tool)) === 'ask' && !(await ui.requestApproval(call))) {
        results.push(denied(call));
        continue;
      }
      results.push(await transport.send(call));
    }
    for (const error of errors) {
      // Errors without a call id are keyed by reply + block so they are reported once per reply.
      const key = error.id ?? `${messageId}#block-${error.block}`;
      if (await ledger.has(conversation, key)) continue;
      await ledger.markDone(conversation, key);
      results.push(errorResult(error));
    }
    return { message: results.length ? formatResults(results) : null };
  }
  return { handleReply };
}
