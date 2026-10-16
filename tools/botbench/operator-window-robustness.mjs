import fs from'node:fs';import assert from'node:assert/strict';import{execFileSync}from'node:child_process';import{fileURLToPath}from'node:url';
import{makeMatch}from'../../test/match/harness.js';import{deriveSeed}from'../../server/sim/rng.js';
import{saveSourceSnapshot}from'./experiment-store.mjs';import{hashTree}from'../botbench-support.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2];assert.ok(out);
for(const ext of ['.json','.jsonl','.source.json'])assert.ok(!fs.existsSync(out+ext));
const inputFile=root+'../logs/ai-operator-window-audit-r2-20261016.json',data=JSON.parse(fs.readFileSync(inputFile));
const picks=[['band_ioleta',8,'p3',57,'DOWN'],['band_ioleta',9,'p3',61,'RIGHT'],['band_ioleta',8,'p2',46,'RIGHT'],['band_amiya',8,'p3',36,'LEFT'],['band_amiya',8,'p2',32,'UP']];
const manifest={kind:'seen-fixed-state-operator-window-new-seed-robustness',createdAt:new Date().toISOString(),inputFile,picks,
 gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHash:hashTree(root,['server','shared','tools/botbench']),dataHash:hashTree(root,['data']),
 newSimulationMatches:0,scope:'Five already inspected states/edits; original three paired seeds imported, twelve new paired battle seeds per edit. Mechanism diagnostic, not independent full-match validation.'};
assert.equal(manifest.dataHash,data.manifest.dataHash);saveSourceSnapshot(root,out+'.source.json',manifest);fs.writeFileSync(out+'.jsonl',JSON.stringify({manifest})+'\n');
const results=[],h=makeMatch({humans:4,difficulty:'ABYSS'});let fixedBattles=0;const mean=a=>a.reduce((n,x)=>n+x,0)/a.length;
try{for(const [band,round,pid,uid,to]of picks){
 const state=data.results.find(s=>s.seed===2805&&s.band===band&&s.round===round&&s.pid===pid);assert.ok(state);
 const base=state.trials.find(t=>!t.changes.length),changed=state.trials.find(t=>t.changes[0]?.uid===uid&&t.changes[0]?.to===to);assert.ok(changed);
 const unit=state.roster.find(u=>u.uid===uid),row={band,round,pid,uid,name:unit.name,from:unit.dir,to,input:state.input,pairs:[]};
 for(let sample=0;sample<15;sample++){
  const pair={sample,imported:sample<3,seed:sample<3?base.samples[sample].seed:deriveSeed(state.input.seed,`operator-window-robust:${sample-2}`)};
  for(const [label,dir,reference]of [['before',unit.dir,base],['after',to,changed]]){
   if(sample<3){pair[label]=reference.samples[sample];continue;}
   const spec=structuredClone(state.input);spec.seed=pair.seed;spec.players[0].units.find(u=>u.uid===uid).dir=dir;
   const b=h.m.newBattle(spec);for(let tick=0;tick<12000&&!b.finished;tick++)b.step();assert.ok(b.finished);fixedBattles++;assert.equal(b.errorCount,0);
   const result=JSON.parse(JSON.stringify(b.result().perPlayer[pid]));pair[label]={input:spec,seed:spec.seed,result,leaks:result.leaked.filter(l=>l.counted!==false).length,time:b.time,errors:b.errorCount};
  }row.pairs.push(pair);
 }
 const deltas=row.pairs.map(p=>p.after.leaks-p.before.leaks),ranged=Array.from({length:5000},(_,iteration)=>{
  // A deterministic integer index permutation for descriptive paired bootstrap; not used in game decisions.
  let x=(iteration+1)*1664525+1013904223,n=0;for(let j=0;j<15;j++){x=(Math.imul(x,1664525)+1013904223)>>>0;n+=deltas[x%15];}return n/15;
 }).sort((a,b)=>a-b);
 row.summary={before:mean(row.pairs.map(p=>p.before.leaks)),after:mean(row.pairs.map(p=>p.after.leaks)),delta:mean(deltas),ci:[ranged[124],ranged[4874]],
  better:deltas.filter(x=>x<0).length,worse:deltas.filter(x=>x>0).length,same:deltas.filter(x=>x===0).length,
  originalThree:mean(deltas.slice(0,3)),newTwelve:mean(deltas.slice(3))};
 results.push(row);fs.appendFileSync(out+'.jsonl',JSON.stringify({case:row})+'\n');console.log(JSON.stringify({name:row.name,round,pid,...row.summary,fixedBattles}));
}}catch(error){fs.appendFileSync(out+'.jsonl',JSON.stringify({status:'interrupted',error:error.stack})+'\n');fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({...manifest,status:'interrupted',fixedBattles,resultFile:out+'.jsonl'})+'\n');throw error;}
finally{h.m.dispose();h.sched.dispose();}
fs.writeFileSync(out+'.json',JSON.stringify({manifest,results,fixedBattles,reusedFixedBattles:30}));fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({...manifest,status:'complete',fixedBattles,reusedFixedBattles:30,resultFile:out+'.json'})+'\n');
