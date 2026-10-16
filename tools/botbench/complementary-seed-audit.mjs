import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {makeMatch} from '../../test/match/harness.js';import {deriveSeed,createRng} from '../../server/sim/rng.js';
import {saveSourceSnapshot} from './experiment-store.mjs';import {hashTree} from '../botbench-support.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2];assert.ok(out);
for(const ext of ['.json','.jsonl','.source.json'])assert.ok(!fs.existsSync(out+ext));
const read=name=>JSON.parse(fs.readFileSync(root+'../logs/'+name+'-20261016.json'));
const audit=read('ai-operator-window-audit-r2'),analysis=read('ai-operator-window-analysis'),old=read('ai-operator-window-robustness');
const picks=analysis.cases.filter(c=>c.delta< -1e-9&&c.staticAfter<=c.staticBefore+.0001);assert.equal(picks.length,14);
const manifest={kind:'seen-fixed-state-relaxed-shortlist-seed-check',createdAt:new Date().toISOString(),picks,
 gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHash:hashTree(root,['server','shared','tools/botbench']),dataHash:hashTree(root,['data']),
 newSimulationMatches:0,scope:'All fourteen previously positive three-seed edits with non-increasing static score; fifteen common seeds, original and exact prior robustness samples reused. Diagnostic, not independent match validation.'};
assert.equal(manifest.dataHash,audit.manifest.dataHash);saveSourceSnapshot(root,out+'.source.json',manifest);fs.writeFileSync(out+'.jsonl',JSON.stringify({manifest})+'\n');
const h=makeMatch({humans:4,difficulty:'ABYSS'}),cache=new Map(),results=[];let fixedBattles=0,externalImported=0,internalReused=0;
const mean=a=>a.reduce((n,x)=>n+x,0)/a.length;
try{for(const c of picks){
 const state=audit.results.find(s=>s.seed===c.seed&&s.band===c.band&&s.round===c.round&&s.pid===c.pid);assert.ok(state);
 const original=state.trials.find(t=>!t.changes.length),changed=state.trials.find(t=>t.changes[0]?.uid===c.uid&&t.changes[0]?.to===c.to);assert.ok(changed);
 const prior=old.results.find(r=>r.band===c.band&&r.round===c.round&&r.pid===c.pid&&r.uid===c.uid&&r.to===c.to);
 if(prior)assert.deepEqual(prior.input,state.input);
 const row={...c,input:state.input,pairs:[]};
 for(let sample=0;sample<15;sample++){
  const seed=sample<3?original.samples[sample].seed:deriveSeed(state.input.seed,`operator-window-robust:${sample-2}`),pair={sample,seed};
  for(const [label,dir,trial]of [['before',c.from,original],['after',c.to,changed]]){
   const spec=structuredClone(state.input);spec.seed=seed;spec.players[0].units.find(u=>u.uid===c.uid).dir=dir;
   const key=JSON.stringify(spec);let value=cache.get(key);
   if(value){internalReused++;pair[label]={...value,reuse:'within-batch'};continue;}
   const imported=sample<3?trial.samples[sample]:prior?.pairs.find(p=>p.seed===seed)?.[label];
   if(imported){externalImported++;value={...imported,reuse:sample<3?'original-audit':'prior-robustness'};}
   else{const b=h.m.newBattle(spec);for(let tick=0;tick<12000&&!b.finished;tick++)b.step();assert.ok(b.finished);assert.equal(b.errorCount,0);fixedBattles++;
    const result=JSON.parse(JSON.stringify(b.result().perPlayer[c.pid]));value={input:spec,seed,result,leaks:result.leaked.filter(l=>l.counted!==false).length,time:b.time,errors:0};}
   cache.set(key,value);pair[label]=value;
  }row.pairs.push(pair);
 }
 const deltas=row.pairs.map(p=>p.after.leaks-p.before.leaks),rng=createRng(20261016),boot=[];
 for(let i=0;i<5000;i++)boot.push(mean(deltas.map(()=>deltas[rng.int(deltas.length)])));boot.sort((a,b)=>a-b);
 row.summary={delta:mean(deltas),originalThree:mean(deltas.slice(0,3)),additionalTwelve:mean(deltas.slice(3)),ci:[boot[124],boot[4874]],
  better:deltas.filter(d=>d<0).length,worse:deltas.filter(d=>d>0).length,same:deltas.filter(d=>d===0).length};
 results.push(row);fs.appendFileSync(out+'.jsonl',JSON.stringify({case:row})+'\n');console.log(JSON.stringify({name:c.name,seed:c.seed,round:c.round,pid:c.pid,uid:c.uid,to:c.to,...row.summary,fixedBattles}));
}}catch(error){fs.appendFileSync(out+'.jsonl',JSON.stringify({status:'interrupted',error:error.stack})+'\n');fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({...manifest,status:'interrupted',fixedBattles,resultFile:out+'.jsonl'})+'\n');throw error;}
finally{h.m.dispose();h.sched.dispose();}
fs.writeFileSync(out+'.json',JSON.stringify({manifest,results,fixedBattles,externalImported,internalReused}),{flag:'wx'});
fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({...manifest,status:'complete',fixedBattles,externalImported,internalReused,resultFile:out+'.json'})+'\n');
