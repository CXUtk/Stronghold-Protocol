// Offline finite-throughput approximation, not a second battle simulation. No seed, clock or callbacks.
// [ASSUMED] Short/long contact windows, shared target time and healing allocation are proposal heuristics.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const stats=u=>u.pressureStats||u.rec?.stats||u.stats||{};
const canHit=(u,rt,key,active=false)=>!u.heal&&(!rt.fly||(active?u.activeAir:u.basicAir))
  &&(active?u.skillCover:u.cover).has(key);
const damage=(u,active)=>{
 const d=u.descriptor||{};if(active?d.activeEnabled===false:d.normalEnabled===false)return 0;
 return(u.pressureDps??u.dps??0)*(active?(d.scale||1)*(d.targets||1):1)*(u.mire?.5:1);
};
/** A finite firing budget prevents one single-target dealer shooting every simultaneous enemy on both routes.
 * Contact stops at the incoming body tile; reserve exposure is discounted, and healing needs an attack opportunity.
 * Ground allies can block an upper lane before it merges: that lane must keep its own contact geometry. */
export function pressureLayoutFeatures(units,model){
 const routes=model.routes.filter(rt=>rt.n>0),horizon=model.horizon||90;
 const data=routes.map(rt=>{
  const blockers=rt.fly?[]:units.filter(u=>u.block>0&&rt.tiles.includes(u.key)).sort((a,b)=>rt.tiles.indexOf(a.key)-rt.tiles.indexOf(b.key));
  const first=blockers.length?rt.tiles.indexOf(blockers[0].key):-1;
  return{rt,blockers,first,values:new Map()};
 });
 const budgets=new Map();
 for(const u of units){
  let allBasic=0,allActive=0;
  for(const row of data){
   const {rt,blockers,first}=row;let basic=0,active=0,contact=0,skillContact=0;
   const front=blockers[0],incoming=first>=0?rt.tiles[Math.max(0,first-1)]:null;
   const healers=front?units.filter(h=>h.uid!==front.uid&&h.cover.has(front.key)&&(h.heal||h.descriptor?.healRatio)):[];
   const heal=healers.reduce((n,h)=>n+(h.heal?(h.descriptor?.rawHps||0):(damage(h,false)*(h.descriptor?.healRatio||0)*.35))/Math.max(1,blockers.filter(b=>h.cover.has(b.key)).length),0);
   const s=front?stats(front):{},threat=rt.threat||{atk:600,bat:2,type:'phys'};
   const hit=threat.type==='arts'?threat.atk*(1-(s.res||0)/100):Math.max(threat.atk*.05,threat.atk-(s.def||0));
   const intake=hit/Math.max(.5,threat.bat||2)*Math.min(2,front?.block||0);
   const hold=front?clamp((s.maxHp||1500)/Math.max(1,intake-heal),1,10)*Math.min(1,(front.block||1)/2):0;
   for(let i=0;i<rt.tiles.length;i++){
    const t=rt.tileTime*(first>=0&&i>first?.15:1)+(i<2?(rt.dwell||0):0);
    if(canHit(u,rt,rt.tiles[i]))basic+=t;
    if(canHit(u,rt,rt.tiles[i],true))active+=t;
   }
   if(front){
    // A melee blocker may attack its own blocked target; a fortress cannot use that to bypass its blind spot.
    const own=front.uid===u.uid&&!u.rangedBlind;
    if(own||canHit(u,rt,incoming))contact=hold;
    if(own||canHit(u,rt,incoming,true))skillContact=hold;
    basic+=contact;active+=skillContact;
   }
   if(u.descriptor?.needsBasicTarget&&!basic)active=skillContact=0;
   row.values.set(u.uid,{basic,active,contact,skillContact,hold,intake,heal});
   allBasic+=rt.n*basic;allActive+=rt.n*active;
  }
  budgets.set(u.uid,{basic:Math.min(1,horizon/Math.max(1,allBasic)),active:Math.min(1,horizon/Math.max(1,allActive))});
 }
 const features=data.map(({rt,blockers,values})=>{
  let basic=0,active=0,effective=0,contact=0,support=0,control=0;
  const hp=Math.max(1,rt.hp);
  for(const u of units){
   const d=u.descriptor||{},v=values.get(u.uid),budget=budgets.get(u.uid),duty=d.duty||0;
   const b=damage(u,false)*budget.basic,a=damage(u,true)*budget.active;
   const normal=b*v.basic,skill=a*v.active;
   basic+=rt.n*normal/hp;active+=rt.n*skill/hp;effective+=rt.n*((1-duty)*normal+duty*skill)/hp;
   contact+=rt.n*((1-duty)*b*v.contact+duty*a*v.skillContact)/hp;
   control+=rt.n*((d.normalControl||0)*v.basic*budget.basic+(d.activeControl||0)*v.active*duty*budget.active)/Math.max(1,rt.tiles.length);
   const targets=blockers.filter(t=>u.cover.has(t.key)),front=blockers[0];
   const share=targets.length?(front&&targets.includes(front)?1:.25)/targets.length:0;
   const hps=u.heal?(d.rawHps||0):((1-duty)*normal+duty*skill)*(d.healRatio||0)/Math.max(1,v.basic);
   support+=rt.n*hps*share/hp;
   // Thorns require an actual incoming hit on a member, not merely geometric attack coverage.
   if(front?.uid===u.uid&&u.thorns>0){const thorn=u.thorns*(1-(rt.threat?.res||0)/100)/Math.max(.5,rt.threat?.bat||2);
    effective+=rt.n*thorn*v.hold/hp;contact+=rt.n*thorn*v.hold/hp;}
  }
  return{basic,active,effective,contact,control,support,capacity:blockers.reduce((n,u)=>n+u.block,0),n:rt.n};
 });
 const score=features.reduce((n,r)=>n+r.n*(1-Math.exp(-(r.effective+.5*r.contact)/Math.max(1,r.n)))+.08*Math.log1p(r.support)+.015*Math.log1p(r.control),0);
 return{score,routes:features};
}
