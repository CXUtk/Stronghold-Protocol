import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePolicies } from '../tools/botbench/compare-policies.mjs';

function record(policyId, losses, extra = {}) {
  return { policyId, seed: 91, band: 'band_amiya', stageId: 'act1autochess_m04', leakCount: 2, sourceMode: 'all',
    modeId: 'mode_multi_abyss', humans: 2, targetRound: 11, allHumansSurvived: true, elapsedMs: 0,
    fixtureInputs: [], policyDiagnostics: { preparation: [] }, players: [],
    rounds: losses.map((actualLoss, i) => ({ round: i + 1, helpers: [], players: [{ isBot: false, actualLoss, weak: true, weakZeroLoss: actualLoss === 0 }] })),
    ...extra };
}

test('paired reports reject duplicate baselines and different scenarios', () => {
  const b = record('baseline', [2]), c = record('candidate', [1]);
  assert.throws(() => comparePolicies({ results: [b, b, c] }, 'candidate'), /duplicate/);
  assert.throws(() => comparePolicies({ results: [b, { ...c, seed: 92 }] }, 'candidate'), /Missing baseline/);
  assert.throws(() => comparePolicies({ results: [b, { ...c, humans: 1 }] }, 'candidate'), /mode/);
});

test('early elimination remains a failure and does not hide baseline later-round losses', () => {
  const b = record('baseline', [2, 3, 4]);
  const c = record('candidate', [2], { allHumansSurvived: false, fixtureInputs: [{ changed: true }] });
  const r = comparePolicies({ results: [b, c] }, 'candidate');
  assert.equal(r.failedAfter, 1);
  assert.equal(r.lossBefore, 9);
  assert.equal(r.byRound.reduce((n, x) => n + x.lossBefore, 0), 9);
  assert.equal(r.changedFixtures, 1);
});

test('confidence intervals cluster the two bands from a seed and are reproducible', () => {
  const results = [];
  for (const band of ['band_amiya', 'band_ioleta']) {
    results.push(record('baseline', [3], { band }), record('candidate', [1], { band }));
  }
  const r = comparePolicies({ results }, 'candidate');
  assert.equal(r.independentSeeds, 1);
  assert.equal(r.matches, 2);
  assert.deepEqual(r.meanDelta95CI, [-2, -2]);
  assert.deepEqual(comparePolicies({ results }, 'candidate'), r);
});
