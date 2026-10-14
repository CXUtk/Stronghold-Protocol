import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { POLICIES, runSupportPolicy, policyMetrics } from './botbench/support-policy.mjs';
import { SUPPORT_MAPS } from './botbench/support-runner.mjs';
import { hashTree } from './botbench-support.mjs';
import { registerExperiment, saveSourceSnapshot } from './botbench/experiment-store.mjs';

if (!isMainThread && workerData?.policySearch) {
  parentPort.on('message', ({ index, task }) => {
    try { parentPort.postMessage({ index, results: runPolicyCase(task) }); }
    catch (err) { parentPort.postMessage({ index, error: err.stack }); }
  });
}

export function runPolicyCase({ config, policies, referenceBaseline = null }) {
  // Generate incoming human leaks once from the unmodified policy. AI deaths can otherwise change later battle
  // RNG allocation (e.g. duck replacements) and accidentally give the candidate different enemies to rescue.
  const baseline = referenceBaseline || runSupportPolicy(config, 'baseline');
  if (referenceBaseline && (baseline.policyId !== 'baseline' || baseline.modeId !== 'mode_multi_abyss'
    || ['seed', 'humans', 'band', 'stageId', 'leakCount', 'sourceMode'].some((k) => baseline[k] !== config[k])
    || baseline.targetRound !== config.rounds)) throw new Error('Reference baseline case mismatch');
  if (baseline.rounds.length !== config.rounds) throw new Error('Baseline did not reach fixture cutoff');
  return policies.map((policy) => policy === 'baseline' ? baseline
    : runSupportPolicy({ ...config, humanFixtures: baseline.fixtureInputs }, policy));
}

export function aggregatePolicies(results) {
  return [...new Set(results.map((r) => r.policyId))].map((policy) => {
    const rows = results.filter((r) => r.policyId === policy), metrics = rows.map(policyMetrics);
    const totals = Object.fromEntries(Object.keys(metrics[0]).map((key) => [key, metrics.reduce((n, x) => n + x[key], 0)]));
    return { policy, matches: rows.length, ...totals };
  }).sort((a, b) => a.failed - b.failed || a.humanLoss - b.humanLoss || b.rescued - a.rescued || a.eliminatedAI - b.eliminatedAI);
}

