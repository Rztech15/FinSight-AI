// Shared test builders. Datasets are built through the real import pipeline (normalizeRows),
// so tests exercise the same code path as a user upload.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCSV } from '../public/core/csv.js';
import { detectColumns, normalizeRows } from '../public/core/ingest.js';
import { addDays, diffDays } from '../public/core/util.js';

export const SAMPLE_PATH = fileURLToPath(new URL('../public/samples/harbor-pine-roasters-demo.csv', import.meta.url));

const IDENTITY = ['date', 'description', 'amount', 'category', 'counterparty', 'reference', 'dueDate', 'status', 'balance', 'account'];

/** rows: [{date, amount, description?, category?, counterparty?, reference?, dueDate?, status?, balance?}] */
export function build(rows) {
  const used = IDENTITY.filter((k) => rows.some((r) => r[k] !== undefined));
  const mapping = Object.fromEntries(IDENTITY.map((k) => [k, used.includes(k) ? k : null]));
  const raw = rows.map((r) => Object.fromEntries(used.map((k) => [k, r[k] ?? ''])));
  return normalizeRows(raw, mapping);
}

export function loadSample() {
  const t = parseCSV(readFileSync(SAMPLE_PATH, 'utf8'));
  const d = detectColumns(t.headers, t.rows);
  return { table: t, detected: d, ...normalizeRows(t.rows, d.mapping) };
}

/** Steady business: weekly sales (Mon), weekly supplies (Fri), monthly rent on the 1st. */
export function steadyRows({ start = '2026-01-01', end = '2026-06-30', sales = 1000, supplies = 600, rent = 2000 } = {}) {
  const rows = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 1) rows.push({ date: d, amount: sales, description: 'Weekly sales', category: 'Sales' });
    if (dow === 5) rows.push({ date: d, amount: -supplies, description: 'Weekly supplies', category: 'Supplies' });
    if (d.endsWith('-01')) rows.push({ date: d, amount: -rent, description: 'Rent', category: 'Rent' });
  }
  return rows;
}

export const countFirsts = (asOf, weeks) => {
  let n = 0;
  for (let i = 1; i <= weeks * 7; i++) if (addDays(asOf, i).endsWith('-01')) n++;
  return n;
};
export { diffDays };
