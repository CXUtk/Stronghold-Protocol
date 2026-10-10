// Deployment-only rule: leaders accept erosion (user decision 2026-10-10), unlike upstream 0.2.3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';

function field(skill) {
  const sharedBoss = { hp: 1e6, maxHp: 1e6, damage(playerId, amount) { this.hp = Math.max(0, this.hp - amount); } };
  const h = makeBattle({ kind: 'boss', sharedBoss, autoFinish: false, seed: 23,
    hooks: ['elementBurst', 'damaged', 'ammoUsed'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: 6, charId: 'char_4231_clemnt', skillIndex: skill }, elite: true, potential: 6, row: 10, col: 3 }] });
  h.step();
  const u = h.unit(1);
  const boss = h.spawn('enemy_2016_csphtm', { pos: [3, 6], tag: 'boss', mods: { speedMul: 0 } });
  h.b.addBuff(boss, { key: 'test:hold', flags: { disarm: true, noMove: true } });
  u.trait.noAttack = true; // isolate the vortex / burst response from ordinary attacks
  u.skill.gainSp(999, 'init'); assert.equal(u.skill.activate('test'), true);
  return { h, u, boss };
}
function done(h) { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); }

test('deploy: 克莱门莎 S2 vortex fills 卢西恩 erosion, bursts, and credits shared boss damage', () => {
  const { h, boss } = field(1), def = boss.s.def;
  h.run(14);
  const bursts = h.hooksOf('elementBurst').filter((c) => c.target === boss && c.element === 'erosion');
  assert.equal(bursts.length, 1);
  assert.equal(boss.elem.erosion, 2000);
  assert.equal(boss.s.def, def - 120);
  assert.ok(h.hooksOf('damaged').some((c) => c.target === boss && c.dmg?.tags?.includes('clemnt:vortex:erosion')));
  const burst = h.hooksOf('damaged').find((c) => c.target === boss && c.dmg?.tags?.includes('burst') && c.dmg.element === 'erosion');
  assert.equal(burst.amount, 5000);
  assert.equal(burst.credit.def.charId, 'char_4231_clemnt');
  assert.ok(h.result().perPlayer.p1.bossDamage >= 5000);
  assert.ok(h.b.sharedBoss.hp < h.b.sharedBoss.maxHp);
  done(h);
});

test('deploy: boss erosion burst triggers 克莱门莎 S3 ammunition and all three bombardments', () => {
  const { h, u, boss } = field(2);
  h.b.dealDamage(u, boss, { amount: 2000, type: 'element', element: 'erosion' });
  h.step(); assert.equal(u.skill.ammoLeft, 9);
  h.run(2.7);
  const bombs = h.hooksOf('damaged').filter((c) => c.target === boss && c.dmg?.tags?.includes('clemnt:bomb'));
  assert.equal(bombs.filter((c) => c.type === 'phys').length, 3);
  assert.equal(bombs.filter((c) => c.type === 'elemental').length, 3);
  assert.equal(h.hooksOf('ammoUsed').length, 1);
  assert.ok(h.result().perPlayer.p1.bossDamage > 5000);
  done(h);
});

test('deploy: mirrored leaders share burst HP damage but keep separate erosion gauges and DEF cuts', () => {
  const { h, u, boss } = field(0);
  const mirror = h.spawn('enemy_2016_csphtm', { pos: [3, 12], tag: 'boss', mods: { speedMul: 0 } });
  assert.equal(mirror.bossPool, boss.bossPool);
  const hp = h.b.sharedBoss.hp, def = boss.s.def, mirrorDef = mirror.s.def;
  for (const target of [boss, mirror]) h.b.dealDamage(u, target, { amount: 1000, type: 'element', element: 'erosion' });
  assert.equal(h.b.sharedBoss.hp, hp);
  assert.equal(boss.elem.erosion, 1000); assert.equal(mirror.elem.erosion, 1000);
  h.b.dealDamage(u, boss, { amount: 1000, type: 'element', element: 'erosion' });
  assert.equal(hp - h.b.sharedBoss.hp, 5000);
  assert.equal(boss.s.def, def - 120); assert.equal(mirror.s.def, mirrorDef);
  assert.equal(mirror.elem.erosion, 1000);
  assert.equal(mirror.findBuff('erosionBurst'), null);
  h.b.dealDamage(u, mirror, { amount: 1000, type: 'element', element: 'erosion' });
  assert.equal(hp - h.b.sharedBoss.hp, 10000);
  assert.equal(mirror.s.def, mirrorDef - 120);
  assert.equal(h.result().perPlayer.p1.bossDamage, 10000);
  done(h);
});
