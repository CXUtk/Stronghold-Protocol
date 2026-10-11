import test from 'node:test';
import assert from 'node:assert/strict';
import { runSupportMatch, supportMetrics, SUPPORT_MAPS } from '../tools/botbench/support-runner.mjs';
import { parseSupportArgs } from '../tools/botbench-support.mjs';
import { summarize, percentile, supportReport } from '../tools/botbench/support-report.mjs';
import { uniteSurvivors } from '../server/match/unite.js';
import { selectLeaks } from '../tools/botbench/support-fixture.mjs';
import { breakdown } from '../tools/botbench/analyze-support.mjs';

test('support metrics use actual capped loss, not raw killed enemies; allow negative savings', () => {
  const r = supportMetrics({ beforeLP: 5, afterLP: 2, rawLeaks: 25, actualLoss: 3, cap: 10, uniteRan: true });
  assert.equal(r.noUniteLoss, 10);
  assert.equal(r.avoidedLP, 7);
  assert.equal(r.criticalRescue, true);
  assert.equal(r.weakZeroLoss, false);
  assert.equal(supportMetrics({ beforeLP: 20, afterLP: 16, rawLeaks: 2, actualLoss: 4, cap: 10, uniteRan: true }).avoidedLP, -2);
  assert.equal(supportMetrics({ beforeLP: 5, afterLP: 0, rawLeaks: 20, actualLoss: 10, cap: 10, uniteRan: false }).criticalRescue, false);
});

test('support attribution includes not-reentered, unborn and counted offspring by source, not helper', () => {
  const survivors = uniteSurvivors({ notReentered: new Map([['human', 2]]) }, {
    perPlayer: { helper: { leaked: [
      { sourcePlayerId: 'human', counted: true }, { sourcePlayerId: 'human', counted: false },
      { sourcePlayerId: 'ai', counted: true }, { sourcePlayerId: 'human', enemyKey: 'child', counted: true },
    ] } }, unspawned: [{ sourcePlayerId: 'human' }],
  });
  assert.equal(survivors.get('human'), 5);
  assert.equal(survivors.get('ai'), 1);
  assert.equal(survivors.has('helper'), false);
});

test('strict CLI options avoid silently running a different benchmark', () => {
  assert.equal(parseSupportArgs(['--support', '--out', 'result']).rounds, 11);
  assert.deepEqual(parseSupportArgs(['--out', 'result', '--maps', 'all']).maps, SUPPORT_MAPS);
  assert.throws(() => parseSupportArgs(['--out', 'result', '--maps', 'unknown']));
  for (const args of [['--rounds', '12'], ['--humans', '4'], ['--humans', '1,1'], ['--seeds', 'x'], ['--band', 'band_amiya']]) {
    assert.throws(() => parseSupportArgs(['--out', 'result', ...args]));
  }
});

test('a controlled match stops after settlement, preserves human seats, legal strategy uniqueness and source accounting', () => {
  const opts = { seed: 1, humans: 2, band: 'band_ioleta', rounds: 2, rehearsal: 0, stageId: SUPPORT_MAPS[0] };
  const r = runSupportMatch(opts);
  assert.equal(r.stopReason, 'round-cutoff');
  assert.deepEqual(r.rounds.map((x) => x.round), [1, 2]);
  assert.equal(r.players.filter((p) => !p.isBot).length, 2);
  assert.equal(r.modeId, 'mode_multi_abyss');
  assert.equal(r.seats.length, 4);
  assert.equal(r.seats.filter((p) => p.isBot).length, 2);
  assert.deepEqual(r.rounds[0].wave.enemyScale, { hpMul: 1.2, atkMul: 1.1, speedMul: 1 });
  assert.ok(r.rounds[0].players.every((p) => Object.keys(p.scheduledGroups).length > 0));
  assert.ok(r.players.every((p) => !p.autoplay));
  assert.equal(new Set(r.players.map((p) => p.band)).size, 4);
  assert.equal(r.players.find((p) => p.pid === r.anchorPid).band, 'band_ioleta');
  assert.equal(r.stageId, opts.stageId);
  assert.deepEqual(r.startedRounds, [1, 2]);
  assert.equal(r.fixtureInputs.length, 2);
  assert.ok(r.fixtureInputs.every((r) => r.inputs.reduce((s, p) => s + p.actual, 0) <= 2));
  assert.ok(r.rounds.every((r) => r.helpers.every((pid) => r.players.find((p) => p.pid === pid).isBot)));
  for (const round of r.rounds) for (const p of round.players) {
    assert.equal(p.actualLoss, Math.min(10, p.remaining));
    assert.equal(p.rawLeaks, Object.values(p.leakGroups).reduce((a, b) => a + b, 0));
  }
  assert.deepEqual(r.errors, []);
  const again = runSupportMatch(opts);
  assert.deepEqual(again.rounds, r.rounds);
  assert.deepEqual(again.players, r.players);
  assert.deepEqual(again.fixtureInputs, r.fixtureInputs);
});