export async function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--seed', '--seeds', '--policies', '--maps', '--jobs', '--out', '--label', '--atlas', '--reference', '--cases'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid option ${argv[i]}`);
    opt[argv[i].slice(2)] = argv[i + 1];
  }
  const seed = Number(opt.seed || 11), count = Number(opt.seeds || 8), jobs = Number(opt.jobs || 8);
  const policies = (opt.policies || Object.keys(POLICIES).join(',')).split(',');
  const maps = opt.maps === 'all' ? SUPPORT_MAPS : opt.maps ? opt.maps.split(',') : null;
  if (!opt.out || !Number.isSafeInteger(seed) || seed < 1 || !Number.isInteger(count) || count < 1 || count > 1000
    || !Number.isInteger(jobs) || jobs < 1 || jobs > 32 || policies.some((p) => !POLICIES[p])
    || !policies.includes('baseline') || new Set(policies).size !== policies.length || maps?.some((m) => !SUPPORT_MAPS.includes(m))) throw new Error('Invalid policy search configuration');
  const tasks = [];
  for (let s = seed; s < seed + count; s++) for (const band of ['band_amiya', 'band_ioleta']) for (const stageId of maps || [SUPPORT_MAPS[(s - 1) % SUPPORT_MAPS.length]]) {
    tasks.push({ policies, config: { seed: s, humans: 2, band, rounds: 11, stageId,
      leakCount: 1 + (s - 1) % 3, sourceMode: Math.floor((s - 1) / 3) % 2 ? 'all' : 'single', atlasPath: opt.atlas ? resolve(opt.atlas) : null } });
  }
  if (opt.cases) {
    const cases = JSON.parse(readFileSync(resolve(opt.cases), 'utf8'));
    if (!Array.isArray(cases) || !cases.length) throw new Error('Empty case list');
    tasks.length = 0;
    const seen = new Set();
    for (const c of cases) {
      if (!Number.isSafeInteger(c.seed) || c.seed < 1 || !['band_amiya', 'band_ioleta'].includes(c.band)
        || !SUPPORT_MAPS.includes(c.stageId) || ![1, 2, 3].includes(c.leakCount) || !['single', 'all'].includes(c.sourceMode)) throw new Error('Invalid explicit case');
      const key = [c.seed, c.band, c.stageId, c.leakCount, c.sourceMode].join('|');
      if (seen.has(key)) throw new Error('Duplicate explicit case');
      seen.add(key);
      tasks.push({ policies, config: { seed: c.seed, band: c.band, stageId: c.stageId, leakCount: c.leakCount,
        sourceMode: c.sourceMode, humans: 2, rounds: 11, atlasPath: opt.atlas ? resolve(opt.atlas) : null } });
    }
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...args], { encoding: 'utf8' }).trim();
  const manifest = { schemaVersion: 2, fixedHumanFixtures: true, seed, count, jobs, policies, maps: maps || 'balanced', label: opt.label || 'development',
    gitHead: git('rev-parse', 'HEAD'), gitStatus: git('status', '--short'),
    sourceHash: hashTree(root, ['server', 'shared', 'tools/botbench', 'tools/botbench-policy-search.mjs']),
    dataHash: hashTree(root, ['data']), atlasHash: opt.atlas ? hashTree(dirname(resolve(opt.atlas)), [resolve(opt.atlas)]) : null,
    node: process.version, createdAt: new Date().toISOString() };
  const prefix = resolve(opt.out);
  if (opt.cases) manifest.explicitCases = tasks.map((t) => t.config);
  mkdirSync(dirname(prefix), { recursive: true });
  if (['.json', '.jsonl', '.source.json'].some((ext) => existsSync(prefix + ext))) throw new Error('Output already exists; use a new experiment name');
  if (opt.reference) {
    const reference = JSON.parse(readFileSync(resolve(opt.reference), 'utf8'));
    if (reference.manifest.dataHash !== manifest.dataHash || !reference.manifest.fixedHumanFixtures) throw new Error('Incompatible reference data or fixtures');
    const baselines = reference.results.filter((r) => r.policyId === 'baseline');
    for (const task of tasks) {
      const matches = baselines.filter((r) => ['seed', 'humans', 'band', 'stageId', 'leakCount', 'sourceMode'].every((k) => r[k] === task.config[k]) && r.targetRound === task.config.rounds);
      if (matches.length !== 1) throw new Error('Missing or duplicate reference baseline');
      task.referenceBaseline = matches[0];
    }
    manifest.reference = { file: resolve(opt.reference), sourceHash: reference.manifest.sourceHash,
      fileHash: hashTree(dirname(resolve(opt.reference)), [resolve(opt.reference)]) };
    manifest.reusedBaselineMatches = tasks.length;
  }
  manifest.newSimulationMatches = tasks.length * (policies.length - (opt.reference ? 1 : 0));
  if (policies.some((p) => POLICIES[p].build || POLICIES[p].atlas)) {
    if (!opt.atlas) throw new Error('Build policies require --atlas');
    const atlas = JSON.parse(readFileSync(resolve(opt.atlas), 'utf8'));
    if (atlas.manifest?.dataHash !== manifest.dataHash) throw new Error('Atlas data version differs; regenerate capabilities');
    if (policies.some((p) => ['sustain', 'resilient'].includes(POLICIES[p].build)) && !atlas.mapMedics) throw new Error('Policy requires map-medic probes');
  }
  manifest.sourceSnapshot = basename(prefix + '.source.json');
  saveSourceSnapshot(root, prefix + '.source.json', manifest);
  writeFileSync(`${prefix}.jsonl`, JSON.stringify({ manifest }) + '\n', { flag: 'wx' });
  const total = tasks.length * policies.length;
  const results = new Array(total), workers = [];
  let next = 0, done = 0;
  const started = performance.now();
  const recordOne = (index, result) => {
    results[index] = result; done++;
    appendFileSync(`${prefix}.jsonl`, JSON.stringify({ index, result }) + '\n');
    if (done % 8 === 0 || done === total) console.log(`[${done}/${total}] elapsed=${((performance.now() - started) / 1000).toFixed(1)}s`);
  };
  const record = (index, rs) => rs.forEach((r, i) => recordOne(index * policies.length + i, r));
  try {
    if (jobs === 1) tasks.forEach((t, i) => record(i, runPolicyCase(t)));
    else await new Promise((ok, fail) => {
      const dispatch = (w) => { if (next < tasks.length) { const index = next++; w.postMessage({ index, task: tasks[index] }); } };
      for (let i = 0; i < Math.min(jobs, tasks.length); i++) {
        const w = new Worker(new URL(import.meta.url), { workerData: { policySearch: true } });
        workers.push(w); w.on('error', fail);
        w.on('message', ({ index, results: rs, error }) => {
          if (error) { fail(new Error(error)); return; }
          record(index, rs); if (done === total) ok(); else dispatch(w);
        });
        w.on('exit', (code) => { if (code && done < total) fail(new Error(`Worker exited ${code}`)); });
        dispatch(w);
      }
    });
  } finally { await Promise.all(workers.map((w) => w.terminate())); }
  manifest.elapsedMs = performance.now() - started;
  const summary = aggregatePolicies(results);
  writeFileSync(`${prefix}.json`, JSON.stringify({ manifest, summary, results }));
  registerExperiment(`${prefix}.json`);
  console.log(JSON.stringify({ elapsedMs: manifest.elapsedMs, summary }));
}
if (isMainThread && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
