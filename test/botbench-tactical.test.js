import test from 'node:test';
import assert from 'node:assert/strict';
import { runSupportMatch } from '../tools/botbench/support-runner.mjs';
import { carryScore, installTacticalPolicy, rehearsalContext, terrainAdjustment } from '../tools/botbench/tactical-policy.mjs';
import { observeBattle } from '../tools/botbench/battle-observer.mjs';

test('helper health never outweighs a counted leak; uncounted parts do not penalize', () => {
  const healthy = { unitsEnd: Array.from({ length: 100 }, () => ({ alive: true, hpPct: 1 })), killed: 10000 };
  assert.ok(carryScore({ ...healthy, leaked: [{}] }) < carryScore({ unitsEnd: [], leaked: [] }));
  assert.equal(carryScore({ ...healthy, leaked: [{ counted: false }] }), carryScore(healthy));
  assert.ok(carryScore(healthy) > carryScore({ ...healthy, unitsEnd: [{ alive: false, hpPct: 1 }] }));
});

const config = { seed: 11, humans: 2, band: 'band_amiya', partnerBand: 'band_amedic', rounds: 4,
  stageId: 'act1autochess_m04', rehearsal: 5 };
test('public rehearsal context restores teammate map medics and trials cannot settle layers into the match', () => {
  const trials = [], snapshots = [];
  const run = () => runSupportMatch({ ...config, rounds: 7 }, { configure(m) {
    installTacticalPolicy(m, { tactical: 'live' }, trials);
    const original = m.newBattle.bind(m);
    m.newBattle = (opts) => {
      const before = JSON.stringify(m.order.map((p) => ({ layers: p.layers, funds: p.funds, round: p.round })));
      const b = original(opts);
      if (opts.fieldId.startsWith('r:')) {
        const ctx = rehearsalContext(m, m.players.get(opts.players[0].playerId));
        assert.ok(ctx.matchBands.includes('band_amedic'));
        assert.equal(ctx.teammates.length, 3);
        snapshots.push(before);
        // Force a trial-only gain to prove isolation without depending on which cards the shop offers.
        assert.equal(b.addLayers(opts.players[0].playerId, 'siracusaShip', 1, 'test'), 1);
        b.result();
        assert.equal(JSON.stringify(m.order.map((p) => ({ layers: p.layers, funds: p.funds, round: p.round }))), before);
      }
      return b;
    };
  } });
  const first = run(), repeat = run();
  assert.deepEqual(first.rounds, repeat.rounds);
  assert.ok(snapshots.length > 0);
  assert.ok(trials.some((t) => t.pid === first.anchorPid && t.mapMedics.length > 0));
  assert.ok(trials.some((t) => Object.values(t.players).some((p) => Object.values(p.gains || {}).some((n) => n > 0))));
  assert.deepEqual(first.errors, []);
});

test('read-only observer preserves complete match outcomes and distinguishes covered injuries', () => {
  const snapshots = [], base = runSupportMatch(config);
  const observed = runSupportMatch(config, { configure(m) {
    const original = m.newBattle.bind(m);
    m.newBattle = (opts) => { const b = original(opts); if (!opts.fieldId.startsWith('r:')) snapshots.push(observeBattle(b)); return b; };
  } });
  assert.deepEqual(observed.rounds, base.rounds);
  const units = snapshots.flatMap((f) => f().units);
  assert.ok(units.some((u) => u.receivedHeal > 0));
  assert.ok(units.some((u) => u.injuredSeconds > u.uncoveredSeconds));
});

test('terrain proposal uses actual map medic tile/range and shares finite healing capacity', () => {
  const cover = new Set(['9,5']), rec = { chessId: 'healer' };
  const unit = { key: '9,5', block: 1, cover: new Set(), rec: {} };
  const m = { botCombatAtlas: { entries: { healer: { profiles: { soft: { hps: 100 } } } } },
    stage: { rows: { 9: '.....i' }, tiles: { i: { special: 'infection' } }, special: { infection: { bb: { damage: 70 } } } }, alivePlayers: () => [] };
  const model = { ground: new Map([['9,5', {}]]) };
  assert.ok(terrainAdjustment(m, {}, [unit], model) < terrainAdjustment(m, {}, [unit, { heal: true, key: '10,5', cover, rec }], model));
  const before = terrainAdjustment(m, {}, [unit], model);
  m.alivePlayers = () => [{ bandId: 'band_amedic' }];
  m.stage.mapChars = [{ key: 'char_605_cmedic', pos: [9, 4], dir: 'RIGHT' }];
  m.botCombatAtlas.mapMedics = { char_605_cmedic: 100 };
  const ps = { board: new Map(), gd: { token: () => ({ rangeGrid: [[0, 0], [0, 1]] }) } };
  assert.ok(terrainAdjustment(m, ps, [unit], model) > before);
  m.stage.mapChars[0].dir = 'LEFT';
  assert.equal(terrainAdjustment(m, ps, [unit], model), before);
});

test('hazard proposals only add layout work on maps with infection terrain', () => {
  const m = { stage: { rows: Array(13).fill('..'), tiles: { '.': {}, i: { special: 'infection' } } }, newBattle() {} };
  installTacticalPolicy(m, { tactical: 'hazard' }, []);
  assert.equal(m.botLayoutAdjustment, undefined);
  assert.equal(m.botRehearsalScore, carryScore);
  m.stage.rows[9] = '.i';
  installTacticalPolicy(m, { tactical: 'hazard' }, []);
  assert.equal(typeof m.botLayoutAdjustment, 'function');
});
