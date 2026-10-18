import test from 'node:test';
import assert from 'node:assert/strict';
import { build, steadyRows, countFirsts } from './helpers.mjs';
import { computeMetrics } from '../public/core/metrics.js';
import { prepareForecast, runForecast } from '../public/core/forecast.js';
import { computeHealth } from '../public/core/health.js';
import { detectRisks } from '../public/core/risk.js';
import { addDays } from '../public/core/util.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

const MINI = [
  { date: '2026-01-05', amount: 1000, category: 'Sales', counterparty: 'A' },
  { date: '2026-01-20', amount: -400, category: 'Rent' },
  { date: '2026-02-03', amount: 2000, category: 'Sales', counterparty: 'A' },
  { date: '2026-02-10', amount: -500, category: 'Supplies' },
  { date: '2026-03-02', amount: 1500, category: 'Sales', counterparty: 'A' },
  { date: '2026-03-15', amount: -700, category: 'Supplies' },
  { date: '2026-04-02', amount: 500, category: 'Sales' },
];

test('metrics: hand-checked totals, cash (opening-balance assumption), revenue, expenses, margin, runway', () => {
  const { transactions } = build(MINI);
  const m = computeMetrics(transactions, { openingBalance: 1000 });
  assert.equal(m.asOf, '2026-04-02');
  assert.equal(m.totals.inflow, 5000);
  assert.equal(m.totals.outflow, 1600);
  assert.equal(m.totals.net, 3400);
  assert.equal(m.cash.value, 4400);
  assert.equal(m.cash.source, 'opening_balance_assumption');
  assert.deepEqual(m.completeMonths, ['2026-01', '2026-02', '2026-03']);
  near(m.revenue.value, 1500);
  near(m.expenses.value, 533.33);
  near(m.margin.value, 0.6444, 0.001);
  assert.equal(m.runway.value, Infinity); // net positive, not burning cash
  assert.equal(m.burn.value, 0);
});
test('metrics: finite runway when burning cash', () => {
  const rows = [];
  for (const mo of ['2026-01', '2026-02', '2026-03']) {
    rows.push({ date: `${mo}-05`, amount: 1000, category: 'Sales' }, { date: `${mo}-20`, amount: -2000, category: 'Costs' });
  }
  rows.push({ date: '2026-04-02', amount: 1, category: 'Sales' });
  const m = computeMetrics(build(rows).transactions, { openingBalance: 5000 });
  assert.equal(m.cash.value, 2001);
  near(m.runway.value, 2.001, 0.001);
  assert.equal(m.burn.value, 1000);
});
test('metrics: unavailable states carry a reason instead of a fabricated zero', () => {
  const m = computeMetrics(build(MINI).transactions, {});
  assert.equal(m.cash.available, false);
  assert.match(m.cash.reason, /opening balance/i);
  assert.equal(m.runway.available, false);
  const short = computeMetrics(build(MINI.slice(0, 2)).transactions, { openingBalance: 0 });
  assert.equal(short.revenue.available, false);
  assert.equal(short.burn.available, false);
  assert.equal(computeMetrics([], {}).empty, true);
});
test('metrics: running-balance column wins; multiple accounts are summed', () => {
  const rows = [
    { date: '2026-01-05', amount: 100, balance: 1100, account: 'A' },
    { date: '2026-01-06', amount: 50, balance: 550, account: 'B' },
    { date: '2026-01-07', amount: -20, balance: 1080, account: 'A' },
  ];
  const m = computeMetrics(build(rows).transactions, { openingBalance: 99999 });
  assert.equal(m.cash.source, 'statement_balance');
  assert.equal(m.cash.value, 1080 + 550);
});
test('metrics: receivable ageing buckets and overdue share', () => {
  const rows = [
    ...steadyRows({ start: '2026-05-01', end: '2026-06-30' }),
    { date: '2026-06-01', amount: 1000, status: 'Unpaid', dueDate: '2026-06-20', counterparty: 'X' },
    { date: '2026-06-15', amount: 500, status: 'Unpaid', dueDate: '2026-07-10', counterparty: 'Y' },
    { date: '2026-03-01', amount: 300, status: 'Unpaid', dueDate: '2026-04-20', counterparty: 'Z' },
    { date: '2026-06-10', amount: -800, status: 'Unpaid', dueDate: '2026-07-05', counterparty: 'S' },
  ];
  const m = computeMetrics(build(rows).transactions, { openingBalance: 0 });
  assert.equal(m.receivables.total, 1800);
  assert.equal(m.receivables.overdue, 1300);
  assert.deepEqual(m.receivables.buckets, { current: 500, d1_30: 1000, d31_60: 0, d61plus: 300 });
  near(m.receivables.overdueShare, 1300 / 1800, 1e-9);
  assert.equal(m.payables.total, 800);
  assert.equal(m.cash.value, computeMetrics(build(steadyRows({ start: '2026-05-01', end: '2026-06-30' })).transactions, { openingBalance: 0 }).cash.value, 'open invoices are not cash');
});

