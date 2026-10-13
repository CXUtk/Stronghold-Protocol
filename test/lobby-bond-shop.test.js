import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';

const toggle = (on) => ({ t: 'room.setActiveBondShopBoost', on });
const ok = async (c, msg) => assert.equal((await c.request(msg)).t, 'ok');
const err = async (c, msg, code) => assert.equal((await c.request(msg)).code, code);

test('shop option protocol accepts only boolean on', () => {
  for (const on of [true, false]) assert.equal(validateC2S(toggle(on)), null);
  for (const on of [undefined, null, 1, 'true', {}, []]) assert.notEqual(validateC2S(toggle(on)), null);
});

for (const mode of ['solo', 'coop']) test(`${mode}: host switch, ready reset, match lock and next-match state`, async (t) => {
  const started = [];
  class RecordingMatch extends StubMatch {
    constructor(opts) { super(opts); started.push(opts); }
  }
  const errors = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', MatchClass: RecordingMatch,
    log: { info() {}, warn() {}, debug() {}, error: (...args) => errors.push(args) } });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map((c) => c.terminate())); await srv.close(); assert.deepEqual(errors, []); });
  const player = async (name) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c); c.id = (await c.hello(name)).playerId; return c;
  };
  const host = await player('Host');
  await err(host, toggle(true), ERR.NOT_IN_ROOM);
  await ok(host, { t: 'room.create', mode, difficulty: 'NORMAL' });
  const room = await host.waitFor('room.state', (s) => s.hostId === host.id);
  assert.equal(room.activeBondShopBoost, false);
  let guest;
  if (mode === 'coop') {
    guest = await player('Guest');
    await ok(guest, { t: 'room.join', code: room.code });
    await guest.waitFor('room.state', (s) => s.seats.some((p) => p?.playerId === guest.id));
    await err(guest, toggle(true), ERR.NOT_HOST);
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => s.seats.some((p) => p?.playerId === guest.id && p.ready));
  }
  await ok(host, toggle(true));
  const on = await (guest || host).waitFor('room.state', (s) => s.activeBondShopBoost === true);
  if (guest) assert.equal(on.seats.find((p) => p?.playerId === guest.id).ready, false);
  await err(host, toggle('yes'), ERR.BAD_MSG);
  if (guest) { await ok(guest, { t: 'room.ready', ready: true }); await host.waitFor('room.state', (s) => s.seats.some((p) => p?.playerId === guest.id && p.ready)); }
  await ok(host, { t: 'room.start' });
  await host.waitFor('room.state', (s) => s.inMatch);
  assert.equal(started[0].activeBondShopBoost, true);
  await err(host, toggle(false), ERR.ROOM_STARTED);
  host.clearInbox(); guest?.clearInbox();
  await ok(host, { t: 'g.infoReady' });
  if (guest) await ok(guest, { t: 'g.infoReady' });
  const back = await host.waitFor('room.state', (s) => !s.inMatch);
  assert.equal(back.activeBondShopBoost, true);
  await ok(host, toggle(false));
  await host.waitFor('room.state', (s) => !s.activeBondShopBoost);
  if (guest) { await ok(guest, { t: 'room.ready', ready: true }); await host.waitFor('room.state', (s) => s.seats.some((p) => p?.playerId === guest.id && p.ready)); }
  await ok(host, { t: 'room.start' });
  assert.equal(started[1].activeBondShopBoost, false);
});
