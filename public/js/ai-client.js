// Browser side of the AI layer: sends ONLY the evidence list to /api/analyze. If the API is unreachable,
// unconfigured or declines, the deterministic narrative built from the same evidence is used instead.

import { deterministicNarrative, answerFromEvidence } from '../core/evidence.js';

async function post(body, token, fetchFn) {
  const res = await fetchFn('/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  return { status: res.status, json };
}

export async function requestSummary(evidence, { token = null, fetchFn = fetch } = {}) {
  try {
    const { status, json } = await post({ task: 'summary', evidence }, token, fetchFn);
    if (status === 401) return { ...local('summary', evidence), reason: 'sign_in_required' };
    if (status === 200 && json?.narrative) return { source: json.source, model: json.model, reason: json.reason || null, narrative: json.narrative };
    return { ...local('summary', evidence), reason: json?.reason || 'unavailable' };
  } catch {
    return { ...local('summary', evidence), reason: 'offline' };
  }
}

export async function requestAnswer(question, evidence, { token = null, fetchFn = fetch } = {}) {
  try {
    const { status, json } = await post({ task: 'ask', question, evidence }, token, fetchFn);
    if (status === 200 && json?.answer) return { source: json.source, model: json.model, reason: json.reason || null, answer: json.answer, evidence: json.evidence || [] };
    if (status === 429) return { source: 'deterministic', reason: 'rate_limited', ...answerFromEvidence(question, evidence) };
    return { reason: status === 401 ? 'sign_in_required' : json?.reason || 'unavailable', ...answerFromEvidence(question, evidence) };
  } catch {
    return { reason: 'offline', ...answerFromEvidence(question, evidence) };
  }
}

function local(task, evidence) {
  return { source: 'deterministic', model: null, narrative: deterministicNarrative(evidence) };
}

export const REASON_TEXT = {
  ai_not_configured: 'AI provider not configured — showing the rules-based summary.',
  provider_unavailable: 'AI provider unavailable — showing the rules-based summary.',
  invalid_model_output: 'AI reply could not be used — showing the rules-based summary.',
  grounding_check_failed: 'The AI reply contained figures that could not be verified, so it was discarded.',
  sign_in_required: 'Sign in to use the AI assistant — showing the rules-based summary.',
  offline: 'AI service not reachable — showing the rules-based summary.',
  rate_limited: 'Too many requests — showing the rules-based answer.',
  unavailable: 'AI service unavailable — showing the rules-based summary.',
};
