import test from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../server/data.js';
import { probeUnit, PROBES } from '../tools/botbench/combat-atlas.mjs';
import { chooseCounterSkills, installCounterSkills } from '../tools/botbench/skill-policy.mjs';
import { makeMatch, give } from './match/harness.js';
import { buildContext } from '../server/match/bot-build.js';
import { arrange, itemTarget, personaAllowsItem, rangeRec } from '../server/match/bot.js';

test('skill probes run the selected kit; Texas S1 silences while S3 does not', () => {
  const data = JSON.stringify(getData());
  const a = probeUnit('chess_char_4_16_a', 'reflection', { skillIndex: 0 });
  const b = probeUnit('chess_char_4_16_a', 'reflection', { skillIndex: 2 });
  assert.equal(a.actualSkill, 'skchr_texas2_1'); assert.equal(b.actualSkill, 'skchr_texas2_3');
  assert.ok(a.silenceUptime > .2); assert.equal(b.silenceUptime, 0);
  assert.ok(a.dps60 > b.dps60);
  assert.throws(() => probeUnit('chess_char_4_16_a', 'soft', { skillIndex: 99 }), /Unknown skill/);
  assert.equal(JSON.stringify(getData()), data);
});

function pilotAtlas(gd) {
  const profiles = (dps, silence) => Object.fromEntries(Object.keys(PROBES).map((k) => [k,
    { dps20: dps, dps60: dps, hps: 0, silenceUptime: silence, defReduction: 0, resReduction: 0 }]));
  const id = 'chess_char_4_16_a', golden = gd.chess(id).goldenId;
  const variants = { 0: { profiles: profiles(400, 1) }, 1: { profiles: profiles(150, 0) }, 2: { profiles: profiles(100, 0) } };
  return { entries: { [id]: variants[2], [golden]: variants[2] }, skillVariants: { [id]: variants, [golden]: variants } };
}

test('offline skill selection is public-only, validated, shared by normal/elite, and locked before preparation', () => {
  const h = makeMatch({ humans: 2, bots: 2, difficulty: 'ABYSS', seed: 11 }), { m } = h;
  try {
    const atlas = pilotAtlas(m.gd);
    const faction = Object.entries(m.gd.factions.types).find(([, f]) => f.pool?.some((id) =>
      m.gd.enemy(id)?.talents?.bb?.['refracting.magic_resistance'] > 0 || m.gd.enemy(id)?.talents?.bb?.['Refracting.magic_resistance'] > 0))[0];
    assert.deepEqual(chooseCounterSkills(m.gd, atlas, []).entries, {});
    m.factions = [faction];
    const rec = {}; installCounterSkills(m, atlas, rec);
    const ps = m.order.find((p) => p.isBot), id = 'chess_char_4_16_a';
    assert.equal(ps.loadoutFor(m.gd.chess(id)).skillIndex, 0);
    assert.equal(ps.loadoutFor(m.gd.chess(m.gd.chess(id).goldenId)).skillIndex, 0);
    assert.ok(Object.isFrozen(ps.loadout) && Object.isFrozen(ps.loadout[id]));
    assert.equal(m.order.find((p) => !p.isBot).loadout[id], undefined);
    assert.equal(ps.setLoadout({ [id]: { skill: 1 } }), false, 'production bot API remains disabled');
    h.start().toPrep();
    assert.throws(() => installCounterSkills(m, atlas, {}), /before match start/);
    m.botBuildPolicy = 'enemy-sustain'; m.botCombatAtlas = atlas;
    assert.equal(buildContext(m, ps, { armor: [] }).entries[id], atlas.skillVariants[id][0]);
    const piece = give(m, ps, id);
    // The battle serializer, not just scoring, must receive the chosen skill.
    const tile = [...ps.board.keys()][0];
    if (tile) ps.board.delete(tile);
    ps.board.set('10,3', { ...piece, kind: 'chess', id, uid: 99991, dir: 'RIGHT' });
    assert.equal(ps.battleInput().units.find((u) => u.uid === 99991).skillIndex, 0);
  } finally { m.dispose(); }
});

test('range cache distinguishes selected skills', () => {
  const rec = getData().chess.chess_char_4_16_a;
  const ps = { loadoutFor: () => ({ skillIndex: 0, moduleId: null }) };
  rangeRec(ps, rec);
  ps.loadoutFor = () => ({ skillIndex: 2, moduleId: null }); rangeRec(ps, rec);
  assert.equal(ps._botRangeRecs.size, 2);
});

test('counter equipment uses public factions early; original persona still waits for a reflection wave', () => {
  const h = makeMatch({ humans: 2, bots: 2, difficulty: 'ABYSS', seed: 11 }).start().toPrep(), { m } = h;
  try {
    const ps = m.order.find(p => p.isBot); ps.botPersona = 'amiya_fallback'; ps._botPersona = null;
    const faction = Object.entries(m.gd.factions.types).find(([, f]) => f.pool?.includes('enemy_1166_dusbr'))[0];
    m.factions = [faction]; m.wave = { spawns: [] };
    assert.equal(personaAllowsItem(m, ps, 'chess_item_3_08_e_a'), false);
    m.botCounterEquipment = { early: true };
    assert.equal(personaAllowsItem(m, ps, 'chess_item_3_08_e_a'), true);
    m.factions = [];
    assert.equal(personaAllowsItem(m, ps, 'chess_item_3_08_e_a'), false);
  } finally { m.dispose(); }
});

test('route-aware equipment avoids duplicating silence on an already equipped attacker', () => {
  const h = makeMatch({ humans: 2, bots: 2, difficulty: 'ABYSS', seed: 11 }).start().toPrep(), { m } = h;
  try {
    const ps = m.order.find(p => p.isBot);
    for (const u of ps.allChess()) ps.sell(u.uid);
    give(m, ps, 'chess_char_1_17_a'); give(m, ps, 'chess_char_1_17_a'); arrange(m, ps);
    const units = [...ps.board.values()].filter(p => p.kind === 'chess');
    assert.equal(units.length, 2);
    units[0].items = [{id:'chess_item_3_08_e_a',uid:99990}];
    const profile = {dps20:300,dps60:300,hps:0,silenceUptime:0,defReduction:0,resReduction:0};
    m.botCombatAtlas = {entries:{chess_char_1_17_a:{profiles:Object.fromEntries(Object.keys(PROBES).map(k=>[k,profile]))}}};
    m.botBuildPolicy = 'enemy-sustain'; m.botCounterEquipment = {routes:true};
    assert.equal(itemTarget(m,ps,{id:'chess_item_3_08_e_a'}).uid,units[1].uid);
  } finally { m.dispose(); }
});
