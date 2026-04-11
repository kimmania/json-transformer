# Design: Cross-Row Computations

Analysis of complexity and nuances for adding cross-row computation support to the transformation engine.

## Background

The current engine is a pure per-row transform. `transform()` in `transform.js` is a single `Array.map` with no shared state between rows:

```js
export function transform(source, mapping, dictionaries = {}) {
  return source.map((row, i) => {
    return transformOne(row, mapping, dictionaries);
  });
}
```

Each `transformOne` call has no knowledge of other rows. The `compute` function signature (`...values, sourceRow, dictionaries`) has no dataset context. The following are therefore currently impossible: running totals, percentage of dataset total, ranking, distance from mean, previous/next row references.

---

## Categories of cross-row operations

These are not all the same difficulty. There are three distinct tiers.

### Tier 1 — Dataset-scalar, then per-row (medium complexity)

**Examples:** percentage of total, distance from mean, normalized score.

These work in two passes:
1. Scan the full source array once to compute a scalar (total, mean, max)
2. Use that scalar uniformly while transforming each row

The natural design is a `precompute` block at the mapping level:

```js
export default {
  precompute: {
    total_sales: { aggregate: "sum", from: "sales" },
    max_score:   { aggregate: "max", from: "score" },
    row_count:   { aggregate: "count" },
  },
  fields: {
    pct_of_total: {
      from: "sales",
      compute: (sales, row, dicts, ctx) => (sales / ctx.total_sales) * 100,
    },
    normalized: {
      from: "score",
      compute: (score, row, dicts, ctx) => score / ctx.max_score,
    },
  },
}
```

`precompute` reuses the existing `transformAggregate` logic already in the engine — it just runs over the full source array instead of a `forEach` sub-array. That's the same code path with a different input.

**What changes in the codebase:**
- `transform()` runs the `precompute` block first, then passes results as a `ctx` argument into each `transformOne` call
- `transformOne` accepts and forwards `ctx` down to `transformField`
- `transformField` passes `ctx` as a fourth argument to `compute` calls
- `compute` signature becomes `(...values, row, dicts, ctx)` — additive, backward-compatible since existing functions simply ignore the extra argument

This is the most tractable tier and could be implemented without disrupting anything else.

---

### Tier 2 — Ranking (medium-high complexity)

**Examples:** rank by sales descending, percentile rank.

Ranking looks simple but has real nuance. The rank is a function of each row's *position in the sorted dataset*, not a single scalar that applies uniformly. Each row gets a different value from the same precompute step.

One approach — precompute rank as a per-source-index lookup table during the first pass, then inject it:

```js
precompute: {
  sales_rank: { rankBy: "sales", order: "desc" },
  // internally builds: { 0: 3, 1: 1, 2: 2, ... }  (source index → rank value)
},
fields: {
  rank: {
    compute: (row, dicts, ctx) => ctx.sales_rank[ctx.rowIndex],
  },
}
```

`ctx.rowIndex` is the row's position in the source array. This only makes sense if the engine guarantees rows are processed in the same order they were received — a constraint it currently satisfies, but one that would need to be documented as a guarantee.

**Tie handling** requires an explicit choice:

| Mode | Example values | Behaviour |
|---|---|---|
| `standard` (default) | 1, 2, 2, 4 | Tied rows share the lower rank; next rank skips |
| `dense` | 1, 2, 2, 3 | Tied rows share the lower rank; next rank does not skip |
| `percent` | 0.0, 0.5, 0.5, 1.0 | Rank expressed as fraction of total rows |

These are distinct behaviors that would need to be an explicit option in the `rankBy` definition.

**What changes in the codebase:**
- New `rankBy` precompute resolver — no existing code to reuse
- Produces a `{ [sourceIndex]: rankValue }` map, not a scalar
- `ctx` must carry `rowIndex` alongside precomputed values

---

### Tier 3 — Previous/next row and window functions (high complexity)

**Previous/next row** is superficially simple — pass `source[i-1]` and `source[i+1]` into `transformOne` as part of `ctx`. The complications:

- **Ordering:** what does "previous" mean if the dataset isn't pre-sorted? Non-deterministic results unless the engine either requires pre-sorted input or adds a dataset-level `sortBy` (distinct from the `forEach`-level `sortBy` that already exists).
- **Filtering:** if rows are validated and some are skipped before transforming, does "previous" mean the previous source row or the previous *included* row? These produce different results.
- **API contract:** `transformOne` is a public export used programmatically. Exposing adjacent rows changes its contract in a way that affects callers who call it directly.

**Window functions** (moving average, rolling N-day sum) require *N* surrounding rows. This is a meaningful leap — essentially implementing SQL window semantics. Likely out of scope for this engine.

**What changes in the codebase:**
- `ctx` would carry `prevRow` and `nextRow` (raw source objects, pre-transform)
- Dataset-level `sortBy` would need to be added if ordering isn't guaranteed by the caller
- `transformOne`'s signature or contract changes

---

## The ordering dependency problem

Running totals and previous/next row references are **order-sensitive**. If the source data isn't pre-sorted, results are non-deterministic. Two options:

**Option A — Require pre-sorted input.** Document that cross-row operations assume the source array is in the intended order. Simple to implement, puts the burden on the caller.

**Option B — Dataset-level `sortBy` in the mapping.** Applied before `precompute` and `transform`, guarantees ordering:

```js
export default {
  sortBy: { field: "date", order: "asc" },
  precompute: { ... },
  fields: { ... },
}
```

Option B is cleaner for users but adds another mapping-level key and a sort step to the engine. For Tier 1 (dataset-scalar) it's irrelevant — percentages and means don't depend on order. For Tier 2 (ranking) it's essential. For Tier 3 (previous/next) it's often necessary.

---

## Tension with streaming

This is the sharpest architectural nuance: **two-pass operations are fundamentally incompatible with streaming.** Percentage-of-total, ranking, and any `precompute` aggregate require the full array in memory before row 0 can be transformed.

If streaming is added to the engine, cross-row features would need to be:
- Explicitly excluded from streaming mode (runtime error if both are used), or
- Supported via a two-phase streaming protocol (scan pass → transform pass), which largely defeats the memory benefit of streaming

These two future directions should be treated as **mutually exclusive for any operation that requires a full first-pass scan.** Streaming and Tier 1/2/3 cross-row operations cannot coexist without a deliberate architectural choice about which takes priority.

---

## Full summary of codebase changes by tier

| Area | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| `transform()` | Run `precompute` before `.map()`, pass `ctx` | Same + build rank lookup table | Same + pass `prevRow`/`nextRow` |
| `transformOne()` | Accept + forward `ctx` | Same + `ctx.rowIndex` | Same + `ctx.prevRow`, `ctx.nextRow` |
| `transformField()` | Pass `ctx` to `compute` | Same | Same |
| `compute` signature | `(...values, row, dicts, ctx)` | Same | Same |
| New precompute logic | Reuses `transformAggregate` over full array | New `rankBy` resolver | n/a |
| Running totals | New stateful scan (no existing code to reuse) | — | — |
| Dataset-level `sortBy` | Not needed | Needed for rank stability | Often needed |
| Streaming compatibility | Incompatible | Incompatible | Partially compatible (prev only) |

Tier 1 is implementable cleanly without disrupting existing behavior. Tiers 2 and 3 each introduce genuinely new architecture and should be scoped separately.
