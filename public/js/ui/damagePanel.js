// Actual damage (normal battle + Unite); prep shows the previous round's retained summary.
// The local runner / streamed snapshot owns the numbers;
// this panel only projects them, with a 250 ms refresh while open. No event-based damage reconstruction.
import { useState } from '../../vendor/hooks.module.js';
import { html, Icon, useTicker } from './components.js';
import { t, tName, langInfo } from '../../../shared/i18n.js';
import { getBond } from '../data.js';
import { bondDamageStats, damageTypeStats, roundedDamageTypes, DAMAGE_TYPES } from '../../../shared/damageSources.js';

/** Filter and rank independent operator pieces; the report already combines summon instances and battle stages. */
export function damagePanelView(report, ownerId = '') {
  const rows = (Array.isArray(report?.units) ? report.units : []).filter((u) => !ownerId || u.ownerId === ownerId)
    .map((u) => ({ ...u, dmg: Math.max(0, Number.isFinite(u.dmg) ? u.dmg : 0) }))
    .sort((a, b) => b.dmg - a.dmg || a.id.localeCompare(b.id));
  const total = rows.reduce((sum, u) => sum + u.dmg, 0);
  const byBond = new Map();
  const damageTypes = {};
  for (const u of rows) {
    u.damageTypes = roundedDamageTypes(u.damageTypes, u.dmg);
    for (const [type, n] of Object.entries(u.damageTypes)) damageTypes[type] = (damageTypes[type] || 0) + n;
    u.bondDamage = bondDamageStats(u.bondDamage, u.dmg);
    u.bondTotal = Object.values(u.bondDamage).reduce((sum, n) => sum + n, 0);
    for (const [id, dmg] of Object.entries(u.bondDamage)) {
      let b = byBond.get(id);
      if (!b) { b = { id, dmg: 0, damageTypes: {} }; byBond.set(id, b); }
      b.dmg += dmg;
      for (const [type, n] of Object.entries(damageTypeStats(u.bondDamageTypes?.[id], dmg))) b.damageTypes[type] = (b.damageTypes[type] || 0) + n;
    }
  }
  const bonds = [...byBond.values()].map((b) => ({ ...b, damageTypes: roundedDamageTypes(b.damageTypes, b.dmg) }))
    .sort((a, b) => b.dmg - a.dmg || a.id.localeCompare(b.id));
  return { total, damageTypes, bonds, bondTotal: bonds.reduce((sum, b) => sum + b.dmg, 0),
    rows: rows.map((u) => ({ ...u, share: total > 0 ? u.dmg / total : 0, bar: rows[0]?.dmg > 0 ? u.dmg / rows[0].dmg : 0 })) };
}

const damageTypeLabel = (type) => type === 'phys' ? t('物理伤害') : type === 'arts' ? t('法术伤害') : type === 'true' ? t('真实伤害') : t('元素伤害');

function DamageTypes({ values = {}, all = false, scope, fmt }) {
  const types = DAMAGE_TYPES.filter((type) => all || values[type] > 0);
  if (!types.length) return null;
  return html`<div class="damage-panel__types" data-type-scope=${scope} aria-label=${t('伤害构成')}>
    ${types.map((type) => html`<div key=${type} class="damage-panel__type" data-damage-type=${type}>
      <span>${damageTypeLabel(type)}</span><b class="num">${fmt(values[type] || 0)}</b></div>`)}
  </div>`;
}

function DamageBar({ values, total, scale = 1, scope, fmt }) {
  const types = damageTypeStats(values, total);
  return html`<div class="damage-panel__bar" data-bar-scope=${scope} aria-hidden="true">
    <div class="damage-panel__bar-fill" style=${{ width: `${total > 0 ? scale * 100 : 0}%` }}>
      ${DAMAGE_TYPES.filter((type) => types[type] > 0).map((type) => html`<i key=${type}
        class="damage-panel__segment" data-damage-type=${type} style=${{ width: `${types[type] / total * 100}%` }}
        title=${`${damageTypeLabel(type)} ${fmt(types[type])} (${(types[type] / total * 100).toFixed(1)}%)`}></i>`)}
    </div>
  </div>`;
}

