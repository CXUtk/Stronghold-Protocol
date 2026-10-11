// Offline policy experiments: keep the real shops, prices, stock, actions, economy and combat rules.
// Limiting upgrades is a bot's decision to skip an action, never a change to the game-wide level limit.
import { runSupportMatch } from './support-runner.mjs';

export const POLICIES = Object.freeze({
  baseline: { rehearsal: 3 },
  'wider-layout': { rehearsal: 5 },
  'core3-both': { rehearsal: 3, levelCap: 3, role: 'both' },
  'core4-both': { rehearsal: 3, levelCap: 4, role: 'both' },
  'core3-anchor': { rehearsal: 3, levelCap: 3, role: 'anchor' },
  'core3-partner': { rehearsal: 3, levelCap: 3, role: 'partner' },
  'core3-wide': { rehearsal: 5, levelCap: 3, role: 'both' },
  'anchor3-through7': { rehearsal: 3, levelCap: 3, role: 'anchor', throughRound: 7 },
  'anchor3-through9': { rehearsal: 3, levelCap: 3, role: 'anchor', throughRound: 9 },
  'anchor4': { rehearsal: 3, levelCap: 4, role: 'anchor' },
  'anchor3-wide': { rehearsal: 5, levelCap: 3, role: 'anchor' },
  'live-layers': { rehearsal: 3, rehearsalLayers: true },
  'live-layers-wide': { rehearsal: 5, rehearsalLayers: true },
  'paired-fallback': { rehearsal: 3, partnerBand: 'other-anchor' },
  'team-medic': { rehearsal: 3, partnerBand: 'band_amedic' },
  'team-medic-core': { rehearsal: 5, partnerBand: 'band_amedic', levelCap: 3, role: 'anchor' },
});

export function runSupportPolicy(config, policyId = 'baseline') {
  const policy = POLICIES[policyId];
  if (!policy || config.humans !== 2) throw new Error('Unknown policy or non-2H2AI configuration');
  const skipped = [], preparation = [], rehearsalLayers = [];
  const partnerBand = policy.partnerBand === 'other-anchor' ? (config.band === 'band_amiya' ? 'band_ioleta' : 'band_amiya') : policy.partnerBand;
  const result = runSupportMatch({ ...config, rehearsal: policy.rehearsal, partnerBand }, {
    configure(m, rec) {
      if (policy.rehearsalLayers) {
        const original = m.newBattle.bind(m);
        m.newBattle = (opts) => {
          if (!opts.fieldId?.startsWith('r:')) return original(opts);
          // Only the isolated rehearsal's live bonds grow. Its result is never settled into the Match.
          const battle = original({ ...opts, flags: { ...opts.flags, layerGainsEnabled: true } });
          const result = battle.result.bind(battle);
          let recorded = false;
          battle.result = (...args) => {
            const r = result(...args);
            if (!recorded && battle.finished) {
              recorded = true;
              rehearsalLayers.push({ round: opts.round, fieldId: opts.fieldId,
                gains: Object.values(r.perPlayer || {}).reduce((n, p) => n + Object.values(p.layerGains || {}).reduce((a, b) => a + b, 0), 0) });
            }
            return r;
          };
          return battle;
        };
      }
      if (!policy.levelCap) return;
      for (const p of m.order.filter((p) => p.isBot)) {
        const original = p.levelUp.bind(p);
        p.levelUp = (...args) => {
          const active = policy.role === 'both' || (policy.role === 'anchor' ? p.playerId === rec.anchorPid : p.playerId !== rec.anchorPid);
          if (active && m.round <= (policy.throughRound ?? 11) && p.shop.level >= policy.levelCap) {
            skipped.push({ round: m.round, pid: p.playerId, level: p.shop.level, funds: p.funds, price: p.shop.upgradePrice });
            return { ok: false, error: 'OFFLINE_POLICY_SKIP_UPGRADE' };
          }
          return original(...args);
        };
      }
    },
    beforeEndPrep(m) {
      preparation.push({ round: m.round, players: m.order.filter((p) => p.isBot && p.alive).map((p) => ({
        pid: p.playerId, level: p.shop.level, funds: p.funds, stats: structuredClone(p.stats),
        layers: { ...p.layers }, bonds: structuredClone(p.bonds),
        board: [...p.board].map(([tile, u]) => ({ tile, uid: u.uid, id: u.id, kind: u.kind, dir: u.dir, golden: p.gd.isGolden(u.id) })),
      })) });
    },
  });
  return { policyId, policy, ...result, policyDiagnostics: { skipped, preparation, rehearsalLayers } };
}

export function policyMetrics(result) {
  const humanRows = result.rounds.flatMap((r) => r.players.filter((p) => !p.isBot));
  const botRows = result.rounds.flatMap((r) => r.players.filter((p) => p.isBot));
  return {
    failed: !result.allHumansSurvived ? 1 : 0,
    humanLoss: humanRows.reduce((n, r) => n + r.actualLoss, 0),
    weak: humanRows.filter((r) => r.weak).length,
    rescued: humanRows.filter((r) => r.weakZeroLoss).length,
    noHelper: result.rounds.filter((r) => !r.helpers.length && r.players.some((p) => !p.isBot && p.weak)).length,
    eligible: botRows.filter((r) => r.ownPerfect).length,
    aiLeaks: botRows.reduce((n, r) => n + r.rawLeaks, 0),
    eliminatedAI: result.players.filter((p) => p.isBot && !p.alive).length,
    goldens: result.policyDiagnostics.preparation.at(-1)?.players.reduce((n, p) => n + p.board.filter((u) => u.kind === 'chess' && u.golden).length, 0) || 0,
    ms: result.elapsedMs,
  };
}
