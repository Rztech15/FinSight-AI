// Application state. Raw financial data lives ONLY in memory (never written to storage).
// Settings, decisions and the audit log are small and non-sensitive, so they persist in localStorage.

import { store } from './dom.js';
import { DEFAULT_SETTINGS } from '../core/util.js';

const K = { settings: 'finsight.settings.v1', decisions: 'finsight.decisions.v1', audit: 'finsight.audit.v1', theme: 'finsight.theme.v1', privacy: 'finsight.privacy.v1' };

export const app = {
  route: 'dashboard',
  fileName: null,
  isDemo: false,
  table: null, // parsed {headers, rows}
  mapping: null,
  mapConfidence: null,
  mapNotes: [],
  mapOptions: { dayFirst: 'auto', swapDebitCredit: false },
  importResult: null, // {transactions, issues, stats}
  settings: { ...DEFAULT_SETTINGS, ...(store.get(K.settings, {}) || {}) },
  analysis: null,
  evidence: [],
  actions: [], // analysis.actions merged with persisted decisions
  decisions: store.get(K.decisions, {}) || {},
  audit: store.get(K.audit, []) || [],
  auditStatus: null,
  ai: { status: 'idle', narrative: null, source: null, reason: null },
  chat: [],
  privacy: { withholdNames: store.get(K.privacy, { withholdNames: true }).withholdNames !== false },
  theme: store.get(K.theme, null) || (globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  config: { aiConfigured: false, authRequired: false, supabase: null },
  session: null,
  scenario: { active: {}, params: {} },
  scenarioResult: null,
  financingSim: null,
  busy: false,
  toast: null,
  error: null,
};

export function persistSettings() { store.set(K.settings, app.settings); }
export function persistDecisions() { store.set(K.decisions, app.decisions); }
export function persistAudit() { store.set(K.audit, app.audit.slice(-500)); }
export function persistTheme() { store.set(K.theme, app.theme); }
export function persistPrivacy() { store.set(K.privacy, app.privacy); }
export function resetPersisted() {
  Object.values(K).forEach((k) => store.remove(k));
}
