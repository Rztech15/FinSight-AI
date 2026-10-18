// Number formatting shared by the UI, the AI evidence bundle and the deterministic narrative,
// so that every figure a user sees is rendered the same way everywhere.

const cache = new Map();
function nf(currency, compact) {
  const key = `${currency}|${compact}`;
  if (!cache.has(key)) {
    let fmt;
    try {
      fmt = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
        notation: compact ? 'compact' : 'standard',
      });
    } catch {
      fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    }
    cache.set(key, fmt);
  }
  return cache.get(key);
}

export function money(value, currency = 'USD', { compact = false } = {}) {
  if (!Number.isFinite(value)) return '—';
  const v = Math.abs(value) < 0.5 ? 0 : value;
  return nf(currency, compact).format(v);
}
export function pct(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}
export function months(value) {
  if (value === Infinity) return 'Not burning cash';
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} months`;
}
export function shortDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}
export function signedMoney(value, currency = 'USD') {
  if (!Number.isFinite(value)) return '—';
  const s = money(Math.abs(value), currency);
  return value < 0 ? `−${s}` : `+${s}`;
}
