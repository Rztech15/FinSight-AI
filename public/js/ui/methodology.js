import { html } from '../dom.js';
import { pageHeader } from './common.js';

export function methodologyView() {
  return html`${pageHeader('How FinSight works', 'What is calculated, what the AI does, and what is deliberately not done.')}
    <div class="grid-2 prose">
      <section class="card"><h2>1 · Verified numbers first</h2><p>Cash, runway, margin, receivables, the 13-week forecast, the health score and every risk alert are computed by deterministic code in your browser. The same inputs always give the same outputs, and the tests check this.</p></section>
      <section class="card"><h2>2 · Forecast method</h2><p>History is grouped into weeks. Recurring payments (weekly to quarterly) are detected and scheduled; open invoices land on their due date plus the lateness observed in your paid invoices, with age-based collection rates. Other flows use a recency-weighted run-rate. Invoice-linked flows are never counted twice. The shaded band is an 80% range.</p></section>
      <section class="card"><h2>3 · What the AI may do</h2><p>The AI receives only a numbered list of aggregated facts (E1, E2…). It explains them and cites them. Every figure in its reply is checked against the facts it cites; if one cannot be traced, the reply is discarded and a rules-based summary is shown instead.</p></section>
      <section class="card"><h2>4 · Human-approved, simulated actions</h2><p>Each recommendation shows a calculated effect. Nothing happens until you approve it, and “running” it only records a sandbox result and updates the model. No money moves, no messages are sent, no lender is contacted. Every decision goes into a hash-chained audit log.</p></section>
      <section class="card"><h2>5 · Financing options</h2><p>Five illustrative product types are matched against your need, history, revenue and receivables. Costs use editable assumptions. This is not an offer, credit advice or a lender integration.</p></section>
      <section class="card"><h2>6 · Limits</h2><ul class="plain"><li>Forecast quality depends on how much history you upload.</li><li>Column mapping is automatic but should be checked.</li><li>Decision support only — not financial, legal or tax advice.</li><li>This is a competition MVP, not a regulated financial product.</li></ul></section>
    </div>`;
}
