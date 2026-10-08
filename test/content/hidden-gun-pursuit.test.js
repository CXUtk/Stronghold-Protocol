// Regression coverage for 隐秘核心铳: pair-field pursuit must not always be owned by the last-spawned gun.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import * as enemies from '../../server/sim/content/enemies.js';
import * as bosses from '../../server/sim/content/bosses.js';

const W = JSON.parse(fs.readFileSync(new URL('../../data/waves.json', import.meta.url), 'utf8'));
const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const GUN = 'enemy_9017_achunt_2';
const SPRING = 'enemy_9020_actrpc';
const wall = chessRec({ id: 'pursuit_wall', profession: 'TANK', stats: { maxHp: 1e9, atk: 0, def: 1000, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });

function arena({ solo = false, manual = false, cooldown = null } = {}) {
  const tpl = structuredClone(W[solo ? 'act1autochess_h08_02_s' : 'act1autochess_h08_02']);
  tpl.spawns = manual ? [] : tpl.spawns.filter((s) => s.tag === 'boss' || s.tag === 'part');
  if (cooldown != null) {
    tpl.overrides[GUN] ??= { skills: structuredClone(E[GUN].skills) };
    const skill = tpl.overrides[GUN].skills.find((s) => s.prefabKey === '2');
    skill.initCooldown = 0;
    skill.cooldown = cooldown;
  }
  return makeBattle({
    kind: 'hidden', waveTemplate: tpl, content: 'generic', extraContent: [enemies, bosses], seed: 7,
    autoFinish: false, timeLimit: 300, recordEvents: false, hooks: [],
    defs: { chess: { pursuit_wall: wall } }, kits: { pursuit_wall: () => ({ trait: { noAttack: true } }) },
    sharedBoss: { hp: 1e12, maxHp: 1e12, damage(pid, n) { this.hp -= n; } },
    players: [
      { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, chessId: 'pursuit_wall', row: 3, col: 5, abs: true }] },
      ...solo ? [] : [{ playerId: 'p2', seat: 1, side: 'R', colOffset: 8, units: [{ uid: 2, chessId: 'pursuit_wall', row: 3, col: 15, abs: true }] }],
    ],
    setup(b) { b.enemyOverrides = tpl.overrides; b.opts.waveTemplate = tpl; b.opts.bossMirror = !manual; },
  });
}

test('隐秘核心铳: paired calls alternate without overwriting pursuit, retaining each gun\'s 45 s cooldown', () => {
  const h = arena();
  const calls = [];
  let last = null;
  h.b.on('tick', () => {
    const spring = h.enemies().find((e) => e.defId === SPRING);
    const d = spring?.mem.ab.dash;
    if (!d || d === last) return;
    last = d;
    calls.push({ time: h.b.time, gun: d.gun.id, side: d.gun.x < 10 ? 'L' : 'R' });
  });
  h.run(150);
  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map((c) => c.side), ['L', 'R', 'L', 'R', 'L', 'R']);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].time - calls[i - 1].time > 5, 'previous pursuit has finished');
  for (let i = 2; i < calls.length; i++) assert.ok(Math.abs(calls[i].time - calls[i - 2].time - 45) < h.TICK * 2);
  assert.equal(h.b.errorCount, 0);
  checkInvariants(h.b);
});

test('隐秘核心铳: all three springs visit both halves with defenders on each side', () => {
  const h = arena();
  const sides = new Map();
  h.b.on('tick', () => {
    for (const e of h.enemies()) {
      if (!/enemy_90(18|19|20)_actrp/.test(e.defId)) continue;
      if (!sides.has(e.defId)) sides.set(e.defId, new Set());
      if (e.x < 9.5) sides.get(e.defId).add('L');
      if (e.x > 10.5) sides.get(e.defId).add('R');
    }
  });
  h.run(240);
  assert.equal(sides.size, 3);
  for (const [key, visited] of sides) assert.deepEqual(visited, new Set(['L', 'R']), `${key}: neither half is starved`);
  assert.equal(h.b.errorCount, 0);
  checkInvariants(h.b);
});

test('隐秘核心铳: reaching a moving gun keeps pursuit, invulnerability and disarm for the full 5 s', () => {
  const h = arena({ solo: true, manual: true, cooldown: 45 });
  h.step();
  const gun = h.spawn(GUN, { pos: [3, 5], tag: 'boss', mods: { speedMul: 0 } });
  const spring = h.spawn(SPRING, { pos: [3, 4.8], tag: 'part' });
  h.step(2);
  const d = spring.mem.ab.dash;
  assert.ok(d, 'nearby arrival must not end pursuit');
  h.run(1);
  gun.x = 6;
  const oldX = spring.x;
  h.run(1);
  assert.ok(spring.x > oldX, 'continues following when the gun moves');
  assert.equal(spring.mem.ab.dash, d);
  assert.ok(spring.s.flags.invulnerable && spring.s.flags.disarm);
  h.run(d.until - h.b.time - h.TICK * 2);
  assert.equal(spring.mem.ab.dash, d);
  assert.ok(spring.s.flags.invulnerable && spring.s.flags.disarm);
  h.run(h.TICK * 4);
  assert.equal(spring.mem.ab.dash, null);
  assert.ok(!spring.s.flags.invulnerable && !spring.s.flags.disarm);
  assert.equal(h.b.errorCount, 0);
});

test('隐秘核心铳: an overlapping ready call waits for the active pursuit to finish', () => {
  const h = arena({ manual: true, cooldown: 45 });
  h.step();
  const left = h.spawn(GUN, { pos: [3, 5], tag: 'boss', mods: { speedMul: 0 } });
  const right = h.spawn(GUN, { pos: [3, 15], tag: 'boss', mods: { speedMul: 0 } });
  const spring = h.spawn(SPRING, { pos: [3, 10], tag: 'part' });
  h.step(2);
  const d = spring.mem.ab.dash;
  assert.equal(d.gun, left);
  // Force the other call ready during pursuit (for example, a late spawn / a delayed first cast).
  const call = right.mem.ab.list.find((a) => a.cd === 45 && a.fire);
  call.left = 0;
  h.run(3);
  assert.equal(spring.mem.ab.dash, d, 'later gun cannot replace a live pursuit');
  assert.notEqual(spring.mem.ab.dash.gun, right);
  assert.ok(spring.s.flags.invulnerable && spring.s.flags.disarm);
  h.run(2.2);
  assert.equal(spring.mem.ab.dash.gun, right, 'pending call fires after the full first pursuit');
  assert.equal(h.b.errorCount, 0);
});

test('隐秘核心铳: solo keeps the template initial cooldown and repeated call timing', () => {
  const h = arena({ solo: true });
  const calls = [];
  let last = null;
  h.b.on('tick', () => {
    const spring = h.enemies().find((e) => e.defId === SPRING);
    const d = spring?.mem.ab.dash;
    if (!d || d === last) return;
    last = d;
    calls.push(h.b.time);
  });
  h.run(100);
  assert.equal(calls.length, 2);
  const tpl = W.act1autochess_h08_02_s;
  const spawnTime = tpl.spawns.find((s) => s.tag === 'boss').time;
  const skill = (tpl.overrides[GUN]?.skills ?? E[GUN].skills).find((s) => s.prefabKey === '2');
  assert.ok(Math.abs(calls[0] - spawnTime - skill.initCooldown) < h.TICK * 2);
  assert.ok(Math.abs(calls[1] - calls[0] - skill.cooldown) < h.TICK * 2);
  assert.equal(h.b.errorCount, 0);
});
