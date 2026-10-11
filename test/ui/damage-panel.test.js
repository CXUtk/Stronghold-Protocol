import { test } from 'node:test';
import assert from 'node:assert/strict';
import { damagePanelView } from '../../public/js/ui/damagePanel.js';

test('damage ranking filters players, retains zero-damage operators and sums their shares', () => {
  const report = { units: [{ id: 'b', ownerId: 'p2', dmg: 80 }, { id: 'a', ownerId: 'p1', dmg: 40 }, { id: 'c', ownerId: 'p1', dmg: 0 }] };
  const all = damagePanelView(report);
  assert.deepEqual(all.rows.map((u) => u.id), ['b', 'a', 'c']);
  assert.equal(all.total, 120);
  assert.equal(all.rows[0].bar, 1);
  assert.equal(all.rows[1].bar, 0.5);
  const own = damagePanelView(report, 'p1');
  assert.equal(own.total, 40);
  assert.deepEqual(own.rows.map((u) => u.share), [1, 0]);
  assert.deepEqual(damagePanelView(null), { total: 0, rows: [], bonds: [], bondTotal: 0 });
  assert.deepEqual(report.units.map((u) => u.id), ['b', 'a', 'c'], 'sorting does not mutate transport data');
});

test('Alliance breakdown follows player filter and stays a subset rather than adding to total', () => {
  const report = { units: [
    { id: 'a', ownerId: 'p1', dmg: 100, bondDamage: { steadShip: 40 } },
    { id: 'b', ownerId: 'p2', dmg: 300, bondDamage: { steadShip: 60, siracusaShip: 200 } },
  ] };
  const all = damagePanelView(report);
  assert.equal(all.total, 400);
  assert.equal(all.bondTotal, 300);
  assert.deepEqual(all.bonds, [{ id: 'siracusaShip', dmg: 200 }, { id: 'steadShip', dmg: 100 }]);
  const own = damagePanelView(report, 'p1');
  assert.equal(own.total, 100);
  assert.equal(own.bondTotal, 40);
  assert.deepEqual(own.bonds, [{ id: 'steadShip', dmg: 40 }]);
  assert.deepEqual(report.units[0].bondDamage, { steadShip: 40 }, 'reading does not mutate transport data');
  const bad = damagePanelView({ units: [{ id: 'x', dmg: 10, bondDamage: { steadShip: 50, siracusaShip: NaN, unknown: 999 } }] });
  assert.equal(bad.bondTotal, 10, 'untrusted subtotals cannot exceed the unit total');
});

test('no-damage and invalid amounts never render NaN/Infinity percentages', () => {
  const result = damagePanelView({ units: [{ id: 'a', dmg: NaN }, { id: 'b', dmg: -1 }, { id: 'c', dmg: Infinity }] });
  assert.equal(result.total, 0);
  assert.ok(result.rows.every((r) => r.share === 0 && r.bar === 0 && r.dmg === 0));
});
