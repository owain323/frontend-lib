# agentcss

Mobile-web components in plain CSS, with optional behaviour scripts. **Zero third-party runtime dependencies** — installing it adds nothing to your `node_modules` that ships to the browser.

[中文说明](README.zh-CN.md)

```bash
npm install agentcss
```

The npm package is `agentcss`; the repository is `frontend-lib`. They are different things: the package name is what you install, the repository name is where the source lives.

## Docs and live demos

- **Every demo page, one index** — https://owain323.github.io/frontend-lib/
- **Component documentation with search** — https://owain323.github.io/frontend-lib/guide/

Both are generated from `ai/components.json` and the per-component `README.md`
files, so a page cannot quietly go missing from the index when a component is
added. The docs pages resolve every link to a file that actually exists.

---

## What it solves

Three things that get rewritten in every mobile web project:

1. **Dark mode** normally costs a second set of colour values. Here one token set adapts, and a container can carry its own theme.
2. **Overlay behaviour** — close on Escape, return focus to the trigger, close on outside click — is written once as a shared core instead of copied per project.
3. **Accessibility** (focus rings, screen-reader labels, contrast) is easy to miss. Every component here is held to a written contract.

It is also **readable by machines**: `ai/components.json` carries a machine-parseable contract per component — class names, how state is expressed, which behaviours must not be skipped, how mature it is. A person can copy the CSS; a tool can read the contract instead of guessing.

## What it is not

- **Not a UI kit.** No calendar, no file upload, no all-in-one widget set. `date-range` is a light start/end picker, not a full date picker.
- **Not a build tool.** No bundler required. Copy files and it works.
- **Not a JS framework.** Interaction scripts are optional; a styles-only page loads no JavaScript at all.

## Use it selectively

This is an optional toolbox, not a spec every page must obey.

- Pick components by reading the actual implementation, the demo, and the stated use case — not by the component name or maturity field.
- When a component does not cover your case, use something else. Do not damage the task to fit the library.
- Adding it to an existing site: keep that site's existing framework and styles where they work, and fill only the gap you actually have.
- When the output is not a web page (slides, documents, email), the layout rules here do not apply.

**Discovery files for agents:** `llms.txt` (short, English, with the CLI commands), `llms-full.txt` (one page: every component plus its known failure modes), `AGENTS.md` (ten lines: contract, query, validate). `ai/START-HERE.md` is the longer navigation for tools (Chinese, like the component docs); `START-HERE.md` at the repository root is the three-step checklist for people.

---

## Install

```bash
npm install agentcss
```

The directory it installs as is `agentcss`, and `dist-tags.latest` points at the current version.

Two more paths that resolve to the same content:

```bash
# Pin an exact version and get a tarball byte-identical to the published one
npm install https://github.com/owain323/frontend-lib/releases/download/v0.11.3/agentcss-0.11.3.tgz

# Track master (unreleased commits)
npm install github:owain323/frontend-lib
```

---

## Usage

**1 · Bring in the styles** (with your bundler)

```js
import 'agentcss/tokens.css';
import 'agentcss/typography.css';
import 'agentcss/primitives/button/button.css';
```

**2 · For interactive components, load the behaviour script**

Behaviour scripts are IIFEs that attach to `window` (e.g. `window.Overlay`).

With a bundler:

```js
import 'agentcss/patterns/overlay/overlay.js';
```

With a `<script>` tag — note the path is the real directory inside the package:

```html
<!-- npm does not create a patterns/ directory; use 03-patterns/ -->
<script src="node_modules/agentcss/03-patterns/overlay/overlay.js"></script>
```

The directory layout inside the package matches the repository: `01-tokens` `02-primitives` `03-patterns` `04-recipes` `09-assets`. The line above is equivalent to `import 'agentcss/patterns/overlay/overlay.js'`.

**3 · Copy the files** (if you would rather not add a dependency)

Copy the matching files out of `dist/`. That tree has comments stripped but formatting kept, so a copied file does not arrive buried under prose. Read the source directory when you want the reasoning.

```
dist/01-tokens/tokens.css         <- copy this
01-tokens/tokens.css              <- source (with comments), for reading
```

- Do not copy the source directory unless you intend to read it: the majority of the bytes in the CSS source tree are comments.
- Copy JS from `dist/` too — that copy has comments stripped and is deliberately unminified.

