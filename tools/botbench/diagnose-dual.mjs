import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSupportPolicy } from './support-policy.mjs';
import { saveSourceSnapshot } from './experiment-store.mjs';
import { hashTree } from '../botbench-support.mjs';
const root = process.cwd(), out = process.argv[2];
const old = JSON.parse(readFileSync('../logs/ai-hybrid-v6-heldout-seven.json'));
const manifest = { kind: 'diagnostic-replay', label: 'v8-seen-dual-regressions', gitHead: 'cf7b0b55',
  newSimulationMatches: 12, sourceHash: hashTree(root, ['server', 'shared', 'tools/botbench']), dataHash: hashTree(root, ['data']) };
saveSourceSnapshot(root, out + '.source.json', manifest);
writeFileSync(out + '.jsonl', JSON.stringify({ manifest }) + '\n', { flag: 'wx' });
const results = [];
for (const [seed, band] of [[1104, 'band_ioleta'], [1111, 'band_ioleta'], [1119, 'band_amiya'], [1119, 'band_ioleta']]) {
  for (const policy of ['pr445-aligned', 'pr445-build', 'hybrid-v7']) {
    const ref = old.results.find((r) => r.seed === seed && r.band === band && r.policyId === policy);
    const r = runSupportPolicy({ seed, band, humans: 2, rounds: 11, stageId: ref.stageId,
      leakCount: ref.leakCount, sourceMode: ref.sourceMode, humanFixtures: ref.fixtureInputs,
      atlasPath: '../logs/ai-combat-atlas-20261014-v5-medics.json', observe: true, routeDiagnostics: true }, policy);
    if (JSON.stringify(r.rounds) !== JSON.stringify(ref.rounds)) throw new Error('Diagnostic changed outcome');
    results.push(r); appendFileSync(out + '.jsonl', JSON.stringify({ result: r }) + '\n');
    console.log(JSON.stringify({ seed, band, policy, losses: r.rounds.map((w) => ({ round: w.round,
      humanLoss: w.players.filter((p) => !p.isBot).reduce((s, p) => s + p.actualLoss, 0),
      bots: w.players.filter((p) => p.isBot).map((p) => ({ pid: p.pid, leaks: p.rawLeaks, alive: p.carry.filter((u) => u.alive).length })), helpers: w.helpers })) }));
  }
}
const raw = JSON.stringify({ manifest, results }); writeFileSync(out + '.json', raw, { flag: 'wx' });
appendFileSync('../logs/ai-experiment-index.jsonl', JSON.stringify({ ...manifest, status: 'complete', resultFile: out + '.json',
  sourceSnapshot: out + '.source.json', journalFile: out + '.jsonl', id: createHash('sha256').update(raw).digest('hex'),
  seeds: [1104, 1111, 1119], registeredAt: new Date().toISOString() }) + '\n');
