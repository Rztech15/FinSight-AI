import { html } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';
import { money, months, shortDate, signedMoney } from '../../core/format.js';
import { cashChart, monthlyBars, hbars, ring } from '../charts.js';
import { REASON_TEXT } from '../ai-client.js';
import { pageHeader, kpi, sevBadge, aiBadge, cited, needData, cur } from './common.js';

function aiCard() {
  const ai = app.ai;
  const n = ai.narrative;
  return html`<section class="card ai-card" aria-labelledby="ai-h">
    <div class="card-head"><h2 id="ai-h">${icon('bot', 18)}Executive summary</h2>
      ${n ? aiBadge(ai.source) : ''}</div>
    ${ai.status === 'loading' && !n ? html`<div class="skeleton" aria-busy="true"><i></i><i></i><i></i></div>` : ''}
    ${n ? html`
      ${ai.source === 'ai' ? html`<p class="lede">${cited(n.summary)}</p>` : ''}
      <ul class="points">${n.points.map((p) => html`<li>${cited(p.text)}</li>`)}</ul>
      ${ai.reason && ai.source !== 'ai' ? html`<p class="note">${icon('info', 14)}${REASON_TEXT[ai.reason] || 'Showing the rules-based summary.'}</p>` : ''}
    ` : ''}
    <div class="card-foot">
      <span class="muted small">Every figure traces to a numbered fact (hover E-tags). Decision support only — not financial advice.</span>
      <button class="btn small" data-action="regen-summary" ${ai.status === 'loading' ? 'disabled' : ''}>Refresh summary</button>
    </div>
  </section>`;
}

function risksCard(risks) {
  const top = risks.slice(0, 4);
  return html`<section class="card" aria-labelledby="rk-h">
    <div class="card-head"><h2 id="rk-h">${icon('shield', 18)}Top risks</h2><button class="link" data-action="goto" data-route="risks">All ${risks.length} →</button></div>
    ${top.length ? html`<ul class="risk-list">${top.map((r) => html`<li>${sevBadge(r.severity)}<div><strong>${r.title}</strong><span>${r.summary}</span></div></li>`)}</ul>`
    : html`<p class="muted">No risks were detected in this data.</p>`}
  </section>`;
}

