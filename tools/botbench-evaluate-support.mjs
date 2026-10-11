import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { evaluateSupportCase, chooseCandidate } from './botbench/support-evaluator.mjs';
import { hashTree } from './botbench-support.mjs';

function evaluate(task) {
  const training = evaluateSupportCase(task);
  const selected = chooseCandidate(training.results);
  // Freeze the choice BEFORE evaluating the unseen seed. No held-out result affects selection.
  const heldout = evaluateSupportCase(task, { candidates: [...new Set(['baseline', selected])], trialSeeds: [303] });
  if (training.checkpoint !== heldout.checkpoint) throw new Error('Held-out prefix mismatch');
  return { task, selected, training, heldout };
}

if (!isMainThread && workerData?.supportEvaluation) {
  parentPort.on('message', ({ index, task }) => {
    try { parentPort.postMessage({ index, result: evaluate(task) }); }
    catch (e) { parentPort.postMessage({ index, error: e.stack }); }
  });
}

export function evaluationReport(results, manifest) {
  const groups = new Map();
  for (const r of results) {
    const key = r.task.stageId;
    const g = groups.get(key) || { n: 0, before: 0, after: 0, aiBefore: 0, aiAfter: 0, helpersBefore: 0, helpersAfter: 0, better: 0, worse: 0, choices: {} };
    const a = r.heldout.results.find((x) => x.candidate === 'baseline').metrics;
    const b = r.heldout.results.find((x) => x.candidate === r.selected).metrics;
    g.n++; g.before += a.humanLoss; g.after += b.humanLoss; g.aiBefore += a.aiLeaks; g.aiAfter += b.aiLeaks;
    g.helpersBefore += a.eligible; g.helpersAfter += b.eligible;
    g.better += b.humanLoss < a.humanLoss ? 1 : 0; g.worse += b.humanLoss > a.humanLoss ? 1 : 0;
    g.choices[r.selected] = (g.choices[r.selected] || 0) + 1;
    groups.set(key, g);
  }
  const summary = [...groups].map(([stageId, values]) => ({ stageId, ...values }));
  const markdown = ['# 第二阶段：2 真人 + 2 AI 候选评估', '',
    `代码：${manifest.gitHead}；数据指纹：${manifest.dataHash}。${results.length} 个休整期检查点。`, '',
    '全部采用四人终极模拟数值。每个候选独立重放前序回合，在同一个休整期结束前改动，再执行普通战斗、真实联防及结算。',
    '用 101、202 两个试演种子选方案，再用未参与选择的 303 种子验证。表中的扣血是两名真人本回合合计，漏怪是两名 AI 普通战斗合计。', '',
    '| 地图 | 检查点 | 真人扣血：原→选 | AI 漏怪：原→选 | 可协防 AI 次数：原→选 | 真人少扣血 / 多扣血局面 |',
    '|---|---:|---:|---:|---:|---:|',
    ...summary.map((g) => `| ${g.stageId} | ${g.n} | ${g.before} → ${g.after} | ${g.aiBefore} → ${g.aiAfter} | ${g.helpersBefore} → ${g.helpersAfter} | ${g.better} / ${g.worse} |`), '',
    '限制：真人为固定少量漏怪输入；不会购买或与 AI 竞争卡池。仅改目标回合，前序回合仍为原 AI。治疗候选只使用已拥有的整备区医疗，不凭空发卡；暂不规划提前购买医疗。地形评分没有穷举技能、盟约增益与所有索敌特例，最终以实际战斗为准。', '',
    '候选搜索仍是离线工具，未接入线上 AI。重放检查点包含前序整局开销，不能将批处理吞吐当作单次在线决策耗时。', '',
  ].join('\n');
  return { summary, markdown };
}

export async function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--seeds', '--rounds', '--bands', '--jobs', '--out'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid option ${argv[i]}`);
    opt[argv[i].slice(2)] = argv[i + 1];
  }
  const seeds = (opt.seeds || '1,2,3,4').split(',').map(Number), rounds = (opt.rounds || '4,7').split(',').map(Number);
  const bands = (opt.bands || 'band_amiya,band_ioleta').split(',');
  const jobs = Number(opt.jobs || 4);
  if (!opt.out || !Number.isInteger(jobs) || jobs < 1 || jobs > 32
    || seeds.some((v) => !Number.isSafeInteger(v) || v < 1 || v > 1e9)
    || rounds.some((v) => !Number.isInteger(v) || v < 1 || v > 11)
    || bands.some((b) => !['band_amiya', 'band_ioleta'].includes(b))) throw new Error('Invalid evaluation configuration');
  const tasks = [];
  for (const band of bands) for (const seed of seeds) for (const roundsToRun of rounds) for (const stageId of ['act1autochess_m04', 'act2autochess_m03']) {
    tasks.push({ seed, humans: 2, rounds: roundsToRun, band, stageId, rehearsal: 3,
      leakCount: 1 + (seed - 1) % 3, sourceMode: Math.floor((seed - 1) / 3) % 2 ? 'all' : 'single' });
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...args], { encoding: 'utf8' }).trim();
  const manifest = { schemaVersion: 1, seeds, rounds, bands, jobs, gitHead: git('rev-parse', 'HEAD'), gitStatus: git('status', '--short'),
    sourceHash: hashTree(root, ['server', 'shared', 'tools/botbench', 'tools/botbench-support.mjs', 'tools/botbench-evaluate-support.mjs']),
    dataHash: hashTree(root, ['data']), node: process.version, createdAt: new Date().toISOString(),
    trialSeeds: [101, 202], heldoutSeed: 303, checkpoint: 'independent-full-prefix-replay' };
  const prefix = resolve(opt.out);
  mkdirSync(dirname(prefix), { recursive: true });
  writeFileSync(`${prefix}.jsonl`, JSON.stringify({ manifest }) + '\n', { flag: 'wx' });
  const results = new Array(tasks.length), workers = [];
  let next = 0, done = 0;
  const start = performance.now();
  const record = (index, result) => {
    results[index] = result; done++;
    appendFileSync(`${prefix}.jsonl`, JSON.stringify({ index, result }) + '\n');
    console.log(`[${done}/${tasks.length}] ${result.task.band} seed=${result.task.seed} r${result.task.rounds} ${result.task.stageId} selected=${result.selected}`);
  };
  try {
    if (jobs === 1) tasks.forEach((t, i) => record(i, evaluate(t)));
    else await new Promise((ok, fail) => {
      const dispatch = (w) => { if (next < tasks.length) { const index = next++; w.postMessage({ index, task: tasks[index] }); } };
      for (let i = 0; i < Math.min(jobs, tasks.length); i++) {
        const w = new Worker(new URL(import.meta.url), { workerData: { supportEvaluation: true } });
        workers.push(w); w.on('error', fail);
        w.on('message', ({ index, result, error }) => {
          if (error) { fail(new Error(error)); return; }
          record(index, result);
          if (done === tasks.length) ok(); else dispatch(w);
        });
        w.on('exit', (code) => { if (code && done < tasks.length) fail(new Error(`Worker exited ${code}`)); });
        dispatch(w);
      }
    });
  } finally { await Promise.all(workers.map((w) => w.terminate())); }
  manifest.elapsedMs = performance.now() - start;
  const { summary, markdown } = evaluationReport(results, manifest);
  writeFileSync(`${prefix}.json`, JSON.stringify({ manifest, summary, results }));
  writeFileSync(`${prefix}.md`, markdown);
  console.log(JSON.stringify({ elapsedMs: manifest.elapsedMs, summary }));
}

if (isMainThread && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
