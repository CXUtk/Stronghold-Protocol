import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runSupportMatch} from './support-runner.mjs';import {saveSourceSnapshot} from './experiment-store.mjs';
import {hashTree} from '../botbench-support.mjs';import {LayoutPlan,fireCoverageContext} from '../../server/match/bot.js';
import {fireCoverageSteps} from '../../server/match/bot-fire-coverage.js';
import {layoutSignature} from '../../server/match/bot-layout-budget.js';
import {observeFireSkills} from './fire-skill-observer.mjs';import {deriveSeed} from '../../server/sim/rng.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2];assert.ok(out);
for(const ext of ['.json','.jsonl','.source.json'])assert.ok(!fs.existsSync(out+ext));
const referenceFile=root+'../logs/ai-fire-coverage-v2-validation-20261016.json',reference=JSON.parse(fs.readFileSync(referenceFile));
const cases=[[2602,'band_ioleta'],[2604,'band_amiya'],[2605,'band_amiya']];
const manifest={kind:'seen-R89-fixed-loadout-skill-coverage-diagnostic',createdAt:new Date().toISOString(),
  gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHash:hashTree(root,['server','shared','tools/botbench']),
  dataHash:hashTree(root,['data']),reference:referenceFile,cases,sourceSnapshot:out+'.source.json',newSimulationMatches:3,
  scope:'Seen native-diverse prefixes to R9; fixed roster/gear/skills/layers/enemies, only legal plan positions/directions change. Original formal seed plus two matched diagnostic seeds; not independent validation.'};
assert.equal(manifest.dataHash,reference.manifest.dataHash);saveSourceSnapshot(root,out+'.source.json',manifest);
fs.writeFileSync(out+'.jsonl',JSON.stringify({manifest})+'\n',{flag:'wx'});
const write=x=>fs.appendFileSync(out+'.jsonl',JSON.stringify(x)+'\n'),results=[],diagnostics=[];
let fixedBattles=0,rehearsalBattles=0;
const copy=p=>{const q=new LayoutPlan(p);q.dirs=new Map(p.dirs);q.variant=structuredClone(p.variant||{});return q;};
const serial=p=>({tiles:[...p],dirs:[...p.dirs],variant:p.variant||{},signature:layoutSignature(p)});
const resources=spec=>{const s=structuredClone(spec);delete s.seed;
  for(const p of s.players){for(const u of p.units){delete u.row;delete u.col;delete u.dir;}p.units.sort((a,b)=>a.uid-b.uid);}return s;};
