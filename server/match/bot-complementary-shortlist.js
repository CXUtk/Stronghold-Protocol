import {layoutSignature} from './bot-layout-budget.js';
import {protectedFireSignatures,skillLayoutFeatures} from './bot-fire-shortlist.js';

// [ASSUMED] Changing acquisition windows can improve targeting even when integrated exposure falls.
// These are exploration features, not predictions of leak reduction. Only the unchanged battle previews select a plan.
export function acquisitionWindows(unit,model){
  const keys=new Set();
  for(let i=0;i<model.routes.length;i++){
    const rt=model.routes[i];if(!(rt.n>0)||unit.heal)continue;
    for(let j=0;j<rt.tiles.length;j++){
      const key=rt.tiles[j];
      if((!rt.fly||unit.basicAir)&&unit.cover.has(key))keys.add(`${i}:${j}:basic`);
      if((!rt.fly||unit.activeAir)&&unit.skillCover.has(key)&&unit.descriptor?.activeEnabled!==false)keys.add(`${i}:${j}:active`);
    }
  }
  return keys;
}
export function windowDistance(a,b){
  const union=new Set([...a,...b]);if(!union.size)return 0;
  return [...union].filter(k=>a.has(k)!==b.has(k)).length/union.size;
}
export function complementaryEligible(before,after,a,b){
  return after.score+1e-8>=before.score*.95&&after.routes.every((r,i)=>
    r.capacity>=before.routes[i].capacity&&r.effective+1e-8>=before.routes[i].effective*.75&&
    r.support+1e-8>=before.routes[i].support*.8)&&b.size>0&&windowDistance(a,b)>0;
}
const clone=p=>{const q=new p.constructor(p);q.dirs=new Map(p.dirs);return q;};
export function* complementaryShortlistSteps(bank,context){
  const {model,makeUnits,allPlans=bank,trace=false,quota=2}=context;
  const protectedKeys=protectedFireSignatures(allPlans),units=bank.map(makeUnits),base=units.map(u=>skillLayoutFeatures(u,model));
  const seen=new Set(bank.map(layoutSignature)),pool=[],scores=[];let evaluated=0;
  for(let parent=0;parent<bank.length;parent++)for(const u of units[parent]){
    if(u.kind!=='chess'||u.heal||!(u.dps>0)||u.hasOwnedTokens)continue;
    const before=acquisitionWindows(u,model);
    for(const dir of ['RIGHT','UP','DOWN','LEFT']){
      if(dir===u.dir)continue;
      const plan=clone(bank[parent]);plan.dirs.set(u.uid,dir);
      const signature=layoutSignature(plan);if(seen.has(signature))continue;seen.add(signature);evaluated++;
      const next=makeUnits(plan),after=skillLayoutFeatures(next,model),mask=acquisitionWindows(next.find(x=>x.uid===u.uid),model);
      const gain=(after.score-base[parent].score)/Math.max(.1,base[parent].score),novelty=windowDistance(before,mask);
      const accepted=complementaryEligible(base[parent],after,before,mask);
      const edit={uid:u.uid,from:u.key,to:u.key,fromDir:u.dir,toDir:dir};
      if(trace)scores.push({parent,...edit,score:after.score,gain,novelty,accepted});
      if(!accepted)continue;
      const d=u.descriptor||{},uncertain=!!(d.normalControl||d.activeControl||d.healRatio||d.hasOpaqueCallbacks);
      plan.variant={fireCoverage:{policy:context.policy,...edit},parentVariant:bank[parent].variant||{}};
      pool.push({plan,signature,parent,edit,gain,novelty,features:after,mask,
        rank:novelty*(uncertain?1.2:1)/(1+20*Math.max(0,-gain))});
    }
    yield;
  }
  pool.sort((a,b)=>b.rank-a.rank||b.gain-a.gain||a.parent-b.parent);
  const shortlist=[];
  for(const p of pool){
    if(shortlist.length===4)break;
    // A second direction with identical target acquisition is not a complementary choice.
    if(shortlist.some(q=>q.edit.uid===p.edit.uid&&windowDistance(q.mask,p.mask)<.1))continue;
    shortlist.push(p);
  }
  const plans=bank.slice(),replaced=[],parents=new Set();
  for(const p of shortlist){
    if(replaced.length>=Math.min(2,quota))break;
    if(replaced.some(r=>r.victim===p.parent)||replaced.some(r=>r.edit.uid===p.edit.uid))continue;
    let victim=-1,closest=-1;
    for(let i=0;i<bank.length;i++){
      if(i===p.parent||parents.has(i)||protectedKeys.has(layoutSignature(bank[i]))||replaced.some(r=>r.victim===i))continue;
      const f=base[i];if(p.features.score+1e-8<f.score*.95||!p.features.routes.every((r,j)=>r.capacity>=f.routes[j].capacity&&r.support+1e-8>=f.routes[j].support*.8))continue;
      // Remove a geometrically redundant non-core plan; retain its parent and every protected alias.
      const duplicate=Math.max(...bank.map((_,j)=>j===i||replaced.some(r=>r.victim===j)?-1:layoutSimilarity(units[i],units[j],model)));
      if(duplicate>closest){closest=duplicate;victim=i;}
    }
    if(victim<0)continue;
    parents.add(p.parent);plans[victim]=p.plan;replaced.push({victim,parent:p.parent,edit:p.edit,gain:p.gain,novelty:p.novelty,similarity:closest,removedVariant:bank[victim].variant||{}});
  }
  return{plans,policy:context.policy,reason:replaced.length?'replaced':'no-compatible-slot',evaluated,replaced,selectedCount:replaced.length,
    protected:[...protectedKeys],shortlist:shortlist.map(({parent,edit,gain,novelty,rank,signature,features})=>({parent,edit,gain,novelty,rank,signature,features})),...(trace?{scores}:{})};
}
function layoutSimilarity(a,b,model){
  return a.reduce((sum,u)=>{const v=b.find(v=>v.uid===u.uid);return sum+(v?1-windowDistance(acquisitionWindows(u,model),acquisitionWindows(v,model)):0);},0)/Math.max(1,a.length);
}
