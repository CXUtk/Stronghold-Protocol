// Fixed first-wave diagnostics; this does not measure a full-match policy's win rate.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch, give } from '../../test/match/harness.js';
import { arrange, planLayout, finishBotPreparation } from '../../server/match/bot.js';
import { configureIndividualBot } from '../../server/match/bot-individual.js';
import { projectNormalBattleOptions } from '../../server/match/bot-prep-projection.js';
import { SUPPORT_MAPS } from './support-runner.mjs';
import { hashTree } from '../botbench-support.mjs';
import { saveSourceSnapshot } from './experiment-store.mjs';

export function openingFixture(stageId, seed = 1801, ids = ['chess_char_1_06_a', 'chess_char_1_06_a']) {
  const h = makeMatch({ humans: 4, difficulty: 'ABYSS', seed, botRehearsal: 8 }).start().toPrep();
  h.setStage(stageId);
  const m = h.m, ps = m.order[0];
  ps.isBot = true;
  configureIndividualBot(m, 'terrain-parity-v12', 8);
  const pieces = ids.map(id => give(m, ps, id));
  return { h, m, ps, pieces };
}

export function replayPlan(m, ps, pieces, plan) {
  const opts = projectNormalBattleOptions(m, ps, (trial, player, clone) => {
    for (const piece of pieces) {
      const [row, col] = plan.get(piece.uid).split(',').map(Number);
      const result = player.move(clone(piece).uid, { area: 'board', row, col }, plan.dirs.get(piece.uid));
      if (!result?.ok) throw new Error(`Illegal diagnostic move: ${JSON.stringify(result)}`);
    }
    finishBotPreparation(trial, player);
  }, { deadline: true });
  const b = m.newBattle(opts);
  let blocks = 0;
  b.on('blocked', () => blocks++);
  for (let tick = 0; !b.finished && tick < 12000; tick++) b.step();
  if (!b.finished) throw new Error('Diagnostic battle exceeded cap');
  const result = b.result();
  return { plan: [...plan], directions: [...plan.dirs], input: opts, result, blocks,
    leaks: result.perPlayer[ps.playerId].leaked.filter(x => x.counted !== false).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2]);
  if (['.json', '.jsonl', '.source.json'].some(ext => existsSync(out + ext))) throw new Error('Output exists');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const manifest = { label: 'development-mechanism-diagnostic', createdAt: new Date().toISOString(),
    gitHead: execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceHash: hashTree(root, ['server', 'shared', 'tools/botbench']), dataHash: hashTree(root, ['data']),
    sourceSnapshot: out + '.source.json', humans: 3, bots: 1, modeId: 'mode_multi_abyss', round: 1,
    seeds: [1801, 1802], maps: SUPPORT_MAPS, humanLeakInputs: [],
    scope: 'Injected two normal Vendelas; normal battle only, no human contribution or coop simulation; already-seen seeds.' };
  saveSourceSnapshot(root, manifest.sourceSnapshot, manifest);
  const results = [];
  for (const seed of manifest.seeds) for (const stageId of SUPPORT_MAPS) {
    const { m, ps, pieces } = openingFixture(stageId, seed);
    try {
      const job = arrange(m, ps, { final: true, defer: true });
      job.run();
      const current = replayPlan(m, ps, pieces, job.best);
      // A legal diagnostic alternative: only use the existing ground tiles, without changing actual terrain.
      const deployMap = ps.deployMap;
      let ground;
      try {
        ps.deployMap = () => new Map([...deployMap.call(ps)].filter(([, cls]) => cls === 'melee'));
        ground = planLayout(m, ps, pieces);
      } finally { ps.deployMap = deployMap; }
      const alternative = replayPlan(m, ps, pieces, ground);
      const record = { seed, stageId, candidates: job.plans.map(p => ({ tiles: [...p], dirs: [...p.dirs] })), current, alternative };
      results.push(record);
      appendFileSync(out + '.jsonl', JSON.stringify(record) + '\n');
      console.log(JSON.stringify({ seed, stageId, current: current.leaks, ground: alternative.leaks, blocks: [current.blocks, alternative.blocks] }));
    } finally { m.dispose(); }
  }
  const summary = { cases: results.length, currentLeaks: results.reduce((n, r) => n + r.current.leaks, 0), groundLeaks: results.reduce((n, r) => n + r.alternative.leaks, 0) };
  writeFileSync(out + '.json', JSON.stringify({ manifest, results, summary }), { flag: 'wx' });
  appendFileSync(resolve(root, '../logs/ai-experiment-index.jsonl'), JSON.stringify({ kind: 'mechanism-diagnostic', status: 'complete', resultFile: out + '.json', ...manifest,
    newSimulationMatches: 0, evaluatedBattles: results.length * 2, rehearsalBattles: 'included in diagnostic candidate selection', summary }) + '\n');
  console.log(JSON.stringify(summary));
}
