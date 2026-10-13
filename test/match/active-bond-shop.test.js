import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

const ANGLE = 'chess_char_1_02_a'; // 角峰: 谢拉格 + 坚守
const GUMMY = 'chess_char_1_10_a';
const LEIZI = 'chess_char_1_03_a'; // 炎, no overlap
const DIY = 'chess_char_5_diy1_a';

function setup(t, on = true, opts = {}) {
  const h = makeMatch({ fake: true, seed: 11, activeBondShopBoost: on, ...opts }).start();
  t.after(() => h.m.dispose());
  h.toPrep(1);
  h.m.disabledBonds = [];
  const ps = h.ps('p_0');
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  h.m.pool.entries = new Map([
    [ANGLE, { cap: 10, left: 10, tier: 1 }],
    [LEIZI, { cap: 10, left: 10, tier: 1 }],
  ]);
  return { h, ps };
}

function activate(ps) {
  ps.board.set('1,1', ps.newPiece('chess', ANGLE));
  ps.board.set('1,2', ps.newPiece('chess', GUMMY));
  ps.recompute();
  assert.equal(ps.bonds.steadShip.active, true);
}

test('default-off and enabled without active alliances preserve all seeded draws and RNG calls', (t) => {
  const off = setup(t, false);
  const on = setup(t, true);
  const base = setup(t, false);
  activate(off.ps);
  activate(base.ps);
  let offCalls = 0, onCalls = 0;
  const a = off.h.m.rngShop, b = on.h.m.rngShop;
  off.h.m.rngShop = () => { offCalls++; return a(); };
  on.h.m.rngShop = () => { onCalls++; return b(); };
  for (let i = 0; i < 40; i++) {
    off.ps.rollShop(); on.ps.rollShop(); base.ps.rollShop();
    assert.deepEqual(off.ps.shop.slots, on.ps.shop.slots);
    assert.deepEqual(off.ps.shop.slots, base.ps.shop.slots);
  }
  assert.equal(offCalls, onCalls);
  assert.equal(off.ps.privateView().shop.bondBoost, undefined);
  assert.deepEqual(on.ps.privateView().shop.bondBoost, { multiplier: 1.2, bondIds: [] });
});

test('real active 坚守 changes the draw interval from 1/2 to 6/11; matches do not compound', (t) => {
  const { h, ps } = setup(t);
  h.m.rngShop = () => 0.52;
  assert.equal(ps._rollChessSlot().id, LEIZI);
  activate(ps);
  const before = h.m.pool.snapshot();
  assert.equal(ps._rollChessSlot().id, ANGLE);
  // A second active alliance on the same card is still 12:10, not 14:10 or 14.4:10.
  ps.bondCountBonus = { kjeragShip: 3 };
  ps.recompute();
  assert.equal(ps.bonds.kjeragShip.active, true);
  h.m.rngShop = () => 6 / 11 - 1e-6;
  const card = ps._rollChessSlot();
  assert.equal(card.id, ANGLE);
  assert.deepEqual(new Set(card.boostBonds), new Set(['kjeragShip', 'steadShip']));
  h.m.rngShop = () => 6 / 11 + 1e-6;
  assert.equal(ps._rollChessSlot().id, LEIZI);
  assert.deepEqual(h.m.pool.snapshot(), before, 'weighting creates no copies and displays reserve none');
});

test('each human and AI uses its own alliances; drawn bans can still activate, withdrawn alliances lose the boost', (t) => {
  const { h, ps } = setup(t, true, { humans: 2, bots: 1 });
  const peer = h.ps('p_1'), bot = h.ps('ai_0');
  peer.board.clear(); peer.hand.fill(null); peer.recompute();
  bot.board.clear(); bot.hand.fill(null); bot.recompute();
  activate(ps);
  h.m.rngShop = () => 0.52;
  assert.equal(ps._rollChessSlot().id, ANGLE);
  assert.equal(peer._rollChessSlot().id, LEIZI);
  assert.equal(bot._rollChessSlot().id, LEIZI);
  activate(bot);
  assert.equal(bot._rollChessSlot().id, ANGLE);
  h.m.disabledBonds = ['steadShip'];
  assert.equal(ps._rollChessSlot().id, ANGLE, 'a drawn ban restricts pool membership, not activation via another card');
  h.m.disabledBonds = [];
  ps.board.clear(); ps.recompute();
  assert.equal(ps._rollChessSlot().id, LEIZI);
});

