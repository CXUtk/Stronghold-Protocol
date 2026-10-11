// Offline proposals, NOT an installed bot policy. Heuristic coefficients are experimental;
// only the normal -> unite -> settle replay supplies labels. No battle-result/RNG peeking.
import { fieldModel, rangeRec, rangeTiles, effDps, PLAN_DIRS } from '../../server/match/bot.js';
import { basePositionClass } from '../../server/match/board.js';

export const CANDIDATES = ['baseline', 'terrain', 'balanced', 'sustain', 'guarded'];
const healer = (r) => r?.attackKind === 'heal' || r?.dmgType === 'heal';
const sum = (xs) => xs.reduce((s, v) => s + v, 0);

export function terrainAt(stage, key) {
  const [r, c] = key.split(',').map(Number);
  return stage?.tiles?.[stage.rows?.[r]?.[c]]?.special || null;
}

/** Pure features / heuristic, deliberately separate from the actual simulation result. */
export function layoutFeatures(model, units, { balance = false } = {}) {
  const heals = units.filter((u) => u.heal);
  // A medic's single-target HPS is shared across the covered allies (a conservative approximation).
  const hps = new Map(units.map((u) => [u.uid, sum(heals.filter((h) => h.cover.has(u.key)).map((h) =>
    h.hps / Math.max(1, units.filter((a) => h.cover.has(a.key) && (a.block || a.terrain === 'infection')).length)))]));
  let sustain = 0, hiddenTankRisk = 0, protectedBackline = 0, uncoveredInfection = 0;
  for (const u of units) {
    const healing = hps.get(u.uid) || 0;
    if (u.block && model.ground.has(u.key)) sustain += Math.min(1, healing / 180) * 0.8;
    if (u.terrain === 'infection') {
      const lack = Math.max(0, u.terrainDamage - healing);
      uncoveredInfection += lack > 0 ? 1 : 0;
      sustain -= 2 * lack / Math.max(1, u.terrainDamage);
    }
    if (u.terrain === 'smog' && !u.block) protectedBackline++;
    // Only count exposed backliners in an actual ranged enemy's range along a route near this blocker.
    // Blocking reveals a smog tank to its OWN blocked enemy, not to other ranged enemies.
    if (u.block && u.terrain === 'smog' && model.ground.has(u.key)) {
      const vulnerable = units.filter((a) => !a.block && a.terrain !== 'smog' && model.rangedTiles.some((e) =>
        e.tiles.some((k) => distance(k, u.key) <= e.range && distance(k, a.key) <= e.range)));
      hiddenTankRisk += Math.min(2, vulnerable.length);
    }
  }
  const routes = model.routes.map((rt) => {
    let exposure = 0, held = false;
    for (const k of rt.tiles) {
      const blocks = !rt.fly ? units.filter((u) => u.key === k && u.block) : [];
      const hold = sum(blocks.map((u) => u.block * 4 * (1 + Math.min(1, (hps.get(u.uid) || 0) / 180))));
      const t = rt.tileTime + hold * (held ? 0.5 : 1);
      if (blocks.length) held = true;
      exposure += t * sum(units.filter((u) => u.cover.has(k) && (!rt.fly || u.air)).map((u) => u.dps));
    }
    return { n: rt.n, fly: rt.fly, tiles: rt.tiles, ratio: 1 - Math.exp(-exposure / Math.max(1, 1.5 * rt.hp)) };
  });
  const total = sum(routes.map((r) => r.n));
  const coverage = sum(routes.map((r) => r.n * r.ratio));
  // Pressure-weighted weakest route: not a 50/50 headcount split, and no blocker bonus for a flying route.
  const meaningful = routes.filter((r) => r.n >= total * 0.15);
  const weakest = meaningful.length ? Math.min(...meaningful.map((r) => r.ratio)) : 0;
  const score = coverage + sustain - hiddenTankRisk * 1.8 + protectedBackline * 0.45
    + (balance ? total * 0.35 * weakest : 0);
  return { score, coverage, weakest, sustain, hiddenTankRisk, protectedBackline, uncoveredInfection,
    healers: heals.length, routes: routes.map(({ n, fly, ratio }) => ({ n, fly, ratio })) };
}

const distance = (a, b) => {
  const [ar, ac] = a.split(',').map(Number), [br, bc] = b.split(',').map(Number);
  return Math.hypot(ar - br, ac - bc);
};

export function candidateContext(m, ps) {
  const base = fieldModel(m, ps);
  const ranged = (m.wave?.spawns || []).map((s) => ps.gd.enemy(s.enemyKey)).filter((e) => e?.stats?.rangeRadius > 0 && e.applyWay !== 'MELEE');
  const model = { ...base, rangedTiles: ranged.map((e) => ({ range: e.stats.rangeRadius, tiles: [...base.index.keys()] })) };
  const cache = new Map();
  const unit = (piece, key, dir = piece.dir || 'RIGHT') => {
    const id = `${piece.uid}|${key}|${dir}`;
    if (cache.has(id)) return cache.get(id);
    const rec = piece.kind === 'token' ? ps.gd.token(piece.id) : rangeRec(ps, ps.gd.chess(piece.id));
    const [r, c] = key.split(',').map(Number);
    const isHeal = healer(rec), stats = rec?.stats || {};
    const block = basePositionClass(rec) === 'melee' && rec?.attackKind !== 'none' && ps.deployMap().get(key) !== 'ranged' ? (stats.blockCnt ?? 1) : 0;
    const u = { uid: piece.uid, key, dir, rec, block, heal: isHeal,
      hps: isHeal ? (stats.atk || 0) / Math.max(0.2, (stats.bat || 1) * 100 / (stats.aspd || 100)) : 0,
      dps: isHeal ? 0 : effDps(base, rec), air: !!rec?.canHitFly,
      cover: new Set(rangeTiles(rec, r, c, dir)), terrain: terrainAt(m.stage, key),
      terrainDamage: m.stage?.special?.infection?.damage ?? 70 };
    cache.set(id, u);
    return u;
  };
  return { model, unit };
}

