// Display-only subsets of actual HP damage, never additional damage or combat modifiers.
export const DAMAGE_BOND_IDS = Object.freeze(['steadShip', 'siracusaShip', 'kazimierzShip', 'yanShip']);
export const DAMAGE_TYPES = Object.freeze(['phys', 'arts', 'true', 'elemental']);

/** Bound known Alliance subtotals by the credited unit's total; copy for result/transport/report callers. */
export function bondDamageStats(values, total) {
  /** @type {Record<string, number>} */
  const out = {};
  let left = Number.isFinite(total) && total > 0 ? total : 0;
  for (const id of DAMAGE_BOND_IDS) {
    const n = values?.[id];
    if (!Number.isFinite(n) || n <= 0 || left <= 0) continue;
    const amount = Math.min(n, left);
    out[id] = amount;
    left -= amount;
  }
  return out;
}

/** Keep old no-Alliance result shapes unchanged. */
export function bondDamageEntry(values, total) {
  const bondDamage = bondDamageStats(values, total);
  return Object.keys(bondDamage).length ? { bondDamage } : {};
}

/** Known HP damage types; `element` fills a gauge and is deliberately absent. */
export function damageTypeStats(values, total) {
  /** @type {Record<string, number>} */
  const out = {};
  let left = Number.isFinite(total) && total > 0 ? total : 0;
  for (const type of DAMAGE_TYPES) {
    const n = values?.[type];
    if (!Number.isFinite(n) || n <= 0 || left <= 0) continue;
    const amount = Math.min(n, left);
    out[type] = amount;
    left -= amount;
  }
  return out;
}

/** Copy display metadata through results and the wire without changing old empty result shapes. */
export function damageBreakdownEntry(stats, total) {
  /** @type {{ bondDamage?: Record<string, number>, damageTypes?: Record<string, number>, bondDamageTypes?: Record<string, Record<string, number>> }} */
  const out = bondDamageEntry(stats?.bondDamage, total);
  const damageTypes = damageTypeStats(stats?.damageTypes, total);
  if (Object.keys(damageTypes).length) out.damageTypes = damageTypes;
  /** @type {Record<string, Record<string, number>>} */
  const bondDamageTypes = {};
  for (const [id, n] of Object.entries(out.bondDamage || {})) {
    const types = damageTypeStats(stats?.bondDamageTypes?.[id], n);
    if (Object.keys(types).length) bondDamageTypes[id] = types;
  }
  if (Object.keys(bondDamageTypes).length) out.bondDamageTypes = bondDamageTypes;
  return out;
}

/** Allocate integer display values so rounding does not create or lose damage between the four types. */
export function roundedDamageTypes(values, total) {
  const raw = damageTypeStats(values, total);
  const entries = Object.entries(raw).map(([type, n]) => ({ type, n: Math.floor(n), fraction: n - Math.floor(n) }));
  let left = Math.round(Object.values(raw).reduce((sum, n) => sum + n, 0)) - entries.reduce((sum, x) => sum + x.n, 0);
  const order = [...entries].sort((a, b) => b.fraction - a.fraction || DAMAGE_TYPES.indexOf(a.type) - DAMAGE_TYPES.indexOf(b.type));
  for (const x of order) if (left > 0) { x.n++; left--; }
  return Object.fromEntries(entries.map((x) => [x.type, x.n]));
}
