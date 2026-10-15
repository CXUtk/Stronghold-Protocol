// Offline opt-in candidate allocation. Uses generated legal boards only, no trial results or RNG.
export const LAYOUT_BUDGET_POLICIES = Object.freeze(['protected-late-v1', 'balanced-v1', 'diverse-v1',
  'diverse-from8-v2', 'legacy-from7-v2']);

export const layoutSignature = plan => [...plan].sort((a, b) => a[0] - b[0])
  .map(([uid, tile]) => `${uid}@${tile}:${plan.dirs?.get(uid) || 'RIGHT'}`).join('|');

export function allocateLayoutBudget(plans, budget, { policy, round, mire = false } = {}) {
  const groups = new Map();
  for (const plan of plans) {
    const key = layoutSignature(plan);
    if (!groups.has(key)) groups.set(key, { plan, variants: [] });
    groups.get(key).variants.push(plan.variant || {});
  }
  const rows = [...groups.values()], limit = Math.max(0, Math.min(rows.length, budget));
  if (!policy || ['protected-late-v1', 'legacy-from7-v2'].includes(policy) && round < 7
    || policy === 'diverse-from8-v2' && round < 8) return rows.slice(0, limit).map(r => r.plan);
  if (!LAYOUT_BUDGET_POLICIES.includes(policy)) throw new Error('Unknown layout budget policy');
  const selected = [];
  const add = row => { if (row && selected.length < limit && !selected.includes(row)) selected.push(row); };
  const find = pred => add(rows.find(r => !selected.includes(r) && r.variants.some(pred)));
  find(v => v.current);
  if (policy === 'legacy-from7-v2') {
    for (const row of rows) if (row.variants.some(v => !v.routeBlock && !v.avoidMire && !v.rangedBlock && !v.forwardRanged)) add(row);
    for (const row of rows) add(row);
    return selected.map(r => r.plan);
  }
  find(v => Object.keys(v).length === 0);
  // Preserve a lane-distributed and a healing/hold proposal even on maps with many new alternatives.
  find(v => v.routeFloor === 0.5 && v.tankFirst !== false);
  find(v => v.secondHold === 1 && v.healHold === 0.75);
  if (policy === 'protected-late-v1') {
    find(v => v.hold === 8);
    find(v => v.kill === 3);
    if (mire) find(v => v.avoidMire && !v.rangedBlock && !v.routeBlock);
    find(v => v.routeFloor === 0.5 && v.tankFirst === false);
    find(v => v.routeBlock && !!v.avoidMire === mire);
  } else if (policy === 'balanced-v1') {
    if (mire) find(v => v.avoidMire && !v.rangedBlock && !v.routeBlock);
    find(v => v.rangedBlock && v.groundRangedCount === 1 && !v.routeBlock && !v.avoidMire && !v.forwardRanged);
    find(v => v.routeBlock && !!v.avoidMire === mire);
    find(v => v.hold === 8);
    find(v => v.tactical);
    find(v => v.forwardRanged && !v.rangedBlock);
  } else {
    // Farthest-first coverage of the legal board space, after the protected core. Equal budgets/samples.
    const distance = (a, b) => {
      const keys = new Set([...a.keys(), ...b.keys()]);
      let value = 0;
      for (const uid of keys) value += a.get(uid) !== b.get(uid) ? 1
        : (a.dirs?.get(uid) || 'RIGHT') !== (b.dirs?.get(uid) || 'RIGHT') ? 0.25 : 0;
      return value / Math.max(1, keys.size);
    };
    while (selected.length < limit) {
      let best = null, bestDistance = -1;
      for (const row of rows.filter(r => !selected.includes(r))) {
        const d = Math.min(...selected.map(s => distance(row.plan, s.plan)));
        if (d > bestDistance) { best = row; bestDistance = d; }
      }
      add(best);
    }
  }
  for (const row of rows) add(row);
  return selected.map(r => r.plan);
}
