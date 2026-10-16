import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateLayoutBudget, layoutSignature, LAYOUT_BUDGET_POLICIES } from '../../server/match/bot-layout-budget.js';

const plan = (n, variant) => Object.assign(new Map([[1, `10,${n}`], [2, `11,${n}`]]),
  { dirs: new Map([[1, 'RIGHT'], [2, 'RIGHT']]), variant });
const fixture = () => [plan(0, {current:true}), plan(1, {}),
  plan(2, {routeBlock:true,rangedBlock:true,groundRangedCount:2}),
  plan(3, {routeBlock:true,rangedBlock:true,groundRangedCount:2,avoidMire:true}),
  plan(4, {avoidMire:true}),plan(5,{avoidMire:true,rangedBlock:true,groundRangedCount:1}),
  plan(6,{rangedBlock:true,groundRangedCount:1}),plan(7,{rangedBlock:true,groundRangedCount:2}),
  plan(8,{forwardRanged:true}),plan(9,{hold:8}),plan(10,{kill:3}),
  plan(11,{secondHold:1,healHold:0.75}),plan(12,{routeFloor:0.5,cohesion:0}),
  plan(13,{routeFloor:0.5,cohesion:0,tankFirst:false}),plan(14,{tactical:true})];

test('no policy and protected early rounds preserve the exact original prefix', () => {
  const plans=fixture();
  assert.deepEqual(allocateLayoutBudget(plans,8),plans.slice(0,8));
  assert.deepEqual(allocateLayoutBudget(plans,8,{policy:'protected-late-v1',round:6,mire:true}),plans.slice(0,8));
  assert.deepEqual(allocateLayoutBudget(plans,8,{policy:'diverse-from8-v2',round:7,mire:true}),plans.slice(0,8));
  assert.deepEqual(allocateLayoutBudget(plans,8,{policy:'legacy-from7-v2',round:6,mire:true}),plans.slice(0,8));
});
for(const policy of LAYOUT_BUDGET_POLICIES) test(`${policy}: keeps legal unique plans, protected lane/healing coverage and fixed budget`,()=>{
  const plans=fixture(), snapshot=plans.map(p=>({tiles:[...p],dirs:[...p.dirs],variant:{...p.variant}}));
  const result=allocateLayoutBudget(plans,8,{policy,round:8,mire:true});
  assert.equal(result.length,8);assert.equal(new Set(result.map(layoutSignature)).size,8);
  for(const index of [0,1,11,12])assert.ok(result.includes(plans[index]));
  assert.ok(result.every(p=>plans.includes(p)));
  assert.deepEqual(plans.map(p=>({tiles:[...p],dirs:[...p.dirs],variant:{...p.variant}})),snapshot);
  assert.deepEqual(allocateLayoutBudget(plans,8,{policy,round:8,mire:true}),result);
});
test('aliases consume one slot while retaining a protected family; tiny and empty budgets terminate',()=>{
  const plans=fixture();const alias=plan(0,{secondHold:1,healHold:0.75});plans.splice(11,1,alias);
  const result=allocateLayoutBudget(plans,8,{policy:'balanced-v1',round:9,mire:true});
  assert.equal(result.length,8);assert.ok(result.includes(plans[0]));assert.ok(!result.includes(alias));
  assert.deepEqual(allocateLayoutBudget(plans,0,{policy:'diverse-v1',round:9}),[]);
  assert.equal(allocateLayoutBudget(plans,1,{policy:'diverse-v1',round:9}).length,1);
  assert.deepEqual(allocateLayoutBudget([],8,{policy:'diverse-v1',round:9}),[]);
});

test('a distinct fortress contact proposal survives diversity allocation without adding a slot',()=>{
  const plans=fixture(),contact=plan(15,{artilleryContact:true,routeBlock:true});
  const result=allocateLayoutBudget([...plans,contact],8,{policy:'diverse-v1',round:5});
  assert.equal(result.length,8);assert.ok(result.includes(contact));
  for(const index of [0,1,11,12])assert.ok(result.includes(plans[index]));
});
