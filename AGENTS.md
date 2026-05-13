# AGENTS.md — json-transformer

> This file helps AI coding assistants (and human contributors) work effectively with the codebase. It assumes you have read the README.md.

## Project Identity

- **Repo name**: `json-transformer` (GitHub: `kimmania/json-transformer`)
- **Engine name**: `json-xslt` — the declarative transformation engine inside the repo
- **Runtime**: Node.js 18+, ESM only (`"type": "module"` implied by `.js` extensions), zero npm dependencies
- **Philosophy**: Every feature must work without adding external packages. Use built-in Node.js APIs only.

## Architecture

| File | Role |
|---|---|
| `transform.js` | **Core engine**. Exports `transform()`, `transformOne()`, `validate()`, `prepareMapping()`, `prepareMappingSync()`. ~800 LoC. Pure functions, no I/O. |
| `cli.js` | **CLI entrypoint**. Parses args, loads data (JSON/CSV), loads mapping (`.js`/`.json`), runs transform, writes output. ~300 LoC. |
| `mapping-builder.js` | **Mapping generator**. Exports `inspect()`, `buildMapping()`, `buildMappingAuto()`, `runWizard()`, `exportJs()`, `exportJson()`. ~1200 LoC. Contains the interactive readline wizard. |
| `mapping-builder.test.js` | **Unit tests** for the builder. Run with `node --test mapping-builder.test.js`. |

Everything else is example mappings (`mapping-*.js`), test data (`test-*.json`), or demo scripts (`demo*.js`).

## Quick Commands

```bash
# Run tests
node --test mapping-builder.test.js transform.test.js

# Transform data
node cli.js transform -d test-data.json -m mapping-crm-example.js

# Inspect data
node cli.js --inspect test-data.json

# Build mapping (interactive wizard)
node mapping-builder.js --data test-data.json -o my-mapping.js

# Build mapping (auto)
node mapping-builder.js --data test-data.json --auto -o my-mapping.js
```

## Code Conventions

### Style
- Single quotes for strings in source code; double quotes acceptable in JSON/examples.
- 2-space indentation.
- `camelCase` for variables/functions, `PascalCase` for exported classes (none yet), `snake_case` for mapping field names.
- Prefer early returns over deep nesting.
- Use `// ── Section name ──` comment banners to group related functions (~40 dashes).

### ESM
- All `.js` files use `import`/`export`. No `require`/`module.exports`.
- When dynamic-loading a user-provided `.js` mapping file, use `pathToFileURL()`:
  ```js
  const mod = await import(pathToFileURL(resolvedPath).href);
  ```

### Error Handling
- CLI uses `die(msg)` to print to stderr and exit(1).
- Core engine throws descriptive errors for invalid mappings (e.g. `"Invalid format: 'bogus'"`).
- Validation collects *all* errors per row rather than stopping at the first.

### Numbers & Dates
- `looksLikeDate()` accepts ISO-8601 strings (`2025-01-15`, `2025-01-15T08:30:00Z`, `+05:30` offsets).
- Numeric string heuristic (`NUMERIC_STR_RE`) requires a decimal point to suggest `format: "number"`. This prevents zip codes and IDs from being auto-typed as numbers.

## Testing

- Test runner: Node.js built-in (`node --test`). No jest/mocha/vitest.
- Two test files:
  - `mapping-builder.test.js` (~500 LoC) — unit tests for the builder
  - `transform.test.js` — end-to-end tests for the engine + CLI
- Tests cover: `inspect()`, string transforms, `buildMapping()` DSL features, `buildMappingAuto()`, `validateForFormat()`, integration with real sample data, and every example mapping producing exact expected output.
- **Rule**: any change to `mapping-builder.js` or `transform.js` must keep tests passing. If you add a new DSL feature, add a `buildMapping()` test case for it.
- `transform.test.js` runs all 9 example mappings against their checked-in `expected/` outputs to catch regressions in the engine or CLI.

## How to Add a Feature

