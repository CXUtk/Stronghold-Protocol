// Break down paired multiplayer fixtures by stage, round, faction and scheduled enemy exposure.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const ownCount = (p, prefix) => sum(Object.entries(p.leakGroups).filter(([k]) => k.startsWith(prefix)).map(([, n]) => n));
const percentage = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : '—';

export function breakdown(rows, expectedSlots = rows.length * 2) {
  const ai = rows.flatMap((r) => r.players.filter((p) => p.isBot));
  const humans = rows.flatMap((r) => r.players.filter((p) => !p.isBot && p.weak));
  const help = rows.filter((r) => r.uniteRan).flatMap((r) => r.players.filter((p) => !p.isBot && p.weak));
  return { rounds: rows.length, aiBattles: ai.length, expectedSlots,
    aiPerfect: ai.filter((p) => p.ownPerfect).length,
    baseLeaks: sum(ai.map((p) => ownCount(p, 'wave:'))), bountyLeaks: sum(ai.map((p) => ownCount(p, 'bounty:'))),
    weak: humans.length, noHelp: humans.length - help.length,
    zeroLoss: humans.filter((p) => p.weakZeroLoss).length,
    helped: help.length, helpedZero: help.filter((p) => p.weakZeroLoss).length,
    humanLoss: sum(humans.map((p) => p.actualLoss)),
    seeds: new Set(rows.map((r) => r.seed)).size,
  };
}

export function analyzeSupport(data) {
  const runs = data.runs.filter((r) => r.humans === 2);
  if (!runs.length) throw new Error('No two-human records');
  if (data.manifest.mapAssignment !== 'crossed-with-seeds') throw new Error('Map comparison requires --maps paired fixtures');
  const configuredMaps = data.manifest.maps;
  const caseMaps = new Map();
  for (const r of runs) {
    const key = `${r.band}:${r.seed}`;
    if (!caseMaps.has(key)) caseMaps.set(key, new Set());
    if (caseMaps.get(key).has(r.stageId)) throw new Error(`Duplicate map case: ${key}:${r.stageId}`);
    caseMaps.get(key).add(r.stageId);
  }
  for (const group of caseMaps.values()) if (group.size !== configuredMaps.length || configuredMaps.some((id) => !group.has(id))) throw new Error('Incomplete paired maps');
  const gd = new GameData(getData(), 'mode_multi_abyss');
  const paired = new Map();
  for (const m of runs) {
    if (m.modeId !== 'mode_multi_abyss' || m.seats.length !== 4 || m.seats.filter((s) => s.isBot).length !== 2) throw new Error('Wrong difficulty or room size');
    for (const r of m.rounds) {
      if (JSON.stringify(r.wave.enemyScale) !== JSON.stringify(gd.enemyScale(r.round))) throw new Error('Wrong enemy scale');
      const key = `${m.band}:${m.seed}:${r.round}`;
      const pick = JSON.stringify(r.wave.pick);
      if (paired.has(key) && paired.get(key) !== pick) throw new Error(`Unpaired enemy composition: ${key}`);
      paired.set(key, pick);
    }
  }
  const rows = runs.flatMap((m) => m.rounds.map((r) => ({ ...r, seed: m.seed, stageId: m.stageId, band: m.band })));
  const stages = [...new Set(runs.map((r) => r.stageId))].map((id) => {
    const matches = runs.filter((r) => r.stageId === id);
    return { id, name: gd.stage(id)?.name || id, matches: matches.length,
      aiEliminated: sum(matches.map((r) => r.players.filter((p) => p.isBot && !p.alive).length)),
      ...breakdown(rows.filter((r) => r.stageId === id), matches.length * data.manifest.rounds * 2) };
  }).sort((a, b) => b.baseLeaks / b.aiBattles - a.baseLeaks / a.aiBattles);
  const types = [...new Set(rows.map((r) => r.wave.pick?.type || 'unknown'))].map((id) => {
    const rr = rows.filter((r) => (r.wave.pick?.type || 'unknown') === id);
    return { id, name: gd.factions.types[id]?.name || id, ...breakdown(rr),
      early: breakdown(rr.filter((r) => r.round <= 7)), late: breakdown(rr.filter((r) => r.round >= 8)) };
  }).sort((a, b) => b.baseLeaks / b.aiBattles - a.baseLeaks / a.aiBattles);
  const rounds = Array.from({ length: data.manifest.rounds }, (_, i) => ({ round: i + 1,
    ...breakdown(rows.filter((r) => r.round === i + 1), runs.length * 2) }));
  const enemies = new Map();
  for (const r of rows) for (const p of r.players.filter((p) => p.isBot)) {
    const keys = new Set([...Object.keys(p.scheduledGroups), ...Object.keys(p.leakGroups)]);
    for (const key of keys) {
      if (!key.startsWith('wave:')) continue;
      const id = key.slice(5);
      if (!enemies.has(id)) enemies.set(id, { id, name: gd.enemy(id)?.name || id, scheduledBattles: 0,
        leakingScheduledBattles: 0, scheduledInstances: 0, leaks: 0, leaksWithoutSchedule: 0, seeds: new Set() });
      const e = enemies.get(id), leaked = p.leakGroups[key] || 0, count = p.scheduledGroups[key] || 0;
      e.leaks += leaked;
      if (count) { e.scheduledBattles++; e.scheduledInstances += count; e.seeds.add(r.seed); if (leaked) e.leakingScheduledBattles++; }
      else e.leaksWithoutSchedule += leaked;
    }
  }
  const enemyList = [...enemies.values()].map((e) => ({ ...e, seeds: e.seeds.size })).sort((a, b) => b.leaks - a.leaks);
  return { mode: 'mode_multi_abyss', seats: 4, humans: 2, bots: 2, matches: runs.length,
    summary: breakdown(rows, runs.length * data.manifest.rounds * 2), stages, types, rounds, enemies: enemyList,
    scale: Array.from({ length: 11 }, (_, i) => ({ round: i + 1, ...gd.enemyScale(i + 1) })),
  };
}

