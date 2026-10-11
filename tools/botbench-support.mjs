import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runSupportMatch, SUPPORT_MAPS } from './botbench/support-runner.mjs';
import { ANCHOR_BANDS, FIXTURE_VERSION } from './botbench/support-fixture.mjs';
import { supportReport, summarize } from './botbench/support-report.mjs';

if (!isMainThread && workerData?.support) {
  parentPort.on('message', ({ index, task }) => {
    try { parentPort.postMessage({ index, result: runSupportMatch(task) }); }
    catch (err) { parentPort.postMessage({ index, error: err.stack || String(err) }); }
  });
}

export function parseSupportArgs(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--support') continue;
    const k = argv[i].replace(/^--/, '');
    if (!['seeds', 'seed', 'humans', 'bands', 'rounds', 'rehearsal', 'jobs', 'out', 'scenario', 'maps'].includes(k)) throw new Error(`Unknown option ${argv[i]}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${argv[i]}`);
    opt[k] = argv[++i];
  }
  const integer = (k, def, lo, hi) => {
    const n = Number(opt[k] ?? def);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`Invalid ${k}: ${n}`);
    return n;
  };
  const config = { seeds: integer('seeds', 30, 1, 10000), seed: integer('seed', 1, 1, 1e9),
    rounds: integer('rounds', 11, 1, 11), rehearsal: integer('rehearsal', 3, 0, 8), jobs: integer('jobs', 1, 1, 32),
    humans: (opt.humans || '1,2,3').split(',').map(Number), bands: (opt.bands || ANCHOR_BANDS.join(',')).split(','), out: opt.out, scenario: opt.scenario || 'small',
    maps: opt.maps === 'all' ? [...SUPPORT_MAPS] : opt.maps ? opt.maps.split(',') : null,
  };
  if (!config.humans.length || config.humans.some((n) => ![1, 2, 3].includes(n)) || new Set(config.humans).size !== config.humans.length) throw new Error('Invalid humans');
  if (!config.bands.length || config.bands.some((n) => !ANCHOR_BANDS.includes(n)) || new Set(config.bands).size !== config.bands.length) throw new Error('Invalid bands');
  if (!config.out) throw new Error('--out is required (file prefix for JSON, JSONL and Markdown)');
  if (!['small', 'pressure'].includes(config.scenario)) throw new Error('scenario must be small or pressure');
  if (config.maps && (config.maps.some((id) => !SUPPORT_MAPS.includes(id)) || new Set(config.maps).size !== config.maps.length)) throw new Error('Invalid maps');
  return config;
}

export function hashTree(root, dirs) {
  const hash = createHash('sha256');
  const visit = (p) => {
    if (statSync(p).isFile()) { hash.update(relative(root, p).replaceAll('\\', '/')); hash.update('\0'); hash.update(readFileSync(p)); hash.update('\0'); return; }
    for (const ent of readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = resolve(p, ent.name);
      if (ent.isDirectory()) visit(file);
      else { hash.update(relative(root, file).replaceAll('\\', '/')); hash.update('\0'); hash.update(readFileSync(file)); hash.update('\0'); }
    }
  };
  dirs.forEach((dir) => visit(resolve(root, dir)));
  return hash.digest('hex');
}

export async function runSupportCLI(argv) {
  const config = parseSupportArgs(argv);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const prefix = resolve(config.out);
  mkdirSync(dirname(prefix), { recursive: true });
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...args], { encoding: 'utf8' }).trim();
  const manifest = { schemaVersion: 3, fixtureVersion: FIXTURE_VERSION, ...config,
    gitHead: git('rev-parse', 'HEAD'), gitStatus: git('status', '--short'),
    sourceHash: hashTree(root, ['server', 'shared', 'tools/botbench', 'tools/botbench.mjs', 'tools/botbench-support.mjs']), dataHash: hashTree(root, ['data']),
    node: process.version, createdAt: new Date().toISOString(), mapAssignment: config.maps ? 'crossed-with-seeds' : 'balanced-by-absolute-seed',
  };
  const tasks = [];
  for (const band of config.bands) for (const humans of config.humans) for (let i = 0; i < config.seeds; i++) {
    const fixtureIndex = config.seed + i - 1;
    for (const stageId of config.maps || [SUPPORT_MAPS[fixtureIndex % SUPPORT_MAPS.length]]) tasks.push({ seed: config.seed + i, humans, band, rounds: config.rounds, rehearsal: config.rehearsal,
      stageId, scenario: config.scenario,
      leakCount: config.scenario === 'small' ? 1 + (fixtureIndex % 3) : [5, 10][fixtureIndex % 2], sourceMode: Math.floor(fixtureIndex / 3) % 2 ? 'all' : 'single' });
  }
  writeFileSync(`${prefix}.jsonl`, `${JSON.stringify({ manifest })}\n`, { flag: 'wx' });
  const results = new Array(tasks.length);
  const workers = [];
  let next = 0, done = 0;
  const record = (index, result) => {
    results[index] = result;
    done++;
    appendFileSync(`${prefix}.jsonl`, `${JSON.stringify({ index, result })}\n`);
    console.log(`[${done}/${tasks.length}] ${result.band} H${result.humans} seed=${result.seed} ${result.stopReason} round=${result.rounds.at(-1)?.round} humans=${result.survivingHumans}/${result.humans} ${(result.elapsedMs / 1000).toFixed(2)}s`);
  };
  try {
    if (config.jobs === 1) {
      tasks.forEach((task, index) => record(index, runSupportMatch(task)));
    } else {
      await new Promise((resolveDone, reject) => {
        for (let i = 0; i < Math.min(config.jobs, tasks.length); i++) {
          const worker = new Worker(new URL(import.meta.url), { workerData: { support: true } });
          workers.push(worker);
          const assign = () => { if (next < tasks.length) { const index = next++; worker.postMessage({ index, task: tasks[index] }); } };
          worker.on('message', ({ index, result, error }) => {
            if (error) { reject(new Error(`Task ${index}: ${error}`)); return; }
            try { record(index, result); } catch (err) { reject(err); return; }
            if (done === tasks.length) resolveDone(); else assign();
          });
          worker.on('error', reject);
          worker.on('exit', (code) => { if (done < tasks.length) reject(new Error(`Worker exited early (${code})`)); });
          assign();
        }
      });
    }
    writeFileSync(`${prefix}.json`, JSON.stringify({ manifest, summary: summarize(results), runs: results }, null, 2));
    writeFileSync(`${prefix}.md`, supportReport(manifest, results));
    console.log(`Report: ${prefix}.md`);
  } finally { await Promise.all(workers.map((w) => w.terminate())); }
}
