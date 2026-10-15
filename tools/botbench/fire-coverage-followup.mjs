// Post-screening diagnostics on already seen rosters, not an unbiased policy evaluation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openingFixture} from './diagnose-ranged-block.mjs';
import {observeBattle} from './battle-observer.mjs';
import {observeRoutes} from './route-observer.mjs';
import {saveSourceSnapshot} from './experiment-store.mjs';
import {hashTree} from '../botbench-support.mjs';
import {deriveSeed} from '../../server/sim/rng.js';
import {getData} from '../../server/data.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),input=process.argv[2],out=process.argv[3];
assert.ok(input&&out);for(const ext of ['.json','.jsonl','.source.json'])assert.ok(!fs.existsSync(out+ext));
const base=JSON.parse(fs.readFileSync(input)),data=getData();
const manifest={createdAt:new Date().toISOString(),label:'post-screening-seen-roster-fire-coverage-followup',
  gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  sourceHash:hashTree(root,['server','shared','tools/botbench']),dataHash:hashTree(root,['data']),
  reference:input,sourceSnapshot:out+'.source.json',newSimulationMatches:0,
  scope:'Five successful direction edits selected after screening, three matched diagnostic battle seeds each; plus zero-shot examples, all facings. Not independent validation or policy selection.'};
assert.equal(base.manifest.dataHash,manifest.dataHash);saveSourceSnapshot(root,out+'.source.json',manifest);
fs.writeFileSync(out+'.jsonl',JSON.stringify({manifest})+'\n',{flag:'wx'});
const write=x=>fs.appendFileSync(out+'.jsonl',JSON.stringify(x)+'\n'),results=[];let fixedBattles=0;
const play=(m,spec,uid)=>{
  const b=m.newBattle(spec),snapshot=observeBattle(b),routes=observeRoutes(b,spec);let firstAttack=null;
  b.on('attack',({attacker})=>{if(attacker.uid===uid)firstAttack??=b.time;});
  for(let i=0;i<12000&&!b.finished;i++)b.step();assert.ok(b.finished);fixedBattles++;
  const observation=snapshot(),result=b.result();
  return{input:spec,result,leaks:result.perPlayer[spec.players[0].playerId].leaked.filter(x=>x.counted!==false).length,
    observation,routes:routes(),unit:observation.units.find(u=>u.uid===uid),firstAttack};
};
try{
  for(const t of base.trials){
    const u=t.control.coverage.find(x=>x.uid===t.uid);
    const changed=t.alternatives.find(a=>a.dir===u.bestFacing&&a.leaks<t.control.leaks)
      ||t.alternatives.find(a=>a.leaks<t.control.leaks);
    if(!changed)continue;
    const {m}=openingFixture(t.stageId,t.seed,[]);
    try{for(let i=1;i<=3;i++){
      const seed=deriveSeed(t.control.input.seed,`coverage-followup:${i}`);
      const before=structuredClone(t.control.input);before.seed=seed;
      const after=structuredClone(before);after.players[0].units.find(x=>x.uid===t.uid).dir=changed.dir;
      const record={kind:'matched-seed-turn',stageId:t.stageId,round:t.round,pid:t.pid,name:t.name,uid:t.uid,
        sourceSeed:t.seed,seed,from:u.dir,to:changed.dir,before:play(m,before,t.uid),after:play(m,after,t.uid)};
      results.push(record);write({record});
    }}finally{m.dispose();}
  }
  for(const stageId of [...new Set(base.fields.map(f=>f.stageId))]){
    const u=base.suspects.filter(x=>x.stageId===stageId&&x.shots===0&&x.activeSeconds>10&&x.alive)
      .sort((a,b)=>b.facingGainSeconds-a.facingGainSeconds)[0];if(!u)continue;
    const f=base.fields.find(f=>f.stageId===stageId&&f.round===u.round&&f.pid===u.pid),{m}=openingFixture(stageId,u.seed,[]);
    try{
      const before=play(m,structuredClone(f.input),u.uid);assert.deepEqual(before.result.perPlayer[u.pid],f.result);
      const record={kind:'zero-shot-turns',stageId,round:u.round,pid:u.pid,name:data.chess[u.id]?.name,uid:u.uid,
        sourceSeed:u.seed,from:u.dir,before,alternatives:[]};
      for(const dir of ['RIGHT','UP','DOWN','LEFT'].filter(d=>d!==u.dir)){
        const spec=structuredClone(f.input);spec.players[0].units.find(x=>x.uid===u.uid).dir=dir;
        record.alternatives.push({dir,...play(m,spec,u.uid)});
      }
      results.push(record);write({record});
    }finally{m.dispose();}
  }
}catch(error){write({status:'interrupted',error:error.stack});
  fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({kind:'fire-coverage-followup',status:'interrupted',...manifest,
    resultFile:out+'.jsonl',fixedBattles,error:error.message})+'\n');throw error;}
const summary=results.map(r=>({kind:r.kind,stageId:r.stageId,round:r.round,pid:r.pid,name:r.name,from:r.from,to:r.to,
  seed:r.seed,before:{leaks:r.before.leaks,attacks:r.before.unit.stats.attacks,damage:r.before.unit.stats.dmg},
  ...(r.after?{after:{leaks:r.after.leaks,attacks:r.after.unit.stats.attacks,damage:r.after.unit.stats.dmg}}:
    {alternatives:r.alternatives.map(a=>({dir:a.dir,leaks:a.leaks,attacks:a.unit.stats.attacks,damage:a.unit.stats.dmg}))})}));
fs.writeFileSync(out+'.json',JSON.stringify({manifest,results,summary,fixedBattles}),{flag:'wx'});
fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({kind:'fire-coverage-followup',status:'complete',...manifest,
  resultFile:out+'.json',fixedBattles,summary})+'\n');console.log(JSON.stringify({fixedBattles,summary}));
