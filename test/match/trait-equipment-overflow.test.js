import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, giveItem, checkInvariants, legalTileFor } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { collectViolations } from '../../server/match/invariants.js';
import { attachAudit } from '../../server/match/audit.js';
import { ERR } from '../../shared/constants.js';

const quiet = { info() {}, warn() {}, error() {} };
const BALL = 'chess_item_6_09_e_a';
const COIN = 'chess_item_1_03_e_a';
const rockrPool = DATA.choices.pools.pool_equip_rockr.weighted.map(([id]) => id);
const fillers = Object.values(DATA.chess).filter(c => c.visible && !c.isGolden &&
  (c.garrisonIds || []).every(g => DATA.garrisons[g].eventType === 'IN_BATTLE')).map(c => c.chessId);
const fillerItems = Object.values(DATA.items).filter(i => i.itemType === 'EQUIP' && !i.isGolden &&
  i.kind === 'passive' && !rockrPool.includes(i.id)).map(i => i.id).slice(0, 5);

function setup({ multiplier = 2, temp = 0, stock = 0 } = {}) {
  const h = makeMatch({ mode: 'coop', humans: 4, fake: true, seed: 41,
    registry: createRegistry({ log: quiet }) }).start();
  h.toPrep(1);
  const m = h.m, ps = h.ps('p_0');
  for (const p of m.players.values()) {
    for (const c of p.allChess()) p.returnCopies(c);
    p.board.clear(); p.hand.fill(null); p.temp.fill(null); p.bandId = null; p.offers = [];
    p.recompute();
  }
  ps.bondCountBonus.investShip = 20;
  ps.layers.investShip = multiplier === 3 ? 100 : 0;
  for (let i = 0; i < (temp ? 10 : 9); i++) give(m, ps, fillers[i]);
  for (let i = 0; i < temp; i++) giveItem(m, ps, fillerItems[i], 'temp', i);
  const others = [...m.players.values()].filter(p => p !== ps);
  for (let i = 0; i < stock; i++) giveItem(m, others[i % others.length], BALL);
  ps.recompute();
  return { h, m, ps };
}

const items = ps => [...ps.hand, ...ps.temp, ...ps.itemOverflow].filter(p => p?.kind === 'item');
const units = (ps, ids) => items(ps).filter(p => ids.includes(DATA.items[p.id]?.baseId || p.id))
  .reduce((n, p) => n + (DATA.items[p.id].isGolden ? 2 : 1), 0);
function buy({ m, ps }, id) {
  if (!ps.hand.some(p => p == null)) {
    // A full temp row cannot coexist with a free regular slot, and manual buys are refused with a full hand.
    // Re-trigger an owned operator's gain trait (铃兰's strategy uses this path) to exercise passive full-row grants.
    const piece = give(m, ps, id, 'board', legalTileFor(m, ps, id));
    const freeTemp = ps.temp.filter(p => p == null).length; // 缪尔赛思's deployed summon stack also occupies a slot
    m.dispatch(ps, 'onGain', { piece, kind: 'chess', source: 'test' });
    return freeTemp;
  }
  ps.funds = 99;
  ps.shop.slots[0] = { kind: 'chess', id, basePrice: 1, frozen: false, sold: false };
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.buy', slot: 0 }), { ok: true });
  return 5;
}
const valid = ({ m }) => { checkInvariants(m); assert.deepEqual(collectViolations(m), []); };

test('缪尔赛思 purchase in the last hand slot and full-row passive traits preserve every 投资人 grant', () => {
  for (const multiplier of [2, 3]) for (const temp of [0, 4, 5]) for (const stock of [0, 2, 3]) {
    const s = setup({ multiplier, temp, stock });
    const freeTemp = buy(s, 'chess_char_6_11_a');
    assert.equal(s.ps.hand.filter(Boolean).length, 10);
    assert.equal(units(s.ps, [BALL]), multiplier, `${multiplier} grants, ${temp} temp pieces, ${stock} existing stock`);
    assert.equal(s.ps.temp.slice(5).filter(p => p?.kind === 'item' && p.id === BALL).length, Math.max(0, multiplier - freeTemp));
    assert.equal(s.m.itemPool.held(BALL), stock + multiplier, 'guaranteed products still occupy the shared stock');
    assert.equal(s.m.itemPool.left(BALL), Math.max(0, 3 - stock - multiplier));
    assert.ok(!s.h.sent.some(([, msg]) => msg.t === 'm.toast' && /库存不足|已销毁/.test(msg.text)));
    valid(s);
  }
});

test('洛洛 manufacture keeps the full normal/elite × 投资人 count with both visible areas full', () => {
  const pool = rockrPool;
  for (const id of ['chess_char_2_10_a', 'chess_char_2_10_b']) for (const multiplier of [2, 3]) {
    const s = setup({ multiplier, temp: 5 });
    buy(s, id);
    assert.equal(units(s.ps, pool), (DATA.chess[id].isGolden ? 2 : 1) * multiplier);
    valid(s);
  }
});

test('all normal/elite gain-equipment traits retain their multiplied products when purchase fills the hand', () => {
  for (const c of Object.values(DATA.chess).filter(c => c.visible)) {
    const gs = (c.garrisonIds || []).map(id => DATA.garrisons[id]).filter(g =>
      g.eventType === 'SERVER_GAIN' && ['SERVER_GAIN_EQUIP', 'SERVER_POOL_EQUIP'].includes(g.effectKey));
    if (!gs.length) continue;
    for (const multiplier of [2, 3]) {
      const s = setup({ multiplier });
      buy(s, c.chessId);
      const expected = multiplier * gs.reduce((n, g) => n + (g.bb.count || 1), 0);
      assert.equal(units(s.ps, Object.keys(DATA.items)), expected, `${c.name} ${c.chessId} × ${multiplier}`);
      assert.equal(s.ps.hand.filter(Boolean).length, 10);
      valid(s);
    }
  }
});

