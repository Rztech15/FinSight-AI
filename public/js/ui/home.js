// Landing page shown after sign-in / guest entry. Marketing-style layout (own top bar, no sidebar).
// The Financial Overview preview shows the visitor's own loaded numbers; with no data it shows dashes.
import { html, raw } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';
import { money } from '../../core/format.js';


const FLAT = 'M0,40 L200,40';

/** Path for the cash line from the real forecast weeks (closing balances), scaled into the 200x64 box. */
function cashPath(weeks) {
  const v = weeks.map((w) => w.closing);
  const lo = Math.min(...v); const hi = Math.max(...v);
  const span = hi - lo || 1;
  return v.map((x, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * 200).toFixed(1)},${(56 - ((x - lo) / span) * 48).toFixed(1)}`).join('');
}

/** The preview shows the visitor's own numbers once data is loaded; with no data it shows dashes, never made-up figures. */
function device() {
  const a = app.analysis;
  const live = !!(a && !a.empty);
  const cur = (live && a.settings?.currency) || app.settings.currency || 'USD';
  const $ = (v) => money(v, cur);
  const m = live ? a.metrics : null;
  const f = live ? a.forecast : null;
  const h = live ? a.health : null;
  const cash = live && m.cash.available ? $(m.cash.value) : '—';
  const inflow = live ? $(m.totals.inflow) : '—';
  const outflow = live ? $(m.totals.outflow) : '—';
  const line = live && f.available && f.weeks.length > 1 ? cashPath(f.weeks) : FLAT;
  const score = live && h.available ? h.score : null;
  const tone = score == null ? 'rgba(255,255,255,.18)' : score >= 70 ? '#13B8A6' : score >= 50 ? '#E9A23B' : '#E5604D';
  const dash = score == null ? 0 : (188.5 * score) / 100;
  let insight = 'Upload your data (or open the demo) to see your own forecast, risks and health score here.';
  if (live && f.available) {
    insight = f.firstShortfall ? `Projected cash shortfall in week ${f.firstShortfall.week}. Review the recommended actions.`
      : f.firstAtRisk ? `Cash is projected to run low in week ${f.firstAtRisk.week}. Review the recommended actions.`
        : `No cash shortfall projected in the next ${f.horizonWeeks} weeks.`;
  } else if (live) insight = 'Your data is loaded. Open the dashboard for details.';
  const caption = !live ? 'Preview · fills in with your data' : app.isDemo ? 'Demo business · synthetic data' : 'Your data · calculated in your browser';
  return html`<div class="hm-device${live ? '' : ' hm-blank'}" aria-hidden="true">
    <div class="hm-dev-side"><img src="/assets/logo-mark.png" alt="" width="16" height="18"><b>FinSight AI</b>
      <span class="on">Overview</span><span>Forecast</span><span>Risks</span><span>Health</span><span>Financing</span><span class="gap">Settings</span></div>
    <div class="hm-dev-main"><h4>Financial Overview</h4>
      <div class="hm-kpis"><div class="a1"><small>Cash Balance</small><b>${cash}</b><i class="sk"></i></div><div class="a2"><small>Total Inflows</small><b class="g">${inflow}</b><i class="sk"></i></div><div class="a3"><small>Total Outflows</small><b class="r">${outflow}</b><i class="sk"></i></div></div>
      <div class="hm-dev-row">
        <div class="hm-dev-chart"><small>Projected cash, ${live && f.available ? f.horizonWeeks : 13} weeks</small>${raw(`<svg viewBox="0 0 200 64" preserveAspectRatio="none"><path d="${line}${line === FLAT ? '' : ' L200,64 L0,64Z'}" fill="${line === FLAT ? 'none' : 'rgba(19,184,166,.18)'}"/><path d="${line}" fill="none" stroke="${line === FLAT ? 'rgba(255,255,255,.25)' : '#13B8A6'}" stroke-width="2.5" stroke-linecap="round" ${line === FLAT ? 'stroke-dasharray="4 5"' : ''}/></svg>`)}${live ? '' : raw('<span class="hm-sweep"></span><span class="hm-wait">Waiting for your data</span>')}</div>
        <div class="hm-dev-ring">${raw(`<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="30" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="8"/><circle class="${score == null ? 'spin' : ''}" cx="40" cy="40" r="30" fill="none" stroke="${score == null ? '#27E0C6' : tone}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${score == null ? '34 155' : `${dash.toFixed(1)} 189`}" transform="rotate(-90 40 40)"/></svg>`)}<span><small>Health</small><b>${score == null ? '—' : score}</b></span></div>
      </div></div>
    <div class="hm-insight">${icon('spark', 22)}<span><b>AI Insight</b><br><small>${insight}</small></span>${icon('arrow', 18)}</div>
    <span class="hm-caption">${caption}</span>
  </div>`;
}

export function homeView() {
  const signedIn = app.session?.user?.email;
  return html`<div class="hm">
    <header class="hm-top"><div class="hm-top-in">
      <a class="hm-logo" href="#/home"><img src="/assets/logo-mark.png" alt="" width="34" height="39"><span>FinSight <b>AI</b></span></a>
      <nav class="hm-nav" id="hm-nav" aria-label="Home navigation">
        <a href="#/home" class="on">Home</a><a href="#/dashboard">Dashboard</a>
      </nav>
      <div class="hm-top-r"><button class="hm-ic" data-action="theme-toggle" aria-label="Switch between dark and light theme">${icon('sun', 18)}</button>
        <a class="hm-ic" href="${signedIn ? '#/settings' : '#/login'}" aria-label="${signedIn ? `Account: ${signedIn}` : 'Sign in'}">${icon('user', 18)}</a>
        <button class="hm-ic hm-burger" data-action="home-menu" aria-label="Open menu" aria-expanded="false">${icon('menu', 18)}</button></div>
    </div></header>

    <section class="hm-hero"><div class="hm-hero-in">
      <div class="hm-hero-copy">
        <span class="hm-badge">${icon('spark', 14)}AI-Powered Financial Intelligence</span>
        <h1>Turn <em>Financial Data</em> into <em>Better Decisions</em></h1>
        <p>Upload your data or try our demo to get insights on your cash flow, performance and risks. Powered by AI. Built for smarter decisions.</p>
        <div class="hm-cta"><a class="hm-btn solid" href="#/upload">${icon('upload', 18)}Upload Your Data</a>
          <button class="hm-btn ghost" data-action="load-demo">${icon('bars', 18)}Explore Demo</button></div>
        <ul class="hm-chips"><li>${icon('file', 16)}CSV</li><li>${icon('doc', 16)}Excel</li><li>${icon('lock', 16)}Secure &amp; Private</li></ul>
      </div>
      <div class="hm-hero-art">${device()}</div>
    </div></section>

    <footer class="hm-foot"><a class="hm-logo" href="#/home"><img src="/assets/logo-mark.png" alt="" width="28" height="32"><span>FinSight <b>AI</b></span></a>
      <p>Smarter Insights <i>·</i> Stronger Finances <i>·</i> Brighter Future</p><span class="hm-lock">${icon('lock', 14)}Your data stays yours</span></footer>
  </div>`;
}
