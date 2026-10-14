import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openingFixture, replayPlan } from './diagnose-ranged-block.mjs';
import { arrange, LayoutPlan } from '../../server/match/bot.js';
import { buildNormalWave } from '../../server/match/waves.js';
import { SUPPORT_MAPS } from './support-runner.mjs';
import { hashTree } from '../botbench-support.mjs';
import { saveSourceSnapshot } from './experiment-store.mjs';

const out = resolve(process.argv[2]);
if (['.json', '.jsonl', '.source.json'].some(ext => existsSync(out + ext))) throw new Error('Output exists');
const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = { label: 'development-mechanism-diagnostic', createdAt: new Date().toISOString(),
  gitHead: execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceHash: hashTree(root, ['server', 'shared', 'tools/botbench']), dataHash: hashTree(root, ['data']),
  sourceSnapshot: out + '.source.json', humans: 3, bots: 1, modeId: 'mode_multi_abyss',
  seeds: [1801, 1802], maps: SUPPORT_MAPS, humanLeakInputs: [],
  policies: ['baseline', 'ground', 'forward', 'combined'],
  scope: 'Injected Gummy, Insider and two Vendelas; R1 normal, R7 elite. No economy trajectory or human contribution. Seen seeds, not independent validation.' };
saveSourceSnapshot(root, manifest.sourceSnapshot, manifest);
const results = [];
for (const round of [1, 7]) for (const seed of manifest.seeds) for (const stageId of SUPPORT_MAPS) {
  for (const policy of manifest.policies) {
    const ids = ['1_10', '1_01', '1_06', '1_06'].map(id => `chess_char_${id}_${round === 1 ? 'a' : 'b'}`);
    const { m, ps, pieces } = openingFixture(stageId, seed, ids);
    try {
      if (round !== 1) {
        m.round = round;
        m.wave = buildNormalWave(m.gd, m.rngWaves, m.factions, round);
        m._botPath = null;
      }
      m.botGroundBlockCandidates = policy === 'combined';
      const variants = m.botLayoutVariants;
      if (policy === 'ground') m.botLayoutVariants = [variants[0], { rangedBlock: true, groundRangedCount: 1 },
        { rangedBlock: true, groundRangedCount: 2 }, ...variants.slice(1)];
      if (policy === 'forward') m.botLayoutVariants = [variants[0], { forwardRanged: true }, ...variants.slice(1)];
      const job = arrange(m, ps, { final: true, defer: true });
      job.run();
      const selected = replayPlan(m, ps, pieces, job.best);
      const fixedRight = new LayoutPlan(job.best); fixedRight.dirs = new Map(job.best.dirs);
      for (const p of pieces) if (ps.gd.chess(p.id).position === 'RANGED') fixedRight.dirs.set(p.uid, 'RIGHT');
      const turned = policy === 'baseline' ? replayPlan(m, ps, pieces, fixedRight) : null;
      const record = { round, seed, stageId, policy, ids, candidates: job.plans.map(p => ({ tiles: [...p], dirs: [...p.dirs] })), selected, turned };
      results.push(record);
      appendFileSync(out + '.jsonl', JSON.stringify(record) + '\n');
    } finally { m.dispose(); }
  }
}
const summary = manifest.policies.map(policy => {
  const rows = results.filter(r => r.policy === policy);
  return { policy, cases: rows.length, leaks: rows.reduce((n, r) => n + r.selected.leaks, 0),
    byRound: [1, 7].map(round => ({ round, leaks: rows.filter(r => r.round === round).reduce((n, r) => n + r.selected.leaks, 0) })) };
});
const turns = results.filter(r => r.turned);
const directionSummary = { better: turns.filter(r => r.turned.leaks < r.selected.leaks).length,
  worse: turns.filter(r => r.turned.leaks > r.selected.leaks).length, same: turns.filter(r => r.turned.leaks === r.selected.leaks).length };
writeFileSync(out + '.json', JSON.stringify({ manifest, results, summary, directionSummary }), { flag: 'wx' });
appendFileSync(resolve(root, '../logs/ai-experiment-index.jsonl'), JSON.stringify({ kind: 'mechanism-diagnostic', status: 'complete', resultFile: out + '.json', ...manifest,
  newSimulationMatches: 0, evaluatedBattles: results.length + turns.length, summary, directionSummary }) + '\n');
console.log(JSON.stringify({ summary, directionSummary }));
