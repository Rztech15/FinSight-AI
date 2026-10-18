// Evidence bundle + grounding guard.
//
// The AI layer NEVER sees raw transactions. It receives a short list of verified facts
// ("evidence", ids E1…En) computed by the deterministic engines, and may only interpret them.
// Every number it writes is checked against that evidence before it is shown (validateNarrative);
// if anything cannot be traced, the app falls back to a deterministic narrative built from the
// same facts. Counterparty names are replaced with neutral labels unless the user opts in.

import { money, pct, shortDate, months } from './format.js';
import { describeImpact } from './actions.js';

export const MAX_EVIDENCE = 80;

function anonymizer(ctx) {
  const names = new Map();
  const add = (name, role) => {
    if (!name || name.length < 3 || names.has(name)) return;
    const n = [...names.values()].filter((v) => v.startsWith(role)).length + 1;
    names.set(name, `${role} ${n}`);
  };
  const { metrics } = ctx;
  if (metrics.customers?.available) metrics.customers.value.forEach((c) => add(c.name, 'Customer'));
  metrics.receivables?.items.forEach((i) => add(i.counterparty, 'Customer'));
  metrics.payables?.items.forEach((i) => add(i.counterparty, 'Supplier'));
  ctx.forecast?.recurring?.forEach((g) => add(g.label, g.sign > 0 ? 'Customer' : 'Payee'));
  const sorted = [...names.entries()].sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    let out = String(text ?? '');
    for (const [name, alias] of sorted) out = out.split(name).join(alias);
    return out;
  };
}

export function buildEvidence(ctx, { withholdNames = true } = {}) {
  const { metrics, forecast, health, risks = [], actions = [], financing } = ctx;
  const cur = metrics.settings.currency;
  const m$ = (v) => money(v, cur);
  const anon = withholdNames ? anonymizer(ctx) : (t) => String(t ?? '');
  const items = [];
  const add = (key, label, text, value, short) => {
    if (items.length >= MAX_EVIDENCE) return;
    items.push({
      id: `E${items.length + 1}`, key, label, text: String(text).slice(0, 260),
      ...(short ? { short: String(short).slice(0, 140) } : {}), ...(Number.isFinite(value) ? { value } : {}),
    });
  };

  add('period', 'Data period', `${shortDate(metrics.period.first)} to ${shortDate(metrics.period.last)} (${metrics.period.days} days, ${metrics.counts.settled} settled transactions)`);
  if (metrics.cash.available) add('cash', 'Cash on hand', m$(metrics.cash.value), metrics.cash.value);
  add('inflow', 'Total inflows (whole period)', m$(metrics.totals.inflow), metrics.totals.inflow);
  add('outflow', 'Total outflows (whole period)', m$(metrics.totals.outflow), metrics.totals.outflow);
  add('net', 'Net cash flow (whole period)', m$(metrics.totals.net), metrics.totals.net);
  if (metrics.revenue.available) add('revenue', 'Average monthly operating revenue', `${m$(metrics.revenue.value)} (last ${metrics.revenue.monthsUsed} complete months)`, metrics.revenue.value);
  if (metrics.expenses.available) add('expenses', 'Average monthly operating expenses', `${m$(metrics.expenses.value)} (last ${metrics.expenses.monthsUsed} complete months)`, metrics.expenses.value);
  if (metrics.margin.available) add('margin', 'Operating margin', pct(metrics.margin.value, 1), metrics.margin.value * 100);
  if (metrics.burn.available) add('burn', 'Average monthly net cash flow', `${m$(metrics.burn.avgMonthlyNet)} (last ${metrics.burn.monthsUsed} complete months)`, metrics.burn.avgMonthlyNet);
  if (metrics.runway.available) add('runway', 'Cash runway', months(metrics.runway.value), Number.isFinite(metrics.runway.value) ? metrics.runway.value : undefined);
  if (metrics.receivables) {
    add('ar_total', 'Open receivables', m$(metrics.receivables.total), metrics.receivables.total);
    add('ar_overdue', 'Overdue receivables', `${m$(metrics.receivables.overdue)} (${pct(metrics.receivables.overdueShare)} of open receivables)`, metrics.receivables.overdue);
  }
  if (metrics.payables) add('ap_total', 'Open payables', m$(metrics.payables.total), metrics.payables.total);
  if (metrics.customers.available) {
    add('top_customer', 'Largest customer share', `${anon(metrics.customers.topName)} is ${pct(metrics.customers.topShare)} of operating revenue`, metrics.customers.topShare * 100);
  }
  if (forecast?.available) {
    add('horizon', 'Forecast horizon', `${forecast.horizonWeeks} weeks from ${shortDate(forecast.asOf)}`, forecast.horizonWeeks);
    add('projected_closing', 'Projected closing balance', `${m$(forecast.projectedClosing.value)} at week ${forecast.horizonWeeks} (80% range ${m$(forecast.projectedClosing.low)} to ${m$(forecast.projectedClosing.high)})`, forecast.projectedClosing.value);
    add('min_balance', 'Lowest projected balance', `${m$(forecast.minBalance.value)} in week ${forecast.minBalance.week}`, forecast.minBalance.value);
    add('shortfall', 'Cash shortfall outlook', forecast.firstShortfall
      ? `First projected shortfall in week ${forecast.firstShortfall.week} (${shortDate(forecast.firstShortfall.date)}), balance ${m$(forecast.firstShortfall.balance)}`
      : forecast.firstAtRisk ? `No shortfall in the central forecast; downside range turns negative in week ${forecast.firstAtRisk.week}`
        : 'No shortfall projected in the central forecast or the downside range');
  }
  if (health?.available) add('health', 'Financial health score', `${health.score} out of 100 (${health.band.label})`, health.score);
  risks.slice(0, 8).forEach((r) => add(`risk:${r.id}`, `Risk (${r.severity})`, anon(`${r.title}. ${r.summary}`), undefined, anon(r.title)));
  actions.slice(0, 6).forEach((a) => {
    add(`action:${a.id}`, 'Proposed action (needs approval)', anon(`${a.title}. ${describeImpact(a.impact, cur)}`), undefined, anon(a.title));
  });
  if (financing && !financing.need.standby) add('funding_need', 'Estimated funding need', `${m$(financing.need.amount)} starting week ${financing.need.week}`, financing.need.amount);
  return items;
}

