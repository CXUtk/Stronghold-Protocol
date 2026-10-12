import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

const MAKOTO = 'char_4217_makoto';
const FOE = 'enemy_makoto_test';
const pick = (skillIndex) => ({ diy: { slot: 6, charId: MAKOTO, skillIndex }, elite: true, row: 9, col: 5 });
const scene = (skillIndex, extra = []) => makeBattle({
  units: [pick(skillIndex), ...extra],
  defs: { enemies: { [FOE]: enemyRec({ key: FOE, hp: 30000, atk: 0, speed: 0 }) } },
  autoFinish: false, timeLimit: 45,
});
const enter = (h) => {
  h.run(0.1);
  const u = h.unit(1);
  u.skill.setSpTotal(100);
  assert.equal(u.skill.activate('manual'), true);
  assert.equal(u.trait.doll, true);
  h.run(1.2); // finish the dollkeeper's 1-second switch window
  return u;
};

test('结城理 enters the doll with her own range, talent stats and Orpheus S1 heals a low-HP ally', () => {
  const h = scene(0, [{ chessId: 'chess_char_1_01_a', row: 10, col: 5 }]);
  h.run(0.1);
  const ally = h.unit(2);
  ally.hp = ally.s.maxHp * 0.3;
  const u = h.unit(1);
  const bodyHp = u.s.maxHp;
  u.skill.setSpTotal(100);
  assert.equal(u.skill.activate('manual'), true);
  h.run(2.2);
  assert.equal(u.mem.makotoMode, 'orpheus1');
  assert.equal(u.rangeGrid.length, 13);
  assert.ok(u.s.maxHp > bodyHp);
  assert.ok(ally.hp > ally.s.maxHp * 0.3, 'the ordinary attack becomes a heal');
  assert.equal(h.invariants(), true);
});

test('结城理 S2 executes a feared enemy below the official ATK threshold', () => {
  const h = scene(1);
  const u = enter(h);
  const e = h.spawn(FOE, { pos: [9, 7], routeIndex: 0 });
  e.hp = u.s.atk;
  h.b.applyStatus(e, 'fear', { duration: 2, source: u });
  h.run(0.3);
  assert.equal(e.alive, false);
  assert.equal(h.invariants(), true);
});

test('结城理 S3 second activation changes Thanatos to Orpheus, restores two blocks and heals allies', () => {
  const h = scene(2, [{ chessId: 'chess_char_1_01_a', row: 10, col: 5 }]);
  const u = enter(h), ally = h.unit(2);
  assert.equal(u.mem.makotoMode, 'thanatos3');
  assert.equal(u.s.blockCnt, 0);
  assert.equal(u.skill.charges, 1);
  assert.equal(u.skill.activate('manual'), true);
  assert.equal(u.mem.makotoMode, 'orpheus3');
  assert.equal(u.s.blockCnt, 2);
  ally.hp = ally.s.maxHp * 0.3;
  h.run(1.6); // the next 1-second pulse attaches a heal that lands 0.5 s later
  assert.ok(ally.hp > ally.s.maxHp * 0.3);
  assert.equal(u.stats.attacks, 0, 'Orpheus+ does not make normal attacks');
  assert.equal(h.invariants(), true);
});

test('结城理 total attack uses body ATK rather than doll ATK when the substitute expires', () => {
  const h = scene(0);
  const u = enter(h);
  h.run(17.8);
  u.atkCd = 100;
  const e = h.spawn(FOE, { pos: [9, 7], routeIndex: 0 });
  const before = e.hp, bodyAtk = u.base.atk;
  h.run(3);
  assert.equal(u.trait.doll, false);
  assert.equal(before - e.hp, bodyAtk * 4.5);
  assert.equal(h.invariants(), true);
});

test('结城理 stage-3 module strengthens the substitute talent and trait from official data', () => {
  const h = makeBattle({ units: [{ diy: { slot: 6, charId: MAKOTO, skillIndex: 2,
    uniEquipId: 'uniequip_002_makoto' }, elite: true, row: 9, col: 5 }], autoFinish: false, timeLimit: 30 });
  const u = enter(h);
  assert.equal(u.def.raw.module.level, 3);
  assert.equal(u.s.atk, u.base.atk * 2);
  assert.equal(u.s.maxHp, u.base.maxHp * 1.6);
  assert.equal(h.invariants(), true);
});

test('结城理 S3 switches to Orpheus on lethal damage and the doll ending restores the body', () => {
  const h = scene(2);
  const u = enter(h);
  h.b.dealDamage(null, u, { amount: 999999, type: 'true', canDodge: false });
  assert.equal(u.alive, true);
  assert.equal(u.mem.makotoMode, 'orpheus3');
  h.run(21);
  assert.equal(u.trait.doll, false);
  assert.equal(u.mem.makotoMode, null);
  assert.equal(u.s.blockCnt, 2);
  assert.equal(h.invariants(), true);
});
