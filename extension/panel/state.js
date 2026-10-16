// Side panel state, kept apart from the DOM so it can be tested. The view renders `view()`;
// `send` posts messages to the service worker; `handle` receives the service worker's events.
import { loadMode, saveMode } from '../lib/policy.js';

export function createPanelState({ storage, send }) {
  const state = { mode: 'tiered', approvals: [], questions: [] };

  function answerApproval(requestId, approved) {
    state.approvals = state.approvals.filter(a => a.requestId !== requestId);
    send({ type: 'approval', requestId, approved });
  }

  return {
    async load() {
      state.mode = await loadMode(storage);
    },
    async setMode(mode) {
      await saveMode(storage, mode);
      state.mode = mode;
    },
    handle(event) {
      switch (event.type) {
        case 'approval-request':
          state.approvals.push({ requestId: event.requestId, call: event.call, tier: event.tier });
          break;
        case 'question':
          state.questions.push({ requestId: event.requestId, question: event.question });
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
    view: () => structuredClone(state),
  };
}
