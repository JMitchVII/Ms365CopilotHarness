// Approval policy: given the panel's mode and a tool's tier, decide whether a call runs or needs approval.

export function decide(mode, tier) {
  if (mode === 'fullAuto') return 'run';
  if (mode === 'tiered' && tier === 'read') return 'run';
  return 'ask';
}
