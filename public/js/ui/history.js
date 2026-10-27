import { html } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';
import { money, shortDate } from '../../core/format.js';
import { pageHeader } from './common.js';

function currentFp() {
  const a = app.analysis;
  if (!a || a.empty || app.isDemo || !app.table) return null;
  return `${app.fileName}|${app.table.rows.length}|${a.metrics.period.first}|${a.metrics.period.last}`;
}

export function historyView() {
  const list = app.history || [];
  const cur = currentFp();
  return html`${pageHeader('History', 'Files you analysed before. Open one to see its dashboard, forecast, risks and health again.')}
    ${!app.privacy.rememberData ? html`<p class="note warnbox">${icon('info', 16)}<span>History is switched off. Turn on “Remember my loaded file” in Settings to keep past files on this device.</span></p>` : ''}
    <p class="note">${icon('lock', 14)}<span>Saved only on this device (never uploaded). Up to 10 files, kept 30 days. Signing out or “Reset everything” erases them.</span></p>
    ${list.length ? html`<div class="stack">${list.map((h) => html`<article class="card hist ${h.fp === cur ? 'current' : ''}">
      <div class="hist-head"><div><h3>${icon('file', 16)} ${h.name}</h3><p class="muted small">Analysed ${new Date(h.savedAt).toLocaleString()} · ${h.rows.toLocaleString()} rows · ${shortDate(h.first)} to ${shortDate(h.last)}</p></div>
        ${h.fp === cur ? html`<span class="badge good">${icon('check', 14)}Open now</span>` : ''}</div>
      <dl class="hist-stats">
        <div><dt>Cash on hand</dt><dd>${h.cash === null ? 'n/a' : money(h.cash, h.currency)}</dd></div>
        <div><dt>Health score</dt><dd>${h.health === null ? 'n/a' : h.health}</dd></div>
        <div><dt>First shortfall</dt><dd>${h.shortfallWeek ? `Week ${h.shortfallWeek}` : 'None projected'}</dd></div>
      </dl>
      <div class="row"><button class="btn primary small" data-action="hist-open" data-id="${h.id}">${icon('trend', 14)}Open</button>
        <button class="btn small danger" data-action="hist-delete" data-id="${h.id}">Delete</button></div></article>`)}</div>
      <div class="row end"><button class="btn danger" data-action="hist-clear">Delete all history</button></div>`
    : html`<section class="empty card"><img class="empty-logo" src="/assets/logo-mark.png" alt="" width="56" height="64"><h2>No history yet</h2>
      <p>Each file you upload and analyse is listed here, so you can come back to it later without uploading it again. The demo business is not saved.</p>
      <div class="row"><button class="btn primary" data-action="goto" data-route="upload">${icon('upload', 16)}Upload data</button></div></section>`}`;
}
