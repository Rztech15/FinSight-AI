// Scenario simulation: named what-if templates that compile into forecast adjustments, plus a
// comparison of any scenario against the baseline forecast. Scenarios never change the data;
// they re-run the same deterministic model.

import { NO_ADJUSTMENTS, runForecast } from './forecast.js';
import { money } from './format.js';

export const SCENARIO_TEMPLATES = [
  {
    id: 'late_customers', label: 'Customers pay later', description: 'Every open receivable arrives later than scheduled.',
    params: [{ key: 'days', label: 'Extra days to pay', default: 15, min: 1, max: 90, step: 1, unit: 'days' }],
    build: (p) => ({ collectionDelayDays: p.days }),
  },
  {
    id: 'revenue_drop', label: 'Revenue falls', description: 'Future sales fall by a percentage.',
    params: [{ key: 'pct', label: 'Revenue decline', default: 15, min: 1, max: 80, step: 1, unit: '%' }],
    build: (p) => ({ revenueChangePct: -p.pct }),
  },
  {
    id: 'cost_cut', label: 'Cut variable spending', description: 'Variable costs (not rent, payroll, loans, insurance or tax) fall.',
    params: [{ key: 'pct', label: 'Spending reduction', default: 10, min: 1, max: 50, step: 1, unit: '%' }],
    build: (p) => ({ expenseChangePct: -p.pct }),
  },
  {
    id: 'supplier_terms', label: 'Extend supplier terms', description: 'Suppliers agree to be paid later.',
    params: [{ key: 'days', label: 'Extra days to pay', default: 14, min: 1, max: 60, step: 1, unit: 'days' }],
    build: (p) => ({ payableDelayDays: p.days }),
  },
  {
    id: 'new_hire', label: 'Hire an employee', description: 'A new monthly payroll cost starts.',
    params: [
      { key: 'monthly', label: 'Monthly cost', default: 4000, min: 500, max: 50000, step: 100, unit: 'money' },
      { key: 'startWeek', label: 'Starts in week', default: 3, min: 1, max: 26, step: 1, unit: 'week' },
    ],
    build: (p) => ({ recurringAdds: [{ startWeek: p.startWeek, everyWeeks: 4, amount: -p.monthly, label: 'New hire' }] }),
  },
  {
    id: 'big_purchase', label: 'One-off purchase', description: 'A single unplanned payment (equipment, repair, deposit).',
    params: [
      { key: 'amount', label: 'Amount', default: 10000, min: 100, max: 500000, step: 100, unit: 'money' },
      { key: 'week', label: 'In week', default: 4, min: 1, max: 26, step: 1, unit: 'week' },
    ],
    build: (p) => ({ oneOffs: [{ week: p.week, amount: -p.amount, label: 'One-off purchase' }] }),
  },
  {
    id: 'cash_injection', label: 'Cash injection', description: 'Owner capital or other funding arrives.',
    params: [
      { key: 'amount', label: 'Amount', default: 15000, min: 100, max: 500000, step: 100, unit: 'money' },
      { key: 'week', label: 'In week', default: 2, min: 1, max: 26, step: 1, unit: 'week' },
    ],
    build: (p) => ({ oneOffs: [{ week: p.week, amount: p.amount, label: 'Cash injection' }] }),
  },
];

export function templateDefaults(t) {
  return Object.fromEntries(t.params.map((p) => [p.key, p.default]));
}

/** Combine several adjustment objects into one (used for combined scenarios and executed actions). */
export function mergeAdjustments(list) {
  const out = {
    ...NO_ADJUSTMENTS, oneOffs: [], recurringAdds: [],
  };
  for (const a of list.filter(Boolean)) {
    out.revenueChangePct += a.revenueChangePct || 0;
    out.expenseChangePct += a.expenseChangePct || 0;
    out.collectionDelayDays += a.collectionDelayDays || 0;
    out.payableDelayDays += a.payableDelayDays || 0;
    out.collectionRateBoost = Math.min(0.25, out.collectionRateBoost + (a.collectionRateBoost || 0));
    if (a.overdueCollectionDays != null) {
      out.overdueCollectionDays = out.overdueCollectionDays == null ? a.overdueCollectionDays : Math.min(out.overdueCollectionDays, a.overdueCollectionDays);
    }
    out.oneOffs.push(...(a.oneOffs || []));
    out.recurringAdds.push(...(a.recurringAdds || []));
  }
  return out;
}

export function compareForecasts(base, scen, currency = 'USD') {
  if (!base.available || !scen.available) return null;
  const closingDelta = scen.projectedClosing.value - base.projectedClosing.value;
  const minDelta = scen.minBalance.value - base.minBalance.value;
  const below = (f) => f.weeks.slice(1).filter((w) => w.closing < 0).length;
  const bs = base.firstShortfall;
  const ss = scen.firstShortfall;
  let verdict;
  if (!bs && !ss) verdict = 'No cash shortfall in either case.';
  else if (bs && !ss) verdict = `Resolves the projected shortfall in week ${bs.week}.`;
  else if (!bs && ss) verdict = `Creates a cash shortfall in week ${ss.week}.`;
  else if (ss.week > bs.week) verdict = `Delays the first shortfall from week ${bs.week} to week ${ss.week}, but does not remove it.`;
  else if (ss.week < bs.week) verdict = `Brings the first shortfall forward from week ${bs.week} to week ${ss.week}.`;
  else verdict = `First shortfall stays in week ${ss.week}; lowest balance changes by ${money(minDelta, currency)}.`;
  return {
    closingDelta, minDelta,
    base: { closing: base.projectedClosing.value, min: base.minBalance.value, shortfallWeek: bs?.week ?? null, weeksBelowZero: below(base) },
    scenario: { closing: scen.projectedClosing.value, min: scen.minBalance.value, shortfallWeek: ss?.week ?? null, weeksBelowZero: below(scen) },
    verdict,
  };
}

export function simulate(prep, base, adjustments, currency) {
  const scen = runForecast(prep, adjustments);
  return { forecast: scen, comparison: compareForecasts(base, scen, currency) };
}
