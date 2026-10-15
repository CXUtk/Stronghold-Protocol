import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { configureIndividualBot, INDIVIDUAL_BOT_POLICY } from '../../server/match/bot-individual.js';
import { bindIndividualPersona, botPickBand } from '../../server/match/bot.js';
import { supportRehearsals } from '../../server/match/bot-support.js';

for (const humans of [1, 2, 3]) test(`selected individual policy supports ${4-humans} AI seats and reserves human draft choices`, () => {
  const { m } = makeMatch({ humans, bots: 4-humans, difficulty: 'ABYSS', seed: 1778 });
  try {
    assert.equal(configureIndividualBot(m, INDIVIDUAL_BOT_POLICY), true);
    assert.equal(m.botRehearsal, 8);
    assert.equal(m.botBuildPolicy, 'tanks');
    assert.equal(m.botLayoutBudgetPolicy, humans === 2 ? 'diverse-v1' : undefined);
    assert.equal(m.botArtilleryContactCandidates, humans === 2 ? true : undefined);
    assert.ok(m.botCombatAtlas.entries.chess_char_1_17_a);
    const human = m.order.find(p => !p.isBot), bot = m.order.find(p => p.isBot);
    m.draft = { picks: {}, focus: new Map([[human.playerId, 'band_ioleta']]) };
    assert.equal(botPickBand(m, bot), 'band_amedic');
    bot.bandId = 'band_amedic'; bindIndividualPersona(m, bot);
    assert.equal(bot.botPersona, 'touch_fallback');
    human.bandId = 'band_amiya'; human.autoplay = true; bindIndividualPersona(m, human);
    assert.equal(human.botPersona, null);
    assert.equal(supportRehearsals(m, human), 0, 'explicit test autoplay rehearsal budget remains unchanged');
    assert.equal(supportRehearsals(m, bot), 8);
  } finally { m.dispose(); }
});

test('legacy policy remains selectable for frozen replays and rollback without enabling diverse', () => {
  const { m } = makeMatch({ humans: 2, bots: 2, difficulty: 'ABYSS' });
  try {
    assert.equal(configureIndividualBot(m, 'terrain-parity-v12'), true);
    assert.equal(m.botIndividualPolicy, 'terrain-parity-v12');
    assert.equal(m.botLayoutBudgetPolicy, undefined);
    assert.equal(m.botRehearsal, 8);
  } finally { m.dispose(); }
});

test('the deployed v17 policy preserves its original candidate bank for comparison', () => {
  const { m } = makeMatch({ humans: 2, bots: 2, difficulty: 'ABYSS' });
  try {
    configureIndividualBot(m, 'diverse-parity-v17');
    assert.equal(m.botLayoutBudgetPolicy, 'diverse-v1');
    assert.equal(m.botArtilleryContactCandidates, undefined);
  } finally { m.dispose(); }
});

test('selected policy is opt-in at Match and excluded outside the evaluated mode', () => {
  for (const config of [{ humans: 1, bots: 3, difficulty: 'NORMAL' }, { humans: 1, bots: 1, difficulty: 'ABYSS' },
    { humans: 4, bots: 0, difficulty: 'ABYSS' }, { humans: 0, bots: 4, difficulty: 'ABYSS' }]) {
    const { m } = makeMatch(config);
    try { assert.equal(configureIndividualBot(m, INDIVIDUAL_BOT_POLICY), false); assert.equal(m.botIndividualPolicy, undefined); }
    finally { m.dispose(); }
  }
  const { m } = makeMatch({ humans: 1, bots: 3, difficulty: 'ABYSS' });
  try { assert.equal(m.botIndividualPolicy, undefined); assert.equal(configureIndividualBot(m, 'off'), false); }
  finally { m.dispose(); }
});
