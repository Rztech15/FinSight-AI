// Financing-option matching (SME Finance Copilot).
//
// IMPORTANT: the catalog below contains ILLUSTRATIVE product archetypes with editable assumptions.
// They are not offers from any lender, are not credit advice, and no application is ever submitted.
// The engine's job is to show how a business's own numbers (need, timing, history, receivables,
// margin) would line up against typical product structures, and what each would cost.

import { clamp, round, sum, mean } from './util.js';
import { money } from './format.js';

export const FINANCING_CATALOG = [
  {
    id: 'line_of_credit', name: 'Business line of credit', structure: 'revolving',
    summary: 'Draw only what you need, repay when cash recovers.',
    aprLow: 0.11, aprHigh: 0.24, feePct: 0.01, daysToFund: 14, minMonthsHistory: 6, minMonthlyRevenue: 8000,
    limitMultiple: 1.5, needsReceivables: false, needsPositiveMargin: false,
    bestFor: 'Short or uncertain gaps (up to ~6 months).',
    watchOuts: ['Variable rates and annual renewal fees are common.', 'Limit is usually reviewed against recent cash flow.'],
  },
  {
    id: 'short_term_loan', name: 'Short-term working-capital loan', structure: 'amortizing',
    summary: 'Lump sum repaid in fixed instalments over a few months.',
    aprLow: 0.14, aprHigh: 0.32, feePct: 0.02, daysToFund: 10, termMonthsMax: 18, minMonthsHistory: 12, minMonthlyRevenue: 10000,
    limitMultiple: 2, needsReceivables: false, needsPositiveMargin: false,
    bestFor: 'A known, one-time cash gap.',
    watchOuts: ['Fixed instalments add to weekly outflows immediately.', 'Origination fee is deducted up front.'],
  },
  {
    id: 'invoice_financing', name: 'Invoice financing', structure: 'invoice',
    summary: 'Advance against unpaid customer invoices.',
    aprLow: 0, aprHigh: 0, feePct: 0, feePer30Low: 0.01, feePer30High: 0.03, advanceRate: 0.85, daysToFund: 5, minMonthsHistory: 3, minMonthlyRevenue: 5000,
    limitMultiple: 0, needsReceivables: true, needsPositiveMargin: false,
    bestFor: 'Cash tied up in slow-paying but creditworthy customers.',
    watchOuts: ['Fees accrue the longer customers take to pay.', 'Invoices more than 60 days past due are usually ineligible.'],
  },
  {
    id: 'term_loan', name: 'Term loan', structure: 'amortizing',
    summary: 'Lower-cost, longer-term borrowing for investment.',
    aprLow: 0.08, aprHigh: 0.16, feePct: 0.015, daysToFund: 30, termMonthsMax: 60, minMonthsHistory: 24, minMonthlyRevenue: 15000,
    limitMultiple: 4, needsReceivables: false, needsPositiveMargin: true,
    bestFor: 'Growth investment, not short-term cash gaps.',
    watchOuts: ['Lenders look for positive operating cash flow.', 'Slow to arrive — unsuitable for urgent gaps.'],
  },
  {
    id: 'cash_advance', name: 'Merchant cash advance', structure: 'factor',
    summary: 'Upfront cash repaid as a share of future sales at a fixed factor rate.',
    aprLow: 0, aprHigh: 0, feePct: 0, factorLow: 1.15, factorHigh: 1.4, paybackWeeks: 26, daysToFund: 3, minMonthsHistory: 4, minMonthlyRevenue: 5000,
    limitMultiple: 1, needsReceivables: false, needsPositiveMargin: false,
    bestFor: 'Last resort when speed matters more than cost.',
    watchOuts: ['Effective annual cost is usually far higher than loans.', 'Daily or weekly repayments squeeze cash further.'],
  },
];

export function pmt(principal, apr, n) {
  const r = apr / 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - (1 + r) ** -n);
}

