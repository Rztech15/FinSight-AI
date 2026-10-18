// Generates the SYNTHETIC demo dataset for "Harbor & Pine Roasters", a fictional specialty-coffee
// café + wholesale business. All names and numbers are invented; a seeded generator keeps the file
// reproducible:  node scripts/make-sample.mjs
//
// The story built into the data (so judges can see the engines work):
//   * café sales soften from June 2026, the largest wholesale customer starts paying later and later
//   * an unusually large green-coffee shipment and the quarterly tax bill fall due in the next weeks
//   * a duplicated supplier payment, an equipment repair and a September marketing spike are present

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { addDays, diffDays, addMonths, endOfMonth } from '../public/core/util.js';

const START = '2025-10-01';
const ASOF = '2026-10-14';
const OPENING = 19000;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261017);
const jitter = (base, pct) => base * (1 + (rnd() * 2 - 1) * pct);
const r2 = (n) => Math.round(n * 100) / 100;
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 Sun
const monthsSince = (iso) => (Number(iso.slice(0, 4)) - 2025) * 12 + Number(iso.slice(5, 7)) - 10;

const rows = []; // {date, desc, head, party, ref, status, due, amount, open, seq}
let seq = 0;
const add = (r) => rows.push({ party: '', ref: '', status: '', due: '', open: false, seq: seq++, ...r });

// ---- daily / weekly sales
for (let d = START; d <= ASOF; d = addDays(d, 1)) {
  const m = monthsSince(d);
  const soften = d >= '2026-06-01' ? 0.86 : 1;
  const base = [840, 620, 610, 640, 660, 760, 980][dow(d)];
  add({ date: d, desc: 'Card settlement - cafe', head: 'Sales - Cafe', amount: r2(jitter(base * soften, 0.15)) });
  if (dow(d) === 1) add({ date: d, desc: 'Online store payout', head: 'Sales - Online', amount: r2(jitter(1700 + m * 55, 0.12)) });
  if (dow(d) === 5) add({ date: d, desc: 'Dairy Fresh Co', head: 'COGS - Dairy', amount: -r2(jitter(520, 0.12)) });
  if (rnd() < 0.35 && dow(d) !== 0) add({ date: d, desc: 'Cafe supplies', head: 'Supplies', amount: -r2(jitter(110, 0.5)) });
}

// ---- fixed monthly items
const monthStarts = [];
for (let m = START.slice(0, 7) + '-01'; m <= ASOF; m = addMonths(m, 1, 1)) monthStarts.push(m);
for (const ms of monthStarts) {
  const on = (day) => addMonths(ms, 0, day);
  const items = [
    [on(1), 'Rent - Unit 4 Harbor St', 'Rent', -4800, 'Harbor Property Group'],
    [on(3), 'Shopify subscription', 'Software', -79, 'Shopify'],
    [on(4), 'Square subscription', 'Software', -89, 'Square'],
    [on(5), 'Loan repayment - term loan', 'Loan repayment', -2150, 'First Coastal Bank'],
    [on(6), 'Xero subscription', 'Software', -42, 'Xero'],
    [on(8), 'Utility bill', 'Utilities', -r2(jitter(640, 0.1)), 'City Utilities'],
    [on(12), 'Business insurance premium', 'Insurance', -410, 'SafeHarbor Insurance'],
    [on(20), 'Meta Ads', 'Marketing', -r2(jitter(1150, 0.12)), 'Meta'],
  ];
  const payroll = ms >= '2026-03-01' ? 11750 : 11200;
  items.push([on(15), 'Payroll run', 'Payroll', -payroll, 'Payroll']);
  items.push([endOfMonth(ms), 'Payroll run', 'Payroll', -payroll, 'Payroll']);
  for (const [date, desc, head, amount, party] of items) {
    if (date <= ASOF && date >= START) add({ date, desc, head, amount, party });
  }
}
// quarterly sales tax
for (const date of ['2025-10-15', '2026-01-15', '2026-04-15', '2026-07-15']) {
  add({ date, desc: 'Sales tax remittance', head: 'Tax', amount: -5900, party: 'State Revenue Dept' });
}
// one-offs
add({ date: '2026-09-12', desc: 'Brand campaign - Summer Roast launch', head: 'Marketing', amount: -6400, party: 'Meta' });
add({ date: '2026-09-22', desc: 'Espresso machine repair', head: 'Equipment', amount: -3950, party: 'BrewTech Service' });

