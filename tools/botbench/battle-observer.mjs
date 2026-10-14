// Read-only offline telemetry. Coverage is ordinary healing target eligibility, not an estimate of skill healing.
export function observeBattle(battle) {
  const rows = new Map(), healing = new Map();
  const row = (u) => {
    if (!rows.has(u.id)) rows.set(u.id, { id: u.id, uid: u.uid, defId: u.defId, owner: u.ownerId,
      tile: [u.tileR, u.tileC], aliveSeconds: 0, injuredSeconds: 0, uncoveredSeconds: 0,
      infectionSeconds: 0, terrainDamage: 0, receivedHeal: 0, deaths: 0 });
    return rows.get(u.id);
  };
  battle.on('damaged', (c) => {
    if (c.target?.side === 'ally' && c.dmg?.tags?.includes('terrain')) row(c.target).terrainDamage += c.amount || 0;
  });
  battle.on('death', (c) => { if (c.unit?.side === 'ally') row(c.unit).deaths++; });
  const heal = battle.heal.bind(battle);
  battle.heal = (source, target, amount, opts) => {
    const actual = heal(source, target, amount, opts);
    if (actual > 0 && target?.side === 'ally') {
      row(target).receivedHeal += actual;
      const key = `${source?.defId || 'none'}:${target.defId}`;
      healing.set(key, (healing.get(key) || 0) + actual);
    }
    return actual;
  };
  let sampleAt = 0, previous = 0;
  const step = battle.step.bind(battle);
  battle.step = (...args) => {
    const result = step(...args);
    if (battle.time >= sampleAt) {
      const dt = battle.time - previous; previous = battle.time; sampleAt = battle.time + 0.5;
      const allies = battle.allies(), covered = new Set();
      for (const h of allies.filter((u) => u.profile?.heal && !u.profile?.noAttack)) {
        for (const u of battle.injuredAlliesInKeys(h.rangeKeys, h)) covered.add(u.id);
      }
      for (const u of allies) {
        const r = row(u); r.aliveSeconds += dt;
        if (u.hp < u.s.maxHp * 0.98) { r.injuredSeconds += dt; if (!covered.has(u.id)) r.uncoveredSeconds += dt; }
        if (u.findBuff('terrain:infection')) r.infectionSeconds += dt;
      }
    }
    return result;
  };
  return () => ({ seconds: battle.time, units: battle.allyUnits.map((u) => ({ ...row(u),
    alive: u.alive, deployed: u.deployed, hp: u.hp, maxHp: u.s.maxHp, stats: { ...u.stats } })),
  healing: Object.fromEntries(healing) });
}
