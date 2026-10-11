// Local-only interactive prep harness. Uses the real Match intents and gain-trait dispatcher; no combat is run.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA, makeMatch, give, giveItem, legalTileFor } from '../test/match/harness.js';
import { createRegistry } from '../server/match/effectsMeta.js';
import { collectViolations } from '../server/match/invariants.js';
import { createStaticHandler } from '../server/http/static.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const BALL = 'chess_item_6_09_e_a';
const OPERATORS = new Set(['chess_char_6_11_a', 'chess_char_6_11_b', 'chess_char_2_10_a',
  'chess_char_2_10_b', 'chess_char_3_03_a', 'chess_char_3_03_b']);
const fillers = Object.values(DATA.chess).filter(c => c.visible && !c.isGolden &&
  (c.garrisonIds || []).every(g => DATA.garrisons[g].eventType === 'IN_BATTLE')).map(c => c.chessId);
const fillerItems = Object.values(DATA.items).filter(i => i.itemType === 'EQUIP' && !i.isGolden &&
  i.kind === 'passive' && !DATA.choices.pools.pool_equip_rockr.items.includes(i.id)).map(i => i.id).slice(0, 5);
let current = null;

function reset(opts = {}) {
  current?.h.m.dispose();
  const scenario = opts.scenario === 'overflow' ? 'overflow' : 'purchase';
  const operator = OPERATORS.has(opts.operator) ? opts.operator : 'chess_char_6_11_a';
  const multiplier = opts.multiplier === 3 ? 3 : 2;
  const stock = [0, 2, 3].includes(opts.stock) ? opts.stock : 0;
  const h = makeMatch({ mode: 'coop', humans: 4, seed: 41, registry: createRegistry({ log: quiet }) }).start().toPrep(1);
  const m = h.m, ps = h.ps('p_0');
  for (const p of m.players.values()) {
    for (const c of p.allChess()) p.returnCopies(c);
    p.board.clear(); p.hand.fill(null); p.temp.fill(null); p.bandId = null; p.offers = [];
    p.recompute();
  }
  ps.name = '装备测试';
  ps.bondCountBonus.investShip = 20;
  ps.layers.investShip = multiplier === 3 ? 100 : 0;
  ps.funds = 99;
  ps.shop.level = 6;
  ps.shop.slots.fill(null);
  ps.shop.slots[0] = { kind: 'chess', id: operator, basePrice: 1, sold: false, frozen: true };
  for (let i = 0; i < (scenario === 'purchase' ? 9 : 10); i++) give(m, ps, fillers[i]);
  if (scenario === 'overflow') for (let i = 0; i < 5; i++) giveItem(m, ps, fillerItems[i], 'temp', i);
  const others = [...m.players.values()].filter(p => p !== ps);
  for (let i = 0; i < stock; i++) giveItem(m, others[i], BALL);
  const source = scenario === 'overflow' ? give(m, ps, operator, 'board', legalTileFor(m, ps, operator)) : null;
  ps.recompute();
  const before = new Set([...ps.hand, ...ps.temp].filter(Boolean).map(p => p.uid));
  current = { h, ps, opts: { scenario, operator, multiplier, stock }, source, before, triggered: false, log: [] };
  return snapshot();
}

function snapshot() {
  const { h, ps, opts, before, triggered, log } = current;
  const pub = h.m.publicView();
  pub.deadline = null; // this local harness stays in prep until reset; the virtual clock is not driven
  const all = [...ps.hand, ...ps.temp, ...ps.itemOverflow, ...ps.allChess().flatMap(p => p.items || [])];
  const gained = all.filter(p => p?.kind === 'item' && !before.has(p.uid));
  const messages = h.sent.filter(([pid, msg]) => pid === ps.playerId && ['m.toast', 'm.unitStats'].includes(msg.t));
  h.sent.length = 0;
  return { public: pub, private: ps.privateView(), field: h.m.prepFieldMeta(ps), messages, opts, triggered,
    counts: { hand: ps.hand.filter(Boolean).length, temp: ps.temp.filter(Boolean).length, hidden: ps.itemOverflow.length,
      equipment: gained.reduce((n, p) => n + (DATA.items[p.id].isGolden ? 2 : 1), 0),
      ballsHeld: h.m.itemPool.held(BALL), ballsLeft: h.m.itemPool.left(BALL) },
    violations: collectViolations(h.m), log: log.slice(-5) };
}

function action(msg) {
  const { h, ps, opts, source } = current;
  let result;
  if (msg.t === 'preview.gain') {
    if (current.triggered) result = { error: 'ALREADY_TRIGGERED' };
    else if (opts.scenario === 'purchase') result = h.m.handle(ps.playerId, { t: 'g.buy', slot: 0 });
    else { h.m.dispatch(ps, 'onGain', { piece: source, kind: 'chess', source: 'preview' }); result = { ok: true }; }
    if (result.ok) current.triggered = true;
  } else if (msg.t === 'preview.freeTemp') {
    const p = ps.temp.find(x => x?.kind === 'item');
    result = p ? h.m.handle(ps.playerId, { t: 'g.destroy', uid: p.uid }) : { error: 'NO_ITEM' };
  } else if (msg.t === 'preview.deploy') {
    const p = ps.hand.find(x => x?.kind === 'chess');
    const tile = p ? legalTileFor(h.m, ps, p.id) : null;
    result = tile ? h.m.handle(ps.playerId, { t: 'g.move', uid: p.uid, to: { area: 'board', row: tile[0], col: tile[1] }, dir: 'RIGHT' }) : { error: 'NO_TILE' };
  } else if (typeof msg.t === 'string' && msg.t.startsWith('g.') && msg.t !== 'g.leave') {
    result = h.m.handle(ps.playerId, msg);
    if (msg.t === 'g.buy' && msg.slot === 0 && result.ok) current.triggered = true;
  } else result = { error: 'BAD_REQUEST' };
  current.log.push({ action: msg.t, ...result });
  return { result, state: snapshot() };
}

const staticHandler = createStaticHandler({ publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'),
  sharedDir: path.join(root, 'shared'), log: quiet });
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = value => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/preview/equipment' && req.method === 'GET') { json(current ? snapshot() : reset()); return; }
    if (url.pathname === '/preview/equipment' && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { res.writeHead(403); res.end(); return; }
      let body = '';
      for await (const part of req) { body += part; if (body.length > 16384) { res.writeHead(413); res.end(); return; } }
      const msg = JSON.parse(body);
      if (msg.t === 'preview.reset') json({ result: { ok: true }, state: reset(msg) });
      else { if (!current) reset(); json(action(msg)); }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    await staticHandler(req, res, url.pathname === '/' ? '/dev/equipment-overflow.html' : url.pathname, url.search.slice(1));
  } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
});
const port = Number(process.env.PREVIEW_PORT || 3005);
server.listen(port, '127.0.0.1', () => console.log(`Equipment preview: http://127.0.0.1:${port}/dev/equipment-overflow.html`));
