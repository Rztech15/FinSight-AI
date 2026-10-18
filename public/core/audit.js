// Tamper-evident audit log. Each entry stores the SHA-256 of its own content plus the previous
// entry's hash, so editing, deleting or re-ordering any past entry breaks verification.
// The log is the "sandbox operation log" evidence for the human-approved action workflow.

const GENESIS = '0'.repeat(64);

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function canonical(e) {
  return JSON.stringify({ seq: e.seq, ts: e.ts, actor: e.actor, event: e.event, details: e.details, prevHash: e.prevHash });
}

export async function appendEntry(log, { actor, event, details = {} }, now = () => new Date().toISOString()) {
  const prev = log[log.length - 1];
  const entry = { seq: log.length + 1, ts: now(), actor, event, details, prevHash: prev ? prev.hash : GENESIS };
  entry.hash = await sha256Hex(canonical(entry));
  return [...log, entry];
}

export async function verifyChain(log) {
  let prev = GENESIS;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.seq !== i + 1 || e.prevHash !== prev) return { ok: false, brokenAt: i + 1, reason: 'Chain link does not match.' };
    if ((await sha256Hex(canonical(e))) !== e.hash) return { ok: false, brokenAt: i + 1, reason: 'Entry content was modified.' };
    prev = e.hash;
  }
  return { ok: true, length: log.length };
}

export function exportLog(log, meta = {}) {
  return JSON.stringify({ format: 'finsight-audit-log/v1', exportedAt: new Date().toISOString(), mode: 'SANDBOX — no real transactions', ...meta, entries: log }, null, 2);
}
