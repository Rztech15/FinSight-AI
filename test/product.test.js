import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSample } from './helpers.mjs';
import { analyze } from '../public/core/pipeline.js';
import { runForecast } from '../public/core/forecast.js';
import { pmt, matchFinancing, estimateNeed, FINANCING_CATALOG } from '../public/core/financing.js';
import { mergeAdjustments, compareForecasts, SCENARIO_TEMPLATES, templateDefaults } from '../public/core/scenarios.js';
import { measureResults, describeImpact } from '../public/core/actions.js';
import { buildEvidence, validateNarrative, deterministicNarrative, answerFromEvidence } from '../public/core/evidence.js';
import { appendEntry, verifyChain, exportLog } from '../public/core/audit.js';

const sample = loadSample();
const a = analyze(sample.transactions, {}, sample.stats);
const near = (x, y, eps = 0.01) => assert.ok(Math.abs(x - y) <= eps, `${x} !~ ${y}`);

test('sample: the synthetic demo tells the intended, verifiable story', () => {
  assert.equal(a.metrics.counts.settled, 896);
  assert.equal(a.metrics.counts.open, 18);
  assert.equal(a.metrics.asOf, '2026-10-14');
  near(a.metrics.cash.value, 27338.6);
  assert.equal(a.metrics.cash.source, 'statement_balance');
  assert.equal(a.forecast.firstShortfall.week, 7);
  const codes = a.risks.map((r) => r.code);
  for (const c of ['cash_shortage', 'overdue_receivables', 'possible_duplicate', 'expense_spike', 'customer_concentration', 'payables_pressure']) {
    assert.ok(codes.includes(c), `risk ${c} detected`);
  }
  assert.equal(a.risks[0].code, 'cash_shortage');
  assert.equal(a.risks[0].severity, 'critical');
  assert.ok(a.health.score < 55);
  const names = a.forecast.recurring.map((g) => g.label);
  for (const n of ['Payroll', 'Harbor Property Group', 'State Revenue Dept']) assert.ok(names.includes(n), `${n} recurring`);
});
test('sample: pipeline is deterministic', () => {
  const b = analyze(loadSample().transactions, {}, sample.stats);
  assert.deepEqual(b.forecast.weeks, a.forecast.weeks);
  assert.deepEqual(b.actions.map((x) => x.id), a.actions.map((x) => x.id));
});

test('financing: amortising payment matches the textbook formula', () => {
  near(pmt(10000, 0.12, 12), 888.49, 0.01);
  near(pmt(1200, 0, 12), 100);
});
test('financing: need, eligibility reasons and simulations are grounded in the data', () => {
  const f = a.financing;
  assert.equal(f.need.standby, false);
  assert.equal(f.need.week, 7);
  assert.ok(f.need.amount >= 15000 && f.need.amount % 500 === 0);
  const term = f.options.find((o) => o.product.id === 'term_loan');
  assert.equal(term.eligible, false);
  assert.ok(term.reasons.some((r) => /24\+ months/.test(r)));
  assert.ok(term.reasons.some((r) => /positive operating margin/.test(r)));
  assert.equal(term.score, 0);
  for (const o of f.options.filter((x) => x.eligible)) {
    assert.ok(o.suggestedAmount <= o.maxAmount);
    assert.ok(o.cost.high >= o.cost.low && o.cost.low >= 0);
    assert.ok(o.simulation.oneOffs.length >= 1);
  }
  assert.deepEqual(f.options.map((o) => o.rank), [1, 2, 3, 4, 5]);
  assert.ok(f.options[0].eligible);
  assert.match(f.disclaimer, /Not an offer/);
});
test('financing: no shortfall → standby mode, no pretend need', () => {
  const rich = analyze(sample.transactions, { openingBalance: undefined, minimumCashBuffer: 0 }, sample.stats);
  const forecast = runForecast(rich.prep, { oneOffs: [{ week: 1, amount: 200000 }] });
  const need = estimateNeed(rich.metrics, forecast);
  assert.equal(need.standby, true);
  assert.equal(need.amount, 0);
  const m = matchFinancing(rich.metrics, forecast);
  assert.equal(m.need.standby, true);
  assert.equal(FINANCING_CATALOG.length, 5);
});

test('scenarios: templates compile to adjustments; merge sums and caps; comparison explains the change', () => {
  for (const t of SCENARIO_TEMPLATES) {
    const adj = t.build(templateDefaults(t));
    assert.ok(adj && typeof adj === 'object', t.id);
  }
  const m = mergeAdjustments([{ revenueChangePct: -10, collectionDelayDays: 5 }, { revenueChangePct: -5, collectionRateBoost: 0.2 }, { collectionRateBoost: 0.2, overdueCollectionDays: 9 }, { overdueCollectionDays: 4 }]);
  assert.equal(m.revenueChangePct, -15);
  assert.equal(m.collectionDelayDays, 5);
  assert.equal(m.collectionRateBoost, 0.25);
  assert.equal(m.overdueCollectionDays, 4);
  const cut = runForecast(a.prep, { expenseChangePct: -10 });
  const cmp = compareForecasts(a.forecast, cut);
  assert.match(cmp.verdict, /Resolves the projected shortfall in week 7/);
  assert.ok(cmp.minDelta > 0);
  const late = compareForecasts(a.forecast, runForecast(a.prep, { collectionDelayDays: 30 }));
  assert.ok(late.minDelta < 0 && late.scenario.weeksBelowZero >= late.base.weeksBelowZero);
});

