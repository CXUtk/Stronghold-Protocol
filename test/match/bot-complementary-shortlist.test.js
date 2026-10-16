import test from 'node:test';import assert from 'node:assert/strict';
import {acquisitionWindows,windowDistance,complementaryEligible,complementaryShortlistSteps} from '../../server/match/bot-complementary-shortlist.js';
import {protectedFireSignatures} from '../../server/match/bot-fire-shortlist.js';
import {LayoutPlan,arrange} from '../../server/match/bot.js';
import {layoutSignature,allocateLayoutBudget} from '../../server/match/bot-layout-budget.js';
import {openingFixture} from '../../tools/botbench/diagnose-ranged-block.mjs';

test('bounded non-increasing exposure can explore narrower target acquisition, but empty or excessive losses cannot',()=>{
 const before={score:10,routes:[{capacity:2,effective:10,support:2}]};
 const after={score:9.8,routes:[{capacity:2,effective:8,support:2}]};
 const a=new Set(['front','late']),b=new Set(['front']);
 assert.equal(complementaryEligible(before,after,a,b),true);
 assert.equal(complementaryEligible(before,{...after,score:9},a,b),false);
 assert.equal(complementaryEligible(before,after,a,new Set()),false);
 assert.equal(complementaryEligible(before,after,a,a),false);
 assert.equal(complementaryEligible(before,{...after,routes:[{capacity:1,effective:8,support:2}]},a,b),false);
});
test('acquisition fingerprints distinguish basic/active and air eligibility, not compass labels',()=>{
 const model={routes:[{n:1,fly:true,tiles:['1,1','1,2']}]};
 const u={cover:new Set(['1,1']),skillCover:new Set(['1,2']),basicAir:false,activeAir:true,descriptor:{}};
 assert.deepEqual([...acquisitionWindows(u,model)],['0:1:active']);
 assert.equal(windowDistance(new Set(['a']),new Set(['a'])),0);
 assert.equal(windowDistance(new Set(['a']),new Set(['b'])),1);
});
test('replacement retains parent and core, spends only one slot, and de-duplicates equivalent acquisition',()=>{
 const bank=Array.from({length:8},(_,i)=>{const p=new LayoutPlan([[1,`0,${i}`]]);p.dirs.set(1,'RIGHT');p.variant=i===0?{current:true}:{hold:i};return p;});
 const context={model:{routes:[{n:2,fly:false,hp:1000,tileTime:1,tiles:['1,1','1,2','1,3','1,4']}]},allPlans:bank,quota:1,policy:'test',
  makeUnits:p=>[{uid:1,kind:'chess',key:p.get(1),dir:p.dirs.get(1),dps:100,block:0,basicAir:true,activeAir:true,
   cover:new Set(p.dirs.get(1)==='RIGHT'?['1,1','1,2','1,3','1,4']:['1,1','1,2','1,3']),
   skillCover:new Set(p.dirs.get(1)==='RIGHT'?['1,1','1,2','1,3','1,4']:['1,1','1,2','1,3']),descriptor:{duty:.3}}]};
 // Force a near-saturated score so removing one acquisition tile is a bounded aggregate loss.
 context.model.routes[0].hp=10;
 const it=complementaryShortlistSteps(bank,context);let x;do{x=it.next();}while(!x.done);
 const a=x.value;assert.equal(a.selectedCount,1);assert.equal(a.plans.length,8);assert.ok(a.shortlist.length<=4);
 assert.equal(a.shortlist.length,1);const p=a.replaced[0].parent;assert.equal(a.plans[p],bank[p]);
 assert.equal(a.plans[0],bank[0]);
});
for(const policy of ['complementary-one-r89-v6','complementary-two-r89-v6'])test(`${policy}: core aliases retained, at most 8x3, and only R8/9`,()=>{
 const {m,ps,h}=openingFixture('act2autochess_m02',3205,['chess_char_1_06_b','chess_char_1_17_b','chess_char_1_02_b','chess_char_2_04_a']);
 try{
  m.round=8;m.botLayoutBudgetPolicy='diverse-v1';m.botFireCoveragePolicy=policy;m.botFireCoverageTrace=true;
  let start,done;m.botRehearsalAudit=e=>{if(e.phase==='start')start=e;else done=e;};arrange(m,ps,{final:true,defer:true}).run();
  const original=allocateLayoutBudget(start.plans,8,{policy:'diverse-v1',round:8,mire:true});
  for(const key of protectedFireSignatures(start.plans))if(original.some(p=>layoutSignature(p)===key))assert.ok(start.candidates.some(p=>layoutSignature(p)===key));
  assert.ok(done.candidates.length<=8);assert.ok(done.totals.every(t=>t.completed===3));
  assert.ok(start.fireCoverage.shortlist.length<=4);assert.ok(start.fireCoverage.selectedCount<=(policy.includes('one')?1:2));
  m.round=7;arrange(m,ps,{final:true,defer:true}).run();assert.equal(start.fireCoverage.reason,'outside-focus');
 }finally{m.dispose();h.sched.dispose();}
});
