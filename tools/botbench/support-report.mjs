export const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
export function percentile(xs, p) {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
}
export function summarize(runs) {
  const rows = runs.flatMap((m) => m.rounds.flatMap((r) => r.players));
  const humans = rows.filter((p) => !p.isBot);
  const ai = rows.filter((p) => p.isBot);
  const weak = humans.filter((p) => p.weak);
  const critical = humans.filter((p) => p.criticalAtLoss);
  const prep = runs.flatMap((m) => m.preps);
  const losses = runs.map((m) => m.players.filter((p) => !p.isBot).reduce((n, p) => n + p.lpLost, 0));
  const rescued = humans.filter((p) => p.criticalRescue).length;
  return {
    matches: runs.length, allSurvived: runs.filter((m) => m.allHumansSurvived).length,
    humans: runs.reduce((n, m) => n + m.humans, 0), survivingHumans: runs.reduce((n, m) => n + m.survivingHumans, 0),
    meanHumanLoss: mean(losses),
    // Early deaths are explicitly counted separately; shorter failed matches are not ranked as improvements.
    failedMatches: runs.filter((m) => !m.allHumansSurvived).length,
    worstDecileLoss: mean([...losses].sort((a, b) => b - a).slice(0, Math.ceil(losses.length * 0.1))),
    weakRounds: weak.length, weakZeroLoss: weak.filter((p) => p.weakZeroLoss).length,
    criticalRounds: critical.length, criticalRescues: rescued,
    aiRounds: ai.length, aiPerfect: ai.filter((p) => p.ownPerfect).length, aiSelected: ai.filter((p) => p.helper).length,
    humanSurvivors: humans.reduce((n, p) => n + p.remaining, 0),
    avoidedLP: humans.reduce((n, p) => n + p.avoidedLP, 0),
    prepMsP50: percentile(prep.map((p) => p.ms), 0.5), prepMsP95: percentile(prep.map((p) => p.ms), 0.95),
    prepCpuP95: percentile(prep.map((p) => p.cpuMs).filter((n) => n != null), 0.95),
    rehearsalMsP95: percentile(prep.map((p) => p.rehearsalMs), 0.95),
    matchMsP50: percentile(runs.map((m) => m.elapsedMs), 0.5), matchMsP95: percentile(runs.map((m) => m.elapsedMs), 0.95),
  };
}

const num = (n) => n == null ? '—' : n.toFixed(1);
const rate = (n, d) => d ? `${n}/${d} (${(100 * n / d).toFixed(1)}%)` : '—';

