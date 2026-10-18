// Deterministic financial metrics. Every figure is derived from the imported transactions or from an
// explicit, user-visible assumption. When a figure cannot be derived the metric is returned as
// {available:false, reason} — the UI shows the reason instead of a fabricated zero.

import {
  addDays, diffDays, endOfMonth, monthKey, sum, mean, median, round, avail, unavail, withDefaults,
} from './util.js';

const NON_OPERATING = /transfer|loan|financ|capital|owner|equity|invest|dividend|draw|shareholder|interest paid/i;

export function categoryOf(t) {
  return t.category || 'Uncategorized';
}
/** Operating flows exclude transfers, debt service, owner and investment movements. */
export function isOperating(t) {
  return !NON_OPERATING.test(t.category || '');
}

export function ageBucket(daysPastDue) {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return 'd1_30';
  if (daysPastDue <= 60) return 'd31_60';
  return 'd61plus';
}

/** Payment terms (days from invoice to due) inferred from open invoices; 30 if unknown. */
export function inferTerms(open, settings) {
  if (settings.paymentTermsDays != null) return { days: settings.paymentTermsDays, source: 'assumption' };
  const gaps = open.filter((t) => t.dueDate).map((t) => diffDays(t.dueDate, t.date)).filter((d) => d >= 0 && d <= 120);
  if (gaps.length >= 3) return { days: Math.round(median(gaps)), source: 'inferred from open invoices' };
  return { days: 30, source: 'default assumption' };
}

/** Average days paid after due date for settled invoice-linked rows. */
export function inferLateness(settled, sign, override) {
  if (override != null) return { days: override, source: 'assumption', samples: 0 };
  const lates = settled
    .filter((t) => t.dueDate && Math.sign(t.amount) === sign)
    .map((t) => diffDays(t.date, t.dueDate));
  if (lates.length < 3) return { days: 0, source: 'default assumption', samples: lates.length };
  const v = Math.max(0, Math.min(60, Math.round(mean(lates))));
  return { days: v, source: 'inferred from paid invoices', samples: lates.length };
}

function buildMonths(settled, asOf, firstDate) {
  const map = new Map();
  for (const t of settled) {
    const k = monthKey(t.date);
    if (!map.has(k)) map.set(k, { key: k, inflow: 0, outflow: 0, operatingIn: 0, operatingOut: 0, count: 0 });
    const m = map.get(k);
    m.count++;
    if (t.amount > 0) {
      m.inflow += t.amount;
      if (isOperating(t)) m.operatingIn += t.amount;
    } else {
      m.outflow += -t.amount;
      if (isOperating(t)) m.operatingOut += -t.amount;
    }
  }
  const keys = [...map.keys()].sort();
  const firstKey = monthKey(firstDate);
  const lastKey = monthKey(asOf);
  return keys.map((k) => {
    const m = map.get(k);
    let complete = k < lastKey;
    if (k === lastKey) complete = asOf === endOfMonth(asOf);
    if (k === firstKey && Number(firstDate.slice(8, 10)) > 5) complete = false;
    return {
      ...m,
      inflow: round(m.inflow), outflow: round(m.outflow), operatingIn: round(m.operatingIn), operatingOut: round(m.operatingOut),
      net: round(m.inflow - m.outflow), complete,
    };
  });
}

function cashPosition(settled, settings) {
  const withBal = settled.filter((t) => t.balance !== null);
  if (settled.length && withBal.length / settled.length >= 0.5) {
    const latest = new Map();
    for (const t of withBal) latest.set(t.account || '_', t); // sorted by date, so last wins
    const accounts = [...latest.values()];
    return avail(round(sum(accounts.map((t) => t.balance))), {
      source: 'statement_balance',
      note: accounts.length > 1 ? `Sum of the latest running balance of ${accounts.length} accounts.` : 'Latest running balance in the file.',
      asOf: accounts.map((t) => t.date).sort().pop(),
    });
  }
  if (typeof settings.openingBalance === 'number' && Number.isFinite(settings.openingBalance)) {
    return avail(round(settings.openingBalance + sum(settled.map((t) => t.amount))), {
      source: 'opening_balance_assumption',
      note: 'Opening balance you entered plus all imported transactions.',
    });
  }
  return unavail('The file has no running-balance column. Enter your opening balance to calculate cash on hand.');
}

