// Minimal, dependency-free .xlsx reader (first worksheet only).
//
// Why not SheetJS? The widely copied CDN build (0.18.5) has known prototype-pollution and ReDoS
// advisories (CVE-2023-30533, CVE-2024-22363), and the fixed releases are not published on npm.
// For a financial product we prefer a small reader we can test and bound:
//   * file size and decompressed size are capped (zip-bomb guard)
//   * only worksheet / sharedStrings / workbook XML parts are ever inflated
//   * no formulas are evaluated; cached values only
//
// Works in browsers and Node >= 18 (uses the standard DecompressionStream).

import { matrixToTable, MAX_ROWS } from './csv.js';

export const MAX_XLSX_BYTES = 10 * 1024 * 1024;
const MAX_PART_BYTES = 60 * 1024 * 1024;

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function readZipDirectory(bytes) {
  const min = Math.max(0, bytes.length - 66000);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This does not look like a valid .xlsx file (zip directory not found).');
  const total = u16(bytes, eocd + 10);
  let off = u32(bytes, eocd + 16);
  if (total === 0xffff || off === 0xffffffff) throw new Error('Zip64 spreadsheets are not supported. Please export as CSV.');
  const entries = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < total; i++) {
    if (u32(bytes, off) !== 0x02014b50) throw new Error('Corrupted .xlsx file (bad zip entry).');
    const method = u16(bytes, off + 10);
    const compSize = u32(bytes, off + 20);
    const uncompSize = u32(bytes, off + 24);
    const nameLen = u16(bytes, off + 28);
    const extraLen = u16(bytes, off + 30);
    const commentLen = u16(bytes, off + 32);
    const localOffset = u32(bytes, off + 42);
    const name = dec.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    entries.set(name, { method, compSize, uncompSize, localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data, limit) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error('Spreadsheet is too large once decompressed.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

async function readPart(bytes, entries, name) {
  const e = entries.get(name);
  if (!e) return null;
  if (e.uncompSize > MAX_PART_BYTES) throw new Error('Spreadsheet is too large once decompressed.');
  const lo = e.localOffset;
  if (u32(bytes, lo) !== 0x04034b50) throw new Error('Corrupted .xlsx file (bad local header).');
  const start = lo + 30 + u16(bytes, lo + 26) + u16(bytes, lo + 28);
  const raw = bytes.subarray(start, start + e.compSize);
  let out;
  if (e.method === 0) out = raw;
  else if (e.method === 8) out = await inflateRaw(raw, MAX_PART_BYTES);
  else throw new Error('Unsupported compression method in .xlsx file.');
  return new TextDecoder('utf-8').decode(out);
}

function decodeXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
function safeCodePoint(n) {
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}
function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? decodeXml(m[1]) : null;
}
function textRuns(xml) {
  const cleaned = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  const out = [];
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(cleaned))) out.push(decodeXml(m[1]));
  return out.join('');
}
function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1] ? textRuns(m[1]) : '');
  return out;
}

function parseSheet(xml, shared) {
  const matrix = [];
  const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    if (matrix.length > MAX_ROWS + 5) break;
    const cells = [];
    if (rm[1]) {
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      while ((cm = cellRe.exec(rm[1]))) {
        const attrs = cm[1];
        const body = cm[2] || '';
        const idx = colIndex(attr(attrs, 'r') || 'A1');
        if (idx > 200) continue;
        const t = attr(attrs, 't');
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = '';
        if (t === 'inlineStr') val = textRuns(body);
        else if (v === undefined) val = '';
        else if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'str') val = decodeXml(v);
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'e') val = '';
        else {
          const num = Number(v);
          val = Number.isFinite(num) ? num : decodeXml(v);
        }
        cells[idx] = val;
      }
    }
    matrix.push(Array.from(cells, (c) => (c === undefined ? '' : c)));
  }
  return matrix;
}

/** Read the first worksheet of an .xlsx file. Numbers stay numbers (dates arrive as Excel serials). */
export async function readXlsx(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length > MAX_XLSX_BYTES) throw new Error('Spreadsheet is larger than 10 MB. Please export a smaller range or use CSV.');
  const entries = readZipDirectory(bytes);
  const wbXml = await readPart(bytes, entries, 'xl/workbook.xml');
  if (!wbXml) throw new Error('This file is not an Excel workbook (xl/workbook.xml missing).');
  const relsXml = (await readPart(bytes, entries, 'xl/_rels/workbook.xml.rels')) || '';

  const sheets = [];
  const sRe = /<sheet\b([^>]*?)\/?>/g;
  let sm;
  while ((sm = sRe.exec(wbXml))) {
    sheets.push({ name: attr(sm[1], 'name'), rid: attr(sm[1], 'r:id') });
  }
  if (!sheets.length) throw new Error('The workbook has no worksheets.');
  let target = null;
  const relRe = /<Relationship\b([^>]*?)\/?>/g;
  let rr;
  while ((rr = relRe.exec(relsXml))) {
    if (attr(rr[1], 'Id') === sheets[0].rid) target = attr(rr[1], 'Target');
  }
  let path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml';
  if (!entries.has(path)) path = 'xl/worksheets/sheet1.xml';
  const sheetXml = await readPart(bytes, entries, path);
  if (!sheetXml) throw new Error('Could not find the first worksheet in the file.');
  const shared = parseSharedStrings(await readPart(bytes, entries, 'xl/sharedStrings.xml'));
  const table = matrixToTable(parseSheet(sheetXml, shared));
  return { ...table, sheetNames: sheets.map((s) => s.name), sheetUsed: sheets[0].name };
}
