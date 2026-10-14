import test from 'node:test';
import assert from 'node:assert/strict';
import { openingFixture, replayPlan } from '../../tools/botbench/diagnose-ranged-block.mjs';
import { arrange, fieldModel, planLayout, LAYOUT_PARAMS, LayoutPlan } from '../../server/match/bot.js';
import { canPlace, parseKey, placeClass } from '../../server/match/board.js';
import { SUPPORT_MAPS } from '../../tools/botbench/support-runner.mjs';

for (const stage of SUPPORT_MAPS) test(`two Vendelas: ground-blocking rehearsal reduces first-wave leaks on ${stage}`, () => {
  const results = [];
  for (const policy of ['baseline', 'ground', 'route']) {
    const { m, ps, pieces } = openingFixture(stage);
    try {
      m.botGroundBlockCandidates = policy !== 'baseline';
      m.botRouteBlockCandidates = policy === 'route';
      m.botMireSafeCandidates = false;
      const job = arrange(m, ps, { final: true, defer: true });
      assert.ok(job.plans.length <= 8, 'keep the existing rehearsal budget');
      job.run();
      for (const piece of pieces) assert.ok(canPlace(ps.deployMap(), placeClass(ps, ps.gd.chess(piece.id)), ...parseKey(job.best.get(piece.uid))));
      const result = replayPlan(m, ps, pieces, job.best);
      results.push(result);
      if (policy !== 'baseline') assert.ok(result.blocks > 0, 'the selected layout actually blocks enemies');
    } finally { m.dispose(); }
  }
  assert.ok(results[1].leaks < results[0].leaks, 'compare real battle results, not just a heuristic score');
  assert.ok(results[2].leaks <= results[1].leaks, 'the route option preserves the opening fix');
  assert.deepEqual(results[1].input.spawns, results[0].input.spawns);
  assert.equal(results[1].input.seed, results[0].input.seed);
});

test('mixed lineup: ground proposals add ranged blocking while retaining legal high-ground and forward options', () => {
  const { m, ps, pieces } = openingFixture('act2autochess_m02', 1801,
    ['chess_char_1_10_a', 'chess_char_1_01_a', 'chess_char_1_06_a', 'chess_char_1_06_a']);
  try {
    // This candidate gate applies beyond first-wave starts too (we inspect plans, not a synthetic round's result).
    m.round = 3;
    m.botRouteBlockCandidates = false; // Isolate the earlier ground/facing proposal family.
    const road = fieldModel(m, ps).ground;
    const ground = planLayout(m, ps, pieces, { ...LAYOUT_PARAMS, rangedBlock: true, groundRangedCount: 2 });
    assert.equal(pieces.slice(1).filter(p => road.has(ground.get(p.uid))).length >= 2, true);
    const job = arrange(m, ps, { final: true, defer: true });
    assert.ok(job.plans.length <= 8);
    assert.ok(job.plans.some(plan => pieces.slice(1).every(p => plan.dirs.get(p.uid) === 'RIGHT')), 'forward proposal survives the budget');
    assert.ok(job.plans.some(plan => pieces.slice(1).some(p => ps.deployMap().get(plan.get(p.uid)) === 'ranged')), 'high-ground alternatives survive');
  } finally { m.dispose(); }
});

test('zero-block ranged units are not forced onto roads and medical facing stays unrestricted', () => {
  const { m, ps, pieces } = openingFixture('act2autochess_m02');
  try {
    const records = new Map(pieces.map(p => [p.uid, { ...ps.gd.chess(p.id), stats: { ...ps.gd.chess(p.id).stats, blockCnt: 0 } }]));
    const rng = m.rngBots;
    m.rngBots = () => 0.5;
    const normal = planLayout(m, ps, pieces, LAYOUT_PARAMS, { recOf: p => records.get(p.uid) });
    const extra = planLayout(m, ps, pieces, { ...LAYOUT_PARAMS, rangedBlock: true, groundRangedCount: 2 }, { recOf: p => records.get(p.uid) });
    assert.deepEqual(extra, normal);
    const medics = p => ({ ...records.get(p.uid), attackKind: 'heal', dmgType: 'heal' });
    assert.deepEqual(planLayout(m, ps, pieces, { ...LAYOUT_PARAMS, forwardRanged: true }, { recOf: medics }),
      planLayout(m, ps, pieces, LAYOUT_PARAMS, { recOf: medics }));
    m.rngBots = rng;
    assert.ok(normal instanceof LayoutPlan);
  } finally { m.dispose(); }
});
