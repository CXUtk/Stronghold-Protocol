import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';import {runSupportMatch} from './support-runner.mjs';
import {saveSourceSnapshot} from './experiment-store.mjs';import {hashTree} from '../botbench-support.mjs';
import {LayoutPlan,skillFireCoverageContext,pressureFireCoverageContext} from '../../server/match/bot.js';
import {pressureLayoutFeatures} from '../../server/match/bot-fire-pressure.js';
import {skillShortlistSteps,skillLayoutFeatures} from '../../server/match/bot-fire-shortlist.js';
import {layoutSignature} from '../../server/match/bot-layout-budget.js';import {deriveSeed} from '../../server/sim/rng.js';
import {observeFireSkills} from './fire-skill-observer.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2];assert.ok(out);
const calibrated=process.argv[3]==='v4',cacheFile=root+'../logs/ai-fire-calibration-diagnostic-20261016.json';
const cached=calibrated?JSON.parse(fs.readFileSync(cacheFile)):null;
for(const ext of ['.json','.jsonl','.source.json'])assert.ok(!fs.existsSync(out+ext));
const referenceFile=root+'../logs/ai-fire-shortlist-validation-20261016.json',reference=JSON.parse(fs.readFileSync(referenceFile));
const cases=[[2805,'band_amiya'],[2805,'band_ioleta'],[2804,'band_amiya']];
const manifest={kind:'seen-mire-R89-static-combat-calibration',calibrated,cacheFile:calibrated?cacheFile:null,createdAt:new Date().toISOString(),
 gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHash:hashTree(root,['server','shared','tools/botbench']),
 dataHash:hashTree(root,['data']),referenceFile,cases,newSimulationMatches:cases.length,sourceSnapshot:out+'.source.json',
 scope:'Seen native diverse prefixes; fixed full formal battle input, roster/skills/equipment/layers/spawns; static and actual combat paired, not independent validation.'};
