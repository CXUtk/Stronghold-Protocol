// Only 补给线 / 补给线II exclude the 次数怪 frequency units; 攻坚装备 still applies.
const SUPPLY_EXCLUDED = new Set([
  'enemy_1196_msfyin', 'enemy_1198_msfshu', 'enemy_1200_msfjin', 'enemy_1202_msfzhi',
  'enemy_1204_msfhu', 'enemy_1208_msfji', 'enemy_1210_msfden',
].flatMap((key) => [key, `${key}_2`]));

/** Resolve the round's enemy effects for a particular key, without applying them twice. */
export function enemySpawnMods(scale, key) {
  if (!scale) return null;
  if (key === 'enemy_9012_acloon') return { hpMul: 1, atkMul: 1, speedMul: 1 };
  return {
    hpMul: scale.hpMul / (SUPPLY_EXCLUDED.has(key) ? (scale.supplyHpMul ?? 1) : 1),
    atkMul: scale.atkMul,
    speedMul: scale.speedMul,
  };
}
