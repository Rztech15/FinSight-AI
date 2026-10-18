// Tiny templating layer. Every interpolated value is HTML-escaped by default, so text that comes from an
// uploaded file (descriptions, customer names…) can never become markup. Use raw() only for trusted
// fragments produced by this app (icons, chart SVG).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Safe(String(s ?? ''));

function part(v) {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += part(vals[i]);
  });
  return new Safe(out);
}

export const when = (cond, fn) => (cond ? fn() : '');

/** Safe localStorage wrappers — storage can be blocked, full, or absent. */
export const store = {
  get(key, fallback = null) {
    try {
      const v = globalThis.localStorage?.getItem(key);
      return v === null || v === undefined ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) {
    try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ }
  },
};

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