test('actions: every action needs approval, is simulated, starts proposed, and its impact is calculated', () => {
  assert.ok(a.actions.length >= 5);
  for (const x of a.actions) {
    assert.equal(x.requiresApproval, true);
    assert.equal(x.simulated, true);
    assert.equal(x.state, 'proposed');
    assert.match(x.id, /^act_[a-z_]+_[0-9a-f]{8}$/);
    assert.ok(x.draft && x.draft.body);
    if (x.effect) assert.ok(x.impact && Number.isFinite(x.impact.minDelta), `${x.code} impact is computed`);
    else assert.equal(x.impact, null);
    assert.match(x.sandboxResult, /sandbox|Nothing was sent|recorded|logged|prepared/i);
  }
  const codes = a.actions.map((x) => x.code);
  assert.ok(codes.includes('collect_overdue') && codes.includes('cut_spend') && codes.includes('delay_payables'));
  assert.match(describeImpact(null), /No cash effect/);
});
test('actions: measurable results appear only after human approval and (simulated) execution', () => {
  assert.equal(measureResults(a.prep, a.forecast, a.actions), null);
  const executed = a.actions.map((x) => (x.code === 'cut_spend' || x.code === 'collect_overdue' ? { ...x, state: 'executed' } : x));
  const r = measureResults(a.prep, a.forecast, executed);
  assert.equal(r.count, 2);
  assert.ok(r.minDelta > 0 && r.closingDelta > 0);
  assert.equal(r.before.shortfallWeek, 7);
  const approvedOnly = a.actions.map((x) => ({ ...x, state: 'approved' }));
  assert.equal(measureResults(a.prep, a.forecast, approvedOnly), null, 'approval alone claims no result');
});

test('evidence: raw transactions never appear; names are withheld unless opted in', () => {
  const ev = buildEvidence(a);
  const blob = JSON.stringify(ev);
  assert.ok(ev.length <= 80 && ev.every((e) => /^E\d+$/.test(e.id)));
  assert.ok(!blob.includes('Brightside'), 'customer name withheld');
  assert.ok(!blob.includes('Origin Direct'), 'supplier name withheld');
  assert.ok(!blob.includes('Card settlement'), 'no transaction descriptions');
  assert.ok(!blob.includes('INV-10'), 'no invoice references');
  const open = JSON.stringify(buildEvidence(a, { withholdNames: false }));
  assert.ok(open.includes('Brightside'));
});
test('grounding guard: traces every figure to evidence and rejects the rest', () => {
  const ev = buildEvidence(a);
  const ok = { summary: 'Cash on hand is $27,339 [E2], about 27k, and the runway is 4.3 months [E10].', points: [{ text: 'Projected shortfall in week 7 [E18].', evidence: ['E18'] }] };
  assert.equal(validateNarrative(ok, ev).ok, true);
  const invented = validateNarrative({ summary: 'Cash will reach $99,999 next month [E2].', points: [] }, ev);
  assert.equal(invented.ok, false);
  assert.ok(invented.violations.some((v) => v.token.includes('99,999')));
  assert.equal(validateNarrative({ summary: 'See [E99].', points: [] }, ev).unknownIds[0], 'E99');
  assert.equal(validateNarrative({ summary: 'Margin is 55%.', points: [] }, ev).ok, false);
  assert.equal(validateNarrative({ summary: 'In 2026 there were 3 risks.', points: [] }, ev).ok, true, 'years and small counts are allowed');
});
test('deterministic narrative and offline Q&A always pass the guard and cite evidence', () => {
  const ev = buildEvidence(a);
  const n = deterministicNarrative(ev);
  assert.equal(validateNarrative(n, ev).ok, true);
  assert.ok(n.points.length >= 4 && n.points.every((p) => p.evidence.length));
  for (const q of ['How long will my cash last?', 'Will I run out of cash?', 'Who owes me money?', 'What are the risks?', 'What should I do next?', 'What is my margin?']) {
    const r = answerFromEvidence(q, ev);
    assert.ok(r.evidence.length > 0, q);
    assert.equal(validateNarrative({ summary: r.answer, points: [] }, ev).ok, true, q);
  }
  assert.equal(answerFromEvidence('tell me a joke', ev).evidence.length, 0);
});

test('audit log: hash chain verifies, and any tampering is detected', async () => {
  let log = [];
  const t = (n) => () => `2026-10-17T10:00:0${n}Z`;
  log = await appendEntry(log, { actor: 'owner', event: 'action.approved', details: { id: 'a1' } }, t(1));
  log = await appendEntry(log, { actor: 'owner', event: 'action.executed', details: { id: 'a1', mode: 'SANDBOX' } }, t(2));
  log = await appendEntry(log, { actor: 'owner', event: 'action.rejected', details: { id: 'a2' } }, t(3));
  assert.deepEqual(await verifyChain(log), { ok: true, length: 3 });
  const edited = structuredClone(log); edited[1].details.mode = 'LIVE';
  assert.equal((await verifyChain(edited)).brokenAt, 2);
  const deleted = [log[0], log[2]];
  assert.equal((await verifyChain(deleted)).ok, false);
  const reordered = [log[1], log[0], log[2]];
  assert.equal((await verifyChain(reordered)).ok, false);
  const exp = JSON.parse(exportLog(log));
  assert.match(exp.mode, /SANDBOX/);
  assert.equal(exp.entries.length, 3);
});
