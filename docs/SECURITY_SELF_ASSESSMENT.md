# Security self-assessment

Scope: FinSight AI MVP (sandbox). Written from the code; items marked **tested** have an automated test, others are design properties reviewed by reading the code.

## Permission tiers
| Tier | Capability | Gate |
|---|---|---|
| 0 Read | Parse uploaded file, compute metrics/forecast/risks in the browser | none (local) |
| 1 Explain | Send aggregated evidence to AI via `/api/analyze` | evidence schema validation; optional sign-in |
| 2 Propose | Generate recommended actions and drafts | read-only; nothing executes |
| 3 Approve | User approves/rejects an action | explicit click; logged |
| 4 Execute | “Run in sandbox” only after approval | writes sandbox result + audit entry; **no real-world side effects exist in the code** |
| — | Real payments, emails, lender submissions | **not implemented** |

## Controls
- Raw transactions never leave the browser or reach storage (design). Only settings, decisions, audit log, theme, privacy flag go to localStorage.
- AI input limited to ≤80 aggregated evidence items; counterparty names anonymized by default (**tested**).
- AI output grounded: ungrounded figures, unknown citations, and numbers in follow-ups are rejected (**tested**).
- API: POST+JSON only, same-origin check, 64 KB body cap, strict schema, 20 req/min limit, secrets never returned, fail-closed auth (**tested**).
- XSS: escape-by-default templating; CSV-derived text inert in a real browser (**tested** in smoke test); strict CSP with no inline script.
- Spreadsheet formula injection neutralised on CSV export (**tested**).
- XLSX reader: 10 MB file cap, 60 MB per-part inflate cap, no macro/formula execution.
- Audit log tamper detection (**tested**); optional Supabase mirror with RLS and no update/delete policy.

## Known risks / not covered
1. Rate limit is in-memory per serverless instance — best effort only.
2. localStorage audit log can be cleared by the user; the Supabase mirror is the durable copy and requires configuring it.
3. The AI provider receives aggregated business figures (and names if the user disables anonymization); use a provider whose terms fit your data policy.
4. Prompt injection via CSV text is mitigated (aggregation, anonymization, grounding) but not impossible; AI text never triggers actions.
5. No penetration test, dependency audit service, or formal compliance review was performed. This is not a regulated product.
6. Supabase schema and auth flow were written to the documented REST API but **not tested against a live Supabase project**.
7. The live AI provider call is tested with mocked HTTP only.
