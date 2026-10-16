// Opt-in proposal search. Public routes and the owner's legal loadout only; no combat seed/results.
import {layoutSignature} from './bot-layout-budget.js';

export const FIRE_COVERAGE_POLICIES = Object.freeze(['contact-turn-v1','contact-position-v1',
  'contact-safe-turn-v2','contact-safe-position-v2']);
const DIRS=['RIGHT','UP','DOWN','LEFT'];
const dir=(p,uid)=>p.dirs?.get(uid)||'RIGHT';
const clone=p=>{const q=new p.constructor(p);q.dirs=new Map(p.dirs);return q;};
const gap=(a,b)=>{
  let n=0;for(const [uid,key] of a)n+=b.get(uid)!==key?1:dir(a,uid)!==dir(b,uid)?.25:0;
  return n/Math.max(1,a.size);
};
const protectedPlan=p=>{const v=p.variant||{};return v.current||!Object.keys(v).length
  ||v.routeFloor===.5&&v.tankFirst!==false||v.secondHold===1&&v.healHold===.75;};

/** [ASSUMED] An initial block pauses at the preceding tile (75%) / blocker's tile (25%).
 * Retain upstream walking exposure, discount downstream exposure while that first block holds.
 * This is a proposal approximation, never a replacement for real battle outcomes. */
export function contactExposure(units,model) {
  const contributions=new Map(units.map(u=>[u.uid,0]));let score=0;
  const routes=model.routes.filter(rt=>rt.n>0).map(rt=>{
    const first=rt.fly?-1:rt.tiles.findIndex(k=>units.some(u=>u.block>0&&u.key===k));
    const stop=first<0?rt.tiles.length-1:first;
    const contact=rt.tiles[Math.max(0,stop-1)],center=rt.tiles[stop];
    const blockers=first<0?[]:units.filter(u=>u.block>0&&u.key===center);
    const capacity=rt.fly?0:units.reduce((n,u)=>n+(rt.tiles.includes(u.key)?u.block:0),0);
    const hold=first<0?0:4*Math.min(2,blockers.reduce((n,u)=>n+u.block,0));
    let exposure=0;
    for(const u of units){
      if(!(u.dps>0)||(rt.fly?!u.air:!u.ground))continue;
      let time=0;
      for(let i=0;i<=stop;i++)if(u.cover.has(rt.tiles[i]))time+=rt.tileTime+(i<2?(rt.dwell||0):0);
      const own=blockers.includes(u);
      if(hold)time+=hold*(own?1:(u.cover.has(contact)?.75:0)+(u.cover.has(center)?.25:0));
      const v=u.dps*time;exposure+=v;contributions.set(u.uid,contributions.get(u.uid)+rt.n*v/Math.max(1,rt.hp));
    }
    const value=rt.n*(1-Math.exp(-exposure/(1.5*Math.max(1,rt.hp))));score+=value;
    return{value,capacity,first,contact,center};
  });
  // Break static saturation when an otherwise idle attacker can contribute. Real preview score stays unchanged.
  score+=.02*[...contributions.values()].filter(x=>x>.05).length/Math.max(1,units.length);
  return{score,routes,contributions};
}

/** Replace at most one original slot. Parent and current/default/lane/healing anchors survive. */
export function retainFireProposal(bank,proposal,{safe=false,features=null,protectedKeys=null}={}) {
  if(!proposal)return{plans:bank,reason:'no-proposal'};
  if(bank.some(p=>layoutSignature(p)===layoutSignature(proposal.plan)))return{plans:bank,reason:'duplicate'};
  let victim=-1,closest=Infinity;
  for(let i=0;i<bank.length;i++){
    if(i===proposal.parent||protectedPlan(bank[i])||protectedKeys?.has(layoutSignature(bank[i])))continue;
    const distance=gap(bank[i],bank[proposal.parent]);
    // v2 never sacrifices a distinct formation: at most one moved piece plus one changed facing.
    if(safe&&distance>1.25/Math.max(1,bank[i].size))continue;
    if(safe&&features){
      const parent=features[proposal.parent],victim=features[i];
      if(parent.routes.some((r,j)=>r.capacity<victim.routes[j].capacity||r.value+1e-8<victim.routes[j].value*.98))continue;
    }
    const redundancy=safe?distance:Math.min(...bank.filter((_,j)=>j!==i).map(p=>gap(bank[i],p)));
    if(redundancy<closest){closest=redundancy;victim=i;}
  }
  if(victim<0)return{plans:bank,reason:'all-protected'};
  const plans=bank.slice();plans[victim]=proposal.plan;
  return{plans,reason:'replaced',victim,parent:proposal.parent,redundancy:closest,
    removedVariant:bank[victim].variant||{},gain:proposal.gain,edit:proposal.plan.variant.fireCoverage};
}

/** makeUnits recomputes real legal record ranges/terrain factors; yielding never changes a player's board. */
export function* fireCoverageSteps(bank,{policy,model,makeUnits,legalPositions,mire,protectedKeys=null}) {
  if(!FIRE_COVERAGE_POLICIES.includes(policy))throw new Error('Unknown fire coverage policy');
  const signatures=new Set(bank.map(layoutSignature));
  const safe=policy.includes('safe'),features=safe?bank.map(p=>contactExposure(makeUnits(p),model)):null;
  let best=null,evaluated=0,eligible=0;
  for(let parent=0;parent<bank.length;parent++){
    const anchor=bank[parent],original=makeUnits(anchor),before=contactExposure(original,model);
    const occupied=new Set(anchor.values());
    for(const u of original){
      if(u.heal||!u.ground||!(u.dps>0)||u.kind!=='chess')continue;
      eligible++;
      const [r,c]=u.key.split(',').map(Number);
      const positions=[u.key];
      if(policy.includes('position')&&!model.ground.has(u.key)){
        // Do not move a road blocker or healer; at most a two-tile legal move to an empty tile.
        for(const key of legalPositions(u)){
          const [rr,cc]=key.split(',').map(Number);
          if(!occupied.has(key)&&Math.max(Math.abs(rr-r),Math.abs(cc-c))<=2&&!mire(key))positions.push(key);
        }
      }
      const healed=original.some(h=>h.heal&&h.cover.has(u.key));
      for(const key of positions)for(const facing of DIRS){
        if(key===u.key&&facing===u.dir)continue;
        if(key!==u.key&&healed&&!original.some(h=>h.heal&&h.cover.has(key)))continue;
        const plan=clone(anchor);plan.set(u.uid,key);plan.dirs.set(u.uid,facing);
        if(signatures.has(layoutSignature(plan)))continue;
        const after=contactExposure(makeUnits(plan),model);evaluated++;
        if(after.routes.some((rt,i)=>rt.capacity<before.routes[i].capacity||rt.value+1e-8<before.routes[i].value*.95))continue;
        const gain=(after.score-before.score)/Math.max(.1,Math.abs(before.score));
        if(!(gain>.0001)||best&&gain<=best.gain)continue;
        plan.variant={fireCoverage:{policy,uid:u.uid,from:u.key,to:key,fromDir:u.dir,toDir:facing},parentVariant:anchor.variant||{}};
        const candidate={plan,parent,gain};
        if((safe||protectedKeys)&&retainFireProposal(bank,candidate,{safe,features,protectedKeys}).reason!=='replaced')continue;
        best=candidate;
      }
      yield;
    }
  }
  return{...retainFireProposal(bank,best,{safe,features,protectedKeys}),evaluated,eligible,policy};
}
