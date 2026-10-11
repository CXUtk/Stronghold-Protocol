import { test } from 'node:test';
import assert from 'node:assert/strict';
import { battleDamageStats, completedDamageStats } from '../../shared/combatStats.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

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
