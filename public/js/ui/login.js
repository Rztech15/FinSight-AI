import { html } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';

const copy = (mode) => ({
  signin: app.returning ? { title: 'Welcome back', sub: 'Sign in to your FinSight AI account.' } : { title: 'Sign in', sub: 'Sign in to your existing FinSight AI account.' },
  signup: { title: 'Welcome to FinSight AI', sub: 'Create your free account, or continue as a guest, to start making smarter financial decisions.' },
  reset: { title: 'Reset your password', sub: 'Enter your email and we will send you a link to reset your password.' },
})[mode];

function fields(mode, off) {
  const d = off ? 'disabled' : '';
  if (mode === 'reset') return html`<label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@company.com" ${d}></label>`;
  return html`<label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@company.com" ${d}></label>
    <label>Password<input name="password" type="password" required minlength="8" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" placeholder="At least 8 characters" ${d}></label>
    ${mode === 'signup' ? html`<label>Confirm password<input name="confirm" type="password" required minlength="8" autocomplete="new-password" ${d}></label>
      <label class="check"><input name="agree" type="checkbox" required ${d}> I understand FinSight AI is decision support, not financial advice.</label>` : html`<div class="row between"><span></span><button type="button" class="link" data-action="auth-mode" data-mode="reset">Forgot password?</button></div>`}`;
}

export function loginView() {
  const mode = app.authMode || (app.returning ? 'signin' : 'signup');
  const c = copy(mode);
  const off = !app.config.supabase;
  const btn = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset link' }[mode];
  return html`<div class="auth-wrap">
    <section class="auth-hero" aria-label="About FinSight AI">
      <img src="/assets/logo-full.png" alt="FinSight AI" width="190">
      <h2 class="hero-h">Turn financial data into better decisions.</h2>
      <ul class="plain hero-list">
        <li>${icon('trend', 18)}<span><b>Verified forecasts</b><br><small>13-week cash outlook with risk bands, calculated from your data.</small></span></li>
        <li>${icon('shield', 18)}<span><b>Explainable AI</b><br><small>The AI explains verified numbers and cites them. It never invents figures.</small></span></li>
        <li>${icon('lock', 18)}<span><b>You stay in control</b><br><small>Actions need your approval and run in a sandbox. No real money moves.</small></span></li>
      </ul>
    </section>
    <section class="auth-card card" aria-labelledby="auth-h">
      <h1 id="auth-h">${c.title}</h1><p class="sub">${c.sub}</p>
      ${off ? html`<p class="note warnbox">${icon('info', 16)}<span>Accounts are not enabled on this deployment (Supabase is not configured). You can continue as a guest: everything works, and your data stays in this browser.</span></p>` : ''}
      <form class="form" data-form="login-${mode}" novalidate>
        ${fields(mode, off)}
        ${app.authMsg ? html`<p class="${app.authMsg.error ? 'error' : 'good-note'}" role="status">${icon(app.authMsg.error ? 'alert' : 'check', 16)}${app.authMsg.text}</p>` : ''}
        <button class="btn primary big full" type="submit" ${off ? 'disabled' : ''}>${btn}</button>
      </form>
      ${mode !== 'reset' ? html`<div class="divider"><span>or</span></div>
      <button class="btn full" data-action="google" ${off ? 'disabled' : ''}><svg class="ico" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9a6 6 0 1 1 0-12c1.9 0 3.1.8 3.8 1.5l2.6-2.5A9.6 9.6 0 0 0 12 2.4a9.6 9.6 0 1 0 0 19.2c5.5 0 9.2-3.9 9.2-9.3 0-.6-.1-1.1-.2-1.600z"/></svg>Continue with Google</button>` : ''}
      <div class="divider"><span>or</span></div>
      <div class="stack tight">
        <button class="btn full" data-action="guest">${icon('user', 16)}Continue as guest</button>
        <button class="btn full ghost" data-action="load-demo">${icon('spark', 16)}Explore the demo business</button>
      </div>
      <p class="auth-switch muted small">${mode === 'signin' ? html`Don't have an account? <button class="link" data-action="auth-mode" data-mode="signup">Sign up</button>`
    : mode === 'signup' ? html`Already have an account? <button class="link" data-action="auth-mode" data-mode="signin">Sign in</button>`
      : html`<button class="link" data-action="auth-mode" data-mode="signin">← Back to sign in</button>`}</p>
      <p class="fineprint">${icon('lock', 12)} Your transactions are analysed in your browser and are never uploaded.</p>
    </section></div>`;
}
