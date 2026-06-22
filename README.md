# json-transformer

A lightweight, **declarative JSON transformation engine** inspired by XSLT. Define mapping rules as plain JavaScript objects stored in reusable `.js` files, then pass them to a tiny `transform()` function.

## Why?

Sometimes you need to morph API responses, migrate data between schemas, or normalize external feeds — and a heavy ETL tool is overkill. `json-transformer` gives you a **stylesheet-like mapping definition** that is:

- **Readable** — each target field describes exactly where it comes from
- **Reusable** — export mappings as modules, share them, compose them
- **Extensible** — drop in a `compute()` function when built-in ops aren't enough

## Install

```bash
# No dependencies — just copy the files
git clone https://github.com/kimmania/json-transformer.git
cd json-transformer
```

## Security note

`.js` mapping files are loaded via dynamic `import()` and can contain arbitrary
JavaScript code (including `compute()` functions). Only run mapping files from
trusted sources. For untrusted mappings, use the `.json` format, which accepts
only declarative rules.

## Table of contents

- [Why?](#why)
- [Install](#install)
- [Quick start](#quick-start)
- [Examples](#examples)
- [Mapping definition](#mapping-definition)
  - [Schema validation](#schema-validation-schema)
  - [Passthrough](#passthrough)
  - [Field definition options](#field-definition-options)
  - [Dot-paths](#dot-paths-nested-source-and-target)
  - [Nested sub-mappings](#nested-sub-mappings-fields-blocks)
  - [Array iteration (`forEach`)](#array-iteration-foreach)
  - [Aggregation](#aggregation-aggregate)
  - [Template strings](#template-strings-template)
  - [Coalesce](#coalesce-coalesce)
  - [Dictionaries](#dictionaries)
  - [Conditions](#conditions-if--then--else)
- [API](#api)
- [CLI](#cli)
  - [Sampling a CSV (or JSON) file](#sampling-a-csv-or-json-file)
  - [CSV input](#csv-input)
- [Mapping builder (`mapping-builder.js`)](#mapping-builder-mapping-builderjs)
  - [Inspect your data](#inspect-your-data)
  - [Auto-generate a mapping](#auto-generate-a-mapping)
  - [Programmatic API](#programmatic-api)
- [Mapping Builder UI (`helper/`)](#mapping-builder-ui-helper)
- [File structure](#file-structure)
- [Limitations](#limitations)
- [Future ideas](#future-ideas)

## Quick start

```javascript
import { transform } from "./transform.js";

const records = [
  { FirstName: "Alice", LastName: "Smith", StatusCode: "A", Score: "92" },
];

const mapping = {
  fields: {
    full_name: { from: ["FirstName", "LastName"], compute: (f, l) => `${f} ${l}` },
    status:    { from: "StatusCode", map: { "A": "active", "I": "inactive" } },
    score:     { from: "Score", format: "number" },
  },
};

const output = transform(records, mapping);
// → [{ full_name: "Alice Smith", status: "active", score: 92 }]
```

Mappings are plain objects — export them as `.js` modules to reuse across projects:

```javascript
import { transform } from "./transform.js";
import myMapping from "./my-mapping.js";

const output = transform(inputArray, myMapping);
```

## Examples

Working example files are included for every major feature. Each pair below links a **data file** to its **mapping file** and shows the command to run it. Expected outputs are checked into `examples/expected/` and exercised by `transform.test.js`.

| Data | Mapping | Expected | What it demonstrates |
|---|---|---|---|
| `test-data.json` | `mapping-crm-example.js` | `expected-crm.json` | Simple rename, date formatting, value mapping, `if`/`then`/`else`, `compute` |
| `test-nested.json` | `mapping-nested.js` | `expected-nested.js.json` | Nested objects, `forEach` arrays, `compute` inside `forEach`, dot-paths |
| `test-nested.json` | `mapping-nested.json` | `expected-nested.json` | Same nested transform as above, but as a pure JSON mapping (no `compute`) |
| `test-order-summary.json` | `mapping-order-summary.js` | `expected-order-summary.json` | `aggregate` (`sum`, `count`, `min`, `max`, `avg`), `filter`, `sortBy` |
| `test-shaping.json` | `mapping-shaping.js` | `expected-shaping.json` | `flatten`, `groupBy`, `distinct`, nested `forEach` |
| `test-data-cleaning.json` | `mapping-data-cleaning.js` | `expected-data-cleaning.json` | `passthrough`, `template`, `coalesce`, casing, `round`, `split`, `join`, `truncate`, `replace` |
| `test-timesheet.json` | `mapping-timesheet.js` | `expected-timesheet.json` | Dictionary lookups: `$file: "./dictionaries/employees.json"` (5 records, keyed by `employee_id`), `$file: "./dictionaries/departments.json"` (5 records, keyed by `code`), inline `statusMap`, multi-hop `compute()` for manager name, date formatting |
| `test-employees.csv` | `mapping-employee.js` | `expected-employee.json` | CSV input, composite `and`/`or`/`not` conditions |
| `test-invalid.json` | `mapping-validated.js` | `expected-validated.json` | Schema validation — transforms data and reports validation errors to stderr |

Run any example:

```bash
node cli.js transform -d examples/test-data.json -m examples/mapping-crm-example.js
```

Compare to the checked-in expected output:

```bash
diff <(node cli.js transform -d examples/test-data.json -m examples/mapping-crm-example.js) examples/expected/expected-crm.json
```

Run all example tests:

```bash
node --test transform.test.js
```

## Mapping definition

Every mapping is a plain JS object with a `fields` dictionary:

```javascript
export default {
  id: "my-migration",   // optional — human-readable label, not used by the engine
  fields: {
    targetFieldName: { /* fieldDef */ },
  },
};
```

### Schema validation (`schema`)

Add a `schema` block to validate source data before transforming. Every row is checked against the schema and all errors are collected — processing continues so you get a complete picture of data quality issues in one pass.

```javascript
export default {
  id: "employee-import",
  schema: {
    EmployeeID: { required: true, type: "string" },
    Name:       { required: true, type: "string", minLength: 2 },
    Age:        { required: true, type: "number", min: 16, max: 120 },
    Email:      { required: true, pattern: "^[^@]+@[^@]+\\.[^@]+$" },
    Salary:     { type: "number", min: 0 },
    Department: {
      validate: (v) =>
        ["Engineering", "Marketing", "Sales", "HR"].includes(v) ||
        `"${v}" is not a recognised department`,
    },
  },
  fields: { ... },
};
```

#### Validation rules

| Rule | Type | Description |
|---|---|---|
| `required` | boolean | Field must be present and non-null |
| `type` | string | Expected type: `"string"`, `"number"`, `"boolean"`, `"array"`, `"object"`, `"date"` (strict ISO-8601) |
| `min` / `max` | number | Numeric value range |
| `minLength` / `maxLength` | number | String or array length range |
| `pattern` | string | Regex the string value must match |
| `validate` | function | Custom rule — return `true` to pass, or an error message string |

Schema fields support dot-paths: `"address.city": { required: true }`.

#### Reading errors

Validation and transformation are separate steps. Call `validate()` first, then decide whether to proceed:

```javascript
import { validate, transform } from "./transform.js";

const { valid, errors } = validate(source, mapping);

if (errors.length > 0) {
  console.error("Fix these before importing:");
  for (const e of errors) {
    console.error(`  row ${e.row}, field "${e.field}": ${e.message}`);
  }
}

if (valid) {
  const data = transform(source, mapping);
  saveToDatabase(data);
}
```

Each error object has the shape `{ row: number, field: string, message: string }`. `valid` is `true` when `errors` is empty.

When using the CLI, `validate()` runs automatically if the mapping has a `schema` and any errors are printed to stderr before the transformed output is written.

### Passthrough

Set `passthrough: true` to copy all source fields to the output before applying `fields`. This is useful when you only want to transform or add a few fields without listing every field you want to keep.

Fields defined in `fields` always override passthrough values.

#### Exclude specific fields (`exclude`)

Copy everything except a blocklist of fields:

```javascript
export default {
  id: "enrich-product",
  passthrough: { exclude: ["internal_id", "raw_cost"] },
  fields: {
    display_name: { template: "{brand} {model}", format: "titlecase" },
    price:        { from: "price", format: "round", precision: 2 },
  },
};
```

#### Copy only specific fields (`include`)

Copy only the listed source fields and nothing else:

```javascript
export default {
  id: "public-profile",
  passthrough: { include: ["first_name", "last_name", "email"] },
  fields: {
    // Override or add fields on top of the allowlisted baseline
    email: { from: "email", format: "lowercase" },
  },
};
```

`include` and `exclude` are mutually exclusive — when `include` is set it takes precedence.

### Field definition options

| Feature | Property | Example |
|---|---|---|
| **Rename** | `from` | `{ from: "OldName" }` |
| **Value map** | `map` | `{ from: "Code", map: { "A": "active", "I": "inactive" } }` |
| **Format date** | `format`, `outputFormat` | `{ from: "Date", format: "date", outputFormat: "YYYY-MM-DD" }` |
| **Format** | `format` | `{ from: "Name", format: "uppercase" }` — see format reference below |
| **If / then** | `if`, `then`, `else` | See condition reference below |
| **Compute** | `from`, `compute` | `{ from: ["First","Last"], compute: (f, l, row, dicts) => f + " " + l }` |
| **Template** | `template` | `{ template: "{first} {last}", format: "titlecase" }` |
| **Coalesce** | `coalesce` | `{ coalesce: ["Mobile", "WorkPhone"], default: "N/A" }` |
| **Literal** | `value` | `{ value: "constant" }` |
| **Default** | `default` | `{ from: "Region", default: "Unknown" }` |
| **Aggregate** | `forEach`, `aggregate`, `from`, `compute` | See aggregation reference below |
| **Dictionary lookup** | `lookup`, `lookupPath`, `lookupKey` | See dictionary reference below |

#### Format reference

| Value | Description | Extra property |
|---|---|---|
| `uppercase`, `lowercase` | Case conversion | — |
| `titlecase` | Capitalise the first letter of each word | — |
| `trim` | Strip leading/trailing whitespace | — |
| `number`, `string`, `boolean` | Type coercion | — |
| `negate` | Boolean inversion (`!value`) | — |
| `date` | Parse and reformat a date string | `outputFormat` (default `"YYYY-MM-DD"`) |
| `round` | Round to N decimal places | `precision` (default `0`) |
| `split` | Split a string into an array | `separator` (default `","`) |
| `join` | Join an array into a string | `separator` (default `", "`) |
| `truncate` | Trim a string to a max length, appending a suffix if cut | `length` (default `50`), `suffix` (default `"..."`) |
| `replace` | Regex or literal substitution | `find` (pattern), `replaceWith` (default `""`), `flags` (default `"g"`) |
| `camelcase` | Convert to camelCase | — |
| `snakecase` | Convert to snake_case | — |
| `kebabcase` | Convert to kebab-case | — |

#### `compute` signature

The `compute` function receives the resolved `from` values as positional arguments, followed by the full source row and the loaded dictionaries:

```javascript
full_name: {
  from: ["FirstName", "LastName"],
  compute: (first, last, sourceRow, dicts) => `${first} ${last}`,
}
```

`from` can also be a single string when only one value is needed.

### Dot-paths (nested source and target)

Source fields support dot-notation to traverse nested objects and arrays:

```javascript
fields: {
  city:     { from: "address.city" },
  zip:      { from: "address.zip", format: "uppercase" },
  tag:      { from: "tags.0.name" },  // array index access
}
```

Target keys with dots automatically build nested output:

```javascript
fields: {
  "contact.email": { from: "EmailAddr", format: "lowercase" },
  "contact.phone": { from: "WorkPhone" },
}
// → { contact: { email: "...", phone: "..." } }
```

### Nested sub-mappings (`fields` blocks)

Instead of individual dot-path keys, you can nest `fields` blocks to define a sub-mapping. This is especially useful when multiple transforms and conditions apply at the same level:

```javascript
fields: {
  full_name: { from: "FullName" },
  contact: {
    fields: {
      email:  { from: "EmailAddr", format: "lowercase" },
      phone:  { from: "WorkPhone" },
      address: {
        fields: {
          city:  { from: "addr.city", format: "uppercase" },
          state: { from: "addr.state" },
        },
      },
    },
  },
}
```

### Array iteration (`forEach`)

Use `forEach` to transform an array of nested objects:

```javascript
fields: {
  items: {
    forEach: "LineItems",          // source array field name
    fields: {
      product:    { from: "ProductSKU" },
      quantity:   { from: "Qty", format: "number" },
      line_total: {
        from: ["Price", "Qty"],
        compute: (price, qty) => parseFloat(price) * qty,
      },
    },
  },
}
```

#### Flattening nested arrays (`flatten`)

Add `flatten` with a dot-path to extract a sub-array from each element of the `forEach` source and concatenate them all into a single flat list before any further processing. This is useful when your source contains an array of arrays.

```javascript
// Flatten orders → items into one list covering all orders
all_line_items: {
  forEach: "orders",
  flatten: "items",
  fields: {
    sku:      { from: "sku" },
    category: { from: "category" },
    qty:      { from: "qty",   format: "number" },
    price:    { from: "price", format: "round", precision: 2 },
  },
},

// Flatten + filter — only bulk items across all orders
bulk_items: {
  forEach: "orders",
  flatten: "items",
  filter:  { field: "qty", op: "gt", value: 1 },
  fields:  { sku: { from: "sku" }, qty: { from: "qty" } },
},

// Flatten + aggregate — total line items across all orders
total_line_items: {
  forEach:   "orders",
  flatten:   "items",
  aggregate: "count",
},
```

`flatten` uses dot-path notation and runs before `filter`, `distinct`, `sortBy`, and `groupBy`.

#### Grouping items (`groupBy`)

Add `groupBy` to partition the array into an object keyed by a field value instead of mapping it to a new array. Each key holds an array of matching items; `fields` transforms each item within its group:

```javascript
// Group orders by their status field
orders_by_status: {
  forEach: "orders",
  groupBy: "status",
  fields: {
    order_id:   { from: "order_id" },
    item_count: { forEach: "items", aggregate: "count" },
  },
},
// → { "shipped": [...], "pending": [...] }

// Omit fields to keep raw source objects inside each group
orders_raw_by_status: {
  forEach: "orders",
  groupBy: "status",
},
```

`groupBy` composes naturally with `flatten` and `filter`:

```javascript
// Flatten orders → items, then group the combined list by category
items_by_category: {
  forEach:  "orders",
  flatten:  "items",
  groupBy:  "category",
  fields: {
    sku:   { from: "sku" },
    qty:   { from: "qty", format: "number" },
    price: { from: "price", format: "round", precision: 2 },
  },
},

// Filter first, then group
bulk_items_by_category: {
  forEach:  "orders",
  flatten:  "items",
  filter:   { field: "qty", op: "gt", value: 1 },
  groupBy:  "category",
  fields:   { sku: { from: "sku" }, qty: { from: "qty" } },
},
```

#### Deduplicating items (`distinct`)

Add `distinct` to keep only the first occurrence of each unique value of a source field, dropping later duplicates. The pipeline order is **filter → distinct → sortBy → transform**:

```javascript
// One entry per unique SKU — later duplicate lines are dropped
unique_skus: {
  forEach:  "items",
  distinct: "sku",
  fields: {
    sku:  { from: "sku" },
    name: { from: "name" },
  },
},

// Compose with filter and sortBy
premium_skus: {
  forEach:  "items",
  filter:   { field: "unit_price", op: "gt", value: 10 },
  distinct: "sku",
  sortBy:   "sku",
  fields: {
    sku:        { from: "sku" },
    unit_price: { from: "unit_price", format: "round", precision: 2 },
  },
},

// Aggregate on the deduplicated set — count of unique SKUs, not total lines
unique_sku_count: {
  forEach:   "items",
  distinct:  "sku",
  aggregate: "count",
},
```

`distinct` supports dot-paths and works with `aggregate` as well as `fields`.

#### Filtering items (`filter`)

Add a `filter` condition to skip items that don't match before transforming or aggregating. Uses the same condition syntax as `if`:

```javascript
// Only transform line items that are in stock
in_stock_items: {
  forEach: "LineItems",
  filter: { field: "in_stock", op: "truthy" },
  fields: {
    sku:      { from: "sku" },
    quantity: { from: "qty", format: "number" },
  },
},

// Sum only discounted items
discount_total: {
  forEach: "LineItems",
  filter: { field: "discount_pct", op: "gt", value: 0 },
  aggregate: "sum",
  from: ["qty", "unit_price", "discount_pct"],
  compute: (qty, price, pct) => qty * price * (pct / 100),
},
```

#### Sorting items (`sortBy`)

Sort the source array before transforming. Accepts a field name (ascending) or a `{ field, order }` object:

```javascript
// Ascending (default)
items_asc:  { forEach: "LineItems", sortBy: "unit_price",                        fields: { ... } },

// Descending
items_desc: { forEach: "LineItems", sortBy: { field: "unit_price", order: "desc" }, fields: { ... } },
```

`sortBy` uses dot-path notation and applies before any `filter`.

The `forEach` value supports dot-notation to reach a nested array:

```javascript
items: {
  forEach: "order.LineItems",   // equivalent to source.order.LineItems
  fields: { ... },
}
```

When the source array is `null` or missing, the output is `[]`.

### Aggregation (`aggregate`)

Use `aggregate` alongside `forEach` to reduce an array to a single value instead of mapping it to a new array. The five supported operations are `sum`, `count`, `min`, `max`, and `avg`.

#### Simple aggregation (raw field)

```javascript
fields: {
  item_count:         { forEach: "items", aggregate: "count" },
  total_qty:          { forEach: "items", aggregate: "sum", from: "qty" },
  highest_unit_price: { forEach: "items", aggregate: "max", from: "unit_price" },
  lowest_unit_price:  { forEach: "items", aggregate: "min", from: "unit_price" },
  avg_qty_per_line:   { forEach: "items", aggregate: "avg", from: "qty" },
}
```

`count` does not require `from`. All other operations coerce the resolved value to a number; `NaN` entries are ignored.

#### Aggregation with `compute`

Supply a `compute` function to derive a per-item value before aggregating. The function receives the resolved `from` values, the full item object, and the loaded dictionaries — the same signature as a regular compute field.

```javascript
// subtotal = Σ (qty × unit_price)
subtotal: {
  forEach: "items",
  aggregate: "sum",
  from: ["qty", "unit_price"],
  compute: (qty, price) => qty * price,
},

// total after discount = Σ (qty × unit_price × (1 − discount_pct / 100))
total_after_discount: {
  forEach: "items",
  aggregate: "sum",
  from: ["qty", "unit_price", "discount_pct"],
  compute: (qty, price, discountPct) => qty * price * (1 - discountPct / 100),
},

// highest individual line total
highest_line_total: {
  forEach: "items",
  aggregate: "max",
  from: ["qty", "unit_price"],
  compute: (qty, price) => qty * price,
},
```

`format` and `default` work as normal — `default` applies when the source array is missing or empty, `format` is applied to the final aggregated value.

### Template strings (`template`)

Build a string from multiple source fields using `{dot.path}` tokens. The result passes through `format` like any other field:

```javascript
fields: {
  full_name:   { template: "{first_name} {last_name}", format: "titlecase" },
  address:     { template: "{street}, {city}, {state} {zip}" },
  label:       { template: "Order #{order_id} for {customer.name}" },
}
```

Tokens resolve dot-paths from the source row. Missing or null values are replaced with an empty string.

### Coalesce (`coalesce`)

Return the first non-null value from a list of source fields. `default` and `format` apply to the result:

```javascript
fields: {
  // Try mobile first, then work, then home; fall back to "N/A"
  phone: {
    coalesce: ["mobile", "work_phone", "home_phone"],
    default: "N/A",
  },

  // Normalise whichever name field is populated
  display_name: {
    coalesce: ["preferred_name", "legal_name", "username"],
    format: "titlecase",
  },
}
```

### Dictionaries

Dictionaries let you enrich transform output with external reference data — status code maps, employee records, department tables, etc. — without embedding that data inside the source records.

Define a `dictionaries` block at the top level of your mapping. Dictionaries are available to all fields via `lookup`, and to `compute` functions via the `dicts` argument.

#### Inline dictionary

```javascript
export default {
  id: "my-mapping",
  dictionaries: {
    statusMap: {
      "A": "Approved",
      "P": "Pending",
      "L": "Late",
    },
  },
  fields: {
    status: { from: "status_code", lookup: "statusMap" },
  },
};
```

#### External dictionary (`$file` + `indexBy`)

Load a JSON file and index it by a key field so lookups are O(1):

```javascript
dictionaries: {
  employees: {
    $file: "./dictionaries/employees.json",  // path relative to mapping file
    indexBy: "employee_id",                  // field to index on
  },
},
```

`$file` dictionaries require the async `prepareMapping()` call before transforming (see [API](#api)).

#### Using a dictionary in a field

| Property | Description | Example |
|---|---|---|
| `lookup` | Name of the dictionary to look up from | `lookup: "statusMap"` |
| `lookupPath` | Dot-path to extract from the matched dictionary entry | `lookupPath: "full_name"` |
| `lookupKey` | Use a different source field as the lookup key (default: `from`) | `lookupKey: "dept_id"` |

```javascript
fields: {
  // Simple map: "A" → "Approved"
  entry_status: { from: "status", lookup: "statusMap" },

  // Lookup with lookupPath: employee_id → employee record → full_name
  employee_name: { from: "employee_id", lookup: "employees", lookupPath: "full_name" },

  // Lookup with default when the key is missing
  dept_code: {
    from: "employee_id",
    lookup: "employees",
    lookupPath: "dept_code",
    default: "UNASSIGNED",
    format: "uppercase",
  },
}
```

#### Multi-hop lookups via `compute`

`compute` receives the loaded dictionaries as its last argument, which makes chained lookups straightforward:

```javascript
department: {
  from: ["employee_id"],
  compute: (empId, row, dicts) => {
    const emp = dicts.employees?.[empId];
    if (!emp) return "Unknown";
    return dicts.departments?.[emp.dept_code]?.name ?? emp.dept_code;
  },
},
```

### Default value fallback

Use `default` to provide a fallback when the source field is missing or `null`. The default then flows through the rest of the pipeline (map, format):

```javascript
fields: {
  // source missing → uses default
  region:   { from: "Region", default: "Unknown" },

  // source null → uses default
  title:    { from: "Title", default: "Untitled" },

  // default flows through the format pipeline
  country:  { from: "Country", default: "us", format: "uppercase" },
}
```

Falsy defaults like `0`, `false`, or `""` are preserved — `default` only kicks in when the source is `undefined` or `null`.

### Conditions (`if` / `then` / `else`)

Fields can be computed conditionally. `then` and `else` accept a scalar value or a nested field definition that is resolved at runtime:

```javascript
// Scalar result
status_label: {
  if:   { field: "StatusCode", op: "eq", value: "A" },
  then: "Active",
  else: "Inactive",
}

// Field definition result — resolves the named field when the condition passes
contact_info: {
  if:   { field: "HasPhone", op: "truthy" },
  then: { from: "PhoneNumber", format: "trim" },
  else: { from: "EmailAddr",  format: "lowercase" },
}
```

#### Condition operators

| Op | Meaning |
|---|---|
| `eq`, `neq` | Equal / not equal (loose) |
| `gt`, `gte`, `lt`, `lte` | Numeric comparison |
| `in`, `not-in` | Value in / not in array |
| `exists` | `value: true` — field is present and non-null; `value: false` — absent or null |
| `matches` | Regex match against string |
| `truthy`, `falsy` | Boolean coercion |

All condition fields support dot-paths: `{ field: "address.city", op: "exists", value: true }`.

#### `elseIf` chains

Add an `elseIf` array to check additional conditions when the initial `if` fails. The first matching clause wins; `else` is the final fallback:

```javascript
grade: {
  if:     { field: "score", op: "gte", value: 90 },
  then:   "A",
  elseIf: [
    { if: { field: "score", op: "gte", value: 80 }, then: "B" },
    { if: { field: "score", op: "gte", value: 70 }, then: "C" },
    { if: { field: "score", op: "gte", value: 60 }, then: "D" },
  ],
  else: "F",
}
```

`then`/`else` in `elseIf` clauses support field definitions just like the top-level `then`/`else`. `thenMap` applies only when the top-level `if` passes; `elseMap` applies only when no condition matched and `else` is used.

#### `thenMap` / `elseMap`

Map the `then`/`else` result through a value map in the same step:

```javascript
status_class: {
  if:      { field: "IsActive", op: "truthy" },
  then:    "active",
  else:    "inactive",
  thenMap: { "active": "badge-green" },
  elseMap: { "inactive": "badge-grey" },
}
```

#### Composite conditions (`and` / `or` / `not`)

Conditions can be composed and nested as deeply as needed.

**All must match (`and`)**

```javascript
bonus_eligible: {
  if: {
    and: [
      { field: "Status",        op: "eq",  value: "active" },
      { field: "YearsEmployed", op: "gt",  value: 1 },
      { field: "Salary",        op: "gte", value: 50000 },
    ],
  },
  then: true,
  else: false,
}
```

**Any can match (`or`)**

```javascript
remote_ok: {
  if: {
    or: [
      { field: "Department", op: "eq",      value: "Engineering" },
      { field: "Department", op: "eq",      value: "Management" },
      { field: "Title",      op: "matches", value: "(?i)(director|vp|chief)" },
    ],
  },
  then: true,
  else: false,
}
```

**Invert a condition (`not`)**

```javascript
needs_review: {
  if:   { not: { field: "Status", op: "eq", value: "active" } },
  then: true,
  else: false,
}
```

**Deeply nested**

```javascript
// Senior IC if (Engineering OR Data) AND (senior OR staff OR principal) AND NOT contractor
senior_ic: {
  if: {
    and: [
      { or: [
          { field: "Department", op: "eq", value: "Engineering" },
          { field: "Department", op: "eq", value: "Data" },
      ]},
      { or: [
          { field: "Level", op: "eq", value: "senior" },
          { field: "Level", op: "eq", value: "staff" },
          { field: "Level", op: "eq", value: "principal" },
      ]},
      { field: "EmployeeType", op: "neq", value: "contractor" },
    ],
  },
  then: true,
  else: false,
}
```

## API

```typescript
// Prepare a mapping before transforming (required for $file dictionaries)
async function prepareMapping(mapping: Mapping, baseDir?: string): Promise<Mapping>

// Synchronous alternative — throws if any dictionary uses $file
function prepareMappingSync(mapping: Mapping, baseDir?: string): Mapping

// Validate source data against a mapping's schema — no transformation performed
function validate(source: Array<Object>, mapping: Mapping): {
  valid:  boolean;
  errors: Array<{ row: number; field: string; message: string }>;
}

// Transform an array of source objects — schema is not checked, call validate() first if needed
function transform(source: Array<Object>, mapping: Mapping, dictionaries?: Record<string, Object>): Array<Object>

// Transform a single source object
function transformOne(sourceRow: Object, mapping: Mapping, dictionaries?: Record<string, Object>): Object
```

When using `$file` dictionaries, call `prepareMapping` first:

```javascript
import { prepareMapping, transform } from "./transform.js";
import mapping from "./mapping-timesheet.js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = dirname(fileURLToPath(import.meta.url));
const ready = await prepareMapping(mapping, baseDir);
const result = transform(sourceData, ready);
```

You can also pass dictionaries directly as a third argument to `transform` / `transformOne` — useful when you load dictionaries yourself or want to override them at call time.

## CLI

A zero-dependency CLI tool ships with the engine. Run transforms directly from the command line:

```bash
# Transform and print to stdout (pipe-friendly)
node cli.js transform -d data.json -m mapping.js

# Transform a CSV file (header row becomes field names)
node cli.js transform -d data.csv -m mapping.js

# Merge multiple input files before transforming (JSON and CSV can be mixed)
node cli.js transform -d jan.json -d feb.json -d mar.json -m mapping.js
node cli.js transform -d legacy.json -d new-export.csv -m mapping.js

# Transform with JSON mapping (no compute functions needed)
node cli.js transform -d data.json -m mapping.json

# Write output to a file
node cli.js transform -d data.json -m mapping.js -o output.json

# Compact (minified) output
node cli.js transform -d data.json -m mapping.js --compact
```

Mapping formats:
- **`.js`** — full mapping with `compute()` functions (ES modules, `export default`)
- **`.json`** — pure declarative mapping, serializable and shareable (no `compute()`)

### Sampling a CSV (or JSON) file

Use `--sample` to extract the first N rows of any data file as a JSON array. This is useful for quickly inspecting raw CSV content or generating a small test fixture before you write a mapping.

```bash
# Print the first 5 rows of a CSV as JSON
node cli.js --sample data.csv

# Write the sample to a file
node cli.js --sample data.csv -o sample.json

# Change the row count
node cli.js --sample data.csv --head 10 -o sample.json

# Works on JSON arrays too
node cli.js --sample data.json --head 2
```

The `--head` option defaults to `5`. All CSV values are strings (same as in transform mode) — `--sample` does not apply any mapping or formatting.

### CSV input

The CLI accepts `.csv` files as input. The first row is treated as the header and becomes the field names for each record. Quoted fields, embedded commas, and embedded newlines are all handled correctly.

**Line ending normalization:** inside quoted fields, `\r\n` (CRLF) and lone `\r` (CR) are normalized to a single `\n` (LF). This ensures consistent behavior regardless of how the CSV was generated.

**Important:** all CSV values arrive as strings — use `format: "number"` (or `format: "boolean"`) in your field definitions to coerce them when needed:

```javascript
salary: { from: "Salary", format: "number" },
active: { from: "IsActive", format: "boolean" },
```

Empty cells (`,,`) become empty strings `""` rather than `null` or `undefined`. This means an `exists` condition will return `true` for an empty cell — use `{ field: "Phone", op: "truthy" }` instead if you want to treat blank cells as absent.

> **Production recommendation:** the built-in CSV parser is lightweight and loads the entire file into memory. For very large files (hundreds of MB or more) or complex CSV edge cases (e.g. custom delimiters, multi-character escape sequences, or strict RFC 4180 conformance requirements), use a dedicated streaming parser such as [`csv-parse`](https://csv.js.org/parse/) or [`papaparse`](https://www.papaparse.com/) and pipe the parsed records into `transform()` programmatically rather than via the CLI.

## Mapping builder (`mapping-builder.js`)

A companion tool that inspects source JSON and auto-generates mapping files. Use it to bootstrap a mapping from sample data instead of writing one by hand.

### Inspect your data

Discover the shape of any JSON file — fields, types, distinct values, ranges:

```bash
node mapping-builder.js --inspect examples/test-data.json
```

Output:
```
Records analyzed: 3
Fields discovered: 9

─ FullName ─────────────────────────────────────────────────
  type:         string
  sample:       "Jane Doe"
  distinct:     3 unique values
  values:       "Jane Doe", "John Smith", "Bob Jones"

─ TotalSpend ───────────────────────────────────────────────
  type:         number
  sample:       12500
  range:        0 → 12500
```

For a machine-readable report, add `-o report.json`.

### Auto-generate a mapping

Generate a best-guess mapping from a data file:

```bash
node mapping-builder.js --data examples/test-data.json -o mapping.js
```

Rules applied automatically:
- Field names are converted to `snake_case`
- ISO-8601 date strings → `format: "date"`
- Decimal numeric strings → `format: "number"`
- Arrays of objects → `forEach` blocks
- Everything else → simple `from: "sourceField"` rename

Verify the generated mapping works:

```bash
node cli.js transform -d examples/test-data.json -m mapping.js
```

Export as `.json` instead of `.js` (serializable, no `compute`):

```bash
node mapping-builder.js --data examples/test-data.json --format json -o mapping.json
```

### Programmatic API

Import the builder in your own scripts to build mappings dynamically:

```javascript
import { inspect, buildMappingAuto, exportJs } from "./mapping-builder.js";
import { readFileSync } from "node:fs";

// 1. Inspect your data
const data = JSON.parse(readFileSync("source.json", "utf-8"));
const report = inspect(data);
console.log(report.fields);   // metadata about every field

// 2. Auto-generate a mapping
const mapping = buildMappingAuto(report);

// 3. Write it to disk
exportJs(mapping, "generated-mapping.js");
```

Or build a mapping manually from field answers:

```javascript
import { buildMapping } from "./mapping-builder.js";

const mapping = buildMapping(report, [
  { sourceField: "FullName", targetField: "full_name", feature: "from" },
  { sourceField: "StatusCode", targetField: "status", feature: "map", params: { mapObject: { A: "active", I: "inactive" } } },
  { sourceField: "EmailAddr", targetField: "email", feature: "format", params: { format: "lowercase" } },
  { sourceField: "CreatedDate", targetField: "created_at", feature: "format", params: { format: "date", outputFormat: "YYYY-MM-DD" } },
]);
```

Supported features in `buildMapping()`: `from`, `rename`, `format`, `map`, `compute`, `if`, `forEach`, `aggregate`, `flatten`, `groupBy`, `distinct`, `filter`, `sortBy`, `template`, `coalesce`, `lookup`, `value`, `default`, `passthrough`, `schema`.

## Mapping Builder UI (`helper/`)

A standalone browser-based UI for building and testing mapping files visually — no build step or npm install required. Open `helper/index.html` directly in any modern browser.

See **[helper/README.md](helper/README.md)** for full documentation, including the feature list, keyboard shortcuts, and how to load sample data.

### Keeping `transform-browser.js` in sync

The UI uses `helper/transform-browser.js` — a browser port of the engine that exports via `window.JsonTransformer` instead of ES module exports, and replaces Node.js `fs`/`path` APIs with browser-safe equivalents. It also sandboxes `compute` functions (string-based, 500 ms timeout) since `eval`/`new Function` runs in the browser context.

**Any change to the core transformation logic in `transform.js` must be mirrored in `helper/transform-browser.js`**, and vice versa. The two files share the same algorithm — divergence causes mappings that work in the CLI to behave differently in the UI, or vice versa.

Key differences to maintain parity for:
- `formatDate` / `isValidIsoDate` — date normalization and formatting
- `transformField`, `transformOne`, `transformAggregate` — core mapping logic
- `evaluateCondition` — condition operators (`eq`, `in`, `matches`, etc.)
- `prepareMapping` — dictionary loading (browser version is inline-only; `$file` is not supported in the UI)

## File structure

```
json-transformer/
├── transform.js               # Core engine (import this)
├── cli.js                     # CLI tool
├── transform.test.js          # End-to-end tests: runs every example mapping against expected output
├── mapping-builder.js         # Mapping generator: inspect data and build mappings
├── mapping-builder.test.js    # Unit tests for mapping-builder.js (run with `node --test`)
├── csv-parser.test.js         # Unit tests for the CSV parser
├── demo.js                    # In-Node demo
├── demo-composite.js          # Composite condition demo
├── examples/                  # Sample mappings, test data, and expected outputs
│   ├── mapping-crm-example.js     # Example: CRM migration (JS)
│   ├── mapping-crm-example.json   # Same mapping, pure JSON (no compute)
│   ├── mapping-employee.js        # Example: composite conditions
│   ├── mapping-nested.js          # Example: nested objects & forEach
│   ├── mapping-nested.json        # Same mapping, pure JSON (no compute)
│   ├── mapping-order-summary.js   # Example: aggregation, filter, sortBy
│   ├── mapping-shaping.js         # Example: flatten and groupBy (with filter, distinct, aggregate)
│   ├── mapping-validated.js       # Example: schema validation (all rule types)
│   ├── mapping-data-cleaning.js   # Example: passthrough, template, coalesce, round, split, join, truncate, replace, casing
│   ├── mapping-timesheet.js       # Example: dictionary lookups (inline + $file)
│   ├── test-data.json             # Sample flat data
│   ├── test-nested.json           # Sample nested data
│   ├── test-order-summary.json    # Sample order data (for aggregation/filter/sort demo)
│   ├── test-shaping.json          # Sample store/order/item data (for shaping demo)
│   ├── test-data-cleaning.json    # Sample contact data (for data-cleaning demo)
│   ├── test-timesheet.json        # Sample timesheet data (for dictionary demo)
│   ├── test-employees.csv         # Sample employee data in CSV format (for CSV input demo)
│   ├── test-invalid.json          # Sample data with intentional errors (for validation demo)
│   ├── dictionaries/
│   │   ├── employees.json         # Employee reference data (indexed by employee_id)
│   │   └── departments.json       # Department reference data (indexed by code)
│   └── expected/                  # Checked-in expected output for every example mapping
│       ├── expected-crm.json
│       ├── expected-nested.js.json
│       ├── expected-nested.json
│       ├── expected-order-summary.json
│       ├── expected-shaping.json
│       ├── expected-data-cleaning.json
│       ├── expected-timesheet.json
│       ├── expected-employee.json
│       └── expected-validated.json
├── helper/                    # Browser-based mapping builder UI (open index.html directly)
│   ├── index.html             # Entry point — open in browser, no server required
│   ├── transform-browser.js   # Browser port of transform.js — keep in sync with transform.js
│   ├── app.js                 # Preact UI application
│   ├── mapping-features.js    # Visual mapping feature definitions and validation
│   ├── sample-mappings.js     # Bundled sample mapping catalog
│   ├── styles.css             # Layout and component styles
│   ├── preact.js              # Inlined Preact 10.x (no CDN)
│   ├── preact-hooks.js        # Inlined Preact hooks (no CDN)
│   ├── samples/               # Sample mapping and data files for the UI
│   └── README.md              # Full UI documentation
├── docs/                      # Design analyses and RFCs
│   ├── cross-row-computations.md
│   └── streaming-support.md
├── PLAN.md                    # Implementation plan for the interactive wizard
├── AGENTS.md                  # Contributor guide / AI assistant context
└── README.md
```

## Limitations

- Value maps are **exact-match only** (no regex keys)
- `compute` functions must be plain JavaScript (not JSON-serializable — use `.js` mappings)
- Cross-row computations not supported — each row transforms independently with no knowledge of other rows. This means the following are not possible: running totals, each row's value as a percentage of the dataset total, ranking rows by a field, or referencing the previous/next row's value

## Future ideas

**Data shaping**

**Mapping-level**
- Mapping composition — a formal `extends` key that lets one mapping inherit from another, with child fields overriding base fields on conflict. The primary value over plain JS `import` + spread (which already works today for `.js` mappings) is supporting composition in `.json` mappings via file-path references, and making inheritance chains engine-visible so they can be validated and documented. Key design questions: what gets merged beyond `fields` (schema? dictionaries? passthrough?), how circular references are detected, and whether multiple inheritance via a `mixins` array is in scope.
- Cross-row computations — running totals, percentage of dataset total, ranking rows by a field, previous/next row references. See [docs/cross-row-computations.md](docs/cross-row-computations.md) for a detailed design analysis.

**CLI / engine**
- Streaming support — process large files line by line rather than loading the full array into memory. See [docs/streaming-support.md](docs/streaming-support.md) for a detailed design analysis.
- Join / zip two input files — combine two separately-shaped datasets by a shared key field, similar to a SQL join. Unlike the existing dictionary feature (which treats one file as a lookup table), a join would treat both files as equal-rank datasets. Key design questions: join type (inner / left / outer), field namespacing when both sides share a field name, and whether many-to-many expansion is in scope.

**Tooling**
- TypeScript declarations
