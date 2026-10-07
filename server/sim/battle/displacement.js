// server/sim/battle/displacement.js — Battle methods: displacement of enemies: 受力等级 (force − weight), push (radial /
// directional), pull, the raw mover displace and who can be moved at all.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { TICK, UNBALANCE_MIN_DURATION, UNBALANCE_EXIT_SPEED, UNBALANCE_FRICTION, PULL_DURATION, PULL_WEAK_DURATION, PULL_FORCE, COLS, PUSH_TILES, PUSH_TILES_EFFECT, PULL_WEAK_SHARE, PULL_CRAWL, PULL_ORIGIN, PULL_STOP_RADIUS, PUSH_DIRECTIONAL_MIN_DIST } from '../constants.js';
import { interruptEnemyWindup } from '../ai.js';
import { fin } from './util.js';

/**
 * Official push distance (tiles) of a 受力等级 (constants.js PUSH_TILES: ≤ −3 → 0, ≥ 3 → the 3 value); `effect` = a 特效
 * push (PRTS 推与拉's 特效 column, PUSH_TILES_EFFECT: 见行者), else the 弹道 column.
 */
export function pushTiles(level, effect = false) {
  const l = Math.round(fin(level, -99));
  if (l <= -3) return 0;
  return (effect ? PUSH_TILES_EFFECT : PUSH_TILES)[Math.min(3, l)];
}

export class BattleDisplacement {
  forceLevel(e, force) {
    return Math.round(fin(force, 0)) - (e && e.s ? e.s.massLevel : 0);
  }

  /**
   * Push enemy `e` with 力度 `force` (PRTS 推与拉 §推力): the official distance of its 受力等级 (constants.js PUSH_TILES:
   * a 中力 push moves a weight-1 enemy 1.7 tiles, a weight-2 one 0.44, weight 3 0.12, weight ≥ 4 not at all). Radial
   * (the default: away from `from`, the pusher's centre — "沿着干员向自身中心点的射线方向"; the client's buff template
   * knockback[relative]: 琳琅诗怀雅 S3, 山 S3, 莫斯提马 S3) or directional (`dir` = the pusher's direction {x, y}; template
   * knockback[dir], Knockback {_useSourceDirection: true, _decreaseForceLevelWhenNotInDirection: 2}: 推击手, 野鬃 S2
   * "往攻击方向"); a directional push on a target more than 45° off `dir` or nearer than 0.25 tile becomes radial with
   * 受力等级 −2 ("特殊修正"). `fixed` waives both corrections (圣聆初雪 S1 "朝部署方向": KnockBackWithCharacterDirection,
   * PRTS 备注 "不会因角度过大或距离过近而变化方向与力度"); `fixedAngle` only the angle one (PRTS 见行者 S2 备注 "不会因为角度过大
   * 而改变推动的方向或削减力度" — the < 0.25 tile rule still applies). `inward` = a radial push towards `from` (薄绿 S2's "拖拽", PRTS 备注 "实际为
   * 反方向（指向薄绿方向）的推开"), never nearer than PULL_STOP_RADIUS to its centre [ASSUMED: "至面前"]. `effect` = a 特效
   * push (PRTS 推与拉: one frame less of travel than a 弹道 push — constants.js PUSH_TILES_EFFECT / PUSH_EFFECT_SKILLS).
   * Returns the unobstructed travel predicted for this impulse. The movement itself is integrated on later ticks.
   */
  push(e, force, { from = null, dir = null, fixed = false, fixedAngle = false, inward = false, effect = false } = {}) {
    if (!this._canUnbalance(e)) return 0;
    let level = this.forceLevel(e, force);
    const fx0 = fin(from?.x, e.x), fy0 = fin(from?.y, e.y);
    const vx = e.x - fx0, vy = e.y - fy0, d = Math.hypot(vx, vy);
    let ux = 0, uy = 0;
    const dirX = dir ? fin(dir.x, 0) : 0, dirY = dir ? fin(dir.y, 0) : 0;
    const dl = Math.hypot(dirX, dirY);
    if (dl > 0) {
      ux = dirX / dl; uy = dirY / dl;
      if (from && !fixed && (d < PUSH_DIRECTIONAL_MIN_DIST || (!fixedAngle && vx * ux + vy * uy < d * Math.SQRT1_2))) {
        level -= 2;
        if (d > 1e-6) { ux = vx / d; uy = vy / d; }
      }
    } else if (d > 1e-6) { ux = vx / d; uy = vy / d; }
    else if (!inward && from && Array.isArray(from.fwd)) { ux = from.fwd[1]; uy = from.fwd[0]; }
    else return 0;
    let dist = pushTiles(level, effect);
    if (inward && !(dl > 0)) { ux = -ux; uy = -uy; dist = Math.min(dist, Math.max(0, d - PULL_STOP_RADIUS)); }
    return this.displace(e, { x: ux, y: uy }, dist);
  }