export function analysisMarkdown(a) {
  const avg = (n, d) => d ? (n / d).toFixed(2) : '—';
  const out = ['# 2 真人 + 2 AI：地图与出怪分析', '',
    `${a.matches} 局，四席，多人终极模拟 mode_multi_abyss，1～11 波。每个种子、固定 AI 策略在 ${a.stages.length} 张地图上交叉运行；已核对不同地图的当波敌人组合完全一致。`, '',
    'AI 本场按完整波次和自身悬赏真实战斗，只有真人来源输入限制为每名漏怪者 1～3 只。不会减少 AI 本场敌人数量或把怪物改成单人属性。真人无购物／协防火力，故不涵盖真人占用卡池的影响。', '',
    '## 地图', '',
    '| 地图 | 局数 | AI 每场普通来源漏怪 | AI 每场悬赏漏怪 | AI 清场率* | AI 淘汰数 | 真人漏怪时无协防 | 真人零扣血 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const s of a.stages) out.push(`| ${s.name} | ${s.matches} | ${avg(s.baseLeaks, s.aiBattles)} | ${avg(s.bountyLeaks, s.aiBattles)} | ${percentage(s.aiPerfect, s.expectedSlots)} | ${s.aiEliminated}/${s.matches * 2} | ${percentage(s.noHelp, s.weak)} | ${percentage(s.zeroLoss, s.weak)} |`);
  out.push('', '*清场率以开局两名 AI × 全部考核波次为分母，淘汰后按无法清场计；每场漏怪数只对实际参加的 AI 本场战斗求均值。这样不会把提前淘汰少打回合当作高性能。', '',
    '## 出怪类型', '', '| 类型 | 不同种子 | AI 实战场数 | 每场普通来源漏怪 | 1～7 波每场漏怪 | 8～11 波每场漏怪 | 真人漏怪时无协防 | 后期有协防时零扣血 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const t of a.types) out.push(`| ${t.name} | ${t.seeds} | ${t.aiBattles} | ${avg(t.baseLeaks, t.aiBattles)} | ${avg(t.early.baseLeaks, t.early.aiBattles)} | ${avg(t.late.baseLeaks, t.late.aiBattles)} | ${percentage(t.noHelp, t.weak)} | ${t.late.helpedZero}/${t.late.helped}，${percentage(t.late.helpedZero, t.late.helped)} |`);
  out.push('', '类型排名是该批种子和实际遭遇波次下的描述统计。类型分布、敌人个体、地图状态及发育互相影响；七张图复用的同一随机种子不是七个独立样本，不能用总场数冒充独立样本数，也不能将不同波次类型平均值直接当作机制强弱。', '',
    '## 具体漏怪（普通波次来源，含其衍生单位；不计悬赏）', '',
    '| 敌人 | 漏怪总数 | 计划出现的 AI 场数 | 其中出现漏怪的场数 | 不同种子 | 无该敌人主生成记录的漏怪数 |',
    '| --- | --- | --- | --- | --- | --- |');
  for (const e of a.enemies.slice(0, 18)) out.push(`| ${e.name} | ${e.leaks} | ${e.scheduledBattles} | ${e.leakingScheduledBattles} | ${e.seeds} | ${e.leaksWithoutSchedule} |`);
  out.push('', '“计划出现”来自本场实际生成配置，不包括后续召唤／分裂；怪物总数不能直接除以该分母算逃脱概率。总漏怪排序也受出场数量影响，应结合遭遇场数和具体机制检查。最后一列用于识别次数怪、召唤物等衍生来源，不混称主怪逃脱。', '',
    '## 逐波', '', '| 波次 | AI 每场普通来源漏怪 | AI 每场悬赏漏怪 | AI 清场率* | 真人漏怪时无协防 | 真人零扣血 |', '| --- | --- | --- | --- | --- | --- |');
  for (const r of a.rounds) out.push(`| ${r.round} | ${avg(r.baseLeaks, r.aiBattles)} | ${avg(r.bountyLeaks, r.aiBattles)} | ${percentage(r.aiPerfect, r.expectedSlots)} | ${percentage(r.noHelp, r.weak)} | ${percentage(r.zeroLoss, r.weak)} |`);
  out.push('', '## 多人终极属性核对', '', '| 波次 | 生命倍率 | 攻击倍率 | 移速倍率 |', '| --- | --- | --- | --- |');
  for (const s of a.scale) out.push(`| ${s.round} | ${s.hpMul} | ${s.atkMul} | ${s.speedMul} |`);
  out.push('', '倍率相对敌人基础数据，另有模板覆盖和机制特例。次数怪沿用正式排除部分生命加成的规则，不强制套普通怪生命倍率。前 11 波均为普通波，领袖共享生命按存活人数计算的规则不在本次范围。', '');
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node tools/botbench/analyze-support.mjs INPUT.json OUTPUT_PREFIX');
  const a = analyzeSupport(JSON.parse(readFileSync(input, 'utf8')));
  writeFileSync(`${output}.json`, JSON.stringify(a, null, 2));
  writeFileSync(`${output}.md`, analysisMarkdown(a));
  console.log(JSON.stringify({ matches: a.matches, stages: a.stages, types: a.types }, null, 2));
}