test('pressure fixture early elimination is a failure, with no twelfth round simulated', () => {
  const r = runSupportMatch({ seed: 1, humans: 2, rounds: 11, rehearsal: 0, stageId: SUPPORT_MAPS[0], leakCount: 30, sourceMode: 'all', scenario: 'pressure' });
  assert.equal(r.stopReason, 'humans-eliminated');
  assert.equal(r.allHumansSurvived, false);
  assert.equal(r.survivingHumans, 0);
  assert.ok(r.rounds.at(-1).round < 11);
  const s = summarize([r]);
  assert.equal(s.failedMatches, 1);
  assert.equal(s.allSurvived, 0);
  assert.ok(s.weakRounds > 0);
  assert.ok(s.aiPerfect > 0);
  assert.ok(supportReport({ rounds: 11, bands: ['band_amiya'], humans: [2] }, [r]).includes('失败对局 1/1'));
});

test('small-leak fixture includes round eleven settlement but never starts twelve', () => {
  const r = runSupportMatch({ seed: 1, humans: 3, rounds: 11, rehearsal: 0, leakCount: 1, stageId: SUPPORT_MAPS[0] });
  assert.equal(r.stopReason, 'round-cutoff');
  assert.deepEqual(r.startedRounds, Array.from({ length: 11 }, (_, i) => i + 1));
  assert.equal(r.rounds.at(-1).round, 11);
  assert.ok(r.players.filter((p) => !p.isBot).every((p) => p.lpLost <= 11));
});

test('controlled inputs preserve real instance stats, exclude non-counted/bounty and do not multiply scarce enemies', () => {
  const leaks = [{ enemyKey: 'a', counted: true, mods: { hp: 2 } }, { enemyKey: 'b', counted: true },
    { enemyKey: 'a', counted: false }, { enemyKey: 'c', counted: true, tag: 'bounty' }];
  const before = structuredClone(leaks);
  assert.deepEqual(selectLeaks(leaks, 1, 1), [leaks[1]]);
  assert.deepEqual(selectLeaks(leaks, 10, 0), leaks.slice(0, 2));
  assert.deepEqual(selectLeaks([], 3, 7), []);
  assert.deepEqual(leaks, before);
});

test('empty denominators are absent measurements, not perfect or zero-cost results', () => {
  assert.equal(summarize([]).prepMsP95, null);
  assert.equal(summarize([]).meanHumanLoss, null);
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([5, 1, 2], 0.5), 2);
});

test('map analysis keeps eliminated AI in the clearance denominator and separates bounty leaks', () => {
  const rows = [
    { seed: 1, uniteRan: true, players: [
      { isBot: true, ownPerfect: false, leakGroups: { 'wave:main': 3, 'bounty:extra': 2 } },
      { isBot: true, ownPerfect: true, leakGroups: {} },
      { isBot: false, weak: true, weakZeroLoss: true, actualLoss: 0 },
    ] },
    { seed: 1, uniteRan: false, players: [{ isBot: false, weak: true, weakZeroLoss: false, actualLoss: 3 }] },
  ];
  const r = breakdown(rows);
  assert.equal(r.expectedSlots, 4);
  assert.equal(r.aiBattles, 2);
  assert.equal(r.aiPerfect, 1);
  assert.equal(r.baseLeaks, 3);
  assert.equal(r.bountyLeaks, 2);
  assert.equal(r.noHelp, 1);
  assert.equal(r.helpedZero, 1);
  assert.equal(r.humanLoss, 3);
  assert.equal(r.seeds, 1);
});
