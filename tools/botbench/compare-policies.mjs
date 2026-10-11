import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from '../../server/sim/rng.js';
import { policyMetrics } from './support-policy.mjs';

const keyOf = (r) => `${r.seed}|${r.band}|${r.stageId}|${r.leakCount}|${r.sourceMode}`;
const sum = (a, f) => a.reduce((n, x) => n + f(x), 0);

export function comparePolicies(data, candidate, baseline = 'baseline') {
  const baselines = data.results.filter((r) => r.policyId === baseline);
  const old = new Map(baselines.map((r) => [keyOf(r), r]));
  const candidates = data.results.filter((r) => r.policyId === candidate);
  if (!old.size || old.size !== baselines.length || old.size !== candidates.length || new Set(candidates.map(keyOf)).size !== candidates.length) throw new Error('Unpaired or duplicate policy cases');
  const pairs = candidates.map((r) => {
    const a = old.get(keyOf(r));
    if (!a) throw new Error('Missing baseline pair');
    if (a.modeId !== 'mode_multi_abyss' || r.modeId !== a.modeId || a.humans !== 2 || r.humans !== 2 || r.targetRound !== 11 || a.targetRound !== 11) throw new Error('Unexpected evaluation mode');
    const before = policyMetrics(a), after = policyMetrics(r);
    return { seed: r.seed, band: r.band, stageId: r.stageId, before, after, delta: after.humanLoss - before.humanLoss,
      fixtureSame: JSON.stringify(a.fixtureInputs) === JSON.stringify(r.fixtureInputs),
      roundDeltas: [...new Set([...a.rounds, ...r.rounds].map((x) => x.round))].sort((a, b) => a - b).map((round) => {
        const o = a.rounds.find((x) => x.round === round), b = r.rounds.find((x) => x.round === round);
        const loss = (x) => sum(x?.players.filter((p) => !p.isBot) || [], (p) => p.actualLoss);
        return { round, before: loss(o), after: loss(b) };
      }) };
  });
  const summary = (xs) => ({ matches: xs.length,
    failedBefore: sum(xs, (r) => r.before.failed), failedAfter: sum(xs, (r) => r.after.failed),
    lossBefore: sum(xs, (r) => r.before.humanLoss), lossAfter: sum(xs, (r) => r.after.humanLoss),
    better: xs.filter((r) => r.delta < 0).length, worse: xs.filter((r) => r.delta > 0).length,
    rescuedBefore: sum(xs, (r) => r.before.rescued), rescuedAfter: sum(xs, (r) => r.after.rescued),
    eligibleBefore: sum(xs, (r) => r.before.eligible), eligibleAfter: sum(xs, (r) => r.after.eligible),
    aiEliminatedBefore: sum(xs, (r) => r.before.eliminatedAI), aiEliminatedAfter: sum(xs, (r) => r.after.eliminatedAI),
  });
  // Resample whole match seeds: the bands/maps derived from one seed are NOT independent samples.
  const seeds = [...new Set(pairs.map((r) => r.seed))];
  const clusters = seeds.map((s) => pairs.filter((r) => r.seed === s));
  const rng = createRng(713), samples = [];
  for (let i = 0; i < 10000; i++) {
    let total = 0, count = 0;
    for (let j = 0; j < seeds.length; j++) {
      const c = clusters[rng.int(clusters.length)]; total += sum(c, (r) => r.delta); count += c.length;
    }
    samples.push(total / count);
  }
  samples.sort((a, b) => a - b);
  const group = (field) => [...new Set(pairs.map((r) => r[field]))].map((value) => ({ [field]: value, ...summary(pairs.filter((r) => r[field] === value)) }));
  const tail = (side) => {
    const losses = pairs.map((r) => r[side].humanLoss).sort((a, b) => b - a);
    const n = Math.max(1, Math.ceil(losses.length * 0.1)); return sum(losses.slice(0, n), (x) => x) / n;
  };
  return { candidate, baseline, ...summary(pairs), meanDelta95CI: [samples[249], samples[9749]], independentSeeds: seeds.length,
    worstDecileBefore: tail('before'), worstDecileAfter: tail('after'),
    changedFixtures: pairs.filter((r) => !r.fixtureSame).length,
    byMap: group('stageId'), byBand: group('band'),
    byRound: Array.from({ length: 11 }, (_, i) => ({ round: i + 1,
      lossBefore: sum(pairs, (r) => r.roundDeltas.find((d) => d.round === i + 1)?.before || 0),
      lossAfter: sum(pairs, (r) => r.roundDeltas.find((d) => d.round === i + 1)?.after || 0) })),
    pairs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, candidate, output] = process.argv.slice(2);
  if (!input || !candidate || !output) throw new Error('Usage: compare-policies.mjs INPUT CANDIDATE OUTPUT');
  const result = comparePolicies(JSON.parse(readFileSync(input)), candidate);
  writeFileSync(output, JSON.stringify(result, null, 2));
  const { pairs: _pairs, ...summary } = result;
  console.log(JSON.stringify(summary));
}
