// App shell: boot, hash router, event delegation, and the glue between UI and the deterministic engines.

import { html, esc, download } from './dom.js';
import { icon } from './icons.js';
import { app, persistSettings, persistDecisions, persistAudit, persistTheme, persistPrivacy, resetPersisted } from './state.js';
import { DEFAULT_SETTINGS } from '../core/util.js';
import { parseCSV } from '../core/csv.js';
import { readXlsx, MAX_XLSX_BYTES } from '../core/xlsx.js';
import { detectColumns, validateMapping, normalizeRows } from '../core/ingest.js';
import { analyze } from '../core/pipeline.js';
import { buildEvidence, deterministicNarrative } from '../core/evidence.js';
import { SCENARIO_TEMPLATES, templateDefaults, mergeAdjustments, simulate } from '../core/scenarios.js';
import { measureResults } from '../core/actions.js';
import { appendEntry, verifyChain, exportLog } from '../core/audit.js';
import { requestSummary, requestAnswer } from './ai-client.js';
import { createAuth } from './auth.js';
import { pushAuditEntry } from './sync.js';
import { dashboardView } from './ui/dashboard.js';
import { uploadView } from './ui/upload.js';
import { forecastView } from './ui/forecast.js';
import { risksView } from './ui/risks.js';
import { healthView } from './ui/health.js';
import { financingView } from './ui/financing.js';
import { actionsView } from './ui/actions.js';
import { copilotView } from './ui/copilot.js';
import { settingsView } from './ui/settings.js';
import { loginView } from './ui/login.js';
import { methodologyView } from './ui/methodology.js';

const MAX_FILE = MAX_XLSX_BYTES;
const VIEWS = { dashboard: dashboardView, upload: uploadView, copilot: copilotView, forecast: forecastView, risks: risksView, health: healthView, financing: financingView, actions: actionsView, settings: settingsView, methodology: methodologyView, login: loginView };
const NAV = [
  ['dashboard', 'Dashboard', 'grid'], ['upload', 'Data Upload', 'upload'], ['copilot', 'AI Copilot', 'bot'], ['forecast', 'Cash Flow Forecast', 'trend'],
  ['risks', 'Risk Intelligence', 'shield'], ['health', 'Financial Health', 'heart'], ['financing', 'Financing Options', 'bank'], ['actions', 'Actions & Audit', 'check'],
  ['settings', 'Settings', 'gear'], ['methodology', 'How it works', 'info'],
];
let auth = createAuth(null);

/* ---------- shell ---------- */
function shell() {
  document.getElementById('app').innerHTML = html`
    <a class="skip" href="#view">Skip to content</a>
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <a class="brand" href="#/dashboard"><img src="/assets/logo-full.png" alt="FinSight AI" width="170"></a>
      <nav><ul>${NAV.map(([r, label, ic]) => html`<li><a href="#/${r}" data-nav="${r}">${icon(ic, 18)}<span>${label}</span></a></li>`)}</ul></nav>
      <div class="side-foot"><a href="#/login" class="acct-link" id="acct-link"></a><span class="sandbox-chip">${icon('lock', 14)}Sandbox mode</span><span class="muted small">No real money moves.</span></div>
    </aside>
    <div class="main-col">
      <header class="topbar"><button class="icon-btn menu-btn" data-action="menu" aria-label="Open menu">${icon('menu', 20)}</button>
        <div class="top-title" id="top-title"></div>
        <span class="status-chip" id="status-chip"></span>
        <button class="icon-btn" data-action="theme-toggle" aria-label="Switch between dark and light theme">${icon('sun', 20)}</button></header>
      <main id="view" tabindex="-1"></main>
    </div>
    <div id="toast" role="status" aria-live="polite"></div><div id="tip" role="tooltip" hidden></div>`.toString();
}

