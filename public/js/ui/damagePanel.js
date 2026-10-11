// Current-round actual damage (normal battle + Unite). The local runner / streamed snapshot owns the numbers;
// this panel only projects them, with a 250 ms refresh while open. No event-based damage reconstruction.
import { useState } from '../../vendor/hooks.module.js';
import { html, Icon, useTicker } from './components.js';
import { t, tName, langInfo } from '../../../shared/i18n.js';

/** Filter and rank independent operator pieces; the report already combines summon instances and battle stages. */
export function damagePanelView(report, ownerId = '') {
  const rows = (Array.isArray(report?.units) ? report.units : []).filter((u) => !ownerId || u.ownerId === ownerId)
    .map((u) => ({ ...u, dmg: Math.max(0, Number.isFinite(u.dmg) ? u.dmg : 0) }))
    .sort((a, b) => b.dmg - a.dmg || a.id.localeCompare(b.id));
  const total = rows.reduce((sum, u) => sum + u.dmg, 0);
  return { total, rows: rows.map((u) => ({ ...u, share: total > 0 ? u.dmg / total : 0, bar: rows[0]?.dmg > 0 ? u.dmg / rows[0].dmg : 0 })) };
}

export function DamagePanel({ fieldId, round, getStats, players = [], myId }) {
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState('');
  useTicker(open ? 250 : 0);
  const report = open && typeof getStats === 'function' ? getStats() : null;
  const ready = !!report && report.fieldId === fieldId && report.round === round;
  const owners = new Set(ready ? report.units.map((u) => u.ownerId) : []);
  const selected = owners.has(owner) ? owner : '';
  const view = damagePanelView(ready ? report : null, selected);
  const fmt = (n) => new Intl.NumberFormat(langInfo()?.locale || 'zh-CN', { maximumFractionDigits: 0 }).format(n);
  const playerName = (id) => players.find((p) => p.playerId === id)?.name || id;
  return html`<section class=${`damage-panel${open ? ' is-open' : ''}`} aria-label=${t('本回合伤害')}>
    <button type="button" class="damage-panel__toggle" aria-expanded=${open} aria-controls="round-damage-body"
      onKeyDown=${(e) => { if (e.key === ' ') e.stopPropagation(); }}
      onClick=${() => setOpen(!open)}><${Icon} name="chart" /><span>${t('本回合伤害')}</span>
      <${Icon} name=${open ? 'chevronRight' : 'chevronLeft'} /></button>
    ${open ? html`<div id="round-damage-body" class="damage-panel__body">
      <div class="damage-panel__meta"><span>${t('第 {r} 回合', { r: round })}</span>
        <span>${ready && report.finished ? t('作战结束') : t('实时')}</span></div>
      <label class="damage-panel__filter"><span>${t('玩家')}</span><select aria-label=${t('伤害统计玩家')}
        value=${selected} onChange=${(e) => setOwner(e.currentTarget.value)}>
        <option value="">${t('当前战场全员')}</option>
        ${[...owners].map((id) => html`<option key=${id} value=${id}>${id === myId ? t('{name}（自己）', { name: playerName(id) }) : playerName(id)}</option>`)}
      </select></label>
      <div class="damage-panel__total"><span>${t('总伤害')}</span><b class="num">${fmt(view.total)}</b></div>
      <ol class="damage-panel__list" aria-label=${t('干员伤害排名')}>
        ${view.rows.map((u) => html`<li key=${u.id} class="damage-panel__row" data-stat-id=${u.id}>
          <div class="damage-panel__line"><span class="damage-panel__name" title=${tName(u.name)}>${tName(u.name)}</span>
            <b class="num damage-panel__value">${fmt(u.dmg)}</b></div>
          <div class="damage-panel__caption"><span>${playerName(u.ownerId)}${u.kind === 'token' ? ` · ${t('召唤物')}` : u.golden ? ` · ${t('精锐')}` : ''}</span>
            <span class="num">${(u.share * 100).toFixed(1)}%</span></div>
          <div class="damage-panel__bar" aria-hidden="true"><i style=${{ width: `${u.bar * 100}%` }}></i></div>
        </li>`)}
      </ol>
      ${!view.rows.length ? html`<p class="damage-panel__empty">${ready ? t('本场没有干员伤害数据') : t('等待战斗数据')}</p>` : null}
      <p class="damage-panel__note">${t('统计实际扣除的敌方生命；召唤物单独列出。')}
        ${ready && report.kind === 'unite' ? t('含本回合普通作战与联防。') : ''}</p>
    </div>` : null}
  </section>`;
}
