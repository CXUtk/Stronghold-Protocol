import test from 'node:test';
import assert from 'node:assert/strict';
import { runSupportMatch } from '../tools/botbench/support-runner.mjs';
import { evaluateSupportCase, digest, chooseCandidate } from '../tools/botbench/support-evaluator.mjs';
import { applySupportCandidate, layoutFeatures } from '../tools/botbench/support-candidates.mjs';
import { getData } from '../server/data.js';

const config = { seed: 1, humans: 2, band: 'band_amiya', rounds: 3, rehearsal: 0, stageId: 'act2autochess_m03' };

test('formal baseline is identical to uninstrumented full normal/unite/settlement, including carry and gains', () => {
  const baseline = runSupportMatch(config);
  const result = evaluateSupportCase(config, { candidates: ['baseline'], formal: true });
  assert.deepEqual(result.results[0].row, baseline.rounds.at(-1));
  assert.ok(result.results[0].row.uniteRan);
  assert.ok(result.results[0].row.players.filter((p) => p.isBot).some((p) => p.carry.some((u) => u.hpPct < 1)));
});

test('candidate order does not alter checkpoint, seeds, results, final state or shared game data', () => {
  const dataBefore = digest(getData());
  const a = evaluateSupportCase(config, { candidates: ['baseline', 'balanced', 'sustain'], trialSeeds: [101] });
  const b = evaluateSupportCase(config, { candidates: ['sustain', 'balanced', 'baseline'], trialSeeds: [101] });
  assert.equal(a.checkpoint, b.checkpoint);
  assert.equal(a.prefixHash, b.prefixHash);
  for (const x of a.results) {
    const y = b.results.find((r) => r.candidate === x.candidate);
    assert.deepEqual(x.row, y.row);
    assert.equal(x.finalState, y.finalState);
    assert.deepEqual(x.edits, y.edits);
  }
  assert.equal(digest(getData()), dataBefore);
});

test('legal layout proposals preserve funds, owned cards, pool and all six RNG streams', () => {
  let checked = false;
  runSupportMatch(config, { beforeEndPrep(m) {
    if (m.round !== 3) return;
    const rng = () => ['Setup', 'Shop', 'Waves', 'Draft', 'Bots', 'Meta'].map((k) => m[`rng${k}`].state());
    const before = rng(), stock = digest(m.pool.entries);
    for (const p of m.order.filter((p) => p.isBot)) {
      const funds = p.funds, owned = p.allChess().map((u) => u.uid).sort();
      const r = applySupportCandidate(m, p, 'sustain');
      assert.equal(p.funds, funds);
      assert.deepEqual(p.allChess().map((u) => u.uid).sort(), owned);
      assert.equal(p.ready, true);
      assert.equal(r.rejected.length, 0);
      assert.ok(p.deployCount <= p.deployCap);
      for (const [key, piece] of p.board) assert.ok(p._legal(piece, ...key.split(',').map(Number)));
    }
    assert.deepEqual(rng(), before); assert.equal(digest(m.pool.entries), stock); checked = true;
  } });
  assert.ok(checked);
});

test('evaluation uses the real stage and normal-only layer gain flags for both phases', () => {
  const seen = [];
  runSupportMatch(config, { beforeEndPrep(m) {
    if (m.round !== config.rounds) return;
    const create = m.newBattle.bind(m);
    m.newBattle = (opts) => {
      seen.push({ kind: opts.kind, stageId: opts.stageId, modeId: opts.modeId, gains: opts.flags.layerGainsEnabled });
      return create(opts);
    };
  } });
  assert.equal(seen.filter((r) => r.kind === 'normal').length, 4);
  assert.equal(seen.filter((r) => r.kind === 'unite').length, 1);
  for (const s of seen) {
    assert.equal(s.stageId, config.stageId); assert.equal(s.modeId, 'mode_multi_abyss');
    assert.equal(s.gains, s.kind === 'normal');
  }
});

test('sustain proposal can legally deploy an owned reserve medic without creating cards or spending money', () => {
  let checked = false;
  runSupportMatch({ ...config, rounds: 1 }, { beforeEndPrep(m) {
    const p = m.order.find((p) => p.isBot);
    const heal = (rec) => rec?.attackKind === 'heal' || rec?.dmgType === 'heal';
    assert.ok(![...p.board.values()].some((u) => heal(p.gd.chess(u.id))));
    const id = p.gd.visibleChess.find((id) => heal(p.gd.chess(id)) && m.pool.has(id) && !p.allChess().some((u) => u.id === id));
    assert.ok(id);
    // Construct a reserve fixture explicitly; candidate code may only use this already-owned piece.
    p.setReady(false);
    p.acquireChess(id, { source: 'test' });
    assert.ok(p.hand.some((u) => u?.id === id));
    p.setReady(true);
    const owned = p.allChess().map((u) => u.uid).sort(), funds = p.funds, stock = digest(m.pool.entries);
    const result = applySupportCandidate(m, p, 'sustain');
    assert.equal(result.before.healers, 0); assert.equal(result.after.healers, 1);
    assert.equal(result.noOwnedMedic, false);
    assert.equal(result.rejected.length, 0);
    assert.deepEqual(p.allChess().map((u) => u.uid).sort(), owned);
    assert.equal(p.funds, funds); assert.equal(digest(m.pool.entries), stock);
    checked = true;
  } });
  assert.ok(checked);
});

const u = (uid, key, extra = {}) => ({ uid, key, cover: new Set([key]), block: 0, heal: false, hps: 0, dps: 0, air: false, terrain: null, terrainDamage: 70, ...extra });
test('terrain features distinguish hidden tanks with exposed backliners from protected backliners', () => {
  const model = { routes: [], ground: new Map([['10,6', {}]]), rangedTiles: [{ range: 3, tiles: ['10,7'] }] };
  const tank = u(1, '10,6', { block: 3, terrain: 'smog' }), back = u(2, '10,4');
  assert.equal(layoutFeatures(model, [tank, back]).hiddenTankRisk, 1);
  assert.equal(layoutFeatures(model, [{ ...tank, terrain: null }, back]).hiddenTankRisk, 0);
  assert.equal(layoutFeatures(model, [tank, { ...back, terrain: 'smog' }]).hiddenTankRisk, 0);
  assert.equal(layoutFeatures({ ...model, rangedTiles: [] }, [tank, back]).hiddenTankRisk, 0);
});

test('infection sustain needs actual range coverage; medic headcount alone is insufficient', () => {
  const model = { routes: [], ground: new Map([['10,6', {}]]), rangedTiles: [] };
  const tank = u(1, '10,6', { block: 3, terrain: 'infection' });
  const medic = u(2, '10,4', { heal: true, hps: 100 });
  assert.equal(layoutFeatures(model, [tank, medic]).uncoveredInfection, 1);
  assert.equal(layoutFeatures(model, [tank, { ...medic, cover: new Set(['10,6']) }]).uncoveredInfection, 0);
});

test('selection prioritizes human loss above own damage/HP, and rejects a non-2H2AI evaluation', () => {
  const results = [
    { candidate: 'terrain', metrics: { humanLoss: 1, eligible: 2, aiLeaks: 0, hpSum: 9 } },
    { candidate: 'baseline', metrics: { humanLoss: 0, eligible: 1, aiLeaks: 1, hpSum: 4 } },
  ];
  assert.equal(chooseCandidate(results), 'baseline');
  assert.throws(() => evaluateSupportCase({ ...config, humans: 1 }));
  assert.throws(() => evaluateSupportCase(config, { candidates: ['unknown'] }));
});
