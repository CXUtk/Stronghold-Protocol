// Diagnostic only: aggregate actual hits by entrance and retain the formal battle spec for replay.
export function observeRoutes(b, opts) {
  const hits = new Map(), pressure = new Map(), blocks = [], deaths = [];
  const entrance = (u) => `${u.spawnY},${u.spawnX}`;
  b.on('damaged', ({ source, target, amount }) => {
    if (!(amount > 0)) return;
    if (target.side === 'enemy' && source?.side === 'ally') {
      const key = `${source.ownerId}|${source.uid}|${source.defId}|${entrance(target)}`;
      hits.set(key, (hits.get(key) || 0) + amount);
    } else if (target.side === 'ally' && source?.side === 'enemy') {
      const key = `${target.ownerId}|${target.uid}|${target.defId}|${entrance(source)}`;
      pressure.set(key, (pressure.get(key) || 0) + amount);
    }
  });
  b.on('blocked', ({ blocker, enemy }) => blocks.push({ time: b.time, blocker: blocker.uid, owner: blocker.ownerId,
    tile: [blocker.tileR, blocker.tileC], entrance: enemy ? entrance(enemy) : null }));
  b.on('death', ({ unit }) => { if (unit?.side === 'ally') deaths.push({ time: b.time, uid: unit.uid, owner: unit.ownerId, id: unit.defId, tile: [unit.tileR, unit.tileC] }); });
  const spec = JSON.parse(JSON.stringify(opts));
  return () => ({ spec, hits: Object.fromEntries(hits), pressure: Object.fromEntries(pressure), blocks, deaths });
}
