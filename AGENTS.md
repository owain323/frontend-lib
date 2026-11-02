# agentcss — for coding agents

- **Contract (machine-readable):** `ai/components.json` — 40 components with root class, slots, variants, states, ARIA, file paths, and **`printPolicy`** (what happens to this component on paper: `omit` / `expand` / `reveal` / `keep-together` / `allow-break`, plus a `pagination` flag). Query it; never guess class names — and never assume a component prints as it looks on screen.
- **Known failure modes:** `ai/pitfalls.json`, or `npx agentcss ai pitfalls --json --component=<id>`.
- **Print / PDF:** `npx agentcss ai pdf <page.html> --out page.pdf [--paper=a4|letter|a5] [--margin="18mm 15mm"] [--max-pages=N]`. `@page` belongs to the exporter, never to the library. To hold a document to paper standards use `ai check <doc.json> --medium=paper` — it then requires `pageBudget` and refuses `pagination:"server"` components.
- **Query:** `npx agentcss ai components --json [--maturity=stable]` · `ai tokens --json [--set=dark]` · `ai tree --json`.
- **Validate:** `npx agentcss ai validate <file> --schema=components --json`. Every subcommand accepts `--json`; failures print `{"ok":false,…}` and exit non-zero.
- **Markup ground truth:** each component's `demo.html`. Restyle through tokens (CSS variables); never rewrite component selectors.
- **Docs are Chinese:** `ai/START-HERE.md` (navigation). English entry points: `README.md`, `llms.txt`, `llms-full.txt`.
