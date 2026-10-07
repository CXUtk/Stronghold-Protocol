// 联防 keeps the round's terrain and devices together with the helpers' deployment. The escaped template supplies
// enemy routes only: one helper enters at col 10, two at col 18. Replacing the map with the template's all-road field
// used to remove water, fences and crates. Check both combat modes and the map delivered to the watching client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEO, PHASE } from '../../shared/constants.js';
import { Battle } from '../../server/sim/Battle.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { buildBoard, AREAS } from '../../public/js/render/board3d/layout.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, give, chessOfTier, legalTileFor, checkInvariants } from './harness.js';

/** A real battle that only ends by its time limit (the check follows the enemies, whatever the helpers do). */
class NoFinish extends Battle {
  constructor(o) { super({ ...o, autoFinish: false }); }
}

/**
 * Co-op on 战场#01 (its row 9 is fenced off at cols 5–7: "##Err###rrSrr###rrS##"): p_0 leaks 3 enemies, the other
 * players are perfect — 1 helper with 2 humans, 2 helpers with 3. Each helper fields one ranged operator in its corner.
 */
function scenario({ humans, clientCombat, stageId = 'act1autochess_m01' }) {
  const h = makeMatch({
    mode: 'coop', humans, seed: 4101 + humans, fake: true, clientCombat,
    script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 3 } } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  h.setStage(stageId);
  const ranged = chessOfTier(1, (c) => c.position === 'RANGED').filter((x) => m.pool.has(x));
  const helpers = [];
  for (let i = 1; i < humans; i++) {
    const ps = h.ps(`p_${i}`);
    const id = ranged[i];
    helpers.push({ ps, piece: give(m, ps, id, 'board', legalTileFor(m, ps, id)) });
  }
  h.drive(() => m.phase === PHASE.UNITE);
  return { h, m, helpers };
}

/** The 联防 field's spec / options as the match built them, and a real battle over them. */
function uniteField(m, clientCombat) {
  if (clientCombat) {
    const f = m.fields[0];
    return { opts: f.spec, battle: createBattleFromSpec(f.spec, new DataSource(DATA, null), { BattleClass: NoFinish, recordEvents: false }) };
  }
  const u = FakeBattle.instances.find((b) => b.kind === 'unite');
  return { opts: u.opts, battle: new NoFinish({ ...u.opts, data: m.ds, logger: { warn() {}, error() {}, info() {}, debug() {} } }) };
}

for (const clientCombat of [true, false]) {
  test(`联防 with 1 helper (${clientCombat ? 'client-side combat' : 'server-run'}): keeps the round's map and routes enemies around its fences`, () => {
    const { m, helpers } = scenario({ humans: 2, clientCombat });
    assert.deepEqual(m.unitePlan.helpers.map((p) => p.playerId), ['p_1']);
    const { opts, battle: b } = uniteField(m, clientCombat);
    assert.equal(opts.stageId, m.stageId);
    assert.deepEqual(opts.rect, GEO.UNITE_RECT);
    assert.equal(b.stage.id, 'act1autochess_m01');
    assert.deepEqual(b.stage.rows, m.stage.rows);
    for (let c = 5; c <= 7; c++) assert.ok(!b.grid.groundPassable(9, c), `(9,${c}) keeps the original fence`);
    assert.equal(m.stage.rows[9].slice(5, 8), '###', '战场#01 itself has no ground there');
    for (const c of [19, 20]) assert.ok(!b.grid.groundPassable(9, c), `(9,${c}) is no ground`);
    // the routes of escaped_single: every one starts at col 10
    assert.ok(opts.routes.every((r) => (r.start ?? [r.startPosition?.row, r.startPosition?.col])[1] === 10));
    // the helper's piece stands on its prep tile
    const { ps, piece } = helpers[0];
    const [r, c] = [...ps.board.entries()].find(([, p]) => p === piece)[0].split(',').map(Number);
    b.step();
    const u = b.allyUnits.find((x) => x.uid === piece.uid && x.ownerId === 'p_1');
    assert.deepEqual([u.tileR, u.tileC], [r, c]);
    // Walkers keep respecting the inherited map's blocked tiles.
    const crossed = new Set();
    while (b.time < 60 && !b.finished) {
      b.step();
      for (const e of b.enemies) if (e.alive && e.motion !== 'FLY') crossed.add(`${Math.round(e.y)},${Math.round(e.x)}`);
    }
    assert.ok(crossed.size > 0, 'walkers spawned');
    assert.ok(['9,5', '9,6', '9,7'].every((k) => !crossed.has(k)), 'walkers do not cross the original fence');
    assert.equal(b.errorCount || 0, 0);
    checkInvariants(m);
    m.dispose();
  });
}

