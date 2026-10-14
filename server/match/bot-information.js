// Estimates available to a player. Never use hidden pool balances or the formal battle's RNG
// to rank choices. The legacy switch is reserved for frozen offline experiment replays.
import { SharedPool } from './pool.js';
import { deriveSeed } from '../sim/rng.js';

export function botPool(m, ps, { allowLegacy = true } = {}) {
  if (allowLegacy && m.botLegacyParity) return m.pool;
  const pool = new SharedPool(m.gd, { banned: m.pool.banned });
  // Preparation scouting exposes teammates' board, hand and temporary row. Count visible
  // normal/elite cards, not their private poolCopies bookkeeping (gifts can hold zero copies).
  const seats = m.mode === 'coop' ? m.alivePlayers() : [ps];
  for (const p of seats) for (const piece of p.allChess()) {
    const id = m.gd.baseIdOf(piece.id);
    pool.take(id, m.gd.isGolden(piece.id) ? (m.gd.mergeCount(id) || 3) : 1);
  }
  return pool;
}

export function rehearsalSampleSeed(m, ps, sample) {
  // Public stage/round/seat and sample number only; equal samples for every candidate.
  // Do not derive this from m.seed, a live RNG position, or a candidate's layout.
  return deriveSeed(0x12a1c0, `${m.stageId}:${m.round}:${ps.seat}:${sample}`);
}
