import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const OUT = fileURLToPath(new URL('../e2e/out/', import.meta.url));

describe('live round damage panel', { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function open(page, width = 1280, height = 720) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width, height });
    await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=COMBAT`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.damage-panel__toggle');
    assert.equal(await page.$('.damage-panel__body'), null, 'collapsed by default');
    await page.click('.damage-panel__toggle');
    await page.waitForSelector('.damage-panel__row');
    return errors;
  }

  test('live damage grows, pause freezes it, Space on the toggle does not trigger game pause', async () => {
    const page = await browser.newPage();
    try {
      const errors = await open(page);
      const total = () => page.$eval('.damage-panel__total b', (el) => Number(el.textContent.replaceAll(',', '')));
      const initial = await total();
      await page.waitForFunction((n) => Number(document.querySelector('.damage-panel__total b')?.textContent.replaceAll(',', '')) > n, {}, initial);
      await page.evaluate(() => { const m = globalThis.__MOCK__; m.S().pub.paused = true; m.pushPublic(); });
      await pause(400);
      const frozen = await total();
      await pause(600);
      assert.equal(await total(), frozen);
      await page.evaluate(() => { const m = globalThis.__MOCK__; m.S().pub.paused = false; m.pushPublic(); });
      await page.waitForSelector('.paused-overlay', { hidden: true });
      await page.focus('.damage-panel__toggle');
      await page.keyboard.press('Space');
      await page.waitForSelector('.damage-panel__body', { hidden: true });
      assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().pub.paused), false);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('player filter, zero damage, field change and new round never display stale numbers', async () => {
    const page = await browser.newPage();
    try {
      const errors = await open(page);
      await page.evaluate(async () => {
        const m = globalThis.__MOCK__;
        m.S().pub.paused = true;
        const { net } = await import('/js/net.js');
        const fieldId = m.store.get().match.field.fieldId;
        net._emit('b.snap', { t: 'b.snap', fieldId, gt: 5, units: [], dp: 10, killed: 0, total: 1,
          damage: { fieldId, round: m.S().pub.round, kind: 'normal', units: [
            { id: 'p1:op:1', ownerId: 'p1', name: '深靛', kind: 'op', dmg: 100, damageTypes: { phys: 30, arts: 40, true: 20, elemental: 10 },
              bondDamage: { steadShip: 40 }, bondDamageTypes: { steadShip: { arts: 40 } } },
            { id: 'p1:op:2', ownerId: 'p1', name: '调香师', kind: 'op', dmg: 0 },
            { id: 'ai_2:op:1', ownerId: 'ai_2', name: '寒芒克洛丝', kind: 'op', dmg: 300, damageTypes: { phys: 100, true: 200 },
              bondDamage: { siracusaShip: 200 }, bondDamageTypes: { siracusaShip: { true: 200 } } },
          ] } });
      });
      await page.waitForFunction(() => document.querySelector('.damage-panel__total b')?.textContent === '400');
      for (const [type, n] of Object.entries({ phys: 130, arts: 40, true: 220, elemental: 10 })) {
        assert.equal(await page.$eval(`[data-type-scope="total"] [data-damage-type="${type}"] b`, (el) => Number(el.textContent)), n);
      }
      const bars = await page.$$eval('.damage-panel__bar', (els) => Object.fromEntries(els.map((el) => [el.dataset.barScope, {
        width: parseFloat(el.querySelector('.damage-panel__bar-fill').style.width),
        segments: [...el.querySelectorAll('.damage-panel__segment')].map((s) => ({ type: s.dataset.damageType,
          width: parseFloat(s.style.width), color: getComputedStyle(s).backgroundColor, title: s.title })),
      }])));
      assert.deepEqual(bars.total.segments.map((s) => [s.type, s.width]), [['phys', 32.5], ['arts', 10], ['true', 55], ['elemental', 2.5]]);
      assert.equal(new Set(bars.total.segments.map((s) => s.color)).size, 4, 'four distinct segment colors');
      for (const s of bars.total.segments) {
        const labelColor = await page.$eval(`[data-type-scope="total"] [data-damage-type="${s.type}"] span`, (el) => getComputedStyle(el).color);
        assert.equal(s.color, labelColor, 'segments match the labeled color key');
      }
      assert.ok(Math.abs(bars['p1:op:1'].width - 100 / 3) < 0.001, 'operator bar still compares damage to the highest row');
      assert.deepEqual(bars['p1:op:1'].segments.map((s) => s.width), [30, 40, 20, 10]);
      assert.equal(bars['p1:op:1'].segments[0].title, '物理伤害 30 (30.0%)');
      assert.deepEqual(bars['bond:siracusaShip'].segments.map((s) => [s.type, s.width]), [['true', 100]]);
      assert.equal(bars['p1:op:2'].width, 0, 'zero damage has no filled bar');
      assert.deepEqual(bars['p1:op:2'].segments, []);
      assert.equal(await page.$eval('[data-type-scope="bond:steadShip"] [data-damage-type="arts"] b', (el) => el.textContent), '40');
      assert.equal(await page.$eval('[data-type-scope="bond:siracusaShip"] [data-damage-type="true"] b', (el) => el.textContent), '200');
      assert.equal(await page.$eval('.damage-panel__bonds > .damage-panel__line b', (el) => el.textContent), '240');
      assert.equal(await page.$eval('[data-damage-bond="siracusaShip"] b', (el) => el.textContent), '200');
      assert.equal(await page.$eval('[data-damage-bond="siracusaShip"] span', (el) => el.textContent), '叙拉古');
      assert.equal(await page.$eval('[data-damage-bond="steadShip"] span', (el) => el.textContent), '坚守');
      assert.ok(await page.$eval('.damage-panel__bonds .damage-panel__note', (el) => el.textContent.includes('已包含在总伤害中')));
      await pause(1700); // let the battle-start banner leave before capturing the panel
      await (await page.$('.damage-panel')).screenshot({ path: `${OUT}/round-damage-types.png` });
      await page.select('.damage-panel__filter select', 'p1');
      await page.waitForFunction(() => document.querySelector('.damage-panel__total b')?.textContent === '100');
      assert.equal(await page.$eval('[data-type-scope="total"] [data-damage-type="phys"] b', (el) => el.textContent), '30');
      assert.equal(await page.$eval('[data-type-scope="p1:op:1"] [data-damage-type="elemental"] b', (el) => el.textContent), '10');
      assert.equal(await page.$('[data-damage-bond="siracusaShip"]'), null, 'other player’s Alliance damage filtered out');
      assert.equal(await page.$eval('[data-damage-bond="steadShip"] b', (el) => el.textContent), '40');
      assert.ok(await page.$eval('[data-stat-id="p1:op:1"]', (el) => el.textContent.includes('其中盟约伤害 40')));
      assert.equal(await page.$$eval('.damage-panel__row', (els) => els.length), 2);
      assert.equal(await page.$eval('.damage-panel__row .damage-panel__caption span:last-child', (el) => el.textContent), '100.0%');
      assert.equal(await page.$eval('[data-bar-scope="p1:op:1"] .damage-panel__bar-fill', (el) => el.style.width), '100%', 'filter rescales operator bar');
      await page.evaluate(() => globalThis.__MOCK__.setPhase('UNITE'));
      await page.waitForFunction(() => !document.querySelector('[data-stat-id="p1:op:1"]'));
      await page.waitForFunction(() => document.querySelector('.damage-panel__body > .damage-panel__note')?.textContent.includes('含本回合普通作战与联防'));
      await page.evaluate(() => { const m = globalThis.__MOCK__; m.setPhase('COMBAT'); m.S().pub.round++; m.pushPublic(); });
      await page.waitForSelector('.damage-panel__body', { hidden: true });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('desktop and narrow-screen layout: scrolling stays in the panel and text/numbers remain visible', async () => {
    const page = await browser.newPage();
    try {
      const errors = await open(page);
      for (const [width, height] of [[1280, 720], [844, 390], [390, 844]]) {
        await page.setViewport({ width, height });
        await pause(width === 1280 ? 1700 : 300);
        const box = await page.$eval('.damage-panel__body', (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, bottom: r.bottom, height: r.height };
        });
        assert.ok(box.left >= 0 && box.right <= width + 1 && box.bottom <= height + 1, JSON.stringify({ width, height, box }));
        assert.ok(box.height > 150);
        await page.screenshot({ path: `${OUT}/round-damage-${width}.png` });
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
});
