import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../public/js/auth.js';
import { pushAuditEntry } from '../public/js/sync.js';
import { requestSummary, requestAnswer } from '../public/js/ai-client.js';
import { html } from '../public/js/dom.js';

const ev = [{ id: 'E1', key: 'cash', label: 'Cash on hand', text: '$1,000', value: 1000 }];
const resp = (status, json) => async () => ({ status, ok: status < 400, json: async () => json });

test('html template escapes untrusted text', () => {
  assert.equal(String(html`<p>${'<img src=x onerror=1>'}</p>`), '<p>&lt;img src=x onerror=1&gt;</p>');
});
test('auth: signIn returns session, bad credentials throw', async () => {
  const a = createAuth({ url: 'https://x.supabase.co', anonKey: 'k' }, resp(200, { access_token: 't', refresh_token: 'r', expires_in: 60, user: { id: 'u', email: 'a@b.c' } }));
  assert.equal((await a.signIn('a@b.c', 'password1')).user.email, 'a@b.c');
  const bad = createAuth({ url: 'https://x.supabase.co', anonKey: 'k' }, resp(400, { error_description: 'Invalid login' }));
  await assert.rejects(bad.signIn('a', 'b'), /Invalid login/);
  assert.equal(createAuth(null).enabled, false);
});
test('sync: skips without session, posts hashed entry with user token', async () => {
  assert.deepEqual(await pushAuditEntry({ url: 'u', anonKey: 'k' }, null, {}), { skipped: true });
  let seen;
  const f = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 201 }; };
  const r = await pushAuditEntry({ url: 'https://x.supabase.co', anonKey: 'k' }, { accessToken: 'tok' }, { seq: 1, ts: 't', actor: 'a', event: 'e', details: {}, prevHash: '0', hash: 'h' }, f);
  assert.equal(r.ok, true);
  assert.equal(seen.opts.headers.authorization, 'Bearer tok');
  assert.ok(seen.url.endsWith('/rest/v1/audit_events'));
});
test('ai-client: uses API result when valid, falls back offline / on 401', async () => {
  const ok = await requestSummary(ev, { fetchFn: resp(200, { source: 'ai', model: 'm', narrative: { summary: 'x', points: [] } }) });
  assert.equal(ok.source, 'ai');
  const off = await requestSummary(ev, { fetchFn: async () => { throw new Error('net'); } });
  assert.equal(off.source, 'deterministic'); assert.equal(off.reason, 'offline');
  const un = await requestSummary(ev, { fetchFn: resp(401, {}) });
  assert.equal(un.reason, 'sign_in_required');
  const ans = await requestAnswer('how much cash do I have', ev, { fetchFn: resp(503, { reason: 'ai_not_configured' }) });
  assert.equal(ans.source, 'deterministic'); assert.match(ans.answer, /\[E1\]/);
});
test('ai-client sends only evidence, never raw rows', async () => {
  let body;
  await requestSummary(ev, { fetchFn: async (u, o) => { body = JSON.parse(o.body); return { status: 200, json: async () => ({}) }; } });
  assert.deepEqual(Object.keys(body).sort(), ['evidence', 'task']);
});

test('auth: recover posts to the recover endpoint', async () => {
  let url;
  const a = createAuth({ url: 'https://x.supabase.co', anonKey: 'k' }, async (u) => { url = u; return { ok: true, status: 200, json: async () => ({}) }; });
  assert.deepEqual(await a.recover('a@b.c'), { sent: true });
  assert.ok(url.endsWith('/auth/v1/recover'));
});

test('auth: Google URL targets Supabase authorize; redirect hash becomes a session', async () => {
  const f = async (u, o) => ({ ok: true, status: 200, json: async () => ({ id: 'u9', email: 'g@x.com' }) });
  const a = createAuth({ url: 'https://x.supabase.co', anonKey: 'k' }, f);
  const url = new URL(a.googleUrl('https://app.example/'));
  assert.equal(url.pathname, '/auth/v1/authorize'); assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(url.searchParams.get('redirect_to'), 'https://app.example/');
  const s = await a.fromRedirect('#access_token=tok&refresh_token=r&expires_in=100&token_type=bearer');
  assert.equal(s.user.email, 'g@x.com'); assert.equal(s.accessToken, 'tok');
  assert.equal(await a.fromRedirect('#/dashboard'), null);
  await assert.rejects(a.fromRedirect('#error=access_denied&error_description=Denied'), /Denied/);
});