try{for(const [seed,band]of cases){
  const ref=reference.results.find(r=>r.policyId==='budget-diverse-v1'&&r.seed===seed&&r.band===band);
  const pending=new Map(),formal=new Map();let engine;
  const result=runSupportMatch({seed,humans:2,band,rounds:9,stageId:ref.stageId,leakCount:ref.leakCount,
    sourceMode:ref.sourceMode,botBands:ref.botBands,humanFixtures:ref.fixtureInputs,rehearsal:8,individualPolicy:'terrain-parity-v12'},
  {configure(m){m.botLayoutBudgetPolicy='diverse-v1';engine=m.newBattle.bind(m);m.newBattle=opts=>{
    const b=engine(opts);if(opts.kind==='normal'&&opts.fieldId?.startsWith('n:')&&[8,9].includes(m.round)&&opts.players[0].playerId==='p2'){
      formal.set(m.round,{input:structuredClone(opts),b,snapshot:observeFireSkills(b)});
    }return b;};
    m.botRehearsalAudit=e=>{
      if(e.phase==='done')rehearsalBattles+=e.totals.reduce((n,t)=>n+t.completed,0);
      if(![8,9].includes(m.round)||e.player.playerId!=='p2')return;
      if(e.phase==='start'){
        const context=fireCoverageContext(m,e.player,e.chosen),banks={diverse:e.candidates.map(copy)};
        const proposals={};
        for(const policy of ['contact-turn-v1','contact-position-v1']){
          const gen=fireCoverageSteps(e.candidates,{policy,...context});let x=gen.next();while(!x.done)x=gen.next();
          proposals[policy]={...x.value,plans:undefined};banks[policy]=x.value.plans.map(copy);
        }
        pending.set(m.round,{round:m.round,pid:e.player.playerId,banks,proposals,
          aliases:e.plans.map(serial),model:{routes:context.model.routes,armor:context.model.armor}});
      }else{const d=pending.get(m.round);d.selected=layoutSignature(e.selected);d.training=e.totals;}
    };
  },beforeDispose(){
    for(const [round,state]of pending){
      if(!(seed===2602&&round===9||seed===2604&&round===8||seed===2605))continue;
      const f=formal.get(round);assert.ok(f);
      const pp=f.b.result().perPlayer['p2'],expected=ref.rounds.find(w=>w.round===round).players.find(p=>p.pid==='p2');
      assert.equal(pp.leaked.filter(x=>x.counted!==false).length,expected.rawLeaks);
      const input=f.input,roster=new Set(input.players[0].units.map(u=>u.uid)),plans=new Map();
      for(const [group,bank]of Object.entries(state.banks))for(const plan of bank){
        const sig=layoutSignature(plan);if(!plans.has(sig))plans.set(sig,{plan,groups:[]});plans.get(sig).groups.push(group);
      }
      const selected=plans.get(state.selected)?.plan;assert.ok(selected);
      // Explicit LEFT/RIGHT/UP/DOWN probes for a ranged control or support piece, not only the static winner.
      const focus=input.players[0].units.filter(u=>['chess_char_1_17_b','chess_char_1_06_b','chess_char_2_04_a'].includes(u.chessId)).slice(0,2);
      for(const unit of focus)for(const dir of ['RIGHT','UP','DOWN','LEFT']){
        const plan=copy(selected);plan.dirs.set(unit.uid,dir);plan.variant={probeUid:unit.uid,probeDir:dir};
        const sig=layoutSignature(plan);if(!plans.has(sig))plans.set(sig,{plan,groups:['single-facing-probe']});
      }
      const record={seed,band,stageId:ref.stageId,...state,banks:Object.fromEntries(Object.entries(state.banks).map(([g,b])=>[g,b.map(serial)])),
        formal:{input,result:pp,telemetry:f.snapshot()},trials:[]};
      for(const {plan,groups}of plans.values()){
        assert.ok([...plan.keys()].every(uid=>roster.has(uid)),'Post-prep roster differs; no invented matching');
        const trial={...serial(plan),groups,samples:[]};
        for(let sample=0;sample<3;sample++){
          const spec=structuredClone(input);if(sample)spec.seed=deriveSeed(input.seed,`r89-diagnostic:${sample}`);
          for(const u of spec.players[0].units)if(plan.has(u.uid)){
            [u.row,u.col]=plan.get(u.uid).split(',').map(Number);u.dir=plan.dirs.get(u.uid)||'RIGHT';
          }
          spec.players[0].units.sort((a,b)=>b.row-a.row||a.col-b.col);
          assert.deepEqual(resources(spec),resources(input));
          const b=engine(spec),snapshot=observeFireSkills(b);for(let i=0;i<12000&&!b.finished;i++)b.step();assert.ok(b.finished);fixedBattles++;
          const r=b.result().perPlayer['p2'];if(layoutSignature(plan)===state.selected&&!sample)assert.deepEqual(r,pp,'Original formal replay differs');
          trial.samples.push({seed:spec.seed,input:spec,result:r,leaks:r.leaked.filter(x=>x.counted!==false).length,telemetry:snapshot()});
        }
        record.trials.push(trial);
      }
      diagnostics.push(record);write({diagnostic:record});
      console.log(JSON.stringify({seed,round,formalLeaks:expected.rawLeaks,plans:record.trials.length,
        bestFormal:Math.min(...record.trials.map(t=>t.samples[0].leaks)),fixedBattles}));
    }
  }});
  assert.deepEqual(result.rounds,ref.rounds.filter(r=>r.round<=9),'Read-only prefix changed');
  results.push(result);write({result,referenceParity:true});
}}catch(error){write({status:'interrupted',error:error.stack});fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({
  ...manifest,status:'interrupted',completedMatches:results.length,fixedBattles,rehearsalBattles,resultFile:out+'.jsonl',error:error.message})+'\n');throw error;}
const summary=diagnostics.map(d=>({seed:d.seed,round:d.round,stageId:d.stageId,formalLeaks:d.formal.result.leaked.filter(x=>x.counted!==false).length,
  selected:d.selected,proposals:d.proposals,plans:d.trials.map(t=>({signature:t.signature,variant:t.variant,groups:t.groups,leaks:t.samples.map(s=>s.leaks)}))}));
fs.writeFileSync(out+'.json',JSON.stringify({manifest,results,diagnostics,summary,fixedBattles,rehearsalBattles}),{flag:'wx'});
fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({...manifest,status:'complete',resultFile:out+'.json',fixedBattles,rehearsalBattles})+'\n');
console.log(JSON.stringify({complete:true,prefixes:results.length,states:diagnostics.length,fixedBattles,rehearsalBattles}));
