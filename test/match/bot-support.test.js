import test from 'node:test';
import assert from 'node:assert/strict';
import { supportDraftBand, supportLevelCap, supportRehearsals } from '../../server/match/bot-support.js';
import { runSupportMatch } from '../../tools/botbench/support-runner.mjs';
import { runSupportPolicy } from '../../tools/botbench/support-policy.mjs';

function context() {
  const order = Array.from({ length: 4 }, (_, i) => ({ playerId: `p${i}`, isBot: i >= 2, bandId: null }));
  const m = { botSupportPolicy: 'team-medic-core', isSolo: false, modeId: 'mode_multi_abyss', order,
    round: 6, botRehearsal: 3, draft: { picks: {} }, gd: { bandAllowed: () => true } };
  m.bandTaken = (id) => Object.values(m.draft.picks).includes(id);
  return m;
}

test('support draft respects human choices, uniqueness and ordinary-policy fallback', () => {
  const m = context(), [h, , a, b] = m.order;
  assert.equal(supportDraftBand(m, h), null);
  assert.equal(supportDraftBand(m, a), 'band_amiya');
  m.draft.picks[h.playerId] = 'band_amiya';
  assert.equal(supportDraftBand(m, a), 'band_ioleta');
  m.draft.picks[a.playerId] = 'band_ioleta';
  assert.equal(supportDraftBand(m, b), 'band_amedic');
  m.draft.picks[h.playerId] = 'band_amedic';
  assert.equal(supportDraftBand(m, b), null);
  m.draft.picks = { p0: 'band_amiya', p1: 'band_ioleta' };
  assert.equal(supportDraftBand(m, a), null);
});

test('only the experimental core AI is capped; wave twelve, unavailable pair, other modes and autoplay use original rules', () => {
  const m = context(), [h, , a, b] = m.order;
  a.bandId = 'band_amiya'; b.bandId = 'band_amedic';
  assert.equal(supportLevelCap(m, a), 3);
  assert.equal(supportLevelCap(m, b), Infinity);
  assert.equal(supportLevelCap(m, h), Infinity);
  assert.equal(supportRehearsals(m, a), 5);
  assert.equal(supportRehearsals(m, h), 3);
  m.round = 12;
  assert.equal(supportLevelCap(m, a), Infinity);
  assert.equal(supportRehearsals(m, a), 3);
  m.round = 6; a.autoplay = true;
  assert.equal(supportLevelCap(m, a), Infinity);
  a.autoplay = false;
  for (const policy of ['', 'team-medic']) {
    m.botSupportPolicy = policy;
    assert.equal(supportLevelCap(m, a), Infinity);
    assert.equal(supportRehearsals(m, a), 3);
  }
  m.botSupportPolicy = 'team-medic-core';
  for (const id of ['mode_multi_normal', 'mode_single_abyss']) {
    m.modeId = id;
    assert.equal(supportDraftBand(m, a), null);
    assert.equal(supportLevelCap(m, a), Infinity);
  }
  m.modeId = 'mode_multi_abyss'; b.isBot = false;
  assert.equal(supportDraftBand(m, a), null);
  b.isBot = true; b.bandId = 'band_sarkazb';
  assert.equal(supportLevelCap(m, a), Infinity);
});

test('native opt-in decisions reproduce the offline candidate full combat and cooperative settlement', () => {
  for (const band of ['band_amiya', 'band_ioleta']) {
    const config = { seed: 11, humans: 2, band, rounds: 11, stageId: 'act2autochess_m03', leakCount: 2, sourceMode: 'all' };
    const fixtures = runSupportMatch(config).fixtureInputs;
    for (const policy of ['team-medic', 'team-medic-core']) {
      const opts = { ...config, humanFixtures: fixtures };
      const offline = runSupportPolicy(opts, policy);
      const native = runSupportMatch({ ...opts, nativePolicy: policy });
      assert.deepEqual(native.rounds, offline.rounds, `${band} ${policy}`);
      assert.deepEqual(native.players, offline.players);
      assert.deepEqual(native.fixtureInputs, fixtures);
    }
  }
});
