// Dev-only page: the standard game UI connected to the local, real Match prep harness.
import '/js/ui/compat.js';
import { render } from '/vendor/preact.module.js';
import { html, UiHosts } from '/js/ui/components.js';
import { installDeviceSupport } from '/js/ui/device.js';
import { ToastHost } from '/js/ui/toasts.js';
import { GuideHost } from '/js/ui/guide.js';
import { GameScreen } from '/js/screens/game.js';
import { store, emptyMatch } from '/js/store.js';
import { net, NetError } from '/js/net.js';
import { data } from '/js/data.js';
import { GAME_FILES } from '/js/ui/gameComponents.js';

const el = id => document.getElementById(`ep-${id}`);
let busy = false;
function show(next) {
  store.set({ clock: { offset: next.public.serverNow - Date.now(), rtt: 0, synced: true },
    match: { ...emptyMatch(), public: next.public, private: next.private, field: next.field } });
  for (const msg of next.messages) net._emit(msg.t, msg);
  const counts = next.counts;
  el('counts').replaceChildren(...[
    ['整备区', `${counts.hand}/10`], ['临时区', `${counts.temp}/5`], ['隐藏缓存', counts.hidden],
    ['赠品持有量', counts.equipment], ['全队球占用', counts.ballsHeld], ['剩余球库存', counts.ballsLeft],
  ].map(([label, value]) => {
    const row = document.createElement('span');
    row.append(`${label}：`);
    const b = document.createElement('b'); b.textContent = value; row.append(b);
    return row;
  }));
  const overflow = next.opts.scenario === 'overflow';
  el('gain').textContent = overflow ? '触发获得时效果' : '买入干员';
  el('hint').textContent = overflow ? '整备区和五个临时位均已满。触发后查看隐藏缓存，再销毁临时装备，看缓存补入。' :
    '整备区已有九张卡。买入后刚好满，装备会进入临时区；部署干员后会自动补入空位。';
  el('gain').disabled = next.triggered || busy;
  el('free').disabled = !next.private.temp.some(p => p?.kind === 'item') || busy;
  el('log').textContent = next.violations.length ? `状态检查失败：${next.violations.join('\n')}` :
    next.log.map(x => `${x.action}：${x.ok ? '成功' : x.error}`).join('\n') || '场景已就绪';
}
async function request(t, fields = {}) {
  busy = true;
  try {
    const response = await fetch('/preview/equipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t, ...fields }) });
    const reply = await response.json();
    if (!response.ok || !reply.state) throw new Error(reply.error || '测试服务没有响应');
    busy = false; show(reply.state);
    if (reply.result.error) throw new NetError(reply.result.error, null, reply.result.detail);
    return reply.result;
  } finally { busy = false; }
}
async function reset() {
  return request('preview.reset', { scenario: el('scenario').value, operator: el('operator').value,
    multiplier: Number(el('multiplier').value), stock: Number(el('stock').value) });
}
const click = (id, fn) => el(id).addEventListener('click', () => fn().catch(err => { el('log').textContent = err.message; }));
async function boot() {
  net.request = request;
  await data.loadAll(GAME_FILES);
  installDeviceSupport();
  store.set({ session: { entered: true }, me: { playerId: 'p_0', name: '装备测试', token: null },
    connection: { status: 'online', ping: 0, attempt: 0, retryAt: 0, lastError: null, everOnline: true },
    room: { code: 'TEST', hostId: 'p_0', mode: 'coop', difficulty: 'NORMAL', inMatch: true,
      seats: Array.from({ length: 4 }, (_, seat) => ({ seat, playerId: `p_${seat}`, name: seat ? `队友 ${seat}` : '装备测试', isBot: false, ready: false, connected: true })) } });
  await reset();
  render(html`<div class="app-root"><div class="app-bg" aria-hidden="true"></div><${GameScreen} /><${ToastHost} /><${UiHosts} /><${GuideHost} /></div>`, document.getElementById('app'));
  click('reset', reset);
  click('gain', () => request('preview.gain'));
  click('free', () => request('preview.freeTemp'));
  click('deploy', () => request('preview.deploy'));
  for (const id of ['scenario', 'operator', 'multiplier', 'stock']) el(id).addEventListener('change', () => reset().catch(err => { el('log').textContent = err.message; }));
}
boot().catch(err => { el('log').textContent = `加载失败：${err.message}`; });
