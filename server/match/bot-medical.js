// Experimental decision weights, not combat rules. Keep each ablation explicit for paired botbench runs.
export const MEDICAL_POLICIES = Object.freeze({
  '': null,
  'buy': { buy: 18, lineup: 0, keep: false },
  'buy-keep': { buy: 18, lineup: 0, keep: true },
  'lineup': { buy: 0, lineup: 24, keep: false },
  'complete': { buy: 18, lineup: 24, keep: true },
  'complete-strong': { buy: 30, lineup: 40, keep: true },
  'lineup-small': { buy: 0, lineup: 8, keep: false },
  'lineup-medium': { buy: 0, lineup: 12, keep: false },
  'lineup-late': { buy: 0, lineup: 24, keep: false, fromRound: 5 },
});

export function medicalPolicy(m, ps) {
  if (!ps?.isBot || ps.autoplay || m.isSolo || m.modeId !== 'mode_multi_abyss' || m.round < 3 || m.round > 11
    || m.order.length !== 4 || m.order.filter((p) => p.isBot).length !== 2) return null;
  // A living Touch teammate supplies an independent map medic. Do not spend a first-medic bonus again.
  if (m.order.some((p) => p.alive && p.bandId === 'band_amedic')) return null;
  const policy = MEDICAL_POLICIES[m.botMedicalPolicy];
  return policy && m.round >= (policy.fromRound || 3) ? policy : null;
}
