import { test } from 'node:test';
import assert from 'node:assert/strict';
import { battleDamageStats, completedDamageStats } from '../../shared/combatStats.js';
import { makeBattle, enemyRec, chessRec } from '../helpers/battleHarness.js';
import { SharedBossPool } from '../../server/match/finalAssault.js';
import { compactResult, buildBattleSpec } from '../../server/sim/spec.js';
import { validateClientResult } from '../../server/match/fields.js';
import { isBattleResult } from '../../shared/protocol.js';

test('damage panel reads actual HP removed, excludes friendly/self damage and retains knocked-out operators', () => {
  const h = makeBattle({ autoFinish: false, round: 5, content: 'none',
    units: [{ uid: 11, chessId: 'chess_char_1_01_a', row: 10, col: 3 }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 100, speed: 0, atk: 0 }) } },
    enemies: [{ key: 'dummy', pos: [10, 5] }], flags: { startOpCooldown: 99 } });
  h.step();
  const u = h.unit(11), e = h.b.enemies.find((x) => x.alive);
  h.b.dealDamage(u, u, { amount: 10, type: 'true', canDodge: false });
  assert.equal(battleDamageStats(h.b).units[0].dmg, 0);
  h.b.dealDamage(u, e, { amount: 9999, type: 'true', canDodge: false });
  assert.equal(battleDamageStats(h.b).units[0].dmg, 100, 'overkill contributes only remaining enemy HP');
  h.b.kill(u, null);
  const report = battleDamageStats(h.b);
  assert.equal(report.round, 5);
  assert.equal(report.units[0].dmg, 100, 'an operator disappearing from snapshots keeps its damage');
});

test('same round normal + Unite combines each player’s piece, separates duplicates and aggregates expired summons', () => {
  const normal = new Map([
    ['p1', { unitStats: [{ id: 1, uid: 11, kind: 'op', name: 'A', defId: 'a', dmg: 100 },
      { id: 4, kind: 'token', name: 'T', defId: 'token_t', dmg: 30 }] }],
    ['p2', { unitStats: [{ id: 2, uid: 11, kind: 'op', name: 'A', defId: 'a', dmg: 200 }] }],
    ['p3', { unitStats: [{ id: 3, uid: 11, kind: 'op', name: 'A', defId: 'a', dmg: 900 }] }],
  ]);
  const baseline = completedDamageStats(normal, ['p1', 'p2']);
  const units = [{ id: 30, uid: 11, kind: 'op', name: 'A', defId: 'a', stats: { dmg: 50 } },
    { id: 31, uid: 12, kind: 'op', name: 'A', defId: 'a', stats: { dmg: 25 } },
    { id: 32, kind: 'token', name: 'T', defId: 'token_t', alive: false, stats: { dmg: 10.2 } },
    { id: 33, kind: 'token', name: 'T', defId: 'token_t', stats: { dmg: 9.8 } }];
  const report = battleDamageStats({ fieldId: 'u', kind: 'unite', round: 3, time: 12,
    players: [{ playerId: 'p1', units }, { playerId: 'p2', units: [{ ...units[0], stats: { dmg: 75 } }] }] }, baseline);
  assert.equal(report.units.find((u) => u.id === 'p1:op:11').dmg, 150);
  assert.equal(report.units.find((u) => u.id === 'p2:op:11').dmg, 275, 'player uid spaces never overlap');
  assert.equal(report.units.find((u) => u.id === 'p1:op:12').dmg, 25, 'two copies of A remain separate');
  assert.equal(report.units.find((u) => u.kind === 'token').dmg, 50);
  assert.equal(report.units.length, 4, 'no absent player and no duplicate expired summon rows');
  assert.deepEqual(battleDamageStats({ fieldId: 'n:p1', round: 4, players: [{ playerId: 'p1', units: [] }] }).units, [], 'new round starts with fresh counters');
});

test('reporting is detached, never touches computed stats, and cannot mutate the battle or prior-round results', () => {
  const unit = { id: 1, uid: 7, kind: 'op', defId: 'diy_slot', name: '克莱门莎', def: { golden: true }, stats: { dmg: 123.4 },
    get s() { throw new Error('reporting recomputed stats'); } };
  const battle = { fieldId: 'f', time: 10, round: 14, finished: true, players: [{ playerId: 'p1', units: [unit] }] };
  const report = battleDamageStats(battle);
  assert.equal(report.units[0].name, '克莱门莎', 'uses the actual operator, including DIY / stand-in identity');
  assert.equal(report.units[0].golden, true);
  report.units[0].dmg = 0;
  assert.equal(battleDamageStats(battle).units[0].dmg, 123);
  assert.equal(unit.stats.dmg, 123.4);
});

