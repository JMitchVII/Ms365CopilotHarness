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
