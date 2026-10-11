import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = (x) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const caseOf = (r) => ({ seed: r.seed, band: r.band, stageId: r.stageId, humans: r.humans, modeId: r.modeId,
  targetRound: r.targetRound, leakCount: r.leakCount, sourceMode: r.sourceMode, fixtureVersion: r.fixtureVersion });

/** Preserve dirty/untracked research code as well as its base revision; hashes alone cannot reconstruct it. */
export function saveSourceSnapshot(root, output, manifest) {
  root = resolve(root);
  const files = {};
  const visit = (p) => {
    if (!existsSync(p)) return;
    if (statSync(p).isDirectory()) {
      for (const e of readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        if (!e.isSymbolicLink()) visit(resolve(p, e.name));
      }
    } else files[relative(root, p).replaceAll('\\', '/')] = readFileSync(p, 'utf8');
  };
  for (const p of ['server', 'shared', 'tools/botbench', 'tools/botbench-policy-search.mjs', 'tools/botbench-support.mjs', 'test/helpers/battleHarness.js', 'package.json']) visit(resolve(root, p));
  writeFileSync(output, JSON.stringify({ gitHead: manifest.gitHead, sourceHash: manifest.sourceHash, dataHash: manifest.dataHash, files }), { flag: 'wx' });
  return Object.keys(files).length;
}

/** Append-only local index. Raw JSON / JSONL remain the authoritative records, including rejected candidates. */
export function registerExperiment(input, registry = resolve(dirname(input), 'ai-experiment-index.jsonl')) {
  input = resolve(input); registry = resolve(registry);
  const raw = readFileSync(input, 'utf8'), d = JSON.parse(raw), id = hash(raw);
  if (!d.manifest || !Array.isArray(d.results) || !Array.isArray(d.summary)) throw new Error('Not a completed policy experiment');
  const baselines = d.results.filter((r) => r.policyId === 'baseline')
    .sort((a, b) => JSON.stringify(caseOf(a)).localeCompare(JSON.stringify(caseOf(b)), 'en'));
  if (!baselines.length) throw new Error('Experiment has no baseline');
  const existing = existsSync(registry) ? readFileSync(registry, 'utf8').trim().split('\n').filter(Boolean).map((s) => JSON.parse(s)) : [];
  if (existing.some((r) => r.id === id)) return { id, appended: false };
  const entry = { schemaVersion: 1, id, status: 'complete', kind: d.manifest.parts ? 'aggregate' : 'policy-batch',
    derivedFrom: d.manifest.parts, sourceSnapshot: d.manifest.sourceSnapshot, registeredAt: new Date().toISOString(),
    resultFile: relative(dirname(registry), input).replaceAll('\\', '/'),
    journalFile: relative(dirname(registry), input.replace(/\.json$/, '.jsonl')).replaceAll('\\', '/'),
    label: d.manifest.label || 'development', createdAt: d.manifest.createdAt,
    gitHead: d.manifest.gitHead, sourceHash: d.manifest.sourceHash, dataHash: d.manifest.dataHash, atlasHash: d.manifest.atlasHash,
    fixedHumanFixtures: d.manifest.fixedHumanFixtures === true,
    caseSignature: hash(baselines.map(caseOf)),
    fixtureSignature: hash(baselines.map((r) => ({ case: caseOf(r), inputs: r.fixtureInputs }))),
    baselineSignature: hash(baselines.map((r) => ({ case: caseOf(r), rounds: r.rounds, survived: r.allHumansSurvived }))),
    cases: baselines.length, seeds: [...new Set(baselines.map((r) => r.seed))],
    maps: [...new Set(baselines.map((r) => r.stageId))], summary: d.summary,
    elapsedMs: d.manifest.elapsedMs, matches: d.results.length };
  mkdirSync(dirname(registry), { recursive: true });
  appendFileSync(registry, JSON.stringify(entry) + '\n');
  return { id, appended: true, entry };
}

/** Cross-batch totals are comparable only when their baseline, cases and controlled human inputs agree. */
export function comparisonCompatibility(a, b) {
  const reasons = [];
  if (!a.fixedHumanFixtures || !b.fixedHumanFixtures) reasons.push('human inputs were not frozen');
  for (const k of ['dataHash', 'caseSignature', 'fixtureSignature', 'baselineSignature']) {
    if (!a[k] || a[k] !== b[k]) reasons.push(`${k} differs`);
  }
  return { comparable: reasons.length === 0, reasons };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: experiment-store.mjs RESULT.json [RESULT.json ...]');
  for (const path of process.argv.slice(2)) {
    const r = registerExperiment(path);
    console.log(JSON.stringify({ file: path, id: r.id, appended: r.appended }));
  }
}