  /**
   * Pull enemy `e` with 力度 `force` towards the point `to` (PRTS 推与拉 §拉力 / §捕网): 受力等级 ≥ 0 — all the way, until it
   * is within `stop` tiles of `center` (急停; `center` defaults to `to`, `stop` to PULL_STOP_RADIUS) or reaches `to`;
   * −1 — PULL_WEAK_SHARE of its starting distance to `to`; −2 — PULL_CRAWL tiles; ≤ −3 — nothing. `pullToFront` aims at
   * the official 拉力起点 in front of an operator. Returns the tiles moved.
   */
  pull(e, force, { to, center = null, stop = PULL_STOP_RADIUS, duration = null, source = null } = {}) {
    if (!this._canUnbalance(e) || !to) return 0;
    // an enemy the puller itself blocks already stands in front of it (at contact) [ASSUMED: no pull, no unblocking]
    if (center && center.side === 'ally' && e.blockedBy === center) return 0;
    const tx = fin(to.x, e.x), ty = fin(to.y, e.y);
    const dx = tx - e.x, dy = ty - e.y, d0 = Math.hypot(dx, dy);
    if (!(d0 > 1e-6)) return 0;
    const ux = dx / d0, uy = dy / d0;
    // travel until inside the stop circle around `center` (smaller root of |e + t·u − c| = stop), else up to `to`
    let full = d0;
    const cx = fin(center?.x, tx), cy = fin(center?.y, ty), r = Math.max(0, fin(stop, 0));
    const wx = e.x - cx, wy = e.y - cy, wu = wx * ux + wy * uy, w2 = wx * wx + wy * wy;
    if (w2 <= r * r) full = 0;
    else {
      const disc = wu * wu - w2 + r * r;
      if (disc >= 0) { const t = -wu - Math.sqrt(disc); if (t >= 0) full = Math.min(full, t); }
    }
    const level = this.forceLevel(e, force);
    const dist = level >= 0 ? full : level === -1 ? Math.min(full, PULL_WEAK_SHARE * d0) : level === -2 ? Math.min(full, PULL_CRAWL) : 0;
    if (level <= -3 || !(full > 1e-6)) return 0;
    const U = this._beginUnbalance(e);
    const l = Math.max(-2, Math.min(3, Math.round(level)));
    U.pulls.push({
      to, center, stop: r, x0: d0, force: PULL_FORCE[l],
      until: this.time + Math.max(TICK, fin(duration, l === -2 ? PULL_WEAK_DURATION : PULL_DURATION)),
      source: source ?? (center && center.side ? center : null),
    });
    // The weakest effective pull has only the measured ~0.03-tile crawl. At 30 Hz Unity's contact solver cannot be
    // reproduced directly, so seed the equivalent tiny velocity and let the same friction integrator consume it.
    if (l === -2 && this._displaceable(e)) {
      const crawlSpeed = Math.sqrt(2 * (UNBALANCE_FRICTION - PULL_FORCE[-2]) * Math.min(PULL_CRAWL, full));
      U.vx += ux * crawlSpeed; U.vy += uy * crawlSpeed;
    }
    this.fx('displace', { x: e.x, y: e.y, id: e.id });
    return this._displaceable(e) ? this._traceDisplacement(e, ux, uy, dist) : 0;
  }

  /** Official distance (tiles) a push of 力度 `force` would move `e` on open ground (0 when it cannot be displaced). */
  pushDistance(e, force, { effect = false } = {}) {
    return this._displaceable(e) ? pushTiles(this.forceLevel(e, force), effect) : 0;
  }

