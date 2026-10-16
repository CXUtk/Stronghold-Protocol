import {layoutSignature} from './bot-layout-budget.js';
const DIRS=['RIGHT','UP','DOWN','LEFT'];
const clone=p=>{const q=new p.constructor(p);q.dirs=new Map(p.dirs);return q;};
const protectedVariant=v=>v.current||!Object.keys(v).length||v.routeFloor===.5&&v.tankFirst!==false
  ||v.secondHold===1&&v.healHold===.75
  ||v.rangedBlock&&v.groundRangedCount===1&&!v.routeBlock&&!v.avoidMire&&!v.forwardRanged;
/** Protect deduplicated geometry if ANY original alias carries a core role. */
export function protectedFireSignatures(allPlans){
  return new Set(allPlans.filter(p=>protectedVariant(p.variant||{})).map(layoutSignature));
}
const reached=(u,rt,k,skill)=>!(rt.fly?!(skill?u.activeAir:u.basicAir):u.heal)&&
  (skill?u.skillCover:u.cover).has(k);

/** [ASSUMED] Two public-route exposure views: short contact with downstream traffic, long contact.
 * Basic/active coverage, control and geometric healing are independent dimensions, not raw damage alone. */
export function skillLayoutFeatures(units,model){
  const routes=model.routes.filter(r=>r.n>0).map(rt=>{
    const blockers=rt.fly?[]:units.filter(u=>u.block>0&&rt.tiles.includes(u.key));
    const ordered=blockers.slice().sort((a,b)=>rt.tiles.indexOf(a.key)-rt.tiles.indexOf(b.key));
    const first=ordered.length?rt.tiles.indexOf(ordered[0].key):-1;
    let basic=0,active=0,effective=0,contact=0,control=0,support=0;
    const hp=Math.max(1,rt.hp),n=rt.n;
    for(const u of units){
      const desc=u.descriptor||{},duty=desc.duty||0;
      let basicTime=0,skillTime=0;
      for(let i=0;i<rt.tiles.length;i++){
        // Still credit downstream traffic at half weight: the first blocker may fall or overflow.
        const time=rt.tileTime*(first>=0&&i>first?.5:1)+(i<2?(rt.dwell||0):0);
        if(reached(u,rt,rt.tiles[i],false))basicTime+=time;
        if(reached(u,rt,rt.tiles[i],true))skillTime+=time;
      }
      let basicHold=0,skillHold=0;
      for(let i=0;i<ordered.length;i++){
        const b=ordered[i],j=rt.tiles.indexOf(b.key),incoming=rt.tiles[Math.max(0,j-1)],own=b.uid===u.uid;
        const importance=i===0?1:.4;
        if(own||reached(u,rt,incoming,false))basicHold+=importance;
        if(own||reached(u,rt,incoming,true))skillHold+=importance;
      }
      if(desc.needsBasicTarget&&!basicTime&&!basicHold)skillTime=skillHold=0;
      const raw=u.dps||0,b=desc.normalEnabled===false?0:raw,a=desc.activeEnabled===false?0:raw*(desc.scale||1)*(desc.targets||1);
      basic+=n*b*(basicTime+2*basicHold)/hp;
      active+=n*a*(skillTime+2*skillHold)/hp;
      effective+=n*((1-duty)*b*(basicTime+2*basicHold)+duty*a*(skillTime+2*skillHold))/hp;
      contact+=n*((1-duty)*b*basicHold+duty*a*skillHold)*4/hp;
      control+=n*(b>0?1:0)*((desc.normalControl||0)*basicTime+(desc.activeControl||0)*skillTime*duty)/Math.max(1,rt.tiles.length);
      // Own route blockers that can actually receive support, both front and reserve tanks.
      const protectedBlock=ordered.reduce((sum,t)=>sum+(u.cover.has(t.key)?t.block*(iWeight(ordered,t)):0),0);
      if(desc.heal||desc.healRatio){
        const amount=desc.heal?desc.rawHps:((1-duty)*b*(basicTime+basicHold*2)+duty*a*(skillTime+skillHold*2))*(desc.healRatio||0);
        support+=n*amount*protectedBlock/hp;
      }
      if(desc.protege&&duty>0)support+=n*raw*duty*protectedBlock/hp;
    }
    const capacity=blockers.reduce((sum,u)=>sum+u.block,0);
    return{basic,active,effective,contact,control,support,capacity,n};
  });
  const score=routes.reduce((sum,r)=>sum+r.n*(1-Math.exp(-(r.effective+r.contact)/Math.max(1,r.n)))
    +.08*Math.log1p(r.support)+.015*Math.log1p(r.control),0);
  return{score,routes};
}
const iWeight=(ordered,t)=>ordered.indexOf(t)===0?1:.5;
const distance=(a,b)=>a.routes.reduce((n,r,i)=>n+['basic','active','support','control','contact'].reduce((s,k)=>
  s+Math.abs(r[k]-b.routes[i][k])/Math.max(.1,r[k],b.routes[i][k]),0),0);
