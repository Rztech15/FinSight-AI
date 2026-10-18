import { html } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';
import { money } from '../../core/format.js';
import { pageHeader, sevBadge, needData, cur, sevOrder, statePill } from './common.js';

export function risksView() {
  const a = app.analysis;
  if (!a || a.empty) return needData('Spot cash risks early');
  const risks = a.risks;
  const count = (s) => risks.filter((r) => r.severity === s).length;
  return html`${pageHeader('Risk intelligence', 'Rule-based early warnings. Each alert shows the exact evidence that triggered it — no alert comes from a language model.')}
    <div class="grid-kpi four">${sevOrder.map((s) => html`<article class="kpi sev-card sev-${s}"><div class="kpi-label">${sevBadge(s)}</div><div class="kpi-value">${count(s)}</div><div class="kpi-sub">${{ critical: 'needs attention now', high: 'act within weeks', medium: 'monitor and plan', low: 'good to know' }[s]}</div></article>`)}</div>
    ${risks.length ? html`<div class="stack">${risks.map((r) => {
    const acts = app.actions.filter((x) => r.actionCodes.includes(x.code));
    return html`<article class="card risk sev-${r.severity}" id="risk-${r.id}">
      <div class="risk-head">${sevBadge(r.severity)}<h2>${r.title}</h2>${r.impact ? html`<span class="muted small">Amount involved ${money(r.impact, cur())}</span>` : ''}</div>
      <p>${r.summary}</p>
      <details><summary>Evidence (${r.evidence.length})</summary><dl class="evidence">${r.evidence.map((e) => html`<div><dt>${e.label}</dt><dd>${e.text}</dd></div>`)}</dl></details>
      ${acts.length ? html`<div class="chips"><span class="muted small">Suggested actions:</span>${acts.map((x) => html`<button class="chip" data-action="goto-action" data-id="${x.id}">${x.title.length > 54 ? `${x.title.slice(0, 52)}…` : x.title} ${statePill(x.state)}</button>`)}</div>` : ''}
    </article>`;
  })}</div>` : html`<section class="card"><p>${icon('check', 16)} No risks were detected in this data.</p></section>`}`;
}
