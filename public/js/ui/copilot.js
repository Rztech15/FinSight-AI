import { html } from '../dom.js';
import { icon } from '../icons.js';
import { app } from '../state.js';
import { REASON_TEXT } from '../ai-client.js';
import { pageHeader, needData, cited, aiBadge } from './common.js';

const SUGGESTIONS = ['How long will my cash last?', 'Will I run out of cash?', 'Who owes me money?', 'What are my biggest risks?', 'What should I do next?', 'How is my profit margin?'];

export function copilotView() {
  const a = app.analysis;
  if (!a || a.empty) return needData('Ask questions about your numbers');
  return html`${pageHeader('AI copilot', 'Ask in plain language. Answers use only your verified figures and cite them. It cannot move money or contact anyone.')}
    <section class="card chat" aria-label="Conversation">
      <div class="chat-log" id="chat-log" role="log" aria-live="polite">
        ${app.chat.length === 0 ? html`<div class="chat-empty"><img src="/assets/logo-mark.png" alt="" width="40" height="46"><p>Try one of these:</p><div class="chips">${SUGGESTIONS.map((s) => html`<button class="chip" data-action="ask" data-q="${s}">${s}</button>`)}</div></div>` : ''}
        ${app.chat.map((m) => (m.role === 'user'
    ? html`<div class="msg user"><p>${m.text}</p></div>`
    : html`<div class="msg bot"><div class="msg-meta">${m.pending ? 'Thinking…' : aiBadge(m.source)}</div><p>${m.pending ? '' : cited(m.text)}</p>${m.reason && m.source !== 'ai' ? html`<p class="note">${icon('info', 14)}${REASON_TEXT[m.reason] || ''}</p>` : ''}</div>`))}
      </div>
      <form class="chat-form" data-form="ask" autocomplete="off">
        <label class="visually-hidden" for="q">Your question</label>
        <input id="q" name="q" type="text" maxlength="300" placeholder="Ask about cash, runway, receivables, risks…" required>
        <button class="btn primary" type="submit" ${app.busy ? 'disabled' : ''}>${icon('send', 16)}Ask</button>
      </form>
      <p class="fineprint">Decision support only — not financial, legal or tax advice. ${app.config.aiConfigured ? 'AI answers are checked: any reply with a figure that cannot be traced to your data is discarded.' : 'No AI provider is configured on this deployment, so answers come from the rules-based engine.'}</p>
    </section>`;
}
