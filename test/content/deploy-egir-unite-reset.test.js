// deploy rule: down 阿戈尔 members start 联防 standing; every battle has its own knock-out / revive counters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { DATA } from '../match/harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { uniteBattleOpts } from '../../server/match/unite.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { FORCED_EXIT } from '../../server/sim/constants.js';

const gd = new GameData(DATA, 'mode_multi_hard');
const FISH = ['chess_char_5_05_a', 'chess_char_2_07_a', 'chess_char_4_12_a', 'chess_char_1_04_a', 'chess_char_3_09_a'];
const units = FISH.map((chessId, i) => ({ uid: i + 1, kind: 'chess', chessId, row: 10, col: 3 + i, dir: 'UP', items: [] }));
const bonds = { egirShip: { count: 5, active: true, tier: 2, layers: 0 } };
const kill = (b, u) => { u.hp = 0; b.kill(u); };
const revives = (b) => b.drainEvents().filter((e) => e[0] === 'fx' && e[1] === 'revive' && e[4]?.src === 'bond:egirShip');

/** Use the match's real normal-result → 联防 carry builder, then construct the same spec a client receives. */
function nextBattle(own, inputUnits, inputBonds = bonds, bandId = null) {
  own.b.forceEnd('timeout');
  const ps = {
    playerId: 'p1', seat: 0,
    board: new Map(inputUnits.map((u) => [`${u.row},${u.col}`, { uid: u.uid, kind: 'chess' }])),
    battleInput: ({ side, colOffset, carry }) => ({ playerId: 'p1', seat: 0, side, colOffset, bandId,
      bonds: inputBonds, playerEffects: [], units: inputUnits.map((u) => ({ ...u, carryState: carry.get(u.uid) })) }),
  };
  const m = { gd, round: 3, lastResults: new Map([['p1', own.result().perPlayer.p1]]), dispatch() {} };
  const { players } = uniteBattleOpts(m, { helpers: [ps], leaked: [] }, 60);
  const spec = buildBattleSpec({ battleId: 'unite-reset', kind: 'unite', seed: 1, players, spawns: [], flags: { layerGainsEnabled: false } });
  const b = createBattleFromSpec(spec, own.b.data, { quiet: true });
  b.start();
  return b;
}

test('normal → 联防: down 阿戈尔 stand again and the same members receive three fresh first-knock-out revives', () => {
  const own = makeBattle({ units, bonds, autoFinish: false });
  own.step();
  const source = units.map((u) => own.unit(u.uid));
  for (const u of source.slice(0, 3)) { kill(own.b, u); assert.ok(u.alive, 'normal: revived'); }
  assert.equal(revives(own.b).length, 3, 'all normal-battle slots spent');
  kill(own.b, source[3]);
  assert.ok(!source[3].alive, 'normal: fourth member stays down');
  const b = nextBattle(own, units);
  const fresh = units.map((u) => b.allyUnits.find((x) => x.uid === u.uid));
  assert.ok(fresh.every((u) => u.alive && u.deployed), 'the down member starts 联防 standing too');
  assert.equal(b.result().perPlayer.p1.deaths, 0, 'previous knock-outs are not carried');
  assert.ok(fresh.every((u) => u.carry?.down !== true));
  revives(b);
  for (const u of fresh.slice(0, 3)) { kill(b, u); assert.ok(u.alive, '联防: first knock-out revives again'); }
  assert.deepEqual(revives(b).map((e) => e[4].n), [1, 2, 3], 'a new per-battle revive budget');
  kill(b, fresh[3]);
  assert.ok(!fresh[3].alive, 'the fourth new knock-out cannot exceed the new budget');
  assert.equal(b.result().perPlayer.p1.deaths, 4);
  assert.deepEqual(b.result().perPlayer.p1.layerGains, {}, '联防 still adds no layers');
  checkInvariants(b);
});

