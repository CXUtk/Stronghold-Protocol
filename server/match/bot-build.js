// Opt-in offline build scoring. These are falsifiable heuristics, never changes to combat rules.
// The caller supplies an atlas measured with the real kits; no Node APIs or hidden future draws are read here.
import { HOVER_KEYS } from '../sim/content/enemies.js';

export const BUILD_POLICIES = Object.freeze({
  output: { unit: 7, team: 0, future: 0 },
  matchup: { unit: 7, team: 12, future: 0.2 },
  conservative: { unit: 3.5, team: 6, future: 0.2 },
  tanks: { unit: 7, team: 12, future: 0.2, protectTanks: true },
  sustain: { unit: 7, team: 12, future: 0.2, measuredMapMedic: true },
  resilient: { unit: 7, team: 12, future: 0.2, protectTanks: true, measuredMapMedic: true },
  'enemy-hover': { unit: 7, team: 12, future: 0.2, protectTanks: true, enemyAware: true },
  'enemy-window': { unit: 7, team: 12, future: 0.2, protectTanks: true, enemyAware: true, enemyWindows: true },
  'enemy-cover': { unit: 7, team: 12, future: 0.2, protectTanks: true, enemyAware: true, enemyWindows: true, counterTeam: 8 },
  'enemy-sustain': { unit: 7, team: 12, future: 0.2, protectTanks: true, enemyAware: true, enemyWindows: true, counterTeam: 8, threatHealing: true },
});
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;
const statDps = (p) => (p.dps20 + p.dps60) / 2;

/** Interpolate measured DEF curves, then the observed RES sensitivity. Clamped outside the measured domain. */
export function atlasDps(entry, { def = 0, res = 0, reflection = 0, fly = false }, crowd = 0) {
  if (!entry) return 0;
  const p = entry.profiles, points = [[0, p.soft], [400, p.armor400], [800, p.armor800], [1400, p.armor1400]];
  const armor = (d) => {
    d = clamp(d, 0, 1400);
    for (let i = 1; i < points.length; i++) if (d <= points[i][0]) return mix(statDps(points[i - 1][1]), statDps(points[i][1]), (d - points[i - 1][0]) / (points[i][0] - points[i - 1][0]));
    return statDps(p.armor1400);
  };
  const resFactor = (r) => clamp(mix(1, statDps(p.resist) / Math.max(1, armor(200)), clamp(r / 70, 0, 1.35)), 0.05, 2);
  let dps = armor(def) * resFactor(res + reflection);
  if (reflection > 0) {
    // Retain the measured self-silence / penetration advantage against actual 折射, not just raw RES.
    const ratio = statDps(p.reflection) / Math.max(1, armor(400) * resFactor(70));
    dps *= clamp(ratio, 0.5, 4);
  }
  if (fly) dps *= clamp(statDps(p.air) / Math.max(1, armor(300) * resFactor(20)), 0, 1.5);
  else dps *= mix(1, clamp(statDps(p.crowd) / Math.max(1, armor(200) * resFactor(20)), 1, 3), crowd);
  return dps;
}

