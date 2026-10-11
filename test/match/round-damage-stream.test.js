import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldRunner } from '../../server/match/fields.js';
import { makeMatch } from './harness.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

test('server snapshots and mid-battle resync carry identical cumulative damage with the Unite baseline', () => {
  const match = makeMatch({ humans: 1, clientCombat: false });
  const h = makeBattle({ fieldId: 'u', kind: 'unite', round: 6, autoFinish: false, content: 'none',
    players: [{ playerId: 'p_0', units: [{ uid: 11, chessId: 'chess_char_1_01_a', row: 10, col: 3 }] }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1000, atk: 0, speed: 0 }) } },
    enemies: [{ key: 'dummy', pos: [10, 5] }], flags: { startOpCooldown: 99 } });
  h.step();
  const u = h.unit(11), e = h.b.enemies.find((x) => x.alive);
  h.b.dealDamage(u, e, { amount: 77, type: 'true', canDodge: false });
  match.m.lastResults.set('p_0', { unitStats: [{ uid: 11, kind: 'op', defId: u.defId, name: u.name, dmg: 123 }] });
  const field = { fieldId: 'u', kind: 'unite', players: ['p_0'], battle: h.b, live: true };
  match.m.fields = [field];
  match.m.watchers.set('p_0', 'u');
  const runner = new FieldRunner(match.m, [field], { onDone() {} });
  const before = h.b.snapshot();
  runner._emit(field);
  const streamed = match.lastTo('p_0', 'b.snap');
  assert.equal(streamed.damage.units[0].dmg, 200);
  assert.equal(streamed.damage.round, 6);
  assert.equal(streamed.damage.fieldId, 'u');
  match.m._sendField('p_0', 'u');
  assert.deepEqual(match.lastTo('p_0', 'b.snap').damage, streamed.damage, 'watch/reconnect includes existing damage immediately');
  assert.deepEqual(h.b.snapshot(), before, 'display report stays outside simulation snapshots and golden digests');
  runner.stop();
  match.m.dispose();
});
