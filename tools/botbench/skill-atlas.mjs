// Small, reproducible skill pilot: existing shop operators with implemented silence.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { getData } from '../../server/data.js';
import { PROBES, probeUnit } from './combat-atlas.mjs';
import { hashTree } from '../botbench-support.mjs';
import { saveSourceSnapshot } from './experiment-store.mjs';

export const SILENCE_PILOT = ['chess_char_1_13_a', 'chess_char_2_16_a', 'chess_char_4_16_a', 'chess_char_6_18_a'];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2), prefix = resolve(output);
  for (const ext of ['.json', '.jsonl', '.source.json']) if (existsSync(prefix + ext)) throw new Error('Output exists');
  const root = fileURLToPath(new URL('../../', import.meta.url)), data = getData();
  const atlas = JSON.parse(readFileSync(input, 'utf8'));
  const dataHash = hashTree(root, ['data']);
  if (atlas.manifest.dataHash !== dataHash) throw new Error('Data mismatch');
  const manifest = { kind: 'skill-capability-probes', label: 'development', createdAt: new Date().toISOString(),
    gitHead: execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceHash: hashTree(root, ['server', 'shared', 'tools/botbench']), dataHash,
    parentAtlas: resolve(input), parentHash: hashTree(dirname(resolve(input)), [resolve(input)]), seeds: [17, 29],
    operators: SILENCE_PILOT, duration: 60, profiles: PROBES,
    limitations: 'Stationary targets, not coop effectiveness. Default modules; normal and elite measured separately. Only four existing silence operators; no defensive/on-hurt evaluation. Previous default entries remain unchanged.' };
  saveSourceSnapshot(root, prefix + '.source.json', manifest);
  writeFileSync(prefix + '.jsonl', JSON.stringify({ manifest }) + '\n', { flag: 'wx' });
  const skillVariants = {};
  let probes = 0;
  for (const baseId of SILENCE_PILOT) for (const id of [baseId, data.chess[baseId].goldenId].filter(Boolean)) {
    const c = data.chess[id]; skillVariants[id] = {};
    for (const skill of c.skills) {
      const profiles = {};
      for (const profile of Object.keys(PROBES)) {
        const rows = manifest.seeds.map((seed) => probeUnit(id, profile, { seed, skillIndex: skill.index }));
        for (const row of rows) { appendFileSync(prefix + '.jsonl', JSON.stringify(row) + '\n'); probes++; }
        profiles[profile] = Object.fromEntries(['dps20', 'dps60', 'hps', 'silenceUptime', 'maxPhysHit', 'defReduction', 'resReduction'].map((k) => [k, rows.reduce((n, r) => n + r[k], 0) / rows.length]));
      }
      skillVariants[id][skill.index] = { name: c.name, tier: c.tier, golden: c.isGolden, price: c.price,
        skillIndex: skill.index, skillName: skill.name, profiles };
    }
  }
  // Equipment ablation on the same real target; diagnostic, not free equipment in full matches.
  for (const id of ['chess_char_1_17_a', ...SILENCE_PILOT]) for (const items of [[], ['chess_item_3_08_e_a']]) {
    for (const seed of manifest.seeds) {
      const row = probeUnit(id, 'reflection', { seed, items });
      appendFileSync(prefix + '.jsonl', JSON.stringify({ ...row, items, diagnostic: 'equipment-ablation' }) + '\n'); probes++;
    }
  }
  const result = { ...atlas, manifest: { ...atlas.manifest, skillPilot: { ...manifest, probes } }, skillVariants };
  writeFileSync(prefix + '.json', JSON.stringify(result), { flag: 'wx' });
  appendFileSync(resolve(dirname(prefix), 'ai-experiment-index.jsonl'), JSON.stringify({ kind: manifest.kind,
    label: 'development', resultFile: prefix + '.json', journalFile: prefix + '.jsonl', sourceSnapshot: prefix + '.source.json',
    dataHash, sourceHash: manifest.sourceHash, probes, newSimulationMatches: 0, registeredAt: new Date().toISOString() }) + '\n');
  console.log(JSON.stringify({ probes, output: prefix + '.json' }));
}
