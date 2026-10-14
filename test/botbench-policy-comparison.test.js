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

test('wave 11 discount can reverse ranking without changing actual loss or source records', () => {
  const b = record('baseline', [10, ...Array(9).fill(0), 2]);
  const c = record('candidate', [7, ...Array(9).fill(0), 6]);
  const data = { results: [b, c] }, original = structuredClone(data);
  const unweighted = comparePolicies(data, 'candidate');
  const r = comparePolicies(data, 'candidate', 'baseline', { roundWeights: { 11: 0.5 } });
  assert.equal(unweighted.weightedLossBefore, unweighted.lossBefore);
  assert.deepEqual(unweighted.weightedMeanDelta95CI, unweighted.meanDelta95CI);
  assert.equal(r.lossBefore, 12);
  assert.equal(r.lossAfter, 13);
  assert.equal(r.weightedLossBefore, 11);
  assert.equal(r.weightedLossAfter, 10);
  assert.equal(r.worse, 1);
  assert.equal(r.weightedBetter, 1);
  assert.deepEqual(r.weightedMeanDelta95CI, [-1, -1]);
  assert.deepEqual(r.meanDelta95CI, unweighted.meanDelta95CI);
  assert.deepEqual(r.byRound, unweighted.byRound);
  assert.deepEqual(data, original);
});

test('weighted comparisons preserve failure guard and reject invalid objective definitions', () => {
  const data = { results: [record('baseline', [4]), record('candidate', [1], { allHumansSurvived: false })] };
  const r = comparePolicies(data, 'candidate', 'baseline', { roundWeights: { 11: 0.5 } });
  assert.equal(r.failedAfter, 1);
  assert.equal(r.objective.selection, 'failures-first-then-weighted-loss');
  for (const roundWeights of [null, [], { 0: 1 }, { 12: 1 }, { 11: -1 }, { 11: NaN }, { 11: Infinity }, { 11: '0.5' }, Object.fromEntries(Array.from({ length: 11 }, (_, i) => [i + 1, 0]))]) {
    assert.throws(() => comparePolicies(data, 'candidate', 'baseline', { roundWeights }), /Invalid round weights/);
  }
});
