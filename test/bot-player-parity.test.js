import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem, legalTileFor } from './match/harness.js';
import { createRegistry } from '../server/match/effectsMeta.js';
import { botPrepBeginSteps, finishBotPreparation, bondPlan, createRehearsal } from '../server/match/bot.js';
import { forkPreparation, projectNormalBattleOptions } from '../server/match/bot-prep-projection.js';
import { botPool, rehearsalSampleSeed } from '../server/match/bot-information.js';

function fixture(t) {
  const h = makeMatch({ humans: 2, bots: 2, difficulty: 'ABYSS', seed: 1512, registry: createRegistry() });
  const m = h.m, p = m.order[2];
  m.phase = 'PREP'; m.round = 7;
  m.wave = { timeLimit: 1, spawns: [], routes: [], overrides: {}, templateId: 'parity' };
  for (const q of m.order) { q.ready = false; q.funds = 0; }
  t.after(() => m.sched.dispose());
  const chess = m.gd.visibleChess.filter(id => m.gd.chess(id).tier === 1 && !m.gd.placeableTokens(id).length);
  const items = Object.keys(m.data.items).filter(id => m.gd.item(id)?.itemType === 'EQUIP' && !m.gd.isGolden(id));
  return { m, p, chess, items };
}
function offers(m, p, chess, alternative = false) {
  const item = 'chess_item_5_07_e_a';
  giveItem(m, m.order[0], item); giveItem(m, m.order[1], item);
  assert.equal(m.itemPool.canGain(item), false);
  p.offers = [{ slots: [{ kind: 'item', id: item, price: 1 },
    ...(alternative ? [{ kind: 'chess', id: chess[0], price: 0 }] : [])] },
  { slots: [{ kind: 'chess', id: chess[1], price: 0 }] }];
}
function takeOffers(m, p) { const gen = botPrepBeginSteps(m, p); gen.next(); gen.return(); }
function fullHandSummon(m, p, items) {
  for (let i = 0; i < p.hand.length; i++) giveItem(m, p, items[i], 'hand', i);
  const id = m.gd.visibleChess.find(id => m.gd.placeableTokens(id).length && legalTileFor(m, p, id));
  give(m, p, id, 'board', legalTileFor(m, p, id));
  const token = p.temp.find(u => u?.kind === 'token');
  assert.ok(token);
  return token;
}
const inventory = p => ({ hand: p.hand, temp: p.temp, board: [...p.board], ready: p.ready, funds: p.funds });

test('unaffordable reward stays at the head; later offers cannot be taken', t => {
  const { m, p, chess } = fixture(t);
  offers(m, p, chess);
  const before = structuredClone(p.offers);
  assert.equal(p.pickReward(0).error, 'NO_FUNDS');
  takeOffers(m, p);
  assert.deepEqual(p.offers, before);
  assert.equal(p.allChess().length, 0);
});

test('bot can choose another legal slot in the same reward without skipping the queue', t => {
  const { m, p, chess } = fixture(t);
  offers(m, p, chess, true);
  takeOffers(m, p);
  assert.equal(p.offers.length, 0);
  assert.deepEqual(p.allChess().map(x => x.id).sort(), chess.slice(0, 2).sort());
});

test('full-hand summon is retained using actions replayable through human protocol', t => {
  const { m, p, items } = fixture(t), token = fullHandSummon(m, p, items);
  const copy = forkPreparation(m).match, human = copy.players.get(p.playerId);
  t.after(() => copy.sched.dispose()); human.isBot = false;
  let destroyed = 0;
  for (const [method, msg] of [
    ['move', (uid, to, dir) => ({ t: 'g.move', uid, to, dir })],
    ['sell', uid => ({ t: 'g.sell', uid })],
    ['destroy', uid => ({ t: 'g.destroy', uid })],
    ['setReady', ready => ({ t: 'g.ready', ready })],
  ]) {
    const original = p[method].bind(p);
    p[method] = (...args) => {
      const actual = original(...args), replay = copy.handle(human.playerId, msg(...args));
      assert.deepEqual(actual, replay);
      if (method === 'destroy' && actual.ok) destroyed++;
      return actual;
    };
  }
  p.resolveTemp = () => assert.fail('Bot called deadline-only cleanup');
  finishBotPreparation(m, p);
  assert.equal(destroyed, 1);
  assert.ok(p.hand.some(u => u?.uid === token.uid));
  assert.equal(p.ready, true);
  assert.deepEqual(inventory(p), inventory(human));
});

test('when no acceptable legal action frees temp, bot waits for the actual deadline', t => {
  const { m, p, items } = fixture(t);
  fullHandSummon(m, p, items);
  p.autoplay = true; // Do not destroy a human's equipment to make room.
  const resolve = p.resolveTemp.bind(p);
  p.resolveTemp = () => assert.fail('Early cleanup');
  finishBotPreparation(m, p);
  assert.equal(p.ready, false);
  assert.equal(p.setReady(true).error, 'TEMP_NOT_EMPTY');
  p.resolveTemp = resolve;
  m.endPrep = () => {};
  m.prepDeadline();
  assert.equal(p.ready, true);
  assert.equal(p.tempEmpty, true);
});

