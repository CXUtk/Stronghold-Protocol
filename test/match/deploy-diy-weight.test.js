// deploy-only rule: co-op DIY draw weight matches a full ordinary card of its tier, with private capacity unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';

const T5 = 'chess_char_5_diy1_a';
const T6 = 'chess_char_6_diy1_a';
const picks = {
  [T5]: { charId: 'char_609_acguad' },
  [T6]: { charId: 'char_609_acguad' },
};

function setup(mode, humans = 1) {
  const seats = Array.from({ length: humans }, (_, i) => ({
    seat: i, playerId: `p_${i}`, name: `P${i}`, isBot: false, connected: true, diy: picks,
  }));
  const h = makeMatch({ mode, seats, fake: true, seed: 11 }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.shop.level = 6;
  return { h, ps };
}

for (const mode of ['solo', 'coop']) {
  for (const [slotId, tier, privateCap] of [[T5, 5, 8], [T6, 6, 5]]) {
    test(`${mode}: full tier-${tier} DIY and ordinary cards get equal draw intervals, private capacity ${privateCap}`, () => {
      const { h, ps } = setup(mode);
      try {
        const pool = h.m.pool;
        const ordinary = [...pool.entries].find(([, e]) => e.tier === tier)[0];
        const extra = ps.diyRollEntries();
        const filter = id => id === ordinary || id === slotId;
        assert.equal(ps.diyStock.cap(slotId), privateCap);
        assert.equal(ps.diyStock.left(slotId), privateCap);
        assert.equal(pool.cap(ordinary), privateCap * (mode === 'coop' ? 2 : 1));
        // Two identities must divide the draw interval equally; this catches an initial 2:1 bias directly.
        assert.equal(pool.roll(() => 0.499, { tier, filter, extra }), ordinary);
        assert.equal(pool.roll(() => 0.501, { tier, filter, extra }), slotId);
        assert.equal(ps._rollChessSlot().kind, 'chess');
        assert.equal(pool.left(ordinary), pool.cap(ordinary), 'shop displays reserve no ordinary copies');
        assert.equal(ps.diyStock.left(slotId), privateCap, 'weighted sampling reserves no private copies');
      } finally { h.m.dispose(); }
    });
  }
}

test('co-op DIY: buying and selling change remaining weight but retain per-player 8/5 limits', () => {
  const { h, ps } = setup('coop', 2);
  try {
    const pool = h.m.pool;
    const peer = h.ps('p_1');
    peer.shop.level = 6;
    const ordinary = [...pool.entries].find(([, e]) => e.tier === 5)[0];
    const filter = id => id === ordinary || id === T5;
    const single = ps.acquireChess(T5, { source: 'buy' });
    assert.ok(single);
    assert.equal(ps.diyStock.left(T5), 7);
    assert.equal(peer.diyStock.left(T5), 8, 'one player cannot consume another player\'s private stock');
    assert.equal(pool.roll(() => 0.52, { tier: 5, filter, extra: ps.diyRollEntries() }), ordinary, 'ordinary weight 16 vs private weight 14');
    assert.equal(pool.roll(() => 0.52, { tier: 5, filter, extra: peer.diyRollEntries() }), T5, 'peer still has full equal weight');
    assert.deepEqual(h.m.handle(ps.playerId, { t: 'g.sell', uid: single.uid }), { ok: true });
    assert.equal(ps.diyStock.left(T5), 8);
    assert.equal(pool.roll(() => 0.52, { tier: 5, filter, extra: ps.diyRollEntries() }), T5);
    assert.equal(ps.diyStock.take(T5, 100), 8, 'weight does not create purchasable copies');
    assert.equal(pool.roll(() => 0.99, { tier: 5, filter, extra: ps.diyRollEntries() }), ordinary);
    assert.equal(ps.diyStock.give(T5, 100), 8);
    assert.equal(ps.diyStock.take(T6, 100), 5);
    assert.equal(ps.diyStock.give(T6, 100), 5);
  } finally { h.m.dispose(); }
});

test('co-op shop and promotion rewards use equal full-stock weights through their real entry points', () => {
  const { h, ps } = setup('coop');
  try {
    const pool = h.m.pool;
    const ordinary = [...pool.entries].find(([, e]) => e.tier === 5)[0];
    // Isolate two legal choices so a draw just above halfway must select the private card in both production paths.
    pool.entries = new Map([[ordinary, pool.entries.get(ordinary)]]);
    ps.shop.level = 5;
    h.m.rngShop = () => 0.51;
    assert.equal(ps._rollChessSlot().id, T5);
    const offer = ps.pushRewardOffer('merge', { tier: 5 });
    assert.equal(offer.slots[0].id, T5);
    assert.equal(offer.slots[1].id, ordinary, 'reward choices remain distinct');
    assert.equal(ps.diyStock.left(T5), 8, 'offers do not consume stock');
    ps.diyStock.take(T5, 100);
    assert.equal(ps._rollChessSlot().id, ordinary, 'an exhausted pick cannot appear in the shop');
    assert.deepEqual(ps.pushRewardOffer('merge', { tier: 5 }).slots.map(s => s.id), [ordinary]);
  } finally { h.m.dispose(); }
});

test('co-op DIY: random-grant stock uses the same weights; identity-only draws and filters still apply', () => {
  const { h, ps } = setup('coop');
  try {
    const pool = h.m.pool;
    const ordinary = [...pool.entries].find(([, e]) => e.tier === 5)[0];
    const filter = id => id === ordinary || id === T5;
    ps.shop.level = 4;
    assert.equal(ps.diyRollEntries(), null, 'shop level gate is unchanged');
    const extra = ps.diyStockEntries();
    assert.equal(pool.roll(() => 0.501, { tier: 5, filter, extra }), T5, 'random grants have no shop level gate');
    ps.diyStock.take(T5, 7);
    assert.equal(pool.roll(() => 0.51, { tier: 5, filter, extra, ignoreCounts: true }), T5, 'Mimic weights identities once');
    assert.equal(pool.roll(() => 0.51, { tier: 5, filter, extra }), ordinary, 'weighted draw follows the one remaining private copy');
    assert.equal(pool.roll(() => 0.99, { tier: 4, filter, extra }), null);
    assert.equal(pool.roll(() => 0.99, { tier: 5, filter: id => id === ordinary, extra }), ordinary);
    const bannedStock = ps.buildDiyStock(new Set(DATA.backups.diy.operators.char_609_acguad.bonds));
    assert.ok(bannedStock.banned.includes(T5));
    assert.equal(bannedStock.stock.has(T5), false, 'a multiplier cannot restore a banned pick');
  } finally { h.m.dispose(); }
});
