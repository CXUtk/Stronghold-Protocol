// Read-only full-prefix replay, then matched-state trials of every generated layout.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSupportMatch } from './support-runner.mjs';
import { hashTree } from '../botbench-support.mjs';
import { saveSourceSnapshot } from './experiment-store.mjs';
import { projectNormalBattleOptions } from '../../server/match/bot-prep-projection.js';
import { rehearsalSampleSeed } from '../../server/match/bot-information.js';
import { botPrepEnd, fieldModel } from '../../server/match/bot.js';
import { carryScore } from '../../server/match/bot-tactical.js';
import { observeBattle } from './battle-observer.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = resolve(process.argv[2]);
const reference = JSON.parse(fs.readFileSync(resolve(root, '../logs/ai-current-20261015-fresh42.json')));
for (const ext of ['.json', '.jsonl', '.source.json']) assert.ok(!fs.existsSync(out + ext));
const cases = [
  [2, 1902, 'band_amiya'], [3, 1902, 'band_ioleta'],
  [2, 1905, 'band_ioleta'], [2, 1907, 'band_ioleta'],
];
const manifest = { label: 'seen-sample-matched-preparation-layout-budget-diagnostic', createdAt: new Date().toISOString(),
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root, encoding:'utf8'}).trim(),
  sourceHash: hashTree(root, ['server','shared','tools/botbench']), dataHash: hashTree(root,['data']),
  cases, sourceSnapshot: out + '.source.json', newSimulationMatches: cases.length,
  scope: 'Four seen full-prefix production-policy rollouts; same-state common three-sample trials of omitted layouts in rounds 8 and 9. Not independent validation.' };
