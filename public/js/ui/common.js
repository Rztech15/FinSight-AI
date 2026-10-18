import { html, raw } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';

export const cur = () => app.analysis?.settings?.currency || app.settings.currency || 'USD';

export function pageHeader(title, subtitle = '', actions = '') {
  return html`<header class="page-head"><div><h1>${title}</h1>${subtitle ? html`<p class="sub">${subtitle}</p>` : ''}</div>${actions ? html`<div class="head-actions">${actions}</div>` : ''}</header>`;
}

export function kpi({ label, value, sub = '', tone = '', unavailable = '', ic = 'spark', tip = '' }) {
  return html`<article class="kpi ${tone}" ${tip ? raw(`data-tip="${tip.replace(/"/g, '&quot;')}" tabindex="0"`) : ''}>
    <div class="kpi-top"><span class="kpi-ic">${icon(ic, 18)}</span><span class="kpi-label">${label}</span></div>
    ${unavailable
    ? html`<div class="kpi-value na">Not available</div><div class="kpi-sub">${unavailable}</div>`
    : html`<div class="kpi-value">${value}</div>${sub ? html`<div class="kpi-sub">${sub}</div>` : ''}`}
  </article>`;
}

const SEV_ICON = { critical: 'alert', high: 'alert', medium: 'info', low: 'info' };
export function sevBadge(sev) {
  return html`<span class="badge sev-${sev}">${icon(SEV_ICON[sev] || 'info', 14)}${sev[0].toUpperCase() + sev.slice(1)}</span>`;
}

export function aiBadge(source, model) {
  return source === 'ai'
    ? html`<span class="badge ai">${icon('spark', 14)}AI-written · figures verified</span>`
    : html`<span class="badge rules">${icon('check', 14)}Rules-based summary</span>`;
}

/** Turn "[E3]" markers into focusable citation chips that reveal the evidence on hover/focus. */
export function cited(text, evidence = app.evidence) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return html`${String(text).split(/(\[E\d+\])/g).map((p) => {
    const m = /^\[(E\d+)\]$/.exec(p);
    if (!m) return p;
    const e = byId.get(m[1]);
    return e ? html`<button type="button" class="cite" data-tip="${e.label}: ${e.text}">${m[1]}</button>` : '';
  })}`;
}

export function needData(title, text = 'Upload a CSV or Excel file, or explore with the synthetic demo business.') {
  return html`<section class="empty card">
    <img class="empty-logo" src="/assets/logo-mark.png" alt="" width="56" height="64">
    <h2>${title}</h2><p>${text}</p>
    <div class="row"><button class="btn primary" data-action="goto" data-route="upload">${icon('upload', 16)}Upload data</button>
    <button class="btn" data-action="load-demo">${icon('spark', 16)}Explore demo data</button></div>
  </section>`;
}

export function statePill(state) {
  const label = { proposed: 'Proposed', approved: 'Approved', rejected: 'Rejected', executed: 'Run in sandbox' }[state] || state;
  return html`<span class="pill st-${state}">${label}</span>`;
}

export const sevOrder = ['critical', 'high', 'medium', 'low'];
