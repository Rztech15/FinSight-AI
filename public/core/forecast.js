// Explainable weekly cash-flow forecast (deterministic — same input, same output).
//
// Method (all shown to the user in the Methodology page):
//  1. History is cut into 7-day buckets ending on the as-of date.
//  2. Recurring items (rent, payroll, subscriptions, quarterly tax …) are detected and scheduled on their dates.
//  3. Open invoices / bills are scheduled at their due dates, shifted by the observed payment lateness;
//     overdue receivables are collected later and only partially (age-based collection rates).
//  4. Remaining flows are projected at a robust, recency-weighted weekly run-rate.
//     When open invoices exist, invoice-linked flows use max(known schedule, run-rate) so that
//     the same invoice is never counted twice; the yet-to-be-invoiced gap on the inflow side ramps in
//     after one payment cycle.
//  5. An 80% range comes from the observed week-to-week volatility of net cash flow, widening with √weeks.
//  6. Scenarios re-run the same model with explicit adjustments.

import {
  addDays, diffDays, sum, round, clamp, winsorize, recencyMean, std, withDefaults,
} from './util.js';
import { detectRecurring } from './recurring.js';
import { inferTerms, inferLateness, ageBucket } from './metrics.js';

const Z80 = 1.2816;
export const MAX_HORIZON_WEEKS = 26;
const FIXED_COMMITMENT = /payroll|salary|salaries|wage|rent|lease|loan|mortgage|insurance|tax/i;

export const NO_ADJUSTMENTS = Object.freeze({
  revenueChangePct: 0, // applies to future (not yet invoiced) inflows
  expenseChangePct: 0, // applies to future variable outflows (fixed commitments excluded)
  collectionDelayDays: 0, // extra days customers take to pay
  payableDelayDays: 0, // extra days we take to pay suppliers
  overdueCollectionDays: null, // override: days until overdue receivables are collected
  collectionRateBoost: 0, // added to every collection rate (0.1 = +10 points)
  oneOffs: [], // [{week, amount (signed), label}]
  recurringAdds: [], // [{startWeek, everyWeeks, amount (signed), count?, label}]
});

export function prepareForecast(transactions, metrics, rawSettings = {}) {
  const s = withDefaults(rawSettings);
  if (metrics.empty) return { available: false, reason: metrics.reason };
  const asOf = metrics.asOf;
  const settled = transactions.filter((t) => t.status === 'settled' && t.date <= asOf);
  const open = transactions.filter((t) => t.status === 'open');
  const totalDays = diffDays(asOf, metrics.period.first) + 1;
  const nWeeks = Math.min(26, Math.floor(totalDays / 7));
  if (nWeeks < 6) {
    return { available: false, reason: `At least 6 weeks of history are needed to forecast; the file covers ${totalDays} days.` };
  }
  const histStart = addDays(asOf, -(nWeeks * 7) + 1);
  const bucket = (date) => Math.floor(diffDays(date, histStart) / 7);

  const recurring = detectRecurring(settled, asOf, MAX_HORIZON_WEEKS * 7);
  const recurringIds = new Set();
  recurring.forEach((g) => g.ids.forEach((id) => recurringIds.add(id)));

  const terms = inferTerms(open, s);
  const lateIn = inferLateness(settled, 1, s.receivableDelayDays);
  const lateOut = inferLateness(settled, -1, s.payableDelayDays);

  const linkedIn = settled.filter((t) => t.amount > 0 && t.dueDate && !recurringIds.has(t.id));
  const linkedOut = settled.filter((t) => t.amount < 0 && t.dueDate && !recurringIds.has(t.id));
  const modeIn = open.some((t) => t.amount > 0) && linkedIn.length >= 3;
  const modeOut = open.some((t) => t.amount < 0) && linkedOut.length >= 3;

  const series = () => new Array(nWeeks).fill(0);
  const directIn = series(); const directOut = series(); const invIn = series(); const invOut = series(); const net = series();
  for (const t of settled) {
    if (t.date < histStart) continue;
    const b = bucket(t.date);
    if (b < 0 || b >= nWeeks) continue;
    net[b] += t.amount;
    if (recurringIds.has(t.id)) continue;
    const linked = !!t.dueDate;
    if (t.amount > 0) (linked && modeIn ? invIn : directIn)[b] += t.amount;
    else (linked && modeOut ? invOut : directOut)[b] += -t.amount;
  }
  const window = Math.min(12, nWeeks);
  const baseline = (arr) => recencyMean(winsorize(arr.slice(-window)));
  const base = {
    directIn: baseline(directIn), directOut: baseline(directOut),
    invIn: modeIn ? baseline(invIn) : 0, invOut: modeOut ? baseline(invOut) : 0,
  };
  // uncertainty comes from the UNSCHEDULED streams only: recurring items are known in advance
  const resid = directIn.map((v, i) => v + invIn[i] - directOut[i] - invOut[i]);
  const sigma = std(winsorize(resid));

  const rank = (items, sign) => items
    .filter((t) => Math.sign(t.amount) === sign)
    .map((t) => {
      const due = t.dueDate || addDays(t.date, terms.days);
      const daysPastDue = diffDays(asOf, due);
      return { id: t.id, label: t.counterparty || t.description || t.reference || 'Invoice', reference: t.reference, due, daysPastDue, bucket: ageBucket(daysPastDue), amountAbs: Math.abs(t.amount) };
    });

  const cash = metrics.cash.available ? metrics.cash.value : 0;
  return {
    available: true, settings: s, asOf, nWeeks, histStart, startingBalance: cash, relative: !metrics.cash.available,
    cashSource: metrics.cash.available ? metrics.cash.source : 'unknown',
    recurring, receivables: rank(open, 1), payables: rank(open, -1), terms, lateIn, lateOut, modeIn, modeOut,
    base, sigma, history: { directIn, directOut, invIn, invOut, net, resid },
  };
}

