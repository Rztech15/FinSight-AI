// Recommended actions. Each action is derived from detected risks and the user's own data, has an
// effect expressed as forecast adjustments (so its impact is CALCULATED, never asserted), and can only
// move through a human-approved workflow:   proposed → approved → executed (SANDBOX only)  or  rejected.
// No action ever moves real money or contacts a third party; "execution" writes a sandbox log entry.

import { fnv1a, sum, round } from './util.js';
import { money, pct, shortDate } from './format.js';
import { runForecast } from './forecast.js';
import { mergeAdjustments } from './scenarios.js';

export const ACTION_STATES = ['proposed', 'approved', 'rejected', 'executed'];

export function actionId(code, key = '') {
  return `act_${code}_${fnv1a(`${code}|${key}`)}`;
}

function impactOf(prep, base, effect) {
  if (!effect || !base.available) return null;
  const after = runForecast(prep, effect);
  return {
    closingDelta: round(after.projectedClosing.value - base.projectedClosing.value, 0),
    minDelta: round(after.minBalance.value - base.minBalance.value, 0),
    shortfallBefore: base.firstShortfall?.week ?? null,
    shortfallAfter: after.firstShortfall?.week ?? null,
    minAfter: after.minBalance.value,
    resolvesShortfall: !!base.firstShortfall && !after.firstShortfall,
  };
}

