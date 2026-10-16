// Approval policy: given the panel's mode and a tool's tier, decide what happens to a call:
// 'run' (send to the agent), 'ask' (wait for approval in the panel) or 'ui' (handled by the extension).

export const MODES = ['fullAuto', 'tiered', 'approveAll'];
const AGENT_TIERS = ['read', 'write', 'exec'];

export function decide(mode, tier) {
  if (tier === 'ui') return 'ui';
  if (!AGENT_TIERS.includes(tier)) return 'ask';
  if (mode === 'fullAuto') return 'run';
  if (mode === 'tiered' && tier === 'read') return 'run';
  return 'ask';
}

const MODE_KEY = 'mode';
const DEFAULT_MODE = 'tiered';

// storage: chrome.storage.local (or anything with promise get/set).
export async function loadMode(storage) {
  const { [MODE_KEY]: mode } = await storage.get(MODE_KEY);
  return MODES.includes(mode) ? mode : DEFAULT_MODE;
}

export async function saveMode(storage, mode) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode "${mode}"`);
  await storage.set({ [MODE_KEY]: mode });
}