// ---------------------------------------------------------------- grounding guard

const NUM = /(?<![\w.#])([−-]?)([$€£]?)(\d[\d,]*(?:\.\d+)?)\s?(%|k\b|K\b|m\b|M\b)?/g;

function numbersIn(text, { forEvidence = false } = {}) {
  const cleaned = String(text)
    .replace(/\[(?:E\d+(?:\s*,\s*E\d+)*)\]/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\bE\d+\b/g, ' ');
  const out = [];
  let m;
  NUM.lastIndex = 0;
  while ((m = NUM.exec(cleaned))) {
    let n = Number(m[3].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const suffix = (m[4] || '').toLowerCase();
    let tol = 0.51;
    if (suffix === 'k') { n *= 1e3; tol = 500; }
    if (suffix === 'm') { n *= 1e6; tol = 50000; }
    out.push({ n, raw: m[0].trim(), currency: !!m[2], percent: suffix === '%', suffix, tol, plain: !m[2] && !suffix, forEvidence });
  }
  return out;
}

function numbersOfItems(items) {
  const out = [];
  for (const e of items) {
    numbersIn(e.text, { forEvidence: true }).forEach((x) => out.push(x.n));
    if (Number.isFinite(e.value)) out.push(Math.abs(e.value));
  }
  return out;
}
const markersIn = (t) => [...String(t).matchAll(/\bE\d+\b/g)].map((m) => m[0]);

/**
 * Check that every figure in a narrative can be traced to the evidence it CITES.
 * A number only passes if it appears in an evidence item cited by the same sentence/point (or, for the
 * summary paragraph, by any citation in the narrative). Coincidental matches with unrelated evidence
 * do not count. Plain integers up to 12 and calendar years are ignored.
 */
export function validateNarrative(narrative, evidence) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const points = narrative.points || [];
  const allCited = new Set();
  for (const p of points) {
    for (const id of p.evidence || []) allCited.add(id);
    markersIn(p.text).forEach((id) => allCited.add(id));
  }
  markersIn(narrative.summary || '').forEach((id) => allCited.add(id));
  for (const id of narrative.evidence || []) allCited.add(id);
  const units = [
    { text: narrative.summary, ids: [...allCited] },
    ...points.map((p) => ({ text: p.text, ids: [...new Set([...(p.evidence || []), ...markersIn(p.text)])] })),
    ...(narrative.followUps || []).map((t) => ({ text: t, ids: [] })),
  ].filter((u) => u.text);
  const violations = [];
  for (const u of units) {
    const allowed = numbersOfItems(u.ids.map((id) => byId.get(id)).filter(Boolean));
    for (const x of numbersIn(u.text)) {
      if (x.plain && Number.isInteger(x.n) && x.n <= 12) continue;
      if (x.plain && Number.isInteger(x.n) && x.n >= 1990 && x.n <= 2100) continue;
      const ok = allowed.some((a) => Math.abs(a - x.n) <= Math.max(x.tol, 0.006 * a));
      if (!ok) violations.push({ token: x.raw, context: u.text.slice(0, 120) });
    }
  }
  const unknownIds = [...allCited].filter((id) => !byId.has(id));
  return { ok: violations.length === 0 && unknownIds.length === 0, violations, unknownIds };
}

// ---------------------------------------------------------------- deterministic narrative

const byKey = (evidence) => {
  const map = new Map(evidence.map((e) => [e.key, e]));
  return (k) => map.get(k);
};
const tag = (...es) => es.filter(Boolean).map((e) => `[${e.id}]`).join('');

/** Always-available narrative built from the same evidence the AI would receive. */
export function deterministicNarrative(evidence) {
  const g = byKey(evidence);
  const points = [];
  const push = (text, ...es) => {
    const ids = es.filter(Boolean).map((e) => e.id);
    if (text) points.push({ text: `${text} ${tag(...es)}`.trim(), evidence: ids });
  };
  const cash = g('cash'); const burn = g('burn'); const runway = g('runway'); const health = g('health');
  if (health) push(`The financial health score is ${health.text}.`, health);
  if (cash) {
    push(`Cash on hand is ${cash.text}${burn ? `, and average monthly net cash flow is ${burn.text}` : ''}${runway ? `, which gives a runway of ${runway.text}` : ''}.`, cash, burn, runway);
  }
  const sf = g('shortfall'); const min = g('min_balance');
  if (sf) push(`${sf.text}.${min ? ` The lowest projected balance is ${min.text}.` : ''}`, sf, min);
  const ar = g('ar_overdue');
  if (ar) push(`Customers owe ${g('ar_total').text}, of which ${ar.text} is overdue.`, g('ar_total'), ar);
  const risks = evidence.filter((e) => e.key.startsWith('risk:') && !/cash_shortage|cash_downside|low_runway|overdue_receivables/.test(e.key)).slice(0, 2);
  if (risks.length) push(`Other risks to watch: ${risks.map((r) => r.short || r.text).join('; ')}.`, ...risks);
  const acts = evidence.filter((e) => e.key.startsWith('action:')).slice(0, 2);
  if (acts.length) push(`Suggested next steps, each needing your approval: ${acts.map((a) => a.short || a.text).join('; ')}.`, ...acts);
  return {
    source: 'deterministic',
    summary: points.map((p) => p.text).join(' '),
    points,
    followUps: ['Which risk should I deal with first?', 'What happens if customers pay later than usual?'],
  };
}

/** Offline question answering: routes a question to the most relevant evidence. */
export function answerFromEvidence(question, evidence) {
  const q = String(question || '').toLowerCase();
  const g = byKey(evidence);
  const pick = (...keys) => keys.map((k) => g(k)).filter(Boolean);
  let es = [];
  let lead = '';
  if (/runway|how long|last/.test(q)) { es = pick('cash', 'burn', 'runway'); lead = 'Here is the runway picture:'; }
  else if (/short|run out|negative|short of cash|gap|zero/.test(q)) { es = pick('shortfall', 'min_balance', 'projected_closing'); lead = 'Here is the cash outlook:'; }
  else if (/receivable|owe|overdue|customer|invoice|collect/.test(q)) { es = pick('ar_total', 'ar_overdue', 'top_customer'); lead = 'Here is the receivables position:'; }
  else if (/payable|bill|supplier|vendor/.test(q)) { es = pick('ap_total'); lead = 'Here are the supplier obligations:'; }
  else if (/risk|worry|problem|danger|concern/.test(q)) { es = evidence.filter((e) => e.key.startsWith('risk:')).slice(0, 4); lead = 'The main risks are:'; }
  else if (/profit|margin|revenue|expense|earn|spend/.test(q)) { es = pick('revenue', 'expenses', 'margin'); lead = 'Here is operating performance:'; }
  else if (/health|score|how am i|overall/.test(q)) { es = pick('health', 'cash', 'shortfall'); lead = 'Overall:'; }
  else if (/\b(should|what to do|action|actions|next|recommend|fix|improve)\b/.test(q)) { es = evidence.filter((e) => e.key.startsWith('action:')).slice(0, 3); lead = 'Suggested next steps (each needs your approval):'; }
  else if (/cash|balance|have/.test(q)) { es = pick('cash', 'net'); lead = 'Current cash:'; }
  if (!es.length) {
    return {
      source: 'deterministic', answer: 'I can only answer from your verified numbers. Try asking about cash, runway, the cash outlook, receivables, supplier bills, risks, margin or recommended next steps.',
      evidence: [],
    };
  }
  return { source: 'deterministic', answer: `${lead} ${es.map((e) => `${e.label}: ${e.text} [${e.id}]`).join('; ')}.`, evidence: es.map((e) => e.id) };
}
