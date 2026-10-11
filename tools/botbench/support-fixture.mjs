// Controlled incoming-leak fixtures, not predictions of human purchasing or battlefield decisions.
export const FIXTURE_VERSION = 2;
export const ANCHOR_BANDS = ['band_amiya', 'band_ioleta'];

export function humanBand(m, ps) {
  return m.gd.bandIds().find((id) => !ANCHOR_BANDS.includes(id) && !m.bandTaken(id, ps.playerId));
}

export function humanCard(m) {
  return m.sp.cards.filter((c) => m.spCardAvailable(c))
    .sort((a, b) => Number(a.kind === 'bounty') - Number(b.kind === 'bounty') || a.idx - b.idx)[0]?.idx;
}

/** Choose distinct actual leaked instances, rotating enemy TYPES so scarce threats are not buried by fodder. */
export function selectLeaks(leaks, count, offset) {
  const byType = new Map();
  for (const leak of leaks || []) {
    if (!leak || leak.counted === false || leak.tag === 'bounty') continue;
    if (!byType.has(leak.enemyKey)) byType.set(leak.enemyKey, []);
    byType.get(leak.enemyKey).push(leak);
  }
  const keys = [...byType.keys()].sort();
  const selected = [];
  for (let i = 0; keys.length && selected.length < count; i++) {
    const key = keys[(offset + i) % keys.length];
    const group = byType.get(key);
    if (group.length) selected.push({ ...group.shift() });
    if ([...byType.values()].every((g) => !g.length)) break;
  }
  return selected;
}

/** Replace only the human source results, immediately before the real planUnite. AI results stay untouched. */
export function injectLeaks(m, { seed, leakCount, sourceMode, fixedInputs = null }) {
  const people = m.order.filter((p) => !p.isBot && p.alive);
  const selectedPid = people.length ? people[(seed + m.round) % people.length].playerId : null;
  const inputs = [];
  for (const p of people) {
    const raw = m.lastResults.get(p.playerId);
    if (!raw) throw new Error(`Missing human input result: ${p.playerId}`);
    const requested = sourceMode === 'all' || p.playerId === selectedPid ? leakCount : 0;
    const fixed = fixedInputs?.find((x) => x.pid === p.playerId);
    if (fixedInputs && (!fixed || fixed.requested !== requested)) throw new Error('Missing or incompatible fixed human leak input');
    const leaked = fixed ? structuredClone(fixed.leaks) : selectLeaks(raw.leaked, requested, seed + m.round * 13 + p.seat * 7);
    // Non-leaking fixture seats cannot rescue others: there is no invented human army to help the AI.
    m.lastResults.set(p.playerId, { ...raw, leaked, perfect: false, killed: 0, coins: 0,
      damageDealt: 0, healingDone: 0, layerGains: {}, unitsEnd: [], unitStats: [] });
    p.pendingLayerGains = null;
    inputs.push({ pid: p.playerId, requested, actual: leaked.length,
      leaks: leaked.map((l) => ({ enemyKey: l.enemyKey, mods: l.mods, tag: l.tag, counted: l.counted, lpr: l.lpr ?? 1 })) });
  }
  return inputs;
}
