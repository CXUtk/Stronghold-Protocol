// Seen-sample, read-only coverage audit. Alternative-facing exposure is only a diagnostic hint;
// matched replays below, never this observer, determine whether a turn helps the battle.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runSupportMatch} from './support-runner.mjs';
import {openingFixture} from './diagnose-ranged-block.mjs';
import {observeBattle} from './battle-observer.mjs';
import {saveSourceSnapshot} from './experiment-store.mjs';
import {hashTree} from '../botbench-support.mjs';
import {effectiveProfile} from '../../server/sim/ai.js';
import {absoluteRangeKeys,canTargetEnemy} from '../../server/sim/targeting.js';
import {bodyInKeys} from '../../server/sim/body.js';
import {getData} from '../../server/data.js';

const DIRS=['RIGHT','UP','DOWN','LEFT'];
export function coverageObserver(b) {
  const rows=new Map();let at=0,previous=0;
  const row=u=>{if(!rows.has(u.uid))rows.set(u.uid,{uid:u.uid,id:u.defId,tile:[u.tileR,u.tileC],dir:u.dir,
    firstAttack:null,shots:0,activeSeconds:0,enemySeconds:0,inRangeSeconds:0,blockedMissSeconds:0,
    facingSeconds:Object.fromEntries(DIRS.map(d=>[d,0]))});return rows.get(u.uid);};
  b.on('attack',({attacker})=>{if(attacker.side!=='ally')return;const r=row(attacker);r.shots++;r.firstAttack??=b.time;});
  const step=b.step.bind(b);
  b.step=(...args)=>{
    const result=step(...args);
    if(b.time<at)return result;
    const dt=b.time-previous;previous=b.time;at=b.time+.5;
    for(const u of b.allies()) {
      if(!u.canAct||!u.profile)continue;
      const p=effectiveProfile(u);if(p.heal||p.noAttack)continue;
      const r=row(u);r.activeSeconds+=dt;
      const enemies=b.enemies.filter(e=>canTargetEnemy(u,e,p));if(!enemies.length)continue;
      r.enemySeconds+=dt;
      const own=e=>e.blockedBy===u;
      const reach=e=>own(e)||bodyInKeys(e,u.rangeKeySet||u.rangeKeys);
      if(enemies.some(reach))r.inRangeSeconds+=dt;
      else if(enemies.some(e=>e.blockedBy))r.blockedMissSeconds+=dt;
      const tg=u.skill?.active?u.skill.spec.targeting:null;
      const grid=tg?.rangeGrid||u.rangeGrid||[[0,0]];
      const ext=(tg?.noRangeExtend?0:u.s.rangeExtend)+(tg?.rangeExtend||0);
      for(const d of DIRS){
        const keys=new Set(absoluteRangeKeys(grid,u.tileR,u.tileC,d,ext));
        for(const k of u.extraRangeKeys||[])keys.add(k);
        if(enemies.some(e=>own(e)||bodyInKeys(e,keys)))r.facingSeconds[d]+=dt;
      }
    }
    return result;
  };
  return()=>[...rows.values()].map(r=>{
    const u=b.allyUnits.find(x=>x.uid===r.uid);
    const best=DIRS.reduce((a,d)=>r.facingSeconds[d]>r.facingSeconds[a]?d:a,r.dir);
    return {...r,stats:{...u?.stats},alive:u?.alive,bestFacing:best,
      facingGainSeconds:r.facingSeconds[best]-r.facingSeconds[r.dir]};
  });
}

const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2],data=getData();
assert.ok(out);
for(const ext of ['.json','.jsonl','.source.json'])assert.ok(!fs.existsSync(out+ext));
const referencePath=root+'../logs/ai-retention-paired-validation-20261015.json';
const reference=JSON.parse(fs.readFileSync(referencePath));
const refs=reference.results.filter(r=>r.policyId==='budget-diverse-v1'&&r.seed<=2408&&
  r.band===(r.seed%2===0?'band_amiya':'band_ioleta'));
assert.equal(refs.length,7);
const manifest={createdAt:new Date().toISOString(),label:'seen-seven-map-deployed-diverse-fire-coverage-diagnostic',
  gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  sourceHash:hashTree(root,['server','shared','tools/botbench']),dataHash:hashTree(root,['data']),
  reference:referencePath,sourceSnapshot:out+'.source.json',newSimulationMatches:7,
  scope:'Seven seen four-seat ABYSS 2H2AI prefixes R1-10, alternating anchor band; fixed human inputs, original deployed v17-equivalent policy. Direction-only replay is diagnostic, not independent policy validation.'};
