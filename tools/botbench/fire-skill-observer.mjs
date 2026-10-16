import {effectiveProfile} from '../../server/sim/ai.js';
import {bodyKeys} from '../../server/sim/body.js';
// Read-only telemetry: active-skill attacks, ordinary attacks, triggered damage and ally healing are separate.
export function observeFireSkills(b){
  const rows=new Map(),attacks=[],casts=[],contacts=[],heals=[];
  const row=u=>{if(!rows.has(u.uid))rows.set(u.uid,{uid:u.uid,id:u.defId,tile:[u.tileR,u.tileC],dir:u.dir,
    normalAttacks:0,activeAttacks:0,engineSkillDamage:0,otherDamage:0,receivedHeal:0,sentHeal:0});return rows.get(u.uid);};
  const keys=u=>({basic:[...(u.baseRangeKeys||[])],live:[...(u.rangeKeys||[])]});
  b.on('attack',({attacker:u,targets,isSkill})=>{
    if(u.side!=='ally')return;const active=!!u.skill?.active,r=row(u);
    r[active||isSkill?'activeAttacks':'normalAttacks']++;
    attacks.push({time:b.time,uid:u.uid,active,engineIsSkill:!!isSkill,...keys(u),
      targets:targets.map(e=>({id:e.id,xy:[e.y,e.x],keys:bodyKeys(e),bind:!!e.s.flags.bind,sleep:!!e.s.flags.sleep,blockedBy:e.blockedBy?.uid??null}))});
  });
  b.on('skillStart',({unit:u})=>{if(u.side==='ally')casts.push({time:b.time,uid:u.uid,skill:u.def.skill?.name,
    range:u.skill?.spec.targeting?.rangeGrid,...keys(u)});});
  b.on('damaged',c=>{if(c.source?.side==='ally'&&c.target?.side==='enemy'&&c.amount>0){
    const r=row(c.source);r[c.dmg?.isSkill?'engineSkillDamage':'otherDamage']+=c.amount;
  }});
  b.on('blocked',({blocker,enemy})=>contacts.push({time:b.time,uid:blocker.uid,tile:[blocker.tileR,blocker.tileC],
    enemy:[enemy.y,enemy.x],entrance:[enemy.spawnY,enemy.spawnX]}));
  const heal=b.heal.bind(b);b.heal=(source,target,amount,opts)=>{
    const actual=heal(source,target,amount,opts);if(actual>0&&target?.side==='ally'){
      row(target).receivedHeal+=actual;if(source?.side==='ally')row(source).sentHeal+=actual;
      heals.push({time:b.time,source:source?.uid??null,target:target.uid,amount:actual,tags:opts?.tags||[]});
    }return actual;
  };
  return()=>({units:b.allyUnits.map(u=>({...row(u),stats:{...u.stats},alive:u.alive,
    profile:{heal:!!effectiveProfile(u)?.heal,subProfession:u.def.subProfessionId},
    skill:{index:u.def.skill?.index,name:u.def.skill?.name,targeting:u.skill?.spec.targeting,
      activations:u.skill?.activations},basicGrid:u.rangeGrid,liveGrid:u.liveRangeGrid})),attacks,casts,contacts,heals});
}