function arApCard(m, $) {
  const ar = m.receivables;
  const ap = m.payables;
  const dueSoon = ap ? ap.items.filter((i) => i.due <= shiftDays(m.asOf, 14)).reduce((s, i) => s + i.amountAbs, 0) : 0;
  return html`<section class="card" aria-labelledby="arap-h">
    <div class="card-head"><h2 id="arap-h">${icon('clock', 18)}Receivables &amp; payables</h2></div>
    ${ar ? html`
      <div class="split"><div><div class="mini-label">Customers owe you</div><div class="big">${$(ar.total)}</div></div>
      <div><div class="mini-label">Overdue</div><div class="big ${ar.overdue > 0 ? 'bad' : ''}">${$(ar.overdue)}</div></div></div>
      ${hbars({ currency: cur(), items: [
    { label: 'Not yet due', value: ar.buckets.current, tone: 'teal' }, { label: '1–30 days late', value: ar.buckets.d1_30, tone: 'amber' },
    { label: '31–60 days late', value: ar.buckets.d31_60, tone: 'orange' }, { label: '61+ days late', value: ar.buckets.d61plus, tone: 'red' }].filter((i) => i.value > 0) })}`
    : html`<p class="muted">Receivables aren't tracked: the file has no unpaid invoices (map a Status and Due date column to enable this).</p>`}
    <hr>
    ${ap ? html`<div class="split"><div><div class="mini-label">You owe suppliers</div><div class="big">${$(ap.total)}</div></div>
      <div><div class="mini-label">Due within 14 days</div><div class="big ${dueSoon > 0 ? 'warn' : ''}">${$(dueSoon)}</div></div></div>`
    : html`<p class="muted">No unpaid supplier bills in the file.</p>`}
  </section>`;
}
const shiftDays = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);

const STEPS = [
  ['upload', '1', 'Upload', 'Drop in a bank export, ledger or invoice list (CSV or Excel). Columns are mapped for you.'],
  ['shield', '2', 'Review', 'See verified cash, a 13-week forecast, risk alerts and a health score. Every number is calculated, not guessed.'],
  ['check', '3', 'Decide', 'Compare what-ifs, match financing, and approve recommended actions. Nothing real happens: sandbox only.'],
];
const TILES = [
  ['trend', 'Cash flow forecast', 'Weekly projection with a confidence range and scenario simulator.', 'forecast'],
  ['shield', 'Risk intelligence', 'Early warnings, each with the evidence behind it.', 'risks'],
  ['heart', 'Financial health', 'A transparent 0–100 score with every component shown.', 'health'],
  ['bank', 'Financing options', 'Estimate your funding need and compare product types.', 'financing'],
  ['bot', 'AI copilot', 'Ask questions; answers cite your verified numbers.', 'copilot'],
  ['check', 'Actions & audit', 'Human-approved actions with a tamper-evident log.', 'actions'],
];

function welcomeView() {
  return html`<section class="welcome">
    <div class="welcome-hero card">
      <img src="/assets/logo-mark.png" alt="" width="64" height="74">
      <h1>Know your cash. See trouble coming. Decide with confidence.</h1>
      <p class="lede muted">FinSight AI turns your financial data into verified forecasts, risk alerts and clear next steps for your small business.</p>
      <div class="row center"><button class="btn primary big" data-action="goto" data-route="upload">${icon('upload', 18)}Upload your data</button>
        <button class="btn big" data-action="load-demo">${icon('spark', 18)}Try the demo business</button></div>
      <p class="fineprint">Takes about two minutes. Your transactions are analysed in your browser and never uploaded.</p>
    </div>
    <h2 class="section-h">How it works</h2>
    <div class="steps">${STEPS.map(([ic, n, t, d]) => html`<article class="card step"><span class="step-n">${n}</span><h3>${icon(ic, 18)}${t}</h3><p class="muted">${d}</p></article>`)}</div>
    <h2 class="section-h">What you'll get</h2>
    <div class="tiles">${TILES.map(([ic, t, d, r]) => html`<button class="card tile" data-action="goto" data-route="${r}"><span class="tile-ic">${icon(ic, 20)}</span><b>${t}</b><span class="muted small">${d}</span></button>`)}</div>
    <div class="trust card"><span>${icon('lock', 16)}Your data stays in your browser</span><span>${icon('shield', 16)}AI explains verified numbers and never invents them</span><span>${icon('check', 16)}Sandbox only: no real money moves</span></div>
  </section>`;
}

export function dashboardView() {
  const a = app.analysis;
  if (!a || a.empty) return welcomeView();
  const { metrics: m, forecast: f, health, risks } = a;
  const $ = (v) => money(v, cur());
  const lastNet = m.lastMonth ? `Last full month (${m.lastMonth.key}): ${signedMoney(m.lastMonth.net, cur())}` : '';
  const upcoming = f.available ? f.scheduled.filter((s) => s.amount < 0 && s.week <= 5).sort((x, y) => (x.date < y.date ? -1 : 1)).slice(0, 7) : [];
  return html`
    ${pageHeader(app.isDemo ? 'Harbor & Pine Roasters' : 'Your financial position', `As of ${shortDate(m.asOf)} · ${m.counts.settled} transactions from ${shortDate(m.period.first)}${app.isDemo ? ' · synthetic demo data' : ''}`)}
    <div class="grid-kpi">
      ${kpi({ label: 'Cash on hand', ic: 'bank', value: m.cash.available ? $(m.cash.value) : '', unavailable: m.cash.available ? '' : m.cash.reason, sub: m.cash.available ? (m.cash.source === 'statement_balance' ? 'From your running balance' : 'Opening balance assumption + transactions') : '', tone: m.cash.available && m.cash.value < 0 ? 'bad' : '' })}
      ${kpi({ label: 'Total inflows', ic: 'down', value: $(m.totals.inflow), sub: 'Whole period' })}
      ${kpi({ label: 'Total outflows', ic: 'upload', value: $(m.totals.outflow), sub: 'Whole period' })}
      ${kpi({ label: 'Net cash flow', ic: 'trend', value: signedMoney(m.totals.net, cur()), sub: lastNet, tone: m.totals.net < 0 ? 'bad' : '' })}
      ${kpi({ label: 'Cash runway', ic: 'clock', value: m.runway.available ? months(m.runway.value) : '', unavailable: m.runway.available ? '' : m.runway.reason, sub: m.burn.available && m.burn.value > 0 ? `Burning ${$(m.burn.value)}/month` : '', tone: m.runway.available && m.runway.value !== Infinity && m.runway.value < 3 ? 'bad' : '' })}
      ${kpi({ label: f.available ? `Projected cash, week ${f.horizonWeeks}` : 'Projected cash', ic: 'trend', value: f.available ? $(f.projectedClosing.value) : '', unavailable: f.available ? '' : f.reason, sub: f.available ? `Lowest ${$(f.minBalance.value)} in week ${f.minBalance.week}${f.relative ? ' (relative)' : ''}` : '', tone: f.available && f.minBalance.value < 0 ? 'bad' : '' })}
    </div>

    <div class="grid-main">
      <section class="card span-chart" aria-labelledby="co-h">
        <div class="card-head"><h2 id="co-h">${icon('trend', 18)}Cash outlook · next ${f.available ? f.horizonWeeks : 13} weeks</h2>
          ${f.available ? (f.firstShortfall ? html`<span class="badge sev-critical">${icon('alert', 14)}Shortfall in week ${f.firstShortfall.week}</span>` : f.firstAtRisk ? html`<span class="badge sev-medium">${icon('info', 14)}Downside risk in week ${f.firstAtRisk.week}</span>` : html`<span class="badge good">${icon('check', 14)}No shortfall projected</span>`) : ''}</div>
        ${f.available ? cashChart({ weeks: f.weeks, currency: cur() }) : html`<p class="muted">${f.reason}</p>`}
      </section>
      <div class="stack">
        ${aiCard()}
        <section class="card health-mini" aria-labelledby="hm-h">
          <div class="card-head"><h2 id="hm-h">${icon('heart', 18)}Financial health</h2><button class="link" data-action="goto" data-route="health">Details →</button></div>
          ${health.available ? html`<div class="health-row">${ring(health)}<ul class="mini-comps">${[...health.components].sort((x, y) => x.score - y.score).slice(0, 3).map((c) => html`<li><span>${c.label}</span><b>${c.score}</b></li>`)}<li class="muted small">Lowest-scoring areas</li></ul></div>` : html`<p class="muted">${health.reason}</p>`}
        </section>
      </div>
    </div>

    <div class="grid-3">
      <section class="card span-2" aria-labelledby="mc-h"><div class="card-head"><h2 id="mc-h">${icon('grid', 18)}Monthly cash flow</h2></div>${monthlyBars({ months: m.months, currency: cur() })}</section>
      ${risksCard(risks)}
    </div>

    <div class="grid-3">
      ${arApCard(m, $)}
      <section class="card" aria-labelledby="up-h">
        <div class="card-head"><h2 id="up-h">${icon('alert', 18)}Upcoming payments</h2><span class="muted small">next 5 weeks</span></div>
        ${upcoming.length ? html`<ul class="rows">${upcoming.map((s) => html`<li><span class="r-main"><b>${s.label}</b><small>${shortDate(s.date)} · ${s.kind === 'payable' ? 'supplier bill' : 'recurring'}</small></span><span class="neg num">${$(-s.amount)}</span></li>`)}</ul>` : html`<p class="muted">No scheduled payments in the next five weeks.</p>`}
      </section>
      <section class="card" aria-labelledby="ra-h">
        <div class="card-head"><h2 id="ra-h">${icon('doc', 18)}Recent activity</h2></div>
        <ul class="rows">${m.recent.slice(0, 8).map((t) => html`<li><span class="r-main"><b>${t.description || t.counterparty || 'Transaction'}</b><small>${shortDate(t.date)}${t.category ? ` · ${t.category}` : ''}</small></span><span class="num ${t.amount < 0 ? 'neg' : 'pos'}">${signedMoney(t.amount, cur())}</span></li>`)}</ul>
      </section>
    </div>
    <p class="fineprint">Figures are calculated from your file. Where an input was assumed (for example collection rates or payment terms) it is listed under Cash flow forecast → Assumptions.</p>`;
}
