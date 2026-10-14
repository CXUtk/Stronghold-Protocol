// Offline policy experiments: keep the real shops, prices, stock, actions, economy and combat rules.
// Limiting upgrades is a bot's decision to skip an action, never a change to the game-wide level limit.
import { runSupportMatch } from './support-runner.mjs';
import { readFileSync } from 'node:fs';
import { buildContext, combatValue } from '../../server/match/bot-build.js';
import { fieldModel, REHEARSAL_VARIANTS } from '../../server/match/bot.js';
import { observeBattle } from './battle-observer.mjs';
import { observeRoutes } from './route-observer.mjs';
import { installTacticalPolicy } from './tactical-policy.mjs';
import { installCounterSkills } from './skill-policy.mjs';
const atlases = new Map();

export const POLICIES = Object.freeze({
  baseline: { rehearsal: 3 },
  'baseline-parity-v12': { rehearsal: 3, playerParity: true },
  'enemy-parity-v12': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'enemy-sustain', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true,
    projectPrepEnd: true, playerParity: true },
  'terrain-parity-v12': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'tanks', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true,
    projectPrepEnd: true, playerParity: true },
  'pr445-personas': { rehearsal: 4, partnerBand: 'band_amedic', personas: true },
  // v5's historical seat-order assignment is retained above for exact reproduction, not policy selection.
  'pr445-aligned': { rehearsal: 4, partnerBand: 'band_amedic', personas: true, alignPersonas: true },
  // Same PR 445 strategy, under the v12 player-action/information boundary. Not an upstream change.
  'pr445-parity-v13': { rehearsal: 4, partnerBand: 'band_amedic', personas: true, alignPersonas: true, playerParity: true },
  'pr445-dps-order': { rehearsal: 4, partnerBand: 'band_amedic', personas: true, alignPersonas: true, layoutParams: { tankFirst: false } },
  'pr445-no-combos': { rehearsal: 4, partnerBand: 'band_amedic', personas: true, alignPersonas: true, skipCombos: true },
  'pr445-cap3': { rehearsal: 4, partnerBand: 'band_amedic', personas: true, alignPersonas: true, levelCap: 3, role: 'anchor' },
  'pr445-build': { rehearsal: 4, partnerBand: 'band_amedic', personas: true, alignPersonas: true, build: 'tanks' },
  'pr445-carry': { rehearsal: 4, partnerBand: 'band_amedic', personas: true, alignPersonas: true, tactical: 'carry' },
  'hybrid-v6': { rehearsal: 6, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    levelCap: 3, role: 'anchor', build: 'tanks', tactical: 'hazard', layoutParams: { tankFirst: false }, skipCombos: true },
  'hybrid-v7': { rehearsal: 7, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'tanks', tactical: 'hazard', routeVariants: true, skipCombos: true },
  'dual-keep-v8': { rehearsal: 8, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'tanks', tactical: 'hazard', routeVariants: true, skipCombos: true, keepLayout: true },
  'dual-lanes-v8': { rehearsal: 10, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'tanks', tactical: 'hazard', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true },
  'dual-terrain-v8': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'tanks', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true },
  'dual-economy-v8': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'conservative', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true },
  'enemy-hover-v9': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'enemy-hover', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true },
  'enemy-window-v9': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'enemy-window', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true },
  'enemy-cover-v9': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'enemy-cover', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true },
  'enemy-sustain-v9': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'enemy-sustain', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true },
  'enemy-projection-v11': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'enemy-sustain', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true, projectPrepEnd: true },
  'terrain-projection-v11': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'tanks', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true, projectPrepEnd: true },
  'enemy-skill-v10': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'enemy-sustain', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true, counterSkills: true },
  'terrain-skill-v10': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'tanks', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true, counterSkills: true },
  'enemy-item-early-v10': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'enemy-sustain', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true,
    counterEquipment: { early: true } },
  'enemy-item-route-v10': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'enemy-sustain', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true,
    counterEquipment: { routes: true } },
  'enemy-counter-v10': { rehearsal: 11, partnerBand: 'band_amedic', personas: true, alignPersonas: true,
    build: 'enemy-sustain', tactical: 'dual', routeVariants: true, skipCombos: true, keepLayout: true, dualRoutes: true,
    counterSkills: true, counterEquipment: { early: true, routes: true } },
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
  const skipped = [], preparation = [], rehearsalLayers = [], observations = [], tacticalTrials = [], equipmentActions = [];
  const economy = new Map();
  const partnerBand = policy.partnerBand === 'other-anchor' ? (config.band === 'band_amiya' ? 'band_ioleta' : 'band_amiya') : policy.partnerBand;
  const result = runSupportMatch({ ...config, rehearsal: policy.rehearsal, partnerBand }, {
    configure(m, rec) {
      // Existing IDs are frozen historical controls, including their audited parity defects.
      // New policies and real matches use player-legal actions and independent random samples.
      m.botLegacyParity = !policy.playerParity;
      if (policy.personas) {
        const bots = m.order.filter((p) => p.isBot);
        bots[0].botPersona = config.band === 'band_amiya' ? 'amiya_fallback' : 'ioleta_fallback';
        bots[1].botPersona = 'touch_fallback';
        rec.personas = bots.map((p) => ({ pid: p.playerId, persona: p.botPersona }));
        if (policy.alignPersonas) {
          const pickBand = m.pickBand.bind(m);
          m.pickBand = (ps, bandId) => {
            if (ps.isBot) {
              ps.botPersona = ({ band_amiya: 'amiya_fallback', band_ioleta: 'ioleta_fallback', band_amedic: 'touch_fallback' })[bandId] || null;
              ps._botPersona = null;
              rec.personas = bots.map((p) => ({ pid: p.playerId, persona: p.botPersona }));
            }
            return pickBand(ps, bandId);
          };
        }
      }
      m.botLayoutParams = policy.layoutParams;
      m.botProjectPrepEnd = !!policy.projectPrepEnd;
      m.botSkipCombos = policy.skipCombos;
      m.botKeepCurrentLayout = policy.keepLayout;
      m.botCounterEquipment = policy.counterEquipment;
      if (policy.routeVariants) m.botLayoutVariants = [...REHEARSAL_VARIANTS.slice(0, 4),
        { tankFirst: false }, { tankFirst: false, spread: 3, secondHold: 0.2, cohesion: 0 }];
      if (policy.dualRoutes) m.botLayoutVariants.push({ routeFloor: 0.5, cohesion: 0 },
        { routeFloor: 0.5, cohesion: 0, tankFirst: false });
      installTacticalPolicy(m, { ...policy, captureSpecs: config.routeDiagnostics }, tacticalTrials);
      if (config.observe) {
        const original = m.newBattle.bind(m);
        m.newBattle = (opts) => {
          const b = original(opts);
          if (!opts.fieldId?.startsWith('r:') && (opts.kind === 'unite' || opts.players.some((p) => m.players.get(p.playerId)?.isBot))) {
            const routes = config.routeDiagnostics ? observeRoutes(b, opts) : null;
            const snapshot = observeBattle(b);
            observations.push({ round: opts.round, kind: opts.kind, fieldId: opts.fieldId,
              snapshot: () => ({ ...snapshot(), ...(routes ? { routes: routes() } : {}) }) });
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
        if (policy.counterSkills) installCounterSkills(m, m.botCombatAtlas, rec);
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
          const r = buy(slot); if (r.ok && isHeal) counts().medicalBought++;
          if (policy.counterEquipment && r.ok && s?.kind === 'item' && p.gd.item(s.id)?.params?.silence > 0)
            equipmentActions.push({ round: m.round, pid: p.playerId, action: 'buy', id: s.id });
          return r;
        };
        if (policy.counterEquipment) {
          const equip = p.equip.bind(p);
          p.equip = (itemUid, unitUid) => {
            const item = [...p.hand, ...p.temp].find((u) => u?.uid === itemUid), unit = p.allChess().find((u) => u.uid === unitUid);
            const r = equip(itemUid, unitUid);
            if (r.ok && p.gd.item(item?.id)?.params?.silence > 0)
              equipmentActions.push({ round: m.round, pid: p.playerId, action: 'equip', id: item.id, carrier: unit?.id });
            return r;
          };
        }
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
    ...(policy.counterEquipment ? { equipmentActions } : {}),
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