### Smallest working page (plain HTML, no bundler)

Save this as `index.html` next to your `node_modules/` directory and open it directly:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Example</title>
<link rel="stylesheet" href="node_modules/agentcss/dist/01-tokens/tokens.css">
<link rel="stylesheet" href="node_modules/agentcss/dist/01-tokens/typography.css">
<link rel="stylesheet" href="node_modules/agentcss/dist/01-tokens/page.css">
<link rel="stylesheet" href="node_modules/agentcss/dist/02-primitives/card/card.css">
<link rel="stylesheet" href="node_modules/agentcss/dist/02-primitives/badge/badge.css">
<link rel="stylesheet" href="node_modules/agentcss/dist/02-primitives/button/button.css">
<link rel="stylesheet" href="node_modules/agentcss/dist/02-primitives/input/input.css">
</head>
<body class="page">
<main class="wrap">

  <h1>My orders</h1>
  <p class="lede">Last 30 days · 1 order</p>

  <div class="card card--interactive">
    <div class="card__body">
      <h3>Quarterly report</h3>
      <p class="small">Order 20261017001</p>
      <span class="badge badge--success">Filed</span>
    </div>
  </div>

  <div class="field">
    <label class="field__label" for="q">Order number</label>
    <input class="field__input" id="q" type="search" placeholder="Enter an order number" inputmode="numeric">
    <span class="field__hint">Last four digits are enough</span>
  </div>

  <button class="btn btn--md btn--primary">Export</button>

