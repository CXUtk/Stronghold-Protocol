import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { registerExperiment, comparisonCompatibility, saveSourceSnapshot } from '../tools/botbench/experiment-store.mjs';

test('experiment index retains original batches, deduplicates content and detects incomparable baselines', () => {
  const prefix = join(tmpdir(), 'botbench-index-'), root = mkdtempSync(prefix);
  try {
    const input = join(root, 'first.json'), index = join(root, 'index.jsonl');
    mkdirSync(join(root, 'server'));
    writeFileSync(join(root, 'server', 'policy.js'), 'export const experimental = 7;');
    const snapshot = join(root, 'source.json');
    assert.equal(saveSourceSnapshot(root, snapshot, { gitHead: 'base', dataHash: 'data1' }), 1);
    assert.equal(JSON.parse(readFileSync(snapshot)).files['server/policy.js'], 'export const experimental = 7;');
    assert.throws(() => saveSourceSnapshot(root, snapshot, {}), /EEXIST/);
    const data = { manifest: { fixedHumanFixtures: true, label: 'development', dataHash: 'data1', sourceHash: 'code1' }, summary: [],
      results: [{ policyId: 'baseline', seed: 1, humans: 2, band: 'band_amiya', modeId: 'mode_multi_abyss', targetRound: 11,
        fixtureInputs: [{ enemy: 'a' }], rounds: [{ loss: 2 }], allHumansSurvived: true }] };
    writeFileSync(input, JSON.stringify(data));
    const a = registerExperiment(input, index);
    assert.equal(registerExperiment(input, index).appended, false);
    assert.equal(readFileSync(index, 'utf8').trim().split('\n').length, 1);
    const second = join(root, 'second.json');
    data.manifest.sourceHash = 'code2';
    writeFileSync(second, JSON.stringify(data));
    const b = registerExperiment(second, index);
    assert.equal(comparisonCompatibility(a.entry, b.entry).comparable, true);
    data.results[0].rounds[0].loss = 1;
    const third = join(root, 'third.json'); writeFileSync(third, JSON.stringify(data));
    const c = registerExperiment(third, index);
    assert.deepEqual(comparisonCompatibility(a.entry, c.entry), { comparable: false, reasons: ['baselineSignature differs'] });
    assert.equal(comparisonCompatibility(a.entry, { ...a.entry, fixedHumanFixtures: false }).comparable, false);
    assert.equal(JSON.parse(readFileSync(input)).results[0].rounds[0].loss, 2, 'registering never rewrites original data');
    assert.equal(readFileSync(index, 'utf8').trim().split('\n').length, 3);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(prefix)) && resolve(root) !== resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
});
