# Interactive Wizard Implementation Plan
## Phase 4: mapping-builder.js Interactive CLI

### Context
The mapping-builder.js module already has:
- `inspect(data)` → field metadata (type, sample, distinct values, ranges)
- `buildMappingAuto(inspection)` → best-guess mapping
- `buildMapping(inspection, answers)` → custom mapping from field answers
- `exportJs()` / `exportJson()` → file writers
- CLI flags: `--inspect`, `--data`, `--auto`, `--output`, `--format`

The wizard is the missing piece: a guided interactive mode that asks the user questions field-by-field, suggests smart defaults from inspect(), and previews the mapping before writing it.

---

## 1. User Experience Flow

```
$ node mapping-builder.js --data test-data.json -o mapping.js

═════════════════════════════════════════════════════════════════════════════════════
Field 1 of 9: FullName
─────────────────────────────────────────────────────────────────────────────────────
  type:         string
  sample:       "Jane Doe"

  Target field name? [full_name] >
  Feature:
    [r] rename (simple from mapping) ← default
    [f] format
    [m] map (value substitution)
    [c] compute (custom function)
    [v] value (static literal)
    [i] if/then/else
    [d] default (fallback value)
    [_] skip this field
    [a] accept all remaining with defaults

  Choice [r] > f
  Format:
    [1] uppercase      [7] camelcase
    [2] lowercase      [8] snakecase
    [3] titlecase      [9] kebabcase
    [4] trim           [10] truncate
    [5] number         [11] replace
    [6] boolean        [12] split

  Choice [1] > 2
═════════════════════════════════════════════════════════════════════════════════────────

Field 2 of 9: FirstName ...
...

════════════════════════════════════════════════════════════════════════════════────────
PREVIEW (6 fields configured, 3 skipped)

{
  fields: {
    full_name: { from: "FullName", format: "lowercase" },
    ...
  }
}

[e] edit a field   [w] write to file   [q] quit without saving
Choice [w] > w
Wrote mapping to mapping.js
```

---

## 2. Architecture

### 2.1 Entry Point
When `--data <file>` is passed **without** `--auto`, enter `runWizard()` instead of failing:

```javascript
if (args.data && !args.auto) {
  const data = loadDataFile(args.data);
  const report = inspect(data);
  const mapping = await runWizard(report);     // NEW
  // ... same export logic as auto mode
}
```

### 2.2 Wizard State Machine

```
INIT → FIELD_LOOP → FIELD_QUESTIONS → CONFIRM → PREVIEW → EDIT|WRITE|QUIT
                    ↑__________________________↓
```

States:
1. **INIT** — compute defaults from `buildMappingAuto()`, set up cursor
2. **FIELD_LOOP** — iterate fields. For each field:
   - Show metadata (type, sample, distinct)
   - Show current default (from auto mode)
   - Ask: accept default, customize, or skip?
3. **FIELD_QUESTIONS** — if customizing, drill into feature-specific params
4. **CONFIRM** — after all fields, show summary stats
5. **PREVIEW** — render the mapping object
6. **EDIT / WRITE / QUIT** — final action

### 2.3 Data Structures

```javascript
// Wizard maintains this state:
const wizardState = {
  fields: [
    {
      sourceField: "FullName",
      targetField: "full_name",      // editable
      feature: "from",               // current choice
      params: {},                    // feature-specific params
      skipped: false,
      // metadata from inspect()
      type: "string",
      sample: "Jane Doe",
      distinctValues: [...],
    }
  ],
  cursor: 0,                         // current field index
  passthrough: undefined,            // mapping-level option
  schema: undefined,
  mappingId: undefined,
};
```

### 2.4 Question Functions (pure, testable)

Each question is a function that prints, reads stdin, validates, and returns the answer. These are async and can be unit-tested with mock stdin:

```javascript
async function askTargetField(sourceField, defaultTarget) { ... }
async function askFeatureChoice(meta) { ... }
async function askFormatParams() { ... }
async function askMapParams(distinctValues) { ... }   // pre-populate keys
async function askConditionParams() { ... }
async function askTemplateParams(sourceFields) { ... }
async function askPreviewAction() { ... }
```

### 2.5 Rendering

- No external dependencies — use plain `process.stdout.write` + `readline`
- Terminal width detection via `process.stdout.columns`
- Clear-screen: `process.stdout.write('\x1Bc')` or just redraw
- Keep it simple: no full-screen TUI, just sequential prompts

---

## 3. Field-by-Field Questions

### 3.1 Universal Questions (asked for every field)

| Question | Default | When Skipped |
|---|---|---|
Target field name? | snake_case(sourceField) | field not in mapping |
Action? | `[r] rename` (from auto-detected best guess) | skip entirely |

### 3.2 Feature-Specific Prompts

| Feature | Prompts | Defaults |
|---|---|---|
| **rename** (from) | none — just `from: sourceField` | — |
| **format** | Format type? → Extra params (date outputFormat, round precision, etc.) | Auto-detected from inspect |
| **map** | Show distinct values as map keys. Ask: target value for each? | Identity mapping |
| **compute** | Ask `from` fields (multi-select) → write function body string | — |
| **if** | Condition: field, op, value → then value → else value | — |
| **forEach** | Sub-wizard: recurse into array item fields | — |
| **template** | Template string with `{field}` tokens | — |
| **coalesce** | Select fallback field(s) | — |
| **value** | Literal value? | — |
| **default** | Default value if source is null/missing? | — |

### 3.3 Smart Defaults from inspect()