/** Estimate the funding the forecast calls for. */
export function estimateNeed(metrics, forecast) {
  if (!forecast?.available) return { amount: 0, week: null, durationWeeks: 0, standby: true, reason: 'No forecast available.' };
  const buffer = metrics.settings.minimumCashBuffer || 0;
  const weeklyOut = forecast.totals.outflow / forecast.horizonWeeks;
  const safety = round(weeklyOut, 0);
  const target = buffer + safety;
  const minBal = forecast.minBalance.value;
  const breach = forecast.weeks.slice(1).find((w) => w.closing < target);
  const firstShort = forecast.firstShortfall;
  if (!firstShort) {
    return {
      amount: 0, standby: true, safetyBuffer: safety, week: breach?.week ?? null, durationWeeks: 0,
      reason: 'No shortfall is projected. Options below show what a standby facility could look like.',
      suggestedStandby: Math.ceil(safety / 500) * 500,
    };
  }
  const amount = Math.ceil(Math.max(0, target - minBal) / 500) * 500;
  const startWeek = firstShort.week;
  let end = forecast.horizonWeeks;
  for (let w = forecast.minBalance.week; w <= forecast.horizonWeeks; w++) {
    if (forecast.weeks[w].closing >= target) { end = w; break; }
  }
  return {
    amount, standby: false, safetyBuffer: safety, week: startWeek,
    durationWeeks: Math.max(4, end - startWeek + 1),
    reason: `To keep ${money(safety, metrics.settings.currency)} (one week of average spending) above zero through the lowest projected point.`,
  };
}

