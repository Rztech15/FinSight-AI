# Architecture

```
Browser (ES modules, no build)                         Vercel serverless
┌───────────────────────────────────────────┐          ┌──────────────────────────┐
│ file → csv.js / xlsx.js → ingest.js       │          │ api/analyze.js           │
│   → pipeline.analyze()                    │          │  validate evidence schema│
│       metrics → forecast → health → risk  │ evidence │  same-origin, 64k, rate  │
│       → financing → actions               │ ───────► │  optional Supabase JWT   │
│   → evidence.buildEvidence() (E1…En)      │          │  call AI provider        │
│   ◄── validateNarrative() grounding guard │ ◄─────── │  returns narrative       │
│ UI views (escape-by-default templates)    │          └──────────────────────────┘
│ audit.js hash chain → localStorage        │──(optional)──► Supabase audit_events (RLS)
└───────────────────────────────────────────┘
```

## Core algorithm (public/core)
- **Ingest** — delimiter/BOM detection, RFC-4180 parsing, header→field scoring with content checks, date-order inference, debit/credit handling, open-invoice rows (unpaid/open/overdue/pending) treated as receivables/payables not cash.
- **Forecast** — weekly buckets; recurring detection (weekly→quarterly, amount CV ≤ 0.2); open invoices scheduled at due date + observed lateness with age-based collection rates (0.97/0.9/0.75/0.5); invoice-linked flows use max(schedule, run-rate) so nothing is double-counted; direct flows use a winsorized recency-weighted run-rate; 80% band = ±1.2816·σ·√week on unscheduled flows.
- **Health score** — runway 30, cash flow 20, margin 15, receivables 15, concentration 10, stability 10, outlook 20; weights renormalised when data is missing; unavailable inputs are shown as unavailable, not zero.
- **Risks** — 11 rule detectors, each returning the exact evidence that fired it.
- **Actions** — each carries forecast adjustments, so its impact is calculated by re-running the model. State machine proposed → approved → executed(sandbox) / rejected.
- **Financing** — five illustrative archetypes; eligibility, cost range, fit score, cash-effect simulation. Always labelled “not an offer”.
- **Grounding guard** — each number in AI text must match an evidence item cited by that sentence (tolerance max(rounding, 0.6%)); unknown E-ids rejected; failure → deterministic narrative.
- **Audit** — entry hash = SHA-256(seq, ts, actor, event, details, prevHash); `verifyChain` detects edit/delete/reorder.

## Why no dependencies
Smaller supply-chain surface (the common xlsx library has known CVEs), reproducible installs, and one code path shared by browser, API and tests.

## Local persistence
`public/js/persist.js` keeps the parsed file in IndexedDB (24 h expiry, user-switchable) and restores it on boot, so reloads and mobile file-picker tab reloads do not force a re-upload. Nothing is sent to a server.
History: `persist.js` also keeps an index of up to 10 analysed files (30-day expiry) plus each parsed table in a second IndexedDB store; `ui/history.js` lists, reopens and deletes them. The sign-in session lives in sessionStorage.
