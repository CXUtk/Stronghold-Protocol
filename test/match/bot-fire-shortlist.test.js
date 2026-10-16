import test from 'node:test';import assert from 'node:assert/strict';
import {getData} from '../../server/data.js';import {DataSource} from '../../server/sim/simdata.js';
import {fireSkillDescriptor} from '../../server/match/bot-fire-skills.js';
import {protectedFireSignatures,skillLayoutFeatures} from '../../server/match/bot-fire-shortlist.js';
import {LayoutPlan,arrange,skillFireCoverageContext} from '../../server/match/bot.js';
import {layoutSignature,allocateLayoutBudget} from '../../server/match/bot-layout-budget.js';
import {openingFixture} from '../../tools/botbench/diagnose-ranged-block.mjs';
const ds=new DataSource(getData()),model={routes:[{n:10,fly:false,hp:1000,tileTime:1,tiles:['9,8','9,7','9,6','9,5']}]};
const unit=(uid,key,cover,extra={})=>({uid,key,cover:new Set(cover),skillCover:new Set(cover),dps:100,
  block:0,basicAir:true,activeAir:true,descriptor:{duty:.3,normalEnabled:true,activeEnabled:true,scale:1},...extra});
test('selected Indigo S1 active range differs from basic, S2 keeps basic and Vendela retains module healing',()=>{
  const one=fireSkillDescriptor(ds.getChess('chess_char_1_17_b',{skillIndex:0}));
  const two=fireSkillDescriptor(ds.getChess('chess_char_1_17_b',{skillIndex:1}));
  assert.notDeepEqual(one.activeGrid,one.basicGrid);assert.deepEqual(two.activeGrid,two.basicGrid);
  const v=fireSkillDescriptor(ds.getChess('chess_char_1_06_b'));assert.equal(v.protege,true);assert.equal(v.healRatio,.6);
  const x=fireSkillDescriptor(ds.getChess('chess_char_2_04_a'));assert.equal(x.activeControl,4);assert.ok(x.scale<1.45);
});
test('deduplicated hold:8 retains healing role even when its primary tag is different',()=>{
  const p=new LayoutPlan([[1,'9,6']]);p.variant={hold:8};
  const alias=new LayoutPlan(p);alias.variant={secondHold:1,healHold:.75};
  assert.ok(protectedFireSignatures([p,alias]).has(layoutSignature(p)));
});
test('skill-only range is not credited for a DEFAULT skill without any basic trigger target',()=>{
  const u=unit(1,'10,5',[],{skillCover:new Set(['9,8','9,7']),descriptor:{duty:.5,scale:2,needsBasicTarget:true}});
  assert.equal(skillLayoutFeatures([u],model).routes[0].active,0);
  assert.ok(skillLayoutFeatures([{...u,descriptor:{...u.descriptor,needsBasicTarget:false}}],model).routes[0].active>0);
});
test('same attack exposure can have different ally support coverage',()=>{
  const tank=unit(1,'9,6',['9,6'],{block:2}),reserve=unit(2,'9,5',['9,5'],{block:2});
  const a=unit(3,'10,5',['9,8','9,7','9,6'],{descriptor:{duty:.3,scale:1,healRatio:.6,protege:true}});
  const b={...a,cover:new Set(['9,8','9,7'])};
  const x=skillLayoutFeatures([tank,reserve,a],model),y=skillLayoutFeatures([tank,reserve,b],model);
  assert.ok(x.routes[0].support>y.routes[0].support);assert.ok(x.score>y.score);
});
for(const policy of ['alias-contact-r89-v3','skill-shortlist-r89-v3'])test(`${policy} protects aliased roles and has at most eight layouts/three samples`,()=>{
  const {m,ps,pieces}=openingFixture('act2autochess_m02',2605,['chess_char_1_06_b','chess_char_1_17_b','chess_char_1_02_b','chess_char_2_04_a']);
  try{
    m.round=8;m.botLayoutBudgetPolicy='diverse-v1';m.botFireCoveragePolicy=policy;m.botFireCoverageTrace=true;
    let start,done;m.botRehearsalAudit=e=>{if(e.phase==='start')start=e;else done=e;};
    const context=skillFireCoverageContext(m,ps,pieces);assert.ok(context.makeUnits(new LayoutPlan()).length===0);
    const job=arrange(m,ps,{final:true,defer:true});job.run();
    const original=allocateLayoutBudget(start.plans,8,{policy:'diverse-v1',round:8,mire:true});
    for(const key of protectedFireSignatures(start.plans))if(original.some(p=>layoutSignature(p)===key))
      assert.ok(start.candidates.some(p=>layoutSignature(p)===key));
    assert.ok(done.candidates.length<=8);assert.ok(done.totals.every(t=>t.completed===3));
    if(policy.startsWith('skill')){assert.ok(start.fireCoverage.shortlist.length<=4);assert.ok(start.fireCoverage.selectedCount<=2);assert.ok(start.fireCoverage.scores.length>0);}
  }finally{m.dispose();}
});
test('new shortlist is inactive outside R8/9 and does not force a rotation',()=>{
  const {m,ps}=openingFixture('act1autochess_m02',2602);try{
    m.botLayoutBudgetPolicy='diverse-v1';m.botFireCoveragePolicy='skill-shortlist-r89-v3';
    let event;m.botRehearsalAudit=e=>{if(e.phase==='start')event=e;};
    const job=arrange(m,ps,{final:true,defer:true});job.run();assert.equal(event.fireCoverage.reason,'outside-focus');
  }finally{m.dispose();}
});