assert.equal(manifest.dataHash,reference.manifest.dataHash,'Data changed from archived reference');
saveSourceSnapshot(root,out+'.source.json',manifest);
const write=x=>fs.appendFileSync(out+'.jsonl',JSON.stringify(x)+'\n');
fs.writeFileSync(out+'.jsonl',JSON.stringify({manifest})+'\n',{flag:'wx'});
const results=[],fields=[],trials=[];let rehearsalBattles=0,fixedBattles=0,formalBattles=0;
const compact=spec=>{const x=structuredClone(spec);for(const p of x.players)for(const u of p.units)delete u.dir;return x;};
const run=(m,spec)=>{
  const b=m.newBattle(spec),observation=observeBattle(b),coverage=coverageObserver(b);
  for(let t=0;t<12000&&!b.finished;t++)b.step();assert.ok(b.finished,'Battle exceeded cap');fixedBattles++;
  const result=b.result(),pid=spec.players[0].playerId;
  return{input:spec,result,leaks:result.perPlayer[pid].leaked.filter(x=>x.counted!==false).length,
    observation:observation(),coverage:coverage()};
};
try {
  for(const ref of refs){
    const pending=[];
    const result=runSupportMatch({seed:ref.seed,humans:2,band:ref.band,rounds:10,stageId:ref.stageId,
      leakCount:ref.leakCount,sourceMode:ref.sourceMode,botBands:ref.botBands,humanFixtures:ref.fixtureInputs,
      rehearsal:8,individualPolicy:'terrain-parity-v12'},{
      configure(m){
        m.botLayoutBudgetPolicy='diverse-v1';
        m.botRehearsalAudit=e=>{if(e.phase==='done')rehearsalBattles+=e.totals.reduce((n,t)=>n+t.completed,0);};
        const make=m.newBattle.bind(m);
        m.newBattle=opts=>{
          const b=make(opts);
          if(opts.kind==='normal'&&opts.fieldId?.startsWith('n:')&&opts.players.some(p=>m.players.get(p.playerId)?.isBot)){
            formalBattles++;
            pending.push({seed:ref.seed,band:ref.band,stageId:ref.stageId,round:m.round,pid:opts.players[0].playerId,
              input:structuredClone(opts),observation:observeBattle(b),coverage:coverageObserver(b),battle:b});
          }
          return b;
        };
      },
      beforeDispose(){for(const f of pending){const {battle,observation,coverage,...record}=f;
        const pp=battle.result().perPlayer[f.pid];record.leaks=pp.leaked.filter(x=>x.counted!==false).length;
        record.result=pp;record.observation=observation();record.coverage=coverage();fields.push(record);write({field:record});}}
    });
    assert.deepEqual(result.rounds,ref.rounds.filter(r=>r.round<=10),'Observer/policy differs from deployed reference');
    assert.deepEqual(result.fixtureInputs,ref.fixtureInputs.filter(r=>r.round<=10));
    results.push(result);write({result,referenceParity:true});
    console.log(JSON.stringify({phase:'prefix',seed:ref.seed,stage:ref.stageId,fields:pending.length,parity:true}));
  }
  // Preserve bounded selection and every losing facing: up to 2 suspect units per map, all 3 alternative facings.
  for(const ref of refs){
    const suspects=fields.filter(f=>f.stageId===ref.stageId).flatMap(f=>f.coverage.map(u=>({f,u})))
      .filter(({f,u})=>f.leaks>0&&u.facingGainSeconds>=5&&data.chess[u.id]?.attackKind!=='heal')
      .sort((a,b)=>b.u.facingGainSeconds-a.u.facingGainSeconds).slice(0,2);
    const {m}=openingFixture(ref.stageId,ref.seed,[]);
    try{for(const {f,u} of suspects){
      const control=run(m,structuredClone(f.input));assert.deepEqual(control.result.perPlayer[f.pid],f.result,'Fixed replay parity');
      const test={seed:f.seed,stageId:f.stageId,band:f.band,round:f.round,pid:f.pid,uid:u.uid,
        id:u.id,name:data.chess[u.id]?.name,control,alternatives:[]};
      for(const dir of DIRS.filter(d=>d!==u.dir)){
        const spec=structuredClone(f.input);spec.players[0].units.find(x=>x.uid===u.uid).dir=dir;
        assert.deepEqual(compact(spec),compact(f.input),'Only facing may change');
        test.alternatives.push({dir,...run(m,spec)});
      }
      trials.push(test);write({trial:test});
      console.log(JSON.stringify({phase:'turns',stage:ref.stageId,round:f.round,name:test.name,
        before:control.leaks,turns:test.alternatives.map(t=>[t.dir,t.leaks])}));
    }}finally{m.dispose();}
  }
}catch(error){write({status:'interrupted',error:error.stack});
  fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({kind:'fire-coverage-audit',status:'interrupted',...manifest,
    resultFile:out+'.jsonl',completedMatches:results.length,fixedBattles,formalBattles,rehearsalBattles,error:error.message})+'\n');throw error;}
const suspects=fields.flatMap(f=>f.coverage.map(u=>({seed:f.seed,stageId:f.stageId,round:f.round,pid:f.pid,leaks:f.leaks,
  ...u,name:data.chess[u.id]?.name}))).filter(u=>u.facingGainSeconds>=5);
const summary={matches:results.length,fields:fields.length,fixedBattles,formalBattles,rehearsalBattles,
  sampledDamageUnits:fields.reduce((n,f)=>n+f.coverage.length,0),suspects:suspects.length,
  trials:trials.map(t=>({seed:t.seed,stageId:t.stageId,round:t.round,pid:t.pid,name:t.name,uid:t.uid,
    before:{leaks:t.control.leaks,...t.control.coverage.find(u=>u.uid===t.uid)},
    turns:t.alternatives.map(a=>({dir:a.dir,leaks:a.leaks,...a.coverage.find(u=>u.uid===t.uid)}))}))};
fs.writeFileSync(out+'.json',JSON.stringify({manifest,results,fields,trials,suspects,summary}),{flag:'wx'});
fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({kind:'fire-coverage-audit',status:'complete',...manifest,
  resultFile:out+'.json',formalBattles,rehearsalBattles,fixedBattles,summary:{...summary,trials:undefined}})+'\n');
console.log(JSON.stringify({complete:true,...summary,trials:undefined}));
