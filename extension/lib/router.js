// Turns one completed Copilot reply into the message to paste back: parse, apply policy, run, format.
import { parseReply } from './parser.js';
import { formatResults, errorResult } from './formatter.js';
import { decide } from './policy.js';

const denied = call => ({
  id: call.id, ok: false, error: { code: 'E_DENIED', message: 'The user declined this call. Ask them or try another way.' },
});

export const DEFAULT_MAX_AUTO_TURNS = 25;

export function createRouter({ tools, transport, ui, ledger, getMode, maxAutoTurns = DEFAULT_MAX_AUTO_TURNS }) {
  const tierOf = new Map(tools.map(t => [t.name, t.tier]));
  let autoTurns = 0;  // replies answered automatically since the user last typed
  let stopCurrent = () => {};  // set while a reply is being handled

  // Races a promise against the Stop button.
  const STOPPED = Symbol('stopped');
  let stopped = Promise.resolve();
  const orStop = p => Promise.race([p, stopped]);

  // Handles a tool the extension owns. Returns a result, or null when there is nothing to report.
  async function runUiTool(call, state) {
    if (call.tool === 'ask_user') {
      const answer = await ui.askUser(call);
      return { id: call.id, ok: true, data: { answer } };
    }
    if (call.tool === 'task_done') {
      ui.taskDone(call.args.summary);
      state.done = true;
      return null;
    }
    return null;
  }

  // Transport failures become results. Errors may carry a protocol code (e.g. E_TIMEOUT); others are E_TRANSPORT.
  async function sendToAgent(call) {
    try {
      return await transport.send(call);
    } catch (e) {
      const code = /^E_[A-Z_]+$/.test(e?.code) ? e.code : 'E_TRANSPORT';
      if (code === 'E_TRANSPORT') ui.status('disconnected');
      return { id: call.id, ok: false, error: { code, message: String(e?.message ?? e) } };
    }
  }

  async function handleReply({ conversation, messageId = '', text }) {
    const { calls, errors } = parseReply(text, tools);
    if (calls.length + errors.length > 0 && autoTurns >= maxAutoTurns) {
      // Loop guard: nothing runs (or is ledgered) until the user says to go on.
      if (!(await ui.confirmContinue(autoTurns))) return { message: null, done: false, paused: true };
      autoTurns = 0;
    }
    stopped = new Promise(resolve => { stopCurrent = () => resolve(STOPPED); });
    const stoppedResult = { message: null, done: false, stopped: true };
    const mode = await getMode();
    const state = { done: false };
    const results = [];
    for (const call of calls) {
      if (await ledger.has(conversation, call.id)) continue;
      // Marked before running: a call must never run twice, even if we crash part way.
      await ledger.markDone(conversation, call.id);
      const decision = decide(mode, tierOf.get(call.tool));
      if (decision === 'ui') {
        const result = await orStop(runUiTool(call, state));
        if (result === STOPPED) return stoppedResult;
        if (result) results.push(result);
        continue;
      }
      if (decision === 'ask') {
        const approved = await orStop(ui.requestApproval(call));
        if (approved === STOPPED) return stoppedResult;
        if (!approved) {
          results.push(denied(call));
          continue;
        }
      }
      const result = await orStop(sendToAgent(call));
      if (result === STOPPED) {
        transport.cancel(call.id);
        return stoppedResult;
      }
      results.push(result);
    }
    for (const error of errors) {
      // Errors without a call id are keyed by reply + block so they are reported once per reply.
      const key = error.id ?? `${messageId}#block-${error.block}`;
      if (await ledger.has(conversation, key)) continue;
      await ledger.markDone(conversation, key);
      results.push(errorResult(error));
    }
    if (results.length) autoTurns++;
    return { message: results.length ? formatResults(results) : null, done: state.done };
  }

  return {
    handleReply,
    resetTurns() { autoTurns = 0; },
    // Kill switch: abandon the reply being handled, cancelling its pending approval or in-flight call.
    stop() { stopCurrent(); },
  };
}