export function supportReport(manifest, runs) {
  const out = ['# AI 协防第一阶段基线', '',
    `目标：终极模拟，第 1～${manifest.rounds} 波（含最后一波结算）。AI 正常发育并运行真实战斗，真人来源的漏怪由受控场景提供。`, '',
    `代码基准：\`${manifest.gitHead}\`；工作树指纹：\`${manifest.sourceHash}\`；数据指纹：\`${manifest.dataHash}\`。`,
    `Node ${manifest.node}；并行数 ${manifest.jobs}；场景版本 ${manifest.fixtureVersion}；AI 预演数 ${manifest.rehearsal}；场景 ${manifest.scenario}。`, '',
    `固定策略指第一名选策略的 AI；其他 AI 正常选取。真人不选这两种策略，所有席位仍遵守策略不可重复规则。地图${manifest.maps ? '与同一组种子交叉测试' : '按样本序号轮换'}，不代表自然抽图分布。`, '',
    '主基线 small 每名漏怪者每波 1～3 只；pressure 为 5 或 10 只的独立压力组。轮换单人漏怪与多人同时漏怪，不能把组间样本比例当作真实发生概率。每波都施加输入，用于检查持续兜底能力。', '',
    '不模拟真人买卖、贪层或摆放。测试席位不消耗商店库存、不提供协防火力；在正常战斗完成后，只替换这些席位的漏怪结果，取当波真实敌人的实际漏怪实例（保留属性修正，不重复制造实例），按敌人类型轮换抽样。其余假定已被真人处理。AI 自身战斗、悬赏、协防资格、携带状态、联防和扣血走真实流程。该夹具会改变真人结果与协防资格，不能当作自然整局胜率或真实卡池竞争评估。', '',
    '## 主表', '',
    '| 固定策略 | 真人 / AI | 全部真人存活 | 真人个体存活 | 每局真人总扣血 | 弱势回合零扣血 | 危急回合获救* | AI 清场 | AI 入选 / 清场 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const band of manifest.bands) for (const humans of manifest.humans) {
    const s = summarize(runs.filter((r) => r.band === band && r.humans === humans));
    out.push(`| ${band === 'band_amiya' ? '阿米娅' : '罗素'} | ${humans} / ${4 - humans} | ${rate(s.allSurvived, s.matches)} | ${rate(s.survivingHumans, s.humans)} | ${num(s.meanHumanLoss)} | ${rate(s.weakZeroLoss, s.weakRounds)} | ${rate(s.criticalRescues, s.criticalRounds)} | ${rate(s.aiPerfect, s.aiRounds)} | ${rate(s.aiSelected, s.aiPerfect)} |`);
  }
  out.push('', '*危急回合参照只做同一本场结果的扣血算术：无协防扣血 ≥ 扣血前生命，实际协防后仍存活。未重放结算触发效果和后续对局，不能当作严格的因果救援率。本组受控场景不提供真人协防火力。', '',
    '## 按漏怪量与来源分组', '', '| 每名漏怪者只数 | 来源 | 对局 | 漏怪人次零扣血 | 全部真人存活 |', '| --- | --- | --- | --- | --- |');
  for (const count of [...new Set(runs.map((r) => r.leakCount))].sort((a, b) => a - b)) for (const source of ['single', 'all']) {
    const subset = runs.filter((r) => r.leakCount === count && r.sourceMode === source);
    if (!subset.length) continue;
    const x = summarize(subset);
    out.push(`| ${count} | ${source === 'single' ? '轮换单人' : '所有存活真人'} | ${x.matches} | ${rate(x.weakZeroLoss, x.weakRounds)} | ${rate(x.allSurvived, x.matches)} |`);
  }
  out.push('', '## 逐地图', '', '| 地图 | 对局 | 全部真人存活 | 每局真人总扣血 |', '| --- | --- | --- | --- |');
  for (const stage of [...new Set(runs.map((r) => r.stageId))].sort()) {
    const s = summarize(runs.filter((r) => r.stageId === stage));
    out.push(`| ${stage} | ${s.matches} | ${rate(s.allSurvived, s.matches)} | ${num(s.meanHumanLoss)} |`);
  }
  out.push('', '## 逐回合的救援瓶颈', '', '| 波次 | 真人漏怪人次 | 无协防者 | 仅真人协防 | AI 参与协防 | 协防后仍扣血人次 |', '| --- | --- | --- | --- | --- | --- |');
  for (let round = 1; round <= manifest.rounds; round++) {
    let weak = 0, none = 0, humanOnly = 0, ai = 0, lost = 0;
    for (const r of runs.flatMap((m) => m.rounds).filter((r) => r.round === round)) {
      const n = r.players.filter((p) => !p.isBot && p.weak).length;
      weak += n;
      if (!r.uniteRan) none += n;
      else if (r.players.some((p) => p.isBot && p.helper)) ai += n;
      else humanOnly += n;
      if (r.uniteRan) lost += r.players.filter((p) => !p.isBot && p.weak && p.actualLoss > 0).length;
    }
    out.push(`| ${round} | ${weak} | ${none} | ${humanOnly} | ${ai} | ${lost} |`);
  }
  const s = summarize(runs);
  out.push('', '## 成本与参照', '',
    `AI 单次整备：墙钟 p50 ${num(s.prepMsP50)} ms，p95 ${num(s.prepMsP95)} ms；线程 CPU p95 ${num(s.prepCpuP95)} ms；战斗预演 step 墙钟 p95 ${num(s.rehearsalMsP95)} ms。`,
    `单局墙钟 p50 ${num(s.matchMsP50)} ms，p95 ${num(s.matchMsP95)} ms。并行时墙钟受竞争影响；这些是虚拟时间离线成本，不是线上事件循环延迟，也不包含网络延迟。`,
    `失败对局 ${s.failedMatches}/${s.matches}；扣血最多 10% 对局的真人总扣血均值 ${num(s.worstDecileLoss)}。必须先比较存活，不能用提前淘汰少打回合来降低平均扣血。`,
    `同一本场结果的无协防扣血参照减实际扣血，累计差值 ${s.avoidedLP}；剩余计数敌人（按真人来源）累计 ${s.humanSurvivors}。有扣血上限时，敌人数改善不等于保住的生命值。`, '',
    '## 可重现的失败样本', '',
    '| 策略 | 真人数 | 种子 | 地图 | 波次 | 玩家 | 来源输入 | 实际扣血 | 协防席位 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const band of manifest.bands) for (const humans of manifest.humans) {
    const match = runs.find((m) => m.band === band && m.humans === humans && m.rounds.some((r) => r.players.some((p) => !p.isBot && p.actualLoss > 0)));
    const r = match?.rounds.find((r) => r.players.some((p) => !p.isBot && p.actualLoss > 0));
    const p = r?.players.find((p) => !p.isBot && p.actualLoss > 0);
    if (p) out.push(`| ${band} | ${humans} | ${match.seed} | ${match.stageId} | ${r.round} | ${p.pid} | ${p.rawLeaks} | ${p.actualLoss} | ${r.helpers.join(', ') || '无'} |`);
  }
  out.push('', '原始 JSON 包含逐回合 AI 阵容、结束时生命与技力、盟约层数、来源敌人及其属性修正、实际策略，可用于下一阶段复现场景。当前没有改变 AI 决策，也没有训练网络；本报告衡量的是给定漏怪输入的持续兜底能力，不能外推为真实玩家的存活概率。', '');
  return out.join('\n');
}
