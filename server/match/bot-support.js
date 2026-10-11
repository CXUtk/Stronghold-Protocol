// Opt-in support experiments for four-seat ABYSS with two humans and two actual AI seats.
// These change bot decisions only; players' rules, resources and combat mechanics are unchanged.
const ANCHORS = ['band_amiya', 'band_ioleta'];
const MEDIC = 'band_amedic';
export const SUPPORT_POLICIES = Object.freeze(['', 'team-medic', 'team-medic-core']);

function enabled(m) {
  return SUPPORT_POLICIES.includes(m.botSupportPolicy) && !!m.botSupportPolicy
    && !m.isSolo && m.modeId === 'mode_multi_abyss' && m.order.length === 4
    && m.order.filter((p) => p.isBot).length === 2;
}

export function supportDraftBand(m, ps) {
  if (!enabled(m) || !ps?.isBot || ps.autoplay || !m.draft) return null;
  const picks = m.draft.picks;
  const chosen = m.order.filter((p) => p.isBot && p.playerId !== ps.playerId).map((p) => picks[p.playerId]).filter(Boolean);
  const free = (id) => m.gd.bandAllowed(id) && !m.bandTaken(id, ps.playerId);
  if (chosen.length) return ANCHORS.includes(chosen[0]) && free(MEDIC) ? MEDIC : null;
  if (!free(MEDIC)) return null;
  return ANCHORS.find(free) || null;
}

function coreTeam(m) {
  if (!enabled(m) || m.botSupportPolicy !== 'team-medic-core' || m.round < 1 || m.round > 11) return false;
  const bots = m.order.filter((p) => p.isBot);
  return bots.some((p) => p.bandId === MEDIC) && bots.some((p) => ANCHORS.includes(p.bandId));
}

export function supportLevelCap(m, ps) {
  return coreTeam(m) && ps.isBot && !ps.autoplay && ANCHORS.includes(ps.bandId) ? 3 : Infinity;
}

export function supportRehearsals(m, ps) {
  return coreTeam(m) && ps?.isBot && !ps.autoplay && m.botRehearsal > 0 ? Math.max(m.botRehearsal, 5) : m.botRehearsal;
}
