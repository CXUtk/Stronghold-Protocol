import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { runSupportPolicy } from './support-policy.mjs';
import { saveSourceSnapshot } from './experiment-store.mjs';
import { hashTree } from '../botbench-support.mjs';
const out = process.argv[2];
const ref = JSON.parse(readFileSync('../logs/ai-hybrid-v6-heldout-seven.json')).results.find(r => r.seed === 1119 && r.band === 'band_ioleta' && r.policyId === 'hybrid-v7');
const manifest = { kind: 'diagnostic-replay', gitHead: 'cf7b0b55edb52c97a796101f026da9dbdf300412', newSimulationMatches: 1, sourceHash: hashTree(process.cwd(), ['server','shared','tools/botbench']), dataHash: hashTree(process.cwd(), ['data']) };
saveSourceSnapshot(process.cwd(), out + '.source.json', manifest);
const result = runSupportPolicy({ seed: ref.seed, band: ref.band, humans: 2, rounds: 11, stageId: ref.stageId, leakCount: ref.leakCount, sourceMode: ref.sourceMode, humanFixtures: ref.fixtureInputs, atlasPath: '../logs/ai-combat-atlas-20261014-v5-medics.json', observe: true, routeDiagnostics: true }, 'hybrid-v7');
if (JSON.stringify(result.rounds) !== JSON.stringify(ref.rounds)) throw new Error('Outcome drift');
writeFileSync(out + '.json', JSON.stringify({manifest, results:[result]}), {flag:'wx'});
writeFileSync(out + '.jsonl', JSON.stringify({manifest})+'\n'+JSON.stringify({result})+'\n', {flag:'wx'});
appendFileSync('../logs/ai-experiment-index.jsonl', JSON.stringify({...manifest,status:'complete',resultFile:out+'.json',sourceSnapshot:out+'.source.json',seeds:[1119],registeredAt:new Date().toISOString()})+'\n');
const formal = result.policyDiagnostics.observations.find(b => b.round === 11 && b.fieldId === 'n:p3').routes.spec;
const trials = result.policyDiagnostics.tacticalTrials.filter(b=>b.round===11 && b.pid==='p3');
const best = trials.reduce((a,b)=>a.players.p3.carryScore>b.players.p3.carryScore?a:b);
function diff(a,b,p=''){if(JSON.stringify(a)===JSON.stringify(b))return []; if(a&&b&&typeof a==='object'&&typeof b==='object')return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],p+'.'+k)); return [{path:p,preview:a,formal:b}];}
console.log(JSON.stringify({preview:best.players.p3.leaks,formal:result.rounds.find(r=>r.round===11).players.find(p=>p.pid==='p3').rawLeaks,diff:diff(best.spec,formal)},null,2));