test('static-off alliances, unavailable tiers and exhausted cards get no special eligibility', (t) => {
  const { h, ps } = setup(t, true, { difficulty: 'FUNNY' });
  ps.bonds = { egirShip: { active: true } };
  assert.deepEqual(ps.shopBoostBondIds(), [], 'even a stale active flag cannot enable a mode-off alliance');
  activate(ps);
  h.m.pool.entries.get(ANGLE).tier = 6;
  h.m.rngShop = () => 0;
  assert.equal(ps._rollChessSlot().id, LEIZI);
  ps.shop.level = 6;
  h.m.pool.entries.get(ANGLE).left = 0;
  assert.equal(ps._rollChessSlot().id, LEIZI);
});

test('automatic and manual refreshes share the bonus; frozen metadata survives a changed lineup', (t) => {
  const { h, ps } = setup(t);
  activate(ps);
  h.m.rngShop = () => 0.52;
  ps.funds = 20;
  assert.deepEqual(ps.refresh(), { ok: true });
  assert.equal(ps.shop.slots[0].id, ANGLE);
  assert.deepEqual(ps.privateView().shop.slots[0].boostBonds, ['steadShip']);
  const card = ps.shop.slots[0];
  card.frozen = true;
  ps.board.clear(); ps.recompute();
  ps.rollShop({ keepFrozen: true });
  assert.deepEqual(ps.privateView().shop.bondBoost.bondIds, []);
  assert.deepEqual(ps.privateView().shop.slots[0].boostBonds, ['steadShip'], 'historical draw, not current membership');
  assert.equal(ps.shop.slots[1].id, LEIZI, 'unfrozen cards use the current lineup');
  ps.rollShop();
  assert.equal(ps.shop.slots[0].id, LEIZI);
  assert.equal(ps.shop.slots[0].boostBonds, undefined);
});

test('DIY uses the chosen operator bonds and stacks with existing private-stock weighting once', (t) => {
  const { h, ps } = setup(t);
  assert.equal(ps.setDiy({ [DIY]: { charId: 'char_112_siege', skillIndex: 2 } }), true);
  ps.initDiyStock();
  ps.bondCountBonus = { victoriaShip: 3 };
  ps.recompute();
  assert.equal(ps.bonds.victoriaShip.active, true);
  ps.shop.level = 5;
  h.m.pool.entries = new Map([[LEIZI, { cap: 16, left: 16, tier: 5 }]]);
  h.m.rngShop = () => 0.47;
  const before = ps.diyStock.snapshot();
  const card = ps._rollChessSlot();
  assert.equal(card.id, DIY, '16 ordinary vs 8×2×1.2 DIY weight');
  assert.deepEqual(card.boostBonds, ['victoriaShip']);
  assert.deepEqual(ps.diyStock.snapshot(), before);
  ps.bondCountBonus = {}; ps.recompute();
  assert.equal(ps._rollChessSlot().id, LEIZI, 'equal 16:16 stock weights without an active bond');
});

test('item slots, promotion rewards and ordinary random pool draws keep their original weights', (t) => {
  const { h, ps } = setup(t);
  activate(ps);
  const shares = h.m.pool.tierShares(1);
  h.m.rngShop = () => 0.52;
  assert.equal(h.m.pool.roll(h.m.rngShop, { maxTier: 1 }), LEIZI);
  const itemOn = ps._rollItemSlot();
  const rewardOn = ps.pushRewardOffer('merge', { tier: 1 });
  h.m.activeBondShopBoost = false;
  assert.deepEqual(ps._rollItemSlot(), itemOn);
  assert.deepEqual(ps.pushRewardOffer('merge', { tier: 1 }), rewardOn);
  assert.deepEqual(h.m.pool.tierShares(1), shares);
});