export function buildContext(m, ps, model) {
  const policy = BUILD_POLICIES[m.botBuildPolicy];
  if (!policy || !m.botCombatAtlas || !ps.isBot || ps.autoplay || m.isSolo || m.modeId !== 'mode_multi_abyss'
    || m.order.length !== 4 || m.order.filter((p) => p.isBot).length !== 2 || m.round > 11) return null;
  const key = `${m.round}|${m.stageId}|${ps.playerId}|${m.botBuildPolicy}`;
  const cache = m._botBuildCache || (m._botBuildCache = new Map());
  if (cache.has(key)) return cache.get(key);
  const gd = ps.gd || m.gd, scale = gd.enemyScale(m.round), rows = [];
  const add = (id, weight, mods = {}) => {
    const e = gd.enemy(id); if (!e?.stats) return;
    const s = e.stats, bb = e.talents?.bb || {};
    const reflection = Number(bb['refracting.magic_resistance'] ?? bb['Refracting.magic_resistance']) || 0;
    rows.push({ id, weight, def: (s.def || 0) * (mods.defMul || 1), res: s.res || 0, reflection,
      fly: e.isFlyEnemy || s.motion === 'FLY' || (policy.enemyAware && HOVER_KEYS.includes(id)),
      hp: s.maxHp * scale.hpMul * (mods.hpMul || 1), speed: (s.moveSpeed || 0.8) * scale.speedMul,
      regen: s.hpRecoveryPerSec || 0, silenciable: !s.immunities?.silence,
      atk: (s.atk || 0) * scale.atkMul * (mods.atkMul || 1),
      bat: s.bat || 2, type: s.dmgType || 'phys', dot: (e.acTypes || []).includes('DOT') || e.acType === 'DOT' });
  };
  for (const s of m.wave?.spawns || []) if (s.tag !== 'part') add(s.enemyKey, (s.count || 1) * Math.sqrt(gd.enemy(s.enemyKey)?.stats?.maxHp || 1000), s.mods);
  if (!rows.length) for (const a of model.armor) rows.push({ ...a, weight: a.w, reflection: 0, atk: 600 * scale.atkMul, bat: 2, type: 'phys' });
  const sum = rows.reduce((n, x) => n + x.weight, 0) || 1;
  rows.forEach((r) => { r.weight = r.weight / sum * (1 - policy.future); });
  // Faction types are public from match setup. Their possible pool is known; the hidden future pick schedule is not.
  const future = [...new Set((m.factions || []).flatMap((f) => gd.factions.types?.[f]?.pool || []))];
  for (const id of future) add(id, policy.future / future.length);
  const total = rows.reduce((n, x) => n + x.weight, 0) || 1;
  rows.forEach((r) => { r.weight /= total; });
  const count = (m.wave?.spawns || []).reduce((n, s) => n + (s.count || 1), 0);
  const out = { policy, rows, entries: m.botCombatAtlas.entries, values: new Map(), synergy: new Map(), crowd: clamp((count - 8) / 50, 0, 0.65),
    reflection: rows.reduce((n, r) => n + (r.reflection > 0 ? r.weight : 0), 0),
    dot: rows.reduce((n, r) => n + (r.dot ? r.weight : 0), 0),
    infection: (m.stage?.rows || []).slice(9, 13).join('').includes('i'),
    mapMedic: m.order.some((p) => p.alive && p.bandId === 'band_amedic'), mapMedics: m.botCombatAtlas.mapMedics };
  cache.set(key, out); return out;
}

export function combatValue(ctx, c) {
  if (!ctx || !c) return null;
  if (ctx.values.has(c.chessId)) return ctx.values.get(c.chessId);
  const entry = ctx.entries[c.chessId]; if (!entry) return null;
  const dps = ctx.rows.reduce((n, r) => n + r.weight * enemyDps(ctx, entry, r), 0);
  const p = entry.profiles;
  const v = { id: c.chessId, dps, hps: p.soft.hps, silence: p.reflection.silenceUptime,
    shred: p.armor800.defReduction || 0, resCut: Math.max(p.resist.resReduction || 0, 70 * p.reflection.silenceUptime), entry };
  ctx.values.set(c.chessId, v); return v;
}

/** Fast enemies leave less time for slow-start skills. This is a proposal score, not a simulated kill rate. */
export function enemyDps(ctx, entry, row) {
  let dps = atlasDps(entry, row, ctx.crowd);
  if (ctx.policy.enemyWindows) {
    const p = entry.profiles[row.fly ? 'air' : row.reflection > 0 ? 'reflection' : row.def >= 800 ? 'armor800' : 'soft'];
    const early = clamp(p.dps20 / Math.max(1, statDps(p)), 0.25, 1.75);
    dps *= mix(1, early, clamp(((row.speed || 1) - 0.8) / 1.2, 0, 0.75));
  }
  return dps;
}

/** Saturate already-covered enemies; retain a floor for the hardest public matchup. No hidden wave/fixture inputs. */
export function counterCoverage(ctx, records) {
  if (!ctx?.policy.counterTeam || !ctx.rows.length) return 0;
  const units = records.map((c) => combatValue(ctx, c)).filter(Boolean);
  const silence = units.reduce((s, u) => Math.max(s, u.silence), 0);
  const shred = units.reduce((s, u) => Math.max(s, u.shred), 0);
  let mean = 0, floor = 1;
  for (const row of ctx.rows) {
    const target = { ...row, def: Math.max(0, row.def - shred * 0.5),
      reflection: row.reflection * (1 - (row.silenciable ? silence * 0.6 : 0)) };
    const dps = units.reduce((s, u) => s + enemyDps(ctx, u.entry, target), 0);
    // Approximate exposure only; actual route, range, control and stacked bonds are still judged by rehearsal.
    const window = clamp(10 / Math.max(0.25, row.speed || 1), 5, 20);
    const needed = Math.max(200, (row.hp || 10000) / window + (row.regen || 0));
    const coverage = Math.min(1, 0.65 * dps / needed);
    mean += row.weight * coverage;
    if (row.weight >= 0.02) floor = Math.min(floor, coverage);
  }
  return ctx.policy.counterTeam * (mean + 0.5 * floor);
}

