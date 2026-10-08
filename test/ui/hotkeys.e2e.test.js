// 0.2.0 rebindable shortcuts (设置 → 快捷键) in the mock match, headless Chrome, the DOM field (no art / WebGL needed):
// 撤退 rebound from Q to W with the keyboard only — Enter on the key waits, Esc ends the wait (the dialog stays), a refused
// key keeps it — a swap and 恢复默认 with their messages, Q then does nothing and W retreats, the underframe shows W, the
// choice survives a reload; at phone width (640×360, touch) the section fits and says the keys need a keyboard.
// Unit side: test/ui/feedback5-hotkeys.test.js.
// SP_E2E=1 CHROME_PATH=/path/to/chrome node --test test/ui/hotkeys.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../e2e/out/', import.meta.url));
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('rebindable shortcuts (设置 → 快捷键)', { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mockState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__MOCK__.S().priv)));
  const keyOf = (page, action) => page.$eval(`.set-key[data-action="${action}"]`, (el) => el.textContent.trim());
  const keyIs = (page, action, label) => page.waitForFunction((a, l) => document.querySelector(`.set-key[data-action="${a}"]`)?.textContent.trim() === l, {}, action, label);
  const note = (page) => page.$eval('.set-keys__note', (el) => el.textContent.trim());

  async function open(page, { width = 1280, height = 720, touch = false } = {}) {
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    await page.setViewport({ width, height, isMobile: touch, hasTouch: touch });
    await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ff-piece');
    return problems;
  }

  test('撤退 rebound to W in a mock match: keyboard only, swap, Esc, refusal, the HUD hint, a reload', async () => {
    const page = await browser.newPage();
    try {
      const problems = await open(page);
      await page.click('.gm__gear');
      await page.waitForSelector('.modal .set-keys');
      assert.deepEqual(await page.$$eval('.set-key[data-action]', (els) => els.map((el) => el.textContent.trim())), ['R', 'F', 'D', 'Q', 'X', 'B', 'Space'],
        'the defaults are the keys of 0.1.4');

      // a swap: 撤退 onto X (出售's key) — 出售 takes the old Q, and the line under the list says so
      await page.click('.set-key[data-action="retreat"]');
      await page.waitForSelector('.set-key.is-waiting[data-action="retreat"]');
      assert.match(await note(page), /请按下「撤退选中干员」的新按键（Esc 取消）/);
      await page.keyboard.press('KeyX');
      await keyIs(page, 'retreat', 'X');
      assert.equal(await keyOf(page, 'sell'), 'Q');
      assert.match(await note(page), /「撤退选中干员」已改为 X；「出售选中干员」原来用 X，已换成 Q/);
      await page.click('.set-keys__reset');
      await keyIs(page, 'retreat', 'Q');
      assert.equal(await keyOf(page, 'sell'), 'X');
      assert.match(await note(page), /已恢复默认快捷键/);
      assert.equal(await page.$eval('.set-keys__reset', (el) => el.disabled), true, '恢复默认 is off at the defaults');

      // keyboard only: Enter on the focused key waits; Esc ends the wait and the dialog stays open
      await page.focus('.set-key[data-action="retreat"]');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.set-key.is-waiting[data-action="retreat"]');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.set-key.is-waiting', { hidden: true });
      assert.ok(await page.$('.modal .set-keys'), 'Esc ends the wait, not the dialog');
      assert.match(await note(page), /已取消，「撤退选中干员」仍是 Q/);
      // the focus stayed on the key: Enter waits again; Enter itself is refused and the wait goes on; W is taken
      await page.keyboard.press('Enter');
      await page.waitForSelector('.set-key.is-waiting[data-action="retreat"]');
      await page.keyboard.press('Enter');
      await sleep(100);
      assert.match(await note(page), /Enter 不能设为快捷键/);
      assert.ok(await page.$('.set-key.is-waiting[data-action="retreat"]'), 'a refused key keeps the wait');
      await page.keyboard.press('KeyW');
      await keyIs(page, 'retreat', 'W');
      assert.match(await note(page), /「撤退选中干员」已改为 W/);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).keys.retreat), 'KeyW', 'saved with the settings');
      await page.keyboard.press('Escape'); // no wait: Esc closes the dialog as before
      await page.waitForSelector('.modal', { hidden: true });

      // the match: the underframe shows W, Q no longer retreats, W does
      const initial = await mockState(page);
      const unit = initial.board.find((p) => p.kind === 'chess' && !p.golden);
      await page.click(`.ff-piece[data-uid="${unit.uid}"]`);
      await page.waitForSelector('.uframe__btn--retreat');
      assert.match(await page.$eval('.uframe__btn--retreat', (el) => el.textContent), /\[W\]/);
      assert.equal(await page.$eval('.uframe__btn--retreat', (el) => el.getAttribute('aria-keyshortcuts')), 'W');
      await page.keyboard.press('KeyQ');
      await sleep(300);
      assert.deepEqual(await mockState(page), initial, 'Q no longer retreats');
      await page.keyboard.press('KeyW');
      await page.waitForFunction((uid) => globalThis.__MOCK__.S().priv.hand.some((p) => p?.uid === uid), {}, unit.uid);
      assert.equal((await mockState(page)).funds, initial.funds, 'W retreats (it does not sell)');

      // the choice survives a reload; 恢复默认 brings Q back
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.ff-piece');
      await page.click('.gm__gear');
      await page.waitForSelector('.modal .set-keys');
      assert.equal(await keyOf(page, 'retreat'), 'W');
      await page.click('.set-keys__reset');
      await keyIs(page, 'retreat', 'Q');
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });

  test('phone width (640×360, touch): the keys need a keyboard, the folded list opens and fits, no horizontal scroll', async () => {
    const page = await browser.newPage();
    try {
      const problems = await open(page, { width: 640, height: 360, touch: true });
      await page.tap('.gm__gear');
      await page.waitForSelector('.modal .set-keys');
      assert.match(await page.$eval('.set-keys .set-hint', (el) => el.textContent), /快捷键需要实体键盘/);
      assert.equal(await page.$eval('.set-keys__more', (el) => el.open), false, 'the list is folded on a touch-only device');
      // (tap once the dialog's entrance animation is over: a tap during it lands where the summary is about to be)
      await page.waitForFunction(() => !document.querySelector('.modal__box')?.getAnimations().some((a) => a.playState === 'running'));
      await page.tap('.set-keys__more > summary');
      await page.waitForFunction(() => document.querySelector('.set-keys__more')?.open === true);
      const box = await page.$eval('.modal__body', (body) => {
        const b = body.getBoundingClientRect();
        const rows = [...body.querySelectorAll('.set-keys__row')].map((r) => r.getBoundingClientRect());
        return { scroll: body.scrollWidth, client: body.clientWidth, left: b.left, right: b.right, rows: rows.map((r) => [r.left, r.right, r.width]) };
      });
      assert.ok(box.scroll <= box.client, `no horizontal scroll in the dialog (${box.scroll} > ${box.client})`);
      assert.equal(box.rows.length, 8, 'seven shortcuts and the fixed Esc');
      for (const [l, r, w] of box.rows) assert.ok(l >= box.left - 0.5 && r <= box.right + 0.5 && w > 0, `a row inside the dialog: ${l}–${r}`);
      assert.equal(new Set(box.rows.map(([l]) => Math.round(l))).size, 1, 'one column at phone width');
      await page.$eval('.set-keys__more', (el) => el.scrollIntoView({ block: 'start' }));
      assert.equal(await page.$eval('.set-keys__more', (el) => el.open), true);
      await page.screenshot({ path: `${OUT}/hotkeys-phone.png` });
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });

  test('buy the hovered operator or item once; settings rebind it; rewards and ready state stay protected', async () => {
    const page = await browser.newPage();
    try {
      const problems = await open(page);
      await page.mouse.move(1, 1);
      const initial = await mockState(page);
      await page.keyboard.press('KeyB');
      assert.deepEqual(await mockState(page), initial, 'no hovered card means no purchase');
      const first = initial.shop.slots.findIndex((s) => s && !s.sold && s.kind !== 'item');
      await page.hover(`.scard[data-buy-slot="${first}"]`);
      await page.keyboard.down('KeyB');
      await page.waitForFunction((i) => globalThis.__MOCK__.S().priv.shop.slots[i].sold, {}, first);
      await page.keyboard.down('KeyB'); // repeat while held
      await page.keyboard.up('KeyB');
      const bought = await mockState(page);
      assert.equal(bought.funds, initial.funds - initial.shop.slots[first].price);
      assert.equal(bought.hand.filter(Boolean).length, initial.hand.filter(Boolean).length + 1);

      await page.click('.gm__gear');
      await page.waitForSelector('.modal .set-keys');
      assert.equal(await keyOf(page, 'buy'), 'B');
      await page.click('.set-key[data-action="buy"]');
      await page.keyboard.press('KeyG');
      await keyIs(page, 'buy', 'G');
      await page.screenshot({ path: `${OUT}/hotkeys-buy-settings.png` });
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { hidden: true });

      const item = bought.shop.slots.findIndex((s) => s && !s.sold && s.kind === 'item');
      assert.ok(item >= 0, 'the mock shop contains an item');
      await page.hover(`.scard[data-buy-slot="${item}"]`);
      await page.keyboard.press('KeyB');
      assert.deepEqual(await mockState(page), bought, 'the old binding no longer buys');
      await page.keyboard.press('KeyG');
      await page.waitForFunction((i) => globalThis.__MOCK__.S().priv.shop.slots[i].sold, {}, item);
      assert.equal((await mockState(page)).funds, bought.funds - bought.shop.slots[item].price);

      // Fixture mutations only: exercise guards on the real keyboard handler without clicking a card first.
      await page.evaluate(() => globalThis.__MOCK__.mutate((s) => { s.priv.ready = true; }));
      const remaining = (await mockState(page)).shop.slots.findIndex((s) => s && !s.sold && s.kind !== 'item');
      await page.hover(`.scard[data-buy-slot="${remaining}"]`);
      const ready = await mockState(page);
      await page.keyboard.press('KeyG');
      assert.deepEqual(await mockState(page), ready, 'ready state prevents buying');
      await page.evaluate(() => globalThis.__MOCK__.mutate((s) => {
        s.priv.ready = false;
        s.priv.shop.rewardOffer = { tier: 5, slots: [{ kind: 'chess', id: s.priv.shop.slots[0].id, price: 0, sold: false }] };
      }));
      await page.waitForSelector('.shopbar.has-reward');
      await page.hover('.shopbar.has-reward .scard:not([data-buy-slot])');
      const reward = await mockState(page);
      await page.keyboard.press('KeyG');
      assert.deepEqual(await mockState(page), reward, 'free rewards are not normal purchases');
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });
});