export function matchFinancing(metrics, forecast, catalog = FINANCING_CATALOG) {
  const cur = metrics.settings.currency;
  const need = estimateNeed(metrics, forecast);
  const monthsHistory = metrics.period.days / 30.44;
  const monthlyRev = metrics.revenue.available ? metrics.revenue.value : 0;
  const eligibleAR = metrics.receivables
    ? sum(metrics.receivables.items.filter((i) => i.daysPastDue <= 60).map((i) => i.amountAbs)) : 0;
  const marginOk = metrics.margin.available ? metrics.margin.value >= 0 : false;
  const target = need.standby ? need.suggestedStandby || 0 : need.amount;

  const options = catalog.map((p) => {
    const reasons = [];
    let eligible = true;
    if (monthsHistory < p.minMonthsHistory) { eligible = false; reasons.push(`Needs ${p.minMonthsHistory}+ months of history; the data covers ${monthsHistory.toFixed(0)}.`); }
    if (monthlyRev < p.minMonthlyRevenue) { eligible = false; reasons.push(`Typical minimum revenue is ${money(p.minMonthlyRevenue, cur)}/month; recent average is ${money(monthlyRev, cur)}.`); }
    if (p.needsReceivables && eligibleAR < 3000) { eligible = false; reasons.push('Needs a meaningful base of open, not-seriously-overdue invoices.'); }
    if (p.needsPositiveMargin && !marginOk) { eligible = false; reasons.push(metrics.margin.available ? `Lenders typically want positive operating margin; yours is ${(metrics.margin.value * 100).toFixed(1)}%.` : 'Operating margin could not be measured.'); }

    let maxAmount = p.structure === 'invoice' ? eligibleAR * p.advanceRate : monthlyRev * p.limitMultiple;
    maxAmount = Math.floor(maxAmount / 100) * 100;
    const suggested = Math.min(maxAmount, Math.max(target, 0));
    const amt = suggested;
    const durWeeks = Math.max(need.durationWeeks || 8, 4);

    let costLow = 0; let costHigh = 0; let effLow = 0; let effHigh = 0; let sim = null;
    const draw = Math.max(1, (need.week ?? 2) - 1, Math.ceil(p.daysToFund / 7));
    const late = need.week != null && draw > need.week;
    if (amt > 0 && eligible) {
      if (p.structure === 'revolving') {
        costLow = amt * p.aprLow * (durWeeks / 52) + amt * p.feePct;
        costHigh = amt * p.aprHigh * (durWeeks / 52) + amt * p.feePct;
        effLow = p.aprLow + p.feePct * (52 / durWeeks); effHigh = p.aprHigh + p.feePct * (52 / durWeeks);
        const apr = (p.aprLow + p.aprHigh) / 2;
        const repay = amt + amt * apr * (durWeeks / 52);
        sim = { oneOffs: [{ week: draw, amount: amt - amt * p.feePct, label: `${p.name} draw` }, { week: draw + durWeeks, amount: -repay, label: `${p.name} repayment` }] };
      } else if (p.structure === 'amortizing') {
        const n = clamp(Math.ceil(durWeeks / 4.33), 3, p.termMonthsMax);
        const payLow = pmt(amt, p.aprLow, n); const payHigh = pmt(amt, p.aprHigh, n);
        costLow = payLow * n - amt + amt * p.feePct; costHigh = payHigh * n - amt + amt * p.feePct;
        effLow = p.aprLow + (p.feePct * 12) / n; effHigh = p.aprHigh + (p.feePct * 12) / n;
        const payMid = pmt(amt, (p.aprLow + p.aprHigh) / 2, n);
        sim = { oneOffs: [{ week: draw, amount: amt - amt * p.feePct, label: `${p.name} funds` }], recurringAdds: [{ startWeek: draw + 4, everyWeeks: 4, amount: -payMid, count: n, label: `${p.name} instalment` }] };
      } else if (p.structure === 'invoice') {
        const collectDays = (metrics.terms.days || 30) + (metrics.lateness.receivable.days || 0);
        costLow = amt * p.feePer30Low * (collectDays / 30); costHigh = amt * p.feePer30High * (collectDays / 30);
        effLow = p.feePer30Low * (365 / 30); effHigh = p.feePer30High * (365 / 30);
        const fee = amt * ((p.feePer30Low + p.feePer30High) / 2) * (collectDays / 30);
        sim = { oneOffs: [{ week: draw, amount: amt, label: 'Invoice advance' }, { week: draw + Math.ceil(collectDays / 7), amount: -(amt + fee), label: 'Advance settled from collections' }] };
      } else if (p.structure === 'factor') {
        costLow = amt * (p.factorLow - 1); costHigh = amt * (p.factorHigh - 1);
        effLow = (p.factorLow - 1) * (52 / p.paybackWeeks); effHigh = (p.factorHigh - 1) * (52 / p.paybackWeeks);
        const total = amt * ((p.factorLow + p.factorHigh) / 2);
        sim = { oneOffs: [{ week: draw, amount: amt, label: 'Advance funds' }], recurringAdds: [{ startWeek: draw + 1, everyWeeks: 1, amount: -total / p.paybackWeeks, count: p.paybackWeeks, label: 'Advance repayment' }] };
      }
    }
    const effMid = (effLow + effHigh) / 2;
    const coverage = target > 0 ? clamp(maxAmount / target, 0, 1) : 1;
    const costScore = 1 - clamp((effMid - 0.08) / 0.72, 0, 1);
    const speed = 1 - clamp(p.daysToFund / 30, 0, 1);
    const shortFit = ['revolving', 'invoice', 'factor'].includes(p.structure);
    const durationFit = shortFit ? (durWeeks <= 26 ? 1 : 0.5) : (durWeeks >= 17 ? 1 : 0.4);
    let score = eligible && amt > 0 ? Math.round(100 * (0.35 * coverage + 0.35 * costScore + 0.15 * speed + 0.15 * durationFit)) : 0;
    if (late) score = Math.max(0, score - 10);
    return {
      product: p, eligible, reasons, maxAmount, suggestedAmount: amt,
      cost: eligible && amt > 0 ? { low: round(costLow, 0), high: round(costHigh, 0), annualLow: effLow, annualHigh: effHigh } : null,
      fundingDay: p.daysToFund, drawWeek: draw, arrivesAfterNeed: late, score, simulation: sim,
      coverage,
    };
  });
  options.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
  options.forEach((o, i) => { o.rank = i + 1; });
  return {
    need,
    options,
    disclaimer: 'Illustrative product types with editable assumptions. Not an offer or credit advice; no application is submitted. Real terms depend on the lender.',
    avgMonthlyRevenue: monthlyRev,
    eligibleReceivables: round(eligibleAR, 0),
    meanScore: mean(options.map((o) => o.score)),
  };
}