const member = (id, bond) => chessRec({ id, bonds: [bond], skill: null });
const activeBond = (count, layers = 0) => ({ count, active: true, tier: 2, layers });
const reportDamage = (h) => battleDamageStats(h.b).units.reduce((sum, u) => sum + u.dmg, 0);

for (const kind of ['normal', 'boss']) test(`3 坚守 reflection is separately reported and included exactly once in ${kind} damage`, () => {
  const pool = kind === 'boss' ? new SharedBossPool(1e6) : null;
  const defs = { chess: { d1: member('d1', 'steadShip'), d2: member('d2', 'steadShip'), d3: member('d3', 'steadShip'),
    other: chessRec({ id: 'other', skill: null }) }, enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e6, speed: 0, res: 20 }) } };
  const h = makeBattle({ kind, sharedBoss: pool, defs, autoFinish: false, flags: { startOpCooldown: 99 },
    units: ['d1', 'd2', 'd3', 'other'].map((chessId, i) => ({ chessId, row: 10, col: 3 + i })),
    bonds: { steadShip: activeBond(3, 10) }, enemies: [{ key: 'dummy', pos: [9, 9], ...(pool ? { tag: 'boss' } : {}) }],
    hooks: ['damaged'], captureNoisy: true });
  h.step();
  const e = h.enemy(), d1 = h.unit('d1'), d2 = h.unit('d2');
  const hp = () => pool ? pool.hp : e.hp;
  const before = hp();
  h.b.dealDamage(e, h.unit('other'), { amount: 100, type: 'true' });
  assert.equal(reportDamage(h), 0, 'friendly shared damage is not outgoing Alliance damage');
  h.b.addBuff(d1, { key: 'test:bonus', mods: { dmgDealtMul: 2 } });
  h.b.dealDamage(e, d1, { amount: 100, type: 'true' });
  assert.equal(d1.stats.bondDamage.steadShip, 760, 'actual RES-mitigated reflection; source attack multipliers do not apply');
  assert.equal(battleDamageStats(h.b).units.find((u) => u.uid === d1.uid).bondDamage.steadShip, 760);
  const first = hp();
  h.b.dealDamage(e, d1, { amount: 100, type: 'true' });
  assert.equal(hp(), first, 'cooldown produces neither damage nor an extra subtotal');
  h.b.dealDamage(e, d2, { amount: 100, type: 'true' });
  const total = before - hp();
  assert.equal(reportDamage(h), Math.round(total), 'reflection stays part of total, never added twice');
  assert.equal(d1.stats.bondDamage.steadShip + d2.stats.bondDamage.steadShip, total);
  const reflected = h.hooksOf('damaged').find((c) => c.target === e);
  assert.equal(reflected.source, null, 'sourceless combat mechanics unchanged');
  assert.equal(reflected.credit, d1);
  if (pool) assert.equal(h.result().perPlayer.p1.bossDamage, total);
});

