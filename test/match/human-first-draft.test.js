import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, ERR } from '../../shared/constants.js';
import { makeMatch, checkInvariants } from './harness.js';

function startBand(h) {
  h.start();
  for (const ps of h.m.order) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.infoReady' });
  h.sched.advance(1);
  assert.equal(h.m.phase, PHASE.BAND_DRAFT);
}

function humanFirst(h, order) {
  let aiSeen = false;
  for (const pid of order) {
    if (h.ps(pid).botControlled) aiSeen = true;
    else assert.equal(aiSeen, false, `${pid} must precede every AI-controlled seat`);
  }
}

test('strategy drafts keep humans first across seeds, including a human skipping their turn', () => {
  const humanOrders = new Set();
  for (let seed = 1; seed <= 16; seed++) {
    const h = makeMatch({ humans: 2, bots: 2, seed, fake: true });
    try {
      startBand(h);
      const m = h.m;
      humanFirst(h, m.draft.order);
      const [a, b, ...bots] = m.draft.order;
      humanOrders.add(`${a},${b}`);
      assert.deepEqual(m.pickBand(h.ps(bots[0]), 'band_amiya'), { error: ERR.NOT_YOUR_TURN });
      assert.deepEqual(m.handle(a, { t: 'g.bandSkip' }), { ok: true });
      assert.deepEqual(m.draft.order, [b, a, ...bots]);
      h.sched.advance(100);
      assert.deepEqual(m.draft.picks, {}, 'AI does not take a strategy while humans are still choosing');
      assert.deepEqual(m.handle(b, { t: 'g.band', bandId: 'band_amiya' }), { ok: true });
      assert.equal(m.handle(a, { t: 'g.bandSkip' }).error, ERR.ALREADY);
      assert.deepEqual(m.handle(a, { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
      h.runToPhase(PHASE.BATTLE_CHECK);
      assert.equal(Object.keys(m.draft.picks).length, 4);
      assert.equal(new Set(Object.values(m.draft.picks)).size, 4);
      checkInvariants(m);
    } finally { h.m.dispose(); }
  }
  assert.equal(humanOrders.size, 2, 'human order remains random');
});

test('the last human cannot skip behind AI or consume a skip with nobody to pass to', () => {
  const h = makeMatch({ humans: 1, bots: 3, seed: 2, fake: true });
  try {
    startBand(h);
    assert.equal(h.m.draftTurn(), 'p_0');
    assert.equal(h.m.handle('p_0', { t: 'g.bandSkip' }).error, ERR.BAD_TARGET);
    assert.equal(h.m.draft.skipsLeft.p_0, 1);
    h.sched.advance(60_000);
    assert.deepEqual(h.m.draft.picks, {}, 'an untimed human decision keeps AI waiting');
  } finally { h.m.dispose(); }
});

test('机变 choices in every round put humans ahead of AI and advance after human picks or timeouts', () => {
  for (const [difficulty, round] of [['NORMAL', 3], ['NORMAL', 6], ['NORMAL', 9], ['HARD', 11]]) {
    const h = makeMatch({ humans: 2, bots: 2, difficulty, seed: round, fake: true });
    try {
      h.start();
      h.toPrep(1);
      h.m.startRound(round);
      h.runToPhase(PHASE.SP_DRAFT, round);
      const m = h.m;
      const sp = m.sp;
      humanFirst(h, sp.order);
      const [a, b, ...bots] = sp.order;
      h.sched.advance(1000);
      assert.deepEqual(m.sp.picks, {}, 'AI waits for both human decisions');
      assert.equal(m.pickCard(h.ps(bots[0]), 0).error, ERR.NOT_YOUR_TURN);
      assert.deepEqual(m.handle(a, { t: 'g.choice', idx: 0 }), { ok: true });
      h.sched.advance(1000);
      assert.deepEqual(Object.keys(m.sp.picks), [a]);
      // The second human times out. The bots then take only remaining cards.
      h.runToPhase(PHASE.PREP, round);
      assert.equal(Object.keys(sp.picks).length, 4);
      assert.equal(new Set(Object.values(sp.picks)).size, 4);
      assert.notEqual(sp.picks[b], 0);
      assert.deepEqual(Object.keys(sp.picks).slice(0, 2), [a, b]);
      checkInvariants(m);
    } finally { h.m.dispose(); }
  }
});

test('turning AI control on yields to pending humans; restoring manual control cannot be overtaken by a queued AI pick', () => {
  for (const phase of [PHASE.BAND_DRAFT, PHASE.SP_DRAFT]) {
    const h = makeMatch({ humans: 2, bots: 2, seed: 8, fake: true });
    try {
      startBand(h);
      if (phase === PHASE.SP_DRAFT) { h.toPrep(1); h.m.startRound(3); h.runToPhase(phase, 3); }
      const m = h.m;
      const d = phase === PHASE.BAND_DRAFT ? m.draft : m.sp;
      const [a, b] = d.order;
      const pick = (pid, idx) => m.handle(pid, phase === PHASE.BAND_DRAFT
        ? { t: 'g.band', bandId: ['band_amiya', 'band_bldsk'][idx] } : { t: 'g.choice', idx });
      assert.deepEqual(m.handle(a, { t: 'g.autoplay', on: true }), { ok: true });
      assert.equal(d.order[d.idx], b, 'the AI-controlled current seat yields to the other human');
      assert.deepEqual(pick(b, 0), { ok: true });
      assert.deepEqual(m.handle(a, { t: 'g.autoplay', on: false }), { ok: true });
      h.sched.advance(1000);
      assert.equal(d.order[d.idx], a);
      assert.deepEqual(Object.keys(d.picks), [b], 'queued AI callbacks do not overtake the restored human');
      assert.deepEqual(pick(a, 1), { ok: true });
      h.runToPhase(phase === PHASE.BAND_DRAFT ? PHASE.BATTLE_CHECK : PHASE.PREP);
      assert.equal(Object.keys(d.picks).length, 4);
      checkInvariants(m);
    } finally { h.m.dispose(); }
  }
});

test('an eliminated pending human is skipped; an all-AI draft still finishes', () => {
  const h = makeMatch({ humans: 2, bots: 2, seed: 8, fake: true }).start();
  try {
    h.toPrep(1);
    h.m.startRound(3);
    h.runToPhase(PHASE.SP_DRAFT, 3);
    const sp = h.m.sp;
    const [a, b] = sp.order;
    h.m.onLeave(b);
    assert.deepEqual(h.m.handle(a, { t: 'g.choice', idx: 0 }), { ok: true });
    h.runToPhase(PHASE.PREP, 3);
    assert.equal(Object.keys(sp.picks).length, 3);
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
  const ai = makeMatch({ humans: 0, bots: 4, seed: 8, fake: true }).start();
  try {
    ai.runToPhase(PHASE.BATTLE_CHECK);
    assert.equal(Object.keys(ai.m.draft.picks).length, 4);
    ai.m.startRound(3);
    ai.runToPhase(PHASE.SP_DRAFT, 3);
    const sp = ai.m.sp;
    ai.runToPhase(PHASE.PREP, 3);
    assert.equal(Object.keys(sp.picks).length, 4);
    checkInvariants(ai.m);
  } finally { ai.m.dispose(); }
});
