// Offline opt-in only. Select before the briefing, then lock for the entire match like a human loadout.
import { checkLoadout, loadoutOptions } from '../../shared/protocol.js';
import { atlasDps } from '../../server/match/bot-build.js';

export function chooseCounterSkills(gd, atlas, factions) {
  if (!atlas.skillVariants) throw new Error('Skill policy requires a skill atlas');
  const ids = [...new Set(factions.flatMap((f) => gd.factions.types?.[f]?.pool || []))];
  const rows = ids.map((id) => gd.enemy(id)).filter((e) => e?.stats).map((e) => ({
    def: e.stats.def || 0, res: e.stats.res || 0, fly: e.isFlyEnemy || e.stats.motion === 'FLY',
    reflection: Number(e.talents?.bb?.['refracting.magic_resistance'] ?? e.talents?.bb?.['Refracting.magic_resistance']) || 0,
    silenciable: !e.stats.immunities?.silence,
  }));
  const reflectionShare = rows.filter((r) => r.reflection > 0 && r.silenciable).length / Math.max(1, rows.length);
  if (!reflectionShare) return { entries: {}, decisions: [], reflectionShare };
  const score = (entry) => rows.reduce((n, r) => n + atlasDps(entry, r), 0) / rows.length
    + entry.profiles.soft.hps * 0.5 + entry.profiles.reflection.silenceUptime * reflectionShare * 450;
  const entries = {}, decisions = [];
  for (const id of Object.keys(atlas.skillVariants)) {
    const c = gd.chess(id);
    if (!c || c.isGolden || c.isHidden || c.isDiy) continue;
    const opt = loadoutOptions(c, gd.chess(c.goldenId));
    const options = opt.skills.flatMap((skill) => {
      const normal = atlas.skillVariants[id]?.[skill], elite = atlas.skillVariants[c.goldenId]?.[skill];
      if (!normal || (c.goldenId && !elite)) return [];
      return [{ skill, name: normal.skillName, score: score(normal) * 0.7 + score(elite || normal) * 0.3 }];
    });
    const original = options.find((x) => x.skill === opt.defaultSkill);
    const best = options.slice().sort((a, b) => b.score - a.score || a.skill - b.skill)[0];
    if (!original || !best) continue;
    const chosen = best.score > original.score * 1.1 ? best : original;
    if (chosen.skill !== opt.defaultSkill) entries[id] = { skill: chosen.skill };
    decisions.push({ id, name: c.name, defaultSkill: opt.defaultSkill, selectedSkill: chosen.skill, options });
  }
  return { entries, decisions, reflectionShare };
}

export function installCounterSkills(m, atlas, rec) {
  if (m.round > 0 || !['LOBBY', 'INFO_CHECK'].includes(m.phase)) throw new Error('Skill pilot must be installed before match start');
  const plan = chooseCounterSkills(m.gd, atlas, m.factions);
  const checked = checkLoadout(plan.entries, (id) => m.gd.chess(id));
  if (!checked.ok) throw new Error(`Invalid skill pilot: ${JSON.stringify(checked)}`);
  rec.skillPlan = { ...plan, rule: 'public faction pool only; 70% normal / 30% elite; +10% threshold; fixed all match',
    limitation: '450 silence-team proxy and saturated HPS are experimental proposal scores, not measured coop benefit' };
  for (const ps of m.order.filter((p) => p.isBot && !p.autoplay)) {
    // Deliberately confined to the offline harness: production setLoadout continues refusing bot requests.
    ps.loadout = Object.freeze(Object.fromEntries(Object.entries(checked.loadout).map(([id, e]) => [id, Object.freeze(e)])));
    const entries = { ...atlas.entries };
    for (const [id, e] of Object.entries(checked.loadout)) {
      for (const record of [id, m.gd.chess(id).goldenId].filter(Boolean)) entries[record] = atlas.skillVariants[record][e.skill];
    }
    ps._botSkillEntries = Object.freeze(entries);
  }
}
