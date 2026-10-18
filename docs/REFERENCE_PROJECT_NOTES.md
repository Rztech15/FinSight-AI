# Reference project notes

The author's earlier project *RZ Data Analytics AI Agent* (github.com/Rztech15/RZ-DATA-ANALYTICS-AI-AGENT) was named as a technical reference only.

- **Code copied from it: none.** FinSight AI is a separate codebase written from scratch.
- **Patterns adopted (ideas, not code):** browser-side file analysis; keeping API keys on the server behind a serverless function; a deterministic fallback when AI is unavailable.
- **Deliberately different:** no CDN scripts, no third-party spreadsheet library (own xlsx reader instead of SheetJS 0.18.x with known CVEs), strict CSP, grounding guard on AI output.
- The reference repository and StockFlow were not modified.
- The repository was not inspected line-by-line in this build session; if you later reuse anything from it, record the license and dependency review here.