const weekOf = (asOf, date) => Math.ceil(diffDays(date, asOf) / 7);

export function runForecast(prep, adjustments = {}) {
  if (!prep.available) return prep;
  const adj = { ...NO_ADJUSTMENTS, ...adjustments };
  const s = prep.settings;
  const H = clamp(Math.round(s.horizonWeeks), 4, MAX_HORIZON_WEEKS);
  const rev = 1 + (Number(adj.revenueChangePct) || 0) / 100;
  const exp = 1 + (Number(adj.expenseChangePct) || 0) / 100;
  const collDelay = Number(adj.collectionDelayDays) || 0;
  const payDelay = Number(adj.payableDelayDays) || 0;
  const overdueDays = adj.overdueCollectionDays ?? s.overdueCollectionDays;
  const boost = Number(adj.collectionRateBoost) || 0;

  const mk = () => new Array(H + 1).fill(0);
  const parts = {
    recurringIn: mk(), recurringOut: mk(), directIn: mk(), directOut: mk(),
    knownIn: mk(), knownOut: mk(), runIn: mk(), runOut: mk(), oneOff: mk(),
  };
  const scheduled = [];

  // recurring commitments
  for (const g of prep.recurring) {
    const fixed = FIXED_COMMITMENT.test(g.label);
    const factor = g.sign > 0 ? rev : fixed ? 1 : exp;
    for (const d of g.nextDates) {
      const w = weekOf(prep.asOf, d);
      if (w < 1 || w > H) continue;
      const amt = g.amount * factor;
      (g.sign > 0 ? parts.recurringIn : parts.recurringOut)[w] += Math.abs(amt);
      scheduled.push({ week: w, date: d, label: g.label, amount: round(amt), kind: 'recurring' });
    }
  }
  // open receivables
  for (const r of prep.receivables) {
    let expected;
    if (r.daysPastDue > 0) expected = addDays(prep.asOf, overdueDays + Math.max(0, collDelay));
    else expected = addDays(r.due, prep.lateIn.days + collDelay);
    if (diffDays(expected, prep.asOf) <= 0) expected = addDays(prep.asOf, 1);
    const w = weekOf(prep.asOf, expected);
    const rate = clamp(s.collectionRates[r.bucket] + boost, 0, 1);
    if (w < 1 || w > H) continue;
    const amt = r.amountAbs * rate;
    parts.knownIn[w] += amt;
    scheduled.push({ week: w, date: expected, label: r.label, reference: r.reference, amount: round(amt), kind: 'receivable', collectionRate: rate, overdueDays: Math.max(0, r.daysPastDue) });
  }
  // open payables
  for (const p of prep.payables) {
    let expected;
    if (p.daysPastDue > 0) expected = addDays(prep.asOf, s.overduePayDays + Math.max(0, payDelay));
    else expected = addDays(p.due, prep.lateOut.days + payDelay);
    if (diffDays(expected, prep.asOf) <= 0) expected = addDays(prep.asOf, 1);
    const w = weekOf(prep.asOf, expected);
    if (w < 1 || w > H) continue;
    parts.knownOut[w] += p.amountAbs;
    scheduled.push({ week: w, date: expected, label: p.label, reference: p.reference, amount: -round(p.amountAbs), kind: 'payable' });
  }
  // run-rate flows
  const cycleWeeks = Math.max(1, Math.ceil((prep.terms.days + prep.lateIn.days + Math.max(0, collDelay)) / 7));
  for (let w = 1; w <= H; w++) {
    parts.directIn[w] = prep.base.directIn * rev;
    parts.directOut[w] = prep.base.directOut * exp;
    if (prep.modeIn) {
      const run = prep.base.invIn * rev;
      const gap = Math.max(0, run - parts.knownIn[w]);
      parts.runIn[w] = gap * clamp((w - 1) / cycleWeeks, 0, 1);
    }
    if (prep.modeOut) {
      const run = prep.base.invOut * exp;
      parts.runOut[w] = Math.max(0, run - parts.knownOut[w]);
    }
  }
  // scenario one-offs and repeating items
  for (const o of adj.oneOffs || []) {
    const w = Math.round(o.week);
    if (w >= 1 && w <= H) {
      parts.oneOff[w] += o.amount;
      scheduled.push({ week: w, date: addDays(prep.asOf, w * 7), label: o.label || 'One-off item', amount: round(o.amount), kind: 'scenario' });
    }
  }
  for (const r of adj.recurringAdds || []) {
    let n = 0;
    for (let w = Math.round(r.startWeek); w <= H; w += Math.max(1, Math.round(r.everyWeeks || 1))) {
      if (w >= 1) parts.oneOff[w] += r.amount;
      if (r.count && ++n >= r.count) break;
    }
  }

  const weeks = [];
  let bal = prep.startingBalance;
  weeks.push({ week: 0, start: prep.asOf, end: prep.asOf, inflow: 0, outflow: 0, net: 0, closing: round(bal), low: round(bal), high: round(bal) });
  for (let w = 1; w <= H; w++) {
    const inflow = parts.recurringIn[w] + parts.directIn[w] + parts.knownIn[w] + parts.runIn[w] + Math.max(0, parts.oneOff[w]);
    const outflow = parts.recurringOut[w] + parts.directOut[w] + parts.knownOut[w] + parts.runOut[w] + Math.max(0, -parts.oneOff[w]);
    bal += inflow - outflow;
    const sd = prep.sigma * Math.sqrt(w);
    weeks.push({
      week: w, start: addDays(prep.asOf, (w - 1) * 7 + 1), end: addDays(prep.asOf, w * 7),
      inflow: round(inflow), outflow: round(outflow), net: round(inflow - outflow), closing: round(bal),
      low: round(bal - Z80 * sd), high: round(bal + Z80 * sd),
      parts: {
        recurringIn: round(parts.recurringIn[w]), recurringOut: round(parts.recurringOut[w]),
        directIn: round(parts.directIn[w]), directOut: round(parts.directOut[w]),
        invoicedIn: round(parts.knownIn[w] + parts.runIn[w]), invoicedOut: round(parts.knownOut[w] + parts.runOut[w]),
        scenario: round(parts.oneOff[w]),
      },
    });
  }
  const proj = weeks.slice(1);
  const minWeek = proj.reduce((a, b) => (b.closing < a.closing ? b : a), proj[0]);
  const buffer = s.minimumCashBuffer || 0;
  const firstShort = proj.find((w) => w.closing < 0);
  const firstRisk = proj.find((w) => w.low < 0);
  const firstBuffer = buffer > 0 ? proj.find((w) => w.closing < buffer) : null;
  const pick = (w) => (w ? { week: w.week, date: w.end, balance: w.closing, low: w.low } : null);
  return {
    available: true, horizonWeeks: H, asOf: prep.asOf, startingBalance: round(prep.startingBalance), relative: prep.relative,
    weeks, projectedClosing: { value: weeks[H].closing, low: weeks[H].low, high: weeks[H].high },
    minBalance: { value: minWeek.closing, week: minWeek.week, date: minWeek.end },
    firstShortfall: pick(firstShort), firstAtRisk: pick(firstRisk), firstBelowBuffer: pick(firstBuffer),
    totals: { inflow: round(sum(proj.map((w) => w.inflow))), outflow: round(sum(proj.map((w) => w.outflow))) },
    scheduled: scheduled.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    assumptions: describeAssumptions(prep, adj, s),
    recurring: prep.recurring,
    sigma: round(prep.sigma),
  };
}

