// Tactical candidates shared by offline evaluation and the selected local AI policy.
import { rangeTiles } from './bot.js';

export function rehearsalContext(m, ps) {
  const mates = m.alivePlayers().filter((p) => p !== ps), hand = ps.hand.filter(Boolean), r = ps.round;
  return { round: m.round, kind: 'normal', shopLevel: ps.shop.level, funds: ps.funds,
    handUnits: hand.length, handChess: hand.filter((p) => p.kind === 'chess').length,
    roundStats: Object.fromEntries(['refreshes', 'buys', 'sells', 'spent', 'gainedChess', 'arts'].map((k) => [k, r[k] | 0])),
    matchBands: [ps.bandId, ...mates.map((p) => p.bandId)].filter(Boolean),
    teammates: mates.map((p) => ({ playerId: p.playerId, bandId: p.bandId })) };
}

/** Leak count remains lexicographically first. Preserve healthy helpers, not unbounded raw stack counts. */
export function carryScore(pp) {
  const leaks = (pp.leaked || []).filter((l) => l && l.counted !== false).length;
  const ops = pp.unitsEnd || [];
  const hp = ops.reduce((s, u) => s + (u.alive ? Math.max(0, Math.min(1, u.hpPct || 0)) : 0), 0) / Math.max(1, ops.length);
  const alive = ops.filter((u) => u.alive).length / Math.max(1, ops.length);
  return -leaks * 10000 + 60 * hp + 30 * alive + Math.min(1, (pp.killed || 0) / 1000);
}

/** A sixth proposal, not a ban on infection. Real rehearsals decide whether its safer coverage costs too much DPS. */
export function terrainAdjustment(m, ps, units, model, strength = 1) {
  const atlas = m.botCombatAtlas;
  const infection = (k) => { const [r, c] = k.split(',').map(Number); return m.stage?.tiles?.[m.stage.rows[r]?.[c]]?.special === 'infection'; };
  const healers = units.filter((u) => u.heal).map((u) => ({ cover: u.cover,
    hps: atlas.entries[u.rec.chessId]?.profiles.soft.hps || 0 }));
  if (m.alivePlayers().some((p) => p.bandId === 'band_amedic')) {
    const id = [...ps.board.values()].filter((p) => p.kind === 'chess' && ps.gd.isGolden(p.id)).length >= 2 ? 'char_613_acmedc' : 'char_605_cmedic';
    const slot = m.stage.mapChars?.find((s) => s.key === id && s.pos[0] >= 9 && s.pos[0] <= 12 && !s.alias?.includes('multi_only'));
    const rec = ps.gd.token(id);
    if (slot && rec) healers.push({ cover: new Set(rangeTiles(rec, ...slot.pos, slot.dir)), hps: atlas.mapMedics?.[id] || 0 });
  }
  let value = 0;
  for (const u of units) {
    const danger = infection(u.key), blocking = u.block > 0 && model.ground.has(u.key);
    if (!danger && !blocking) continue;
    const hps = healers.reduce((n, h) => n + (h.cover.has(u.key) ? h.hps / Math.max(1,
      units.filter((a) => h.cover.has(a.key) && (infection(a.key) || a.block > 0 && model.ground.has(a.key))).length) : 0), 0);
    const loss = danger ? (m.stage.special?.infection?.bb?.damage ?? 70) : 0;
    // Health and path usefulness remain scored by Layout; these deliberately modest terms just generate alternatives.
    if (danger) value -= strength * 3 * Math.max(0, loss - hps) / Math.max(1, loss);
    if (blocking) value += 0.75 * Math.min(1, Math.max(0, hps - loss) / 180);
  }
  return value;
}

export function installTacticalPolicy(m, policy, records = null) {
  if (!policy.tactical) return;
  if (policy.tactical === 'terrain') m.botLayoutAdjustment = (ps, units, model) => terrainAdjustment(m, ps, units, model);
  const hasInfection = () => m.stage.rows.slice(9, 13).some((row) => [...row].some((key) => m.stage.tiles[key]?.special === 'infection'));
  if (policy.tactical === 'hazard' && hasInfection()) m.botLayoutAdjustment = (ps, units, model) => terrainAdjustment(m, ps, units, model, 4);
  if (policy.tactical === 'dual') m.botLayoutAdjustment = (ps, units, model) => {
    let score = hasInfection() ? terrainAdjustment(m, ps, units, model, 4) : 0;
    for (const u of units) {
      const [r, c] = u.key.split(',').map(Number), tile = m.stage.rows[r]?.[c];
      // Mire stacks ASPD loss; concealment protects ranged damage/healing, but cannot draw enemy shots off allies.
      if (tile === 'm') score -= Math.min(3, u.dps / 200) + (u.heal ? 1 : 0);
      if (tile === 'g') score += u.block > 0 && model.ground.has(u.key) ? -1 : Math.min(1.5, u.dps / 300) + (u.heal ? 0.7 : 0);
    }
    return score;
  };
  if (['carry', 'terrain', 'hazard', 'dual'].includes(policy.tactical)) m.botRehearsalScore = carryScore;
  const original = m.newBattle.bind(m);
  m.newBattle = (opts) => {
    if (!opts.fieldId?.startsWith('r:')) return original(opts);
    // Foundation PR 608 supplies the full normal-battle context; keep it instead of replacing it with our older subset.
    const players = opts.players.map((input) => ({ ...input, contentInfo: input.contentInfo ?? rehearsalContext(m, m.players.get(input.playerId)) }));
    const b = original({ ...opts, players, flags: { ...opts.flags, layerGainsEnabled: policy.tactical !== 'context' } });
    if (!records) return b; // Production retains the same inputs without diagnostic snapshots.
    const result = b.result.bind(b); let saved = false;
    b.result = (...args) => {
      const r = result(...args);
      if (b.finished && !saved) {
        saved = true;
        records.push({ round: opts.round, pid: opts.players[0].playerId, seconds: b.time,
          ...(policy.captureSpecs ? { spec: JSON.parse(JSON.stringify({ ...opts, players, flags: { ...opts.flags, layerGainsEnabled: policy.tactical !== 'context' } })) } : {}),
          board: opts.players[0].units.map(({ uid, chessId, row, col, dir }) => ({ uid, chessId, row, col, dir })),
          mapMedics: b.allyUnits.filter((u) => ['char_605_cmedic', 'char_613_acmedc'].includes(u.defId)).map((u) => u.defId),
          players: Object.fromEntries(Object.entries(r.perPlayer || {}).map(([id, pp]) => [id, { leaks: (pp.leaked || []).filter((l) => l.counted !== false).length,
            gains: pp.layerGains, carryScore: carryScore(pp), unitsEnd: pp.unitsEnd }])) });
      }
      return r;
    };
    return b;
  };
}