const routeOf = () => { const r = location.hash.replace(/^#\/?/, '').split('?')[0]; return VIEWS[r] ? r : 'dashboard'; };

function render({ top = false } = {}) {
  const view = document.getElementById('view');
  if (!view) return;
  const y = window.scrollY;
  const focus = document.activeElement;
  const sel = focus?.dataset ? ['data-setting', 'data-map', 'data-map-option', 'data-sc-param', 'data-sc-toggle', 'data-privacy'].map((k) => (focus.hasAttribute?.(k) ? `[${k}="${CSS.escape(focus.getAttribute(k))}"]` : null)).find(Boolean) : null;
  try { view.innerHTML = String(VIEWS[app.route]()); } catch (e) {
    console.error(e);
    view.innerHTML = `<section class="card"><h2>Something went wrong</h2><p class="error">${esc(e.message)}</p></section>`;
  }
  document.querySelectorAll('[data-nav]').forEach((a) => { if (a.dataset.nav === app.route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const label = NAV.find((n) => n[0] === app.route)?.[1] || (app.route === 'login' ? 'Sign in' : '');
  document.getElementById('top-title').textContent = label;
  document.title = `${label} · FinSight AI`;
  const chip = document.getElementById('status-chip');
  chip.textContent = app.analysis && !app.analysis.empty ? (app.isDemo ? 'Demo data' : app.fileName || 'Data loaded') : 'No data loaded';
  document.documentElement.dataset.theme = app.theme;
  document.body.classList.toggle('auth-page', app.route === 'login');
  const al = document.getElementById('acct-link');
  if (al) al.textContent = app.session ? `Signed in: ${app.session.user.email}` : 'Sign in / Sign up';
  if (top) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); } else window.scrollTo(0, y);
  if (sel) document.querySelector(sel)?.focus({ preventScroll: true });
  const log = document.getElementById('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
}

function go(route) { if (location.hash !== `#/${route}`) location.hash = `#/${route}`; else { app.route = route; render({ top: true }); } }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500);
}

/* ---------- data loading ---------- */
async function handleFile(file) {
  app.error = null;
  try {
    if (!file) return;
    if (file.size > MAX_FILE) throw new Error('That file is larger than 10 MB. Export a shorter period and try again.');
    const name = file.name || 'file';
    let table;
    if (/\.xlsx$/i.test(name)) table = await readXlsx(await file.arrayBuffer());
    else if (/\.(csv|tsv|txt)$/i.test(name) || /text|csv/.test(file.type)) table = parseCSV(await file.text());
    else throw new Error('Unsupported file type. Use .csv, .tsv, .txt or .xlsx.');
    setTable(table, name, false);
  } catch (e) { app.error = e.message || 'The file could not be read.'; }
  go('upload'); render();
}

function setTable(table, name, demo) {
  if (!table.rows.length) throw new Error('The file has a header but no data rows.');
  app.table = table; app.fileName = name; app.isDemo = demo;
  const d = detectColumns(table.headers, table.rows);
  app.mapping = d.mapping; app.mapConfidence = d.confidence; app.mapNotes = d.notes || [];
  app.mapOptions = { dayFirst: 'auto', swapDebitCredit: false };
  app.analysis = null; app.importResult = null; app.chat = [];
  runImport();
}

function runImport() {
  app.importResult = null;
  if (!app.table || !validateMapping(app.mapping).ok) return;
  const o = app.mapOptions;
  app.importResult = normalizeRows(app.table.rows, app.mapping, { dayFirst: o.dayFirst === 'auto' ? undefined : o.dayFirst, swapDebitCredit: o.swapDebitCredit });
}

const effectiveSettings = () => (app.isDemo ? { ...app.settings, currency: 'USD', openingBalance: null } : app.settings);

function mergeActions() {
  app.actions = (app.analysis?.actions || []).map((x) => ({ ...x, state: app.decisions[x.id]?.state || 'proposed' }));
  app.results = app.analysis && !app.analysis.empty && app.analysis.forecast.available ? measureResults(app.analysis.prep, app.analysis.forecast, app.actions) : null;
}

function runAnalysis({ fetchAi = true } = {}) {
  if (!app.importResult) return;
  app.analysis = analyze(app.importResult.transactions, effectiveSettings(), app.importResult.stats);
  app.scenarioResult = null; app.financingSim = null;
  if (app.analysis.empty) { app.evidence = []; app.actions = []; return; }
  mergeActions();
  app.evidence = buildEvidence({ metrics: app.analysis.metrics, forecast: app.analysis.forecast, health: app.analysis.health, risks: app.analysis.risks, actions: app.actions, financing: app.analysis.financing }, { withholdNames: app.privacy.withholdNames });
  recomputeScenario();
  const local = deterministicNarrative(app.evidence);
  app.ai = { status: 'idle', narrative: local, source: 'deterministic', reason: app.config.aiConfigured ? null : 'ai_not_configured' };
  if (fetchAi && app.config.aiConfigured) fetchSummary();
}

async function fetchSummary() {
  if (!app.evidence.length) return;
  app.ai = { ...app.ai, status: 'loading' }; render();
  const r = await requestSummary(app.evidence, { token: token() });
  app.ai = { status: 'done', narrative: r.narrative, source: r.source, reason: r.reason };
  render();
}
const token = () => (app.session && app.session.expiresAt > Date.now() ? app.session.accessToken : null);

async function loadDemo() {
  try {
    const res = await fetch('/samples/harbor-pine-roasters-demo.csv');
    if (!res.ok) throw new Error('Demo file not found.');
    setTable(parseCSV(await res.text()), 'harbor-pine-roasters-demo.csv', true);
    runAnalysis(); go('dashboard'); render({ top: true });
  } catch (e) { app.error = e.message; go('upload'); render(); }
}

function recomputeScenario() {
  const a = app.analysis;
  if (!a || a.empty || !a.forecast.available) { app.scenarioResult = null; return; }
  const picked = SCENARIO_TEMPLATES.filter((t) => app.scenario.active[t.id]);
  if (!picked.length) { app.scenarioResult = null; return; }
  const adj = mergeAdjustments(picked.map((t) => t.build({ ...templateDefaults(t), ...(app.scenario.params[t.id] || {}) })));
  app.scenarioResult = simulate(a.prep, a.forecast, adj, a.settings.currency);
}

/* ---------- audit + actions ---------- */
async function record(event, details) {
  app.audit = await appendEntry(app.audit, { actor: app.session?.user?.email || 'local-user', event, details });
  persistAudit();
  app.auditStatus = null;
  const entry = app.audit[app.audit.length - 1];
  pushAuditEntry(app.config.supabase, app.session, entry).catch(() => {});
}

const TRANSITIONS = { approve: ['proposed', 'approved'], reject: ['proposed', 'rejected'], run: ['approved', 'executed'], reopen: ['approved', 'proposed'] };
async function transition(kind, id) {
  const x = app.actions.find((a) => a.id === id);
  const t = TRANSITIONS[kind];
  const from = x?.state;
  const ok = x && (t.includes(from) || (kind === 'reopen' && from === 'rejected'));
  if (!ok) return;
  const to = kind === 'reopen' ? 'proposed' : t[1];
  app.decisions[id] = { state: to, ts: new Date().toISOString() };
  persistDecisions();
  await record(`action_${to}`, { id, title: x.title, from, to, mode: to === 'executed' ? 'sandbox' : 'decision' });
  mergeActions();
  app.evidence = buildEvidence({ metrics: app.analysis.metrics, forecast: app.analysis.forecast, health: app.analysis.health, risks: app.analysis.risks, actions: app.actions, financing: app.analysis.financing }, { withholdNames: app.privacy.withholdNames });
  render();
  if (to === 'executed') toast('Run in sandbox. Nothing was sent and no money moved.');
}

/* ---------- chat ---------- */
async function ask(q) {
  q = String(q || '').trim().slice(0, 300);
  if (!q || app.busy || !app.analysis || app.analysis.empty) return;
  app.busy = true;
  app.chat.push({ role: 'user', text: q }); const m = { role: 'bot', pending: true, text: '' }; app.chat.push(m); render();
  const r = await requestAnswer(q, app.evidence, { token: token() });
  Object.assign(m, { pending: false, text: r.answer, source: r.source, reason: r.reason });
  app.busy = false; render();
  document.getElementById('q')?.focus();
}

/* ---------- events ---------- */
const clickActions = {
  goto: (el) => go(el.dataset.route),
  'load-demo': () => loadDemo(),
  'reset-upload': () => { app.table = null; app.importResult = null; app.mapping = null; app.error = null; render(); },
  analyze: () => { runAnalysis(); go('dashboard'); render({ top: true }); },
  'regen-summary': () => fetchSummary(),
  'goto-action': (el) => { go('actions'); setTimeout(() => document.getElementById(`act-${el.dataset.id}`)?.scrollIntoView({ block: 'center' }), 30); },
  'act-approve': (el) => transition('approve', el.dataset.id),
  'act-reject': (el) => transition('reject', el.dataset.id),
  'act-run': (el) => transition('run', el.dataset.id),
  'act-reopen': (el) => transition('reopen', el.dataset.id),
  'copy-draft': async (el) => { const x = app.actions.find((a) => a.id === el.dataset.id); try { await navigator.clipboard.writeText(`${x.draft.subject}\n\n${x.draft.body}`); toast('Draft copied.'); } catch { toast('Copy failed. Select the text and copy it manually.'); } },
  'audit-verify': async () => { app.auditStatus = await verifyChain(app.audit); render(); },
  'audit-export': () => download('finsight-audit-log.json', exportLog(app.audit)),
  'fin-preview': (el) => {
    const o = app.analysis.financing.options.find((p) => p.product.id === el.dataset.id);
    if (!o?.simulation) return;
    app.financingSim = { id: o.product.id, ...simulate(app.analysis.prep, app.analysis.forecast, mergeAdjustments([o.simulation]), app.analysis.settings.currency) };
    render();
  },
  'fin-clear': () => { app.financingSim = null; render(); },
  ask: (el) => ask(el.dataset.q),
  menu: () => document.body.classList.toggle('nav-open'),
  'theme-toggle': () => setTheme(app.theme === 'dark' ? 'light' : 'dark'),
  theme: (el) => setTheme(el.dataset.theme),
  signout: async () => { await auth.signOut(app.session); app.session = null; go('login'); render(); },
  google: () => { if (auth.enabled) location.assign(auth.googleUrl(`${location.origin}/`)); },
  guest: () => { app.guest = true; app.authMsg = null; go('dashboard'); },
  'auth-mode': (el) => { app.authMode = el.dataset.mode; app.authMsg = null; render(); },
  signup: async () => {
    const f = document.querySelector('[data-form="signin"]');
    if (!f.reportValidity()) return;
    try { const r = await auth.signUp(f.email.value, f.password.value); if (r.pendingConfirmation) app.authMsg = { text: 'Account created. Check your email to confirm it, then sign in.' }; else { app.session = r; app.authMsg = null; } } catch (e) { app.authMsg = { error: true, text: e.message }; }
    render();
  },
  'reset-all': () => {
    if (!confirm('Clear settings, decisions, the audit log and the loaded file from this browser?')) return;
    resetPersisted(); Object.assign(app, { settings: { ...DEFAULT_SETTINGS }, decisions: {}, audit: [], auditStatus: null, analysis: null, table: null, importResult: null, mapping: null, actions: [], results: null, evidence: [], chat: [], isDemo: false });
    go('dashboard'); render({ top: true }); toast('Local data cleared.');
  },
};

function setTheme(t) { app.theme = t; persistTheme(); document.documentElement.dataset.theme = t; render(); }

const NULLABLE = new Set(['openingBalance', 'paymentTermsDays', 'receivableDelayDays', 'payableDelayDays']);
function applySetting(key, raw) {
  const [a, b] = key.split('.');
  let v;
  if (key === 'currency') v = raw;
  else if (raw === '' && NULLABLE.has(key)) v = null;
  else { v = Number(raw); if (!Number.isFinite(v)) return; }
  if (b) app.settings = { ...app.settings, collectionRates: { ...app.settings.collectionRates, [b]: Math.min(1, Math.max(0, v)) } };
  else app.settings = { ...app.settings, [a]: key === 'horizonWeeks' ? Math.min(26, Math.max(4, v)) : v };
  persistSettings();
  if (app.importResult && app.analysis) { runAnalysis({ fetchAi: false }); }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && clickActions[el.dataset.action]) { e.preventDefault(); clickActions[el.dataset.action](el); }
  if (document.body.classList.contains('nav-open') && !e.target.closest('.sidebar') && !el) document.body.classList.remove('nav-open');
  if (e.target.closest('.sidebar a')) document.body.classList.remove('nav-open');
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'file-input') return handleFile(t.files[0]);
  if (t.dataset.setting) { applySetting(t.dataset.setting, t.value); return render(); }
  if (t.dataset.privacy) { app.privacy.withholdNames = t.checked; persistPrivacy(); if (app.analysis && !app.analysis.empty) runAnalysis({ fetchAi: false }); return render(); }
  if (t.dataset.map) { app.mapping = { ...app.mapping, [t.dataset.map]: t.value || null }; runImport(); return render(); }
  if (t.dataset.mapOption) {
    const k = t.dataset.mapOption;
    app.mapOptions = { ...app.mapOptions, [k]: k === 'swapDebitCredit' ? t.checked : (t.value === 'auto' ? 'auto' : t.value === 'true') };
    runImport(); return render();
  }
  if (t.dataset.scToggle) { app.scenario.active[t.dataset.scToggle] = t.checked; recomputeScenario(); return render(); }
  if (t.dataset.scParam) {
    const [id, key] = t.dataset.scParam.split(':');
    const p = SCENARIO_TEMPLATES.find((s) => s.id === id)?.params.find((x) => x.key === key);
    const v = Math.min(p.max, Math.max(p.min, Number(t.value) || p.default));
    app.scenario.params[id] = { ...(app.scenario.params[id] || {}), [key]: v };
    recomputeScenario(); return render();
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  if (f.dataset.form === 'ask') { const q = f.q.value; f.q.value = ''; ask(q); }
  if (f.dataset.form.startsWith('login-')) {
    const mode = f.dataset.form.slice(6);
    if (!f.reportValidity()) return;
    try {
      if (mode === 'signup' && f.password.value !== f.confirm.value) throw new Error('Passwords do not match.');
      if (mode === 'signin') { app.session = await auth.signIn(f.email.value, f.password.value); app.authMsg = null; go('dashboard'); toast('Signed in.'); }
      else if (mode === 'signup') {
        const r = await auth.signUp(f.email.value, f.password.value);
        if (r.pendingConfirmation) app.authMsg = { text: 'Account created. Check your email to confirm it, then sign in.' };
        else { app.session = r; app.authMsg = null; go('dashboard'); }
      } else { await auth.recover(f.email.value); app.authMsg = { text: 'If that email has an account, a reset link is on its way.' }; }
    } catch (err) { app.authMsg = { error: true, text: err.message }; }
    render(); return;
  }
  if (f.dataset.form === 'signin') {
    try { app.session = await auth.signIn(f.email.value, f.password.value); app.authMsg = null; toast('Signed in.'); } catch (err) { app.authMsg = { error: true, text: err.message }; }
    render();
  }
});

