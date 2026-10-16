import test from 'node:test';import assert from 'node:assert/strict';
import {pressureLayoutFeatures} from '../../server/match/bot-fire-pressure.js';
import {arrange,pressureFireCoverageContext} from '../../server/match/bot.js';
import {openingFixture} from '../../tools/botbench/diagnose-ranged-block.mjs';
const unit=(extra={})=>({uid:1,key:'9,5',kind:'chess',dps:100,block:0,heal:false,basicAir:true,activeAir:true,
 cover:new Set(['9,7','9,6']),skillCover:new Set(['9,7','9,6']),descriptor:{duty:.3,normalEnabled:true,activeEnabled:true,scale:1},...extra});
const route={n:20,hp:1000,fly:false,tileTime:2,tiles:['9,7','9,6','9,5','9,4'],threat:{atk:500,bat:2}};
test('finite targeting budget does not grant an independent full firing window to every crowded lane',()=>{
 const u=unit(),single=pressureLayoutFeatures([u],{routes:[route],horizon:10});
 const two=pressureLayoutFeatures([u],{routes:[route,route],horizon:10});
 assert.ok(Math.abs(two.routes.reduce((n,r)=>n+r.basic,0)-single.routes[0].basic)<1e-9);
});
test('mire reduces ranged fire contribution and a fortress cannot bypass blind range by blocking',()=>{
 const u=unit();assert.ok(pressureLayoutFeatures([{...u,mire:true}],{routes:[route]}).score<pressureLayoutFeatures([u],{routes:[route]}).score);
 const tank=unit({key:'9,6',block:3,cover:new Set(),skillCover:new Set(),pressureStats:{maxHp:5000,def:500}});
 assert.ok(pressureLayoutFeatures([tank],{routes:[route]}).routes[0].contact>0);
 assert.equal(pressureLayoutFeatures([{...tank,rangedBlind:true}],{routes:[route]}).routes[0].contact,0);
});
test('thorns contribute only while their member actually blocks a ground enemy',()=>{
 const tank=unit({key:'9,6',block:3,thorns:1000,pressureStats:{maxHp:5000,def:500}});
 const x=pressureLayoutFeatures([tank],{routes:[route]}),y=pressureLayoutFeatures([{...tank,thorns:0}],{routes:[route]});
 assert.ok(x.routes[0].effective>y.routes[0].effective);
 const off=pressureLayoutFeatures([{...tank,key:'10,6'}],{routes:[route]});
 const offNo=pressureLayoutFeatures([{...tank,key:'10,6',thorns:0}],{routes:[route]});assert.deepEqual(off,offNo);
});
for(const policy of ['pressure-retain-r89-v4','pressure-shortlist-r89-v4'])test(`${policy} uses legal public inputs, leaves live state intact and respects 8 by 3`,()=>{
 const {m,ps,pieces}=openingFixture('act2autochess_m02',2805,['chess_char_1_06_b','chess_char_1_17_b','chess_char_1_02_b','chess_char_2_04_a']);
 try{m.round=8;m.botLayoutBudgetPolicy='diverse-v1';m.botFireCoveragePolicy=policy;m.botFireCoverageTrace=true;
  const before=JSON.stringify({layers:ps.layers,board:[...ps.board]}),c=pressureFireCoverageContext(m,ps,pieces);
  assert.ok(c.model.horizon>0);assert.equal(JSON.stringify({layers:ps.layers,board:[...ps.board]}),before);
  let start,done;m.botRehearsalAudit=e=>{if(e.phase==='start')start=e;else done=e;};arrange(m,ps,{final:true,defer:true}).run();
  assert.ok(start.fireCoverage.shortlist.length<=4);assert.ok(start.fireCoverage.selectedCount<=2);
  assert.ok(done.candidates.length<=8);assert.ok(done.totals.every(t=>t.completed===3));
 }finally{m.dispose();}
});
