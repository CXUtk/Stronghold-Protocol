import test from 'node:test';
import assert from 'node:assert/strict';
import { probeUnit } from '../tools/botbench/combat-atlas.mjs';
import { getData } from '../server/data.js';
import { atlasDps, buildContext, buildItemBonus, buildLineupBonus, buildUnitBonus, BUILD_POLICIES } from '../server/match/bot-build.js';
import { makeMatch, give } from './match/harness.js';
import { arrange, itemTarget } from '../server/match/bot.js';

test('capability probes retain real weakness damage, DEF breakpoints, silence and saturated healing', () => {
  const raw = JSON.stringify(getData());
  const soft = probeUnit('chess_char_3_01_a', 'soft');
  const armor = probeUnit('chess_char_3_01_a', 'armor1400');
  assert.ok(armor.dps60 < soft.dps60 / 3, 'rapid physical hits fail against heavy armor');
  const weakness = probeUnit('chess_char_3_17_a', 'armor1400');
  assert.ok(weakness.damageTypes.arts > weakness.damageTypes.phys, '流星的卫戍协议特质 chooses the weaker defense');
  const before = probeUnit('chess_char_1_17_a', 'reflection');
  const after = probeUnit('chess_char_1_17_a', 'reflection', { items: ['chess_item_3_08_e_a'] });
  assert.ok(after.dps60 > before.dps60 * 2);
  assert.ok(after.silenceUptime > 0.8 && after.resReduction > 50);
  assert.ok(probeUnit('chess_char_2_05_a', 'soft').hps > 100);
  assert.deepEqual(probeUnit('chess_char_1_17_a', 'reflection'), before);
  assert.equal(JSON.stringify(getData()), raw, 'probes never change shared game data');
});

test('second build iteration values the map-medic elite threshold and does not punish a tank for low damage', () => {
  const profile = { dps20: 30, dps60: 30, hps: 0, silenceUptime: 0, defReduction: 0, resReduction: 0 };
  const entry = { profiles: Object.fromEntries(['soft', 'armor400', 'armor800', 'armor1400', 'resist', 'reflection', 'crowd', 'air'].map((k) => [k, profile])) };
  const ctx = { policy: BUILD_POLICIES.matchup, entries: { tank: entry }, values: new Map(), synergy: new Map(), crowd: 0,
    rows: [{ def: 400, res: 0, reflection: 0, weight: 1, atk: 2000, bat: 1, type: 'phys' }],
    infection: false, dot: 0, mapMedic: true, mapMedics: { char_605_cmedic: 145, char_613_acmedc: 609 } };
  const tank = { chessId: 'tank', tier: 2, position: 'MELEE', isGolden: false, stats: { def: 500, res: 0, blockCnt: 3 } };
  assert.ok(buildUnitBonus(ctx, tank) < 0);
  ctx.policy = BUILD_POLICIES.resilient;
  assert.equal(buildUnitBonus(ctx, tank), 0);
  const normal = buildLineupBonus(ctx, [tank, tank]);
  const upgraded = buildLineupBonus(ctx, [{ ...tank, isGolden: true }, { ...tank, isGolden: true }]);
  assert.ok(upgraded > normal, 'two elite operators unlock the stronger map medic');
  ctx.policy = BUILD_POLICIES.matchup;
  assert.equal(buildLineupBonus(ctx, [tank, tank]), 0, 'the frozen first-iteration policy remains unchanged');
});

test('atlas interpolation handles armor, air exclusion, and opt-in public enemy context', () => {
  const profile = (dps) => ({ dps20: dps, dps60: dps, hps: 0, silenceUptime: 0 });
  const entry = { profiles: { soft: profile(600), armor400: profile(200), armor800: profile(30),
    armor1400: profile(30), resist: profile(400), reflection: profile(200), crowd: profile(400), air: profile(0) } };
  assert.ok(atlasDps(entry, { def: 800 }) < atlasDps(entry, { def: 0 }));
  assert.equal(atlasDps(entry, { fly: true }), 0);
  const { m } = makeMatch({ humans: 2, bots: 2, difficulty: 'ABYSS', seed: 11 });
  try {
    const ps = m.order.find((p) => p.isBot), model = { armor: [{ def: 0, res: 0, w: 1 }] };
    assert.equal(buildContext(m, ps, model), null);
    m.botBuildPolicy = 'matchup'; m.botCombatAtlas = { entries: {} }; m.round = 3;
    m.wave = { spawns: [{ enemyKey: 'enemy_1166_dusbr', count: 20 }] };
    const ctx = buildContext(m, ps, model);
    assert.ok(ctx.reflection >= 0.8);
    const item = m.gd.item('chess_item_3_08_e_a');
    assert.ok(buildItemBonus(ctx, item) > 0);
    assert.equal(buildItemBonus(ctx, item, [item]), 0, 'no duplicate counter-item bonus');
    ps.autoplay = true; assert.equal(buildContext(m, ps, model), null);
    ps.autoplay = false; m.round = 12; assert.equal(buildContext(m, ps, model), null);
  } finally { m.dispose(); }
});

test('counter-item assignment avoids a carrier already providing reliable silence', () => {
  const { m } = makeMatch({ humans: 2, bots: 2, difficulty: 'ABYSS', seed: 11 }).start().toPrep();
  try {
    const ps = m.order.find((p) => p.isBot);
    for (const u of ps.allChess()) ps.sell(u.uid);
    give(m, ps, 'chess_char_2_16_a'); give(m, ps, 'chess_char_1_17_a'); arrange(m, ps);
    const profile = (silenceUptime) => ({ dps20: 300, dps60: 300, hps: 0, silenceUptime, defReduction: 0, resReduction: 0 });
    const entry = (s) => ({ profiles: Object.fromEntries(['soft', 'armor400', 'armor800', 'armor1400', 'resist', 'reflection', 'crowd', 'air'].map((k) => [k, profile(s)])) });
    m.botCombatAtlas = { entries: { chess_char_2_16_a: entry(1), chess_char_1_17_a: entry(0) } };
    m.botBuildPolicy = 'matchup';
    assert.equal(itemTarget(m, ps, { id: 'chess_item_3_08_e_a' }).id, 'chess_char_1_17_a');
  } finally { m.dispose(); }
});