// ---- invoices (wholesale receivables, supplier payables)
let invNo = 1040;
function invoice({ date, party, amount, termsDays, payLate, kind, prefix, headOut = 'COGS - Green coffee' }) {
  const due = addDays(date, termsDays);
  const paid = addDays(due, payLate);
  const ref = `${prefix}-${invNo++}`;
  const sign = kind === 'in' ? 1 : -1;
  if (paid <= ASOF) {
    add({ date: paid, desc: kind === 'in' ? `Payment received ${ref}` : `Payment sent ${ref}`, head: kind === 'in' ? 'Sales - Wholesale' : headOut, amount: sign * amount, party, ref, status: 'Paid', due });
  } else {
    const overdue = due < ASOF;
    add({ date, desc: kind === 'in' ? `Invoice ${ref}` : `Bill ${ref}`, head: kind === 'in' ? 'Sales - Wholesale' : headOut, amount: sign * amount, party, ref, status: overdue ? 'Overdue' : 'Unpaid', due, open: true });
  }
}
const customers = [
  { party: 'Brightside Hotels', perMonth: 4, amount: 4100, late: (m) => Math.round(2 + Math.max(0, m - 5) * 6) },
  { party: 'Maple Street Grocers', perMonth: 2, amount: 1900, late: () => 4 },
  { party: 'Northgate Offices', perMonth: 2, amount: 1250, late: () => 6 },
  { party: 'Lakeview Bistros', perMonth: 2, amount: 1650, late: () => 3 },
  { party: 'Corner Co-op', perMonth: 1, amount: 1100, late: () => 8 },
];
for (const c of customers) {
  for (const ms of monthStarts) {
    for (let k = 0; k < c.perMonth; k++) {
      const date = addMonths(ms, 0, Math.min(27, 2 + Math.floor((k * 28) / c.perMonth) + Math.floor(rnd() * 3)));
      if (date > ASOF) continue;
      const m = monthsSince(date);
      invoice({ date, party: c.party, amount: r2(jitter(c.amount, 0.1)), termsDays: 30, payLate: Math.max(0, c.late(m) + Math.round((rnd() - 0.5) * 4)), kind: 'in', prefix: 'INV' });
    }
  }
}
// supplier bills
const origin = ['2025-10-06', '2025-11-06', '2025-12-05', '2026-01-08', '2026-02-06', '2026-03-09', '2026-04-07', '2026-05-08', '2026-06-08', '2026-07-09', '2026-08-07', '2026-09-08'];
origin.forEach((date, i) => invoice({ date, party: 'Origin Direct Imports', amount: r2(jitter(13800 + i * 190, 0.05)), termsDays: 45, payLate: 3, kind: 'out', prefix: 'OD' }));
invoice({ date: '2026-10-12', party: 'Origin Direct Imports', amount: 24500, termsDays: 45, payLate: 3, kind: 'out', prefix: 'OD' });
for (const ms of monthStarts) {
  const date = addMonths(ms, 0, 10);
  if (date > ASOF) continue;
  const amount = ms === '2026-08-01' ? 2140 : r2(jitter(2250, 0.06));
  invoice({ date, party: 'PackRight Supplies', amount, termsDays: 30, payLate: 0, kind: 'out', prefix: 'PR', headOut: 'COGS - Packaging' });
}
// duplicated supplier payment (same invoice paid twice, two days apart)
const dup = rows.find((r) => r.party === 'PackRight Supplies' && r.amount === -2140 && r.status === 'Paid');
if (dup) add({ ...dup, date: addDays(dup.date, 2), seq: seq++ });

// ---- order, balance, write
const ordered = rows.filter((r) => r.date >= START).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
let bal = OPENING;
const q = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const fmt = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const header = ['Txn Date', 'Narration', 'Head', 'Withdrawal', 'Deposit', 'Running Balance', 'Party', 'Invoice No', 'Payment Status', 'Due On', 'Account'];
const lines = [header.join(',')];
for (const r of ordered) {
  if (!r.open) bal = r2(bal + r.amount);
  lines.push([
    fmt(r.date), q(r.desc), q(r.head), r.amount < 0 ? Math.abs(r.amount).toFixed(2) : '', r.amount > 0 ? r.amount.toFixed(2) : '',
    r.open ? '' : bal.toFixed(2), q(r.party), r.ref, r.status, r.due ? fmt(r.due) : '', 'Operating',
  ].join(','));
}
const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, '..', 'public', 'samples'), { recursive: true });
const out = join(here, '..', 'public', 'samples', 'harbor-pine-roasters-demo.csv');
writeFileSync(out, lines.join('\n') + '\n');
console.log(`Wrote ${ordered.length} rows to ${out}; closing balance ${bal.toFixed(2)} as of ${ASOF}.`);
void diffDays;