| inspect() clue | Suggested feature | Suggested params |
|---|---|---|
| type === "string", looksLikeDate(sample) | format | `{ format: "date", outputFormat: "YYYY-MM-DD" }` |
| type === "string", NUMERIC_STR_RE(sample) && includes(".") | format | `{ format: "number" }` |
| distinctValues.length <= 5 && type === "string" | map | identity map object pre-filled |
| type === "mixed" | from | (passthrough rename) |
| type === "array" | forEach | (sub-wizard) |
| field ends with "id", "_id", "ID" | from | (no format — IDs stay strings) |
| field contains "email" | format | `{ format: "lowercase" }` |

### 3.4 Navigation Shortcuts

At any field prompt, accept:
- `[b]` — go back to previous field
- `[s]` — skip this field
- `[a]` — accept all remaining fields with their current defaults (fast path)
- `[p]` — preview current mapping so far

---

## 4. Sub-Wizard: Nested Objects & forEach

### Nested object fields (dot-paths)
If inspect() found `customer.FullName`, present it as:

```
Field: customer.FullName
Target: customer.full_name
```

The dot path in the target automatically creates nested output.

### forEach arrays
When a field is `type: "array"`, the wizard has two modes:

**Mode A: Flatten/aggregate at parent level**
```
LineItems is an array of objects.
  [f] forEach — transform each item into output array
  [a] aggregate — reduce to single value (sum, count, etc.)
  [s] skip
```

**Mode B: Sub-wizard for forEach fields**
If user picks `forEach`, recursively launch the wizard on the *first item* of the array to build the sub-fields mapping. Show:

```
Configuring LineItems.forEach fields (3 sub-fields discovered):
  Field 1 of 3: ProductSKU
  ...
```

---

## 5. Preview & Final Actions

### Preview Screen
Show a compact rendering of the mapping (first 30 lines, then "..."). Print options:

```
[e] edit field #N     — jump back to that field
[w] write to file     — confirm output path and format
[t] test transform    — run transform on first 3 records, show output
[q] quit without save — exit with code 0
```

### Test Transform
If the user hits `[t]`, load `transform.js` and run `transform(data.slice(0, 3), mapping)` to show a live preview. This requires `transform.js` to be importable (it is).

---

## 6. Implementation Steps

### Step 6.1: Readline utilities
- `ask(question, defaultValue)` — prompt with default, read line
- `askChoice(question, choices[])` — numbered menu, validate input
- `askYesNo(question, default)` — y/n
- `askMultiline(question)` — read until blank line (for compute functions)

### Step 6.2: Wizard state + field loop
- `initWizardState(report)` — seed from `buildMappingAuto()`
- `runFieldLoop(state)` — main loop over fields
- `presentField(state, index)` — render one field's prompts

### Step 6.3: Feature drill-ins
- `promptForFormat(meta)` — show format menu, ask params
- `promptForMap(meta)` — show distinct values, build map object
- `promptForIf()` — condition builder
- `promptForTemplate(availableFields)` — template string builder
- `promptForForEach(meta, data)` — sub-wizard launcher

### Step 6.4: Preview / edit / write
- `previewMapping(state)` — render mapping JSON
- `editField(state)` — jump to field by number, re-run prompts
- `testTransform(state, data)` — run transform.js on sample

### Step 6.5: CLI integration
- Wire `runWizard()` into `main()` for `--data` without `--auto`
- Remove the "not yet implemented" error message

### Step 6.6: Tests
- Unit test each `ask*` function with mock readline
- Test wizard state transitions
- Test feature drill-ins with various metadata
- Integration: full wizard run with piped stdin

---

## 7. Edge Cases & Decisions

| Scenario | Decision |
|---|---|
| TTY not available (piped stdin) | Fall back to `--auto` behavior with a warning to stderr |
| Array field with empty sample | Show warning: "Array appears empty in sample. Cannot inspect sub-fields." Skip or leave forEach fields empty |
| User enters invalid target field name | Validate: no spaces, valid JS object key. Re-prompt |
| User wants to add a field not in source | Support in preview/edit mode: ask "Add computed field?" → template/compute |
| Ctrl+C / SIGINT | Clean exit, do not write partial file |
| Mapping ID | Ask at the end: "Mapping ID? [optional]" → sets `mapping.id` |
| Passthrough | Ask once at start: "Include all unmapped fields (passthrough)? [y/N]" |
| Schema | Defer to post-wizard editing — too complex for interactive |
| Compute functions | Ask for function body as a string, `new Function()` it? **NO** — require `.js` output. For `.json` output, disable compute option. Better: write the function as a string in the JS output and let the user edit it later. |
| Large data (100+ fields) | Add batch mode: "Review fields 1-10 of 150. [n] next batch, [a] accept all" |

---

## 8. Open Questions for User

1. **Compute function input**: Should the wizard allow writing inline JS functions, or should compute be wizard-unavailable (user edits the `.js` file afterward)?
2. **forEach depth**: Should the sub-wizard for arrays support multi-level nesting (array inside array), or cap at one level?
3. **Field ordering**: Should fields be presented in discovery order, alphabetically, or grouped by type?
4. **passthrough default**: Should the wizard default to `passthrough: false` (explicit mapping only) or ask at the start?

---

## 9. Success Criteria

- [ ] `node mapping-builder.js --data test-data.json -o mapping.js` launches interactive prompts
- [ ] Completing the wizard produces a valid mapping file
- [ ] The mapping can be immediately used: `node cli.js transform -d test-data.json -m mapping.js`
- [ ] User can skip fields, go back, and preview at any time
- [ ] forEach arrays launch a sub-wizard for their fields
- [ ] All wizard logic has unit tests with mock stdin
- [ ] Non-TTY environments fall back to `--auto` mode

---

*Plan version: 1.0*
*Target branch: transform-assistant*
*Depends on: Phase 3 (complete)*