test('联防: the down-member exception requires active 阿戈尔; other down operators still enter forced out', () => {
  for (const active of [true, false]) {
    const h = makeBattle({ kind: 'unite', autoFinish: false,
      units: [
        { ...units[0], carryState: { down: true } },
        { uid: 99, chessId: 'chess_char_1_01_a', row: 12, col: 6, carryState: { down: true } },
      ], bonds: { egirShip: { ...bonds.egirShip, active } } });
    h.step();
    assert.equal(h.unit(1).alive, active);
    assert.equal(h.unit(99).alive, false);
    assert.equal(h.unit(99).removeReason, FORCED_EXIT);
    checkInvariants(h.b);
  }
});

test('联防: previously down 阿戈尔 get fresh HP / SP while standing members retain their carried values', () => {
  const down = { down: true };
  const input = [
    { ...units[0], carryState: down },
    { ...units[1], carryState: { hpPct: 0.25, sp: 17 } },
  ];
  const fresh = makeBattle({ kind: 'unite', units: units.slice(0, 2), bonds, autoFinish: false });
  const carried = makeBattle({ kind: 'unite', units: input, bonds, autoFinish: false });
  fresh.b.start();
  carried.b.start();
  assert.equal(carried.unit(1).hp, carried.unit(1).s.maxHp, 'down member starts full');
  assert.equal(carried.unit(1).skill.spTotal, fresh.unit(1).skill.spTotal, 'fresh deployment SP');
  assert.equal(carried.unit(2).hp, carried.unit(2).s.maxHp * 0.25, 'standing member keeps its HP ratio');
  assert.equal(carried.unit(2).skill.spTotal, 17, 'standing member keeps its SP');
  assert.deepEqual(down, { down: true }, 'the original battle input is not mutated');
  checkInvariants(carried.b);
});

test('联防: down 调和 and 变形同构体 recipients stand, with membership scoped to their active bonds', () => {
  for (const maniActive of [true, false]) {
    const h = makeBattle({ kind: 'unite', autoFinish: false,
      defs: { chess: { mani_a: chessRec({ id: 'mani_a', bonds: ['maniShip'], skill: null }) } },
      units: [
        { uid: 1, chessId: 'mani_a', row: 10, col: 3, dir: 'UP', carryState: { down: true } },
        { uid: 2, chessId: 'chess_char_3_21_a', row: 10, col: 5, dir: 'UP', carryState: { down: true },
          items: ['chess_item_6_09_e_a', 'chess_item_3_07_e_a'] },
        { uid: 3, chessId: 'chess_char_1_01_a', row: 10, col: 7, dir: 'UP', carryState: { down: true } },
      ],
      bonds: { ...bonds, maniShip: { count: 1, active: maniActive, tier: 1, layers: 0 } },
    });
    h.b.start();
    assert.equal(h.unit(1).alive, maniActive, '调和 must be active to receive 阿戈尔');
    assert.ok(h.unit(2).alive && h.unit(2).deployed, 'granted 阿戈尔 member stands');
    assert.equal(h.unit(3).removeReason, FORCED_EXIT, 'other down operator stays out');
    checkInvariants(h.b);
  }
});

test('normal → 联防: 埃芒加德 gets three fresh revives after spending the previous battle\'s three', () => {
  const input = [{ uid: 1, kind: 'chess', chessId: 'chess_char_2_12_a', row: 10, col: 4, items: [] }];
  const own = makeBattle({ units: input, bandId: 'band_ermengard', autoFinish: false });
  own.step();
  for (let i = 0; i < 3; i++) { kill(own.b, own.unit(1)); assert.ok(own.unit(1).alive); }
  const b = nextBattle(own, input, {}, 'band_ermengard');
  const u = b.allyUnits.find((x) => x.uid === 1);
  assert.equal(b.result().perPlayer.p1.deaths, 0);
  for (let i = 0; i < 3; i++) { kill(b, u); assert.ok(u.alive, `fresh revive ${i + 1}`); }
  kill(b, u);
  assert.equal(u.alive, false, 'the new battle still has a three-revive cap');
  checkInvariants(b);
});
