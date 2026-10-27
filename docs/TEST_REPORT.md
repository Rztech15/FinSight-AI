# Test report
Run on 2026-10-18, Node v22.22.0, Chromium via Playwright (Python).

| Suite | Command | Result |
|---|---|---|
| Unit/integration (ingest, engines, product workflow, API, client modules) | `npm test` | **62 / 62 passed** |
| Browser smoke (real Chromium against the dev server) | `python3 test/e2e/smoke.py` | **46 / 46 passed** |
| Syntax check of every JS file | `node --check` | clean |

## What the browser test covers
Login page entry, post-login home (landing) page and its CTAs, welcome page, data surviving a reload and clearing, History list/open/delete, sign-in surviving a reload, guest access, sign-up/reset pages, mocked Supabase email and Google sign-in (no live Supabase/Google); empty state; demo load; KPI values; all 10 routes render; scenario comparison; approve → run in sandbox → measured results; audit log entries + chain verification; Copilot answer with citations; financing preview; light theme toggle; no horizontal scroll at 390 px; uploaded `<img onerror>`/`<script>` text stays inert; zero console errors. Screenshots: `docs/screenshots/`.

## Not verified
- Real AI provider calls (tests use mocked HTTP).
- Live Supabase auth and the audit mirror.
- Deployment on Vercel (config written, not deployed from here).
- Safari/Firefox, screen-reader testing, load testing, forecast accuracy on real-world data (only the synthetic demo and unit fixtures).
