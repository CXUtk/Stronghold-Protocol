import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSupportPolicy } from '../tools/botbench/support-policy.mjs';
import { makeMatch, give } from './match/harness.js';
import { makeBattle } from './helpers/battleHarness.js';
import { planLayout, LAYOUT_PARAMS } from '../server/match/bot.js';
import { parseKey } from '../server/match/board.js';

for (const seed of [901, 904]) test(`offline personas follow drafted bands rather than seats, seed ${seed}`, () => {
  const r = runSupportPolicy({ seed, humans: 2, band: 'band_amiya', rounds: 1,
    stageId: 'act2autochess_m02', leakCount: 1, sourceMode: 'single' }, 'pr445-aligned');
  const expected = { band_amiya: 'amiya_fallback', band_amedic: 'touch_fallback' };
  for (const p of r.players.filter((p) => p.isBot)) assert.equal(r.personas.find((s) => s.pid === p.pid).persona, expected[p.band]);
  assert.deepEqual(r.errors, []); assert.deepEqual(r.warnings, []);
});

test('output-first alternative clears either entrance of the heavy-guard regression without weakening the original assertion', () => {
  const { m } = makeMatch({ mode: 'coop', humans: 3, difficulty: 'HARD', seed: 8 }).start().toPrep().setStage('act2autochess_m02');
  try {
    const ps = m.order[0];
    const routes = [[9, 10], [12, 10]].map((start) => ({ motion: 'WALK', start, end: [9, 2], checkpoints: [] }));
    m.wave = { ...m.wave, routes, spawns: routes.map((_, routeIndex) => ({ enemyKey: 'enemy_1006_shield_2', routeIndex, count: 3 })) };
    const pieces = ['1_02_a', '1_06_b', '2_07_a', '1_10_b', '2_09_a', '2_01_b', '1_18_a', '2_12_b'].map((id) => give(m, ps, `chess_char_${id}`, 'hand'));
    const plan = planLayout(m, ps, pieces, { ...LAYOUT_PARAMS, tankFirst: false });
    for (const route of [0, 1]) {
      const b = makeBattle({ stageId: m.stageId, routes, timeLimit: 100,
        enemies: [{ key: 'enemy_1006_shield_2', time: 30, route, count: 3, interval: 1 }],
        units: pieces.map((p) => { const [row, col] = parseKey(plan.get(p.uid)); return { chessId: p.id, uid: p.uid, row, col, dir: plan.dirs.get(p.uid) }; }) });
      b.runToEnd(); b.invariants();
      assert.equal(b.result().perPlayer.p1.killed, 3);
      assert.equal(b.result().perPlayer.p1.leaked.length, 0);
    }
  } finally { m.dispose(); }
});
