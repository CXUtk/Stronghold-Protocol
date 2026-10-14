// Selected by the recorded four-seat population comparison; no combat or economy rule changes.
import { readFileSync } from 'node:fs';
import { REHEARSAL_VARIANTS } from './bot.js';
import { installTacticalPolicy } from './bot-tactical.js';

export const INDIVIDUAL_BOT_POLICY = 'terrain-parity-v12';
let atlas;
export function configureIndividualBot(m, requested, rehearsalOption) {
  if (!requested || requested === 'off') return false;
  if (requested !== INDIVIDUAL_BOT_POLICY) throw new Error('Unknown individual bot policy');
  // The evidence covers four-player ABYSS with one to three real AI seats, not solo or human autoplay.
  const bots = m.order.filter(p => p.isBot).length;
  if (m.isSolo || m.modeId !== 'mode_multi_abyss' || m.order.length !== 4 || bots < 1 || bots > 3) return false;
  m.botIndividualPolicy = requested;
  m.botGroundBlockCandidates = true;
  m.botDefaultRehearsal = m.botRehearsal;
  if (rehearsalOption == null) m.botRehearsal = 8; // Effective budget of the evaluated candidate.
  m.botLegacyParity = false;
  m.botProjectPrepEnd = true;
  m.botBuildPolicy = 'tanks';
  m.botSkipCombos = true;
  m.botKeepCurrentLayout = true;
  atlas ||= JSON.parse(readFileSync(new URL('./bot-combat-atlas.json', import.meta.url), 'utf8'));
  m.botCombatAtlas = atlas;
  m.botLayoutVariants = [...REHEARSAL_VARIANTS.slice(0, 4),
    { tankFirst: false }, { tankFirst: false, spread: 3, secondHold: 0.2, cohesion: 0 },
    { routeFloor: 0.5, cohesion: 0 }, { routeFloor: 0.5, cohesion: 0, tankFirst: false }];
  installTacticalPolicy(m, { tactical: 'dual' });
  return true;
}
