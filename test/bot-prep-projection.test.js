import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runSupportMatch } from '../tools/botbench/support-runner.mjs';
import { forkPreparation, projectNormalBattleOptions } from '../server/match/bot-prep-projection.js';
import { createRegistry } from '../server/match/effectsMeta.js';
import { createRehearsal } from '../server/match/bot.js';

function state(m) {
  const player = p => Object.fromEntries(Object.entries(p).filter(([k, v]) =>
    !['m', 'gd'].includes(k) && typeof v !== 'function'));
  const value = { players: m.order.map(player), pool: m.pool.entries, uid: m.uidSeq,
    rng: Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith('rng')).map(([k, v]) => [k, v.state()])),
    phase: m.phase, errors: m.dispatcher.errors, timers: m.sched.pending() };
  return createHash('sha256').update(JSON.stringify(value, (_, v) =>
    v instanceof Map ? [...v] : v instanceof Set ? [...v] : v)).digest('hex');
}
const config = { seed: 11, humans: 2, band: 'band_amiya', partnerBand: 'band_amedic',
  rounds: 7, rehearsal: 0, stageId: 'act1autochess_m04' };

test('projection matches formal prep-end/battle-start for every seat without changing live state', () => {
  let compared = 0, expected = new Map();
  const result = runSupportMatch(config, {
    configure(m) {
      // Seat ordering and preview:false matter: consume a shared RNG in both hooks and grant a
      // real item through pool/inventory code, in addition to the normal content hooks.
      m.registry = createRegistry();
      m.registry.global('projectionProbe', {
        onPrepEnd(ctx) {
          ctx.setCounter('projectionRng', ctx.rng.int(100000));
          ctx.grantItem('chess_item_1_03_e_a');
          ctx.addLayers('steadShip', 5);
        },
        onBattleStart(ctx, ev) {
          if (ev.kind !== 'normal') return;
          assert.equal(ev.preview, false);
          ev.input.projectionProbe = [ctx.counter('projectionRng'), ctx.rng.int(100000), ctx.funds()];
        },
      });
      m.dispatcher.registry = m.registry;
      const original = m.newBattle.bind(m);
      m.newBattle = opts => {
        if (opts.fieldId?.startsWith('n:')) {
          assert.deepEqual(opts, expected.get(opts.players[0].playerId));
          compared++;
        }
        return original(opts);
      };
    },
    beforeEndPrep(m) {
      expected = new Map();
      for (const p of m.alivePlayers()) {
        const before = state(m);
        const a = projectNormalBattleOptions(m, p);
        assert.equal(state(m), before);
        assert.deepEqual(projectNormalBattleOptions(m, p), a);
        assert.equal(state(m), before);
        expected.set(p.playerId, a);
      }
      const { match: fork } = forkPreparation(m);
      assert.notEqual(fork.pool, m.pool);
      assert.notEqual(fork.pool.entries, m.pool.entries);
      assert.notEqual(fork.order[0].board, m.order[0].board);
      assert.equal(fork.itemPool.players(), fork.order);
      assert.equal(fork.order[0].m, fork);
      fork.sched.dispose();
    },
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.ok(compared >= 20);
});

test('failed candidate setup and failed prep hooks never escape the fork', () => {
  let checked = false;
  const result = runSupportMatch({ ...config, rounds: 1 }, {
    beforeEndPrep(m) {
      const p = m.order[2], before = state(m);
      assert.throws(() => projectNormalBattleOptions(m, p, (trial, player) => {
        player.hand.length = 0;
        player.layers.steadShip = 999;
        trial.rngMeta();
        trial.uidSeq++;
        throw new Error('candidate failed');
      }), /candidate failed/);
      assert.equal(state(m), before);
      const registry = m.registry;
      m.registry = createRegistry();
      m.registry.global('projectionFailure', { onPrepEnd() { throw new Error('hook failed'); } });
      assert.throws(() => projectNormalBattleOptions(m, p), /projection hook failure/);
      m.registry = registry;
      assert.equal(state(m), before);
      checked = true;
    },
  });
  assert.deepEqual(result.errors, []);
  assert.ok(checked);
});

test('real candidate placement and completed rehearsals leave inventory, directions and RNG intact', () => {
  let checked = 0;
  const result = runSupportMatch({ ...config, rounds: 3 }, {
    beforeEndPrep(m) {
      const p = m.order[2], chosen = [...p.board.values()].filter(u => u.kind === 'chess');
      if (!chosen.length) return;
      const plans = ['RIGHT', 'LEFT'].map(dir => {
        const plan = new Map([...p.board].filter(([, u]) => chosen.includes(u)).map(([k, u]) => [u.uid, k]));
        plan.dirs = new Map(chosen.map(u => [u.uid, dir]));
        return plan;
      });
      const before = state(m), rehearsal = m.botRehearsal;
      m.botProjectPrepEnd = true;
      m.botRehearsal = 2;
      const job = createRehearsal(m, p, chosen, plans);
      assert.ok(job);
      assert.equal(state(m), before);
      job.run();
      assert.ok(job.done);
      assert.equal(state(m), before);
      m.botRehearsal = rehearsal;
      delete m.botProjectPrepEnd;
      checked++;
    },
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(checked, 3);
});
