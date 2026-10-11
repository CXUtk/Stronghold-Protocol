import test from 'node:test';
import assert from 'node:assert/strict';
import { runSupportMatch } from '../tools/botbench/support-runner.mjs';
import { runSupportPolicy, policyMetrics } from '../tools/botbench/support-policy.mjs';
import { digest } from '../tools/botbench/support-evaluator.mjs';
import { getData } from '../server/data.js';
import { aggregatePolicies, runPolicyCase } from '../tools/botbench-policy-search.mjs';

const config = { seed: 11, humans: 2, band: 'band_amiya', rounds: 7, stageId: 'act2autochess_m03', leakCount: 2, sourceMode: 'all' };
test('policy baseline preserves existing full match results and controlled human inputs', () => {
  const base = runSupportMatch(config), policy = runSupportPolicy(config);
  assert.deepEqual(policy.rounds, base.rounds);
  assert.deepEqual(policy.fixtureInputs, base.fixtureInputs);
  assert.equal(policy.policyDiagnostics.skipped.length, 0);
});
test('upgrade restraint is local to the selected AI and does not change subsequent matches or shared data', () => {
  const before = digest(getData());
  const first = runSupportPolicy(config, 'core3-anchor');
  assert.ok(first.policyDiagnostics.skipped.length > 0);
  assert.ok(first.policyDiagnostics.skipped.every((e) => e.pid === first.anchorPid && e.level === 3));
  for (const row of first.policyDiagnostics.preparation) {
    for (const p of row.players.filter((p) => p.pid === first.anchorPid)) assert.ok(p.level <= 3);
  }
  const base = runSupportPolicy(config);
  const repeat = runSupportPolicy(config, 'core3-anchor');
  assert.deepEqual(first.rounds, repeat.rounds);
  assert.equal(digest(getData()), before);
  assert.ok(base.policyDiagnostics.preparation.some((r) => r.players.some((p) => p.pid === base.anchorPid && p.level > 3)));
  assert.equal(first.modeId, 'mode_multi_abyss');
  assert.deepEqual(first.seats.map((p) => p.isBot), [false, false, true, true]);
});
test('whole-match policy metrics count human LP, rescue opportunities and AI elimination explicitly', () => {
  const result = { policyId: 'fixture', allHumansSurvived: false, elapsedMs: 2,
    rounds: [{ helpers: [], players: [
      { isBot: false, weak: true, weakZeroLoss: false, actualLoss: 2 },
      { isBot: false, weak: true, weakZeroLoss: true, actualLoss: 0 },
      { isBot: true, rawLeaks: 1, ownPerfect: false },
    ] }], players: [{ isBot: true, alive: false }], policyDiagnostics: { preparation: [] } };
  const metrics = policyMetrics(result);
  assert.deepEqual(metrics, { failed: 1, humanLoss: 2, weak: 2, rescued: 1, noHelper: 1, eligible: 0, aiLeaks: 1, eliminatedAI: 1, goldens: 0, ms: 2 });
  assert.equal(aggregatePolicies([result])[0].humanLoss, 2);
});

test('live rehearsal layers stay in isolated trials and preserve deterministic later matches', () => {
  const data = digest(getData()), base = runSupportPolicy(config);
  const candidate = runSupportPolicy(config, 'live-layers');
  assert.ok(candidate.policyDiagnostics.rehearsalLayers.some((r) => r.gains > 0));
  assert.ok(candidate.policyDiagnostics.rehearsalLayers.every((r) => r.fieldId.startsWith('r:')));
  assert.deepEqual(candidate.fixtureInputs, base.fixtureInputs);
  assert.deepEqual(runSupportPolicy(config, 'live-layers').rounds, candidate.rounds);
  assert.deepEqual(runSupportPolicy(config).rounds, base.rounds);
  assert.equal(digest(getData()), data);
});

test('policy pairs preserve full human leak stats even when later battle RNG allocation changes', () => {
  // This case changed its human round-nine inputs into ducks when candidates drew fixtures independently.
  const opts = { ...config, seed: 104, rounds: 11, sourceMode: 'single' };
  const [baseline, candidate] = runPolicyCase({ config: opts, policies: ['baseline', 'anchor3-wide'] });
  assert.deepEqual(candidate.fixtureInputs, baseline.fixtureInputs);
  const fixedBaseline = runSupportPolicy({ ...opts, humanFixtures: baseline.fixtureInputs });
  assert.deepEqual(fixedBaseline.rounds, baseline.rounds);
  assert.deepEqual(fixedBaseline.fixtureInputs, baseline.fixtureInputs);
  assert.ok(baseline.fixtureInputs.every((r) => r.inputs.every((p) => p.leaks.every((l) => l.lpr > 0))));
  assert.throws(() => runSupportPolicy({ ...config, humanFixtures: [] }), /Missing fixed human/);
});

test('partner strategies use distinct legal draft choices and leave human choices unchanged', () => {
  const [base, pair, medic] = runPolicyCase({ config: { ...config, rounds: 2 },
    policies: ['baseline', 'paired-fallback', 'team-medic'] });
  const botBands = (r) => r.players.filter((p) => p.isBot).map((p) => p.band).sort();
  assert.deepEqual(botBands(pair), ['band_amiya', 'band_ioleta']);
  assert.deepEqual(botBands(medic), ['band_amedic', 'band_amiya']);
  for (const r of [pair, medic]) {
    assert.equal(new Set(r.players.map((p) => p.band)).size, 4);
    assert.deepEqual(r.players.filter((p) => !p.isBot).map((p) => p.band), base.players.filter((p) => !p.isBot).map((p) => p.band));
    assert.deepEqual(r.fixtureInputs, base.fixtureInputs);
  }
});
