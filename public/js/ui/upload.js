import { html } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';
import { FIELDS, FIELD_LABELS, validateMapping } from '../../core/ingest.js';
import { pageHeader } from './common.js';

const REQUIRED_HINT = { date: 'Required', amount: 'Amount or Debit/Credit', debit: 'With Credit', credit: 'With Debit' };

function dropzone() {
  return html`<section class="card dz-card">
    <label class="dropzone" for="file-input" data-dropzone>
      <span class="dz-ic">${icon('upload', 28)}</span>
      <strong>Drop a CSV or Excel file here, or choose one</strong>
      <span class="muted">.csv, .tsv, .txt or .xlsx · up to 10 MB / 100,000 rows · first worksheet is used</span>
      <input id="file-input" type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv" class="visually-hidden">
    </label>
    <div class="row center"><span class="muted">or</span><button class="btn" data-action="load-demo">${icon('spark', 16)}Explore synthetic demo data</button></div>
    ${app.error ? html`<p class="error" role="alert">${icon('alert', 16)}${app.error}</p>` : ''}
  </section>
  <div class="grid-3 tips">
    <section class="card"><h3>What works</h3><ul class="plain"><li>Bank exports, accounting ledgers, POS or invoice lists</li><li>One signed Amount column, or separate Debit / Credit columns</li><li>Optional: running balance, category, customer/supplier, invoice number, due date, payment status</li></ul></section>
    <section class="card"><h3>Open invoices</h3><p class="muted">Rows whose status is unpaid, open, pending or overdue are treated as receivables (positive) or payables (negative), not as cash — they feed the forecast on their due dates.</p></section>
    <section class="card"><h3>${icon('lock', 16)} Privacy</h3><p class="muted">Files are read in your browser and held in memory only. The AI assistant receives a short list of aggregated, verified figures — never your transactions.</p></section>
  </div>`;
}

function mappingTable() {
  const t = app.table;
  const sampleFor = (h) => t.rows.slice(0, 40).map((r) => r[h]).filter((v) => v !== '' && v !== null && v !== undefined).slice(0, 3).join(' · ');
  return html`<table class="map-table"><caption class="visually-hidden">Column mapping</caption>
    <thead><tr><th scope="col">FinSight field</th><th scope="col">Column in your file</th><th scope="col">Match</th><th scope="col">Sample values</th></tr></thead>
    <tbody>${FIELDS.map((f) => {
    const sel = app.mapping[f];
    const conf = app.mapConfidence?.[f] || 0;
    return html`<tr>
      <th scope="row"><label for="map-${f}">${FIELD_LABELS[f]}</label>${REQUIRED_HINT[f] ? html`<small class="req">${REQUIRED_HINT[f]}</small>` : ''}</th>
      <td><select id="map-${f}" data-map="${f}"><option value="">— not in file —</option>${t.headers.map((h) => html`<option value="${h}" ${h === sel ? 'selected' : ''}>${h}</option>`)}</select></td>
      <td>${sel ? html`<span class="badge ${conf >= 0.9 ? 'good' : conf >= 0.6 ? 'rules' : 'sev-medium'}">${conf ? (conf >= 0.9 ? 'Strong' : conf >= 0.6 ? 'Likely' : 'Check') : 'Manual'}</span>` : ''}</td>
      <td class="sample">${sel ? sampleFor(sel) : ''}</td></tr>`;
  })}</tbody></table>`;
}

function preview() {
  const t = app.table;
  const heads = t.headers.slice(0, 9);
  return html`<div class="table-wrap"><table class="preview"><caption class="visually-hidden">First rows of your file</caption>
    <thead><tr>${heads.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead>
    <tbody>${t.rows.slice(0, 6).map((r) => html`<tr>${heads.map((h) => html`<td>${String(r[h]).slice(0, 40)}</td>`)}</tr>`)}</tbody></table></div>
    ${t.headers.length > 9 ? html`<p class="muted small">Showing 9 of ${t.headers.length} columns.</p>` : ''}`;
}