// ---------------------------------------------------------------- forecast
const steady = () => build(steadyRows()).transactions;
const prepSteady = (settings = { openingBalance: 10000 }) => {
  const t = steady();
  const m = computeMetrics(t, settings);
  return { t, m, prep: prepareForecast(t, m, settings) };
};

test('forecast: recurring items are detected with cadence', () => {
  const { prep } = prepSteady();
  const byLabel = Object.fromEntries(prep.recurring.map((g) => [g.label, g]));
  assert.equal(byLabel['Weekly sales'].cadence, 'weekly');
  assert.equal(byLabel['Weekly supplies'].cadence, 'weekly');
  assert.equal(byLabel.Rent.cadence, 'monthly');
  assert.equal(byLabel.Rent.amount, -2000);
});
test('forecast: steady business projects exactly start + 13 × weekly net − rent', () => {
  const { prep, m } = prepSteady();
  const f = runForecast(prep);
  assert.equal(f.available, true);
  const expected = m.cash.value + 13 * 400 - 2000 * countFirsts(m.asOf, 13);
  near(f.projectedClosing.value, expected);
  assert.equal(f.weeks.length, 14);
  assert.equal(f.firstShortfall, null);
});
test('forecast: deterministic and the uncertainty band is ordered and widens', () => {
  const { prep } = prepSteady();
  const a = runForecast(prep);
  const b = runForecast(prep);
  assert.deepEqual(a, b);
  for (const w of a.weeks) assert.ok(w.low <= w.closing && w.closing <= w.high);
  const width = (w) => w.high - w.low;
  for (let i = 2; i < a.weeks.length; i++) assert.ok(width(a.weeks[i]) >= width(a.weeks[i - 1]) - 1e-6);
});
test('forecast: too little history is reported as unavailable with a reason', () => {
  const t = build(steadyRows({ start: '2026-06-01', end: '2026-06-30' })).transactions;
  const m = computeMetrics(t, { openingBalance: 0 });
  const prep = prepareForecast(t, m, {});
  assert.equal(prep.available, false);
  assert.match(prep.reason, /6 weeks/);
});
test('forecast: relative mode when opening balance is unknown', () => {
  const t = steady();
  const m = computeMetrics(t, {});
  const f = runForecast(prepareForecast(t, m, {}));
  assert.equal(f.relative, true);
  assert.equal(f.startingBalance, 0);
  assert.ok(f.assumptions.some((a) => a.key === 'relative'));
});

function invoiceDataset() {
  const rows = [];
  for (let w = 0; w < 14; w++) {
    const paid = addDays('2026-03-02', w * 7);
    rows.push({ date: paid, amount: 1000, counterparty: 'Cust', reference: `I${w}`, dueDate: paid, status: 'Paid', description: `Receipt ${w}` });
  }
  rows.push({ date: '2026-06-01', amount: -300, category: 'Costs', description: 'Misc cost' });
  const lastPaid = addDays('2026-03-02', 13 * 7);
  rows.push({ date: addDays(lastPaid, -20), amount: 1000, counterparty: 'Cust', reference: 'OPEN1', dueDate: addDays(lastPaid, 9), status: 'Unpaid', description: 'Invoice OPEN1' });
  return build(rows).transactions;
}
test('forecast: open invoices are scheduled once — no double counting with the invoiced run-rate', () => {
  const t = invoiceDataset();
  const settings = { openingBalance: 0 };
  const m = computeMetrics(t, settings);
  const prep = prepareForecast(t, m, settings);
  assert.equal(prep.modeIn, true);
  const f = runForecast(prep);
  const known = f.scheduled.find((s) => s.kind === 'receivable');
  assert.ok(known, 'open invoice is scheduled');
  assert.equal(known.amount, 970); // 97% collection rate for a not-yet-due invoice
  const wk = f.weeks[known.week];
  assert.ok(wk.parts.invoicedIn < 1100, `week ${known.week} invoiced inflow ${wk.parts.invoicedIn} should be ~one invoice, not two`);
});
test('forecast: scenario adjustments move cash in the expected direction', () => {
  const t = invoiceDataset();
  const settings = { openingBalance: 5000 };
  const m = computeMetrics(t, settings);
  const prep = prepareForecast(t, m, settings);
  const base = runForecast(prep);
  const late = runForecast(prep, { collectionDelayDays: 14 });
  const baseWeek = base.scheduled.find((s) => s.kind === 'receivable').week;
  const lateWeek = late.scheduled.find((s) => s.kind === 'receivable').week;
  assert.equal(lateWeek, baseWeek + 2);
  assert.ok(runForecast(prep, { revenueChangePct: -20 }).projectedClosing.value < base.projectedClosing.value);
  assert.ok(runForecast(prep, { oneOffs: [{ week: 2, amount: 4000 }] }).weeks[2].closing >= base.weeks[2].closing + 3999);
  const hire = runForecast(prep, { recurringAdds: [{ startWeek: 1, everyWeeks: 4, amount: -1000 }] });
  near(base.projectedClosing.value - hire.projectedClosing.value, 4000); // weeks 1,5,9,13
});