const dominates=(a,b,tol=.92)=>a.routes.every((r,i)=>r.capacity>=b.routes[i].capacity&&
  ['basic','active','support','control','contact'].every(k=>r[k]+1e-8>=b.routes[i][k]*tol));

export function* skillShortlistSteps(bank,context){
  const {model,makeUnits,legalPositions,mire,allPlans=bank,trace=false,quota=2}=context;
  const evaluate=context.evaluate||skillLayoutFeatures,retentionEvaluate=context.retentionEvaluate||evaluate;
  const protectedKeys=protectedFireSignatures(allPlans),base=bank.map(p=>evaluate(makeUnits(p),model));
  const retained=retentionEvaluate===evaluate?base:bank.map(p=>retentionEvaluate(makeUnits(p),model));
  const seen=new Set(bank.map(layoutSignature)),ranked=[],scores=[];let evaluated=0;
  for(let parent=0;parent<bank.length;parent++){
    const original=makeUnits(bank[parent]),occupied=new Set(bank[parent].values()),before=base[parent];
    for(const unit of original){
      if(unit.kind!=='chess'||(unit.heal?!context.allowSupport:!(unit.dps>0)))continue;
      const positions=[unit.key],healed=original.some(h=>h.heal&&h.cover.has(unit.key));
      if(!unit.heal&&!model.ground.has(unit.key)&&!unit.hasOwnedTokens)for(const key of legalPositions(unit)){
        const [r,c]=key.split(',').map(Number),[rr,cc]=unit.key.split(',').map(Number);
        if(!occupied.has(key)&&Math.max(Math.abs(r-rr),Math.abs(c-cc))<=2&&!mire(key)
          &&(!healed||original.some(h=>h.heal&&h.cover.has(key))))positions.push(key);
      }
      for(const key of positions)for(const dir of DIRS){
        if(key===unit.key&&dir===unit.dir)continue;
        const plan=clone(bank[parent]);plan.set(unit.uid,key);plan.dirs.set(unit.uid,dir);
        const signature=layoutSignature(plan);if(seen.has(signature))continue;seen.add(signature);
        const units=makeUnits(plan),after=evaluate(units,model);evaluated++;
        const gain=(after.score-before.score)/Math.max(.1,Math.abs(before.score));
        const accepted=gain>.0001&&dominates(after,before,.88);
        const edit={uid:unit.uid,from:unit.key,to:key,fromDir:unit.dir,toDir:dir};
        if(trace)scores.push({parent,...edit,score:after.score,gain,accepted});
        if(!accepted)continue;
        plan.variant={fireCoverage:{policy:context.policy||'skill-shortlist-r89-v3',...edit},parentVariant:bank[parent].variant||{}};
        ranked.push({plan,signature,parent,features:after,retention:retentionEvaluate===evaluate?after:retentionEvaluate(units,model),gain,edit});
      }
      yield;
    }
  }
  ranked.sort((a,b)=>b.gain-a.gain||b.features.score-a.features.score||a.parent-b.parent);
  // A few distinct choices, not hundreds of nearly identical neighbouring positions in rehearsal.
  const shortlist=[];let retentionRejected=0;
  for(const p of ranked){
    if(shortlist.length===4)break;
    if(!bank.some((b,i)=>i!==p.parent&&!protectedKeys.has(layoutSignature(b))&&dominates(p.retention,retained[i],.98))){retentionRejected++;continue;}
    if(shortlist.some(q=>q.edit.uid===p.edit.uid&&q.edit.toDir===p.edit.toDir&&q.parent===p.parent))continue;
    shortlist.push(p);
  }
  const plans=bank.slice(),replaced=[],parents=new Set();
  for(const p of shortlist){
    if(replaced.length>=quota)break;
    if(replaced.some(r=>r.victim===p.parent))continue;
    let victim=-1,bestDistance=Infinity;
    for(let i=0;i<bank.length;i++){
      if(i===p.parent||parents.has(i)||protectedKeys.has(layoutSignature(bank[i]))||replaced.some(r=>r.victim===i))continue;
      if(!dominates(p.retention,retained[i],.98))continue;
      const d=distance(p.retention,retained[i]);if(d<bestDistance){bestDistance=d;victim=i;}
    }
    if(victim>=0){parents.add(p.parent);plans[victim]=p.plan;replaced.push({victim,parent:p.parent,edit:p.edit,gain:p.gain,
      removedVariant:bank[victim].variant||{},featureDistance:bestDistance});}
  }
  return{plans,policy:context.policy||'skill-shortlist-r89-v3',reason:replaced.length?'replaced':'no-compatible-slot',evaluated,retentionRejected,
    replaced,selectedCount:replaced.length,base:bank.map((p,i)=>({tiles:[...p],dirs:[...p.dirs],variant:p.variant||{},features:base[i]})),
    protected:[...protectedKeys],shortlist:shortlist.map(p=>({parent:p.parent,edit:p.edit,gain:p.gain,signature:p.signature,features:p.features})),
    ...(trace?{scores}:{})};
}
