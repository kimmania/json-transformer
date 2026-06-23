# Web Transform Assistant

A browser-based UI for building and testing json-transformer mapping files visually. No build step and no npm install — open `index.html` directly in a browser.

## What it does

Load JSON source data, define a mapping in **Visual**, **JSON**, or **JS** mode, and see transformed output update in a live preview. Export mappings ready to use with the CLI in the parent project:

```bash
node ../cli.js transform -d your-data.json -m your-mapping.js
```

## Quick start

1. Open `index.html` directly in a browser — no server required.

2. **Load source data** — click **Load Data** and pick a `test-*.json` file from the `samples/` directory.

3. **Load a mapping** — click **Import** and pick the matching `mapping-*.json` or `mapping-*.js` file from `samples/`.

4. **Build a mapping** — Visual editor, **Wizard**, or edit **JSON** / **JS** directly.

5. **Export** — download `.json` or `.js`, copy mapping text, or export preview output.

## Features

### Visual mapping editor

| Capability | Visual mode |
|------------|-------------|
| Field map (`from` → target) | Yes |
| Template string (`{Salary} {Status}`) | Yes — set **Source** to **Template string** |
| Value map (`map` lookup table) | Yes — row editor + “from sample data” |
| Coalesce (fallback paths) | Yes — path picker |
| Date / number formats | Yes — presets on field rows |
| `forEach` arrays + nested fields | Yes |
| Nested objects | Yes |
| Compute (expression string) | Yes — templates + custom `return …` |
| Passthrough | Yes — global toggle |
| Empty string → null (`emptyStringAsNull`) | Yes — global toggle |
| Conditions (`if` / `and` / `or`) | View only — edit in JSON/JS |
| `groupBy`, `flatten`, aggregates, etc. | View only — edit in JSON/JS |
| Compute as arrow functions | JS mode only |

- **Validation** — missing targets, unknown source paths, empty nested mappings.
- **Undo / redo** — in visual mode.
- **Mapping-level toggles** — **Passthrough** (include unmapped source fields) and **Treat empty strings as null** (`emptyStringAsNull`) appear as checkboxes above the field list in Visual mode. Both are preserved when exporting or switching editor modes.

### Loading a field inspection report

When your source file is too large to load directly in the browser, you can generate a field inspection report with the CLI and load that instead:

```bash
node ../cli.js --inspect your-data.csv -o inspect.json
```

Then click **🔍 Load Inspection** and select the `inspect.json` file. This populates all field suggestions, the DataInspector summary, and value map helpers without loading any raw records. You can still build and export a complete mapping — the live preview will be blank until source data is also loaded.

### Source data panel

- Collapsible tree with type badges and inline previews.
- **Search** — filter tree; matching keys/values highlighted.
- **One record** / **All records** — browse a single row (mapping-friendly paths) or every record at the top level.
- **Go to record** — prev/next and numeric jump (array datasets).
- **Selection detail** — breadcrumb, copy dot-path, copy JSON fragment.
- **Inspector** — record count, field stats, sample values.

### Mapping modes

- **Visual** — table-style field rows (best for simple and nested mappings).
- **JSON** — declarative mapping; string `compute` expressions.
- **JS** — `export default { … }`; function-valued `compute` when needed.

Import picks the starting mode: simple mappings → Visual; rules with function compute or heavy advanced features → JS/JSON. Advanced rows imported from JS stay visible as read-only cards in Visual while simple rows remain editable.

### Live preview

- Debounced transform on mapping changes.
- First *N* records (configurable), with record prev/next.
- Optional **expected output** file for side-by-side diff.
- Inline errors on failed rows; click to jump records.
- Schema validation when the mapping defines `schema`.

### Code editor (JSON / JS)

- Syntax highlighting and **Format** button.
- Parse errors with line indication; light semantic warnings (e.g. unknown source paths).
- **Copy mapping** to clipboard.

### Wizard

Linear flow: passthrough → per-field decisions (skip / accept default / customize) → `forEach` and nested sub-steps → review with sample output → finish into Visual mode.

### Export and import

- **Export mapping** — `.json` or `.js` (`.js` when function compute is present).
- **Export output** — transformed JSON download.
- **Import mapping** — `.json` / `.js` from disk.
- **Copy** — mapping or output text.

### UI

- **3-pane layout** — source | mapping | preview; each column collapsible.
- **Resizable** — drag handles for source and preview column width (saved in `localStorage`).
- **Help** — in-app topics (formats, compute, conditions, JSON vs JS, etc.).
- **Theme** — light / dark, persisted.
- **Auto-save** — opt-in draft to `localStorage` (off by default).
- **Toasts** — success / warning / error feedback.

## Samples

All sample mappings and their matching test data live in the `samples/` directory. The canonical versions of these files live in `../examples/` — re-copy from there when examples change.

To try a sample, open `index.html` in a browser, then:

1. Click **Load Data** → navigate to `samples/` → select the data file.
2. Click **Import** → navigate to `samples/` → select the matching mapping file.

| Sample | Mapping file | Data file | Demonstrates |
|--------|-------------|-----------|--------------|
| Nested order (JSON) | `mapping-nested.json` | `test-nested.json` | `forEach` line items, nested shipping block, conditions |
| Nested order + compute (JS) | `mapping-nested.js` | `test-nested.json` | Same as above with a `line_total` compute function |
| CRM legacy → modern (JSON) | `mapping-crm-example.json` | `test-data.json` | Value maps, date formatting, simple conditions |
| CRM example (JS) | `mapping-crm-example.js` | `test-data.json` | JS variant of the CRM mapping with function compute |
| Employee conditions (JS) | `mapping-employee.js` | `test-employees.json` | Composite `and`/`or`/`not` conditions |
| Data cleaning (JS) | `mapping-data-cleaning.js` | `test-data-cleaning.json` | Passthrough, template strings, coalesce, compute |
| Data shaping (JS) | `mapping-shaping.js` | `test-shaping.json` | `groupBy`, `flatten`, aggregates |
| Schema validated (JS) | `mapping-validated.js` | `test-data.json` | Mapping with `schema` validation rules |
| Timesheet (JS) | `mapping-timesheet.js` | `test-data.json` | Timesheet aggregation and compute |

## Project layout

| File | Role |
|------|------|
| `index.html` | Entry point; loads scripts in order |
| `app.js` | Preact UI (tree, editor, wizard, preview, help) |
| `transform-browser.js` | Browser port of transform + `inspect()` |
| `mapping-features.js` | Visual ↔ mapping object, validation, export |
| `styles.css` | Layout and components |
| `preact.js`, `preact-hooks.js` | Inlined Preact 10.x |
| `samples/` | Mapping + test data files (canonical versions in `../examples/`) |

## Technical notes

- **Stack:** Preact 10.x + hooks (inlined), no bundler.
- **Transform engine:** `transform-browser.js` — same semantics as `../transform.js`, including sandboxed string `compute` (500ms timeout). Keep these two files in sync when changing core transformation logic.
- **Offline:** All assets local; no CDN.
- **Browsers:** Current Chrome, Firefox, Safari, Edge (desktop-first).
- **Size:** ~120KB+ uncompressed JS/CSS total; no npm dependencies.

## Development

No build step. Edit files and refresh the browser. Open `index.html` directly — no server required.
