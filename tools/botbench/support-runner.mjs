import { performance } from 'node:perf_hooks';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { getData } from '../../server/data.js';
import { uniteSurvivors } from '../../server/match/unite.js';
import { ANCHOR_BANDS, FIXTURE_VERSION, humanBand, humanCard, injectLeaks } from './support-fixture.mjs';

export const SUPPORT_MAPS = ['act1autochess_m02', 'act1autochess_m03', 'act1autochess_m04', 'act2autochess_m01', 'act2autochess_m02', 'act2autochess_m03', 'act2autochess_m04'];

export function supportMetrics({ beforeLP, afterLP, rawLeaks, actualLoss, cap, uniteRan }) {
  const noUniteLoss = Math.min(cap, rawLeaks);
  return {
    noUniteLoss, actualLoss, avoidedLP: noUniteLoss - actualLoss,
    weak: rawLeaks > 0,
    weakZeroLoss: rawLeaks > 0 && actualLoss === 0,
    // Immediate loss arithmetic only, not a replay without unite / settlement-triggered effects.
    criticalAtLoss: rawLeaks > 0 && beforeLP <= noUniteLoss,
    criticalRescue: !!uniteRan && beforeLP <= noUniteLoss && rawLeaks > 0 && afterLP > 0,
  };
}

