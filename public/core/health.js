// Financial health score (0–100). Each component is scored from measured metrics only; components
// whose inputs are unavailable are excluded and the remaining weights are renormalised, so the score
// never rewards or penalises data that does not exist.

import { clamp, std, mean } from './util.js';

function lerp(x, x0, x1, y0, y1) {
  return y0 + ((clamp(x, Math.min(x0, x1), Math.max(x0, x1)) - x0) / (x1 - x0)) * (y1 - y0);
}
/** Piecewise-linear scoring through points [[x,score],...] sorted by x. */
function piecewise(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) return lerp(x, pts[i - 1][0], pts[i][0], pts[i - 1][1], pts[i][1]);
  }
  return pts[pts.length - 1][1];
}

export function bandFor(score) {
  if (score >= 75) return { label: 'Healthy', tone: 'good' };
  if (score >= 55) return { label: 'Watch', tone: 'watch' };
  if (score >= 35) return { label: 'At risk', tone: 'warn' };
  return { label: 'Critical', tone: 'bad' };
}

export function computeHealth(metrics, forecast) {
  if (metrics.empty) return { available: false, reason: metrics.reason };
  const comps = [];

  // 1. Liquidity — runway in months
  if (metrics.runway.available) {
    const r = metrics.runway.value;
    comps.push({
      key: 'runway', label: 'Liquidity runway', weight: 30,
      score: r === Infinity ? 100 : piecewise(r, [[0, 0], [1, 15], [3, 55], [6, 85], [12, 100]]),
      detail: r === Infinity ? 'Net cash flow is not negative.' : `${r.toFixed(1)} months of cash at the recent burn rate.`,
    });
  }
  // 2. Cash-flow direction — average net flow relative to outflows, with trend
  const cm = metrics.months.filter((m) => m.complete).slice(-4);
  if (cm.length >= 2) {
    const avgOut = mean(cm.map((m) => m.outflow)) || 1;
    const ratio = mean(cm.map((m) => m.net)) / avgOut; // −0.3 = burning 30% of spend
    const trend = cm[cm.length - 1].net - cm[0].net;
    const base = piecewise(ratio, [[-0.3, 0], [-0.1, 35], [0, 65], [0.1, 90], [0.2, 100]]);
    const adj = trend < 0 ? -8 : trend > 0 ? 5 : 0;
    comps.push({
      key: 'cashflow', label: 'Net cash-flow trend', weight: 20, score: clamp(base + adj, 0, 100),
      detail: `Average monthly net flow is ${(ratio * 100).toFixed(0)}% of monthly spend; ${trend < 0 ? 'declining' : trend > 0 ? 'improving' : 'flat'}.`,
    });
  }
  // 3. Operating margin
  if (metrics.margin.available) {
    const m = metrics.margin.value;
    comps.push({
      key: 'margin', label: 'Operating margin', weight: 15,
      score: piecewise(m, [[-0.2, 0], [0, 40], [0.1, 70], [0.25, 100]]),
      detail: `Operating margin of ${(m * 100).toFixed(1)}% over the trailing ${metrics.margin.monthsUsed} month(s).`,
    });
  }
  // 4. Receivables quality
  if (metrics.receivables && metrics.receivables.total > 0) {
    const share = metrics.receivables.overdueShare;
    comps.push({
      key: 'receivables', label: 'Receivables quality', weight: 15,
      score: piecewise(share, [[0, 100], [0.15, 80], [0.4, 40], [0.7, 5]]),
      detail: `${(share * 100).toFixed(0)}% of open receivables are overdue.`,
    });
  }
  // 5. Customer concentration
  if (metrics.customers.available) {
    const s = metrics.customers.topShare;
    comps.push({
      key: 'concentration', label: 'Customer concentration', weight: 10,
      score: piecewise(s, [[0.1, 100], [0.2, 75], [0.35, 40], [0.6, 5]]),
      detail: `The largest customer is ${(s * 100).toFixed(0)}% of total operating revenue.`,
    });
  }
  // 6. Spending stability
  if (cm.length >= 3) {
    const outs = cm.map((m) => m.outflow);
    const cv = std(outs) / (mean(outs) || 1);
    comps.push({
      key: 'stability', label: 'Spending stability', weight: 10,
      score: piecewise(cv, [[0.05, 100], [0.15, 75], [0.3, 40], [0.5, 10]]),
      detail: `Monthly spending varies by ${(cv * 100).toFixed(0)}% (coefficient of variation).`,
    });
  }
  // 7. Forecast outlook
  if (forecast?.available) {
    const min = forecast.minBalance.value;
    let score;
    if (forecast.firstShortfall) score = piecewise(forecast.firstShortfall.week, [[1, 0], [4, 10], [8, 25], [13, 40]]);
    else if (forecast.firstAtRisk) score = 65;
    else score = min < metricsBuffer(metrics) ? 55 : 95;
    comps.push({
      key: 'outlook', label: 'Cash outlook', weight: 20, score,
      detail: forecast.firstShortfall
        ? `Projected cash falls below zero in week ${forecast.firstShortfall.week}.`
        : forecast.firstAtRisk
          ? `Cash stays positive in the central case but could dip below zero in week ${forecast.firstAtRisk.week} in a downside case.`
          : 'Projected cash stays above zero across the horizon.',
    });
  }
  if (!comps.length) return { available: false, reason: 'Not enough data to score any health component.' };
  const totalW = comps.reduce((a, c) => a + c.weight, 0);
  const score = Math.round(comps.reduce((a, c) => a + c.score * c.weight, 0) / totalW);
  comps.forEach((c) => {
    c.score = Math.round(c.score);
    c.effectiveWeight = c.weight / totalW;
  });
  return { available: true, score, band: bandFor(score), components: comps, coverage: totalW / 120 };
}

function metricsBuffer(metrics) {
  return metrics.settings?.minimumCashBuffer || 0;
}
