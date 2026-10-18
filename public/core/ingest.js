// Financial data ingestion: column detection, field mapping, validation and normalisation.
//
// Normalised transaction:
//   { id, row, date, description, amount (+inflow / −outflow), category, account, counterparty,
//     reference, dueDate|null, status: 'settled'|'open', balance|null }
//
// Nothing is dropped silently: every skipped or suspicious row is reported in `issues`.

import { isValidISODate, toISO, cleanText, round, DAY_MS } from './util.js';

export const FIELDS = [
  'date', 'description', 'amount', 'debit', 'credit', 'type', 'category',
  'account', 'counterparty', 'reference', 'balance', 'dueDate', 'status',
];

export const FIELD_LABELS = {
  date: 'Transaction date', description: 'Description', amount: 'Amount (signed)', debit: 'Debit / money out',
  credit: 'Credit / money in', type: 'Transaction type', category: 'Category', account: 'Account',
  counterparty: 'Customer / supplier', reference: 'Invoice / reference', balance: 'Running balance',
  dueDate: 'Due date', status: 'Payment status',
};

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

// ---------------------------------------------------------------- dates

function iso(y, m, d) {
  if (y < 1990 || y > 2100) return null;
  const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidISODate(s) ? s : null;
}

/** Excel serial date (1900 system) → ISO. */
export function excelSerialToISO(serial) {
  if (!Number.isFinite(serial) || serial < 25569 || serial > 73050) return null;
  return toISO(Math.round((serial - 25569) * DAY_MS));
}

/**
 * Parse a date cell. `dayFirst` resolves ambiguous 01/02/2026 style dates (true → 1 Feb).
 * Returns an ISO string or null.
 */
export function parseDate(value, { dayFirst = false } = {}) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return excelSerialToISO(value);
  const s = String(value).trim();
  if (!s) return null;
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s))) return iso(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T\s].*)?$/.exec(s))) {
    let a = +m[1];
    let b = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (a > 12) return iso(y, b, a);
    if (b > 12) return iso(y, a, b);
    return dayFirst ? iso(y, b, a) : iso(y, a, b);
  }
  if ((m = /^(\d{1,2})[\s\-./]([A-Za-z]{3,9})[\s\-.,/]+(\d{2,4})$/.exec(s))) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
    let y = +m[3];
    if (y < 100) y += 2000;
    return mo ? iso(y, mo, +m[1]) : null;
  }
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mo ? iso(+m[3], mo, +m[2]) : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToISO(Number(s));
  return null;
}

/** Look at slash/dash dates in a column and decide DMY vs MDY. Returns {dayFirst, ambiguous}. */
export function inferDayFirst(values) {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(String(v ?? '').trim());
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    else if (+m[2] > 12) mdy++;
  }
  if (dmy > mdy) return { dayFirst: true, ambiguous: false };
  if (mdy > dmy) return { dayFirst: false, ambiguous: false };
  const anySlash = values.some((v) => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(String(v ?? '').trim()));
  return { dayFirst: false, ambiguous: anySlash };
}

// ---------------------------------------------------------------- amounts

const CURRENCY_NOISE = /[$€£¥₨₹₦]|\b(?:usd|eur|gbp|pkr|inr|aed|cad|aud|sar|rs\.?)\b/gi;

/** Parse a money cell. Returns a number, null when empty, NaN when present but unreadable. */
export function parseAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let s = String(value).trim();
  if (!s || /^[-–—]+$/.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(CURRENCY_NOISE, '').replace(/[\s ']/g, '');
  if (/(?:dr|db)\.?$/i.test(s)) {
    neg = true;
    s = s.replace(/(?:dr|db)\.?$/i, '');
  } else if (/cr\.?$/i.test(s)) s = s.replace(/cr\.?$/i, '');
  if (/-$/.test(s)) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (/^[-−–]/.test(s)) {
    neg = !neg;
    s = s.slice(1);
  }
  if (/^\+/.test(s)) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1])) s = `${parts[0]}.${parts[1]}`;
    else s = s.replace(/,/g, '');
  } else if (lastDot >= 0 && s.split('.').length > 2) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}

