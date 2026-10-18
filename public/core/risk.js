// Early-warning risk engine. Every alert is rule-based, carries the exact evidence that triggered it,
// and links to the actions that address it. No alert is produced by a language model.

import { sum, mean, median, robustStd, diffDays, addDays, normalizeKey, round } from './util.js';
import { money, pct, shortDate } from './format.js';

const RANK = { critical: 4, high: 3, medium: 2, low: 1 };

export function riskRank(sev) {
  return RANK[sev] || 0;
}

export function detectRisks({ transactions, metrics, prep, forecast, importStats }) {
  if (metrics.empty) return [];
  const cur = metrics.settings.currency;
  const m$ = (v) => money(v, cur);
  const risks = [];
  const push = (r) => risks.push({ evidence: [], actionCodes: [], impact: 0, ...r });

  // 1. Projected cash shortage
  if (forecast?.available) {
    const fs = forecast.firstShortfall;
    const fr = forecast.firstAtRisk;
    const weekOut = (w) => forecast.scheduled.filter((s) => s.week === w && s.amount < 0).slice(0, 3)
      .map((s) => `${s.label} ${m$(-s.amount)}`).join(', ');
    if (fs) {
      push({
        id: 'cash_shortage', code: 'cash_shortage', severity: 'critical',
        title: `Projected cash shortfall in week ${fs.week}`,
        summary: `In the central forecast, cash falls below zero around ${shortDate(fs.date)} (week ${fs.week}) and reaches ${m$(forecast.minBalance.value)} at its lowest point (week ${forecast.minBalance.week}).`,
        impact: Math.abs(forecast.minBalance.value),
        evidence: [
          { label: 'Cash today', text: forecast.relative ? 'unknown (relative view)' : m$(forecast.startingBalance) },
          { label: `Balance, week ${fs.week}`, text: m$(fs.balance) },
          { label: 'Lowest projected balance', text: `${m$(forecast.minBalance.value)} (week ${forecast.minBalance.week})` },
          ...(weekOut(fs.week) ? [{ label: `Largest payments in week ${fs.week}`, text: weekOut(fs.week) }] : []),
        ],
        actionCodes: ['collect_overdue', 'delay_payables', 'bridge_financing', 'cut_spend'],
      });
    } else if (fr) {
      push({
        id: 'cash_downside', code: 'cash_downside', severity: fr.week <= 4 ? 'high' : 'medium',
        title: `Cash could run short in week ${fr.week} in a downside case`,
        summary: `The central forecast stays positive, but the 80% downside range reaches ${m$(fr.low)} in week ${fr.week}.`,
        impact: Math.abs(fr.low),
        evidence: [
          { label: 'Central balance', text: m$(fr.balance) },
          { label: 'Downside (10th percentile)', text: m$(fr.low) },
          { label: 'Lowest central balance', text: `${m$(forecast.minBalance.value)} (week ${forecast.minBalance.week})` },
        ],
        actionCodes: ['collect_overdue', 'delay_payables', 'bridge_financing'],
      });
    } else if (forecast.firstBelowBuffer) {
      const b = forecast.firstBelowBuffer;
      push({
        id: 'buffer_breach', code: 'buffer_breach', severity: 'medium',
        title: `Cash dips below your safety buffer in week ${b.week}`,
        summary: `Projected cash of ${m$(b.balance)} is under your minimum buffer of ${m$(metrics.settings.minimumCashBuffer)}.`,
        impact: metrics.settings.minimumCashBuffer - b.balance,
        evidence: [{ label: 'Projected balance', text: m$(b.balance) }, { label: 'Minimum buffer', text: m$(metrics.settings.minimumCashBuffer) }],
        actionCodes: ['collect_overdue', 'delay_payables'],
      });
    }
  }

  // 2. Runway
  if (metrics.runway.available && metrics.runway.value !== Infinity && metrics.runway.value < 6) {
    const r = metrics.runway.value;
    push({
      id: 'low_runway', code: 'low_runway', severity: r < 1 ? 'critical' : r < 3 ? 'high' : 'medium',
      title: `Cash runway is ${r.toFixed(1)} months`,
      summary: `At the recent average net outflow of ${m$(metrics.burn.value)} per month, cash on hand lasts about ${r.toFixed(1)} months.`,
      impact: metrics.burn.value * 3,
      evidence: [{ label: 'Cash on hand', text: m$(metrics.cash.value) }, { label: 'Average monthly net outflow', text: m$(metrics.burn.value) }, { label: 'Runway', text: `${r.toFixed(1)} months` }],
      actionCodes: ['cut_spend', 'bridge_financing'],
    });
  }

  // 3. Declining cash flow
  const cm = metrics.months.filter((m) => m.complete);
  if (cm.length >= 3) {
    const [a, b, c] = cm.slice(-3);
    const neg2 = b.net < 0 && c.net < 0;
    const falling = a.net > b.net && b.net > c.net && c.net < 0;
    if (neg2 || falling) {
      const avg = mean([a.net, b.net, c.net]);
      push({
        id: 'declining_cashflow', code: 'declining_cashflow', severity: avg < -0.1 * mean([a.outflow, b.outflow, c.outflow]) ? 'high' : 'medium',
        title: 'Net cash flow has been negative or falling',
        summary: `Net cash flow over the last three complete months was ${m$(a.net)}, ${m$(b.net)} and ${m$(c.net)}.`,
        impact: Math.abs(Math.min(0, avg)) * 3,
        evidence: [a, b, c].map((x) => ({ label: x.key, text: `${m$(x.net)} net (${m$(x.inflow)} in, ${m$(x.outflow)} out)` })),
        actionCodes: ['cut_spend', 'collect_overdue'],
      });
    }
  }

  // 4. Overdue receivables
  const ar = metrics.receivables;
  if (ar && ar.overdue > 0 && ar.overdueShare >= 0.15) {
    const old = ar.items.filter((i) => i.daysPastDue > 0);
    const byParty = new Map();
    for (const i of old) {
      const key = i.counterparty || i.label || 'Unknown';
      byParty.set(key, (byParty.get(key) || 0) + i.amountAbs);
    }
    const top = [...byParty.entries()].sort((x, y) => y[1] - x[1])[0];
    const serious = ar.buckets.d31_60 + ar.buckets.d61plus;
    push({
      id: 'overdue_receivables', code: 'overdue_receivables',
      severity: ar.overdueShare >= 0.4 || serious > 0.1 * ar.total ? 'high' : 'medium',
      title: `${m$(ar.overdue)} of receivables are overdue`,
      summary: `${pct(ar.overdueShare)} of the ${m$(ar.total)} owed by customers is past its due date${top ? `, mostly from ${top[0]}` : ''}.`,
      impact: ar.overdue,
      evidence: [
        { label: 'Total receivables', text: m$(ar.total) },
        { label: 'Overdue', text: `${m$(ar.overdue)} (${pct(ar.overdueShare)})` },
        { label: 'Oldest overdue invoice', text: old[0] ? `${old[0].counterparty || old[0].label} ${old[0].reference || ''} — ${old[0].daysPastDue} days, ${m$(old[0].amountAbs)}` : '—' },
        ...(top ? [{ label: 'Largest overdue customer', text: `${top[0]} ${m$(top[1])}` }] : []),
      ],
      actionCodes: ['collect_overdue'],
    });
  }

  // 5. Customer concentration
  if (metrics.customers.available && metrics.customers.topShare >= 0.2) {
    const c = metrics.customers;
    const overdueFromTop = ar ? sum(ar.items.filter((i) => i.counterparty === c.topName && i.daysPastDue > 0).map((i) => i.amountAbs)) : 0;
    push({
      id: 'customer_concentration', code: 'customer_concentration', severity: c.topShare >= 0.35 ? 'high' : 'medium',
      title: `${c.topName} is ${pct(c.topShare)} of revenue`,
      summary: `One customer accounts for ${pct(c.topShare)} of operating revenue over the last ${c.monthsUsed} month(s). Losing or delaying this customer would materially affect cash.`,
      impact: c.value[0].amount / Math.max(1, c.monthsUsed),
      evidence: [
        { label: 'Share of operating revenue', text: pct(c.topShare) },
        { label: 'Revenue from this customer', text: `${m$(c.value[0].amount)} over ${c.monthsUsed} month(s)` },
        ...(overdueFromTop > 0 ? [{ label: 'Currently overdue from this customer', text: m$(overdueFromTop) }] : []),
      ],
      actionCodes: ['diversify_customers', 'collect_overdue'],
    });
  }

  // 6. Expense spike (latest complete month vs the three before it)
  if (metrics.lastMonth && cm.length >= 4) {
    const keys = cm.map((m) => m.key);
    const latest = keys[keys.length - 1];
    const prior = keys.slice(-4, -1);
    const spikes = [];
    for (const [cat, mm] of metrics.catMonth) {
      const now = mm.get(latest) || 0;
      const avg = mean(prior.map((k) => mm.get(k) || 0));
      const delta = now - avg;
      if (avg > 0 && now / avg >= 1.4 && delta >= Math.max(500, 0.015 * metrics.burn.avgMonthlyOutflow)) spikes.push({ cat, now, avg, delta });
    }
    spikes.sort((a, b) => b.delta - a.delta);
    if (spikes.length) {
      const s = spikes[0];
      push({
        id: 'expense_spike', code: 'expense_spike', severity: s.delta > 0.08 * metrics.burn.avgMonthlyOutflow ? 'medium' : 'low',
        title: `${s.cat} spending jumped ${pct(s.now / s.avg - 1)} in ${latest}`,
        summary: `${s.cat} cost ${m$(s.now)} in ${latest} against an average of ${m$(s.avg)} in the previous three months.`,
        impact: s.delta,
        evidence: spikes.slice(0, 3).map((x) => ({ label: x.cat, text: `${m$(x.now)} vs ${m$(x.avg)} average (+${m$(x.delta)})` })),
        actionCodes: ['review_spike'],
      });
    }
  }

  // 7. Unusual one-off payments (global outlier among non-recurring, non-invoice outflows)
  const recurringIds = new Set();
  prep?.recurring?.forEach((g) => g.ids.forEach((id) => recurringIds.add(id)));
  const pool = transactions.filter((t) => t.status === 'settled' && t.amount < 0 && !t.dueDate && !recurringIds.has(t.id));
  if (pool.length >= 20) {
    // robust outlier test on the log scale: payment sizes are heavy-tailed, so compare orders of magnitude
    const amts = pool.map((t) => -t.amount);
    const logs = amts.map((a) => Math.log(a));
    const med = median(amts);
    const scaleFloor = Math.max(500, 0.03 * (metrics.burn.available ? metrics.burn.avgMonthlyOutflow : 0));
    const fence = Math.max(Math.exp(median(logs) + 2.5 * robustStd(logs)), 3 * med, scaleFloor);
    const since = addDays(metrics.asOf, -45);
    const odd = pool.filter((t) => -t.amount > fence && t.date >= since).sort((a, b) => a.amount - b.amount);
    if (odd.length) {
      push({
        id: 'unusual_payments', code: 'unusual_payments', severity: 'low',
        title: `${odd.length} unusually large payment${odd.length > 1 ? 's' : ''} in the last 45 days`,
        summary: `${odd.length > 1 ? 'These payments are' : 'This payment is'} far above the normal size of one-off outflows (anything above about ${m$(fence)} is unusual for this business).`,
        impact: sum(odd.map((t) => -t.amount)),
        evidence: odd.slice(0, 4).map((t) => ({ label: shortDate(t.date), text: `${t.description || t.counterparty} — ${m$(-t.amount)}` })),
        actionCodes: ['review_spike'],
      });
    }
  }

  // 8. Possible duplicate payments
  const dups = [];
  const outs = transactions.filter((t) => t.status === 'settled' && t.amount < 0 && t.date >= addDays(metrics.asOf, -180));
  const groups = new Map();
  for (const t of outs) {
    const k = `${normalizeKey(t.counterparty || t.description)}|${t.amount}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  for (const rows of groups.values()) {
    for (let i = 1; i < rows.length; i++) {
      const gap = diffDays(rows[i].date, rows[i - 1].date);
      if (gap >= 0 && gap <= 5 && rows[i - 1].amount !== 0 && (rows[i].reference ? rows[i].reference === rows[i - 1].reference : true)) {
        dups.push({ a: rows[i - 1], b: rows[i], gap });
      }
    }
  }
  const realDups = dups.filter((d) => Math.abs(d.a.amount) >= 100);
  if (realDups.length) {
    const d = realDups.sort((x, y) => x.a.amount - y.a.amount)[0];
    push({
      id: 'possible_duplicate', code: 'possible_duplicate', severity: 'medium',
      title: `Possible duplicate payment to ${d.a.counterparty || d.a.description}`,
      summary: `${m$(-d.a.amount)} was paid twice within ${d.gap} day(s)${d.a.reference ? ` against ${d.a.reference}` : ''}.`,
      impact: -d.a.amount,
      evidence: [{ label: 'First payment', text: `${shortDate(d.a.date)} — ${m$(-d.a.amount)}` }, { label: 'Second payment', text: `${shortDate(d.b.date)} — ${m$(-d.b.amount)}` }, ...(d.a.reference ? [{ label: 'Reference', text: d.a.reference }] : [])],
      actionCodes: ['recover_duplicate'],
      meta: { amount: -d.a.amount, counterparty: d.a.counterparty || d.a.description, reference: d.a.reference },
    });
  }

  // 9. Payables due soon relative to cash
  const ap = metrics.payables;
  if (ap && metrics.cash.available && metrics.cash.value > 0) {
    const soon = ap.items.filter((i) => diffDays(i.due, metrics.asOf) <= 14);
    const total = sum(soon.map((i) => i.amountAbs));
    if (total >= 0.5 * metrics.cash.value) {
      push({
        id: 'payables_pressure', code: 'payables_pressure', severity: total >= metrics.cash.value ? 'critical' : 'high',
        title: `${m$(total)} of supplier bills fall due within 14 days`,
        summary: `Bills due in the next two weeks equal ${pct(total / metrics.cash.value)} of cash on hand.`,
        impact: total,
        evidence: soon.slice(0, 4).map((i) => ({ label: `${i.counterparty || i.label} ${i.reference || ''}`.trim(), text: `${m$(i.amountAbs)} due ${shortDate(i.due)}` })),
        actionCodes: ['delay_payables', 'bridge_financing'],
      });
    }
  }

  // 10. Margin
  if (metrics.margin.available && metrics.margin.value < 0) {
    push({
      id: 'negative_margin', code: 'negative_margin', severity: metrics.margin.value < -0.05 ? 'high' : 'medium',
      title: `Operating margin is ${pct(metrics.margin.value, 1)}`,
      summary: `Operating expenses exceeded operating revenue by ${pct(-metrics.margin.value, 1)} over the trailing ${metrics.margin.monthsUsed} month(s).`,
      impact: Math.abs(metrics.revenue.value - metrics.expenses.value) * 3,
      evidence: [{ label: 'Average monthly revenue', text: m$(metrics.revenue.value) }, { label: 'Average monthly expenses', text: m$(metrics.expenses.value) }],
      actionCodes: ['cut_spend'],
    });
  }

  // 11. Data quality
  if (importStats && importStats.rowsRead && importStats.rowsSkipped / importStats.rowsRead > 0.1) {
    push({
      id: 'data_quality', code: 'data_quality', severity: 'low',
      title: `${importStats.rowsSkipped} rows could not be imported`,
      summary: 'More than 10% of rows were skipped, so totals may under-state activity. Review the import report.',
      evidence: [{ label: 'Rows read', text: String(importStats.rowsRead) }, { label: 'Rows skipped', text: String(importStats.rowsSkipped) }],
      actionCodes: [],
    });
  }

  return risks
    .map((r) => ({ ...r, impact: round(r.impact || 0, 0) }))
    .sort((a, b) => riskRank(b.severity) - riskRank(a.severity) || b.impact - a.impact);
}
