import { html } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';
import { money, pct, months, signedMoney } from '../../core/format.js';
import { ring, hbars, monthlyBars } from '../charts.js';
import { pageHeader, needData, cur } from './common.js';

export function healthView() {
  const a = app.analysis;
  if (!a || a.empty) return needData('Understand your financial health');
  const { metrics: m, health: h } = a;
  const $ = (v) => money(v, cur());
  const tone = (s) => (s >= 75 ? 'good' : s >= 55 ? 'watch' : s >= 35 ? 'warn' : 'bad');
  const catTotal = m.categories.reduce((s, c) => s + c.amount, 0);
  return html`${pageHeader('Financial health', 'A transparent score: every component is measured from your data and shown with its weight.')}
    <div class="grid-main">
      <section class="card" aria-labelledby="hs-h"><div class="card-head"><h2 id="hs-h">${icon('heart', 18)}Health score</h2></div>
        ${h.available ? html`<div class="health-row big">${ring(h)}<div><p class="lede">${h.band.label}</p><p class="muted">${h.coverage < 1 ? `Based on ${Math.round(h.coverage * 100)}% of the scoring model — components without data are left out, not counted as zero.` : 'All components were measurable.'}</p></div></div>
        <div class="table-wrap"><table><thead><tr><th scope="col">Component</th><th scope="col">Score</th><th scope="col" class="num">Weight</th><th scope="col">Why</th></tr></thead><tbody>${h.components.map((c) => html`<tr><th scope="row">${c.label}</th><td><span class="meter ${tone(c.score)}" role="img" aria-label="${c.score} out of 100"><i style="width:${c.score}%"></i></span> <b>${c.score}</b></td><td class="num">${Math.round(c.effectiveWeight * 100)}%</td><td class="muted">${c.detail}</td></tr>`)}</tbody></table></div>` : html`<p>${h.reason}</p>`}
      </section>
      <section class="card" aria-labelledby="km-h"><div class="card-head"><h2 id="km-h">Key measures</h2></div>
        <dl class="kv">
          <div><dt>Average monthly revenue</dt><dd>${m.revenue.available ? $(m.revenue.value) : 'Not available'}</dd></div>
          <div><dt>Average monthly expenses</dt><dd>${m.expenses.available ? $(m.expenses.value) : 'Not available'}</dd></div>
          <div><dt>Operating margin</dt><dd class="${m.margin.available && m.margin.value < 0 ? 'neg' : ''}">${m.margin.available ? pct(m.margin.value, 1) : 'Not available'}</dd></div>
          <div><dt>Average monthly net cash flow</dt><dd>${m.burn.available ? signedMoney(m.burn.avgMonthlyNet, cur()) : 'Not available'}</dd></div>
          <div><dt>Cash runway</dt><dd>${m.runway.available ? months(m.runway.value) : 'Not available'}</dd></div>
          <div><dt>Overdue receivables</dt><dd>${m.receivables ? `${$(m.receivables.overdue)} (${pct(m.receivables.overdueShare)})` : 'Not tracked'}</dd></div>
          <div><dt>Largest customer share</dt><dd>${m.customers.available ? `${pct(m.customers.topShare)} of revenue` : 'Not available'}</dd></div>
          <div><dt>Payment terms used</dt><dd>${m.terms.days} days <small>(${m.terms.source})</small></dd></div>
          <div><dt>Customers pay after due date</dt><dd>${m.lateness.receivable.days} days <small>(${m.lateness.receivable.source})</small></dd></div>
        </dl>
        ${m.revenue.available ? html`<p class="muted small">${m.revenue.note}</p>` : ''}
      </section>
    </div>
    <div class="grid-2">
      <section class="card" aria-labelledby="sp-h"><div class="card-head"><h2 id="sp-h">Where the money goes</h2><span class="muted small">last ${m.expenses.monthsUsed || 3} complete months, operating spend</span></div>
        ${m.categories.length ? hbars({ items: m.categories.slice(0, 8).map((c) => ({ label: c.name, value: c.amount })), currency: cur(), total: catTotal }) : html`<p class="muted">Not enough complete months to rank spending.</p>`}</section>
      <section class="card" aria-labelledby="cu-h"><div class="card-head"><h2 id="cu-h">Who pays you</h2><span class="muted small">named customers, last ${m.customers.monthsUsed || 6} months</span></div>
        ${m.customers.available ? html`${hbars({ items: m.customers.value.slice(0, 6).map((c) => ({ label: c.name, value: c.amount })), currency: cur(), total: m.customers.revenueTotal })}<p class="muted small">Shares are of total operating revenue; ${pct(1 - m.customers.coverage)} of revenue has no customer name (for example card sales).</p>` : html`<p class="muted">${m.customers.reason}</p>`}</section>
    </div>
    <section class="card" aria-labelledby="mm-h"><div class="card-head"><h2 id="mm-h">Month by month</h2></div>${monthlyBars({ months: m.months, currency: cur() })}</section>`;
}
