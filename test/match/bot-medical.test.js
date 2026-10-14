import test from 'node:test';
import assert from 'node:assert/strict';
import { botPrepBegin, arrange, buyScoreOf } from '../../server/match/bot.js';
import { medicalPolicy } from '../../server/match/bot-medical.js';
import { makeMatch, give } from './harness.js';

// A healer-free development board, retaining its duplicate pair and active bond choices.
const IDS = ['chess_char_1_17_b', 'chess_char_1_07_a', 'chess_char_1_09_a', 'chess_char_1_08_a',
  'chess_char_1_08_a', 'chess_char_2_08_a', 'chess_char_1_02_a', 'chess_char_1_14_a'];
const MEDIC = 'chess_char_2_05_a';
function fixture(policy) {
  const { m } = makeMatch({ humans: 2, bots: 2, difficulty: 'ABYSS', seed: 11 }).start().toPrep();
  const ps = m.order.find((p) => p.isBot);
  m.round = 4; m.botMedicalPolicy = policy;
  for (const p of m.order) p.bandId = null;
  ps.bandId = 'band_amiya';
  for (const u of ps.allChess()) ps.sell(u.uid);
  ps.offers = [];
  IDS.forEach((id) => give(m, ps, id)); arrange(m, ps);
  ps.shop.level = 2; ps.shop.upgradePrice = 999; ps.funds = 3;
  ps.shop.slots = [{ kind: 'chess', id: MEDIC, basePrice: 3, sold: false }];
  ps.refresh = () => ({ ok: false }); // one controlled offer, not a shop lottery
  return { m, ps };
}

test('a higher buy score alone cannot admit a healer through the full-board lineup gate', () => {
  for (const policy of ['', 'buy', 'lineup', 'complete']) {
    const { m, ps } = fixture(policy);
    try {
      const before = ps.funds;
      botPrepBegin(m, ps);
      const admitted = policy === 'lineup' || policy === 'complete';
      assert.equal(ps.shop.slots[0].sold, admitted, policy);
      assert.equal([...ps.board.values()].some((p) => p.id === MEDIC), admitted, policy);
      if (admitted) assert.ok(ps.funds < before, 'pays the normal price rather than receiving an invented healer');
      assert.ok(ps.deployCount <= ps.deployCap);
    } finally { m.dispose(); }
  }
});

test('medical buying bonus ends after owning a healer; alive Touch, human autoplay and other modes get no override', () => {
  const { m, ps } = fixture('buy');
  try {
    const boosted = buyScoreOf(m, ps, MEDIC);
    m.botMedicalPolicy = '';
    assert.ok(boosted > buyScoreOf(m, ps, MEDIC));
    give(m, ps, 'chess_char_2_02_a');
    const existing = buyScoreOf(m, ps, MEDIC);
    m.botMedicalPolicy = 'buy';
    assert.equal(buyScoreOf(m, ps, MEDIC), existing);
    const mate = m.order.find((p) => p !== ps && p.isBot);
    mate.bandId = 'band_amedic';
    assert.equal(medicalPolicy(m, ps), null);
    mate.alive = false;
    assert.ok(medicalPolicy(m, ps));
    ps.autoplay = true;
    assert.equal(medicalPolicy(m, ps), null);
    ps.autoplay = false; m.round = 12;
    assert.equal(medicalPolicy(m, ps), null);
    m.round = 4; m.modeId = 'mode_multi_normal';
    assert.equal(medicalPolicy(m, ps), null);
    m.modeId = 'mode_multi_abyss'; m.order[0].autoplay = true;
    assert.equal(medicalPolicy(m, m.order[0]), null);
  } finally { m.dispose(); }
});
