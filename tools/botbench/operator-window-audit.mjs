// Seen fixed-roster ablation: one operator's facing at a time. No economic or combat rule changes.
import fs from 'node:fs';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';
import{fileURLToPath}from'node:url';import{openingFixture}from'./diagnose-ranged-block.mjs';
import{skillFireCoverageContext,LayoutPlan}from'../../server/match/bot.js';
import{skillLayoutFeatures}from'../../server/match/bot-fire-shortlist.js';
import{layoutSignature}from'../../server/match/bot-layout-budget.js';import{deriveSeed}from'../../server/sim/rng.js';
import{fireSkillDescriptor}from'../../server/match/bot-fire-skills.js';
import{hashTree}from'../botbench-support.mjs';import{saveSourceSnapshot}from'./experiment-store.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2];assert.ok(out);
for(const ext of ['.json','.jsonl','.source.json'])assert.ok(!fs.existsSync(out+ext));
const sources=['ai-fire-r89-skill-diagnostic-20261016','ai-fire-calibration-diagnostic-20261016'].map(n=>root+'../logs/'+n+'.json');
const inputs=sources.map(file=>({file,data:JSON.parse(fs.readFileSync(file))}));
const states=inputs.flatMap(({file,data})=>data.diagnostics.filter(d=>d.seed===2602||d.seed===2604||d.seed===2805&&(
 d.band==='band_amiya'&&d.round===8||d.band==='band_ioleta'&&(d.round===8||d.round===9&&d.pid==='p3'))).map(d=>({file,state:d})));
const manifest={kind:'seen-operator-single-facing-window-audit',createdAt:new Date().toISOString(),sources,
 gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHash:hashTree(root,['server','shared','tools/botbench']),dataHash:hashTree(root,['data']),
 newSimulationMatches:0,scope:'Seven archived fixed states; roster/gear/skills/layers/enemy spawns frozen, only one operator facing changes; same three seeds per state. Development diagnostic, not validation.'};
for(const {data}of inputs)assert.equal(data.manifest.dataHash,manifest.dataHash);
saveSourceSnapshot(root,out+'.source.json',manifest);fs.writeFileSync(out+'.jsonl',JSON.stringify({manifest})+'\n');
const results=[];let fixedBattles=0;const write=x=>fs.appendFileSync(out+'.jsonl',JSON.stringify(x)+'\n');
try{for(const {file,state}of states){
 const input=state.formal.input,player=input.players[0],pid=player.playerId;
 const {m,ps,h}=openingFixture(state.stageId,state.seed,[]);let record;
 try{
  m.round=state.round;m.wave={...input,templateId:'operator-window-fixed'};
  const chosen=player.units.map(u=>({uid:u.uid,kind:u.kind,id:u.chessId||u.tokenId,items:structuredClone(u.items||[])}));
  ps.board=new Map(player.units.map((u,i)=>[`${u.row},${u.col}`,chosen[i]]));ps.hand=[];
  ps.loadoutFor=rec=>{const u=player.units.find(u=>u.chessId===rec.chessId);return u?{skillIndex:u.skillIndex,moduleId:u.moduleId,potential:u.potential,cultivate:u.cultivate}:null;};
  const context=skillFireCoverageContext(m,ps,chosen),reconstructedRoutes=structuredClone(context.model.routes);
  // Formal inputs can contain later bounty additions. Re-score the exact archived public model, not an invented match.
  context.model.routes=structuredClone(state.model.routes);context.model.armor=structuredClone(state.model.armor);context.model.dps.clear();
  const native=new LayoutPlan(player.units.map(u=>[u.uid,`${u.row},${u.col}`]));native.dirs=new Map(player.units.map(u=>[u.uid,u.dir]));
  const roster=player.units.filter(u=>{const def=m.ds.getChess(u.chessId,u);return u.kind==='chess'&&(def.position==='RANGED'||def.rangeGrid?.length>3);});
  const plans=new Map([[layoutSignature(native),{plan:native,changes:[]}]]);
  for(const u of roster)for(const dir of ['RIGHT','UP','DOWN','LEFT']){
   if(dir===u.dir)continue;const plan=new LayoutPlan(native);plan.dirs=new Map(native.dirs);plan.dirs.set(u.uid,dir);
   plans.set(layoutSignature(plan),{plan,changes:[{uid:u.uid,id:u.chessId,from:u.dir,to:dir}]});
  }
  record={file,seed:state.seed,band:state.band,round:state.round,pid,stageId:state.stageId,input,model:state.model,reconstructedRoutes,
   roster:roster.map(u=>{const def=m.ds.getChess(u.chessId,u);return{...u,name:def.name,subProfession:def.subProfessionId,descriptor:fireSkillDescriptor(def)};}),
   native:layoutSignature(native),trials:[]};
  for(const [signature,{plan,changes}]of plans){
   const trial={signature,changes,features:skillLayoutFeatures(context.makeUnits(plan),context.model),samples:[]};
   for(let sample=0;sample<3;sample++){
    const spec=structuredClone(input);if(sample)spec.seed=deriveSeed(input.seed,`operator-window:${sample}`);
    for(const u of spec.players[0].units)u.dir=plan.dirs.get(u.uid);
    const b=m.newBattle(spec),attacks=[],statuses=[],casts=[],deaths=[];
    b.on('attack',({attacker:u,targets,isSkill})=>{if(u.side==='ally')attacks.push({time:b.time,uid:u.uid,active:!!u.skill?.active,isSkill:!!isSkill,
     targets:targets.map(e=>({id:e.id,defId:e.defId,xy:[e.y,e.x],hp:e.hp,blockedBy:e.blockedBy?.uid??null}))});});
    b.on('statusApplied',({source,target,status,duration,entered})=>{if(target?.side==='enemy'&&source?.side==='ally')statuses.push({time:b.time,uid:source.uid,target:target.id,status,duration,entered});});
    b.on('skillStart',({unit:u})=>{if(u.side==='ally')casts.push({time:b.time,uid:u.uid,protege:u.mem.protege?.uid??null});});
    b.on('death',({unit:u})=>{if(u.side==='ally')deaths.push({time:b.time,uid:u.uid});});
    for(let tick=0;tick<12000&&!b.finished;tick++)b.step();assert.ok(b.finished);fixedBattles++;
    const result=JSON.parse(JSON.stringify(b.result().perPlayer[pid]));
    trial.samples.push({seed:spec.seed,result,leaks:result.leaked.filter(x=>x.counted!==false).length,attacks,statuses,casts,deaths,errors:b.errorCount,time:b.time});
    assert.equal(b.errorCount,0,'Observer must not throw');
    if(!changes.length&&!sample)assert.deepEqual(result,JSON.parse(JSON.stringify(state.formal.result)),'Archived formal result changed');
   }record.trials.push(trial);
  }
  results.push(record);write({state:record});console.log(JSON.stringify({seed:state.seed,band:state.band,round:state.round,pid,operators:roster.length,layouts:plans.size,fixedBattles}));
 }finally{m.dispose();h.sched.dispose();}
}}catch(error){if(error.message)write({status:'interrupted',error:error.stack});fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({...manifest,status:'interrupted',fixedBattles,resultFile:out+'.jsonl',error:error.message})+'\n');throw error;}
fs.writeFileSync(out+'.json',JSON.stringify({manifest,results,fixedBattles}));fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({...manifest,status:'complete',states:results.length,fixedBattles,resultFile:out+'.json'})+'\n');
console.log(JSON.stringify({complete:true,states:results.length,fixedBattles}));
