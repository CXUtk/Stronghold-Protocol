import fs from 'node:fs';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';
import{fileURLToPath}from'node:url';import{makeMatch}from'../../test/match/harness.js';
import{hashTree}from'../botbench-support.mjs';import{saveSourceSnapshot}from'./experiment-store.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2];assert.ok(out);
for(const ext of ['.json','.jsonl','.source.json'])assert.ok(!fs.existsSync(out+ext));
const inputFile=root+'../logs/ai-fire-calibration-diagnostic-20261016.json',data=JSON.parse(fs.readFileSync(inputFile));
const state=data.diagnostics.find(d=>d.seed===2805&&d.band==='band_ioleta'&&d.round===9&&d.pid==='p3');
const manifest={kind:'seen-fixed-protege-target-probe',createdAt:new Date().toISOString(),inputFile,newSimulationMatches:0,
 gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHash:hashTree(root,['server','shared','tools/botbench']),dataHash:hashTree(root,['data'])};
saveSourceSnapshot(root,out+'.source.json',manifest);fs.writeFileSync(out+'.jsonl',JSON.stringify({manifest})+'\n');
const h=makeMatch({humans:4,difficulty:'ABYSS'}),results=[];
try{for(const index of [0,1,8]){
 const trial=state.trials[index],spec=structuredClone(state.formal.input),positions=new Map(trial.tiles),dirs=new Map(trial.dirs);
 for(const u of spec.players[0].units){[u.row,u.col]=positions.get(u.uid).split(',').map(Number);u.dir=dirs.get(u.uid);}
 spec.players[0].units.sort((a,b)=>b.row-a.row||a.col-b.col);const b=h.m.newBattle(spec),attacks=[],casts=[],damages=[],snapshots=[];let next=0;
 b.on('attack',({attacker:u,targets})=>{if(u.side==='ally')attacks.push({time:b.time,uid:u.uid,active:!!u.skill?.active,
  targets:targets.map(e=>({id:e.id,defId:e.defId,xy:[e.y,e.x],hp:e.hp,def:e.s.def,res:e.s.res,blockedBy:e.blockedBy?.uid??null,bind:!!e.s.flags.bind,cold:!!e.s.flags.cold}))});});
 b.on('skillStart',({unit:u})=>{if(u.side==='ally')casts.push({time:b.time,uid:u.uid,protege:u.mem.protege?.uid??null,targets:b.allies().filter(x=>u.rangeKeys.includes(`${x.tileR},${x.tileC}`)).map(x=>({uid:x.uid,hp:x.s.maxHp,block:x.s.blockCnt}))});});
 b.on('damaged',c=>{if(c.source?.side==='ally'&&c.target?.side==='enemy')damages.push({time:b.time,uid:c.source.uid,enemy:c.target.defId,amount:c.amount,tags:c.dmg?.tags});});
 for(let i=0;i<12000&&!b.finished;i++){b.step();if(b.time>=next){snapshots.push({time:b.time,units:b.allyUnits.map(u=>({uid:u.uid,alive:u.alive,hp:u.hp,maxHp:u.s.maxHp,atk:u.s.atk,aspd:u.s.aspd,def:u.s.def,mire:u.mem.mireStacks||0,protege:u.mem.protege?.uid??null}))});next+=10;}}
 assert.ok(b.finished);const result=b.result().perPlayer[state.pid];
 const row={index,input:spec,result,attacks,casts,damages,snapshots,errors:b.errorCount};results.push(row);fs.appendFileSync(out+'.jsonl',JSON.stringify(row)+'\n');
 assert.deepEqual(JSON.parse(JSON.stringify(result)),trial.samples[0].result);
 assert.equal(b.errorCount,0,'Telemetry must not throw from a battle hook');
 console.log(JSON.stringify({index,leaks:trial.samples[0].leaks,casts:casts.filter(c=>c.protege!=null),damageByUnit:result.unitStats.map(u=>({uid:u.uid,dmg:u.dmg,heal:u.heal}))}));
}}finally{h.m.dispose();h.sched.dispose();}
fs.writeFileSync(out+'.json',JSON.stringify({manifest,results,fixedBattles:results.length}));fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({...manifest,status:'complete',fixedBattles:results.length,resultFile:out+'.json'})+'\n');