document.addEventListener('dragover', (e) => { if (e.target.closest('[data-dropzone]')) { e.preventDefault(); e.target.closest('[data-dropzone]').classList.add('over'); } });
document.addEventListener('dragleave', (e) => { e.target.closest?.('[data-dropzone]')?.classList.remove('over'); });
document.addEventListener('drop', (e) => { const z = e.target.closest('[data-dropzone]'); if (z) { e.preventDefault(); z.classList.remove('over'); handleFile(e.dataTransfer.files[0]); } });

/* tooltips (hover, keyboard focus, and tap) */
const tip = () => document.getElementById('tip');
function showTip(el) {
  const t = tip(); const text = el.getAttribute('data-tip');
  if (!text) return;
  t.textContent = text; t.hidden = false;
  const r = el.getBoundingClientRect(); const w = t.offsetWidth; const h = t.offsetHeight;
  let x = r.left + r.width / 2 - w / 2; x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  let y = r.top - h - 8; if (y < 8) y = r.bottom + 8;
  t.style.left = `${x + window.scrollX}px`; t.style.top = `${y + window.scrollY}px`;
}
const hideTip = () => { const t = tip(); if (t) t.hidden = true; };
document.addEventListener('mouseover', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el); });
document.addEventListener('mouseout', (e) => { if (e.target.closest?.('[data-tip]')) hideTip(); });
document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el); });
document.addEventListener('focusout', hideTip);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideTip(); document.body.classList.remove('nav-open'); } });
window.addEventListener('scroll', hideTip, { passive: true });

window.addEventListener('hashchange', () => { app.route = routeOf(); render({ top: true }); });

/* ---------- boot ---------- */
async function boot() {
  document.documentElement.dataset.theme = app.theme;
  shell();
  const oauthHash = /^#(access_token|error)=/.test(location.hash) ? location.hash : null;
  app.route = location.hash && !oauthHash ? routeOf() : 'login';
  if (!location.hash || oauthHash) history.replaceState(null, '', '#/login');
  render();
  try {
    const r = await fetch('/api/config');
    if (r.ok) { app.config = await r.json(); auth = createAuth(app.config.supabase); }
  } catch { /* static hosting without API: rules-based mode */ }
  if (oauthHash) {
    try { const sess = await auth.fromRedirect(oauthHash); if (sess) { app.session = sess; go('dashboard'); toast('Signed in with Google.'); } }
    catch (e) { app.authMsg = { error: true, text: e.message }; }
  }
  render();
}
boot();
