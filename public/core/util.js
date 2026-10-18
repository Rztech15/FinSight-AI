// Small, dependency-free helpers shared by the browser app, the API routes and the tests.
// All dates in the engines are ISO strings (YYYY-MM-DD) handled in UTC so results never depend on time zone.

export const DAY_MS = 86400000;

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function toISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  return toISO(parseISO(iso) + n * DAY_MS);
}
/** a − b in whole days. */
export function diffDays(a, b) {
  return Math.round((parseISO(a) - parseISO(b)) / DAY_MS);
}
export function monthKey(iso) {
  return iso.slice(0, 7);
}
export function isValidISODate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return toISO(parseISO(iso)) === iso;
}
export function endOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return toISO(Date.UTC(y, m, 0));
}
export function addMonths(iso, n, dayOfMonth) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return toISO(Date.UTC(ty, tm, Math.min(dayOfMonth || d, last)));
}

export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : 0);
export function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
/** Sample standard deviation. */
export function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
}
/** Median absolute deviation scaled to be comparable with a standard deviation. */
export function robustStd(a) {
  if (a.length < 2) return 0;
  const m = median(a);
  return 1.4826 * median(a.map((x) => Math.abs(x - m)));
}
export function quantile(a, q) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export function round(n, d = 2) {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Winsorise values to the Tukey fences so a single freak week cannot dominate a run-rate. */
export function winsorize(values) {
  if (values.length < 8) return values.slice();
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return values.map((v) => clamp(v, lo, hi));
}

/** Recency-weighted mean. `values` is ordered oldest → newest. */
export function recencyMean(values, decay = 0.92) {
  if (!values.length) return 0;
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i++) {
    const age = values.length - 1 - i;
    const w = decay ** age;
    num += values[i] * w;
    den += w;
  }
  return num / den;
}

/** Stable short hash (FNV-1a, 32 bit) used for deterministic ids. Not cryptographic. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const MONTH_WORDS =
  /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/g;
/** Normalise a free-text label so "Rent - Oct 2026" and "RENT NOV 2026" group together. */
export function normalizeKey(str) {
  return String(str || '')
    .toLowerCase()
    .replace(MONTH_WORDS, ' ')
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip control characters and cap length — used for any text that leaves the browser or is displayed. */
export function cleanText(v, max = 200) {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Uniform "metric" wrappers so the UI never has to guess whether a number is real. */
export const avail = (value, extra = {}) => ({ available: true, value, ...extra });
export const unavail = (reason) => ({ available: false, reason });

export const DEFAULT_SETTINGS = Object.freeze({
  currency: 'USD',
  openingBalance: null, // number | null — only needed when the file has no running-balance column
  minimumCashBuffer: 0,
  horizonWeeks: 13,
  paymentTermsDays: null, // null → inferred from open invoices, else 30
  receivableDelayDays: null, // null → inferred from paid invoices, else 0
  payableDelayDays: null,
  overdueCollectionDays: 14, // when an overdue invoice is expected to be collected, counted from the as-of date
  overduePayDays: 5,
  collectionRates: Object.freeze({ current: 0.97, d1_30: 0.9, d31_60: 0.75, d61plus: 0.5 }),
  asOfDate: null,
});

export function withDefaults(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    collectionRates: { ...DEFAULT_SETTINGS.collectionRates, ...(settings.collectionRates || {}) },
  };
}
