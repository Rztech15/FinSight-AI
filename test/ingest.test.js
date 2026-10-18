import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCSV, csvCell, detectDelimiter } from '../public/core/csv.js';
import { readXlsx } from '../public/core/xlsx.js';
import {
  parseAmount, parseDate, inferDayFirst, detectColumns, validateMapping, normalizeRows, excelSerialToISO,
} from '../public/core/ingest.js';

test('csv: quotes, escaped quotes, embedded newlines, BOM, CRLF', () => {
  const t = parseCSV('﻿Date,Note,Amount\r\n2026-01-02,"Hello, ""world""",10\r\n2026-01-03,"multi\nline",20\r\n');
  assert.deepEqual(t.headers, ['Date', 'Note', 'Amount']);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0].Note, 'Hello, "world"');
  assert.equal(t.rows[1].Note, 'multi\nline');
});
test('csv: detects semicolon and tab delimiters; duplicate/empty headers are made unique', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  const t = parseCSV('Amount,Amount,\n1,2,3');
  assert.deepEqual(t.headers, ['Amount', 'Amount (2)', 'Column 3']);
});
test('csv export neutralises formula injection', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('plain'), 'plain');
});

test('parseAmount handles common financial formats', () => {
  const cases = [
    ['1,234.50', 1234.5], ['$1,234.50', 1234.5], ['(1,234.50)', -1234.5], ['-1234', -1234], ['1234-', -1234],
    ['1.234,56', 1234.56], ['1234,56', 1234.56], ['1,234,567', 1234567], ['PKR 5,000', 5000], ['500 CR', 500], ['500 DR', -500],
    ['€ 12.50', 12.5], [42, 42], ['+7', 7],
  ];
  for (const [input, want] of cases) assert.equal(parseAmount(input), want, `parseAmount(${input})`);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('-'), null);
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.ok(Number.isNaN(parseAmount('12abc')));
});

test('parseDate: ISO, day/month ambiguity, month names, Excel serials, invalid dates', () => {
  assert.equal(parseDate('2026-03-05'), '2026-03-05');
  assert.equal(parseDate('2026-03-05T10:00:00Z'), '2026-03-05');
  assert.equal(parseDate('25/12/2026'), '2026-12-25'); // unambiguous day-first
  assert.equal(parseDate('12/25/2026'), '2026-12-25'); // unambiguous month-first
  assert.equal(parseDate('03/04/2026', { dayFirst: true }), '2026-04-03');
  assert.equal(parseDate('03/04/2026', { dayFirst: false }), '2026-03-04');
  assert.equal(parseDate('5 Mar 2026'), '2026-03-05');
  assert.equal(parseDate('March 5, 2026'), '2026-03-05');
  assert.equal(parseDate(46086), excelSerialToISO(46086));
  assert.equal(excelSerialToISO(46023), '2026-01-01');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('not a date'), null);
  assert.equal(parseDate(''), null);
});
test('inferDayFirst reads the whole column', () => {
  assert.deepEqual(inferDayFirst(['01/02/2026', '15/02/2026']), { dayFirst: true, ambiguous: false });
  assert.deepEqual(inferDayFirst(['01/02/2026', '02/15/2026']), { dayFirst: false, ambiguous: false });
  assert.deepEqual(inferDayFirst(['01/02/2026', '03/04/2026']), { dayFirst: false, ambiguous: true });
});

test('detectColumns: standard headers', () => {
  const rows = [{ Date: '2026-01-01', Description: 'Sale', Amount: '100', Category: 'Sales', Balance: '1100' }];
  const { mapping } = detectColumns(Object.keys(rows[0]), rows);
  assert.equal(mapping.date, 'Date');
  assert.equal(mapping.amount, 'Amount');
  assert.equal(mapping.description, 'Description');
  assert.equal(mapping.category, 'Category');
  assert.equal(mapping.balance, 'Balance');
});
test('detectColumns: bank-style headers with debit/credit and due date', () => {
  const rows = [{ 'Txn Date': '01/02/2026', Narration: 'x', Withdrawal: '10', Deposit: '', 'Running Balance': '90', Party: 'ACME', 'Invoice No': 'INV-1', 'Payment Status': 'Paid', 'Due On': '15/02/2026', Head: 'Rent' }];
  const { mapping } = detectColumns(Object.keys(rows[0]), rows);
  assert.equal(mapping.date, 'Txn Date');
  assert.equal(mapping.dueDate, 'Due On');
  assert.equal(mapping.debit, 'Withdrawal');
  assert.equal(mapping.credit, 'Deposit');
  assert.equal(mapping.balance, 'Running Balance');
  assert.equal(mapping.counterparty, 'Party');
  assert.equal(mapping.reference, 'Invoice No');
  assert.equal(mapping.status, 'Payment Status');
  assert.equal(mapping.category, 'Head');
  assert.equal(mapping.amount, null);
});
test('detectColumns: a text column is not mistaken for a numeric/date column', () => {
  const rows = [{ Date: 'Monday', Amount: 'lots', Description: 'x' }, { Date: 'Tuesday', Amount: 'few', Description: 'y' }];
  const { mapping } = detectColumns(Object.keys(rows[0]), rows);
  assert.equal(mapping.date, null);
  assert.equal(mapping.amount, null);
  const v = validateMapping(mapping);
  assert.equal(v.ok, false);
  assert.equal(v.errors.length, 2);
});

