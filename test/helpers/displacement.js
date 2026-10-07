import assert from 'node:assert/strict';

/** Wait for already-started displacement, without allowing a second cast or attack to add another impulse.
 * Uses real battle ticks so travelled-distance damage, terrain and status timers are still exercised.
 * Instantaneous displacement has no active state and returns immediately.
 */
export function finishDisplacement(h, enemies = h.b.enemies, maxSeconds = 5) {
  const bodies = Array.isArray(enemies) ? enemies : [enemies];
  if (!bodies.some((e) => e?.unbalance)) return;
  const allies = h.b.allyUnits.map((u) => ({ u, noAttack: u.profile.noAttack, noSkill: u.skill?.noSkill }));
  for (const { u } of allies) { u.profile.noAttack = true; if (u.skill) u.skill.noSkill = true; }
  try {
    assert.ok(h.runUntil(() => bodies.every((e) => !e?.unbalance), maxSeconds), 'continuous displacement finishes');
  } finally {
    for (const { u, noAttack, noSkill } of allies) { u.profile.noAttack = noAttack; if (u.skill) u.skill.noSkill = noSkill; }
  }
}