function ageing(open, sign, asOf, terms) {
  const items = open
    .filter((t) => Math.sign(t.amount) === sign)
    .map((t) => {
      const due = t.dueDate || addDays(t.date, terms.days);
      const daysPastDue = diffDays(asOf, due);
      return { ...t, amountAbs: Math.abs(t.amount), due, daysPastDue, bucket: ageBucket(daysPastDue), dueEstimated: !t.dueDate };
    })
    .sort((a, b) => b.daysPastDue - a.daysPastDue || b.amountAbs - a.amountAbs);
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61plus: 0 };
  for (const i of items) buckets[i.bucket] += i.amountAbs;
  const total = sum(items.map((i) => i.amountAbs));
  const overdue = total - buckets.current;
  return {
    count: items.length, total: round(total), overdue: round(overdue),
    overdueShare: total ? overdue / total : 0,
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round(v)])), items,
  };
}

export function computeMetrics(transactions, rawSettings = {}) {
  const settings = withDefaults(rawSettings);
  const settled = transactions.filter((t) => t.status === 'settled');
  const open = transactions.filter((t) => t.status === 'open');
  if (!settled.length) return { empty: true, reason: 'No settled transactions were imported.', settings };

  const first = settled[0].date;
  const last = settled[settled.length - 1].date;
  const asOf = settings.asOfDate || last;
  const terms = inferTerms(open, settings);
  const lateness = {
    receivable: inferLateness(settled, 1, settings.receivableDelayDays),
    payable: inferLateness(settled, -1, settings.payableDelayDays),
  };

  const months = buildMonths(settled, asOf, first);
  const complete = months.filter((m) => m.complete);
  const lastMonth = complete[complete.length - 1] || null;
  const prevMonth = complete[complete.length - 2] || null;

  // running month-end balance when cash is known
  const cash = cashPosition(settled, settings);
  if (cash.available) {
    let bal = cash.value - sum(settled.map((t) => t.amount));
    for (const m of months) {
      bal += m.net;
      m.endBalance = round(bal);
    }
  }

  const totalIn = round(sum(settled.filter((t) => t.amount > 0).map((t) => t.amount)));
  const totalOut = round(-sum(settled.filter((t) => t.amount < 0).map((t) => t.amount)));

  // trailing operating performance over up to 3 complete months
  const trail = complete.slice(-3);
  const hasCategories = settled.some((t) => t.category);
  let revenue = unavail('Needs at least one complete month of data.');
  let expenses = revenue;
  let margin = revenue;
  if (trail.length) {
    const avgRev = mean(trail.map((m) => m.operatingIn));
    const avgExp = mean(trail.map((m) => m.operatingOut));
    const note = hasCategories
      ? 'Operating flows only: transfers, loans, owner and investment movements are excluded.'
      : 'No category column: all inflows are treated as revenue and all outflows as expenses.';
    revenue = avail(round(avgRev), { monthsUsed: trail.length, note });
    expenses = avail(round(avgExp), { monthsUsed: trail.length, note });
    margin = avgRev > 0 ? avail((avgRev - avgExp) / avgRev, { monthsUsed: trail.length }) : unavail('No operating revenue in the trailing months.');
  }

  // burn and runway (based on total net cash movement of the last complete months)
  let burn = unavail('Needs at least 2 complete months of data.');
  let runway = burn;
  if (complete.length >= 2) {
    const used = complete.slice(-3);
    const avgNet = mean(used.map((m) => m.net));
    const avgOut = mean(used.map((m) => m.outflow));
    burn = avail(round(Math.max(0, -avgNet)), { avgMonthlyNet: round(avgNet), avgMonthlyOutflow: round(avgOut), monthsUsed: used.length });
    if (!cash.available) runway = unavail('Cash on hand is unknown, so runway cannot be calculated.');
    else if (cash.value <= 0) runway = avail(0, { note: 'Cash balance is zero or negative.' });
    else if (avgNet >= 0) runway = avail(Infinity, { note: 'Average net cash flow is not negative.' });
    else runway = avail(cash.value / -avgNet, { monthsUsed: used.length });
  }

  // receivables / payables
  const receivables = open.some((t) => t.amount > 0) ? ageing(open, 1, asOf, terms) : null;
  const payables = open.some((t) => t.amount < 0) ? ageing(open, -1, asOf, terms) : null;

  // customer concentration over up to 6 complete months (or all history if shorter)
  const win = complete.slice(-6).map((m) => m.key);
  const inWin = (t) => (win.length ? win.includes(monthKey(t.date)) : true);
  const revRows = settled.filter((t) => t.amount > 0 && isOperating(t) && inWin(t));
  const revTotal = sum(revRows.map((t) => t.amount));
  const withParty = revRows.filter((t) => t.counterparty);
  let customers = unavail('No customer/supplier column was mapped.');
  if (withParty.length && sum(withParty.map((t) => t.amount)) / (revTotal || 1) >= 0.3) {
    const by = new Map();
    for (const t of withParty) by.set(t.counterparty, (by.get(t.counterparty) || 0) + t.amount);
    const partyTotal = sum([...by.values()]);
    // share is measured against ALL operating revenue (unnamed card/cash sales are many small customers)
    const top = [...by.entries()].map(([name, amount]) => ({ name, amount: round(amount), share: amount / revTotal, shareOfIdentified: amount / partyTotal }))
      .sort((a, b) => b.amount - a.amount).slice(0, 8);
    customers = avail(top, { topShare: top[0].share, topShareOfIdentified: top[0].shareOfIdentified, topName: top[0].name, coverage: partyTotal / revTotal, monthsUsed: win.length || 1, partyTotal: round(partyTotal), revenueTotal: round(revTotal) });
  }

  // spending by category over the same trailing window, and per-month category series
  const spendRows = settled.filter((t) => t.amount < 0 && isOperating(t));
  const catMonth = new Map();
  for (const t of spendRows) {
    const c = categoryOf(t);
    if (!catMonth.has(c)) catMonth.set(c, new Map());
    const mm = catMonth.get(c);
    mm.set(monthKey(t.date), (mm.get(monthKey(t.date)) || 0) + -t.amount);
  }
  const trailKeys = trail.map((m) => m.key);
  const categories = [...catMonth.entries()]
    .map(([name, mm]) => ({ name, amount: round(sum(trailKeys.map((k) => mm.get(k) || 0))) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const catTotal = sum(categories.map((c) => c.amount));
  categories.forEach((c) => {
    c.share = catTotal ? c.amount / catTotal : 0;
  });

  const mom = lastMonth && prevMonth
    ? {
        inflowChange: prevMonth.inflow ? (lastMonth.inflow - prevMonth.inflow) / prevMonth.inflow : null,
        outflowChange: prevMonth.outflow ? (lastMonth.outflow - prevMonth.outflow) / prevMonth.outflow : null,
        netChange: round(lastMonth.net - prevMonth.net),
      }
    : null;

  return {
    empty: false,
    settings, asOf, period: { first, last, days: diffDays(last, first) + 1 },
    counts: { settled: settled.length, open: open.length },
    months, completeMonths: complete.map((m) => m.key), lastMonth, prevMonth,
    totals: { inflow: totalIn, outflow: totalOut, net: round(totalIn - totalOut) },
    cash, revenue, expenses, margin, burn, runway,
    receivables, payables, terms, lateness, customers, categories, catMonth, mom,
    recent: settled.slice(-10).reverse(),
    hasCategories,
  };
}
