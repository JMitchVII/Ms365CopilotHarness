// Side panel state, kept apart from the DOM so it can be tested. The view renders `view()`;
// `send` posts messages to the service worker; `handle` receives the service worker's events.
import { loadMode, saveMode } from '../lib/policy.js';

export function createPanelState({ storage, send }) {
  const state = { mode: 'tiered', approvals: [] };

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
      if (event.type === 'approval-request') {
        state.approvals.push({ requestId: event.requestId, call: event.call, tier: event.tier });
      }
    },
    approve: requestId => answerApproval(requestId, true),
    deny: requestId => answerApproval(requestId, false),
    view: () => structuredClone(state),
  };
}