// ---------------------------------------------------------------- health + risk
const healthy = () => build(steadyRows({ sales: 2000 })).transactions;
test('health: healthy steady business scores well; missing components are excluded, not zeroed', () => {
  const t = healthy();
  const m = computeMetrics(t, { openingBalance: 200000 });
  const f = runForecast(prepareForecast(t, m, { openingBalance: 200000 }));
  const h = computeHealth(m, f);
  assert.ok(h.score >= 75, `score ${h.score}`);
  const keys = h.components.map((c) => c.key);
  assert.ok(!keys.includes('receivables') && !keys.includes('concentration'));
  assert.ok(h.coverage < 1);
  assert.equal(computeHealth({ empty: true, reason: 'x' }).available, false);
});
test('risk: a healthy business raises no critical or high alerts', () => {
  const t = healthy();
  const settings = { openingBalance: 200000 };
  const m = computeMetrics(t, settings);
  const prep = prepareForecast(t, m, settings);
  const risks = detectRisks({ transactions: t, metrics: m, prep, forecast: runForecast(prep) });
  assert.deepEqual(risks.filter((r) => ['critical', 'high'].includes(r.severity)), []);
});
test('risk: shortfall, overdue receivables and duplicate payment are detected with evidence', () => {
  const rows = [
    ...steadyRows({ supplies: 900 }),
    { date: '2026-06-10', amount: -2140, counterparty: 'PackRight', reference: 'PR-1', description: 'Payment sent PR-1' },
    { date: '2026-06-12', amount: -2140, counterparty: 'PackRight', reference: 'PR-1', description: 'Payment sent PR-1' },
    { date: '2026-05-01', amount: 4000, status: 'Overdue', dueDate: '2026-05-20', counterparty: 'Slow Co', reference: 'S1', category: 'Sales' },
    { date: '2026-05-20', amount: 3000, status: 'Overdue', dueDate: '2026-06-01', counterparty: 'Slow Co', reference: 'S2', category: 'Sales' },
  ];
  const t = build(rows).transactions;
  const settings = { openingBalance: 3000 };
  const m = computeMetrics(t, settings);
  const prep = prepareForecast(t, m, settings);
  const f = runForecast(prep);
  const risks = detectRisks({ transactions: t, metrics: m, prep, forecast: f });
  const codes = risks.map((r) => r.code);
  assert.ok(codes.includes('possible_duplicate'));
  assert.ok(codes.includes('overdue_receivables'));
  assert.ok(codes.includes('cash_shortage') || codes.includes('cash_downside') || codes.includes('declining_cashflow'));
  for (const r of risks) {
    assert.ok(r.evidence.length > 0 || r.code === 'data_quality', `${r.code} has evidence`);
    assert.ok(['critical', 'high', 'medium', 'low'].includes(r.severity));
  }
  const dup = risks.find((r) => r.code === 'possible_duplicate');
  assert.equal(dup.meta.amount, 2140);
  assert.deepEqual(risks.map((r) => r.severity), [...risks.map((r) => r.severity)].sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a] - { critical: 0, high: 1, medium: 2, low: 3 }[b])));
});
