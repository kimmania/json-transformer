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
import myMapping  from "./my-mapping.js";

const output = transform(inputArray, myMapping);
```

## Mapping definition

Every mapping is a plain JS object with a `fields` dictionary:

```javascript
export default {
  id: "my-migration",
  fields: {
    targetFieldName: { /* fieldDef */ },
  },
};
```

### Field definition options

| Feature | Property | Example |
|---|---|---|
| **Rename** | `from` | `{ from: "OldName" }` |
| **Value map** | `map` | `{ from: "Code", map: { "A": "active", "I": "inactive" } }` |
| **Format date** | `format`, `outputFormat` | `{ from: "Date", format: "date", outputFormat: "YYYY-MM-DD" }` |
| **Format text** | `format` | `{ from: "Name", format: "uppercase" }` (also: `lowercase`, `trim`, `number`, `string`, `boolean`, `negate`) |
| **If / then** | `if`, `then`, `else` | See condition reference below |
| **Compute** | `from` (array), `compute` | `{ from: ["First","Last"], compute: (f,l) => f + " " + l }` |
| **Literal** | `value` | `{ value: "constant" }` |

### Condition operators

| Op | Meaning |
|---|---|
| `eq`, `neq` | Equal / not equal (loose) |
| `gt`, `gte`, `lt`, `lte` | Numeric comparison |
| `in`, `not-in` | Value in / not in array |
| `exists` | Field is present and non-null |
| `matches` | Regex match against string |
| `truthy`, `falsy` | Boolean coercion |

```javascript
{ if: { field: "Status", op: "gte", value: 5 }, then: "pass", else: "fail" }
```

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

When the source array is `null` or missing, the output is `[]`.

### Flat mapping (no nested objects)

If you prefer keeping the output structure flat, use dot-path target keys to collapse nested data:

```javascript
// source: { address: { city: "NYC", state: "NY" } }
fields: {
  "address.city":  { from: "address.city" },
  "address.state": { from: "address.state" },
}
// → { "address.city": "NYC", "address.state": "NY" }
```

### Composite conditions (`and` / `or` / `not`)

Conditions support dot-paths and can be composed together. Nest them as deeply as needed.

**All must match (`and`)**

```javascript
bonus_eligible: {
  if: {
    and: [
      { field: "Status",       op: "eq",   value: "active" },
      { field: "YearsEmployed", op: "gt",   value: 1 },
      { field: "Salary",        op: "gte",  value: 50000 },
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
      { field: "Department",  op: "eq",        value: "Engineering" },
      { field: "Department",  op: "eq",        value: "Management" },
      { field: "Title",       op: "matches",   value: "(?i)(director|vp|chief)" },
    ],
  },
  then: true,
  else: false,
}
```

**Invert a condition (`not`)**

```javascript
needs_review: {
  if: { not: { field: "Status", op: "eq", value: "active" } },
  then: true,
  else: false,
}
```

**Deeply nested — real-world example**

```javascript
// Senior IC if (Engineering OR Data) AND (senior OR staff) AND NOT contractor
senior_ic: {
  if: {
    and: [
      {
        or: [
          { field: "Department", op: "eq", value: "Engineering" },
          { field: "Department", op: "eq", value: "Data" },
        ],
      },
      {
        or: [
          { field: "Level", op: "eq", value: "senior" },
          { field: "Level", op: "eq", value: "staff" },
          { field: "Level", op: "eq", value: "principal" },
        ],
      },
      { field: "EmployeeType", op: "neq", value: "contractor" },
    ],
  },
  then: true,
  else: false,
}
```

## API

```typescript
function transform(source: Array<Object>, mapping: Mapping): Array<Object>
function transformOne(sourceRow: Object, mapping: Mapping): Object
```

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
├── demo.js                    # In-Node demo
├── demo-composite.js          # Composite condition demo
├── test-data.json             # Sample flat data
├── test-nested.json           # Sample nested data
└── README.md
```

## Limitations

- Value maps are **exact-match only** (no regex keys)
- `compute` functions must be plain JavaScript (not JSON-serializable — use `.js` mappings)
- Cross-row computations not supported (each row transforms independently)

## Future ideas

- Multiple condition chains (`if/else if/else if/else`)
- Aggregation across forEach items (`sum`, `count`, `min`, `max`)
- `default` value fallback per field
- TypeScript declarations
