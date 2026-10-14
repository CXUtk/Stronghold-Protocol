import test from 'node:test';
import assert from 'node:assert/strict';
import { runSupportPolicy } from '../tools/botbench/support-policy.mjs';

test('zero-switch ablation and economic tracing preserve PR 445 match actions and outcomes', () => {
  const config = { seed: 1506, humans: 2, band: 'band_ioleta', rounds: 5,
    stageId: 'act1autochess_m02', leakCount: 3, sourceMode: 'single' };
  const baseline = runSupportPolicy(config, 'baseline');
  const fixed = { ...config, humanFixtures: baseline.fixtureInputs };
  const reference = runSupportPolicy(fixed, 'pr445-parity-v13');
  const ablation = runSupportPolicy(fixed, 'ablate-v14-b0-l0-s0-c0');
  assert.deepEqual(ablation.errors, []);
  assert.deepEqual(ablation.warnings, []);
  assert.deepEqual(ablation.rounds, reference.rounds);
  assert.deepEqual(ablation.fixtureInputs, reference.fixtureInputs);
  assert.deepEqual(ablation.policyDiagnostics.preparation, reference.policyDiagnostics.preparation);
  const actions = ablation.policyDiagnostics.economyActions;
  assert.ok(actions.some((a) => a.action === 'refresh' && a.ok && a.offers.length));
  for (const p of ablation.policyDiagnostics.preparation.at(-1).players) {
    const purchases = actions.filter((a) => a.pid === p.pid && a.action === 'buy' && a.ok);
    assert.equal(purchases.length, p.stats.buys);
  }
});
