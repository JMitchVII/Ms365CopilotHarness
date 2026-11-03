// Side panel state, kept apart from the DOM so it can be tested. The view renders `view()`;
// `send` posts messages to the service worker; `handle` receives the service worker's events.
import { loadMode, saveMode, loadCheckLines, saveCheckLines } from '../lib/policy.js';

export const TRANSPORTS = ['native', 'file'];
const TRANSPORT_KEY = 'transport';
const LOG_LIMIT = 200;

export function createPanelState({ storage, send }) {
  const state = { mode: 'tiered', checkLines: true, transport: 'native', status: 'unknown', approvals: [], questions: [], log: [],
    confirm: null, done: null };

  // One row per call (conversation + id), moved to the bottom on every update so a retried call shows as newest.
  // Rows without a tool (parse errors) can't be retried, nor can calls still waiting or running.
  function logCall({ call, conversation }, fields) {
    const key = `${conversation ?? ''}\n${call.id}`;
    const at = state.log.findIndex(e => e.key === key);
    if (at >= 0) state.log.splice(at, 1);
    const finished = fields.light !== 'waiting' && fields.light !== 'running';
    state.log.push({ key, id: call.id, tool: call.tool, call, conversation, ...fields, retryable: finished && !!call.tool });
    if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
  }

  function answerApproval(requestId, approved) {
    state.approvals = state.approvals.filter(a => a.requestId !== requestId);
    send({ type: 'approval', requestId, approved });
  }

  return {
    async load() {
      state.mode = await loadMode(storage);
      state.checkLines = await loadCheckLines(storage);
      const { [TRANSPORT_KEY]: transport } = await storage.get(TRANSPORT_KEY);
      state.transport = TRANSPORTS.includes(transport) ? transport : 'native';
    },
    async setMode(mode) {
      await saveMode(storage, mode);
      state.mode = mode;
    },
    async setCheckLines(on) {
      await saveCheckLines(storage, on);
      state.checkLines = !!on;
    },
    async setTransport(transport) {
      if (!TRANSPORTS.includes(transport)) throw new Error(`Unknown transport "${transport}"`);
      await storage.set({ [TRANSPORT_KEY]: transport });
      state.transport = transport;
    },
    handle(event) {
      switch (event.type) {
        case 'approval-request':
          state.approvals.push({ requestId: event.requestId, call: event.call, tier: event.tier });
          break;
        case 'question':
          state.questions.push({ requestId: event.requestId, question: event.question });
          break;
        case 'status':
          state.status = event.status;
          break;
        case 'confirm-continue':
          state.confirm = { requestId: event.requestId, turns: event.turns };
          break;
        case 'task-done':
          state.done = event.summary;
          break;
        case 'call-phase':
          logCall(event, { light: event.phase === 'running' ? 'running' : 'waiting', ok: null, summary: event.phase });
          break;
        case 'activity':
          logCall(event, { light: event.ok ? 'ok' : /^E_DENIED\b/.test(event.summary ?? '') ? 'denied' : 'error',
            ok: event.ok, summary: event.summary });
          break;
      }
    },
    approve: requestId => answerApproval(requestId, true),
    deny: requestId => answerApproval(requestId, false),
    approveAll() {
      for (const { requestId } of [...state.approvals]) answerApproval(requestId, true);
    },
    answer(requestId, text) {
      state.questions = state.questions.filter(q => q.requestId !== requestId);
      send({ type: 'answer', requestId, text });
    },
    // Loop guard: carry on with automatic turns, or not.
    continueRun(go) {
      if (!state.confirm) return;
      send({ type: 'continue', requestId: state.confirm.requestId, go });
      state.confirm = null;
    },
    // For a stalled agent: the service worker fails its current call and starts a fresh host.
    restartAgent() { send({ type: 'restart-agent' }); },
    // Kill switch. The service worker cancels the router's pending work; prompts here are now stale.
    stop() {
      state.approvals = [];
      state.questions = [];
      state.confirm = null;
      send({ type: 'stop' });
    },
    view: () => structuredClone(state),
  };
}
