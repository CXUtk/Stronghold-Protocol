import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_POLICIES, buildContext, counterCoverage, counterBuyBonus, enemyDps } from '../server/match/bot-build.js';
import { makeMatch } from './match/harness.js';
const profile = (dps, early = dps) => ({ dps20: early, dps60: 2 * dps - early, hps: 0, silenceUptime: 0, defReduction: 0, resReduction: 0 });
const entry = (air, early = 400) => ({ profiles: Object.fromEntries(['soft', 'armor400', 'armor800', 'armor1400', 'resist', 'reflection', 'crowd', 'air'].map(k => [k, profile(k === 'air' ? air : 400, k === 'air' ? air : early)])) });
function ctx(row) {
  return { policy: BUILD_POLICIES['enemy-cover'], rows: [{ weight: 1, hp: 50000, speed: 1, regen: 0, reflection: 0, def: 0, res: 0, silenciable: true, ...row }], entries: { ground: entry(0), air: entry(400) }, values: new Map(), synergy: new Map(), crowd: 0 };
}
const ground = { chessId: 'ground' }, air = { chessId: 'air' };
test('enemy-aware construction recognizes hover, preserving the frozen tanks reference', () => {
  const { m } = makeMatch({ humans: 2, bots: 2, difficulty: 'ABYSS', seed: 11 });
  try {
    const ps = m.order.find(p => p.isBot); m.round = 8; m.botCombatAtlas = { entries: {} }; m.wave = { spawns: [{ enemyKey: 'enemy_2025_syufo', count: 4 }] };
    m.botBuildPolicy = 'tanks'; const before = buildContext(m, ps, { armor: [] });
    assert.equal(!!before.rows[0].fly, false);
    m.botBuildPolicy = 'enemy-hover'; const after = buildContext(m, ps, { armor: [] });
    assert.equal(after.rows[0].fly, true);
    assert.ok(after.rows[0].hp > m.gd.enemy('enemy_2025_syufo').stats.maxHp);
    assert.equal(m.wave.spawns[0].count, 4);
  } finally { m.dispose(); }
});
test('coverage fills an air weakness; a ninth identical card gets no imaginary slot', () => {
  const c = ctx({ fly: true });
  assert.equal(counterCoverage(c, [ground]), 0);
  assert.ok(counterCoverage(c, [air]) > 0);
  assert.ok(counterBuyBonus(c, air, Array(8).fill(ground)) > 0);
  assert.equal(counterBuyBonus(c, air, Array(8).fill(air)), 0);
});
test('regeneration is deducted from team damage capacity, not independently for every attacker', () => {
  const a = ctx({}), b = ctx({ regen: 5000 });
  assert.ok(counterCoverage(b, [air, air]) < counterCoverage(a, [air, air]));
  assert.ok(counterCoverage(b, [air, air]) > counterCoverage(b, [air]));
});
test('short windows reduce slow-start damage without altering frozen atlas arithmetic', () => {
  const c = ctx({}), slow = entry(400, 100), fast = entry(400, 600), row = c.rows[0];
  const quick = { ...row, speed: 2 };
  assert.ok(enemyDps(c, slow, quick) < enemyDps(c, fast, quick));
  assert.ok(Number.isFinite(enemyDps(c, slow, { def: 0, res: 0 })), 'fallback armor context has no speed');
  c.policy = BUILD_POLICIES.tanks;
  assert.equal(enemyDps(c, slow, quick), enemyDps(c, fast, quick));
});
