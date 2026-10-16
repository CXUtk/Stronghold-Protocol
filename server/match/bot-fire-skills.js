// Public, static skill descriptors. Build the same selected kit spec as the sim, without a Battle or callbacks.
import {KITS,kitOf,selectSkillSpec} from '../sim/content/index.js';
import {genericKit} from '../sim/content/generic.js';
import {resolveProfile} from '../sim/professions.js';
import {attackRangeGrid,traitRangeExtend,extendedGrid} from '../../shared/loadoutRecord.js';
const cache=new WeakMap(),clamp=(v,a,b)=>Math.min(b,Math.max(a,Number.isFinite(v)?v:a));
export function fireSkillDescriptor(def){
  if(cache.has(def))return cache.get(def);
  const raw=def.raw||def,bb=def.skill?.bb||{},builder=kitOf(def,KITS);
  let kit;try{kit=builder?selectSkillSpec(builder(bb,raw,def),bb,raw,def):genericKit(bb,raw,def);}catch{kit=genericKit(bb,raw,def);}
  const spec=kit?.skill,profile=resolveProfile(def,kit?.trait),tg=spec?.targeting||{},mods=spec?.mods||{},attack=spec?.attack||{};
  const own=attackRangeGrid(raw)||def.rangeGrid||[[0,0]],ext=(tg.noRangeExtend?0:traitRangeExtend(raw))+(tg.rangeExtend||0);
  const activeGrid=tg.rangeGrid?extendedGrid(tg.rangeGrid,ext):tg.rangeExtend?extendedGrid(own,tg.rangeExtend):own;
  const duration=spec?.duration??def.skill?.duration??0,cost=def.skill?.spCost||0;
  const duty=!spec?0:spec.kind==='passive'?1:spec.kind==='toggle'?.5:duration>0?clamp(duration/(duration+cost),.1,.75):.15;
  const interval=clamp(1+(mods.batPct||0),.2,3),speed=clamp((100+(mods.aspd||0))/100,.2,3);
  const scale=clamp((1+(mods.atkPct||0))*speed/interval*(attack.atkScale||1)*(attack.hits||1),.1,4);
  const maxTargets=tg.maxTargets||attack.maxTargets||profile.maxTargets||1;
  const talent=(raw.talents||[]).find(t=>t.bb?.prob!=null)?.bb||{};
  const status=profile.onHitStatus;
  const normalControl=clamp((talent.prob||0)*(talent.duration||0)+(status?.duration||0),0,2);
  const sleep=Math.max(0,bb.sleep||0),quiet=duration>0?clamp(sleep/duration,0,1):0;
  const out={name:def.skill?.name||'',id:def.skill?.skillId||def.skill?.id||'',basicGrid:own,activeGrid,
    duty,scale:scale*(1-quiet),normalEnabled:!profile.noAttack&&!profile.noAttackUnlessSkill,
    activeEnabled:!attack.noAttack&&!profile.noAttack,heal:!!profile.heal,healRatio:profile.healRatio||0,
    basicAir:!!profile.canHitFly&&!profile.groundOnly,
    activeAir:!!(tg.canHitFly??attack.canHitFly??profile.canHitFly)&&!(attack.groundOnly??profile.groundOnly),
    normalControl,activeControl:normalControl+clamp(sleep,0,4),
    targets:1+Math.min(1,Math.max(0,maxTargets-1))*.5,
    needsBasicTarget:!['SKILL_RANGE','ACTIVE_RANGE','CUSTOM_RANGE','GDGLOW_SKILL_2','SP_FULL','ALWAYS'].includes(def.skill?.trigger?.rule),
    // Explicit kit-specific ally-targeted effect, not an inference that all support skills reflect damage.
    protege:(def.skill?.skillId||def.skill?.id)==='skchr_vendla_2',
    rawHps:profile.heal?(def.stats?.atk||0)/Math.max(.2,def.stats?.bat||1):0,
    hasOpaqueCallbacks:!!(spec?.onStart||spec?.onTick||kit?.trait?.canAttack)};
  cache.set(def,out);return out;
}
