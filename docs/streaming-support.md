# Design: Streaming Support

Analysis of complexity and implementation approach for adding streaming support to the transformation engine.

## Background

The current engine loads entire files into memory before doing anything. The three blocking points are all in `cli.js`:

- `readFileSync` — reads the entire input file into memory before processing
- `JSON.parse(fullString)` — requires the complete string
- `JSON.stringify(results)` — buffers the entire output before writing

For large files this means peak memory usage is proportional to file size. Streaming would allow the engine to process records incrementally — reading, transforming, and writing one record at a time regardless of file size.

## The good news

`transformOne` in `transform.js` is already streaming-compatible. It processes exactly one row with no side effects and returns one row. The engine core does not need to change at all. Every bit of complexity is in the I/O layer.

## The JSON parsing problem

This is the main technical hurdle. Node's `JSON.parse` requires the full string. Streaming a JSON array like `[{...}, {...}, {...}]` incrementally means you need a parser that can consume chunks and emit complete objects as they're parsed — something Node doesn't provide natively.

Three options:

**Option A — Add a dependency** (`stream-json` is the standard choice). Clean, battle-tested, handles all edge cases including deeply nested objects and large string values. The project currently has zero dependencies, which this would break.

**Option B — Write a minimal streaming JSON parser.** Feasible but error-prone. You'd need to track brace/bracket depth, string escape state, and buffer incomplete chunks. Approximately 200–300 lines and still has edge cases around Unicode and large string values. Not worth it when a good library exists.

**Option C — Support NDJSON (newline-delimited JSON) as a streaming-friendly input format.** Each line is a complete JSON object. Parsing is trivial: `readline` (built-in) reads line by line, `JSON.parse` handles each line independently. Zero new dependencies, zero new parsing logic. The tradeoff: it's a different input format, not the `[{...}]` arrays the tool currently accepts.

CSV streaming is unambiguously easy — the line-delimited nature of CSV maps directly onto `readline`. No new parsing logic is needed at all.

The scope of the entire feature is largely determined by which option is chosen for JSON input. See the recommendation at the bottom.

## Output format

Streaming output has the same fork. Writing a JSON array incrementally requires:
- Writing `[\n` before the first record
- Writing `,\n` between records (but not after the last — you don't know which record is last until the stream ends)
- Writing `\n]` at the end

This is manageable bookkeeping. NDJSON output is simpler: write `JSON.stringify(record) + "\n"` per record with no bookkeeping.

The clean resolution: keep default output as JSON arrays for non-streaming mode, use NDJSON for streaming mode and document this explicitly. Alternatively, add a `--ndjson` output flag independent of `--stream` so users can opt into NDJSON output regardless of streaming.

## Validation behaviour changes

Currently `validate()` runs on the full array before any transformation, collecting every error across all rows in one pass. In streaming mode you can't do that — rows are validated one at a time as they arrive.

The private `validateRow()` function already exists in `transform.js` and handles exactly per-row validation. In streaming mode it would be called per record with errors emitted to stderr as they're encountered, rather than collected first.

This is a meaningful user-facing change: the experience shifts from "here are all 47 errors across your dataset before any output is written" to "errors appear interleaved with output as the stream processes." For data quality workflows that rely on seeing the full error picture before deciding whether to proceed, this matters and should be documented clearly.

## What changes and where

`transform.js: transform()`, `transformOne()`, and `transformField()` are all **unchanged**. The programmatic API requires no modification. A new companion export can be added alongside the existing functions without touching anything:

```js
// New export — does not affect existing callers
export async function* transformEach(source, mapping, dictionaries = {}) {
  const dicts = mapping.dictionaries || dictionaries;
  let i = 0;
  for await (const row of source) {
    try {
      yield transformOne(row, mapping, dicts);
    } catch (e) {
      throw new Error(`row ${i}: ${e.message}`, { cause: e });
    }
    i++;
  }
}
```

`source` here is any async iterable — a readline interface, a Node Transform stream, or any other producer. The engine remains indifferent to streaming; it just receives one record at a time.

The full change surface:

| Location | Current behaviour | Streaming change |
|---|---|---|
| `cli.js` data loading | `readFileSync` + `JSON.parse` whole file | `readline` + per-line parse (NDJSON/CSV) or streaming JSON parser (JSON arrays) |
| `cli.js` output | `JSON.stringify(allResults)` at the end | Write each record as it's transformed; handle `[`,`,`,`]` bookkeeping or use NDJSON |
| `cli.js` validation | `validate(fullArray)` before transform | `validateRow(record)` per record during stream |
| `transform.js: transform()` | `source.map(...)` | Unchanged |
| `transform.js: transformOne()` | Unchanged | Unchanged |
| `transform.js: transformField()` | Unchanged | Unchanged |
| `transform.js` (new) | — | `transformEach()` async generator export |

## Cross-row incompatibility

As detailed in [cross-row-computations.md](cross-row-computations.md), any `precompute` block requires a full first-pass scan of the dataset before row 0 can be transformed. This is fundamentally incompatible with streaming.

A mapping with a `precompute` block used with `--stream` should fail fast with a clear error rather than silently falling back to buffered mode. Silent fallback would confuse users and defeat the purpose of the flag.

## Complexity by part

| Part | Complexity | Notes |
|---|---|---|
| CSV streaming | Low | `readline` is built-in; existing per-row logic reusable |
| NDJSON input streaming | Low | `readline` + `JSON.parse` per line; zero new dependencies |
| JSON array input streaming | High | Needs a streaming JSON parser — dependency or significant new code |
| NDJSON output | Low | `JSON.stringify(record) + "\n"` per record |
| JSON array output | Low–medium | Bookkeeping for `[`, `,`, `]` delimiters |
| Per-row validation in stream | Low | `validateRow` already exists in `transform.js` |
| `transformEach` generator in `transform.js` | Low | `transformOne` already does the work |
| Incompatibility guard for `precompute` | Low | Fail fast with a clear error |

## Recommendation

The entire scope is determined by one decision: **require NDJSON for streaming input, or support streaming regular JSON arrays?**

Starting with NDJSON-only streaming is the right first step:
- Zero new dependencies
- Small, clean, self-contained change
- NDJSON is a well-understood format in data pipeline contexts
- Regular JSON array support can be added later via `stream-json` if there's demand

A `--stream` flag in the CLI that requires NDJSON or CSV input, writes NDJSON output, and errors clearly on JSON array input and `precompute` mappings would be a complete and useful first implementation.
