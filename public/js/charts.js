// SVG / HTML charts, hand-built (no chart library). Conventions: thin marks, 2px lines, rounded data ends,
// recessive grid, a legend whenever there are two or more series, a hover/focus tooltip on every data
// point (data-tip), and a "view as table" fallback so nothing is conveyed by colour alone.

import { html, raw } from './dom.js';
import { money, monthLabel, shortDate } from '../core/format.js';

function niceTicks(min, max, n = 5) {
  const span = max - min || 1;
  const rough = span / (n - 1);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.5; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
const f1 = (n) => Math.round(n * 10) / 10;

function legend(items) {
  return html`<ul class="legend">${items.map((i) => html`<li><span class="swatch ${i.cls}" ></span>${i.label}</li>`)}</ul>`;
}

function table(headers, rows) {
  return html`<details class="chart-table"><summary>View as table</summary><div class="table-wrap"><table>
    <thead><tr>${headers.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => html`<tr>${r.map((c, i) => (i === 0 ? html`<th scope="row">${c}</th>` : html`<td class="num">${c}</td>`))}</tr>`)}</tbody>
  </table></div></details>`;
}

/** Forecast chart: expected balance line with an 80% range band; optional scenario line to compare. */
export function cashChart({ weeks, compare = null, currency = 'USD', label = 'Projected cash balance', compareName = 'Scenario' }) {
  const W = 760; const H = 300; const L = 64; const R = 16; const T = 14; const B = 34;
  const n = weeks.length;
  const vals = weeks.flatMap((w) => [w.low, w.high, w.closing]).concat(compare ? compare.map((w) => w.closing) : [], [0]);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  const pad = (max - min) * 0.06 || 1;
  min -= pad; max += pad;
  const ticks = niceTicks(min, max, 5);
  min = Math.min(min, ticks[0]); max = Math.max(max, ticks[ticks.length - 1]);
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const y = (v) => T + ((max - v) / (max - min)) * (H - T - B);
  const line = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${f1(x(i))},${f1(y(v))}`).join('');
  const band = `${weeks.map((w, i) => `${i ? 'L' : 'M'}${f1(x(i))},${f1(y(w.high))}`).join('')}${[...weeks].reverse().map((w, k) => `L${f1(x(n - 1 - k))},${f1(y(w.low))}`).join('')}Z`;
  const zero = min < 0 && max > 0;
  const hitW = (W - L - R) / (n - 1);
  const tip = (w, i) => [
    i === 0 ? `Today (${shortDate(w.end)})` : `Week ${w.week} · ${shortDate(w.start)} – ${shortDate(w.end)}`,
    `Expected balance ${money(w.closing, currency)}`,
    i === 0 ? '' : `80% range ${money(w.low, currency)} to ${money(w.high, currency)}`,
    i === 0 ? '' : `Inflow ${money(w.inflow, currency)} · Outflow ${money(w.outflow, currency)}`,
    compare && i > 0 ? `${compareName}: ${money(compare[i].closing, currency)}` : '',
  ].filter(Boolean).join('\n');
  const svg = html`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}. ${weeks.length - 1} weeks. Lowest expected balance ${money(Math.min(...weeks.map((w) => w.closing)), currency)}.">
    ${ticks.map((t) => html`<g><line class="grid" x1="${L}" x2="${W - R}" y1="${f1(y(t))}" y2="${f1(y(t))}"/><text class="axis" x="${L - 8}" y="${f1(y(t)) + 4}" text-anchor="end">${money(t, currency, { compact: true })}</text></g>`)}
    ${zero ? html`<line class="zero" x1="${L}" x2="${W - R}" y1="${f1(y(0))}" y2="${f1(y(0))}"/>` : ''}
    ${weeks.map((w, i) => (i % 2 === 0 || i === n - 1 ? html`<text class="axis" x="${f1(x(i))}" y="${H - 10}" text-anchor="middle">${i === 0 ? 'Today' : `Wk ${w.week}`}</text>` : ''))}
    <path class="band" d="${band}"/>
    <path class="line s1" d="${line(weeks.map((w) => w.closing))}"/>
    ${compare ? html`<path class="line s2 dashed" d="${line(compare.map((w) => w.closing))}"/>` : ''}
    ${weeks.map((w, i) => (i === 0 ? '' : html`<circle class="dot ${w.closing < 0 ? 'neg' : 's1'}" cx="${f1(x(i))}" cy="${f1(y(w.closing))}" r="4"/>`))}
    ${compare ? compare.map((w, i) => (i === 0 ? '' : html`<circle class="dot s2" cx="${f1(x(i))}" cy="${f1(y(w.closing))}" r="3.5"/>`)) : ''}
    ${weeks.map((w, i) => html`<rect class="hit" x="${f1(x(i) - hitW / 2)}" y="${T}" width="${f1(hitW)}" height="${H - T - B}" tabindex="0" data-tip="${tip(w, i)}" aria-label="${tip(w, i).replace(/\n/g, '. ')}"/>`)}
  </svg>`;
  const items = [{ cls: 's1', label: compare ? 'Baseline expected balance' : 'Expected balance' }, { cls: 'band-sw', label: '80% range' }];
  if (compare) items.push({ cls: 's2', label: compareName });
  if (weeks.some((w) => w.closing < 0)) items.push({ cls: 'neg', label: 'Below zero' });
  return html`<figure class="chart">${svg}${legend(items)}${table(['Week', 'Expected balance', 'Low (10th pct)', 'High (90th pct)', 'Inflow', 'Outflow'],
    weeks.slice(1).map((w) => [`Week ${w.week}`, money(w.closing, currency), money(w.low, currency), money(w.high, currency), money(w.inflow, currency), money(w.outflow, currency)]))}</figure>`;
}

/** Grouped monthly bars: inflows vs outflows. Partial months are drawn lighter and labelled. */
export function monthlyBars({ months, currency = 'USD', label = 'Monthly inflows and outflows' }) {
  const data = months.slice(-13);
  const W = 760; const H = 260; const L = 64; const R = 12; const T = 12; const B = 32;
  const max = Math.max(...data.flatMap((m) => [m.inflow, m.outflow]), 1);
  const ticks = niceTicks(0, max, 5);
  const top = ticks[ticks.length - 1];
  const y = (v) => T + ((top - v) / top) * (H - T - B);
  const slot = (W - L - R) / data.length;
  const bw = Math.min(16, slot * 0.34);
  const bar = (cx, v, cls, tipText, partial) => {
    const h = Math.max(0, y(0) - y(v));
    const r = Math.min(4, h / 2);
    const x0 = cx - bw / 2;
    const d = `M${f1(x0)},${f1(y(0))}V${f1(y(v) + r)}Q${f1(x0)},${f1(y(v))} ${f1(x0 + r)},${f1(y(v))}H${f1(x0 + bw - r)}Q${f1(x0 + bw)},${f1(y(v))} ${f1(x0 + bw)},${f1(y(v) + r)}V${f1(y(0))}Z`;
    return html`<path class="bar ${cls} ${partial ? 'partial' : ''}" d="${d}" data-tip="${tipText}" tabindex="0" aria-label="${tipText.replace(/\n/g, '. ')}"/>`;
  };
  const svg = html`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}, ${data.length} months">
    ${ticks.map((t) => html`<g><line class="grid" x1="${L}" x2="${W - R}" y1="${f1(y(t))}" y2="${f1(y(t))}"/><text class="axis" x="${L - 8}" y="${f1(y(t)) + 4}" text-anchor="end">${money(t, currency, { compact: true })}</text></g>`)}
    ${data.map((m, i) => {
      const cx = L + slot * i + slot / 2;
      const note = m.complete ? '' : '\n(partial month)';
      return html`<g>${bar(cx - bw / 2 - 1, m.inflow, 's1', `${monthLabel(m.key)}${note}\nInflow ${money(m.inflow, currency)}\nNet ${money(m.net, currency)}`, !m.complete)}${bar(cx + bw / 2 + 1, m.outflow, 's2', `${monthLabel(m.key)}${note}\nOutflow ${money(m.outflow, currency)}\nNet ${money(m.net, currency)}`, !m.complete)}<text class="axis" x="${f1(cx)}" y="${H - 10}" text-anchor="middle">${monthLabel(m.key)}${m.complete ? '' : '*'}</text></g>`;
    })}
  </svg>`;
  return html`<figure class="chart">${svg}${legend([{ cls: 's1', label: 'Inflows' }, { cls: 's2', label: 'Outflows' }])}
    ${data.some((m) => !m.complete) ? html`<p class="chart-note">* partial month — not used for averages</p>` : ''}
    ${table(['Month', 'Inflow', 'Outflow', 'Net'], data.map((m) => [`${monthLabel(m.key)}${m.complete ? '' : ' (partial)'}`, money(m.inflow, currency), money(m.outflow, currency), money(m.net, currency)]))}</figure>`;
}

/** Horizontal bars (HTML). items: [{label, value, tone?, note?}] */
export function hbars({ items, currency = 'USD', total = null }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return html`<ul class="hbars">${items.map((i) => html`<li>
    <span class="hb-label" title="${i.label}">${i.label}</span>
    <span class="hb-track"><i class="hb-fill ${i.tone || 'teal'}" style="width:${Math.max(2, (i.value / max) * 100).toFixed(1)}%"></i></span>
    <span class="hb-val">${money(i.value, currency)}${total ? html` <small>${Math.round((i.value / total) * 100)}%</small>` : ''}</span>
  </li>`)}</ul>`;
}

const RING_TONE = { good: 'var(--good)', watch: 'var(--watch)', warn: 'var(--warn)', bad: 'var(--bad)' };
export function ring({ score, band }) {
  const r = 52; const c = 2 * Math.PI * r;
  return html`<svg class="ring" viewBox="0 0 140 140" role="img" aria-label="Financial health score ${score} out of 100, ${band.label}">
    <circle cx="70" cy="70" r="${r}" fill="none" class="ring-bg" stroke-width="10"/>
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="${raw(RING_TONE[band.tone])}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * score / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 70 70)"/>
    <text x="70" y="68" text-anchor="middle" class="ring-num">${score}</text>
    <text x="70" y="88" text-anchor="middle" class="ring-sub">${band.label}</text>
  </svg>`;
}
