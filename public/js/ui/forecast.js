import { html } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';
import { money, shortDate, signedMoney } from '../../core/format.js';
import { cashChart } from '../charts.js';
import { SCENARIO_TEMPLATES, templateDefaults } from '../../core/scenarios.js';
import { pageHeader, needData, cur } from './common.js';

const CADENCE = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Quarterly' };

function paramInput(t, p) {
  const v = app.scenario.params[t.id]?.[p.key] ?? p.default;
  const unit = p.unit === '%' ? '%' : p.unit === 'days' ? 'days' : p.unit === 'money' ? cur() : p.unit;
  return html`<label>${p.label}<span class="inp"><input type="number" inputmode="decimal" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" data-sc-param="${t.id}:${p.key}"><em>${unit}</em></span></label>`;
}

function scenarioSection(f) {
  const res = app.scenarioResult;
  const cmp = res?.comparison;
  const $ = (v) => money(v, cur());
  return html`<section class="card" aria-labelledby="sc-h">
    <div class="card-head"><h2 id="sc-h">${icon('spark', 18)}Scenario simulator</h2><span class="muted small">What-ifs re-run the same model. Nothing here changes your data.</span></div>
    <div class="scenario-grid">${SCENARIO_TEMPLATES.map((t) => html`<fieldset class="sc ${app.scenario.active[t.id] ? 'on' : ''}">
      <legend class="visually-hidden">${t.label}</legend>
      <label class="check sc-title"><input type="checkbox" data-sc-toggle="${t.id}" ${app.scenario.active[t.id] ? 'checked' : ''}><b>${t.label}</b></label>
      <p class="muted small">${t.description}</p>
      <div class="sc-params">${t.params.map((p) => paramInput(t, p))}</div></fieldset>`)}</div>
    ${cmp ? html`
      <div class="compare">
        <div><span class="mini-label">Lowest balance</span><b>${$(cmp.base.min)} → ${$(cmp.scenario.min)}</b><small class="${cmp.minDelta >= 0 ? 'pos' : 'neg'}">${signedMoney(cmp.minDelta, cur())}</small></div>
        <div><span class="mini-label">Closing balance, week ${f.horizonWeeks}</span><b>${$(cmp.base.closing)} → ${$(cmp.scenario.closing)}</b><small class="${cmp.closingDelta >= 0 ? 'pos' : 'neg'}">${signedMoney(cmp.closingDelta, cur())}</small></div>
        <div><span class="mini-label">Weeks below zero</span><b>${cmp.base.weeksBelowZero} → ${cmp.scenario.weeksBelowZero}</b></div>
      </div>
      <p class="verdict" role="status">${icon(cmp.scenario.shortfallWeek && !cmp.base.shortfallWeek ? 'alert' : 'check', 16)}${cmp.verdict}</p>
      ${cashChart({ weeks: f.weeks, compare: res.forecast.weeks, currency: cur(), label: 'Baseline versus scenario cash balance', compareName: 'With scenario' })}`
    : html`<p class="muted empty-hint">Tick one or more scenarios above to compare them with your baseline forecast. Selected scenarios are combined.</p>`}
  </section>`;
}

