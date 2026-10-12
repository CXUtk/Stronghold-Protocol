// 结城理 (char_4217_makoto), local 自选 kit. Numbers come from the generated official tables.
// Persona 3 crossover operators other than Makoto remain outside the local 自选 pool.
import { num, talentBb, traitBb, skillRec, up, alliesInGridOf } from '../shared/tier1.js';
import { weaknessRetype } from '../../items/battle.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { DOLL_SWITCH } from '../../../professions.js';

const S1 = 'skchr_makoto_1';
const S2 = 'skchr_makoto_2';
const S3 = 'skchr_makoto_3';
const DOLL = 'makoto:persona';
const S3_SPEED = 'makoto:thanatos:speed';
const S3_ORPHEUS = 'makoto:orpheus:block';
const SEES = new Set(['char_4217_makoto', 'char_4218_aigis', 'char_4219_yukari', 'char_4220_kormr']);

export default {
  char_4217_makoto: (_bb, chess) => {
    const b1 = skillRec(chess, S1)?.bb ?? {};
    const b2 = skillRec(chess, S2)?.bb ?? {};
    const b3 = skillRec(chess, S3)?.bb ?? {};
    const t1 = talentBb(chess, 0);
    const t2 = talentBb(chess, 1);
    const moduleTalent = chess?.module?.active && chess?.module?.level >= 2
      ? chess.module.talentChanges?.find((t) => t.talentIndex === 0)?.bb : null;
    const dollAtk = num(moduleTalent?.atk, num(t1.atk));
    const dollHp = num(moduleTalent?.max_hp_t1, num(t1.max_hp_t1)) + num(traitBb(chess).max_hp);
    const dollSlow = num(moduleTalent?.sluggish, num(t1.sluggish));
    const bat = num(t1.base_attack_time);
    const selected = chess?.skill?.skillId;
    const grid = chess?.trait?.rangeGrid ?? chess?.rangeGrid;
    const skillGrid = skillRec(chess, selected)?.rangeGrid ?? grid;
    const allOutGrid = grid;

    const healOrpheus = (battle, unit) => {
      if (!up(unit) || unit.trait.dollSwitching || unit.mem.makotoMode !== 'orpheus3') return;
      const injured = alliesInGridOf(battle, unit, skillGrid).filter((a) => a.hp < a.s.maxHp)
        .sort((a, b) => a.hpRatio - b.hpRatio || a.id - b.id);
      const selectedAllies = injured.slice(0, Math.max(1, num(b3['attack@max_target_heal'], 3)));
      const amount = unit.s.atk * num(b3['attack@heal_scale']);
      if (selectedAllies.length) battle.after(0.5, () => {
        for (const a of selectedAllies) if (a.alive) battle.heal(unit, a, amount, { tags: ['skill'] });
      }, { owner: unit });
    };

    const restoreProfile = (unit) => {
      if (!unit.mem.makotoBaseProfile) return;
      Object.assign(unit.profile, unit.mem.makotoBaseProfile);
      unit.rangeGrid = unit.mem.makotoBaseRange;
      unit.mem.makotoMode = null;
    };
    const setMode = (battle, unit, mode) => {
      unit.mem.makotoMode = mode;
      unit.profile.noAttack = mode === 'orpheus3';
      unit.profile.dmgType = 'arts'; // 弱点伤害 defaults to arts on an exact tie.
      unit.profile.atkScale = mode === 'orpheus1' ? num(b1['attack@atk_scale'], 1)
        : mode === 'thanatos2' ? num(b2['attack@atk_scale'], 1)
          : mode === 'thanatos3' ? num(b3['attack@atk_scale'], 1) : 1;
      unit.profile.maxTargets = mode === 'thanatos2' ? num(b2['attack@max_target'], 1)
        : mode === 'thanatos3' ? num(b3['attack@max_target'], 1) : 1;
      unit.profile.canHitFly = mode === 'thanatos3' || mode === 'orpheus3';
      unit.profile.onEachHit = mode === 'thanatos2' ? (b, u, target) => {
        if (target.alive && b.rng.chance(num(b2['attack@prob']))) b.applyStatus(target, 'fear', { duration: num(b2['attack@fear']), source: u });
      } : null;
      if (mode === 'thanatos3') battle.addBuff(unit, { key: S3_SPEED, mods: { aspd: num(b3['talent@attack_speed']) }, tags: ['skill'] });
      else battle.removeBuff(unit, S3_SPEED);
      // The generic dollkeeper buff removes 99 block to clamp the doll to zero.
      // Cancel that subtraction here, then keep the official S3 block count (2).
      if (mode === 'orpheus3') battle.addBuff(unit, { key: S3_ORPHEUS,
        mods: { blockCnt: 99 + num(b3['attack@block_cnt'], 2) - unit.base.blockCnt }, tags: ['skill'] });
      else battle.removeBuff(unit, S3_ORPHEUS);
    };
    const toOrpheus = (battle, unit) => {
      if (!up(unit) || !unit.trait.doll || unit.trait.dollSwitching || unit.mem.makotoMode !== 'thanatos3') return;
      setMode(battle, unit, 'orpheus3');
      if (unit.skill) unit.skill.charges = 0;
      healOrpheus(battle, unit);
      unit.mem.makotoHealTimer?.cancel();
      unit.mem.makotoHealTimer = battle.every(Math.max(0.1, num(b3['attack@interval'], 1)), () => healOrpheus(battle, unit), { owner: unit });
      battle.fx('swap', { x: unit.x, y: unit.y, id: unit.id, form: 'orpheus' });
    };
    const cast = ({ battle, unit }) => {
      if (unit.trait.doll) {
        if (selected === S3) toOrpheus(battle, unit);
      } else battle.emit('dollSwitch', { unit, reason: 'skill', done: false });
    };

    return {
      // On the body all three skills switch to the doll at once. S3's second cast changes its persona.
      skills: { [S1]: { kind: 'instant', onStart: cast }, [S2]: { kind: 'instant', onStart: cast }, [S3]: { kind: 'instant', onStart: cast } },
      install(battle, unit) {
        if (selected === S3 && unit.skill && !Object.prototype.hasOwnProperty.call(unit.skill, 'activate')) {
          // PRTS: the second cast is available only after the Thanatos switch animation finishes.
          const activate = unit.skill.activate;
          Object.defineProperty(unit.skill, 'activate', {
            configurable: true, writable: true, enumerable: false,
            value(reason, opts) {
              if (unit.trait.doll && (unit.trait.dollSwitching || unit.mem.makotoMode !== 'thanatos3')) return false;
              return activate.call(this, reason, opts);
            },
          });
        }
        unit.mem.makotoBaseProfile = {
          noAttack: unit.profile.noAttack, dmgType: unit.profile.dmgType, atkScale: unit.profile.atkScale,
          maxTargets: unit.profile.maxTargets, canHitFly: unit.profile.canHitFly, onEachHit: unit.profile.onEachHit,
          heal: unit.profile.heal, healScale: unit.profile.healScale,
        };
        unit.mem.makotoBaseRange = unit.rangeGrid;
        // The dollkeeper profession emits this after the form and HP have changed, and again on return.
        battle.on('dollSwap', (c) => {
          if (c.unit !== unit) return;
          if (c.form !== 'doll') {
            unit.mem.makotoHealTimer?.cancel();
            unit.mem.makotoHealTimer = null;
            battle.removeBuff(unit, DOLL);
            battle.removeBuff(unit, S3_SPEED);
            battle.removeBuff(unit, S3_ORPHEUS);
            restoreProfile(unit);
            battle.refreshRange(unit);
            const atk = unit.s.atk * num(t2.atk_scale); // 总攻击形态 does not retain doll-only ATK.
            // S.E.E.S. total attack, once at every deployed team member. Overlapping areas each hit.
            for (const member of battle.allyUnits) {
              if (!up(member) || !SEES.has(member.def?.charId)) continue;
              battle.fx('aoe', { x: member.x, y: member.y, radius: 1.5, id: unit.id, skill: 'makoto:allOut' });
              const keys = absoluteRangeKeys(allOutGrid, member.tileR, member.tileC, member.dir, 0);
              for (const e of battle.enemiesInKeys(keys, unit, { canHitFly: true })) {
                battle.dealDamage(unit, e, { amount: atk, type: 'true', canDodge: false, tags: ['talent', 'makoto:allOut'] });
              }
            }
            return;
          }
          const mods = { atkPct: dollAtk, hpPct: dollHp, batPct: bat / Math.max(0.1, num(chess?.stats?.bat, 1.2)) };
          battle.addBuff(unit, { key: DOLL, mods, tags: ['talent'] });
          unit.hp = unit.s.maxHp;
          unit.rangeGrid = skillGrid;
          battle.refreshRange(unit);
          for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
            battle.applyStatus(e, 'sluggish', { duration: dollSlow, source: unit });
          }
          setMode(battle, unit, selected === S1 ? 'orpheus1' : selected === S2 ? 'thanatos2' : 'thanatos3');
          // Arm the second cast when the 1-second switch animation has finished. Its automatic
          // operation rule still observes the 3-second cooldown from the first cast.
          if (selected === S3 && unit.skill) {
            const arm = () => {
              if (!up(unit) || !unit.trait.doll || unit.mem.makotoMode !== 'thanatos3') return;
              if (unit.trait.dollSwitching) battle.after(1 / 30, arm, { owner: unit });
              else unit.skill.charges = 1;
            };
            battle.after(DOLL_SWITCH, arm, { owner: unit });
          }
        }, { owner: unit, priority: -10 });
        battle.on('hit', (c) => {
          if (c.source === unit && c.target?.side === 'enemy' && unit.mem.makotoMode === 'thanatos3') weaknessRetype(c.dmg, unit, c.target);
        }, { owner: unit, priority: 5 });
        // S1 chooses a low-HP ally in place of an enemy at the ordinary attack cadence.
        unit.profile.canAttack = (b, u) => {
          if (u.mem.makotoMode !== 'orpheus1') return true;
          const injured = alliesInGridOf(b, u, skillGrid).some((a) => a.hpRatio <= 0.5);
          u.profile.dmgType = injured ? 'heal' : 'arts';
          u.profile.heal = injured ? { mode: 'single', hpAtMost: 0.5 } : null;
          u.profile.healScale = injured ? num(b1['attack@heal_scale']) : 1;
          return true;
        };
        battle.every(0.1, () => {
          if (!up(unit) || unit.trait.dollSwitching || !unit.trait.doll) return;
          if (unit.mem.makotoMode === 'thanatos2') {
            const cap = unit.s.atk * num(b2['attack@kill_atk_scale']);
            const inRange = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true });
            const ids = new Set(inRange.map((e) => e.id));
            for (const id of unit.mem.makotoExecuted ?? []) if (!ids.has(id)) unit.mem.makotoExecuted.delete(id);
            for (const e of inRange) {
              if (!e.findBuff('fear') || e.hp > cap) continue;
              if (!unit.mem.makotoExecuted) unit.mem.makotoExecuted = new Set();
              if (unit.mem.makotoExecuted.has(e.id)) continue;
              unit.mem.makotoExecuted.add(e.id);
              battle.dealDamage(unit, e, { amount: num(b2['attack@kill_damage'], 9999999), type: 'true', canDodge: false, sourceless: true, tags: ['skill', 'execute'] });
            }
          } else if (unit.mem.makotoMode === 'orpheus3') {
            for (const ally of alliesInGridOf(battle, unit, skillGrid)) {
              battle.addBuff(ally, { key: `makoto:dodge:${unit.id}`, duration: 0.35,
                mods: { dodgePhys: num(b3['attack@prob']), dodgeArts: num(b3['attack@prob']) }, source: unit, tags: ['skill'] });
            }
          }
        }, { owner: unit });
        battle.on('fatal', (c) => {
          if (c.unit !== unit || c.prevented || unit.mem.makotoMode !== 'thanatos3') return;
          toOrpheus(battle, unit);
          c.prevented = true;
          unit.hp = unit.s.maxHp;
        }, { owner: unit, priority: 10 });
        battle.on('deploy', (c) => {
          if (c.unit !== unit) return;
          unit.mem.makotoExecuted = new Set();
          unit.mem.makotoHealTimer?.cancel();
          unit.mem.makotoHealTimer = null;
          battle.removeBuff(unit, DOLL);
          battle.removeBuff(unit, S3_SPEED);
          battle.removeBuff(unit, S3_ORPHEUS);
          restoreProfile(unit);
          battle.refreshRange(unit);
        }, { owner: unit });
      },
    };
  },
};
