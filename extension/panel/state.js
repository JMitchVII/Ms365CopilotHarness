// Side panel state, kept apart from the DOM so it can be tested. The view renders `view()`;
// `send` posts messages to the service worker; `handle` receives the service worker's events.
import { loadMode, saveMode } from '../lib/policy.js';

export function createPanelState({ storage, send }) {
  const state = { mode: 'tiered' };

  return {
    async load() {
      state.mode = await loadMode(storage);
    },
    async setMode(mode) {
      await saveMode(storage, mode);
      state.mode = mode;
    },
    view: () => structuredClone(state),
  };
}
