import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

const cases = [
  ['chess_char_2_01', 1, 'arrow', 2], // 送葬人 S2
  ['chess_char_3_01', 0, 'arrow', 3], // 能天使 S1
  ['chess_char_3_01', 1, 'arrow', 4], // 能天使 S2
  ['chess_char_3_01', 2, 'arrow', 5], // 能天使 S3
  ['chess_char_3_21', 2, 'arrow', 3], // 空弦 S3
  ['chess_char_4_01', 0, 'arrow', 3], // 信仰搅拌机 S1
  ['chess_char_6_13', 2, 'arrow', 5], // 新约能天使 S3
  ['chess_char_4_13', 0, 'bolt', 2],  // 灵知 S1
];

for (const [base, skillIndex, projectile, hits] of cases) for (const form of ['a', 'b']) {
  const id = `${base}_${form}`;
  test(`${id} skill ${skillIndex + 1}: one attack launches ${hits} cosmetic ${projectile}s with unchanged impact damage`, () => {
    const h = makeBattle({
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0, def: 0, res: 0 }) } },
      units: [{ chessId: id, row: 10, col: 3, skillIndex }],
      enemies: [{ key: 'dummy', pos: [10, 5] }], timeLimit: 10,
      hooks: ['damaged'], captureNoisy: true,
    });
    const u = h.unit(id);
    h.step();
    assert.equal(h.eventsOf('atk').filter(e => e[1] === u.id)[0]?.[4], undefined, 'normal attacks retain the legacy event');
    u.atkCd = 5;
    h.run(1); // wait for the normal shot to land
    const beforeEvents = h.eventsOf('atk').length, beforeDamage = h.hooksOf('damaged').length;
    assert.ok(u.skill.activate('test', { free: true }));
    u.atkCd = 0;
    h.step();
    const volley = h.eventsOf('atk').slice(beforeEvents).filter(e => e[1] === u.id);
    assert.equal(volley.length, 1, 'the volley is still one simulation attack');
    assert.equal(volley[0][3], projectile);
    assert.equal(volley[0][4], hits, 'renderer receives the fixed hit count');
    assert.equal(h.b.projectiles.list.filter(p => p.source === u).length, 1, 'no extra simulation projectiles');
    h.run(0.5);
    const dealt = h.hooksOf('damaged').slice(beforeDamage).filter(c => c.source === u && c.dmg?.isAttack);
    assert.equal(dealt.length, hits, 'damage count stays unchanged');
    assert.equal(h.b.errorCount, 0);
  });
}
