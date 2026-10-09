import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { enemyStealthed, canTargetEnemy } from '../../server/sim/targeting.js';
import { flagsOf } from '../../server/sim/snapshot.js';
import { UF } from '../../shared/constants.js';

const WALL = chessRec({ id: 't_restealth_wall', profession: 'TANK', stats: { maxHp: 1e7, atk: 0, blockCnt: 1 }, skill: null });

function blockedEnemy(key) {
  const h = makeBattle({
    defs: { chess: { [WALL.chessId]: WALL } }, autoFinish: false, timeLimit: 60,
    units: [{ chessId: WALL.chessId, row: 9, col: 5 }],
    enemies: [{ key, pos: [9, 5], mods: { speedMul: 0 } }],
    // Keep native form changes, but isolate blocking from attacks and automatic blink skills.
    setup(b) { b.on('enemySpawn', ({ enemy }) => {
      enemy.atkCd = 1e6;
      for (const a of enemy.mem.ab?.list ?? []) if (a.cd != null) a.left = 1e6;
    }, { priority: 0 }); },
  });
  h.step(2);
  const e = h.enemy(key), wall = h.unit(WALL.chessId);
  assert.equal(e.blockedBy, wall);
  return { h, e, wall };
}

test('锏重生的不可阻挡及时释放原阻挡名额', () => {
  const { h, e, wall } = blockedEnemy('enemy_1525_blkswb');
  h.b.kill(e, wall);
  assert.equal(e.form, 'reborn');
  assert.ok(e.s.flags.stun && e.s.flags.unblockable);
  const next = h.spawn('enemy_1299_ymkilr', { pos: [9, 5.3], routeIndex: 0, mods: { speedMul: 0 } });
  h.step(2);
  assert.equal(e.blockedBy, null, '重生中的敌人不继续占用阻挡');
  assert.equal(next.blockedBy, wall, '空出的名额可阻挡下一个敌人');
  assert.deepEqual(wall.blocking, [next]);
  assert.equal(h.b.errorCount, 0);
  checkInvariants(h.b);
});

for (const key of ['enemy_1299_ymkilr', 'enemy_1299_ymkilr_2']) {
  test(`${key}: 已晕眩的隐匿敌人获得不可阻挡后，从解除阻挡起等待3秒`, () => {
    const { h, e, wall } = blockedEnemy(key);
    h.b.applyStatus(e, 'stun', { duration: 10, force: true });
    assert.equal(e.blockedBy, wall, '单独晕眩不解除敌人所受阻挡');
    h.b.addBuff(e, { key: 'test:unblockable', duration: 10, flags: { unblockable: true } });
    h.step();
    assert.equal(e.blockedBy, null, '不可阻挡即使与晕眩同时存在也必须释放');
    assert.deepEqual(wall.blocking, []);
    const visible = () => {
      assert.equal(enemyStealthed(e), false);
      assert.equal(flagsOf(e) & UF.STEALTH, 0);
      assert.equal(canTargetEnemy(wall, e), true);
      assert.ok(h.b.foesInRadius(e.x, e.y, 0.3).includes(e));
    };
    visible();
    h.run(2.9); visible();
    h.run(0.2);
    assert.equal(enemyStealthed(e), true);
    assert.ok(flagsOf(e) & UF.STEALTH);
    assert.equal(canTargetEnemy(wall, e), false);
    assert.equal(h.b.errorCount, 0);
    checkInvariants(h.b);
  });
}