/** A bounded legal local search. Existing summons AND their owners stay fixed, avoiding accidental recall. */
export function applySupportCandidate(m, ps, name) {
  if (!CANDIDATES.includes(name)) throw new Error(`Unknown support candidate: ${name}`);
  if (!ps.isBot || !ps.alive || m.phase !== 'PREP') throw new Error('Candidate requires a living bot in PREP');
  const { model, unit } = candidateContext(m, ps);
  const opts = { balance: name === 'balanced' || name === 'sustain' };
  const entries = () => [...ps.board].map(([key, p]) => ({ key, p, dir: p.dir || 'RIGHT' }));
  const features = (es) => layoutFeatures(model, es.map(({ p, key, dir }) => unit(p, key, dir)), opts);
  const before = features(entries()), actions = [], rejected = [];
  const noOwnedMedic = !ps.allChess().some((p) => healer(rangeRec(ps, ps.gd.chess(p.id))));
  if (name === 'baseline') return { pid: ps.playerId, name, before, after: before, actions, rejected };
  if (name === 'guarded' && !before.uncoveredInfection && !before.hiddenTankRisk) return { pid: ps.playerId, name, before, after: before, actions, rejected };
  const ready = ps.ready;
  if (ready && !ps.setReady(false).ok) throw new Error('Cannot unready candidate');
  const owners = new Set(ps.allChess().filter((p) => [...ps.board.values(), ...ps.hand, ...ps.temp].some((t) => t?.kind === 'token' && t.ownerUid === p.uid)).map((p) => p.uid));
  const movable = (p) => p.kind === 'chess' && !owners.has(p.uid);
  const move = (p, key, dir) => {
    const [row, col] = key.split(',').map(Number);
    const res = ps.move(p.uid, { area: 'board', row, col }, dir);
    const action = { uid: p.uid, id: p.id, name: ps.gd.chess(p.id)?.name, to: key, dir };
    if (res.ok) actions.push(action); else rejected.push({ ...action, result: res });
    return res.ok;
  };
  let result, restored = { ok: true };
  try {
    // Owned reserves only. No free medic / coins / shop redraws; purchasing is a later economic candidate.
    if (name === 'sustain' && !before.healers) {
      const medics = ps.hand.filter((p) => p?.kind === 'chess' && healer(rangeRec(ps, ps.gd.chess(p.id))) && movable(p));
      let best = null, bestScore = -Infinity;
      const es = entries();
      for (const p of medics) for (const key of ps.deployMap().keys()) {
        const old = es.find((e) => e.key === key);
        if (old && !movable(old.p)) continue;
        if (!old && ps.deployCount >= ps.deployCap) continue;
        const [r, c] = key.split(',').map(Number);
        if (!ps._legal(p, r, c)) continue;
        for (const dir of PLAN_DIRS) {
          const score = features([...es.filter((e) => e !== old), { p, key, dir }]).score;
          if (score > bestScore) { bestScore = score; best = { p, key, dir }; }
        }
      }
      // Force the best legal medic proposal even if the rough model prefers damage; the real replay judges it.
      if (best) move(best.p, best.key, best.dir);
    }
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      for (const p of [...ps.board.values()].filter(movable).sort((a, b) => a.uid - b.uid)) {
        if (name === 'guarded' && actions.length >= 4) break;
        const es = entries(), at = es.find((e) => e.p.uid === p.uid);
        if (!at) continue;
        let best = null, bestScore = features(es).score + 1e-6;
        for (const key of ps.deployMap().keys()) {
          const other = es.find((e) => e.key === key && e !== at);
          if (other && !movable(other.p)) continue;
          const [r, c] = key.split(',').map(Number), [sr, sc] = at.key.split(',').map(Number);
          if (!ps._legal(p, r, c) || (other && !ps._legal(other.p, sr, sc))) continue;
          for (const dir of PLAN_DIRS) {
            const next = es.map((e) => e === at ? { p, key, dir } : e === other ? { ...e, key: at.key } : e);
            const feature = features(next);
            // A conservative alternative to wholesale repositioning: preserve estimated lane/output coverage,
            // and make at most four moves. This guards the approximation, not a guarantee of battle outcomes.
            if (name === 'guarded' && (feature.coverage < before.coverage * 0.98 || feature.weakest < before.weakest * 0.98)) continue;
            const score = feature.score;
            if (score > bestScore) { bestScore = score; best = { key, dir }; }
          }
        }
        if (best && move(p, best.key, best.dir)) changed = true;
      }
      if (!changed) break;
    }
    result = { pid: ps.playerId, name, before, after: features(entries()), actions, rejected, noOwnedMedic };
  } finally {
    if (ready) restored = ps.setReady(true);
  }
  if (!restored.ok) throw new Error('Candidate left unresolved temporary pieces');
  return result;
}
