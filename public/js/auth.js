// Optional Supabase email/password auth over plain REST (no SDK). The access token is kept in memory only.

export function createAuth(config, fetchFn = fetch) {
  const base = config?.url;
  const headers = { 'content-type': 'application/json', apikey: config?.anonKey };
  const toSession = (j) => ({ accessToken: j.access_token, refreshToken: j.refresh_token, user: { id: j.user?.id, email: j.user?.email }, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 });
  return {
    googleUrl(redirectTo) {
      return `${base}/auth/v1/authorize?${new URLSearchParams({ provider: 'google', redirect_to: redirectTo })}`;
    },
    /** Complete an OAuth redirect: Supabase returns tokens in the URL fragment. */
    async fromRedirect(hash) {
      const q = new URLSearchParams(String(hash).replace(/^#\/?/, ''));
      if (q.get('error')) throw new Error(q.get('error_description') || 'Google sign-in was cancelled.');
      const accessToken = q.get('access_token');
      if (!accessToken) return null;
      const r = await fetchFn(`${base}/auth/v1/user`, { headers: { apikey: config?.anonKey, authorization: `Bearer ${accessToken}` } });
      const u = await r.json().catch(() => ({}));
      if (!r.ok || !u.id) throw new Error('Google sign-in could not be completed. Try again.');
      return { accessToken, refreshToken: q.get('refresh_token'), user: { id: u.id, email: u.email }, expiresAt: Date.now() + (Number(q.get('expires_in')) || 3600) * 1000 };
    },
    enabled: !!(base && config?.anonKey),
    async signIn(email, password) {
      const r = await fetchFn(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers, body: JSON.stringify({ email, password }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) throw new Error(j.error_description || j.msg || 'Sign-in failed. Check your email and password.');
      return toSession(j);
    },
    async signUp(email, password) {
      const r = await fetchFn(`${base}/auth/v1/signup`, { method: 'POST', headers, body: JSON.stringify({ email, password }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.msg || j.error_description || 'Could not create the account.');
      return j.access_token ? toSession(j) : { pendingConfirmation: true };
    },
    async recover(email) {
      const r = await fetchFn(`${base}/auth/v1/recover`, { method: 'POST', headers, body: JSON.stringify({ email }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.msg || j.error_description || 'Could not send the reset email.'); }
      return { sent: true };
    },
    async signOut(session) {
      if (!session?.accessToken) return;
      await fetchFn(`${base}/auth/v1/logout`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${session.accessToken}` } }).catch(() => {});
    },
  };
}