/** A ninth card must replace someone: do not award imaginary extra deployment capacity to a purchase. */
export function counterBuyBonus(ctx, candidate, fielded) {
  if (!ctx?.policy.counterTeam) return 0;
  const current = fielded.filter(Boolean).slice(0, 8), before = counterCoverage(ctx, current);
  const alternatives = current.length < 8 ? [[...current, candidate]]
    : current.map((_, i) => current.map((c, j) => i === j ? candidate : c));
  return clamp(Math.max(...alternatives.map((r) => counterCoverage(ctx, r))) - before, 0, 4);
}

export function buildUnitBonus(ctx, c) {
  const v = combatValue(ctx, c); if (!v || !(v.dps > 0)) return 0;
  // Center against a rough tier/elite baseline; do not erase bond, merge and layer-engine values.
  const expected = (210 + (c.tier || 1) * 45) * (c.isGolden ? 1.6 : 1);
  const floor = ctx.policy.protectTanks && c.position === 'MELEE' && (c.stats.blockCnt >= 3 || c.stats.def >= 400) ? 0 : -1.3;
  return ctx.policy.unit * clamp(Math.log2((100 + v.dps) / (100 + expected)), floor, 1.8);
}

/** Marginal team utility: usable HPS and debuff contribution to OTHER damage dealers, with diminishing returns. */
export function buildLineupBonus(ctx, records) {
  if (!ctx?.policy.team) return 0;
  const units = records.map((c) => ({ c, v: combatValue(ctx, c) })).filter((x) => x.v);
  const tanks = units.filter(({ c }) => c.position === 'MELEE' && c.stats.blockCnt > 0);
  let pressure = 0;
  for (const { c } of tanks.slice().sort((a, b) => b.c.stats.def - a.c.stats.def).slice(0, 2)) {
    pressure += ctx.rows.reduce((n, r) => n + r.weight * (r.type === 'arts'
      ? r.atk * Math.max(0.05, 1 - (c.stats.res || 0) / 100)
      : r.type === 'true' ? r.atk
      : Math.max(r.atk * 0.05, r.atk - c.stats.def)) / r.bat, 0);
  }
  pressure += (ctx.infection ? units.length * 35 : 0) + ctx.dot * units.length * 50;
  let hps = units.reduce((n, x) => n + x.v.hps, 0) * 0.65; // measured capacity reduced for imperfect coverage
  const measuredMedic = ctx.policy.measuredMapMedic || (ctx.policy.threatHealing && (ctx.dot > 0.1 || ctx.infection));
  if (ctx.mapMedic && measuredMedic) {
    const id = records.filter((c) => c?.isGolden).length >= 2 ? 'char_613_acmedc' : 'char_605_cmedic';
    hps += (ctx.mapMedics?.[id] || 0) * 0.65;
  }
  const healing = ctx.mapMedic && !measuredMedic ? 0 : Math.min(hps, pressure) / Math.max(150, pressure);
  let synergy = 0;
  const total = units.reduce((n, x) => n + x.v.dps, 0);
  for (const { v } of units) {
    const others = units.filter((x) => x.v.id !== v.id);
    const cut = others.reduce((a, x) => Math.max(a, x.v.shred), 0);
    const silence = others.reduce((a, x) => Math.max(a, x.v.silence), 0);
    const key = `${v.id}|${cut}|${silence}`;
    if (!ctx.synergy.has(key)) ctx.synergy.set(key, ctx.rows.reduce((n, r) => n + r.weight * atlasDps(v.entry,
      { ...r, def: Math.max(0, r.def - cut * 0.5), reflection: r.reflection * (1 - silence * 0.6) }, ctx.crowd), 0));
    const improved = ctx.synergy.get(key);
    synergy += Math.max(0, improved - v.dps);
  }
  return ctx.policy.team * (healing + Math.min(1.5, synergy / Math.max(300, total))) + counterCoverage(ctx, records);
}

export function buildItemBonus(ctx, item, ownedItems = []) {
  if (!ctx?.policy.team || !(item?.params?.silence > 0) || ownedItems.some((x) => x?.params?.silence > 0)) return 0;
  return ctx.policy.team * 1.5 * ctx.reflection;
}
