import test from 'node:test';import assert from 'node:assert/strict';
import{preserveEffectWindows}from'../../server/match/bot-effect-windows.js';
import{openingFixture}from'../../tools/botbench/diagnose-ranged-block.mjs';
import{arrange}from'../../server/match/bot.js';
const model={routes:[{n:8,fly:false,tiles:['9,8','9,7','9,6','9,5','9,4','9,3']}],ground:new Map(['9,8','9,7','9,6','9,5','9,4','9,3'].map(k=>[k,{}]))};
const unit=(uid,key,cover,extra={})=>({uid,key,block:0,heal:false,basicAir:true,activeAir:true,cover:new Set(cover),skillCover:new Set(cover),descriptor:{hasOpaqueCallbacks:true},...extra});
test('a drone/control operator does not trade its late interception window for more upstream damage',()=>{
 const a=unit(1,'10,5',['9,5','9,4','9,3']),b=unit(1,'10,5',['9,8','9,7','9,6']);
 assert.equal(preserveEffectWindows([a],[b],model,{uid:1}).accepted,false);
 // A normal dealer without conditional effects is still scored by the ordinary proposal evaluator.
 assert.equal(preserveEffectWindows([{...a,descriptor:{}}],[{...b,descriptor:{}}],model,{uid:1}).accepted,true);
});
test('incantation support to an existing blocker survives even if enemy damage coverage is preserved',()=>{
 const tank=unit(2,'9,5',[],{block:3,descriptor:{}}),a=unit(1,'10,5',['9,8','9,7','9,5'],{descriptor:{healRatio:.6}});
 const b={...a,cover:new Set(['9,8','9,7']),skillCover:new Set(['9,8','9,7'])};
 assert.equal(preserveEffectWindows([tank,a],[tank,b],model,{uid:1}).accepted,false);
});
test('adding a useful side window without losing contact or late coverage is accepted',()=>{
 const a=unit(1,'10,5',['9,5','9,4','9,3']),b=unit(1,'10,5',['9,7','9,5','9,4','9,3']);
 assert.equal(preserveEffectWindows([a],[b],model).accepted,true);
});
for(const policy of ['effect-windows-r89-v5','effect-edit-guard-r89-v5'])test(`${policy} preserves eight by three and records rejection evidence`,()=>{
 const{m,ps}=openingFixture('act2autochess_m02',3005,['chess_char_1_06_b','chess_char_1_17_b','chess_char_1_02_b','chess_char_2_10_b']);
 try{m.round=8;m.botLayoutBudgetPolicy='diverse-v1';m.botFireCoveragePolicy=policy;m.botFireCoverageTrace=true;
  let start,done;m.botRehearsalAudit=e=>{if(e.phase==='start')start=e;else done=e;};arrange(m,ps,{final:true,defer:true}).run();
  assert.ok(start.fireCoverage.shortlist.length<=4);assert.ok(start.fireCoverage.selectedCount<=2);
  assert.ok(start.fireCoverage.scores.some(s=>s.gate?.accepted===false));assert.ok(done.candidates.length<=8);assert.ok(done.totals.every(t=>t.completed===3));
  m.round=7;arrange(m,ps,{final:true,defer:true}).run();assert.equal(start.fireCoverage.reason,'outside-focus');
 }finally{m.dispose();}
});
