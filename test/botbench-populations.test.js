import test from 'node:test';
import assert from 'node:assert/strict';
import { runSupportPolicy } from '../tools/botbench/support-policy.mjs';
import { runSupportMatch } from '../tools/botbench/support-runner.mjs';
import { buildContext } from '../server/match/bot-build.js';
import { fieldModel } from '../server/match/bot.js';

for (const humans of [1, 2, 3]) {
  const botBands = ['band_ioleta', 'band_amedic', 'band_amiya'].slice(0, 4 - humans);
  const config = { seed: 1777, humans, botBands, band: botBands[0], rounds: 2,
    stageId: 'act2autochess_m03', leakCount: 1, sourceMode: 'all' };
  test(`${humans} human seats: same legal draft and fixtures, personas follow actual bands`, () => {
    const baseline = runSupportPolicy(config, 'baseline');
    const reference = runSupportPolicy({ ...config, humanFixtures: baseline.fixtureInputs }, 'pr445-parity-v13');
    assert.deepEqual(reference.errors, []);
    assert.deepEqual(reference.warnings, []);
    assert.deepEqual(reference.fixtureInputs, baseline.fixtureInputs);
    assert.deepEqual(reference.players.filter(p => p.isBot).map(p => p.band).sort(), [...botBands].sort());
    assert.equal(new Set(reference.players.map(p => p.band)).size, 4);
    for (const p of reference.players.filter(p => p.isBot)) assert.equal(reference.personas.find(x => x.pid === p.pid).persona,
      ({ band_amiya: 'amiya_fallback', band_ioleta: 'ioleta_fallback', band_amedic: 'touch_fallback' })[p.band]);
    assert.equal(reference.rounds.length, 2);
    assert.equal(reference.rounds[0].players.filter(p => p.isBot).length, 4 - humans);
  });
  test(`${humans} human seats: build scoring really remains enabled for each AI`, () => {
    let checked = 0;
    runSupportMatch(config, {
      configure(m) { m.botBuildPolicy = 'tanks'; m.botCombatAtlas = { entries: {}, mapMedics: {} }; },
      beforeEndPrep(m) {
        for (const p of m.alivePlayers()) {
          const context = buildContext(m, p, fieldModel(m, p));
          assert.equal(!!context, p.isBot);
          if (p.isBot) { assert.ok(context.rows.length); checked++; }
        }
      },
    });
    assert.equal(checked, (4 - humans) * 2);
  });
}
