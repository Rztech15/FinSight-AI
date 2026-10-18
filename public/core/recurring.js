// Recurring-payment detection (rent, payroll, subscriptions, loan repayments, quarterly taxes).
// A group is recurring when it repeats at a regular cadence with a stable amount. Detection is
// purely statistical and every detected item is shown to the user with its evidence.

import { diffDays, addDays, addMonths, median, mean, std, normalizeKey } from './util.js';

const CADENCES = [
  { name: 'weekly', lo: 6, hi: 8, minOccurrences: 6 },
  { name: 'biweekly', lo: 13, hi: 16, minOccurrences: 4 },
  { name: 'monthly', lo: 26, hi: 35, minOccurrences: 3 },
  { name: 'quarterly', lo: 84, hi: 98, minOccurrences: 3 },
];

export function recurringKey(t) {
  const label = normalizeKey(t.counterparty || t.description);
  return label ? `${Math.sign(t.amount)}|${label}` : null;
}

export function detectRecurring(settled, asOf, horizonDays = 182) {
  const since = addDays(asOf, -400);
  const groups = new Map();
  for (const t of settled) {
    if (t.dueDate || t.date > asOf || t.date < since) continue;
    const k = recurringKey(t);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = [];
  for (const [key, rows] of groups) {
    if (rows.length < 3) continue;
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    const gaps = [];
    for (let i = 1; i < rows.length; i++) gaps.push(diffDays(rows[i].date, rows[i - 1].date));
    const gapsPos = gaps.filter((g) => g > 0);
    if (gapsPos.length < 2) continue;
    const med = median(gapsPos);
    const cad = CADENCES.find((c) => med >= c.lo && med <= c.hi);
    if (!cad || rows.length < cad.minOccurrences) continue;
    const inWindow = gapsPos.filter((g) => g >= cad.lo * 0.75 && g <= cad.hi * 1.25).length / gapsPos.length;
    if (inWindow < 0.7) continue;
    const abs = rows.map((r) => Math.abs(r.amount));
    const cv = std(abs) / (mean(abs) || 1);
    if (cv > 0.2) continue;
    const last = rows[rows.length - 1];
    const cadenceDays = Math.round(med);
    if (diffDays(asOf, last.date) > cadenceDays * 1.5 + 5) continue; // stopped repeating
    const recentAmounts = rows.slice(-3).map((r) => r.amount);
    const amount = median(recentAmounts);
    const nextDates = [];
    const end = addDays(asOf, horizonDays);
    let cur = last.date;
    const dom = Number(last.date.slice(8, 10));
    for (let i = 1; i < 60; i++) {
      cur = cad.name === 'monthly' ? addMonths(last.date, i, dom)
        : cad.name === 'quarterly' ? addMonths(last.date, 3 * i, dom)
          : addDays(cur, cadenceDays);
      if (cur > end) break;
      if (cur > asOf) nextDates.push(cur);
    }
    out.push({
      key, label: last.counterparty || last.description, sign: Math.sign(last.amount), cadence: cad.name,
      cadenceDays, amount, count: rows.length, lastDate: last.date, amountVariation: cv, nextDates,
      ids: new Set(rows.map((r) => r.id)),
    });
  }
  return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}