  /** Pull `e` "至面前" of ally `unit` (拉力起点 PULL_ORIGIN tiles ahead along its direction, 急停 around its centre). */
  pullToFront(e, unit, force) {
    if (!unit) return 0;
    const f = Array.isArray(unit.fwd) ? unit.fwd : [0, 1];
    return this.pull(e, force, { to: { x: unit.x + f[1] * PULL_ORIGIN, y: unit.y + f[0] * PULL_ORIGIN }, center: unit, stop: PULL_STOP_RADIUS });
  }

  /**
   * `_canUnbalance`: living non-leader enemy without 失衡免疫. `_displaceable` additionally rejects 静态刚体. A static
   * body still enters and holds the locomotion state (minimum 0.1 s, or an active pull's duration), but physics gives it
   * no velocity or movement. Skills that can reach it still hit; distance-based effects receive 0 travel.
   */
  _canUnbalance(e) {
    return !!(e && e.alive && e.side === 'enemy' && !e.isBoss && !e.s.flags.noDisplace);
  }

  _displaceable(e) {
    return this._canUnbalance(e) && !(e.def && e.def.staticBody);
  }

  /**
   * Add an impulse whose open-ground travel is `distance` tiles along `dir`. The body moves on later fixed ticks over
   * passable terrain; push() / pull() add the official weight rules. 失衡免疫 and leaders reject the state; 静态刚体
   * enters it without velocity. The tiles it may cross follow `motion`.
   */
  displace(e, dir, distance) {
    if (!this._canUnbalance(e) || !dir) return 0;
    const dxv = fin(dir.x, 0), dyv = fin(dir.y, 0);
    const len = Math.hypot(dxv, dyv);
    if (!(len > 0)) return 0;
    const eff = Math.min(fin(distance, 0), 2 * COLS);
    if (!(eff > 0)) return 0;
    const ux = dxv / len, uy = dyv / len;
    const U = this._beginUnbalance(e);
    if (this._displaceable(e)) {
      // The impulse that travels `eff` under constant ground friction. Multiple impulses add as vectors, like
      // Rigidbody.AddForce(..., Impulse), rather than replacing an existing push or pull velocity.
      const speed = Math.sqrt(2 * UNBALANCE_FRICTION * eff);
      U.vx += ux * speed;
      U.vy += uy * speed;
    }
    this.fx('displace', { x: e.x, y: e.y, id: e.id });
    return this._displaceable(e) ? this._traceDisplacement(e, ux, uy, eff) : 0;
  }

  /** Enter displacement locomotion and cancel a normal attack that is still in its wind-up. */
  _beginUnbalance(e) {
    let U = e.unbalance;
    if (!U) U = e.unbalance = { vx: 0, vy: 0, hardUntil: this.time + UNBALANCE_MIN_DURATION, pulls: [] };
    else U.hardUntil = Math.max(U.hardUntil, this.time + UNBALANCE_MIN_DURATION);
    interruptEnemyWindup(this, e);
    e.atkStandUntil = -Infinity;
    e.moving = false;
    return U;
  }

  /** Maximum straight travel before terrain stops the body, without changing the enemy. */
  _traceDisplacement(e, ux, uy, distance) {
    let x = e.x, y = e.y, moved = 0;
    while (moved + 1e-9 < distance) {
      const s = Math.min(0.05, distance - moved);
      const nx = x + ux * s, ny = y + uy * s;
      const r = Math.round(ny), c = Math.round(nx);
      const ok = e.motion === 'FLY' ? this.grid.inRect(r, c) : this.grid.groundPassable(r, c);
      if (!ok) break;
      x = nx; y = ny; moved += s;
    }
    return moved;
  }

  /** Move one physics slice over passable terrain. */
  _moveUnbalanced(e, dx, dy) {
    const distance = Math.hypot(dx, dy);
    if (!(distance > 1e-12)) return { moved: 0, stopped: false };
    const ux = dx / distance, uy = dy / distance;
    const moved = this._traceDisplacement(e, ux, uy, distance);
    if (moved > 0) {
      const x0 = e.x, y0 = e.y;
      e.x += ux * moved; e.y += uy * moved;
      e.unbalanceStepFromX = x0; e.unbalanceStepFromY = y0;
      e.unbalanceStepDistance = moved;
      this._unblock(e);
      if (e.route) e.route.pts = null;
    }
    return { moved, stopped: moved + 1e-7 < distance };
  }