test('normalizeRows: signed amount, skipped rows are reported, never silently dropped', () => {
  const raw = [
    { d: '2026-01-02', a: '100', t: 'ok' },
    { d: 'garbage', a: '5', t: 'bad date' },
    { d: '2026-01-04', a: 'n/a', t: 'bad amount' },
    { d: '2026-01-05', a: '0', t: 'zero' },
    { d: '', a: '', t: 'blank' },
    { d: '2026-01-06', a: '-40', t: 'out' },
  ];
  const r = normalizeRows(raw, { date: 'd', amount: 'a', description: 't' });
  assert.equal(r.transactions.length, 2);
  assert.deepEqual(r.issues.skippedNoDate, [3]);
  assert.deepEqual(r.issues.skippedNoAmount, [4]);
  assert.deepEqual(r.issues.skippedZero, [5]);
  assert.equal(r.stats.rowsRead, 6);
  assert.equal(r.stats.rowsSkipped, 3);
});
test('normalizeRows: debit/credit columns and swap option', () => {
  const raw = [{ d: '2026-01-02', db: '30', cr: '' }, { d: '2026-01-03', db: '', cr: '50' }];
  const m = { date: 'd', debit: 'db', credit: 'cr' };
  assert.deepEqual(normalizeRows(raw, m).transactions.map((t) => t.amount), [-30, 50]);
  assert.deepEqual(normalizeRows(raw, m, { swapDebitCredit: true }).transactions.map((t) => t.amount), [30, -50]);
});
test('normalizeRows: unsigned amount is signed by a type column; unknown types are reported', () => {
  const raw = [
    { d: '2026-01-02', a: '100', ty: 'Credit' }, { d: '2026-01-03', a: '40', ty: 'Expense' }, { d: '2026-01-04', a: '10', ty: 'Mystery' },
  ];
  const r = normalizeRows(raw, { date: 'd', amount: 'a', type: 'ty' });
  assert.deepEqual(r.transactions.map((t) => t.amount), [100, -40, 10]);
  assert.deepEqual(r.issues.unknownType, [4]);
});
test('normalizeRows: payment status separates settled cash from open invoices', () => {
  const raw = [
    { d: '2026-01-02', a: '100', s: 'Paid', due: '2026-01-30', bal: '500' },
    { d: '2026-01-03', a: '200', s: 'Unpaid', due: '2026-02-02', bal: '' },
    { d: '2026-01-04', a: '-50', s: 'Overdue', due: '2026-01-20', bal: '' },
  ];
  const r = normalizeRows(raw, { date: 'd', amount: 'a', status: 's', dueDate: 'due', balance: 'bal' });
  assert.deepEqual(r.transactions.map((t) => t.status), ['settled', 'open', 'open']);
  assert.equal(r.transactions[0].balance, 500);
  assert.equal(r.transactions[1].balance, null);
  assert.equal(r.transactions[1].dueDate, '2026-02-02');
});
test('normalizeRows: hostile text is kept as inert text and capped', () => {
  const evil = '<img src=x onerror=alert(1)>'.repeat(20);
  const r = normalizeRows([{ d: '2026-01-02', a: '5', t: evil }], { date: 'd', amount: 'a', description: 't' });
  assert.ok(r.transactions[0].description.length <= 160);
  assert.ok(r.transactions[0].description.startsWith('<img'));
});

test('xlsx: reads strings, numbers, dates (as serials), skips empty rows, handles entities and unicode', async () => {
  const buf = readFileSync(fileURLToPath(new URL('./fixtures/bank.xlsx', import.meta.url)));
  const t = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(t.sheetUsed, 'Bank export');
  assert.deepEqual(t.headers, ['Txn Date', 'Narration', 'Withdrawal', 'Deposit', 'Running Balance', 'Party']);
  assert.equal(t.rows.length, 4);
  assert.equal(t.rows[0].Narration, 'Card sales <Cafe> & co');
  assert.equal(t.rows[1].Narration, 'Rent "Unit 4"');
  assert.equal(t.rows[3].Narration, 'Supplier – café ü');
  assert.equal(t.rows[0].Deposit, 1250.5);
  assert.equal(parseDate(t.rows[0]['Txn Date']), '2026-03-02');
  const { mapping } = detectColumns(t.headers, t.rows);
  const n = normalizeRows(t.rows, mapping);
  assert.equal(n.transactions.length, 4);
  assert.equal(n.transactions[1].amount, -2000);
});
test('xlsx: rejects non-xlsx and oversized input with a clear error', async () => {
  await assert.rejects(() => readXlsx(new TextEncoder().encode('just some text, not a zip file at all').buffer), /valid \.xlsx/);
  await assert.rejects(() => readXlsx(new ArrayBuffer(11 * 1024 * 1024)), /larger than 10 MB/);
});

test('sample CSV imports completely with the right mapping', () => {
  const t = parseCSV(readFileSync(fileURLToPath(new URL('../public/samples/harbor-pine-roasters-demo.csv', import.meta.url)), 'utf8'));
  const d = detectColumns(t.headers, t.rows);
  assert.equal(validateMapping(d.mapping).ok, true);
  const n = normalizeRows(t.rows, d.mapping);
  assert.equal(n.stats.rowsSkipped, 0);
  assert.equal(n.stats.rowsImported, 914);
  assert.equal(n.issues.dayFirstUsed, true);
});
