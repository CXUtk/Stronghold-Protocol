import test from 'node:test';
import assert from 'node:assert/strict';
import {contactExposure,retainFireProposal,fireCoverageSteps} from '../../server/match/bot-fire-coverage.js';
import {LayoutPlan,arrange} from '../../server/match/bot.js';
import {openingFixture} from '../../tools/botbench/diagnose-ranged-block.mjs';
import {layoutSignature} from '../../server/match/bot-layout-budget.js';

const model={ground:new Map(['9,8','9,7','9,6','9,5','9,4'].map(k=>[k,{}])),routes:[{fly:false,n:10,hp:1000,tileTime:1,tiles:['9,8','9,7','9,6','9,5','9,4']}]};
const tank={uid:1,key:'9,6',block:2,cover:new Set(['9,6']),dps:100,ground:true,air:false};
const dealer={uid:2,key:'10,5',block:0,cover:new Set(['9,4','9,5']),dps:500,ground:true,air:true};
const plan=(variant={},facing='LEFT')=>{const p=new LayoutPlan([[1,'9,6'],[2,'10,5']]);p.dirs.set(1,'RIGHT');p.dirs.set(2,facing);p.variant=variant;return p;};
test('incoming contact outweighs downstream tiles, without extending real range',()=>{
  const behind=contactExposure([tank,dealer],model);
  const front=contactExposure([tank,{...dealer,cover:new Set(['9,7','9,8'])}],model);
  assert.ok(front.score>behind.score);assert.ok(front.contributions.get(2)>behind.contributions.get(2));
  assert.deepEqual([...dealer.cover],['9,4','9,5']);
});
test('own blocked enemies remain hittable for a self-only blocker',()=>{
  const result=contactExposure([tank],model);assert.ok(result.contributions.get(1)>0);
});
test('air routes ignore ground block hold and ground-only damage',()=>{
  const air={routes:[{...model.routes[0],fly:true}]};
  const a=contactExposure([tank,{...dealer,air:false}],air);assert.equal(a.score,0);
  assert.equal(a.routes[0].first,-1);assert.equal(a.routes[0].capacity,0);
});
test('retention keeps parent, current, default, route floor and healing, with no extra slots',()=>{
  const bank=[plan({current:true}),plan({}),plan({routeFloor:.5}),plan({secondHold:1,healHold:.75}),plan({kill:3}),plan({hold:8})];
  const p=plan({fireCoverage:true},'UP'),r=retainFireProposal(bank,{plan:p,parent:4,gain:.1});
  assert.equal(r.plans.length,bank.length);for(let i=0;i<5;i++)assert.ok(r.plans.includes(bank[i]));
  assert.ok(r.plans.includes(p));assert.equal(bank[5].variant.hold,8);
});
test('no unprotected slot and duplicate proposal leave the bank untouched',()=>{
  const bank=[plan({current:true}),plan({})];
  assert.equal(retainFireProposal(bank,{plan:plan({fireCoverage:true},'UP'),parent:0,gain:1}).plans,bank);
  assert.equal(retainFireProposal(bank,{plan:plan({fireCoverage:true}),parent:0,gain:1}).reason,'duplicate');
});
test('safe retention rejects a geometrically distinct victim and stronger route coverage',()=>{
  const bank=[plan({current:true}),plan({kill:3}),plan({hold:8})];
  bank[2].set(1,'9,8');bank[2].set(2,'11,8');
  const proposal={plan:plan({fireCoverage:true},'UP'),parent:1,gain:.1};
  assert.equal(retainFireProposal(bank,proposal,{safe:true}).reason,'all-protected');
  bank[2]=plan({hold:8},'DOWN');
  const features=[1,1,2].map(value=>({routes:[{value,capacity:2}]}));
  assert.equal(retainFireProposal(bank,proposal,{safe:true,features}).reason,'all-protected');
  features[2].routes[0].value=1;
  assert.equal(retainFireProposal(bank,proposal,{safe:true,features}).reason,'replaced');
});
test('turn proposals read the contact, preserve the board and do not require RIGHT',()=>{
  const bank=[plan({current:true}),plan({},'UP'),plan({kill:3},'UP'),plan({hold:8})];
  const signatures=bank.map(layoutSignature);
  const job=fireCoverageSteps(bank,{policy:'contact-turn-v1',model,
    makeUnits:p=>[tank,{...dealer,dir:p.dirs.get(2),kind:'chess',cover:new Set(p.dirs.get(2)==='DOWN'?['9,7','9,8']:['9,4','9,5'])}],
    legalPositions:()=>[],mire:()=>false});
  let x=job.next();while(!x.done)x=job.next();
  assert.equal(x.value.reason,'replaced');assert.equal(x.value.edit.toDir,'DOWN');
  assert.deepEqual(bank.map(layoutSignature),signatures);
});
test('legal position search rejects wet tiles and retains healer coverage',()=>{
  const bank=[plan({current:true}),plan({kill:3}),plan({hold:8}),plan({})];
  const healer={uid:3,key:'10,3',heal:true,block:0,ground:false,dps:0,cover:new Set(['10,5','10,6'])};
  const job=fireCoverageSteps(bank,{policy:'contact-position-v1',model,
    makeUnits:p=>[tank,healer,{...dealer,key:p.get(2),dir:p.dirs.get(2),kind:'chess',
      cover:new Set(p.get(2)==='10,6'||p.get(2)==='11,5'?['9,7','9,8']:['9,4','9,5'])}],
    legalPositions:()=>['10,6','11,5'],mire:k=>k==='10,6'});
  let x=job.next();while(!x.done)x=job.next();assert.equal(x.value.reason,'no-proposal');
});
test('opt-in contact search never increases actual rehearsal budget or sample count',()=>{
  const {m,ps}=openingFixture('act2autochess_m02',2410,['chess_char_1_06_b','chess_char_1_17_b','chess_char_1_02_b']);
  try{
    m.botLayoutBudgetPolicy='diverse-v1';m.botFireCoveragePolicy='contact-position-v1';
    let start,done;m.botRehearsalAudit=e=>{if(e.phase==='start')start=e;else done=e;};
    const job=arrange(m,ps,{final:true,defer:true});job.run();
    assert.ok(start.fireCoverage);assert.ok(job.plans.length<=8);
    assert.ok(done.totals.every(t=>t.completed===3));
    assert.ok(done.totals.reduce((n,t)=>n+t.completed,0)<=24);
    for(const p of job.plans)assert.equal(new Set(p.values()).size,p.size);
  }finally{m.dispose();}
});
