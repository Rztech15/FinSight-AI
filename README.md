# FinSight AI — Turn Financial Data into Better Decisions

An SME finance copilot built for **FinTechathon 2026 · International Track · Topic E**.
Upload a bank/ledger export → verified calculations → cash-flow forecast with risk bands → rule-based risk alerts → financing-option matching → **human-approved, simulated** actions → measured results, with a tamper-evident audit log.

**The AI explains verified numbers; it never invents them. No real money moves, nothing is sent, no lender is contacted (sandbox only).**

## Screenshots
Synthetic demo data (“Harbor & Pine Roasters”), captured from the running app.

| | |
|---|---|
| **Sign in** ![Login](docs/screenshots/login.png) | **Create account** ![Sign up](docs/screenshots/signup.png) |
| **Reset password** ![Reset](docs/screenshots/reset-password.png) | **Sign in, accounts enabled** ![Login enabled](docs/screenshots/login-accounts-enabled.png) |
| **Data upload** ![Upload](docs/screenshots/upload-empty.png) | **Column mapping** ![Mapping](docs/screenshots/upload-column-mapping.png) |
| **Home (after login)** ![Home](docs/screenshots/home.png) | **Home, mobile** ![Home mobile](docs/screenshots/home-mobile.png) |
| **Welcome (no data yet)** ![Welcome](docs/screenshots/welcome.png) | **Home with demo data loaded** ![Home with data](docs/screenshots/home-demo.png) |
| **History (past files)** ![History](docs/screenshots/history.png) | |
| **Dashboard (dark)** ![Dashboard dark](docs/screenshots/dashboard-dark.png) | **Dashboard (light)** ![Dashboard light](docs/screenshots/dashboard-light.png) |
| **Cash-flow forecast + scenario** ![Forecast](docs/screenshots/forecast.png) | **Risk intelligence** ![Risks](docs/screenshots/risks.png) |
| **Financing options** ![Financing](docs/screenshots/financing.png) | **Actions & audit (sandbox)** ![Actions](docs/screenshots/actions.png) |
| **AI Copilot** ![Copilot](docs/screenshots/copilot.png) | |

## History
Every file you analyse is listed under **History** (up to 10 files, 30 days) so you can reopen an earlier dataset without uploading it again. It is stored only in this browser's IndexedDB, never uploaded; turn it off or delete it in Settings/History. Sign-in is kept for the browser tab (sessionStorage) so a reload doesn't sign you out.

## Sign-in
The app opens on a sign-in / sign-up / password-reset page. **Continue as guest** works without any configuration. Real accounts need Supabase (see below); without it the form is disabled and says so.

## How it works
1. **Data in** — CSV/TSV/XLSX is parsed in the browser (own dependency-free parsers), columns auto-mapped, issues reported. Raw transactions are never uploaded. By default a copy of the loaded file is kept in this browser's IndexedDB for 24 hours so a reload doesn't lose it (switch off or clear in Settings).
2. **Deterministic engines** (`public/core/`) — metrics, 13-week forecast (80% range), health score, 11 risk detectors, financing match, scenarios, action impact. Shared by browser, API and tests.
3. **Evidence → AI** — the AI sees only a numbered list of aggregated facts (E1…En), names anonymized by default. Every number in its reply must appear in the evidence it cites, otherwise the reply is discarded and a rules-based narrative is shown.
4. **Approvals** — proposed → approved → run *in sandbox*. Each step is written to a SHA-256 hash-chained audit log (optionally mirrored to Supabase under Row-Level Security).

## Requirements
Node.js ≥ 20. No npm dependencies. (Browser smoke test additionally needs Python 3 + `pip install playwright` + a Chromium.)

## Commands
```bash
# 1. install (nothing to download, kept for convention)
npm install

# 2. configure (optional — the app works with no variables)
cp .env.example .env        # then edit; never commit .env

# 3. run locally  → http://localhost:3000
npm run dev

# 4. test
npm test                    # 62 unit/integration tests (node:test)
pip install playwright && python3 test/e2e/smoke.py   # browser smoke test (46 checks); or: npm run test:e2e

# regenerate the synthetic demo CSV
npm run sample
```
Open the app and click **Explore demo data** (synthetic business "Harbor & Pine Roasters") or upload your own file.

## Environment variables
| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | `anthropic` or `openai` (OpenAI-compatible) |
| `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL` | model id, **server-side** key, endpoint for OpenAI-compatible providers |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | optional sign-in and audit mirroring |
| `REQUIRE_AUTH` | `true` = `/api/analyze` needs a signed-in user (fails closed if Supabase unset) |

Without `AI_API_KEY` the app uses the rules-based summary/answers and says so in the UI.

## Optional database (Supabase)
Run `supabase/schema.sql` (same as `supabase/migrations/0001_audit_events.sql`) in the Supabase SQL editor. It creates `audit_events` with RLS: users can insert/select their own rows only; no update/delete.

## Enable "Continue with Google" (optional, needs Supabase)
1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** (Web application). Under *Authorized redirect URIs* add `https://<your-project-ref>.supabase.co/auth/v1/callback`. Copy the Client ID and Secret.
2. Supabase → Authentication → Providers → **Google** → enable, paste Client ID and Secret, save.
3. Supabase → Authentication → URL Configuration → set **Site URL** to your Vercel URL and add it (plus `http://localhost:3000` for local use) under *Redirect URLs*.
4. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Vercel and redeploy. The button on the sign-in page then works.
The client side is tested with mocked responses only; the Google/Supabase round trip needs your own project to verify.

## Deploy (Vercel)
1. Push this repo to GitHub.
2. In Vercel: **Add New → Project → import the repo**. Framework preset: *Other*. `vercel.json` already sets output directory `public/`, no build step, and security headers (CSP etc.).
3. Add the environment variables above (Project → Settings → Environment Variables), then redeploy.
4. Open the URL, load the demo, check `/api/config` returns JSON.
`api/*.js` become serverless functions automatically.

## Project layout
```
public/          static app (index.html, css/, js/ UI, core/ engines, assets/, samples/)
api/             serverless routes: analyze.js (AI proxy + grounding), config.js
server/dev.mjs   dependency-free local server (static + /api)
scripts/         synthetic demo-data generator
supabase/        schema + migration
test/            node:test suites + Playwright smoke test + fixtures
docs/            architecture, security self-assessment, competition notes, test report, demo script
```

## Docs
`docs/ARCHITECTURE.md` · `docs/SECURITY_SELF_ASSESSMENT.md` · `docs/COMPETITION_NOTES.md` · `docs/REFERENCE_PROJECT_NOTES.md` · `docs/TEST_REPORT.md` · `docs/SUBMISSION.md` · `docs/DEMO_SCRIPT.md`

## Known limitations
See `docs/TEST_REPORT.md` and `docs/SECURITY_SELF_ASSESSMENT.md`. Notably: financing products are illustrative archetypes; forecast quality depends on history length; rate limiting is in-memory (best effort on serverless); the live AI provider path is tested against mocks, not a real provider.

## License
MIT. Decision support only — not financial, legal or tax advice.