test('projected bot tail and Ready match formal hand sales and prep-end gift expiry', t => {
  const { m, p, chess } = fixture(t);
  for (let i = 0; i < p.hand.length; i++) give(m, p, chess[i], 'hand', i);
  for (const q of m.order) if (q !== p) q.ready = true;
  m.registry.global('parityGift', {
    onPrepEnd(ctx) {
      if (ctx.playerId !== p.playerId) return;
      ctx.incCounter('gift');
      for (let i = 0; i < 2; i++) ctx.grantItem('chess_item_1_03_e_a', { requirePool: false });
    },
    onBattleStart(ctx, ev) {
      ev.input.parity = { gift: ctx.counter('gift'), hand: ctx.hand().filter(Boolean).length,
        temp: ctx.temp().filter(Boolean).length, funds: ctx.funds() };
    },
  });
  const predicted = projectNormalBattleOptions(m, p, finishBotPreparation);
  let actual;
  m.startCombat = () => {
    m.phase = 'COMBAT'; m.lastResults = new Map();
    actual = m.alivePlayers().map(q => m._normalOpts(q)).find(s => s.players[0].playerId === p.playerId);
  };
  finishBotPreparation(m, p); // Last Ready queues the real phase transition.
  m.sched.runUntil(() => !!actual, { maxSteps: 100 });
  assert.ok(actual);
  assert.deepEqual(predicted, actual);
  assert.equal(actual.players[0].parity.gift, 1, 'prep hooks must not run twice');
  assert.equal(actual.players[0].parity.temp, 1, 'overflow after Ready survives');
});

test('stock estimate uses visible cards, not hidden balances or poolCopies bookkeeping', t => {
  const { m, p, chess } = fixture(t);
  give(m, p, chess[0]);
  const mate = give(m, m.order[0], chess[0]);
  const before = botPool(m, p);
  assert.equal(before.left(chess[0]), before.cap(chess[0]) - 2);
  const plan = bondPlan(m, p);
  for (const e of m.pool.entries.values()) e.left = 0;
  mate.poolCopies = 0;
  delete p._botFocus; delete p._botFocusId;
  assert.deepEqual(botPool(m, p).entries, before.entries);
  assert.deepEqual(bondPlan(m, p), plan);
  give(m, m.order[0], chess[1]);
  assert.equal(botPool(m, p).left(chess[1]), before.left(chess[1]) - 1);
});

test('sampled projection is independent of live seed, RNG positions and hidden stock', t => {
  const { m, p, chess } = fixture(t);
  give(m, p, chess[0], 'board', legalTileFor(m, p, chess[0]));
  m.registry.global('rngProbe', {
    onPrepEnd(ctx) { ctx.setCounter('sample', ctx.rng.int(100000)); },
    onBattleStart(ctx, ev) { ev.input.sample = [ctx.counter('sample'), ctx.rng.int(100000)]; },
  });
  const seed = rehearsalSampleSeed(m, p, 0);
  const a = projectNormalBattleOptions(m, p, finishBotPreparation, { sampleSeed: seed, deadline: true });
  m.seed = 123456;
  for (const key of Object.keys(m)) if (key.startsWith('rng') && typeof m[key] === 'function') for (let i = 0; i < 9; i++) m[key]();
  for (const e of m.pool.entries.values()) e.left = 0;
  assert.equal(rehearsalSampleSeed(m, p, 0), seed);
  const b = projectNormalBattleOptions(m, p, finishBotPreparation, { sampleSeed: seed, deadline: true });
  assert.deepEqual(b, a);
  const c = projectNormalBattleOptions(m, p, finishBotPreparation, { sampleSeed: rehearsalSampleSeed(m, p, 1), deadline: true });
  assert.notEqual(c.seed, b.seed);
  assert.notDeepEqual(c.players[0].sample, b.players[0].sample);
});

test('candidate ranking averages three common random samples and cannot prune on one bad sample', t => {
  const { m, p, chess } = fixture(t);
  m.botLegacyParity = false; // Explicit player-aligned sampling; ordinary upstream calls use one sample.
  const piece = give(m, p, chess[0], 'board', legalTileFor(m, p, chess[0]));
  const plans = ['RIGHT', 'LEFT'].map(dir => {
    const plan = new Map([[piece.uid, [...p.board.keys()][0]]]);
    plan.dirs = new Map([[piece.uid, dir]]); return plan;
  });
  m.botRehearsal = 2;
  const seeds = [], losses = [3, 3, 3, 6, 0, 0];
  m.newBattle = opts => {
    const loss = losses[seeds.length]; seeds.push(opts.seed);
    let ticks = 0;
    return { finished: false, step() { if (++ticks === 70) this.finished = true; },
      result() { return { perPlayer: { [p.playerId]: { leaked: Array.from({ length: loss }, () => ({})), killed: 0 } } }; } };
  };
  const job = createRehearsal(m, p, [piece], plans);
  job.run();
  assert.equal(job.done, true);
  assert.equal(job.best, plans[1]);
  assert.deepEqual(seeds.slice(0, 3), seeds.slice(3));
  assert.equal(new Set(seeds).size, 3);
});

test('explicit sampled diagnostic never aliases live pool even on a frozen legacy match', t => {
  const { m, p } = fixture(t);
  m.botLegacyParity = true;
  const gd = m.pool.gd, entries = structuredClone(m.pool.entries);
  projectNormalBattleOptions(m, p, null, { sampleSeed: 123 });
  assert.equal(m.pool.gd, gd);
  assert.deepEqual(m.pool.entries, entries);
});
