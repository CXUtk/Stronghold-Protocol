// Matched-state replay of selected vs omitted winners; no training or strategy changes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {Match} from '../../server/match/Match.js';
import {VirtualScheduler} from '../../server/match/scheduler.js';
import {getData} from '../../server/data.js';
import {hashTree} from '../botbench-support.mjs';
import {saveSourceSnapshot} from './experiment-store.mjs';
import {observeBattle} from './battle-observer.mjs';
import {observeRoutes} from './route-observer.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=resolve(process.argv[2]);
for(const ext of ['.json','.jsonl','.source.json'])assert.ok(!fs.existsSync(out+ext));
const source=JSON.parse(fs.readFileSync(resolve(root,'../logs/ai-layout-budget-diagnostic-r2-20261015.json')));
const manifest={label:'seen-matched-state-selected-versus-omitted-telemetry',createdAt:new Date().toISOString(),
  gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  sourceHash:hashTree(root,['server','shared','tools/botbench']),dataHash:hashTree(root,['data']),
  sourceSnapshot:out+'.source.json',newSimulationMatches:0,input:'ai-layout-budget-diagnostic-r2-20261015.json'};
saveSourceSnapshot(root,out+'.source.json',manifest);fs.writeFileSync(out+'.jsonl',JSON.stringify({manifest})+'\n',{flag:'wx'});
const sched=new VirtualScheduler(),m=new Match({mode:'coop',difficulty:'ABYSS',seed:1,clientCombat:false,
  seats:Array.from({length:4},(_,seat)=>({seat,playerId:`p${seat}`,name:`p${seat}`,isBot:seat>1,connected:true})),
  data:getData(),scheduler:sched,send:()=>true,broadcast(){},onEnd(){},log:{info(){},warn(){},error(){}}});
const results=[];
try {
  for(const d of source.diagnostics.filter(d=>d.round===9&&((d.humans===3&&d.seed===1902)||(d.humans===2&&d.seed===1907&&d.pid==='p3'))))
    for(const [label,sig] of [['selected',d.selected],['omitted',d.bestAll]]) {
      const trial=d.trials.find(t=>t.signature===sig);
      for(const [sample,s] of trial.samples.entries()){
        const b=m.newBattle(s.input),snapshot=observeBattle(b),routes=observeRoutes(b,s.input),mire=new Map();
        const cap=Math.ceil((s.input.timeLimit+5)*30);
        for(let tick=0;tick<cap&&!b.finished;tick++){
          const before=b.time;b.step();
          for(const u of b.allyUnits)if(u.alive&&u.deployed&&u.findBuff('terrain:mire')){
            const r=mire.get(u.uid)||{uid:u.uid,id:u.defId,seconds:0,minAspd:Infinity,maxStacks:0};
            r.seconds+=b.time-before;r.minAspd=Math.min(r.minAspd,u.s.aspd);r.maxStacks=Math.max(r.maxStacks,u.mem.mireStacks||0);mire.set(u.uid,r);
          }
        }
        if(!b.finished)b.forceEnd('timeout');
        const result=b.result().perPlayer[d.pid];assert.deepEqual(JSON.parse(JSON.stringify(result)),s.result);
        const row={humans:d.humans,seed:d.seed,band:d.band,round:d.round,pid:d.pid,label,sample,
          variant:trial.variant,input:s.input,result,snapshot:snapshot(),routes:routes(),mire:[...mire.values()]};
        results.push(row);fs.appendFileSync(out+'.jsonl',JSON.stringify(row)+'\n');
      }
    }
} finally {m.dispose();sched.dispose();}
const summary=results.map(r=>({seed:r.seed,humans:r.humans,label:r.label,sample:r.sample,
  leaks:r.result.leaked.filter(l=>l.counted!==false).length,
  mireSeconds:r.mire.reduce((n,u)=>n+u.seconds,0),deaths:r.snapshot.units.reduce((n,u)=>n+u.deaths,0),
  healing:r.snapshot.units.reduce((n,u)=>n+u.receivedHeal,0),uncovered:r.snapshot.units.reduce((n,u)=>n+u.uncoveredSeconds,0)}));
fs.writeFileSync(out+'.json',JSON.stringify({manifest,results,summary}),{flag:'wx'});
fs.appendFileSync(resolve(root,'../logs/ai-experiment-index.jsonl'),JSON.stringify({kind:'mechanism-diagnostic',status:'complete',resultFile:out+'.json',...manifest,evaluatedBattles:results.length,summary})+'\n');
console.log(JSON.stringify(summary));