// ---------------------------------------------------------------- column detection

const SYNONYMS = {
  date: { exact: ['date', 'transaction date', 'txn date', 'trans date', 'tran date', 'posting date', 'posted date', 'booking date', 'entry date', 'value date', 'day'], partial: ['date'] },
  dueDate: { exact: ['due date', 'due on', 'due', 'payment due', 'due by', 'pay by', 'maturity date'], partial: ['due'] },
  description: { exact: ['description', 'narration', 'details', 'memo', 'particulars', 'narrative', 'transaction details', 'remarks', 'note', 'notes', 'text'], partial: ['descr', 'narrat', 'particular', 'memo', 'detail', 'remark'] },
  amount: { exact: ['amount', 'transaction amount', 'amt', 'value', 'net amount', 'total'], partial: ['amount', 'amt'] },
  debit: { exact: ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'dr', 'outflow', 'debit amount'], partial: ['debit', 'withdraw', 'paid out', 'money out'] },
  credit: { exact: ['credit', 'credits', 'deposit', 'deposits', 'money in', 'paid in', 'cr', 'inflow', 'credit amount'], partial: ['credit', 'deposit', 'paid in', 'money in'] },
  type: { exact: ['type', 'transaction type', 'txn type', 'dr cr', 'cr dr', 'direction', 'kind'], partial: ['type', 'direction'] },
  category: { exact: ['category', 'head', 'account head', 'ledger', 'gl account', 'class', 'expense category', 'tag', 'group'], partial: ['categor', 'ledger', 'head'] },
  account: { exact: ['account', 'account name', 'bank account', 'wallet', 'bank', 'acct'], partial: ['account', 'acct'] },
  counterparty: { exact: ['counterparty', 'customer', 'client', 'supplier', 'vendor', 'payee', 'party', 'name', 'merchant', 'payer', 'customer supplier'], partial: ['customer', 'client', 'vendor', 'supplier', 'payee', 'merchant', 'party'] },
  reference: { exact: ['reference', 'ref', 'invoice', 'invoice no', 'invoice number', 'invoice', 'reference number', 'ref no', 'document no', 'doc no', 'bill no', 'transaction id', 'txn id', 'id'], partial: ['invoice', 'ref', 'document'] },
  balance: { exact: ['balance', 'running balance', 'closing balance', 'available balance', 'ending balance', 'bal'], partial: ['balance'] },
  status: { exact: ['status', 'payment status', 'invoice status', 'state', 'settlement status'], partial: ['status'] },
};

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function nameScore(field, header) {
  const h = norm(header);
  const syn = SYNONYMS[field];
  if (syn.exact.includes(h)) return 1;
  if (syn.partial.some((p) => h.includes(p))) return 0.7;
  return 0;
}

