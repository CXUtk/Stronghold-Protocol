import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give } from './harness.js';
import { planUnite } from '../../server/match/unite.js';

const enemyKey = 'enemy_1007_slime';
function fixture() {
  const h = makeMatch({ humans: 4, seed: 34, fake: true }).start().toPrep();
  const m = h.m;
  const players = [0, 1, 2, 3].map(i => h.ps(`p_${i}`));
  players[2].isBot = players[3].isBot = true;
  for (const [i, count] of [[1, 1], [2, 3], [3, 2]]) {
    const tiles = [...players[i].deployMap()].filter(([, type]) => type === 'melee');
    for (let n = 0; n < count; n++) give(m, players[i], 'chess_char_1_10_a', 'board', tiles[n][0].split(',').map(Number));
  }
  players[0].bounties.push({ id: 'test-bounty', card: { enemyKey, payout: 'kill', coin: 5 } });
  const leak = { enemyKey, counted: true, mods: { bountyId: 'test-bounty' } };
  const results = new Map(players.map(p => [p.playerId, { perfect: p !== players[0], leaked: p === players[0] ? [leak] : [], unitsEnd: [] }]));
  m.lastResults = results;
  return { m, players, results, leak };
}
const ids = plan => plan.helpers.map(p => p.playerId);

test('a leaked kill bounty selects the weaker perfect human ahead of two AI seats and puts AI behind', () => {
  const { m, results } = fixture();
  try {
    const plan = planUnite(m, results);
    assert.deepEqual(ids(plan), ['p_1', 'p_2']);
    const opts = m._uniteOpts(plan, 60);
    assert.deepEqual(opts.players.map(p => [p.playerId, p.colOffset]), [['p_1', 8], ['p_2', 0]]);
    assert.deepEqual(plan.leaked[0].bounty, { coins: 5, ownerPlayerId: 'p_0' });
    assert.equal(opts.spawns[0].sourcePlayerId, 'p_0');
    assert.deepEqual(opts.spawns[0].bounty, plan.leaked[0].bounty);
  } finally { m.dispose(); }
});

test('two perfect humans take both slots, retaining the ordinary ranking within the human group', () => {
  const { m, players, results } = fixture();
  try {
    players[3].isBot = false;
    assert.deepEqual(ids(planUnite(m, results)), ['p_3', 'p_1']);
  } finally { m.dispose(); }
});

test('a human who leaked cannot help; without perfect humans the original AI order remains', () => {
  const { m, results } = fixture();
  try {
    results.set('p_1', { perfect: false, leaked: [{ enemyKey, counted: true }] });
    assert.deepEqual(ids(planUnite(m, results)), ['p_2', 'p_3']);
  } finally { m.dispose(); }
});

test('content-provided bounty coins (without a bounty card id) also trigger human priority', () => {
  const { m, results, leak } = fixture();
  try {
    leak.mods = { bountyCoins: 3 };
    assert.deepEqual(ids(planUnite(m, results)), ['p_1', 'p_2']);
  } finally { m.dispose(); }
});

for (const scenario of ['ordinary', 'wrong-body', 'perfect-payout', 'zero-coins', 'uncounted', 'unknown-enemy']) {
  test(`${scenario} does not turn an ordinary leak into human-priority bounty defense`, () => {
    const { m, players, results, leak } = fixture();
    try {
      if (scenario === 'ordinary') leak.mods = null;
      if (scenario === 'wrong-body') players[0].bounties[0].card.enemyKey = 'different-enemy';
      if (scenario === 'perfect-payout') players[0].bounties[0].card.payout = 'perfect';
      if (scenario === 'zero-coins') players[0].bounties[0].card.coin = 0;
      if (scenario === 'uncounted') leak.counted = false;
      if (scenario === 'unknown-enemy') leak.enemyKey = 'missing-enemy';
      if (['uncounted', 'unknown-enemy'].includes(scenario)) results.get('p_0').leaked.push({ enemyKey, counted: true });
      assert.deepEqual(ids(planUnite(m, results)), ['p_2', 'p_3']);
    } finally { m.dispose(); }
  });
}
