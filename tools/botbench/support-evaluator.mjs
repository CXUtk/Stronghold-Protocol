import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { deriveSeed } from '../../server/sim/rng.js';
import { runSupportMatch } from './support-runner.mjs';
import { applySupportCandidate, CANDIDATES } from './support-candidates.mjs';

function plain(v) {
  if (typeof v === 'function' || v === undefined) return null;
  if (v instanceof Map) return [...v].map(([k, x]) => [k, plain(x)]);
  if (v instanceof Set) return [...v].map(plain);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, plain(v[k])]));
  return typeof v === 'number' && !Number.isFinite(v) ? String(v) : v;
}
export const digest = (v) => createHash('sha256').update(JSON.stringify(plain(v))).digest('hex');

/** Diagnostic checksum, NOT a save format. Function closures are reconstructed by deterministic replay. */
export function checkpointState(m) {
  const player = (p) => Object.fromEntries(Object.entries(p).filter(([k, v]) =>
    !['m', 'gd', '_deployMap'].includes(k) && !k.startsWith('_bot') && typeof v !== 'function'));
  return plain({ round: m.round, phase: m.phase, modeId: m.modeId, stageId: m.stageId,
    seed: m.seed, uidSeq: m.uidSeq, wave: m.wave, deadline: m.deadline,
    rng: Object.fromEntries(['Setup', 'Shop', 'Waves', 'Draft', 'Bots', 'Meta'].map((k) => [k, m[`rng${k}`].state()])),
    pool: m.pool.entries, itemPool: Object.fromEntries(Object.entries(m.itemPool).filter(([k, v]) => k !== 'gd' && typeof v !== 'function')),
    players: m.order.map(player), time: m.sched.now(),
    timers: m.sched._q.filter((q) => !q.cancelled).map(({ id, at, seq, every }) => ({ id, at, seq, every })),
  });
}

/** Lower human loss comes first; then eligibility / own leaks / surviving helper strength. */
export function evaluationMetrics(row) {
  const humans = row.players.filter((p) => !p.isBot), bots = row.players.filter((p) => p.isBot);
  return {
    humanLoss: humans.reduce((n, p) => n + p.actualLoss, 0),
    humanZeroLoss: humans.filter((p) => p.weak && p.weakZeroLoss).length,
    eligible: bots.filter((p) => p.ownPerfect).length,
    helpers: row.helpers.length,
    aiLeaks: bots.reduce((n, p) => n + p.rawLeaks, 0),
    standing: bots.reduce((n, p) => n + p.carry.filter((u) => u.alive).length, 0),
    hpSum: bots.reduce((n, p) => n + p.carry.reduce((s, u) => s + (u.alive ? u.hpPct : 0), 0), 0),
  };
}

export function chooseCandidate(results) {
  const aggregate = [...new Set(results.map((r) => r.candidate))].map((candidate) => {
    const rs = results.filter((r) => r.candidate === candidate);
    const avg = (key) => rs.reduce((s, r) => s + r.metrics[key], 0) / rs.length;
    return { candidate, loss: avg('humanLoss'), eligible: avg('eligible'), leaks: avg('aiLeaks'), hp: avg('hpSum') };
  });
  aggregate.sort((a, b) => a.loss - b.loss || b.eligible - a.eligible || a.leaks - b.leaks || b.hp - a.hp
    || CANDIDATES.indexOf(a.candidate) - CANDIDATES.indexOf(b.candidate));
  return aggregate[0]?.candidate ?? 'baseline';
}

/**
 * Rebuild the whole prefix in a NEW Match for every candidate / battle seed. The branch is PREP immediately before
 * onPrepEnd; normal carry, helper selection, unite map and settlement are all the production implementations.
 * Trial RNG is independent of formal battle seeds and changes ONLY the target round's normal/unite battles.
 * This is an offline correctness-first replay checkpoint, not yet a cheap runtime state clone.
 */
export function evaluateSupportCase(config, { candidates = CANDIDATES, trialSeeds = [101, 202], formal = false } = {}) {
  if (config.humans !== 2) throw new Error('Stage 2 requires exactly 2 humans + 2 AI');
  if (!candidates.length || candidates.some((c) => !CANDIDATES.includes(c)) || new Set(candidates).size !== candidates.length) throw new Error('Invalid candidates');
  if (!trialSeeds.length || trialSeeds.some((s) => !Number.isSafeInteger(s) || s < 0)) throw new Error('Invalid trial seeds');
  const results = [];
  let checkpoint = null, prefixHash = null;
  for (const trialSeed of formal ? [null] : trialSeeds) for (const candidate of candidates) {
    const started = performance.now();
    let edits = [], branchHash = null, generationMs = 0, prefixMs = 0, finalState = null;
    const run = runSupportMatch(config, {
      beforeEndPrep(m, rec) {
        if (m.round !== config.rounds) return;
        prefixMs = performance.now() - started;
        branchHash = digest(checkpointState(m));
        const history = digest({ rounds: rec.rounds, inputs: rec.fixtureInputs });
        if (checkpoint && (checkpoint !== branchHash || prefixHash !== history)) throw new Error('Replay checkpoint mismatch');
        checkpoint = branchHash; prefixHash = history;
        const t = performance.now();
        edits = m.order.filter((p) => p.isBot && p.alive).map((p) => applySupportCandidate(m, p, candidate));
        generationMs = performance.now() - t;
      },
      battleSeed(opts, m) {
        if (formal || m.round !== config.rounds || opts.fieldId?.startsWith('r:')) return opts.seed;
        return deriveSeed(trialSeed, `support:${config.seed}:${config.rounds}:${opts.fieldId}`);
      },
      beforeDispose(m) { finalState = digest(checkpointState(m)); },
    });
    const row = run.rounds.find((r) => r.round === config.rounds);
    if (!row || !branchHash) throw new Error(`Target round ${config.rounds} was not reached: ${run.stopReason}`);
    results.push({ candidate, trialSeed, checkpoint: branchHash, prefixHash, finalState,
      metrics: evaluationMetrics(row), row, edits,
      fixture: run.fixtureInputs.at(-1), errors: run.errors, warnings: run.warnings,
      elapsedMs: performance.now() - started, prefixMs, generationMs });
  }
  // Human inputs come from their isolated empty fields and must remain identical across candidates per trial.
  for (const seed of new Set(results.map((r) => r.trialSeed))) {
    const rows = results.filter((r) => r.trialSeed === seed);
    if (new Set(rows.map((r) => digest(r.fixture))).size !== 1) throw new Error('Human leak fixture changed between candidates');
  }
  return { schemaVersion: 1, config, formal, checkpoint, prefixHash, results };
}
