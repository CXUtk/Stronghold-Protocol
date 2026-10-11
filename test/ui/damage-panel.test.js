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
  assert.deepEqual(damagePanelView(null), { total: 0, rows: [] });
  assert.deepEqual(report.units.map((u) => u.id), ['b', 'a', 'c'], 'sorting does not mutate transport data');
});

test('no-damage and invalid amounts never render NaN/Infinity percentages', () => {
  const result = damagePanelView({ units: [{ id: 'a', dmg: NaN }, { id: 'b', dmg: -1 }, { id: 'c', dmg: Infinity }] });
  assert.equal(result.total, 0);
  assert.ok(result.rows.every((r) => r.share === 0 && r.bar === 0 && r.dmg === 0));
});
