// Proposal heuristic only. Keep the real fortress range/blind spot and the normal battle selector.
export const isArtillery = rec => rec?.subProfessionId === 'fortress';

/** Real preview score stays primary; only an exact mean-score tie may prefer participating artillery. */
export function preferArtilleryCandidate(next, best) {
  if (!best) return true;
  if (next.mean === best.mean && next.active !== best.active) return next.active > best.active;
  return next.score > best.score;
}

/** Weight of ground routes whose first allied blocking contact the artillery can actually shoot. */
export function artilleryContactScore(unit, allies, model) {
  let score = 0;
  for (const route of model.routes) {
    if (route.fly || !(route.n > 0)) continue;
    const first = route.tiles.findIndex(key => allies.some(a => a !== unit && a.block > 0 && a.key === key));
    if (first < 0) continue;
    // [ASSUMED] Approximate the pre-centre stop by the preceding route tile; the real preview decides.
    const contact = route.tiles[Math.max(0, first - 1)];
    if (unit.ground && unit.cover.has(contact)) score += route.n;
  }
  return score;
}
