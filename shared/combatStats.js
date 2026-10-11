// Read-only damage reporting. Never reads Unit.s, builds a result, or advances the simulation.
// Operators keep their board uid across redeploys and Unite; summon instances of the same type are
// combined per player so repeatedly created/expired tokens cannot grow the panel without bound.
import { bondDamageEntry, bondDamageStats } from './damageSources.js';

const damage = (n) => Number.isFinite(n) && n > 0 ? n : 0;

/** The completed normal battles of the current round, for players entering Unite. @param {Map<string, any>} results */
export function completedDamageStats(results, playerIds) {
  const out = [];
  for (const ownerId of playerIds) {
    for (const u of results.get(ownerId)?.unitStats || []) {
      out.push({ ...u, ownerId, stage: 'normal' });
    }
  }
  return out;
}

/** Project cumulative actual HP damage, including dead and undeployed operators, without touching sim state.
 * @param {any} battle @param {any[]} [baseline]
 */
export function battleDamageStats(battle, baseline = []) {
  if (!battle) return null;
  const rows = new Map();
  const add = (u, ownerId, stage) => {
    if (!u || (u.kind !== 'op' && u.kind !== 'token') || typeof ownerId !== 'string') return;
    const id = `${ownerId}:${u.kind}:${u.kind === 'token' ? u.defId : Number.isInteger(u.uid) ? u.uid : `${stage}:${u.id}`}`;
    let row = rows.get(id);
    if (!row) {
      row = { id, ownerId, uid: u.uid ?? null, defId: u.defId, name: u.name || u.defId,
        kind: u.kind, golden: !!u.def?.golden, dmg: 0, bondDamage: {} };
      rows.set(id, row);
    }
    row.dmg += damage(u.stats ? u.stats.dmg : u.dmg);
    const bonds = bondDamageStats(u.stats ? u.stats.bondDamage : u.bondDamage, u.stats ? u.stats.dmg : u.dmg);
    for (const [id, n] of Object.entries(bonds)) row.bondDamage[id] = (row.bondDamage[id] || 0) + n;
    // The live operator's record carries the current elite / stand-in / DIY identity.
    if (u.def) { row.name = u.name || u.defId; row.golden = !!u.def.golden; }
  };
  for (const u of baseline) add(u, u.ownerId, u.stage || 'normal');
  for (const ps of battle.players || []) {
    for (const u of ps.units || []) add(u, ps.playerId, battle.kind);
  }
  return {
    fieldId: battle.fieldId, round: battle.round, kind: battle.kind,
    time: Math.max(0, Number(battle.time) || 0), finished: !!battle.finished,
    units: [...rows.values()].filter((u) => u.kind === 'op' || u.dmg > 0).map(({ bondDamage, ...u }) =>
      ({ ...u, dmg: Math.round(u.dmg), ...bondDamageEntry(bondDamage, Math.round(u.dmg)) })),
  };
}