function groups(leaks) {
  const out = {};
  for (const l of leaks || []) {
    if (!l || l.counted === false) continue;
    const key = `${l.tag === 'bounty' ? 'bounty' : 'wave'}:${l.enemyKey}`;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

export function runSupportMatch({ seed = 1, humans = 1, band = 'band_amiya', rounds = 11, rehearsal = 3, stageId, leakCount = 2, sourceMode = 'single', scenario = 'small' } = {}) {
  if (!Number.isInteger(humans) || humans < 1 || humans > 3) throw new Error('humans must be 1..3');
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 11) throw new Error('rounds must be 1..11');
  if (!ANCHOR_BANDS.includes(band)) throw new Error(`Unsupported anchor band: ${band}`);
  if (stageId && !SUPPORT_MAPS.includes(stageId)) throw new Error(`Unsupported map: ${stageId}`);
  if (!Number.isInteger(leakCount) || leakCount < 1 || leakCount > 30) throw new Error('leakCount must be 1..30');
  if (!['single', 'all'].includes(sourceMode)) throw new Error('sourceMode must be single or all');
  const errors = [], warnings = [];
  const sched = new VirtualScheduler();
  const seats = Array.from({ length: 4 }, (_, seat) => ({ seat, playerId: `p${seat}`, name: `Seat ${seat + 1}`, isBot: seat >= humans, connected: true }));
  const m = new Match({ roomCode: 'SUPPORTBENCH', mode: 'coop', difficulty: 'ABYSS', seed, seats,
    data: getData(), scheduler: sched, clientCombat: false, aiPicksLast: true, botRehearsal: rehearsal,
    send: () => true, broadcast() {}, onEnd() {}, log: { info() {}, debug() {}, warn: (...a) => warnings.push(a.map(String).join(' ')), error: (...a) => errors.push(a.map(String).join(' ')) },
  });
  if (stageId) {
    m.stageId = stageId;
    m.stage = m.gd.stage(stageId);
    m._botPath = null;
    for (const ps of m.order) ps.invalidateDeployMap();
  }
  const rec = { seed, humans, band, targetRound: rounds, rehearsal, fixtureVersion: FIXTURE_VERSION, leakCount, sourceMode, scenario,
    modeId: m.modeId, seats: seats.map(({ playerId, isBot }) => ({ playerId, isBot })),
    stageId: m.stageId, factions: [...m.factions], bossId: m.bossId, anchorPid: null,
    rounds: [], preps: [], fixtureInputs: [], startedRounds: [], errors, warnings,
  };
  const startRound = m.startRound.bind(m);
  m.startRound = (round) => { rec.startedRounds.push(round); return startRound(round); };
  const afterCombat = m._afterCombat.bind(m);
  m._afterCombat = () => {
    if (m.phase === 'COMBAT') rec.fixtureInputs.push({ round: m.round, inputs: injectLeaks(m, { seed, leakCount, sourceMode }) });
    return afterCombat();
  };
  let rehearsalMs = 0;
  const normalInputs = new Map();
  const newBattle = m.newBattle.bind(m);
  m.newBattle = (opts) => {
    if (opts.kind === 'normal' && opts.fieldId?.startsWith('n:')) {
      const scheduledGroups = {};
      for (const s of opts.spawns || []) {
        if (s.countInTotal === false) continue;
        const key = `${s.tag === 'bounty' ? 'bounty' : 'wave'}:${s.enemyKey}`;
        scheduledGroups[key] = (scheduledGroups[key] || 0) + (s.count ?? 1);
      }
      normalInputs.set(`${m.round}:${opts.fieldId.slice(2)}`, scheduledGroups);
    }
    const battle = newBattle(opts);
    if (opts.fieldId?.startsWith('r:')) {
      const step = battle.step.bind(battle);
      battle.step = (...args) => { const t = performance.now(); try { return step(...args); } finally { rehearsalMs += performance.now() - t; } };
    }
    return battle;
  };
  const later = m.later.bind(m);
  m.later = (ms, fn) => later(ms, () => {
    const waiting = m.phase === 'PREP' ? m.order.filter((p) => p.isBot && p.alive && !p.ready) : [];
    const r = m.round, t = performance.now(), rh = rehearsalMs;
    const cpu = process.threadCpuUsage?.();
    fn();
    const elapsed = performance.now() - t;
    const used = cpu ? process.threadCpuUsage(cpu) : null;
    for (const p of waiting.filter((p) => p.ready)) rec.preps.push({ round: r, pid: p.playerId, ms: elapsed,
      rehearsalMs: rehearsalMs - rh, cpuMs: used ? (used.user + used.system) / 1000 : null });
  });
  const settle = m.settle.bind(m);
  m.settle = (plan, result) => {
    const ran = !!(plan && result && !result.synthetic);
    const remaining = ran ? uniteSurvivors(plan, result) : null;
    const helpers = (plan?.helpers || []).map((p) => p.playerId);
    const row = { round: m.round, uniteRan: ran, helpers,
      wave: { templateId: m.wave?.templateId, pick: m.wave?.pick, enemyScale: m.gd.enemyScale(m.round) },
      uniteSources: ran ? {
        notReentered: Object.fromEntries(plan.notReentered),
        unspawned: (result.unspawned || []).map((u) => ({ sourcePlayerId: u.sourcePlayerId, enemyKey: u.enemyKey, tag: u.tag })),
        leaked: Object.values(result.perPlayer || {}).flatMap((p) => (p.leaked || []).map((l) => ({ sourcePlayerId: l.sourcePlayerId, enemyKey: l.enemyKey, tag: l.tag, counted: l.counted }))),
      } : null,
      players: m.alivePlayers().map((p) => {
      const own = m.lastResults.get(p.playerId);
      if (!own) throw new Error(`Missing normal result ${p.playerId}`);
      const rawLeaks = (own.leaked || []).filter((l) => l && l.counted !== false).length;
      return { pid: p.playerId, isBot: p.isBot, band: p.bandId,
        beforeLP: p.lp, lpLostBefore: p.stats.lpLost, rawLeaks, leakGroups: groups(own.leaked),
        scheduledGroups: normalInputs.get(`${m.round}:${p.playerId}`) || {},
        ownPerfect: own.perfect !== false && rawLeaks === 0, helper: ran && helpers.includes(p.playerId),
        remaining: ran && plan.leakers.includes(p) ? (remaining.get(p.playerId) || 0) : rawLeaks,
        board: [...p.board].map(([tile, u]) => ({ tile, id: u.id, uid: u.uid, kind: u.kind, dir: u.dir })),
        carry: (own.unitsEnd || []).map((u) => ({ uid: u.uid, alive: u.alive, hpPct: u.hpPct, sp: u.sp })),
        layers: { ...p.layers }, gains: { ...own.layerGains },
      };
    }) };
    settle(plan, result);
    for (const r of row.players) {
      const ps = m.players.get(r.pid);
      r.afterLP = ps.lp;
      r.alive = ps.alive;
      Object.assign(r, supportMetrics({ beforeLP: r.beforeLP, afterLP: r.afterLP, rawLeaks: r.rawLeaks,
        actualLoss: ps.stats.lpLost - r.lpLostBefore, cap: m.gd.lpCapPerRound, uniteRan: ran }));
      delete r.lpLostBefore;
    }
    rec.rounds.push(row);
  };
  const act = (p, msg) => {
    const r = m.handle(p.playerId, msg);
    if (!r.ok) throw new Error(`Fixture intent ${msg.t}: ${JSON.stringify(r)}`);
  };
  const t0 = performance.now();
  try {
    m.start();
    for (let steps = 0; steps < 100000; steps++) {
      if (rec.rounds.at(-1)?.round >= rounds || m.order.filter((p) => !p.isBot).every((p) => !p.alive) || m.ended) break;
      if (m.phase === 'INFO_CHECK') for (const p of m.order.filter((p) => !p.isBot && !p.infoReady)) act(p, { t: 'g.infoReady' });
      if (m.phase === 'BAND_DRAFT') {
        const p = m.players.get(m.draftTurn());
        if (p && !p.isBot) { act(p, { t: 'g.band', bandId: humanBand(m, p) }); continue; }
        if (p?.isBot && !rec.anchorPid) {
          const res = m.pickBand(p, band); // Same validated draft operation; network handle deliberately refuses bots.
          if (!res.ok) throw new Error(`Anchor strategy unavailable: ${JSON.stringify(res)}`);
          rec.anchorPid = p.playerId;
          continue;
        }
      }
      if (m.phase === 'SP_DRAFT') {
        const p = m.players.get(m.spTurn());
        if (p && !p.isBot) { act(p, { t: 'g.choice', idx: humanCard(m) }); continue; }
      }
      if (m.phase === 'PREP') for (const p of m.order.filter((p) => !p.isBot && p.alive && !p.ready)) {
        // Placeholder seats only: no purchasing, deployment, stat buffs or autoplay. Resolve their timeout UI.
        m.autoPickPersonalChoice(p, 'random');
        p.resolveTemp();
        act(p, { t: 'g.ready', ready: true });
      }
      if (!sched.runNext()) throw new Error(`Scheduler stalled: ${m.phase}, round ${m.round}`);
      if (sched.errors.length || errors.length) throw new Error([...errors, ...sched.errors.map(String)].join('\n'));
      if (m.simErrors) throw new Error(`Simulation errors: ${JSON.stringify([...m.simErrorLog.values()])}`);
    }
    const reached = rec.rounds.at(-1)?.round >= rounds;
    const people = m.order.filter((p) => !p.isBot);
    rec.stopReason = reached ? 'round-cutoff' : people.every((p) => !p.alive) ? 'humans-eliminated' : m.ended ? 'match-ended' : 'step-limit';
    if (rec.stopReason === 'step-limit') throw new Error('Support benchmark step limit');
    rec.allHumansSurvived = reached && people.every((p) => p.alive);
    rec.survivingHumans = reached ? people.filter((p) => p.alive).length : 0;
    rec.players = m.order.map((p) => ({ pid: p.playerId, band: p.bandId, isBot: p.isBot, autoplay: p.autoplay,
      lp: p.lp, alive: p.alive, lpLost: p.stats.lpLost, eliminatedRound: p.eliminatedRound }));
    rec.elapsedMs = performance.now() - t0;
    return rec;
  } finally { m.dispose(); sched.dispose(); }
}
