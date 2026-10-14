import { writeFileSync } from 'node:fs';
import { makeMatch, give } from '../../test/match/harness.js';
import { makeBattle } from '../../test/helpers/battleHarness.js';
import { planLayout, fieldModel } from '../../server/match/bot.js';
import { parseKey } from '../../server/match/board.js';

const results = [];
for (const tankFirst of [true, false]) for (const score of ['original', 'no-cohesion', 'no-heal', 'route-only']) {
  const { m } = makeMatch({ mode: 'coop', humans: 3, difficulty: 'HARD', seed: 8 }).start().toPrep().setStage('act2autochess_m02');
  try {
    m.botLayoutParams = { tankFirst, ...(score === 'no-cohesion' || score === 'route-only' ? { cohesion: 0 } : {}),
      ...(score === 'no-heal' || score === 'route-only' ? { healCare: 0 } : {}) };
    const ps = m.order[0];
    const routes = [[9, 10], [12, 10]].map((start) => ({ motion: 'WALK', start, end: [9, 2], checkpoints: [] }));
    m.wave = { ...m.wave, routes, spawns: routes.map((_, routeIndex) => ({ enemyKey: 'enemy_1006_shield_2', routeIndex, count: 3 })) };
    const pieces = ['1_02_a', '1_06_b', '2_07_a', '1_10_b', '2_09_a', '2_01_b', '1_18_a', '2_12_b'].map((id) => give(m, ps, `chess_char_${id}`, 'hand'));
    const plan = planLayout(m, ps, pieces);
    const units = pieces.map((p) => { const [row, col] = parseKey(plan.get(p.uid)); return { chessId: p.id, uid: p.uid, row, col, dir: plan.dirs.get(p.uid) }; });
    const row = { tankFirst, score, units: units.map((u) => ({ ...u, name: ps.gd.chess(u.chessId).name })), routes: fieldModel(m, ps).routes.map((r) => r.tiles), battles: [] };
    for (const route of [0, 1]) {
      const blocked = [], damage = new Map();
      const b = makeBattle({ stageId: m.stageId, routes, timeLimit: 100, enemies: [{ key: 'enemy_1006_shield_2', time: 30, route, count: 3, interval: 1 }], units,
        setup(battle) {
          battle.on('blocked', ({ blocker }) => blocked.push({ time: battle.time, defId: blocker.defId, row: blocker.row, col: blocker.col }));
          battle.on('damaged', ({ source, target, amount }) => {
            if (source?.side !== 'ally' || !(amount > 0) || target.side === 'ally') return;
            const id = source.defId; damage.set(id, (damage.get(id) || 0) + amount);
          });
        } });
      b.runToEnd(); b.invariants();
      const pp = b.result().perPlayer.p1;
      row.battles.push({ route, killed: pp.killed, leaked: pp.leaked, time: b.time, blocked, damage: Object.fromEntries(damage) });
    }
    results.push(row);
  } finally { m.dispose(); }
}
writeFileSync(process.argv[2], JSON.stringify({ kind: 'fixed-layout-ablation', seed: 8, results }, null, 2), { flag: 'wx' });
console.log(JSON.stringify(results.map(({ tankFirst, score, battles, units }) => ({ tankFirst, score, kills: battles.map((b) => b.killed), units })), null, 2));