  /** Advance continuous push / pull physics. True means normal attack, block acquisition and route movement stay suspended. */
  updateUnbalance(e, dt) {
    const U = e.unbalance;
    if (!U) return false;
    e.unbalanceStepDistance = 0;
    if (!e.alive || e.hidden || e.s.flags.noDisplace) { e.unbalance = null; return false; }
    U.pulls = U.pulls.filter((p) => p.until > this.time + 1e-9 && (!p.source || (p.source.alive && p.source.deployed && !p.source.hidden)));
    const speed0 = Math.hypot(U.vx, U.vy);
    if (this.time + 1e-9 >= U.hardUntil && !U.pulls.length && speed0 <= UNBALANCE_EXIT_SPEED) {
      e.unbalance = null;
      e.moving = false;
      return true; // state transition consumes this tick; ordinary locomotion resumes on the next one
    }
    e.moving = false;
    if (e.def && e.def.staticBody) { U.vx = 0; U.vy = 0; return true; }

    let fx = 0, fy = 0;
    for (const p of U.pulls) {
      const tx = fin(p.to?.x, e.x), ty = fin(p.to?.y, e.y);
      const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
      if (!(d > 1e-9)) continue;
      const scale = Math.pow(d / Math.max(1e-6, p.x0), 4);
      fx += (dx / d) * p.force * scale;
      fy += (dy / d) * p.force * scale;
    }

    const fm = Math.hypot(fx, fy);
    if (!U.pulls.length && speed0 > 0) {
      // Exact integration makes an isolated push stop at its distance-table value.
      const use = Math.min(dt, speed0 / UNBALANCE_FRICTION);
      const travel = speed0 * use - 0.5 * UNBALANCE_FRICTION * use * use;
      const ux = U.vx / speed0, uy = U.vy / speed0;
      const out = this._moveUnbalanced(e, ux * travel, uy * travel);
      const speed1 = Math.max(0, speed0 - UNBALANCE_FRICTION * use);
      U.vx = out.stopped ? 0 : ux * speed1;
      U.vy = out.stopped ? 0 : uy * speed1;
      return true;
    }

    let ax = fx, ay = fy;
    if (speed0 > 1e-9) {
      ax -= UNBALANCE_FRICTION * U.vx / speed0;
      ay -= UNBALANCE_FRICTION * U.vy / speed0;
    } else if (fm > UNBALANCE_FRICTION) {
      ax -= UNBALANCE_FRICTION * fx / fm;
      ay -= UNBALANCE_FRICTION * fy / fm;
    } else { ax = 0; ay = 0; }
    let nvx = U.vx + ax * dt, nvy = U.vy + ay * dt;
    let mdx, mdy;
    // A sub-friction external force cannot restart the body after kinetic friction brings it to rest. Integrate only
    // to that stop instant instead of letting a coarse 30 Hz step reverse and jitter around zero.
    if (speed0 > 1e-9 && fm <= UNBALANCE_FRICTION && U.vx * nvx + U.vy * nvy <= 0) {
      const ux = U.vx / speed0, uy = U.vy / speed0;
      const decel = Math.max(1e-9, -(ax * ux + ay * uy));
      const use = Math.min(dt, speed0 / decel);
      const travel = Math.max(0, speed0 * use - 0.5 * decel * use * use);
      mdx = ux * travel; mdy = uy * travel; nvx = 0; nvy = 0;
    } else {
      mdx = (U.vx + nvx) * 0.5 * dt; mdy = (U.vy + nvy) * 0.5 * dt;
    }

    // 急停: reaching any active stop circle kills velocity, but the force keeps the state alive until it expires.
    let cut = 1;
    for (const p of U.pulls) {
      const cx = fin(p.center?.x, fin(p.to?.x, e.x)), cy = fin(p.center?.y, fin(p.to?.y, e.y));
      const r = Math.max(0, p.stop), sx = e.x - cx, sy = e.y - cy;
      if (sx * sx + sy * sy <= r * r + 1e-9) { cut = 0; break; }
      const a = mdx * mdx + mdy * mdy;
      if (!(a > 1e-12)) continue;
      const b = 2 * (sx * mdx + sy * mdy), c = sx * sx + sy * sy - r * r;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t >= 0 && t <= cut) cut = t;
      }
    }
    if (cut < 1) { mdx *= cut; mdy *= cut; nvx = 0; nvy = 0; }
    const out = this._moveUnbalanced(e, mdx, mdy);
    U.vx = out.stopped ? 0 : nvx;
    U.vy = out.stopped ? 0 : nvy;
    return true;
  }

}