function sample(rows, header, n = 200) {
  const out = [];
  for (const r of rows) {
    const v = r[header];
    if (v !== '' && v !== null && v !== undefined) out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

function contentFactor(field, header, rows) {
  const vals = sample(rows, header);
  if (!vals.length) return 0.8; // empty sample: trust the header name
  if (field === 'date' || field === 'dueDate') {
    const dayFirst = inferDayFirst(vals.map(String)).dayFirst;
    const ok = vals.filter((v) => parseDate(v, { dayFirst }) !== null).length / vals.length;
    return ok >= 0.7 ? 1 : 0.35;
  }
  if (['amount', 'debit', 'credit', 'balance'].includes(field)) {
    const ok = vals.filter((v) => Number.isFinite(parseAmount(v))).length / vals.length;
    return ok >= 0.7 ? 1 : 0.3;
  }
  if (field === 'status' || field === 'type') {
    const distinct = new Set(vals.map((v) => String(v).toLowerCase())).size;
    return distinct <= 15 ? 1 : 0.4;
  }
  return 1;
}

/** Suggest a column mapping. Returns {mapping, confidence, notes}. Users can override every choice. */
export function detectColumns(headers, rows) {
  const scored = [];
  for (const field of FIELDS) {
    for (const h of headers) {
      const ns = nameScore(field, h);
      if (!ns) continue;
      scored.push({ field, header: h, score: ns * contentFactor(field, h, rows) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const mapping = Object.fromEntries(FIELDS.map((f) => [f, null]));
  const confidence = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const usedHeaders = new Set();
  for (const s of scored) {
    if (s.score < 0.5 || mapping[s.field] || usedHeaders.has(s.header)) continue;
    mapping[s.field] = s.header;
    confidence[s.field] = Number(s.score.toFixed(2));
    usedHeaders.add(s.header);
  }
  const notes = [];
  if (mapping.debit && mapping.credit && mapping.amount) {
    notes.push('Both Debit/Credit columns and an Amount column were found — using Debit/Credit.');
    mapping.amount = null;
    confidence.amount = 0;
  }
  if ((mapping.debit && !mapping.credit) || (!mapping.debit && mapping.credit)) {
    notes.push('Only one of Debit/Credit was found. Check whether it should be the Amount column instead.');
  }
  return { mapping, confidence, notes };
}

export function validateMapping(mapping) {
  const errors = [];
  const warnings = [];
  if (!mapping.date) errors.push('Choose the column that holds the transaction date.');
  if (!mapping.amount && !(mapping.debit && mapping.credit) && !(mapping.debit || mapping.credit)) {
    errors.push('Choose an Amount column, or a Debit and Credit column.');
  }
  if (mapping.amount && mapping.type) warnings.push('Amount + Type: unsigned amounts will be signed using the Type column.');
  if (!mapping.category) warnings.push('No Category column: spend analysis will group by description instead.');
  if (!mapping.balance) warnings.push('No running balance: provide an opening balance to calculate cash on hand.');
  if (!mapping.counterparty) warnings.push('No customer/supplier column: customer concentration cannot be measured.');
  if (!mapping.dueDate && !mapping.status) warnings.push('No due date or payment status: receivables and payables cannot be tracked.');
  return { errors, warnings, ok: errors.length === 0 };
}

// ---------------------------------------------------------------- normalisation

const OPEN_STATUS = /\b(unpaid|open|pending|outstanding|overdue|due|unsettled|invoiced|awaiting|partial)\b/i;
const PAID_STATUS = /\b(paid|settled|cleared|complete|completed|received|posted)\b/i;
const IN_TYPE = /(credit|income|inflow|receipt|deposit|sale|revenue|^cr$|^in$|received)/i;
const OUT_TYPE = /(debit|expense|outflow|payment|withdraw|purchase|cost|^dr$|^out$|paid|bill)/i;

function isOpenStatus(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (/\bunpaid\b|\bnot paid\b/i.test(s)) return true;
  if (PAID_STATUS.test(s)) return false;
  return OPEN_STATUS.test(s);
}

/**
 * Convert raw rows into validated transactions.
 * opts: { dayFirst: 'auto'|true|false, swapDebitCredit: boolean }
 */
export function normalizeRows(rawRows, mapping, opts = {}) {
  const issues = {
    skippedNoDate: [], skippedNoAmount: [], skippedZero: [], unknownType: [], unreadableBalance: 0,
    exactDuplicates: 0, ambiguousDates: false, dayFirstUsed: false,
  };
  const dateVals = mapping.date ? rawRows.map((r) => r[mapping.date]) : [];
  let dayFirst;
  if (opts.dayFirst === true || opts.dayFirst === false) dayFirst = opts.dayFirst;
  else {
    const inf = inferDayFirst(dateVals.map(String));
    dayFirst = inf.dayFirst;
    issues.ambiguousDates = inf.ambiguous;
  }
  issues.dayFirstUsed = dayFirst;

  const swap = !!opts.swapDebitCredit;
  const txns = [];
  const seen = new Set();
  rawRows.forEach((r, i) => {
    const rowNo = i + 2; // spreadsheet-style, header is row 1
    const get = (f) => (mapping[f] ? r[mapping[f]] : undefined);
    const rawDate = get('date');
    const rawAmount = get('amount');
    const rawDebit = get('debit');
    const rawCredit = get('credit');
    const allEmpty = [rawDate, rawAmount, rawDebit, rawCredit].every((v) => v === '' || v === undefined || v === null);
    if (allEmpty) return;
    const date = parseDate(rawDate, { dayFirst });
    if (!date) {
      issues.skippedNoDate.push(rowNo);
      return;
    }
    let amount = null;
    if (mapping.debit || mapping.credit) {
      const d = parseAmount(rawDebit);
      const c = parseAmount(rawCredit);
      if (Number.isNaN(d) || Number.isNaN(c)) amount = NaN;
      else if (d === null && c === null) amount = null;
      else {
        const inflow = swap ? d : c;
        const outflow = swap ? c : d;
        amount = (inflow || 0) - (outflow || 0);
        if (inflow && outflow === 0) amount = inflow;
      }
    } else if (mapping.amount) {
      amount = parseAmount(rawAmount);
    }
    if (amount === null || Number.isNaN(amount)) {
      issues.skippedNoAmount.push(rowNo);
      return;
    }
    if (mapping.type && mapping.amount && !(mapping.debit || mapping.credit)) {
      const t = String(get('type') ?? '').trim().toLowerCase();
      if (t) {
        if (OUT_TYPE.test(t) && !IN_TYPE.test(t)) amount = -Math.abs(amount);
        else if (IN_TYPE.test(t) && !OUT_TYPE.test(t)) amount = Math.abs(amount);
        else issues.unknownType.push(rowNo);
      }
    }
    if (amount === 0) {
      issues.skippedZero.push(rowNo);
      return;
    }
    const dueRaw = get('dueDate');
    const dueDate = dueRaw ? parseDate(dueRaw, { dayFirst }) : null;
    const open = mapping.status ? isOpenStatus(get('status')) : false;
    let balance = null;
    const rawBal = get('balance');
    if (rawBal !== undefined && rawBal !== '') {
      const b = parseAmount(rawBal);
      if (Number.isNaN(b)) issues.unreadableBalance++;
      else balance = b;
    }
    const t = {
      id: `t${txns.length}`,
      row: rowNo,
      date,
      description: cleanText(get('description'), 160),
      amount: round(amount, 2),
      category: cleanText(get('category'), 60),
      account: cleanText(get('account'), 60),
      counterparty: cleanText(get('counterparty'), 80),
      reference: cleanText(get('reference'), 60),
      dueDate,
      status: open ? 'open' : 'settled',
      balance: open ? null : balance,
    };
    const key = `${t.date}|${t.amount}|${t.description}|${t.reference}|${t.counterparty}|${t.account}|${t.status}`;
    if (seen.has(key)) issues.exactDuplicates++;
    seen.add(key);
    txns.push(t);
  });
  txns.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.row - b.row));
  txns.forEach((t, i) => {
    t.id = `t${i}`;
  });
  const total = rawRows.length;
  const skipped = issues.skippedNoDate.length + issues.skippedNoAmount.length + issues.skippedZero.length;
  return {
    transactions: txns,
    issues,
    stats: {
      rowsRead: total,
      rowsImported: txns.length,
      rowsSkipped: skipped,
      importRate: total ? txns.length / total : 0,
      settled: txns.filter((t) => t.status === 'settled').length,
      open: txns.filter((t) => t.status === 'open').length,
      first: txns[0]?.date ?? null,
      last: txns[txns.length - 1]?.date ?? null,
    },
  };
}