assert.equal(manifest.dataHash,reference.manifest.dataHash);saveSourceSnapshot(root,out+'.source.json',manifest);
fs.writeFileSync(out+'.jsonl',JSON.stringify({manifest})+'\n',{flag:'wx'});const write=x=>fs.appendFileSync(out+'.jsonl',JSON.stringify(x)+'\n');
const results=[],diagnostics=[];let fixedBattles=0,reusedFixedBattles=0,rehearsalBattles=0;
const copy=p=>{const q=new LayoutPlan(p);q.dirs=new Map(p.dirs);q.variant=structuredClone(p.variant||{});return q;};
const serial=p=>({tiles:[...p],dirs:[...p.dirs],variant:p.variant||{},signature:layoutSignature(p)});
const cleanUnits=units=>units.map(({rec,piece,cover,skillCover,...u})=>({...u,id:piece.id,stats:rec.stats,cover:[...cover],skillCover:[...skillCover]}));
const resources=spec=>{const s=structuredClone(spec);delete s.seed;for(const p of s.players){for(const u of p.units){delete u.row;delete u.col;delete u.dir;}p.units.sort((a,b)=>a.uid-b.uid);}return s;};
try{for(const [seed,band]of cases){
 const ref=reference.results.find(r=>r.policyId==='budget-diverse-v1'&&r.seed===seed&&r.band===band);assert.ok(ref);
 const pending=new Map(),formal=new Map();let engine;
 const result=runSupportMatch({...ref,rounds:9,humanFixtures:ref.fixtureInputs,rehearsal:8,individualPolicy:'terrain-parity-v12'},
 {configure(m){m.botLayoutBudgetPolicy='diverse-v1';engine=m.newBattle.bind(m);m.newBattle=opts=>{
  const b=engine(opts);if(opts.kind==='normal'&&opts.fieldId?.startsWith('n:')&&[8,9].includes(m.round))formal.set(m.round+':'+opts.players[0].playerId,{input:structuredClone(opts),b});return b;};
  m.botRehearsalAudit=e=>{
   if(e.phase==='done')rehearsalBattles+=e.totals.reduce((n,t)=>n+t.completed,0);
   if(![8,9].includes(m.round)||seed===2804&&(m.round!==8||e.player.playerId!=='p2'))return;
   const key=m.round+':'+e.player.playerId;
   if(e.phase==='start'){
    const context=skillFireCoverageContext(m,e.player,e.chosen),gen=skillShortlistSteps(e.candidates,{...context,allPlans:e.plans,trace:true});
    let x=gen.next();while(!x.done)x=gen.next();
    const plans=new Map();for(const [group,bank]of [['native',e.candidates],['skill-v3',x.value.plans]])for(const p of bank){const sig=layoutSignature(p);if(!plans.has(sig))plans.set(sig,{plan:copy(p),groups:[]});plans.get(sig).groups.push(group);}
    if(calibrated){const pressure=pressureFireCoverageContext(m,e.player,e.chosen);
     for(const policy of ['pressure-retain-r89-v4','pressure-shortlist-r89-v4']){
      const g=skillShortlistSteps(e.candidates,{...pressure,allPlans:e.plans,trace:true,policy,
       ...(policy==='pressure-shortlist-r89-v4'?{evaluate:pressureLayoutFeatures,allowSupport:true}:{}),retentionEvaluate:pressureLayoutFeatures});
      let y=g.next();while(!y.done)y=g.next();
      for(const p of y.value.plans){const sig=layoutSignature(p);if(!plans.has(sig))plans.set(sig,{plan:copy(p),groups:[]});plans.get(sig).groups.push(policy);}
     }
     Object.assign(context,pressure);
    }
    pending.set(key,{round:m.round,pid:e.player.playerId,plans,proposal:{...x.value,plans:undefined},context,
      model:{routes:context.model.routes,armor:context.model.armor},aliases:e.plans.map(serial)});
   }else{const d=pending.get(key);d.selected=layoutSignature(e.selected);d.training=e.totals;}
  };
 },beforeDispose(){for(const [key,state]of pending){
  const f=formal.get(key);assert.ok(f);const input=f.input,pid=state.pid,pp=f.b.result().perPlayer[pid];
  const expected=ref.rounds.find(w=>w.round===state.round).players.find(p=>p.pid===pid);assert.equal(pp.leaked.filter(x=>x.counted!==false).length,expected.rawLeaks);
  const {plans,context,...rest}=state,record={seed,band,stageId:ref.stageId,...rest,formal:{input,result:pp},trials:[]};
  for(const {plan,groups}of plans.values()){
   const trial={...serial(plan),groups,features:skillLayoutFeatures(context.makeUnits(plan),context.model),
    ...(calibrated?{pressureFeatures:pressureLayoutFeatures(context.makeUnits(plan),context.model)}:{}),units:cleanUnits(context.makeUnits(plan)),samples:[]};
   for(let sample=0;sample<3;sample++){
    const spec=structuredClone(input);if(sample)spec.seed=deriveSeed(input.seed,`fire-calibration:${sample}`);
    for(const u of spec.players[0].units)if(plan.has(u.uid)){[u.row,u.col]=plan.get(u.uid).split(',').map(Number);u.dir=plan.dirs.get(u.uid)||'RIGHT';}
    spec.players[0].units.sort((a,b)=>b.row-a.row||a.col-b.col);assert.deepEqual(resources(spec),resources(input));
    const old=cached?.diagnostics.find(d=>d.seed===seed&&d.band===band&&d.round===state.round&&d.pid===pid);
    const prior=old?.trials.find(t=>t.signature===layoutSignature(plan))?.samples[sample];
    if(prior){assert.deepEqual(old.formal.input,input,'Frozen formal inputs differ');assert.equal(prior.seed,spec.seed);trial.samples.push(prior);reusedFixedBattles++;continue;}
    const b=engine(spec),snapshot=observeFireSkills(b),deaths=[],spawns=[];
    b.on('death',({unit:u,reason})=>{if(u.side==='ally')deaths.push({uid:u.uid,time:b.time,reason});});
    b.on('deploy',({unit:u})=>{if(u.side==='enemy')spawns.push({time:b.time,id:u.defId,hp:u.s.maxHp,atk:u.s.atk,def:u.s.def,res:u.s.res,bat:u.s.bat,speed:u.s.moveSpeed});});
    for(let i=0;i<12000&&!b.finished;i++)b.step();assert.ok(b.finished);fixedBattles++;
    const r=b.result().perPlayer[pid];if(layoutSignature(plan)===state.selected&&!sample)assert.deepEqual(r,pp);
    trial.samples.push({seed:spec.seed,leaks:r.leaked.filter(x=>x.counted!==false).length,result:r,telemetry:snapshot(),deaths,spawns});
   }record.trials.push(trial);
  }
  diagnostics.push(record);write({diagnostic:record});console.log(JSON.stringify({seed,band,round:state.round,pid,plans:record.trials.length,formalLeaks:expected.rawLeaks,fixedBattles}));
 }} });
 assert.deepEqual(result.rounds,ref.rounds.filter(r=>r.round<=9),'Native prefix changed');results.push(result);write({result});
}}catch(error){write({status:'interrupted',error:error.stack});fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({...manifest,status:'interrupted',completedMatches:results.length,fixedBattles,rehearsalBattles,resultFile:out+'.jsonl'})+'\n');throw error;}
fs.writeFileSync(out+'.json',JSON.stringify({manifest,results,diagnostics,fixedBattles,reusedFixedBattles,rehearsalBattles}),{flag:'wx'});
fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({...manifest,status:'complete',resultFile:out+'.json',fixedBattles,reusedFixedBattles,rehearsalBattles})+'\n');
console.log(JSON.stringify({complete:true,prefixes:results.length,states:diagnostics.length,fixedBattles,reusedFixedBattles,rehearsalBattles}));
