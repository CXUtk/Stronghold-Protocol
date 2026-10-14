import test from 'node:test';
import assert from 'node:assert/strict';
import { openingFixture, replayPlan } from '../../tools/botbench/diagnose-ranged-block.mjs';
import { arrange, planLayout, LAYOUT_PARAMS } from '../../server/match/bot.js';
import { buildNormalWave } from '../../server/match/waves.js';

const roster = form => ['1_17', '1_06', '1_01', '1_10', '1_09', '1_09'].map(id => `chess_char_${id}_${form}`);
const isMire = (m, key) => { const [r, c] = key.split(',').map(Number); return m.stage.tiles[m.stage.rows[r][c]].special === 'mire'; };

test('dry-ground proposals remain inside the rehearsal cap without banning other layouts', () => {
  const { m, ps, pieces } = openingFixture('act2autochess_m02', 1801, roster('a'));
  try {
    const plan = planLayout(m, ps, pieces, { ...LAYOUT_PARAMS, avoidMire: true, rangedBlock: true, groundRangedCount: 1 });
    assert.equal(plan.size, pieces.length);
    assert.ok([...plan.values()].every(key => !isMire(m, key)));
    const job = arrange(m, ps, { final: true, defer: true });
    assert.ok(job.plans.length <= 8);
    assert.ok(job.plans.some(p => [...p.values()].every(key => !isMire(m, key))), 'a dry option actually reaches the simulator');
  } finally { m.dispose(); }
});

test('a crowded board with only mire free keeps legal placements rather than discarding units', () => {
  const { m, ps, pieces } = openingFixture('act2autochess_m02');
  try {
    const map = ps.deployMap();
    const occupied = new Set([...map.keys()].filter(key => !isMire(m, key)));
    const plan = planLayout(m, ps, pieces, { ...LAYOUT_PARAMS, avoidMire: true }, { occupied });
    assert.equal(plan.size, pieces.length);
    assert.ok([...plan.values()].every(key => map.has(key) && !occupied.has(key)));
  } finally { m.dispose(); }
});

test('mire rehearsal includes accumulated ASPD loss and can choose equally effective dry firing positions', () => {
  const outcomes = [];
  for (const enabled of [false, true]) {
    const { m, ps } = openingFixture('act2autochess_m02', 1801, roster('a'));
    try {
      m.round = 3; m.wave = buildNormalWave(m.gd, m.rngWaves, m.factions, 3); m._botPath = null;
      m.botMireSafeCandidates = enabled;
      m.botRouteBlockCandidates = false; // Isolate dry-ground proposals from the later road-defense family.
      const job = arrange(m, ps, { final: true, defer: true }); job.run();
      outcomes.push(replayPlan(m, ps, job.chosen, job.best));
    } finally { m.dispose(); }
  }
  assert.ok(Object.values(outcomes[0].observation.mire).some(row => row.maxStacks === 10 && row.minAspd === 50));
  assert.equal(Object.keys(outcomes[1].observation.mire).length, 0);
  assert.equal(outcomes[1].leaks, outcomes[0].leaks);
  assert.deepEqual(outcomes[1].input.spawns, outcomes[0].input.spawns);
});

test('the safer candidate can preserve operators and reduce leaks under the same R7 pressure', () => {
  const outcomes = [];
  for (const enabled of [false, true]) {
    const { m, ps } = openingFixture('act2autochess_m02', 1804, roster('b'));
    try {
      m.round = 7; m.wave = buildNormalWave(m.gd, m.rngWaves, m.factions, 7); m._botPath = null;
      m.botMireSafeCandidates = enabled;
      m.botRouteBlockCandidates = false;
      const job = arrange(m, ps, { final: true, defer: true }); job.run();
      outcomes.push(replayPlan(m, ps, job.chosen, job.best));
    } finally { m.dispose(); }
  }
  const deaths = x => x.observation.units.reduce((n, u) => n + u.deaths, 0);
  assert.ok(deaths(outcomes[1]) < deaths(outcomes[0]));
  assert.ok(outcomes[1].leaks < outcomes[0].leaks);
  assert.deepEqual(outcomes[1].input.spawns, outcomes[0].input.spawns);
  assert.equal(outcomes[1].input.seed, outcomes[0].input.seed);
});

test('the mire option does not alter candidate generation on other terrain', () => {
  const plans = [];
  for (const enabled of [false, true]) {
    const { m, ps } = openingFixture('act1autochess_m02', 1801, roster('a'));
    try {
      m.botMireSafeCandidates = enabled;
      plans.push(arrange(m, ps, { final: true, defer: true }).plans);
    } finally { m.dispose(); }
  }
  assert.deepEqual(plans[1], plans[0]);
});