test('叙拉古 procs have their own subtotal, survive compact/accepted normal results and combine into Unite', () => {
  const units = Array.from({ length: 6 }, (_, i) => ({ chessId: `s${i}`, row: 10, col: 3 + i }));
  const h = makeBattle({ defs: { chess: Object.fromEntries(units.map((u) => [u.chessId, member(u.chessId, 'siracusaShip')])),
    enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0 }) } }, units, bonds: { siracusaShip: activeBond(6, 20) },
    enemies: [{ key: 'dummy', pos: [12, 9] }], autoFinish: false, flags: { startOpCooldown: 99 }, hooks: ['damaged'], captureNoisy: true });
  h.step();
  const u = h.unit('s0'), e = h.enemy(), before = e.hp;
  for (let i = 0; i < 750; i++) h.b.dealDamage(u, e, { amount: 1, type: 'phys', isAttack: true, canDodge: false });
  const procs = h.hooksOf('damaged').filter((c) => c.dmg.tags.includes('bond:siracusa'));
  assert.ok(procs.length > 0, 'real seeded PRD triggers the Alliance effect');
  const bond = procs.length * 6000;
  const live = battleDamageStats(h.b).units.find((r) => r.uid === u.uid);
  assert.equal(live.bondDamage.siracusaShip, bond);
  assert.equal(live.dmg, before - e.hp);
  assert.equal(live.dmg, 750 + bond, 'ordinary and Alliance damage each counted once');
  h.b.forceEnd('forced');
  const result = compactResult(h.result());
  assert.ok(isBattleResult(result), 'Alliance metadata passes wire shape validation');
  const spec = buildBattleSpec({ battleId: 'sira', fieldId: 'n:p1', kind: 'normal', round: 1, stageId: 'flat', timeLimit: 60,
    players: [{ playerId: 'p1', units: units.map((x, i) => ({ uid: i + 1, ...x, kind: 'chess' })) }],
    spawns: [{ enemyKey: e.defId, time: 0, count: 1 }] });
  const accepted = validateClientResult(spec, result, {});
  assert.ok(accepted.ok, accepted.reason);
  assert.equal(accepted.result.perPlayer.p1.unitStats[0].bondDamage.siracusaShip, bond, 'server sanitization retains the subtotal');
  for (const invalid of [{ unknown: 1 }, { siracusaShip: live.dmg + 1 }, { steadShip: Infinity }, { steadShip: -1 }]) {
    const bad = JSON.parse(JSON.stringify(result));
    bad.perPlayer.p1.unitStats[0].bondDamage = invalid;
    assert.equal(isBattleResult(bad), false, 'unknown, oversized, non-finite and negative metadata rejected');
  }
  const normal = new Map([['p1', accepted.result.perPlayer.p1]]);
  const base = completedDamageStats(normal, ['p1']);
  const unite = battleDamageStats({ kind: 'unite', players: [{ playerId: 'p1', units: [
    { uid: u.uid, kind: 'op', name: u.name, defId: u.defId, stats: { dmg: 25, bondDamage: { siracusaShip: 20 } } },
  ] }] }, base).units.find((r) => r.uid === u.uid);
  assert.equal(unite.dmg, live.dmg + 25);
  assert.equal(unite.bondDamage.siracusaShip, bond + 20, 'normal + Unite subtotals accumulate with the operator');
});

test('卡西米尔 blocking pulses and non-blocking bonus hits are separate from ordinary attacks', () => {
  const units = Array.from({ length: 6 }, (_, i) => ({ chessId: `k${i}`, row: i ? 12 : 9, col: i ? 2 + i : 5 }));
  const h = makeBattle({ defs: { chess: Object.fromEntries(units.map((u) => [u.chessId, member(u.chessId, 'kazimierzShip')])),
    enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 1, atk: 0 }) } }, units, bonds: { kazimierzShip: activeBond(6) },
    enemies: [{ key: 'dummy', route: 0 }], autoFinish: false, hooks: ['damaged'], captureNoisy: true });
  const blocker = h.unit('k0');
  assert.ok(h.runUntil(() => blocker.blocking.length > 0, 30));
  h.run(4.1);
  const e = h.enemy(), free = h.unit('k1');
  h.b.dealDamage(free, e, { amount: 100, type: 'phys', isAttack: true, canDodge: false });
  const bondHits = h.hooksOf('damaged').filter((c) => c.dmg.tags.includes('bond:kazimierz'));
  assert.ok(bondHits.some((c) => c.source === blocker && c.dmg.isSplash), 'real blocking pulse');
  assert.ok(bondHits.some((c) => c.source === free && !c.dmg.isSplash), 'real bonus hit');
  for (const u of [blocker, free]) {
    const expected = bondHits.filter((c) => c.credit === u).reduce((sum, c) => sum + c.amount, 0);
    const row = battleDamageStats(h.b).units.find((r) => r.uid === u.uid);
    assert.equal(row.bondDamage.kazimierzShip, expected);
    assert.ok(row.dmg > expected, 'ordinary damage remains in the operator total');
  }
});

test('炎佑 output is Alliance damage and remains one separate summon row; overkill is excluded', () => {
  const units = Array.from({ length: 6 }, (_, i) => ({ chessId: `y${i}`, row: 10, col: 3 + i }));
  const h = makeBattle({ defs: { chess: Object.fromEntries(units.map((u) => [u.chessId, member(u.chessId, 'yanShip')])),
    enemies: { dummy: enemyRec({ key: 'dummy', hp: 70, speed: 0 }) } }, units, bonds: { yanShip: activeBond(6) },
    enemies: [{ key: 'dummy', pos: [12, 9] }], autoFinish: false, flags: { startOpCooldown: 99 } });
  h.step();
  const y = h.allies().find((u) => u.mem.bondYan);
  assert.ok(y, 'spawned by the actual Alliance');
  h.b.dealDamage(y, h.enemy(), { amount: 9999, type: 'true', canDodge: false });
  const report = battleDamageStats(h.b), row = report.units.find((u) => u.kind === 'token');
  assert.equal(row.dmg, 70);
  assert.deepEqual(row.bondDamage, { yanShip: 70 });
  assert.equal(reportDamage(h), 70, 'neither summon nor Alliance classification adds a second copy');
});