export function DamagePanel({ fieldId, round, previous = false, getStats, players = [], myId }) {
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState('');
  useTicker(open ? 250 : 0);
  const report = open && typeof getStats === 'function' ? getStats() : null;
  const ready = !!report && (previous ? Number.isInteger(report.round) && report.round <= round : report.fieldId === fieldId && report.round === round);
  const owners = new Set(ready ? report.units.map((u) => u.ownerId) : []);
  const selected = owners.has(owner) ? owner : '';
  const view = damagePanelView(ready ? report : null, selected);
  const fmt = (n) => new Intl.NumberFormat(langInfo()?.locale || 'zh-CN', { maximumFractionDigits: 0 }).format(n);
  const playerName = (id) => players.find((p) => p.playerId === id)?.name || id;
  const title = previous ? t('上一回合伤害') : t('本回合伤害');
  return html`<section class=${`damage-panel${open ? ' is-open' : ''}`} aria-label=${title}>
    <button type="button" class="damage-panel__toggle" aria-expanded=${open} aria-controls="round-damage-body"
      onKeyDown=${(e) => { if (e.key === ' ') e.stopPropagation(); }}
      onClick=${() => setOpen(!open)}><${Icon} name="chart" /><span>${title}</span>
      <${Icon} name=${open ? 'chevronRight' : 'chevronLeft'} /></button>
    ${open ? html`<div id="round-damage-body" class="damage-panel__body">
      <div class="damage-panel__meta"><span>${previous && !ready ? title : t('第 {r} 回合', { r: ready ? report.round : round })}</span>
        <span>${ready && (report.finished || previous) ? t('作战结束') : previous ? '' : t('实时')}</span></div>
      <label class="damage-panel__filter"><span>${t('玩家')}</span><select aria-label=${t('伤害统计玩家')}
        value=${selected} onChange=${(e) => setOwner(e.currentTarget.value)}>
        <option value="">${previous ? t('该战场全员') : t('当前战场全员')}</option>
        ${[...owners].map((id) => html`<option key=${id} value=${id}>${id === myId ? t('{name}（自己）', { name: playerName(id) }) : playerName(id)}</option>`)}
      </select></label>
      <div class="damage-panel__total"><span>${t('总伤害')}</span><b class="num">${fmt(view.total)}</b></div>
      <${DamageTypes} values=${view.damageTypes} all=${true} scope="total" fmt=${fmt} />
      <${DamageBar} values=${view.damageTypes} total=${view.total} scope="total" fmt=${fmt} />
      <section class="damage-panel__bonds" aria-label=${t('盟约伤害')}>
        <div class="damage-panel__line"><strong>${t('盟约伤害')}</strong><b class="num">${fmt(view.bondTotal)}</b></div>
        <p class="damage-panel__note">${t('已包含在总伤害中')}</p>
        <ul class="damage-panel__bond-list">${view.bonds.map((b) => html`<li key=${b.id} data-damage-bond=${b.id}>
          <div class="damage-panel__line"><span>${tName(getBond(b.id)?.name || b.id)}</span><b class="num">${fmt(b.dmg)}</b></div>
          <${DamageTypes} values=${b.damageTypes} scope=${`bond:${b.id}`} fmt=${fmt} />
          <${DamageBar} values=${b.damageTypes} total=${b.dmg} scope=${`bond:${b.id}`} fmt=${fmt} /></li>`)}</ul>
      </section>
      <ol class="damage-panel__list" aria-label=${t('干员伤害排名')}>
        ${view.rows.map((u) => html`<li key=${u.id} class="damage-panel__row" data-stat-id=${u.id}>
          <div class="damage-panel__line"><span class="damage-panel__name" title=${tName(u.name)}>${tName(u.name)}</span>
            <b class="num damage-panel__value">${fmt(u.dmg)}</b></div>
          <div class="damage-panel__caption"><span>${playerName(u.ownerId)}${u.kind === 'token' ? ` · ${t('召唤物')}` : u.golden ? ` · ${t('精锐')}` : ''}</span>
            <span class="num">${(u.share * 100).toFixed(1)}%</span></div>
          ${u.bondTotal > 0 ? html`<div class="damage-panel__caption">${t('其中盟约伤害 {n}', { n: fmt(u.bondTotal) })}</div>` : null}
          <${DamageTypes} values=${u.damageTypes} scope=${u.id} fmt=${fmt} />
          <${DamageBar} values=${u.damageTypes} total=${u.dmg} scale=${u.bar} scope=${u.id} fmt=${fmt} />
        </li>`)}
      </ol>
      ${!view.rows.length ? html`<p class="damage-panel__empty">${ready ? t('本场没有干员伤害数据') : previous ? t('暂无上一回合伤害数据') : t('等待战斗数据')}</p>` : null}
      <p class="damage-panel__note">${t('统计实际扣除的敌方生命；召唤物单独列出。')}
        ${t('仅单列盟约直接伤害；属性增益仍计入干员伤害。')}
        ${t('元素损伤积累不计入伤害。')}
        ${ready && report.kind === 'unite' ? previous ? t('含上一回合普通作战与联防。') : t('含本回合普通作战与联防。') : ''}</p>
    </div>` : null}
  </section>`;
}