saveSourceSnapshot(root, out + '.source.json', manifest);
fs.writeFileSync(out + '.jsonl', JSON.stringify({manifest})+'\n', {flag:'wx'});
const results = [], diagnostics = [], replays = [];
let evaluatedBattles = 0;
const signature = plan => [...plan].sort((a,b)=>a[0]-b[0]).map(([uid,tile])=>`${uid}@${tile}:${plan.dirs.get(uid)||'RIGHT'}`).join('|');
try {
  for (const [humans,seed,band] of cases) {
    const ref=reference.results.find(r=>r.humans===humans&&r.seed===seed&&r.band===band&&r.policyId==='deploy-current-20261015');
    const pending = new Map(), formal = [];
    const result=runSupportMatch({seed,humans,band,rounds:11,stageId:ref.stageId,leakCount:ref.leakCount,
      sourceMode:ref.sourceMode,botBands:ref.botBands,humanFixtures:ref.fixtureInputs,
      rehearsal:8,individualPolicy:'terrain-parity-v12'}, {
      configure(m) {
        const make=m.newBattle.bind(m);
        m.newBattle=opts=>{
          const b=make(opts);
          if(!opts.fieldId?.startsWith('r:') && opts.kind==='normal' && [8,9].includes(m.round)
            && opts.players.some(p=>m.players.get(p.playerId)?.isBot)) {
            const snapshot=observeBattle(b);
            const mire=new Map(), step=b.step.bind(b);
            b.step=(...args)=>{const before=b.time;const r=step(...args);
              for(const u of b.allyUnits)if(u.alive&&u.deployed&&u.findBuff('terrain:mire')){
                const row=mire.get(u.uid)||{uid:u.uid,id:u.defId,seconds:0,minAspd:Infinity,maxStacks:0};
                row.seconds+=b.time-before;row.minAspd=Math.min(row.minAspd,u.s.aspd);row.maxStacks=Math.max(row.maxStacks,u.mem.mireStacks||0);mire.set(u.uid,row);
              }return r;};
            formal.push({round:m.round,input:structuredClone(opts),snapshot:()=>({...snapshot(),mire:[...mire.values()]})});
          }
          return b;
        };
        m.botRehearsalAudit=event=>{
          if(![8,9].includes(m.round))return;
          const ps=event.player,k=`${m.round}:${ps.playerId}`;
          if(event.phase==='done') {
            const d=pending.get(k);assert.ok(d);
            d.selected=signature(event.selected);d.productionScores=event.totals;
            assert.ok(event.candidates.every((p,i)=>Math.abs(event.totals[i].score/3
              -d.trials.find(t=>t.signature===signature(p)).meanScore)<1e-6), 'Matched-state trials differ from production samples');
            const best=[...d.trials].sort((a,b)=>b.meanScore-a.meanScore)[0];
            d.omittedWinner=!event.candidates.some(p=>signature(p)===best.signature);
            d.bestAll=best.signature;diagnostics.push(d);
            fs.appendFileSync(out+'.jsonl',JSON.stringify({diagnostic:d})+'\n');return;
          }
          const d={humans,seed,band,map:ref.stageId,round:m.round,pid:ps.playerId,playerBand:ps.bandId,
            board:[...ps.board].map(([tile,u])=>({tile,id:u.id,uid:u.uid,dir:u.dir})),layers:{...ps.layers},
            roster:event.chosen.map(p=>({uid:p.uid,id:p.id})),
            generated:event.plans.map(p=>({signature:signature(p),variant:p.variant||{},tiles:[...p],directions:[...p.dirs]})),
            candidates:event.candidates.map(signature),trials:[],routes:fieldModel(m,ps).routes.map(r=>({fly:r.fly,n:r.n,tiles:r.tiles}))};
          for(const plan of event.distinct) {
            const trial={signature:signature(plan),variant:plan.variant||{},included:event.candidates.includes(plan),samples:[]};
            for(let sample=0;sample<3;sample++) {
              const opts=projectNormalBattleOptions(m,ps,(copy,player,clone)=>{
                botPrepEnd(copy,player,{done:true,chosen:event.chosen.map(clone),best:plan,plans:[null]});
              },{sampleSeed:rehearsalSampleSeed(m,ps,sample),deadline:true});
              const b=make(opts),cap=Math.ceil(((m.wave.timeLimit||60)+5)*30);
              for(let tick=0;tick<cap&&!b.finished;tick++)b.step();
              const capped=!b.finished;if(capped)b.forceEnd('timeout');evaluatedBattles++;
              const pp=b.result().perPlayer[ps.playerId];
              trial.samples.push({input:opts,result:pp,capped,score:carryScore(pp),leaks:pp.leaked.filter(l=>l.counted!==false).length});
            }
            trial.meanScore=trial.samples.reduce((n,s)=>n+s.score,0)/3;
            trial.meanLeaks=trial.samples.reduce((n,s)=>n+s.leaks,0)/3;d.trials.push(trial);
          }
          pending.set(k,d);
        };
      },
      beforeDispose(){for(const f of formal)replays.push({humans,seed,band,...f,snapshot:f.snapshot()});},
    });
    assert.deepEqual(result.rounds,ref.rounds,'Read-only diagnostics changed full-prefix outcome');
    assert.deepEqual(result.fixtureInputs,ref.fixtureInputs);results.push(result);
    fs.appendFileSync(out+'.jsonl',JSON.stringify({result})+'\n');
    console.log(JSON.stringify({humans,seed,band,roundsParity:true,diagnostics:diagnostics.length,evaluatedBattles}));
  }
} catch(error) {
  fs.appendFileSync(out+'.jsonl',JSON.stringify({status:'interrupted',error:error.stack})+'\n');
  fs.appendFileSync(resolve(root,'../logs/ai-experiment-index.jsonl'),JSON.stringify({kind:'mechanism-diagnostic',status:'interrupted',resultFile:out+'.jsonl',...manifest,completedMatches:results.length,evaluatedBattles,error:error.message})+'\n');
  throw error;
}
const summary={matches:results.length,diagnostics:diagnostics.length,evaluatedBattles,omittedWinners:diagnostics.filter(d=>d.omittedWinner).length,
  cases:diagnostics.map(d=>{const selected=d.trials.find(t=>t.signature===d.selected),best=d.trials.find(t=>t.signature===d.bestAll);
    return {humans:d.humans,seed:d.seed,band:d.band,round:d.round,pid:d.pid,playerBand:d.playerBand,
      selectedVariant:selected.variant,selectedLeaks:selected.meanLeaks,bestVariant:best.variant,bestLeaks:best.meanLeaks,omitted:d.omittedWinner};})};
fs.writeFileSync(out+'.json',JSON.stringify({manifest,results,diagnostics,replays,summary}),{flag:'wx'});
fs.appendFileSync(resolve(root,'../logs/ai-experiment-index.jsonl'),JSON.stringify({kind:'mechanism-diagnostic',status:'complete',resultFile:out+'.json',...manifest,evaluatedBattles,summary,sourceSnapshot:out+'.source.json'})+'\n');
console.log(JSON.stringify(summary));