test('联防 with 2 helpers: keeps the round map — first helper on the right (col + 8), enemies enter at col 18; the client receives that map', () => {
  const { h, m, helpers } = scenario({ humans: 3, clientCombat: false });
  const order = m.unitePlan.helpers.map((p) => p.playerId);
  assert.equal(order.length, 2);
  const { opts, battle: b } = uniteField(m, false);
  assert.equal(opts.stageId, m.stageId);
  assert.equal(b.stage.id, m.stageId);
  assert.deepEqual(opts.players.map((p) => [p.playerId, p.colOffset]), [[order[0], 8], [order[1], 0]]);
  assert.ok(opts.routes.every((r) => r.start[1] === 18), 'every route enters at col 18');
  assert.ok(opts.routes.filter((r) => r.motion === 'WALK').every((r) => r.checkpoints.some(([rr, cc]) => rr === 9 && cc === 10)), 'walkers pass (9,10)');
  b.step();
  for (const { ps, piece } of helpers) {
    const [r, c] = [...ps.board.entries()].find(([, p]) => p === piece)[0].split(',').map(Number);
    const u = b.allyUnits.find((x) => x.uid === piece.uid && x.ownerId === ps.playerId);
    const off = ps.playerId === order[0] ? 8 : 0;
    assert.deepEqual([u.tileR, u.tileC], [r, c + off], `${ps.playerId}: its prep tile${off ? ' on the right half' : ''}`);
    assert.equal(b.stage.rows[r][c + off], m.stage.rows[r][c + off], 'the original terrain under the operator');
  }
  // what a watching browser receives: the m.field of the 联防 carries the map it is drawn on
  m.handle('p_0', { t: 'g.watch', fieldId: 'u' });
  const meta = h.lastTo('p_0', 'm.field');
  assert.equal(meta && meta.stageId, m.stageId);
  assert.equal(m.stageId, 'act1autochess_m01', 'the match stage (m.public stageId, the boards) stays the round\'s');
  checkInvariants(m);
  m.dispose();
});

test('degraded data without the 联防 maps: the field keeps the round\'s stage', () => {
  const stages = Object.fromEntries(Object.entries(DATA.stages).filter(([, s]) => s.kind !== 'unite'));
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 4199, fake: true, data: { ...DATA, stages }, script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 2 } } : {}) }).start();
  const m = h.m;
  h.toPrep(1);
  const ps = h.ps('p_1');
  const id = chessOfTier(1, (c) => c.position === 'RANGED').find((x) => m.pool.has(x));
  give(m, ps, id, 'board', legalTileFor(m, ps, id));
  h.drive(() => m.phase === PHASE.UNITE);
  assert.equal(FakeBattle.instances.find((b) => b.kind === 'unite').opts.stageId, m.stageId);
  m.dispose();
});

for (const clientCombat of [true, false]) for (const humans of [2, 3]) {
  test(`联防 carries 涨潮控制 water, fences and crates (${humans - 1} helper(s), ${clientCombat ? 'client' : 'server'})`, () => {
    const { h, m } = scenario({ humans, clientCombat, stageId: 'act2autochess_m04' });
    const { opts, battle: b } = uniteField(m, clientCombat);
    assert.equal(opts.stageId, 'act2autochess_m04');
    assert.deepEqual(b.stage.rows, m.stage.rows);
    assert.equal(b.grid.tile(10, 6).terrain, 'deepsea');
    assert.equal(b.grid.tile(10, 14).terrain, 'deepsea', 'water on the right half');
    assert.ok(!b.grid.groundPassable(9, 5), 'the left fence remains impassable');
    assert.ok(!b.grid.groundPassable(9, 13), 'the right fence remains impassable');
    b.step();
    const crates = b.allyUnits.filter((u) => u.kind === 'device' && u.defId === 'trap_1105_accrate');
    assert.deepEqual(crates.map((u) => [u.tileR, u.tileC]).sort(), [[10, 9], [10, 17], [11, 9], [11, 17]].sort());
    m.handle('p_0', { t: 'g.watch', fieldId: 'u' });
    const meta = clientCombat ? h.lastTo('p_0', 'b.start').spec : h.lastTo('p_0', 'm.field');
    assert.equal(meta.stageId, m.stageId, 'watchers receive the inherited map');
    const board = buildBoard(DATA.stages[meta.stageId], { area: AREAS.unite });
    assert.equal(board.terrain.water.length, 6, 'the 3D map includes both halves\' water');
    assert.ok(board.devices.filter((d) => d.kind === 'crate').length >= 4, 'the 3D map retains the crates');
    assert.equal(b.errorCount, 0);
    checkInvariants(m);
    m.dispose();
  });
}
