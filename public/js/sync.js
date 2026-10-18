// Optional: when signed in, mirror each audit entry to Supabase (table audit_events, protected by Row Level
// Security so users can only insert and read their own rows). Best effort — local storage remains the source of truth.

export async function pushAuditEntry(config, session, entry, fetchFn = fetch) {
  if (!config?.url || !config?.anonKey || !session?.accessToken) return { skipped: true };
  const res = await fetchFn(`${config.url}/rest/v1/audit_events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: config.anonKey, authorization: `Bearer ${session.accessToken}`, Prefer: 'return=minimal' },
    body: JSON.stringify({ seq: entry.seq, ts: entry.ts, actor: entry.actor, event: entry.event, details: entry.details, prev_hash: entry.prevHash, hash: entry.hash }),
  });
  return { ok: res.ok, status: res.status };
}