export function forecastView() {
  const a = app.analysis;
  if (!a || a.empty) return needData('Forecast your cash flow');
  const f = a.forecast;
  if (!f.available) return html`${pageHeader('Cash flow forecast')}<section class="card"><p>${icon('info', 16)} ${f.reason}</p></section>`;
  const $ = (v) => money(v, cur());
  return html`${pageHeader('Cash flow forecast', `Weekly projection from ${shortDate(f.asOf)} · deterministic and explainable`, html`<label class="inline">Horizon <select data-setting="horizonWeeks">${[8, 13, 26].map((w) => html`<option value="${w}" ${w === f.horizonWeeks ? 'selected' : ''}>${w} weeks</option>`)}</select></label>`)}
    ${f.relative ? html`<p class="note warnbox">${icon('alert', 16)}Opening balance unknown — balances below are relative to today (0), not actual cash. Add it under Upload → Options or Settings.</p>` : ''}
    <div class="grid-kpi four">
      <article class="kpi"><div class="kpi-label">Projected closing, week ${f.horizonWeeks}</div><div class="kpi-value">${$(f.projectedClosing.value)}</div><div class="kpi-sub">80% range ${$(f.projectedClosing.low)} to ${$(f.projectedClosing.high)}</div></article>
      <article class="kpi ${f.minBalance.value < 0 ? 'bad' : ''}"><div class="kpi-label">Lowest balance</div><div class="kpi-value">${$(f.minBalance.value)}</div><div class="kpi-sub">Week ${f.minBalance.week} · ${shortDate(f.minBalance.date)}</div></article>
      <article class="kpi ${f.firstShortfall ? 'bad' : ''}"><div class="kpi-label">First shortfall (expected)</div><div class="kpi-value">${f.firstShortfall ? `Week ${f.firstShortfall.week}` : 'None'}</div><div class="kpi-sub">${f.firstShortfall ? `${shortDate(f.firstShortfall.date)} · ${$(f.firstShortfall.balance)}` : 'Central case stays above zero'}</div></article>
      <article class="kpi ${f.firstAtRisk ? 'warn' : ''}"><div class="kpi-label">First shortfall (downside)</div><div class="kpi-value">${f.firstAtRisk ? `Week ${f.firstAtRisk.week}` : 'None'}</div><div class="kpi-sub">${f.firstAtRisk ? `10th-percentile ${$(f.firstAtRisk.low)}` : 'Even the downside stays positive'}</div></article>
    </div>
    <section class="card" aria-labelledby="fc-h"><div class="card-head"><h2 id="fc-h">${icon('trend', 18)}Expected cash balance</h2></div>${cashChart({ weeks: f.weeks, currency: cur() })}</section>
    <div class="grid-2">
      <section class="card" aria-labelledby="rc-h"><div class="card-head"><h2 id="rc-h">Recurring commitments detected</h2></div>
        ${f.recurring.length ? html`<div class="table-wrap"><table><thead><tr><th scope="col">Item</th><th scope="col">Pattern</th><th scope="col" class="num">Amount</th><th scope="col">Next</th></tr></thead><tbody>${f.recurring.slice(0, 12).map((g) => html`<tr><th scope="row">${g.label}</th><td>${CADENCE[g.cadence]} · ${g.count}×</td><td class="num ${g.sign < 0 ? 'neg' : 'pos'}">${signedMoney(g.amount, cur())}</td><td>${g.nextDates[0] ? shortDate(g.nextDates[0]) : '—'}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">No repeating payments were detected.</p>`}
      </section>
      <section class="card" aria-labelledby="sch-h"><div class="card-head"><h2 id="sch-h">Largest scheduled items</h2></div>
        <div class="table-wrap"><table><thead><tr><th scope="col">When</th><th scope="col">Item</th><th scope="col">Type</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${f.scheduled.slice(0, 10).map((s) => html`<tr><td>Wk ${s.week}</td><th scope="row">${s.label}${s.reference ? html` <small>${s.reference}</small>` : ''}</th><td>${{ receivable: 'Customer invoice', payable: 'Supplier bill', recurring: 'Recurring', scenario: 'Scenario' }[s.kind]}</td><td class="num ${s.amount < 0 ? 'neg' : 'pos'}">${signedMoney(s.amount, cur())}</td></tr>`)}</tbody></table></div>
      </section>
    </div>
    <section class="card" aria-labelledby="wk-h"><div class="card-head"><h2 id="wk-h">Week by week</h2></div>
      <div class="table-wrap"><table class="dense"><thead><tr><th scope="col">Week</th><th scope="col">Dates</th><th scope="col" class="num">Inflow</th><th scope="col" class="num">Outflow</th><th scope="col" class="num">Net</th><th scope="col" class="num">Expected balance</th><th scope="col" class="num">80% range</th></tr></thead>
      <tbody>${f.weeks.slice(1).map((w) => html`<tr class="${w.closing < 0 ? 'neg-row' : ''}"><th scope="row">${w.week}</th><td>${shortDate(w.start)} – ${shortDate(w.end)}</td><td class="num">${$(w.inflow)}</td><td class="num">${$(w.outflow)}</td><td class="num ${w.net < 0 ? 'neg' : ''}">${signedMoney(w.net, cur())}</td><td class="num"><b>${$(w.closing)}</b></td><td class="num muted">${$(w.low)} to ${$(w.high)}</td></tr>`)}</tbody></table></div></section>
    <section class="card" aria-labelledby="as-h"><div class="card-head"><h2 id="as-h">${icon('info', 18)}Assumptions behind this forecast</h2><button class="link" data-action="goto" data-route="settings">Edit →</button></div>
      <ul class="plain">${f.assumptions.map((x) => html`<li>${x.text}</li>`)}</ul></section>
    ${scenarioSection(f)}`;
}

export { templateDefaults };
