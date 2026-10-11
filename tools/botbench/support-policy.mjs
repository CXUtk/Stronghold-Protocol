// Offline policy experiments: keep the real shops, prices, stock, actions, economy and combat rules.
// Limiting upgrades is a bot's decision to skip an action, never a change to the game-wide level limit.
import { runSupportMatch } from './support-runner.mjs';
import { readFileSync } from 'node:fs';
import { buildContext, combatValue } from '../../server/match/bot-build.js';
import { fieldModel } from '../../server/match/bot.js';
import { observeBattle } from './battle-observer.mjs';
import { installTacticalPolicy } from './tactical-policy.mjs';
const atlases = new Map();

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
  'medical-buy': { rehearsal: 3, medical: 'buy' },
  'medical-buy-keep': { rehearsal: 3, medical: 'buy-keep' },
  'medical-lineup': { rehearsal: 3, medical: 'lineup' },
  'medical-complete': { rehearsal: 3, medical: 'complete' },
  'medical-strong': { rehearsal: 3, medical: 'complete-strong' },
  'medical-small': { rehearsal: 3, medical: 'lineup-small' },
  'medical-medium': { rehearsal: 3, medical: 'lineup-medium' },
  'medical-late': { rehearsal: 3, medical: 'lineup-late' },
  'build-output': { rehearsal: 3, build: 'output' },
  'build-matchup': { rehearsal: 3, build: 'matchup' },
  'build-conservative': { rehearsal: 3, build: 'conservative' },
  'build-team-core': { rehearsal: 5, partnerBand: 'band_amedic', levelCap: 3, role: 'anchor', build: 'matchup' },
  'build-team-tanks': { rehearsal: 5, partnerBand: 'band_amedic', levelCap: 3, role: 'anchor', build: 'tanks' },
  'build-team-sustain': { rehearsal: 5, partnerBand: 'band_amedic', levelCap: 3, role: 'anchor', build: 'sustain' },
  'build-team-resilient': { rehearsal: 5, partnerBand: 'band_amedic', levelCap: 3, role: 'anchor', build: 'resilient' },
  'build-team-context': { rehearsal: 5, partnerBand: 'band_amedic', levelCap: 3, role: 'anchor', build: 'tanks', tactical: 'context' },
  'build-team-live': { rehearsal: 5, partnerBand: 'band_amedic', levelCap: 3, role: 'anchor', build: 'tanks', tactical: 'live' },
  'build-team-carry': { rehearsal: 5, partnerBand: 'band_amedic', levelCap: 3, role: 'anchor', build: 'tanks', tactical: 'carry' },
  'build-team-terrain': { rehearsal: 6, partnerBand: 'band_amedic', levelCap: 3, role: 'anchor', build: 'tanks', tactical: 'terrain' },
  'build-team-hazard': { rehearsal: 6, partnerBand: 'band_amedic', levelCap: 3, role: 'anchor', build: 'tanks', tactical: 'hazard' },
});

export function runSupportPolicy(config, policyId = 'baseline') {
  const policy = POLICIES[policyId];
  if (!policy || config.humans !== 2) throw new Error('Unknown policy or non-2H2AI configuration');
  const skipped = [], preparation = [], rehearsalLayers = [], observations = [], tacticalTrials = [];
  const economy = new Map();
  const partnerBand = policy.partnerBand === 'other-anchor' ? (config.band === 'band_amiya' ? 'band_ioleta' : 'band_amiya') : policy.partnerBand;
  const result = runSupportMatch({ ...config, rehearsal: policy.rehearsal, partnerBand }, {
    configure(m, rec) {
      installTacticalPolicy(m, policy, tacticalTrials);
      if (config.observe) {
        const original = m.newBattle.bind(m);
        m.newBattle = (opts) => {
          const b = original(opts);
          if (!opts.fieldId?.startsWith('r:') && (opts.kind === 'unite' || opts.players.some((p) => m.players.get(p.playerId)?.isBot))) {
            observations.push({ round: opts.round, kind: opts.kind, fieldId: opts.fieldId, snapshot: observeBattle(b) });
          }
          return b;
        };
      }
      m.botMedicalPolicy = policy.medical || '';
      m.botBuildPolicy = policy.build || '';
      if (policy.build) {
        if (!config.atlasPath) throw new Error('Build policy requires --atlas');
        if (!atlases.has(config.atlasPath)) atlases.set(config.atlasPath, JSON.parse(readFileSync(config.atlasPath, 'utf8')));
        m.botCombatAtlas = atlases.get(config.atlasPath);
      }
      for (const p of m.order.filter((p) => p.isBot)) {
        const healer = (id) => { const c = p.gd.chess(id); return c?.attackKind === 'heal' || c?.dmgType === 'heal'; };
        const counts = () => {
          const key = `${m.round}:${p.playerId}`;
          if (!economy.has(key)) economy.set(key, { medicalBought: 0, medicalSold: 0, affordableMedicalPassed: 0 });
          return economy.get(key);
        };
        const buy = p.buy.bind(p), sell = p.sell.bind(p), refresh = p.refresh.bind(p);
        p.buy = (slot) => {
          const s = p.shop.slots[slot], isHeal = s?.kind === 'chess' && healer(s.id);
          const r = buy(slot); if (r.ok && isHeal) counts().medicalBought++; return r;
        };
        p.sell = (uid) => {
          const owned = p.allChess().find((x) => x.uid === uid), isHeal = owned && healer(owned.id);
          const r = sell(uid); if (r.ok && isHeal) counts().medicalSold++; return r;
        };
        p.refresh = (...args) => {
          const passed = !p.allChess().some((u) => healer(u.id))
            && p.shop.slots.some((s) => s && !s.sold && s.kind === 'chess' && healer(s.id) && p.priceOf(s) <= p.funds);
          const r = refresh(...args); if (r.ok && passed) counts().affordableMedicalPassed++; return r;
        };
      }
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
        ...(policy.build ? { build: (() => {
          const ctx = buildContext(m, p, fieldModel(m, p));
          return { reflection: ctx?.reflection, dot: ctx?.dot, infection: ctx?.infection,
            units: [...p.board.values()].filter((u) => u.kind === 'chess').map((u) => {
              const v = combatValue(ctx, p.gd.chess(u.id));
              return { id: u.id, dps: v?.dps, hps: v?.hps, silence: v?.silence, shred: v?.shred };
            }) };
        })() } : {}),
        medical: {
          ...economy.get(`${m.round}:${p.playerId}`),
          owned: p.allChess().filter((u) => { const c = p.gd.chess(u.id); return c?.attackKind === 'heal' || c?.dmgType === 'heal'; }).length,
          deployed: [...p.board.values()].filter((u) => u.kind === 'chess' && (p.gd.chess(u.id)?.attackKind === 'heal' || p.gd.chess(u.id)?.dmgType === 'heal')).length,
          mapMedic: m.order.some((mate) => mate.alive && mate.bandId === 'band_amedic'),
        },
        board: [...p.board].map(([tile, u]) => ({ tile, uid: u.uid, id: u.id, kind: u.kind, dir: u.dir, golden: p.gd.isGolden(u.id) })),
      })) });
    },
  });
  return { policyId, policy, ...result, policyDiagnostics: { skipped, preparation, rehearsalLayers,
    ...(policy.tactical ? { tacticalTrials } : {}),
    ...(config.observe ? { observations: observations.map(({ snapshot, ...meta }) => ({ ...meta, ...snapshot() })) } : {}) } };
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