</main>
</body>
</html>
```

Three mistakes the template above already avoids:

| If you write it this way | What happens |
|---|---|
| `<input class="input">` | **`.input` does not exist.** No error, no warning — the field renders 21px tall |
| Content placed directly in `.card` | `.card` has `padding: 0`; text sits flush against the edge |
| Leaving out `page.css` | `.wrap` and `.lede` do nothing and the page width is unconstrained |

**Going to production:** copy all of `node_modules/agentcss/dist/` into a static directory (say `vendor/agentcss/`) and rewrite the seven `href` prefixes above. `node_modules` does not get deployed.

---

## Components

**40** components (stable 40 / beta 0). Each directory holds a `README.md` (why it is built this way) and a `demo.html` (markup you can copy).

### primitives (17)

| Component | Root class | Purpose |
|---|---|---|
| `badge` | `badge` | Status label: counts, categories, outcome markers |
| `button` | `btn` | Action trigger: primary / secondary / danger / text-only |
| `card` | `card` | Content container: media, body, actions |
| `choice` | `choice` | One control for radio, checkbox and native-select appearance |
| `combobox` | `combo` | Searchable input that can hold multiple tags |
| `date-range` | `drange` | Start/end date range with preset shortcuts |
| `delta` | `delta` | Change value: direction and sign, **describes direction only, never judges good or bad** |
| `input` | `field` | Text field plus its label, hint and error |
| `metric` | `metric` | Metric block: one label, one value, one line of context; missing data is a first-class state |
| `popover` | `popover` | Floating panel anchored to its trigger |
| `progress` | `progress` | Progress bar and ring |
| `select` | `select` | Custom dropdown (not the native element) |
| `separator` | `separator` | Divider, optionally with centred text |
| `skeleton` | `skeleton` | Loading placeholder |
| `switch` | `switch` | Toggle switch |
| `timeline` | `timeline` | Ordered event sequence: order is the information, so it is an `ol`; state belongs to `badge`, colour loses meaning here |
| `upload` | `upload` | File upload: zero-JS native form, plus an enhanced form with drop, multiple files and validation |

### patterns (14)

| Component | Root class | Purpose |
|---|---|---|
| `accordion` | `accordion` | Collapsible groups |
| `content` | `prose` | Long-form container: headings, paragraphs, lists, quotes, code |
| `drawer` | `drawer` | Side drawer with scrim |
| `dropdown` | `dd` | Dropdown menu |
| `form-validation` | `form` | Field-level feedback and an error summary |
| `list` | `list` | Key/value and item lists |
| `nav` | `nav` | Top navigation and in-page contents |
| `overlay` | `toast` | Toasts and modal scrims |
| `pagination` | `pagination` | Pagination control |
| `reveal` | `reveal` | Entrance motion: one `data-reveal` attribute, six directions, **works with zero JS** |
| `states` | `state` | Empty / loading / error / success blocks |
| `tabs` | `tabs` | Tab switching |
| `tooltip` | `tooltip` | Hover and focus hints |
| `tree` | `tree` | Expandable tree |

### recipes (5)

| Component | Root class | Purpose |
|---|---|---|
| `analysis-report` | `report` | Research report page: body and side rail side by side, collapsing to one column |
| `app-shell` | `shell` | App shell: sidebar, top bar, main area; sticky sidebar scrolls itself, folds away on narrow screens |
| `detail-page` | `detail-page` | Entity detail skeleton: complete / partly missing / no records, three states sharing one DOM structure |
| `report` | `rep` | Report layout system v1: shared base plus three layouts (magazine, scientific, financial research) |
| `table` | `table` | Data table: sort / loading / empty / error states, three presets (financial, academic, statistical) |

### assets (4)

| Component | Root class | Purpose |
|---|---|---|
| `bar` | `bar` | Bar chart: stacked and grouped semantics, out-of-range clipping, legend |
| `model-viewer` | `mv` | 3D model viewer, token-driven — ships without the rendering library itself |
| `scientific-plot` | `splot` | 2D scientific plotting: lines, bands, log axes, token-driven, zero dependencies |
| `sparkline` | `sparkline` | Inline trend shape, no axes — for a one-line trend inside a table cell |

---

## Bundle cost

Adopting a component costs three things: `tokens` (always required), the component CSS, and optionally component JS.

The token set is **2.6 KB gzip** as a minified build, and it is larger than any single component — so it *is* the real starting price for "just one button". The full per-component table is generated into [`dist/COSTS.md`](dist/COSTS.md) rather than repeated here, because a hand-written table drifts.

Two builds ship:

| | Comments | Minified | Use it for |
|---|---|---|---|
| `dist/` | stripped, formatting kept | no | copying, debugging |
| `dist/**/*.min.css` | stripped | yes | production |

The source tree keeps every comment — that is documentation, not payload.

**One frozen ceiling.** The whole library is held to a single budget recorded in
[`05-audit/budget.json`](05-audit/budget.json): a hard ceiling, a reserve that absorbs
normal additions *without anyone editing a number*, and a ratchet that tightens the
budget when the library shrinks. The rules — and what would have to be true to raise
the ceiling — are in [`docs/BUDGET.md`](docs/BUDGET.md).

**Stability.** Since `0.23.0` the public surface is frozen: token names, class names,
JS members, CLI subcommands and their `--json` shape, contract fields and file paths
do not disappear or change meaning. Removals go through the deprecation flow, with at
least one minor version of lead time. What that covers — and what it honestly does
not — is in [`docs/STABILITY.md`](docs/STABILITY.md).

---

## Browser support

[`SUPPORT.md`](SUPPORT.md) lists every engine with the evidence behind its status. Two conventions matter there:

- **Verified** means an automated check runs **in that engine** and the job reports its own user agent as proof.
- **Not claimed** means exactly that. A row that has not been tested is not written as supported.

## Theming

Themes are switched by a `data-theme` attribute on any container, not only on the root — a dark card can sit inside a light page.

```html
<div data-theme="dark">…</div>
```

Colour comes from tokens only. Component CSS never writes `@media (prefers-color-scheme: dark)`, because that expression can only answer "what does the operating system prefer", not "what theme is this region in".

## Machine-readable contract

`ai/components.json` describes each component for tools: usable class names, how state is expressed, required behaviours, maturity. `ai/pitfalls.json` carries the known failure modes, joined to components by id; `ai/pitfalls-writing.json` holds the ones that happen while writing prose, building demos and publishing pages — those have no component to join to, and keeping them apart is what stops them from showing up as component defects. `agentcss ai` (the `bin` entry) validates and queries both — every subcommand accepts `--json`.

## Accessibility

Every component carries a contract covering focus order, keyboard operation, ARIA state and contrast; the checks run in real browsers rather than only reading source text. Components that fail their own contract are marked `beta` rather than described as stable.

## Development

```bash
npm ci
npm run gate        # full gate run
npm run gate:fast   # fast layer
npm test            # unit and behaviour-core tests
npm run dist        # rebuild dist/
```

## License

MIT.
