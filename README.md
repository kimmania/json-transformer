# json-xslt

A lightweight, **declarative JSON transformation engine** inspired by XSLT. Define mapping rules as plain JavaScript objects stored in reusable `.js` files, then pass them to a tiny `transform()` function.

## Why?

Sometimes you need to morph API responses, migrate data between schemas, or normalize external feeds — and a heavy ETL tool is overkill. `json-xslt` gives you a **stylesheet-like mapping definition** that is:

- **Readable** — each target field describes exactly where it comes from
- **Reusable** — export mappings as modules, share them, compose them
- **Extensible** — drop in a `compute()` function when built-in ops aren't enough

## Install

```bash
# No dependencies — just copy the files
git clone <this-repo>
cd json-xslt
```

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

### Passthrough

Set `passthrough: true` to copy all source fields to the output before applying `fields`. This is useful when you only want to transform or add a few fields without listing every field you want to keep.

Fields defined in `fields` always override passthrough values. To exclude specific source fields, use `passthrough: { exclude: [...] }`:

```javascript
export default {
  id: "enrich-product",
  passthrough: { exclude: ["internal_id", "raw_cost"] },  // copy all except these
  fields: {
    // These override the passthrough values with cleaned versions
    display_name: { template: "{brand} {model}", format: "titlecase" },
    price:        { from: "price", format: "round", precision: 2 },
  },
};
```

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

// Transform an array of source objects
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

## File structure

```
json-xslt/
├── transform.js               # Core engine (import this)
├── cli.js                     # CLI tool
├── mapping-crm-example.js     # Example: CRM migration (JS)
├── mapping-crm-example.json   # Same mapping, pure JSON (no compute)
├── mapping-employee.js        # Example: composite conditions
├── mapping-nested.js          # Example: nested objects & forEach
├── mapping-order-summary.js   # Example: aggregation, filter, sortBy
├── mapping-data-cleaning.js   # Example: passthrough, template, coalesce, round, split, join
├── mapping-timesheet.js       # Example: dictionary lookups (inline + $file)
├── demo.js                    # In-Node demo
├── demo-composite.js          # Composite condition demo
├── test-data.json             # Sample flat data
├── test-nested.json           # Sample nested data
├── test-order-summary.json    # Sample order data (for aggregation/filter/sort demo)
├── test-data-cleaning.json    # Sample contact data (for data-cleaning demo)
├── test-timesheet.json        # Sample timesheet data (for dictionary demo)
├── dictionaries/
│   ├── employees.json         # Employee reference data (indexed by employee_id)
│   └── departments.json       # Department reference data (indexed by code)
└── README.md
```

## Limitations

- Value maps are **exact-match only** (no regex keys)
- `compute` functions must be plain JavaScript (not JSON-serializable — use `.js` mappings)
- Cross-row computations not supported (each row transforms independently)

## Future ideas

- Multiple condition chains (`if` / `else if` / `else`)
- TypeScript declarations
