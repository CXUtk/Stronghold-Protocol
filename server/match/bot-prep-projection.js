// Isolated preparation-end projection for experimental bot rehearsals. Never run meta hooks on
// the live match and try to undo them: gifts, stock, counters and RNG are all mutable state.
import { PHASE } from '../../shared/constants.js';
import { GameData } from './gamedata.js';
import { EffectDispatcher } from './effectsMeta.js';
import { SharedItemPool } from './pool.js';
import { VirtualScheduler } from './scheduler.js';
import { diyGameData } from './player/diy.js';

const runtime = new Set(['opts', 'log', 'sched', 'dispatcher', 'registry', 'ds', 'BattleClass',
  'itemPool', 'fields', 'runner', 'pacer', 'bossPool', '_timers', '_privDirty',
  '_phaseTimer', '_infoAdvanceTimer', '_turnTimer', '_pubTimer', '_progressTimer',
  '_bossPubTimer', '_bossClock', '_poolTimer', '_botPrepJobs', '_botPrepTimer']);
const noop = () => {};

/** Clone gameplay state and rebind every stateful service; no live callbacks/timers are retained.
 * Own method wrappers (bench instrumentation) are deliberately excluded; prototype rules are used.
 * Data/registry are immutable definitions; their per-match views and all gameplay state are private.
 */
export function forkPreparation(m) {
  if (m.phase !== PHASE.PREP) throw new Error('Preparation projection requires PREP');
  const copy = Object.create(Object.getPrototypeOf(m));
  const gd = new GameData(m.data, m.modeId);
  const seen = new Map([[m, copy], [m.data, m.data], [m.gd, gd]]);
  for (const p of m.order) seen.set(p, Object.create(Object.getPrototypeOf(p)));
  function clone(v) {
    if (typeof v === 'function') throw new Error('Unexpected callback in preparation state');
    if (!v || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    const out = v instanceof Map ? new Map() : v instanceof Set ? new Set()
      : Array.isArray(v) ? [] : Object.create(Object.getPrototypeOf(v));
    seen.set(v, out);
    if (v instanceof Map) for (const [k, x] of v) out.set(clone(k), clone(x));
    else if (v instanceof Set) for (const x of v) out.add(clone(x));
    else for (const k of Object.keys(v)) out[k] = clone(v[k]);
    return out;
  }
  for (const [k, v] of Object.entries(m)) {
    if (runtime.has(k)) continue;
    if (typeof v === 'function') { if (k.startsWith('rng') && v.clone) copy[k] = v.clone(); }
    else if (k === 'botCombatAtlas') copy[k] = v; // immutable offline capability table
    else copy[k] = clone(v);
  }
  for (const p of m.order) {
    const q = seen.get(p);
    for (const [k, v] of Object.entries(p)) if (k !== 'gd' && typeof v !== 'function') q[k] = clone(v);
    q.gd = q._diyRecords?.size ? diyGameData(gd, q._diyRecords) : gd;
  }
  Object.assign(copy, { gd, opts: {}, registry: m.registry, ds: m.ds, BattleClass: m.BattleClass,
    log: { info: noop, warn: noop, error: noop, debug: noop },
    sendFn: noop, broadcastFn: noop, onEndFn: noop,
    sched: new VirtualScheduler({ start: m.sched.now() }), ownsScheduler: true,
    fields: [], runner: null, pacer: null, bossPool: null, _timers: new Set(), _privDirty: new Set() });
  copy.itemPool = new SharedItemPool(gd, () => copy.order);
  copy.dispatcher = new EffectDispatcher(copy, m.registry);
  return { match: copy, clone };
}

/** Project "ready now": later teammate actions are not predicted. The real endPrep order is
 * hooks for ALL alive seats, cleanup for ALL seats, then battle-start hooks in seat order.
 * Running real hooks (preview:false) is safe here and preserves shared meta-RNG consumption.
 */
export function projectNormalBattleOptions(m, ps, prepare = null) {
  const { match: projected, clone } = forkPreparation(m);
  try {
    const target = projected.players.get(ps.playerId);
    prepare?.(projected, target, clone);
    const alive = projected.alivePlayers();
    for (const p of alive) projected.dispatch(p, 'onPrepEnd', { round: projected.round });
    for (const p of alive) p.endPrep();
    projected.phase = PHASE.COMBAT;
    projected.lastResults = new Map();
    let opts;
    for (const p of alive) {
      const current = projected._normalOpts(p);
      if (p === target) opts = current;
    }
    if (projected.dispatcher.errors || projected.errorCount > m.errorCount)
      throw new Error(`Preparation projection hook failure: ${JSON.stringify([...projected.dispatcher.errorsByKey])}`);
    if (!opts) throw new Error('Preparation projection target is not alive');
    return opts;
  } finally { projected.sched.dispose(); }
}
