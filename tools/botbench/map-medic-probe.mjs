import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeBattle, chessRec } from '../../test/helpers/battleHarness.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: map-medic-probe.mjs INPUT_ATLAS OUTPUT_ATLAS');
const raw = readFileSync(input), atlas = JSON.parse(raw), rows = [];
for (const id of ['char_605_cmedic', 'char_613_acmedc']) for (const seed of [17, 29]) {
  const patient = chessRec({ id: 'botbench_patient', attackKind: 'none', skill: null, stats: { maxHp: 100000, atk: 0, blockCnt: 0 } });
  const h = makeBattle({ seed, autoFinish: false, timeLimit: 61, recordEvents: false, hooks: [], flags: { startOpCooldown: 3 },
    defs: { chess: { botbench_patient: patient } },
    units: [{ kind: 'token', tokenId: id, uid: 1, row: 9, col: 5, dir: 'RIGHT' },
      ...[[9, 6], [10, 5], [10, 6]].map(([row, col], i) => ({ chessId: 'botbench_patient', uid: 100 + i, row, col }))],
  });
  while (h.b.time < 60) {
    for (const u of h.allies()) if (u.defId === 'botbench_patient') u.hp = u.s.maxHp * 0.4;
    h.b.step();
  }
  if (h.b.errors.length) throw new Error(JSON.stringify(h.b.errors));
  rows.push({ id, seed, seconds: 60, hps: h.unit(1).stats.heal / 60 });
}
atlas.mapMedics = Object.fromEntries(['char_605_cmedic', 'char_613_acmedc'].map((id) => [id, rows.filter((r) => r.id === id).reduce((n, r) => n + r.hps, 0) / 2]));
atlas.mapMedicProbes = rows;
atlas.manifest.mapMedicExtension = { createdAt: new Date().toISOString(), parentHash: createHash('sha256').update(raw).digest('hex'), note: 'Real map-token kits, same saturated healing probes; does not establish real map coverage.' };
writeFileSync(output, JSON.stringify(atlas), { flag: 'wx' });
console.log(JSON.stringify({ mapMedics: atlas.mapMedics, rows }));
