import fs from 'node:fs';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';import{fileURLToPath}from'node:url';
import{openingFixture}from'./diagnose-ranged-block.mjs';import{skillFireCoverageContext,LayoutPlan}from'../../server/match/bot.js';
import{preserveEffectWindows,effectWindows}from'../../server/match/bot-effect-windows.js';import{hashTree}from'../botbench-support.mjs';
import{saveSourceSnapshot}from'./experiment-store.mjs';import{fireSkillDescriptor}from'../../server/match/bot-fire-skills.js';
import{getData}from'../../server/data.js';
import{acquisitionWindows,complementaryEligible,windowDistance}from'../../server/match/bot-complementary-shortlist.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2];assert.ok(out);
for(const ext of ['.json','.jsonl','.source.json'])assert.ok(!fs.existsSync(out+ext));
const inputFile=root+'../logs/ai-operator-window-audit-r2-20261016.json',data=JSON.parse(fs.readFileSync(inputFile));
const manifest={kind:'seen-complementary-acquisition-feature-analysis',createdAt:new Date().toISOString(),inputFile,newSimulationMatches:0,newFixedBattles:0,
 gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHash:hashTree(root,['server','shared','tools/botbench']),dataHash:hashTree(root,['data'])};
assert.equal(data.manifest.dataHash,manifest.dataHash);saveSourceSnapshot(root,out+'.source.json',manifest);fs.writeFileSync(out+'.jsonl',JSON.stringify({manifest})+'\n');
const results=[],inventory=[];let savedData;
for(const s of data.results){
 const{m,ps,h}=openingFixture(s.stageId,s.seed,[]);try{
  m.round=s.round;m.wave={...s.input,templateId:'operator-window-fixed'};const player=s.input.players[0];
  const chosen=player.units.map(u=>({uid:u.uid,kind:u.kind,id:u.chessId||u.tokenId,items:structuredClone(u.items||[])}));
  ps.board=new Map(player.units.map((u,i)=>[`${u.row},${u.col}`,chosen[i]]));ps.hand=[];
  ps.loadoutFor=rec=>{const u=player.units.find(u=>u.chessId===rec.chessId);return u?{skillIndex:u.skillIndex,moduleId:u.moduleId,potential:u.potential,cultivate:u.cultivate}:null;};
  const context=skillFireCoverageContext(m,ps,chosen);context.model.routes=structuredClone(s.model.routes);context.model.armor=structuredClone(s.model.armor);context.model.dps.clear();
  const native=new LayoutPlan(player.units.map(u=>[u.uid,`${u.row},${u.col}`]));native.dirs=new Map(player.units.map(u=>[u.uid,u.dir]));
  const before=context.makeUnits(native),baseline=s.trials.find(t=>!t.changes.length);
  for(const t of s.trials.filter(t=>t.changes.length)){
   const edit=t.changes[0],plan=new LayoutPlan(native);plan.dirs=new Map(native.dirs);plan.dirs.set(edit.uid,edit.to);
   const after=context.makeUnits(plan),gate=preserveEffectWindows(before,after,context.model,{uid:edit.uid});
   const mean=a=>a.reduce((n,x)=>n+x,0)/a.length;
   results.push({seed:s.seed,band:s.band,round:s.round,pid:s.pid,uid:edit.uid,name:s.roster.find(u=>u.uid===edit.uid).name,edit,gate,
    staticGain:t.features.score-baseline.features.score,leakDelta:mean(t.samples.map(s=>s.leaks))-mean(baseline.samples.map(s=>s.leaks)),
    originalLeaks:baseline.samples.map(s=>s.leaks),leaks:t.samples.map(s=>s.leaks),
 beforeWindow:effectWindows(before,context.model,edit.uid),afterWindow:effectWindows(after,context.model,edit.uid),
 beforeCover:[...before.find(u=>u.uid===edit.uid).cover],afterCover:[...after.find(u=>u.uid===edit.uid).cover],
 beforeFeatures:baseline.features,afterFeatures:t.features,
 complementary:{accepted:complementaryEligible(baseline.features,t.features,acquisitionWindows(before.find(u=>u.uid===edit.uid),context.model),acquisitionWindows(after.find(u=>u.uid===edit.uid),context.model)),novelty:windowDistance(acquisitionWindows(before.find(u=>u.uid===edit.uid),context.model),acquisitionWindows(after.find(u=>u.uid===edit.uid),context.model))}});
  }
  if(!savedData){savedData=true;for(const id of Object.keys(getData().chess).filter(id=>id.endsWith('_a'))){
   const rec=m.gd.chess(id),def=m.ds.getChess(id),d=fireSkillDescriptor(def);inventory.push({id,name:rec.name,subProfession:def.subProfessionId,
    defaultSkill:def.skill?.name,descriptor:d,roleSignals:{healing:!!(d.heal||d.healRatio),control:!!(d.normalControl||d.activeControl),callbacks:d.hasOpaqueCallbacks}});
  }}
 }finally{m.dispose();h.sched.dispose();}
}
const promising=results.filter(r=>r.staticGain>.0001),summary={all:results.length,positiveStatic:promising.length,
 rejected:promising.filter(r=>!r.gate.accepted).length,harmfulRejected:promising.filter(r=>!r.gate.accepted&&r.leakDelta>1e-9).length,
 helpfulRejected:promising.filter(r=>!r.gate.accepted&&r.leakDelta< -1e-9).length,
 harmfulPassed:promising.filter(r=>r.gate.accepted&&r.leakDelta>1e-9).length,helpfulPassed:promising.filter(r=>r.gate.accepted&&r.leakDelta< -1e-9).length};
fs.appendFileSync(out+'.jsonl',JSON.stringify({results,summary})+'\n');fs.writeFileSync(out+'.json',JSON.stringify({manifest,results,summary,inventory}));
fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({...manifest,status:'complete',resultFile:out+'.json',summary})+'\n');
console.log(JSON.stringify({summary,inventory:inventory.length,rejectedExamples:promising.filter(r=>!r.gate.accepted)}));
