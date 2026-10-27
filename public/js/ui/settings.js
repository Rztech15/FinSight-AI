import { html } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';
import { pageHeader } from './common.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'PKR', 'INR', 'AED', 'SAR', 'CAD', 'AUD', 'SGD', 'NGN', 'KES', 'ZAR'];
const num = (key, label, hint, { step = 1, min = 0, nullable = true } = {}) => {
  const [a, b] = key.split('.');
  const v = b ? app.settings.collectionRates?.[b] : app.settings[a];
  return html`<label>${label}<input type="number" inputmode="decimal" step="${step}" min="${min}" data-setting="${key}" value="${v ?? ''}" ${nullable ? html`placeholder="auto"` : ''}><small class="muted">${hint}</small></label>`;
};

function accountCard() {
  const c = app.config;
  if (!c.supabase) return html`<section class="card"><div class="card-head"><h2>${icon('user', 18)}Account</h2></div><p class="muted">Sign-in is not enabled on this deployment. The app works fully without an account; decisions and the audit log are kept in this browser.</p></section>`;
  return html`<section class="card" aria-labelledby="acc-h"><div class="card-head"><h2 id="acc-h">${icon('user', 18)}Account</h2></div>
    ${app.session ? html`<p>Signed in as <b>${app.session.user.email}</b>. Audit entries are mirrored to your private, append-only log.</p><button class="btn" data-action="signout">Sign out</button>`
    : html`<form class="form" data-form="signin"><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Password<input name="password" type="password" required minlength="8" autocomplete="current-password"></label>
      <div class="row"><button class="btn primary" type="submit">Sign in</button><button class="btn" type="button" data-action="signup">Create account</button></div>
      ${app.authMsg ? html`<p class="${app.authMsg.error ? 'error' : 'good-note'}" role="status">${app.authMsg.text}</p>` : ''}</form>`}
    ${c.authRequired ? html`<p class="muted small">This deployment requires sign-in for AI features.</p>` : ''}</section>`;
}

export function settingsView() {
  return html`${pageHeader('Settings', 'Assumptions used by the forecast, privacy controls and appearance.')}
    <div class="grid-2">
      <section class="card" aria-labelledby="fs-h"><div class="card-head"><h2 id="fs-h">${icon('gear', 18)}Forecast assumptions</h2></div>
        <div class="form">
          <label>Currency<select data-setting="currency">${CURRENCIES.map((c) => html`<option ${c === app.settings.currency ? 'selected' : ''}>${c}</option>`)}</select></label>
          ${num('openingBalance', 'Opening balance', 'Only used when the file has no running balance.', { step: 0.01, min: -1e12 })}
          ${num('minimumCashBuffer', 'Minimum cash buffer', 'Shortfall alerts fire below this level.', { step: 100, nullable: false })}
          ${num('paymentTermsDays', 'Payment terms (days)', 'Blank = inferred from your invoices.')}
          ${num('receivableDelayDays', 'Customers pay late by (days)', 'Blank = inferred from paid invoices.')}
          ${num('payableDelayDays', 'You pay suppliers late by (days)', 'Blank = inferred.')}
          ${num('overdueCollectionDays', 'Collect overdue invoices in (days)', 'Counted from the as-of date.', { nullable: false })}
        </div></section>
      <div class="stack">
        <section class="card" aria-labelledby="cr-h"><div class="card-head"><h2 id="cr-h">Collection rates</h2></div>
          <p class="muted small">Share of each open invoice expected to be collected, by age. Values between 0 and 1.</p>
          <div class="form two">${num('collectionRates.current', 'Not yet due', '', { step: 0.01, nullable: false })}${num('collectionRates.d1_30', '1–30 days late', '', { step: 0.01, nullable: false })}${num('collectionRates.d31_60', '31–60 days late', '', { step: 0.01, nullable: false })}${num('collectionRates.d61plus', '61+ days late', '', { step: 0.01, nullable: false })}</div></section>
        <section class="card" aria-labelledby="pv-h"><div class="card-head"><h2 id="pv-h">${icon('lock', 18)}Privacy</h2></div>
          <label class="check"><input type="checkbox" data-privacy="withholdNames" ${app.privacy.withholdNames ? 'checked' : ''}> Replace customer and supplier names with “Customer 1”, “Supplier 2”… before anything goes to the AI</label>
          <label class="check"><input type="checkbox" data-privacy="rememberData" ${app.privacy.rememberData ? 'checked' : ''}> Remember my loaded file on this device (current file 24 hours; History up to 10 files for 30 days). Turning this off erases both</label>
          ${app.analysis && !app.analysis.empty ? html`<div class="row"><button class="btn small" data-action="clear-data">Clear loaded data now</button></div>` : ''}
          <p class="muted small">Transactions never leave your browser. The AI only receives aggregated figures. ${app.config.aiConfigured ? 'An AI provider is configured on this deployment.' : 'No AI provider is configured, so rules-based answers are used.'}</p></section>
        <section class="card"><div class="card-head"><h2>Appearance</h2></div>
          <div class="row"><button class="btn ${app.theme === 'dark' ? 'primary' : ''}" data-action="theme" data-theme="dark">${icon('moon', 16)}Dark</button><button class="btn ${app.theme === 'light' ? 'primary' : ''}" data-action="theme" data-theme="light">${icon('sun', 16)}Light</button></div></section>
        ${accountCard()}
        <section class="card"><div class="card-head"><h2>Local data</h2></div><p class="muted small">Clears settings, decisions and the audit log stored in this browser, and removes the loaded file from memory.</p><button class="btn danger" data-action="reset-all">Reset everything</button></section>
      </div></div>`;
}