### To the transformation engine (`transform.js`)
1. Locate the relevant section (formatting, aggregation, condition evaluation, etc.).
2. Implement the logic. Keep it synchronous and pure.
3. Add a corresponding field-definition option in `buildFieldEntry()` inside `mapping-builder.js` so the builder can emit it.
4. Document in README.md in the correct reference table.
5. If it's a wizard-friendly feature, add a prompt in `mapping-builder.js` `promptFeature()` switch.

### To the mapping builder (`mapping-builder.js`)
1. If adding a new `feature` type:
   - Add it to `buildFieldEntry()` with its DSL shape.
   - Add it to `promptFeature()` choices and switch case.
   - Write a `prompt<Feature>Params()` async helper.
   - Add a test in `mapping-builder.test.js` under "buildMapping(): DSL features".
2. If modifying auto-detection heuristics:
   - Update `inferFieldDefaults()`.
   - Update the corresponding integration test expectation.
   - Update README "Rules applied automatically" list.

### To the CLI (`cli.js`)
1. Add the flag to `parseArgs()`.
2. Add a line to `printHelp()`.
3. Wire it in `main()`. Keep I/O separate from logic — CLI should delegate to functions in `transform.js` or `mapping-builder.js`.

## Key Design Decisions

- **Zero dependencies**: Do not add `npm install` steps. If a feature needs a library, either implement it inline or reject the feature.
- **`.js` mappings for compute, `.json` for portability**: `validateForFormat()` enforces that `.json` outputs contain no functions. `exportJson()` strips them; `exportJs()` writes `export default ...` with functions intact.
- **No streaming yet**: The engine loads the entire dataset into memory. Large files require future streaming work (see `docs/streaming-support.md`).
- **Wizard uses readline, not TUI libraries**: `createInterface()` from `node:readline` is the only interaction primitive. Keeps the dependency tree empty.
- **Non-TTY fallback**: Any `--data` path without `--auto` that detects `!process.stdin.isTTY` automatically switches to `buildMappingAuto()` and prints a warning.
- **Passthrough must be explicitly asked**: The wizard asks "Include all unmapped fields (passthrough)? [y/N]" at startup. Default is false.

## File Tree (minimal)

```
json-transformer/
├── transform.js               # Core engine (import this)
├── cli.js                     # CLI entrypoint
├── mapping-builder.js         # Inspection + auto + interactive wizard
├── mapping-builder.test.js    # Unit tests (builder)
├── transform.test.js          # End-to-end tests (engine + all examples)
├── README.md                  # User-facing documentation
├── AGENTS.md                  # This file
├── expected/                  # Checked-in expected outputs for e2e tests
│   ├── expected-crm.json
│   ├── expected-nested.js.json
│   ├── expected-nested.json
│   ├── expected-order-summary.json
│   ├── expected-shaping.json
│   ├── expected-data-cleaning.json
│   ├── expected-timesheet.json
│   ├── expected-employee.json
│   └── expected-validated.json
├── docs/                      # Design analyses (not code)
│   ├── cross-row-computations.md
│   └── streaming-support.md
├── mapping-*.js               # Example mappings
├── test-*.json                # Sample data for examples/tests
└── dictionaries/              # Reference data for $file lookups
```

## Gotchas

- `mapping-builder.js` imports `node:readline` at the top of the wizard section. It is only used when `runWizard()` is called; the inspection/auto parts work fine without a TTY.
- `cli.js` already imports `inspect` and `formatInspectReport` from `mapping-builder.js` for the `--inspect` flag.
- `buildMapping()` does **not** validate that source fields exist in the inspection report. It trusts the answers. If you want strictness, add it intentionally.
- The `test` folder does not exist. Tests live in `mapping-builder.test.js` at repo root.
- When running the wizard in a subagent/cron context, stdin will not be a TTY — the wizard will auto-degrade to `--auto` mode.

## Questions?

Check `README.md` for usage examples, `docs/` for design RFCs, and the test file for expected behavior.
