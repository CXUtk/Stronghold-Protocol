import test from 'node:test';
import assert from 'node:assert/strict';
import { openingFixture, replayPlan } from '../../tools/botbench/diagnose-ranged-block.mjs';
import { arrange, fieldModel, planLayout, LAYOUT_PARAMS, Layout } from '../../server/match/bot.js';
import { canPlace, parseKey, placeClass } from '../../server/match/board.js';
import { buildNormalWave } from '../../server/match/waves.js';

test('route defense distributes equal blocking capacity across exposed entrances, not one crowded lane', () => {
  const model = { routes: ['a', 'b'].map(k => ({ n: 10, tiles: [k], tileTime: 1, hp: 1000 })),
    ground: new Map(['a', 'b'].map(k => [k, { flow: 10 }])) };
  const value = (keys, fly = false) => {
    const layout = new Layout({ ...model, routes: model.routes.map(r => ({ ...r, fly })) },
      { ...LAYOUT_PARAMS, routeBlock: true, cohesion: 0, healCare: 0 });
    layout.units = keys.map(key => ({ key, block: 2, cover: new Set(), dps: 0 }));
    return layout.value();
  };
  assert.ok(value(['a', 'b']) > value(['a', 'a']));
  assert.equal(value(['a', 'b'], true), value(['a', 'a'], true), 'blocking does not help flying routes');
});

test('road-defense proposals put extended-range melee blockers on legal paths and retain the eight-plan cap', () => {
  const ids = ['1_17', '1_06', '1_01', '1_04', '1_08', '1_09', '1_09'].map(id => `chess_char_${id}_b`);
  const { m, ps, pieces } = openingFixture('act2autochess_m02', 1801, ids);
  try {
    m.botRouteBlockCandidates = true;
    const plan = planLayout(m, ps, pieces, { ...LAYOUT_PARAMS, routeBlock: true, rangedBlock: true, groundRangedCount: 2 });
    const road = fieldModel(m, ps).ground;
    for (const piece of pieces) {
      assert.ok(canPlace(ps.deployMap(), placeClass(ps, ps.gd.chess(piece.id)), ...parseKey(plan.get(piece.uid))));
      if (ps.gd.chess(piece.id).position === 'MELEE') assert.ok(road.has(plan.get(piece.uid)));
    }
    const job = arrange(m, ps, { final: true, defer: true });
    assert.ok(job.plans.length <= 8);
    assert.ok(job.plans.some(p => pieces.filter(x => road.has(p.get(x.uid))).length >= 4));
    assert.ok(job.plans.some(p => pieces.some(x => !road.has(p.get(x.uid)))), 'retain off-road firing alternatives');
  } finally { m.dispose(); }
});

test('route-blocking candidates can eliminate a remaining mire leak without changing the combat input enemies', () => {
  const results = [];
  const ids = ['1_17', '1_06', '1_01', '1_10', '1_09', '1_09'].map(id => `chess_char_${id}_b`);
  for (const enabled of [false, true]) {
    const { m, ps } = openingFixture('act2autochess_m02', 1803, ids);
    try {
      m.botRouteBlockCandidates = enabled;
      m.round = 7; m.wave = buildNormalWave(m.gd, m.rngWaves, m.factions, 7); m._botPath = null;
      const job = arrange(m, ps, { final: true, defer: true }); job.run();
      results.push(replayPlan(m, ps, job.chosen, job.best));
    } finally { m.dispose(); }
  }
  assert.equal(results[0].leaks, 2);
  assert.equal(results[1].leaks, 0);
  assert.deepEqual(results[0].input.spawns, results[1].input.spawns);
  assert.equal(results[0].input.seed, results[1].input.seed);
});
