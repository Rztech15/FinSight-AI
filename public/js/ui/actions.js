import { html } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';
import { money, signedMoney } from '../../core/format.js';
import { describeImpact } from '../../core/actions.js';
import { pageHeader, needData, cur, statePill } from './common.js';

function results() {
  const r = app.results;
  if (!r) return html`<section class="card"><div class="card-head"><h2>${icon('trend', 18)}Measured results</h2></div><p class="muted">Results appear after you approve an action and run it in the sandbox. Approving alone claims nothing.</p></section>`;
  const $ = (v) => money(v, cur());
  return html`<section class="card results" aria-labelledby="rs-h"><div class="card-head"><h2 id="rs-h">${icon('trend', 18)}Measured results · ${r.count} action${r.count > 1 ? 's' : ''} run</h2></div>
    <div class="compare">
      <div><span class="mini-label">Lowest balance</span><b>${$(r.before.min)} → ${$(r.after.min)}</b><small class="${r.minDelta >= 0 ? 'pos' : 'neg'}">${signedMoney(r.minDelta, cur())}</small></div>
      <div><span class="mini-label">Closing balance</span><b>${$(r.before.closing)} → ${$(r.after.closing)}</b><small class="${r.closingDelta >= 0 ? 'pos' : 'neg'}">${signedMoney(r.closingDelta, cur())}</small></div>
      <div><span class="mini-label">First shortfall</span><b>${r.before.shortfallWeek ? `Week ${r.before.shortfallWeek}` : 'None'} → ${r.after.shortfallWeek ? `Week ${r.after.shortfallWeek}` : 'None'}</b></div></div>
    <p class="muted small">These are model results: the forecast re-run with the assumptions of each executed action. Real outcomes depend on customers, suppliers and lenders actually responding.</p></section>`;
}

function actionCard(x) {
  const d = app.decisions[x.id];
  return html`<article class="card action st-${x.state}" id="act-${x.id}">
    <div class="act-head"><h3>${x.title}</h3>${statePill(x.state)}</div>
    <p>${x.rationale}</p>
    <p class="impact">${icon(x.impact ? 'trend' : 'info', 14)}${describeImpact(x.impact, cur())}</p>
    ${x.effectNote ? html`<p class="muted small">${x.effectNote}</p>` : ''}
    <details><summary>Draft: ${x.draft.subject}</summary><pre class="draft">${x.draft.body}</pre><button class="btn small ghost" data-action="copy-draft" data-id="${x.id}">${icon('copy', 14)}Copy draft</button></details>
    ${x.state === 'executed' ? html`<p class="sandbox">${icon('lock', 14)}<b>Sandbox result:</b> ${x.sandboxResult}</p>` : ''}
    <div class="row">
      ${x.state === 'proposed' ? html`<button class="btn primary" data-action="act-approve" data-id="${x.id}">${icon('check', 16)}Approve</button><button class="btn" data-action="act-reject" data-id="${x.id}">Reject</button>` : ''}
      ${x.state === 'approved' ? html`<button class="btn primary" data-action="act-run" data-id="${x.id}">${icon('send', 16)}Run in sandbox</button><button class="btn" data-action="act-reopen" data-id="${x.id}">Withdraw approval</button>` : ''}
      ${x.state === 'rejected' ? html`<button class="btn" data-action="act-reopen" data-id="${x.id}">Reconsider</button>` : ''}
      ${d ? html`<span class="muted small">Last decision ${new Date(d.ts).toLocaleString()}</span>` : ''}
    </div></article>`;
}

function auditTable() {
  const rows = app.audit.slice(-40).reverse();
  return html`<section class="card" aria-labelledby="au-h">
    <div class="card-head"><h2 id="au-h">${icon('lock', 18)}Audit log</h2>
      <div class="row"><button class="btn small" data-action="audit-verify">Verify integrity</button><button class="btn small" data-action="audit-export">${icon('down', 14)}Export JSON</button></div></div>
    ${app.auditStatus ? html`<p class="${app.auditStatus.ok ? 'good-note' : 'error'}" role="status">${icon(app.auditStatus.ok ? 'check' : 'alert', 16)}${app.auditStatus.ok ? `Hash chain verified: ${app.auditStatus.length} entries, none altered.` : `Integrity check failed at entry ${app.auditStatus.brokenAt}: ${app.auditStatus.reason}`}</p>` : ''}
    ${rows.length ? html`<div class="table-wrap"><table class="dense"><thead><tr><th scope="col">#</th><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Event</th><th scope="col">Details</th><th scope="col">Hash</th></tr></thead><tbody>${rows.map((e) => html`<tr><td>${e.seq}</td><td>${new Date(e.ts).toLocaleString()}</td><td>${e.actor}</td><td>${e.event}</td><td class="muted">${e.details.title || e.details.id || ''}${e.details.mode ? ` · ${e.details.mode}` : ''}</td><td><code>${e.hash.slice(0, 10)}</code></td></tr>`)}</tbody></table></div>` : html`<p class="muted">No decisions recorded yet. Each approval, rejection and sandbox run is written here with a hash linking it to the previous entry.</p>`}
  </section>`;
}

export function actionsView() {
  const a = app.analysis;
  if (!a || a.empty) return needData('Review recommended actions');
  const order = { approved: 0, proposed: 1, executed: 2, rejected: 3 };
  const list = [...app.actions].sort((x, y) => order[x.state] - order[y.state]);
  return html`${pageHeader('Actions & audit', 'Recommendations come from the risks found in your data. Nothing happens without your approval.')}
    <p class="note sandbox-note">${icon('lock', 16)}<span><b>Sandbox mode.</b> Approving and running an action records it in the audit log and updates the model. No money moves, nothing is sent, and no one is contacted.</span></p>
    ${results()}
    <div class="stack">${list.length ? list.map(actionCard) : html`<section class="card"><p>No actions are recommended for this data.</p></section>`}</div>
    ${auditTable()}`;
}