test('queued equipment refills the visible temp row in grant order and remains in private state', () => {
  const s = setup({ temp: 5 });
  buy(s, 'chess_char_6_11_a');
  const hidden = s.ps.temp.slice(5).filter(p => p?.id === BALL);
  const view = s.ps.privateView();
  assert.equal(hidden.length, 2);
  assert.ok(view.temp.some(p => p?.uid === hidden[0].uid), 'upstream exposes the entire expandable queue');
  assert.equal(s.ps.setReady(true).error, ERR.TEMP_NOT_EMPTY);
  for (const p of hidden) {
    while (s.ps.temp.indexOf(p) >= 5) {
      const filler = s.ps.temp.find(x => x?.kind === 'item' && x.id !== BALL);
      assert.deepEqual(s.ps.destroy(filler.uid), { ok: true });
    }
    assert.equal(s.ps.find(p.uid).area, 'temp');
    valid(s);
  }
  assert.equal(s.ps.temp.slice(5).filter(p => p?.kind === 'item').length, 0);
  const target = s.ps.hand.find(p => p?.kind === 'chess');
  assert.deepEqual(s.ps.equip(hidden[0].uid, target.uid), { ok: true });
  assert.ok(target.items.some(p => p.uid === hidden[0].uid));
  valid(s);
});

test('投资人 identical equipment merges inside the expandable queue with its stock accounting intact', () => {
  const s = setup({ temp: 5 });
  buy(s, 'chess_char_3_03_a');
  assert.equal(units(s.ps, [COIN]), 2);
  const coin = s.ps.temp.find(p => p && DATA.items[p.id]?.baseId === COIN);
  assert.ok(coin && DATA.items[coin.id].isGolden);
  assert.equal(coin.poolGrantCopies, 2);
  assert.equal(s.m.itemPool.held(COIN), 2);
  valid(s);
});

test('a guaranteed grant can exceed stock, but ordinary acquisition stays refused at exhausted stock', () => {
  const s = setup({ stock: 3 });
  buy(s, 'chess_char_6_11_a');
  assert.equal(s.m.itemPool.held(BALL), 5);
  assert.equal(s.ps.acquireItem(BALL, { source: 'buy' }), null);
  assert.equal(s.m.itemPool.held(BALL), 5);
  for (const p of [...s.ps.temp].filter(p => p?.id === BALL)) assert.deepEqual(s.ps.destroy(p.uid), { ok: true });
  assert.equal(s.m.itemPool.held(BALL), 3);
  assert.equal(s.m.itemPool.canGain(BALL), false);
  valid(s);
});

test('hidden grants after Ready survive the deadline, refill into temp, and expire only at the next prep deadline', () => {
  const s = setup({ temp: 5 });
  s.ps.ready = true; // passive gains can arrive after Ready; manual buys cannot
  for (let i = 0; i < 2; i++) s.ps.acquireItem(BALL, { requirePool: false });
  const gifts = s.ps.temp.slice(5).filter(p => p?.id === BALL);
  assert.equal(gifts.length, 2);
  assert.ok(gifts.every(p => s.ps.tempDue(p) === s.ps.prepsEnded + 1));
  s.ps.endPrep();
  assert.ok(gifts.every(p => s.ps.find(p.uid)?.area === 'temp'));
  assert.ok(gifts.every(p => s.ps.tempDue(p) === s.ps.prepsEnded));
  s.ps.ready = false;
  s.ps.endPrep();
  assert.ok(gifts.every(p => !s.ps.find(p.uid)));
});

test('un-readying makes hidden gifts due now, and the rule audit observes their cleanup', () => {
  const s = setup({ temp: 5 });
  const audit = attachAudit(s.m);
  s.ps.ready = true;
  const gift = s.ps.acquireItem(BALL, { requirePool: false });
  assert.equal(s.ps.find(gift.uid).area, 'temp');
  assert.equal(s.ps.tempDue(gift), s.ps.prepsEnded + 1);
  assert.deepEqual(s.ps.setReady(false), { ok: true });
  assert.equal(s.ps.tempDue(gift), s.ps.prepsEnded);
  s.ps.endPrep();
  assert.equal(s.ps.find(gift.uid), null);
  assert.deepEqual(audit.violations, []);
});

test('the rule audit detects hidden equipment surviving its deadline', () => {
  const s = setup({ temp: 5 });
  const audit = attachAudit(s.m);
  const gift = s.ps.acquireItem(BALL, { requirePool: false });
  s.ps.resolveTemp = () => {}; // emulate a cleanup regression
  s.ps.endPrep();
  assert.ok(audit.violations.some(v => v.includes(`temp piece ${gift.id}`) && v.includes('survived its prep end')));
});

test('elimination clears hidden equipment and releases its shared stock occupancy', () => {
  const s = setup({ temp: 5 });
  buy(s, 'chess_char_6_11_a');
  assert.equal(s.ps.temp.slice(5).filter(p => p?.id === BALL).length, 2);
  s.ps.eliminate(1);
  assert.equal(s.ps.temp.filter(Boolean).length, 0);
  assert.equal(s.m.itemPool.held(BALL), 0);
  valid(s);
});
