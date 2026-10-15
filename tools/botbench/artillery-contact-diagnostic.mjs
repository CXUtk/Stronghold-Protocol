// Constructed R5 mire example, not a claim to reproduce the user's exact roster or seed.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openingFixture,replayPlan} from './diagnose-ranged-block.mjs';
import {LayoutPlan,arrange} from '../../server/match/bot.js';
import {buildNormalWave} from '../../server/match/waves.js';
import {observeBattle} from './battle-observer.mjs';
import {saveSourceSnapshot} from './experiment-store.mjs';
import {hashTree} from '../botbench-support.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2];
assert.ok(out);for(const ext of ['.json','.jsonl','.source.json'])assert.ok(!fs.existsSync(out+ext));
const ids=['2_18','1_02','1_02','2_14','1_17','1_01','1_06','1_09'].map(id=>`chess_char_${id}_b`);
const manifest={createdAt:new Date().toISOString(),label:'seen-seed-constructed-R5-mire-mechanism',
  gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  sourceHash:hashTree(root,['server','shared','tools/botbench']),dataHash:hashTree(root,['data']),
  newSimulationMatches:0,sourceSnapshot:out+'.source.json',seed:2410,stage:'act2autochess_m02',round:5,
  scope:'Four-seat ABYSS stats; constructed roster/gear/layers, fixed enemy stream; both Ashlock skills; no actual user replay available.'};
saveSourceSnapshot(root,out+'.source.json',manifest);fs.writeFileSync(out+'.jsonl',JSON.stringify({manifest})+'\n',{flag:'wx'});
const {m,ps,pieces}=openingFixture(manifest.stage,manifest.seed,ids),results=[];
let battles=0,rehearsalBattles=0;
try {
  m.round=5;m.wave=buildNormalWave(m.gd,m.rngWaves,m.factions,5);m._botPath=null;
  const plan=new LayoutPlan(),positions=['10,8','9,6','12,8','10,6','11,5','10,4','10,5','11,6'];
  pieces.forEach((p,i)=>{plan.set(p.uid,positions[i]);plan.dirs.set(p.uid,i===0||i===2||i===3?'LEFT':'RIGHT');});
  const canonical=replayPlan(m,ps,pieces,plan).input;battles++;
  const play=(input,skill,label)=>{
    const spec=structuredClone(input);spec.players[0].units.find(u=>u.uid===pieces[0].uid).skillIndex=skill;
    const battle=m.newBattle(spec),observation=observeBattle(battle);
    const attacks=[],contacts=[];
    battle.on('attack',({attacker})=>{if(attacker.uid===pieces[0].uid)attacks.push(battle.time);});
    battle.on('blocked',({blocker,enemy})=>contacts.push({time:battle.time,blocker:blocker.uid,enemy:[enemy.y,enemy.x]}));
    for(let i=0;i<12000&&!battle.finished;i++)battle.step();assert.ok(battle.finished);battles++;
    const record={label,skill,input:spec,result:battle.result(),observation:observation(),attacks,contacts};
    record.artillery=record.observation.units.find(u=>u.uid===pieces[0].uid);
    results.push(record);fs.appendFileSync(out+'.jsonl',JSON.stringify({record})+'\n');
  };
  for(const skill of [0,1]){
    play(canonical,skill,'screenshot-like-backward-fence');
    const next=structuredClone(canonical),gray=next.players[0].units.find(u=>u.uid===pieces[0].uid);
    gray.row=9;gray.col=3;gray.dir='RIGHT';next.players[0].units.sort((a,b)=>b.row-a.row||a.col-b.col);
    play(next,skill,'same-roster-behind-frontline');
  }
  for(const enabled of [false,true]){
    // Independent identical fixtures; arranging the first bank must not change the second's RNG/board.
    const {m:trial,ps:player,pieces:owned}=openingFixture(manifest.stage,manifest.seed,ids);
    try {
    trial.round=5;trial.wave=buildNormalWave(trial.gd,trial.rngWaves,trial.factions,5);trial._botPath=null;
    trial.botArtilleryContactCandidates=enabled;trial.botLayoutBudgetPolicy='diverse-v1';
    trial.botRehearsalAudit=e=>{if(e.phase==='done')rehearsalBattles+=e.totals.reduce((n,t)=>n+t.completed,0);};
    const job=arrange(trial,player,{final:true,defer:true});job.run();
    const r=replayPlan(trial,player,job.chosen,job.best);battles++;
    const record={label:enabled?'contact-candidate':'current-diverse',input:r.input,result:r.result,
      observation:r.observation,artillery:r.observation.units.find(u=>u.uid===owned[0].uid),
      plans:job.plans.map(p=>({tiles:[...p],dirs:[...p.dirs],variant:p.variant})),leaks:r.leaks};
    results.push(record);fs.appendFileSync(out+'.jsonl',JSON.stringify({record})+'\n');
    if(enabled){
      const proposal=job.plans.find(p=>p.variant?.artilleryContact);
      if(proposal){const r=replayPlan(trial,player,job.chosen,proposal);battles++;
        const record={label:'retained-contact-proposal',input:r.input,result:r.result,observation:r.observation,
          artillery:r.observation.units.find(u=>u.uid===owned[0].uid),leaks:r.leaks};
        results.push(record);fs.appendFileSync(out+'.jsonl',JSON.stringify({record})+'\n');}
    }
    } finally {trial.dispose();}
  }
} finally {m.dispose();}
const summary=results.map(r=>({label:r.label,skill:r.skill,attacks:r.artillery?.stats.attacks,damage:r.artillery?.stats.dmg,
  firstAttack:r.attacks?.[0]??null,firstBlock:r.contacts?.[0]?.time??null,
  tile:r.artillery?.tile,leaks:r.result.perPlayer[ps.playerId].leaked.filter(x=>x.counted!==false).length}));
fs.writeFileSync(out+'.json',JSON.stringify({manifest,results,summary,battles,fixedBattles:battles,rehearsalBattles}),{flag:'wx'});
fs.appendFileSync(root+'../logs/ai-experiment-index.jsonl',JSON.stringify({kind:'artillery-contact-diagnostic',status:'complete',resultFile:out+'.json',...manifest,
  evaluatedBattles:battles+rehearsalBattles,fixedBattles:battles,rehearsalBattles,summary})+'\n');
console.log(JSON.stringify(summary));
