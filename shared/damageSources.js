// Display-only subsets of actual HP damage, never additional damage or combat modifiers.
export const DAMAGE_BOND_IDS = Object.freeze(['steadShip', 'siracusaShip', 'kazimierzShip', 'yanShip']);

/** Bound known Alliance subtotals by the credited unit's total; copy for result/transport/report callers. */
export function bondDamageStats(values, total) {
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
