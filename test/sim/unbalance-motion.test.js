import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { PULL_STOP_RADIUS, PUSH_TILES, TICK, UNBALANCE_MIN_DURATION } from '../../server/sim/constants.js';

const approx = (a, b, eps = 1e-5, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b}`);
const still = (key, mass = 0, extra = {}) => ({ ...enemyRec({ key, hp: 1e8, atk: 0, speed: 0, mass }), ...extra });

function lane(enemies, units = []) {
  return makeBattle({ defs: { enemies, chess: Object.fromEntries(units.map((u) => [u.chessId, u])) }, units: units.map((u, i) => ({ chessId: u.chessId, row: 10, col: 3 + i })), content: 'none', autoFinish: false, timeLimit: 30 });
}

function settle(h, e, seconds = 4) {
  assert.ok(e.unbalance, 'entered unbalance');
  assert.ok(h.runUntil(() => !e.unbalance, seconds), 'unbalance ended');
}

test('continuous push moves over several frames and stops at the force-distance table value', () => {
  const h = lane({ e: still('e') });
  h.step();
  const e = h.spawn('e', { pos: [10, 4] });
  const x0 = e.x;
  const predicted = h.b.push(e, 1, { from: { x: 3, y: 10 } });
  approx(predicted, PUSH_TILES[1], 1e-9);
  approx(e.x, x0, 1e-12, 'not teleported on application');
  h.step();
  assert.ok(e.x > x0 && e.x < x0 + predicted, 'part-way after one frame');
  settle(h, e);
  approx(e.x - x0, predicted);
  checkInvariants(h.b);
});

test('opposite simultaneous push impulses combine as vectors', () => {
  const h = lane({ e: still('e') });
  h.step();
  const e = h.spawn('e', { pos: [10, 6] });
  h.b.push(e, 1, { from: { x: 5, y: 10 } });
  h.b.push(e, 1, { from: { x: 7, y: 10 } });
  settle(h, e);
  approx(e.x, 6, 1e-9, 'equal impulses cancel');
});

test('pull accelerates continuously, stops at the pull circle, and remains unbalanced until the force ends', () => {
  const h = lane({ e: still('e') });
  h.step();
  const e = h.spawn('e', { pos: [10, 7] });
  const ret = h.b.pull(e, 1, { to: { x: 3.5, y: 10 }, center: { x: 3, y: 10 }, stop: PULL_STOP_RADIUS });
  assert.ok(ret > 3);
  h.step();
  assert.ok(e.x < 7 && e.x > 3.7, 'continuous first frame');
  assert.ok(h.runUntil(() => Math.abs(e.x - (3 + PULL_STOP_RADIUS)) < 1e-5, 1), 'reached stop circle');
  assert.ok(e.unbalance && e.unbalance.pulls.length, 'force still holds the state at the stop circle');
  const held = e.x;
  h.step(3);
  approx(e.x, held, 1e-9, 'held at stop');
  settle(h, e);
});

test('the weakest effective pull still crawls about 0.03 tile and holds for its action window', () => {
  const h = lane({ e: still('e', 3) });
  h.step();
  const e = h.spawn('e', { pos: [10, 7] }), x0 = e.x;
  approx(h.b.pull(e, 1, { to: { x: 3.5, y: 10 }, center: { x: 3, y: 10 } }), 0.03, 1e-9);
  settle(h, e);
  approx(x0 - e.x, 0.03, 1e-3);
});

test('static bodies enter unbalance without moving; immune enemies do neither', () => {
  const h = lane({ body: still('body', 0, { staticBody: true }), immune: still('immune') });
  h.step();
  const body = h.spawn('body', { pos: [10, 5] }), immune = h.spawn('immune', { pos: [11, 5] });
  h.b.addBuff(immune, { key: 'immune', flags: { noDisplace: true } });
  assert.equal(h.b.push(body, 1, { from: { x: 4, y: 10 } }), 0);
  assert.ok(body.unbalance);
  assert.equal(h.b.push(immune, 1, { from: { x: 4, y: 11 } }), 0);
  assert.equal(immune.unbalance, null);
  const ticks = Math.ceil(UNBALANCE_MIN_DURATION / TICK);
  h.step(ticks - 1);
  assert.ok(body.unbalance, 'minimum state still active');
  h.step(2);
  assert.equal(body.unbalance, null);
  approx(body.x, 5, 1e-12);
});

test('unbalance interrupts a ranged normal-attack wind-up and consumes that attack slot', () => {
  const ally = chessRec({ id: 'ally', stats: { maxHp: 1e8, atk: 0, blockCnt: 0 }, skill: null });
  const foe = { ...enemyRec({ key: 'foe', hp: 1e8, atk: 100, speed: 0, mass: 0, range: 5, bat: 2 }), attackAnim: { dur: 1.5, hit: 1 } };
  const h = lane({ foe }, [ally]);
  h.step();
  const e = h.spawn('foe', { pos: [10, 6] });
  assert.ok(h.runUntil(() => e.stats.attacks === 1, 1), 'first attack establishes cooldown');
  assert.ok(h.runUntil(() => e.atkCd <= 0.8 && e.atkCd > 0, 2), 'inside the next wind-up');
  h.b.push(e, 0, { from: { x: 5, y: 10 } });
  assert.equal(e.atkWindupCancelled, true);
  settle(h, e);
  h.run(0.9);
  assert.equal(e.stats.attacks, 1, 'interrupted strike did not land when its old cooldown elapsed');
  assert.ok(h.runUntil(() => e.stats.attacks === 2, 2.5), 'normal attacking resumes on the following interval');
});