/** Plain-language description of a calculated action impact. */
export function describeImpact(impact, currency = 'USD') {
  if (!impact) return 'No cash effect is claimed.';
  const sgn = (v) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v), currency)}`;
  const parts = [`lowest balance ${sgn(impact.minDelta)}`, `closing balance ${sgn(impact.closingDelta)}`];
  if (impact.resolvesShortfall) parts.push(`removes the week ${impact.shortfallBefore} shortfall`);
  else if (impact.shortfallBefore && impact.shortfallAfter && impact.shortfallAfter !== impact.shortfallBefore) {
    parts.push(`moves the first shortfall from week ${impact.shortfallBefore} to week ${impact.shortfallAfter}`);
  }
  return `Calculated effect: ${parts.join(', ')}.`;
}

export function proposeActions({ metrics, prep, forecast, risks, financing }) {
  if (metrics.empty || !forecast?.available) return [];
  const cur = metrics.settings.currency;
  const m$ = (v) => money(v, cur);
  const has = (code) => risks.some((r) => r.actionCodes.includes(code));
  const riskIds = (code) => risks.filter((r) => r.actionCodes.includes(code)).map((r) => r.id);
  const actions = [];
  const add = (a) => {
    const effect = a.effect || null;
    actions.push({
      state: 'proposed', requiresApproval: true, simulated: true, riskIds: riskIds(a.code), ...a,
      impact: impactOf(prep, forecast, effect),
    });
  };

  // 1. Chase overdue receivables
  const ar = metrics.receivables;
  if (ar && ar.overdue > 0 && has('collect_overdue')) {
    const overdue = ar.items.filter((i) => i.daysPastDue > 0);
    const byParty = new Map();
    for (const i of overdue) {
      const k = i.counterparty || i.label || 'Customer';
      if (!byParty.has(k)) byParty.set(k, []);
      byParty.get(k).push(i);
    }
    const targets = [...byParty.entries()].map(([name, items]) => ({ name, items, total: sum(items.map((i) => i.amountAbs)) })).sort((a, b) => b.total - a.total);
    const lines = targets.slice(0, 3).map((t) => `${t.name}: ${t.items.map((i) => `${i.reference || 'invoice'} (${m$(i.amountAbs)}, ${i.daysPastDue} days overdue)`).join('; ')}`);
    add({
      code: 'collect_overdue', id: actionId('collect_overdue', targets.map((t) => t.name).join(',')),
      title: `Send payment reminders for ${m$(ar.overdue)} of overdue invoices`,
      rationale: `${m$(ar.overdue)} (${pct(ar.overdueShare)}) of receivables is past due. Prompt, polite follow-up with the ${targets.length} customer(s) concerned usually brings cash forward.`,
      effect: { overdueCollectionDays: 5, collectionRateBoost: 0.1 },
      effectNote: 'Assumes overdue invoices are collected about 5 days after the as-of date and collection rates improve by 10 points.',
      riskLevel: 'low',
      draft: {
        kind: 'email', subject: 'Friendly reminder: overdue invoices',
        body: `Hello,\n\nOur records show the following invoices are past their due date:\n${targets.map((t) => `\n${t.name}\n${t.items.map((i) => `  - ${i.reference || 'Invoice'}: ${m$(i.amountAbs)}, due ${shortDate(i.due)} (${i.daysPastDue} days overdue)`).join('\n')}`).join('\n')}\n\nCould you let us know when we can expect payment, or flag anything that is holding it up? Thank you for your business.\n\nKind regards`,
      },
      sandboxResult: `${targets.length} reminder email(s) drafted and queued in the sandbox. Nothing was sent. ${lines.join(' | ')}`,
    });
  }

  // 2. Negotiate supplier terms
  const ap = metrics.payables;
  if (ap && ap.total > 0 && has('delay_payables')) {
    const next = ap.items.filter((i) => i.daysPastDue <= 0).sort((a, b) => b.amountAbs - a.amountAbs).slice(0, 2);
    if (next.length) {
      add({
        code: 'delay_payables', id: actionId('delay_payables', next.map((n) => n.reference || n.label).join(',')),
        title: `Ask ${next[0].counterparty || next[0].label} for 14 more days on ${m$(next[0].amountAbs)}`,
        rationale: `${m$(ap.total)} of supplier bills are open. Moving the largest due dates back two weeks smooths the low point without paying anything late.`,
        effect: { payableDelayDays: 14 },
        effectNote: 'Assumes every open bill is paid 14 days later than currently scheduled.',
        riskLevel: 'medium',
        draft: {
          kind: 'email', subject: `Request to extend payment terms on ${next[0].reference || 'our open invoice'}`,
          body: `Hello,\n\nWe value our relationship and would like to ask for a 14-day extension on ${next.map((n) => `${n.reference || 'the invoice'} (${m$(n.amountAbs)}, due ${shortDate(n.due)})`).join(' and ')}. This would help us manage seasonal cash timing, and we will confirm the new payment date as soon as you agree.\n\nThank you for considering it.\n\nKind regards`,
        },
        sandboxResult: 'Supplier extension request drafted and logged in the sandbox. Nothing was sent.',
      });
    }
  }

  // 3. Trim variable spend
  if ((forecast.firstShortfall || forecast.firstAtRisk || (metrics.margin.available && metrics.margin.value < 0)) && has('cut_spend')) {
    const top = metrics.categories.filter((c) => !/payroll|salary|rent|loan|tax|insurance/i.test(c.name)).slice(0, 3);
    add({
      code: 'cut_spend', id: actionId('cut_spend', top.map((t) => t.name).join(',')),
      title: 'Reduce variable spending by 10%',
      rationale: top.length
        ? `The largest controllable categories are ${top.map((c) => `${c.name} (${m$(c.amount / Math.max(1, metrics.expenses.monthsUsed || 3))}/month)`).join(', ')}. A 10% reduction across variable costs lifts cash every week of the forecast.`
        : 'A 10% reduction across variable costs lifts cash every week of the forecast.',
      effect: { expenseChangePct: -10 },
      effectNote: 'Applies to variable outflows only; payroll, rent, loans, insurance and tax are unchanged.',
      riskLevel: 'medium',
      draft: { kind: 'plan', subject: 'Spending review checklist', body: `1. Review ${top.map((c) => c.name).join(', ') || 'the biggest variable categories'} line by line.\n2. Pause anything not needed to serve customers in the next 90 days.\n3. Re-quote the top two suppliers.\n4. Re-run this forecast after changes.` },
      sandboxResult: 'Spending-review plan recorded in the sandbox. No payments were changed.',
    });
  }

  // 4. Recover a duplicate payment
  const dup = risks.find((r) => r.code === 'possible_duplicate');
  if (dup?.meta) {
    add({
      code: 'recover_duplicate', id: actionId('recover_duplicate', `${dup.meta.counterparty}|${dup.meta.amount}`),
      title: `Request a refund of ${m$(dup.meta.amount)} from ${dup.meta.counterparty}`,
      rationale: `${dup.summary} If confirmed as a duplicate, the supplier owes you a refund or credit.`,
      effect: { oneOffs: [{ week: 3, amount: dup.meta.amount, label: 'Duplicate payment refunded' }] },
      effectNote: 'Assumes the refund arrives in week 3.',
      riskLevel: 'low',
      draft: { kind: 'email', subject: `Possible duplicate payment${dup.meta.reference ? ` — ${dup.meta.reference}` : ''}`, body: `Hello,\n\nOur records show ${m$(dup.meta.amount)} was paid twice${dup.meta.reference ? ` against ${dup.meta.reference}` : ''}. Could you confirm and either refund the duplicate or apply it as credit to our next invoice?\n\nKind regards` },
      sandboxResult: 'Refund request drafted and logged in the sandbox. Nothing was sent.',
    });
  }

  // 5. Review an expense spike / unusual payments (no cash effect claimed)
  const spike = risks.find((r) => r.code === 'expense_spike' || r.code === 'unusual_payments');
  if (spike) {
    add({
      code: 'review_spike', id: actionId('review_spike', spike.id),
      title: 'Review unusual spending and decide whether it will repeat',
      rationale: `${spike.title}. Confirm whether this was planned, one-off or the start of a higher run-rate; the forecast only assumes normal spending going forward.`,
      effect: null, effectNote: 'No cash impact is claimed; this is a review step.',
      riskLevel: 'low',
      draft: { kind: 'plan', subject: 'Spend review', body: spike.evidence.map((e) => `- ${e.label}: ${e.text}`).join('\n') },
      sandboxResult: 'Review task recorded in the sandbox.',
    });
  }

  // 6. Diversify customers
  const conc = risks.find((r) => r.code === 'customer_concentration');
  if (conc) {
    add({
      code: 'diversify_customers', id: actionId('diversify_customers', metrics.customers.topName),
      title: `Reduce dependence on ${metrics.customers.topName}`,
      rationale: `${conc.summary} Agree shorter payment terms or deposits with this customer and set a target to win replacement revenue.`,
      effect: null, effectNote: 'Strategic action — no short-term cash impact is claimed.',
      riskLevel: 'low',
      draft: { kind: 'plan', subject: 'Customer diversification plan', body: `1. Agree a payment schedule with ${metrics.customers.topName}.\n2. Set a goal: no single customer above 20% of revenue.\n3. List five prospects similar to your top customers and contact them this month.` },
      sandboxResult: 'Diversification plan recorded in the sandbox.',
    });
  }

  // 7. Financing application (simulated)
  if (financing && !financing.need.standby && has('bridge_financing')) {
    const best = financing.options.find((o) => o.eligible && o.simulation && o.suggestedAmount > 0);
    if (best) {
      add({
        code: 'bridge_financing', id: actionId('bridge_financing', best.product.id),
        title: `Prepare a request for ${best.product.name.toLowerCase()} (${m$(best.suggestedAmount)})`,
        rationale: `Best fit among eligible illustrative options (fit ${best.score}/100). Indicative cost ${m$(best.cost.low)}–${m$(best.cost.high)}. ${best.arrivesAfterNeed ? 'Funding may arrive after the first shortfall, so combine with faster actions.' : ''}`.trim(),
        effect: best.simulation,
        effectNote: 'Uses the midpoint of the illustrative rate range; real terms will differ.',
        riskLevel: 'high',
        draft: {
          kind: 'application', subject: `${best.product.name} — summary for a lender`,
          body: `Requested amount: ${m$(best.suggestedAmount)}\nPurpose: bridge a projected cash gap starting in week ${financing.need.week}\nAverage monthly revenue: ${m$(financing.avgMonthlyRevenue)}\nHistory covered: ${metrics.period.first} to ${metrics.period.last}\nOpen receivables: ${ar ? m$(ar.total) : 'n/a'}\n\nThis is a self-generated summary for discussion with a lender. It is not an application.`,
        },
        sandboxResult: 'Financing summary prepared and logged in the sandbox. No application was submitted and no lender was contacted.',
        financingProductId: best.product.id,
      });
    }
  }
  return actions;
}

/** Combined effect of all executed actions, compared with the baseline forecast. */
export function measureResults(prep, base, actions) {
  const executed = actions.filter((a) => a.state === 'executed' && a.effect);
  if (!executed.length || !base.available) return null;
  const after = runForecast(prep, mergeAdjustments(executed.map((a) => a.effect)));
  return {
    count: executed.length,
    before: { closing: base.projectedClosing.value, min: base.minBalance.value, shortfallWeek: base.firstShortfall?.week ?? null },
    after: { closing: after.projectedClosing.value, min: after.minBalance.value, shortfallWeek: after.firstShortfall?.week ?? null },
    closingDelta: round(after.projectedClosing.value - base.projectedClosing.value, 0),
    minDelta: round(after.minBalance.value - base.minBalance.value, 0),
    forecast: after,
  };
}