function describeAssumptions(prep, adj, s) {
  const list = [
    { key: 'history', text: `Run-rates use the last ${Math.min(12, prep.nWeeks)} weeks (recency-weighted, outliers capped).` },
    { key: 'terms', text: `Payment terms ${prep.terms.days} days (${prep.terms.source}).` },
    { key: 'lateIn', text: `Customers pay ${prep.lateIn.days} days after the due date on average (${prep.lateIn.source}).` },
    { key: 'lateOut', text: `Suppliers are paid ${prep.lateOut.days} days after the due date on average (${prep.lateOut.source}).` },
    { key: 'rates', text: `Collection rates by age: current ${Math.round(s.collectionRates.current * 100)}%, 1–30 days late ${Math.round(s.collectionRates.d1_30 * 100)}%, 31–60 ${Math.round(s.collectionRates.d31_60 * 100)}%, 61+ ${Math.round(s.collectionRates.d61plus * 100)}% (configurable assumptions).` },
    { key: 'overdue', text: `Overdue receivables are expected ${adj.overdueCollectionDays ?? s.overdueCollectionDays} days after the as-of date.` },
    { key: 'range', text: 'The shaded range is an 80% statistical range from historical weekly variability. It is not a guarantee.' },
  ];
  if (prep.relative) list.unshift({ key: 'relative', text: 'Opening balance unknown: balances shown are relative to the starting point (0), not actual cash.' });
  if (prep.recurring.length) list.push({ key: 'recurring', text: `${prep.recurring.length} recurring item(s) were detected and scheduled on their expected dates.` });
  return list;
}

export function runAll(transactions, metrics, settings, adjustments) {
  return runForecast(prepareForecast(transactions, metrics, settings), adjustments);
}
