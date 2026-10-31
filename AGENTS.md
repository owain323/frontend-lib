# agentcss — for coding agents

- **Contract (machine-readable):** `ai/components.json` — 40 components with root class, slots, variants, states, ARIA and file paths. Query it; never guess class names.
- **Known failure modes:** `ai/pitfalls.json`, or `npx agentcss ai pitfalls --json --component=<id>`.
- **Query:** `npx agentcss ai components --json [--maturity=stable]` · `ai tokens --json [--set=dark]` · `ai tree --json`.
- **Validate:** `npx agentcss ai validate <file> --schema=components --json`. Every subcommand accepts `--json`; failures print `{"ok":false,…}` and exit non-zero.
- **Markup ground truth:** each component's `demo.html`. Restyle through tokens (CSS variables); never rewrite component selectors.
- **Docs are Chinese:** `ai/START-HERE.md` (navigation). English entry points: `README.md`, `llms.txt`, `llms-full.txt`.
