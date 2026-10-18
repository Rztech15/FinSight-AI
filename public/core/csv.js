// RFC-4180 style CSV parser (quotes, escaped quotes, embedded newlines, BOM, auto delimiter).
// Written for this project so that financial file parsing has no third-party dependency.

export const MAX_ROWS = 100000;

export function detectDelimiter(text) {
  const candidates = [',', ';', '\t', '|'];
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 8);
  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0];
    if (!first) continue;
    const consistent = counts.filter((c) => c === first).length / counts.length;
    const score = consistent * 100 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line, d) {
  let inQ = false;
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === d && !inQ) n++;
  }
  return n;
}

/** Parse text into an array of string arrays. */
export function parseCSVMatrix(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      inQ = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_ROWS + 5) break;
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function uniqueHeaders(raw) {
  const seen = new Map();
  return raw.map((h, i) => {
    let name = String(h ?? '').trim() || `Column ${i + 1}`;
    const count = seen.get(name) || 0;
    seen.set(name, count + 1);
    if (count) name = `${name} (${count + 1})`;
    return name;
  });
}

/** Convert a matrix into {headers, rows:[{header:value}]}. The first non-empty row is the header row. */
export function matrixToTable(matrix) {
  const isEmpty = (r) => r.every((c) => String(c ?? '').trim() === '');
  const nonEmpty = matrix.filter((r) => !isEmpty(r));
  if (!nonEmpty.length) return { headers: [], rows: [], truncated: false };
  const headers = uniqueHeaders(nonEmpty[0]);
  const body = nonEmpty.slice(1);
  const truncated = body.length > MAX_ROWS;
  const rows = body.slice(0, MAX_ROWS).map((r) => {
    const o = {};
    headers.forEach((h, i) => {
      o[h] = r[i] ?? '';
    });
    return o;
  });
  return { headers, rows, truncated };
}

export function parseCSV(text, { delimiter } = {}) {
  const clean = String(text).replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(clean);
  const table = matrixToTable(parseCSVMatrix(clean, d));
  return { ...table, delimiter: d };
}

/** Neutralise spreadsheet formula injection when exporting values to CSV. */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
export function toCSV(headers, rows) {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
}