function report() {
  const r = app.importResult;
  const v = validateMapping(app.mapping);
  if (!r) return '';
  const s = r.stats;
  const i = r.issues;
  const list = (arr) => arr.slice(0, 10).join(', ') + (arr.length > 10 ? ` … +${arr.length - 10} more` : '');
  return html`<section class="card" aria-labelledby="rep-h">
    <div class="card-head"><h2 id="rep-h">${icon('check', 18)}Import check</h2></div>
    <div class="stats">
      <div><b>${s.rowsRead.toLocaleString()}</b><span>rows read</span></div>
      <div><b>${s.rowsImported.toLocaleString()}</b><span>imported</span></div>
      <div><b class="${s.rowsSkipped ? 'warn' : ''}">${s.rowsSkipped}</b><span>skipped</span></div>
      <div><b>${s.open}</b><span>open invoices</span></div>
      <div><b>${s.first || '—'}</b><span>first date</span></div><div><b>${s.last || '—'}</b><span>last date</span></div>
    </div>
    ${v.errors.map((e) => html`<p class="error" role="alert">${icon('alert', 16)}${e}</p>`)}
    <ul class="issues">
      ${i.skippedNoDate.length ? html`<li>${icon('alert', 14)}Unreadable date — rows ${list(i.skippedNoDate)}</li>` : ''}
      ${i.skippedNoAmount.length ? html`<li>${icon('alert', 14)}Missing or unreadable amount — rows ${list(i.skippedNoAmount)}</li>` : ''}
      ${i.skippedZero.length ? html`<li>${icon('info', 14)}Zero-value rows ignored — rows ${list(i.skippedZero)}</li>` : ''}
      ${i.unknownType.length ? html`<li>${icon('info', 14)}Type not recognised (sign kept as in file) — rows ${list(i.unknownType)}</li>` : ''}
      ${i.ambiguousDates ? html`<li>${icon('alert', 14)}Dates like 03/04/2026 are ambiguous. Currently read as <b>${i.dayFirstUsed ? 'day/month' : 'month/day'}</b> — change the date format below if that's wrong.</li>` : html`<li>${icon('check', 14)}Dates read as ${i.dayFirstUsed ? 'day/month/year' : 'month/day/year'}.</li>`}
      ${i.exactDuplicates ? html`<li>${icon('info', 14)}${i.exactDuplicates} rows look identical to another row. They were kept — review them if unexpected.</li>` : ''}
      ${i.unreadableBalance ? html`<li>${icon('info', 14)}${i.unreadableBalance} balance values could not be read.</li>` : ''}
      ${v.warnings.map((w) => html`<li>${icon('info', 14)}${w}</li>`)}
    </ul>
  </section>`;
}

export function uploadView() {
  if (!app.table) return html`${pageHeader('Upload data', 'Import transactions from a bank export, ledger or invoice list.')}${dropzone()}`;
  const hasBalance = !!app.mapping.balance;
  return html`${pageHeader('Check your columns', `${app.fileName} · ${app.table.rows.length.toLocaleString()} rows`, html`<button class="btn" data-action="reset-upload">Choose another file</button>`)}
    <div class="grid-2">
      <section class="card" aria-labelledby="map-h"><div class="card-head"><h2 id="map-h">1 · Map your columns</h2></div>
        ${app.mapNotes.map((n) => html`<p class="note">${icon('info', 14)}${n}</p>`)}
        ${mappingTable()}</section>
      <div class="stack">
        <section class="card"><div class="card-head"><h2>2 · Options</h2></div>
          <div class="form">
            <label>Date format<select data-map-option="dayFirst"><option value="auto" ${app.mapOptions.dayFirst === 'auto' ? 'selected' : ''}>Detect automatically</option><option value="true" ${app.mapOptions.dayFirst === true ? 'selected' : ''}>Day / month / year</option><option value="false" ${app.mapOptions.dayFirst === false ? 'selected' : ''}>Month / day / year</option></select></label>
            ${app.mapping.debit || app.mapping.credit ? html`<label class="check"><input type="checkbox" data-map-option="swapDebitCredit" ${app.mapOptions.swapDebitCredit ? 'checked' : ''}> Swap Debit and Credit (use if inflows show as outflows)</label>` : ''}
            <label>Currency<select data-setting="currency">${['USD', 'EUR', 'GBP', 'PKR', 'INR', 'AED', 'SAR', 'CAD', 'AUD', 'SGD', 'NGN', 'KES', 'ZAR'].map((c) => html`<option ${c === app.settings.currency ? 'selected' : ''}>${c}</option>`)}</select></label>
            ${hasBalance ? html`<p class="muted small">Cash on hand will come from your running balance column.</p>`
    : html`<label>Opening balance (before the first row)<input type="number" step="0.01" inputmode="decimal" data-setting="openingBalance" value="${app.settings.openingBalance ?? ''}" placeholder="e.g. 25000"></label><p class="muted small">Needed because there is no running-balance column. Leave empty to see relative figures only.</p>`}
          </div></section>
        ${report()}
        <div class="row end"><button class="btn primary big" data-action="analyze" ${app.importResult && validateMapping(app.mapping).ok && app.importResult.transactions.length ? '' : 'disabled'}>${icon('spark', 16)}Analyze this data</button></div>
      </div>
    </div>
    <section class="card"><div class="card-head"><h2>Preview</h2></div>${preview()}</section>`;
}
