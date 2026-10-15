import test from 'node:test';
import assert from 'node:assert/strict';
import {artilleryContactScore,preferArtilleryCandidate} from '../../server/match/bot-artillery.js';
import {openingFixture,replayPlan} from '../../tools/botbench/diagnose-ranged-block.mjs';
import {arrange,fieldModel,rangeRec,rangeTiles} from '../../server/match/bot.js';
import {buildNormalWave} from '../../server/match/waves.js';
import {canPlace,placeClass,parseKey} from '../../server/match/board.js';

test('shooting only the path after its first blocker does not cover the actual contact',()=>{
  const model={routes:[{tiles:['gate','incoming','shield','behind'],n:5,fly:false}]};
  const allies=[{key:'shield',block:3}];
  assert.equal(artilleryContactScore({ground:true,cover:new Set(['behind'])},allies,model),0);
  assert.equal(artilleryContactScore({ground:true,cover:new Set(['incoming'])},allies,model),5);
  assert.equal(artilleryContactScore({ground:true,cover:new Set(['incoming'])},[],model),0);
  assert.equal(artilleryContactScore({ground:true,cover:new Set(['incoming'])},allies,
    {routes:[{...model.routes[0],fly:true}]}),0);
});

test('artillery participation breaks exact mean-score ties, never overrides a worse original preview score',()=>{
  assert.ok(preferArtilleryCandidate({mean:90,score:89.96,active:3},{mean:90,score:90,active:0}));
  assert.equal(preferArtilleryCandidate({mean:90,score:90,active:0},{mean:90,score:89.96,active:3}),false);
  assert.equal(preferArtilleryCandidate({mean:-9910,score:-9910,active:3},{mean:90,score:90,active:0}),false);
  assert.equal(preferArtilleryCandidate({mean:89,score:89,active:3},{mean:90,score:90,active:0}),false);
});

test('R5 mire keeps a legal contact-firing Ashlock proposal inside eight three-sample layouts',()=>{
  const ids=['2_18','1_02','1_02','2_14','1_17','1_01','1_06','1_09'].map(id=>`chess_char_${id}_b`);
  const {m,ps,pieces}=openingFixture('act2autochess_m02',2410,ids);
  try {
    m.round=5;m.wave=buildNormalWave(m.gd,m.rngWaves,m.factions,5);m._botPath=null;
    m.botLayoutBudgetPolicy='diverse-v1';m.botArtilleryContactCandidates=true;
    let audit;m.botRehearsalAudit=e=>{if(e.phase==='done')audit=e;};
    const job=arrange(m,ps,{final:true,defer:true});
    const candidate=job.plans.find(p=>p.variant?.artilleryContact);assert.ok(candidate);
    const units=job.chosen.map(p=>{
      const key=candidate.get(p.uid),[r,c]=parseKey(key),rec=rangeRec(ps,ps.gd.chess(p.id));
      assert.ok(canPlace(ps.deployMap(),placeClass(ps,rec),r,c));
      return {key,uid:p.uid,block:rec.position==='MELEE'?rec.stats.blockCnt:0,ground:rec.attackKind!=='heal',
        cover:new Set(rangeTiles(rec,r,c,candidate.dirs.get(p.uid)))};
    });
    assert.ok(artilleryContactScore(units.find(u=>u.uid===pieces[0].uid),units,fieldModel(m,ps))>0);
    job.run();assert.ok(job.plans.length<=8);assert.ok(audit.totals.every(t=>t.completed===3));
    const result=replayPlan(m,ps,job.chosen,candidate);
    assert.ok(result.observation.units.find(u=>u.uid===pieces[0].uid).stats.dmg>0);
  } finally {m.dispose();}
});

test('without a fortress the option preserves the exact candidate bank',()=>{
  const plans=[];
  for(const enabled of [false,true]){
    const {m,ps}=openingFixture('act2autochess_m02',2410,['chess_char_1_06_a','chess_char_1_02_a']);
    try {m.botLayoutBudgetPolicy='diverse-v1';m.botArtilleryContactCandidates=enabled;
      plans.push(arrange(m,ps,{final:true,defer:true}).plans);
    } finally {m.dispose();}
  }
  assert.deepEqual(plans[0],plans[1]);
});
