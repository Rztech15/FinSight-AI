import { html } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';
import { money, pct, signedMoney } from '../../core/format.js';
import { cashChart } from '../charts.js';
import { pageHeader, needData, cur } from './common.js';

function optionCard(o, need) {
  const $ = (v) => money(v, cur());
  const p = o.product;
  const sim = app.financingSim?.id === p.id ? app.financingSim : null;
  return html`<article class="card option ${o.eligible ? '' : 'off'}">
    <div class="opt-head"><div><h3>${p.name}</h3><p class="muted">${p.summary}</p></div>
      <div class="fit" aria-label="Fit score ${o.score} out of 100"><b>${o.eligible ? o.score : '—'}</b><span>${o.eligible ? 'fit' : 'not eligible'}</span></div></div>
    ${o.eligible ? html`<dl class="kv tight">
      <div><dt>Suggested amount</dt><dd>${$(o.suggestedAmount)} <small>(up to ${$(o.maxAmount)})</small></dd></div>
      <div><dt>Indicative cost</dt><dd>${o.cost ? `${$(o.cost.low)} – ${$(o.cost.high)}` : '—'}</dd></div>
      <div><dt>Effective annual cost</dt><dd>${o.cost ? `${pct(o.cost.annualLow)} – ${pct(o.cost.annualHigh)}` : '—'}</dd></div>
      <div><dt>Typical time to funds</dt><dd>${p.daysToFund} days${o.arrivesAfterNeed ? html` <span class="badge sev-medium">${icon('alert', 12)}May arrive after the gap starts</span>` : ''}</dd></div></dl>
      <p><b>Best for:</b> ${p.bestFor}</p>` : html`<ul class="plain why-not">${o.reasons.map((r) => html`<li>${icon('info', 14)}${r}</li>`)}</ul>`}
    <details><summary>Watch-outs</summary><ul class="plain">${p.watchOuts.map((w) => html`<li>${w}</li>`)}</ul></details>
    ${o.eligible && o.simulation ? html`<div class="row"><button class="btn small" data-action="fin-preview" data-id="${p.id}">${sim ? 'Refresh preview' : 'Preview effect on cash'}</button>${sim ? html`<button class="btn small ghost" data-action="fin-clear">Hide</button>` : ''}</div>` : ''}
    ${sim ? html`<div class="preview-box"><p class="verdict">${icon('check', 16)}${sim.comparison.verdict} <span class="muted">Lowest balance ${signedMoney(sim.comparison.minDelta, cur())}; closing balance ${signedMoney(sim.comparison.closingDelta, cur())}.</span></p>
      ${cashChart({ weeks: app.analysis.forecast.weeks, compare: sim.forecast.weeks, currency: cur(), label: `Cash balance with ${p.name}`, compareName: `With ${p.name.toLowerCase()}` })}</div>` : ''}
  </article>`;
}

export function financingView() {
  const a = app.analysis;
  if (!a || a.empty) return needData('Match financing to your cash needs');
  const fin = a.financing;
  if (!fin) return html`${pageHeader('Financing options')}<section class="card"><p>${a.forecast.reason}</p></section>`;
  const $ = (v) => money(v, cur());
  const n = fin.need;
  return html`${pageHeader('Financing options', 'Match your projected cash need with typical business-finance structures.')}
    <p class="note warnbox">${icon('info', 16)}${fin.disclaimer}</p>
    <section class="card need ${n.standby ? '' : 'bad'}" aria-labelledby="nd-h">
      <div class="card-head"><h2 id="nd-h">${icon('bank', 18)}${n.standby ? 'No funding gap projected' : `Estimated funding need: ${$(n.amount)}`}</h2></div>
      <p>${n.standby ? `${n.reason} A standby facility of about ${$(n.suggestedStandby || 0)} would cover one week of average spending.` : `The gap starts in week ${n.week} and lasts about ${n.durationWeeks} weeks. ${n.reason}`}</p>
      <p class="muted small">Based on ${$(fin.avgMonthlyRevenue)} average monthly revenue and ${$(fin.eligibleReceivables)} of open invoices less than 61 days overdue.</p>
    </section>
    <div class="stack">${fin.options.map((o) => optionCard(o, n))}</div>
    <p class="fineprint">Cost ranges use editable product assumptions (public/core/financing.js). No application is submitted and no lender is contacted. To track a request, approve the “Prepare a request” item in Actions.</p>`;
}
