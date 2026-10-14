// Offline capability probes, not match scores. Real kits, synthetic stationary targets and healing deficits.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getData } from '../../server/data.js';
import { makeBattle, enemyRec, chessRec } from '../../test/helpers/battleHarness.js';
import { hashTree } from '../botbench-support.mjs';

export const PROBES = Object.freeze({
  soft: { def: 0, res: 0 }, armor400: { def: 400, res: 0 }, armor800: { def: 800, res: 0 },
  armor1400: { def: 1400, res: 0 }, resist: { def: 200, res: 70 },
  reflection: { def: 400, res: 0, reflection: true }, crowd: { def: 200, res: 20, count: 3 },
  air: { def: 300, res: 20, fly: true },
});

export function probeUnit(id, profile, { seed = 17, duration = 60, items = [], skillIndex } = {}) {
  const p = PROBES[profile];
  if (!p) throw new Error('Unknown capability probe');
  const data = getData(), original = data.chess[id];
  if (!original) throw new Error('Unknown operator');
  if (skillIndex !== undefined && !original.skills?.some((s) => s.index === skillIndex)) throw new Error('Unknown skill');
  const key = p.reflection ? 'enemy_1166_dusbr' : 'botbench_dummy';
  const foe = p.reflection ? structuredClone(data.enemies[key]) : enemyRec({ key });
  Object.assign(foe.stats, { maxHp: 1e8, atk: 0, def: p.def, res: p.res, moveSpeed: 0 });
  if (p.fly) { foe.isFlyEnemy = true; foe.stats.motion = 'FLY'; }
  const patient = chessRec({ id: 'botbench_patient', attackKind: 'none', skill: null,
    stats: { maxHp: 100000, atk: 0, blockCnt: 0 } });
  let maxPhysHit = 0, silenceTicks = 0, totalTicks = 0, damage20 = 0, defSum = 0, resSum = 0;
  const damageTypes = { phys: 0, arts: 0, true: 0, elemental: 0 };
  const h = makeBattle({ seed, modeId: 'mode_multi_abyss', round: 5, timeLimit: duration + 1,
    flags: { startOpCooldown: 3 }, autoFinish: false, hooks: [], recordEvents: false,
    defs: { enemies: { [key]: foe }, chess: { botbench_patient: patient } },
    units: [{ chessId: id, uid: 1, row: 9, col: 5, dir: 'RIGHT', items, ...(skillIndex === undefined ? {} : { skillIndex }) },
      ...[[9, 6], [10, 5], [10, 6]].map(([row, col], i) => ({ chessId: 'botbench_patient', uid: 100 + i, row, col }))],
    enemies: [{ key, route: p.fly ? 2 : 0, pos: [9, 5], count: p.count || 1 }],
    setup(b) {
      b.on('hit', (c) => { if (c.source?.side === 'ally' && c.target?.side === 'enemy' && c.dmg.type === 'phys') maxPhysHit = Math.max(maxPhysHit, c.dmg.amount); }, { priority: -1000 });
      b.on('damaged', (c) => { if (c.source?.side === 'ally' && c.target?.side === 'enemy' && Object.hasOwn(damageTypes, c.type)) damageTypes[c.type] += c.amount || 0; });
    },
  });
  const damage = () => h.allies().reduce((n, u) => n + (u.stats.dmg || 0), 0);
  while (h.b.time < duration && !h.b.finished) {
    // Saturated HPS capacity; does not claim this demand or coverage exists in a real lineup.
    for (const u of h.allies()) if (u.defId === 'botbench_patient') u.hp = u.s.maxHp * 0.4;
    h.b.step(); totalTicks++;
    if (h.enemies().some((e) => e.s.flags.silence)) silenceTicks++;
    defSum += h.enemies()[0]?.s.def || 0; resSum += h.enemies()[0]?.s.res || 0;
    if (h.b.time <= 20 + 1e-6) damage20 = damage();
  }
  if (h.b.errors.length) throw new Error(JSON.stringify(h.b.errors));
  const u = h.unit(1);
  return { id, profile, seed, seconds: h.b.time, damage: damage(), dps20: damage20 / 20, dps60: damage() / duration,
    hps: h.allies().reduce((n, a) => n + (a.stats.heal || 0), 0) / duration,
    silenceUptime: silenceTicks / totalTicks, defReduction: Math.max(0, p.def - defSum / totalTicks),
    resReduction: Math.max(0, p.res + (p.reflection ? 70 : 0) - resSum / totalTicks),
    damageTypes, maxPhysHit, alive: u.alive,
    skill: skillIndex === undefined ? original.skill?.skillId : original.skills.find((s) => s.index === skillIndex).skillId,
    ...(skillIndex === undefined ? {} : { skillIndex, actualSkill: u.def.skill?.id }) };
}

export function loadAtlas(path) { return JSON.parse(readFileSync(path, 'utf8')); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prefix = resolve(process.argv[2] || 'combat-atlas');
  const root = fileURLToPath(new URL('../../', import.meta.url)), data = getData();
  const manifest = { kind: 'capability-probes', createdAt: new Date().toISOString(), seeds: [17, 29], seconds: 60,
    sourceHash: hashTree(root, ['server', 'shared', 'tools/botbench/combat-atlas.mjs', 'test/helpers/battleHarness.js']),
    dataHash: hashTree(root, ['data']), profiles: PROBES,
    limitations: 'Stationary targets; no bonds, accumulated layers, equipment, economy or route coverage. Saturated healing targets; default skills. Summon deployment and reactive/on-hurt skills may be underestimated. Probe results are not match effectiveness.' };
  mkdirSync(dirname(prefix), { recursive: true });
  writeFileSync(`${prefix}.jsonl`, JSON.stringify({ manifest }) + '\n', { flag: 'wx' });
  const entries = {}, records = Object.values(data.chess).filter((c) => !c.isDiy && !c.isHidden && c.stats && c.chessType !== 'DIY');
  for (const c of records) {
    const profiles = {};
    for (const profile of Object.keys(PROBES)) {
      const rows = manifest.seeds.map((seed) => probeUnit(c.chessId, profile, { seed }));
      for (const row of rows) appendFileSync(`${prefix}.jsonl`, JSON.stringify(row) + '\n');
      profiles[profile] = Object.fromEntries(['dps20', 'dps60', 'hps', 'silenceUptime', 'maxPhysHit', 'defReduction', 'resReduction'].map((k) => [k, rows.reduce((n, r) => n + r[k], 0) / rows.length]));
    }
    entries[c.chessId] = { name: c.name, tier: c.tier, golden: c.isGolden, price: c.price, profiles };
    if (Object.keys(entries).length % 20 === 0) console.log(`${Object.keys(entries).length}/${records.length}`);
  }
  writeFileSync(`${prefix}.json`, JSON.stringify({ manifest, entries }), { flag: 'wx' });
  console.log(JSON.stringify({ operators: records.length, probes: records.length * 16, output: `${prefix}.json` }));
}
