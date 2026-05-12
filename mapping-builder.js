/**
 * mapping-builder.js — Phase 3: buildMapping() core
 *
 * Converts inspection metadata + user answers into valid json-xslt mapping objects.
 *
 * Public API:
 *   buildMapping(inspection, answers, opts) → mapping object
 *   buildMappingAuto(inspection, opts)     → mapping object (--auto mode)
 *   validateForFormat(mapping, format)     → throws if format violations found
 *
 * Answer shape per field:
 *   {
 *     sourceField: string,          // source field name (e.g. "FullName")
 *     targetField: string,         // target field name (e.g. "full_name"), omit for auto
 *     feature: string,             // one of the DSL feature keys below
 *     params: object,              // feature-specific parameters
 *   }
 *
 * Supported features → resulting mapping entry:
 *   "from"        → { from: "sourceField" }
 *   "rename"      → { from: "sourceField" }   (targetField is the key in fields{})
 *   "format"      → { from: "sourceField", format: params.format, ...params.extra }
 *   "map"         → { from: "sourceField", map: params.mapObject }
 *   "compute"     → { from: params.fields || "sourceField", compute: params.fn }
 *   "if"          → { if: params.condition, then: params.then, else: params.else }
 *   "forEach"     → { forEach: "sourceField", fields: { ... } }
 *   "aggregate"   → { forEach: "sourceField", aggregate: params.op, from: params.field }
 *   "flatten"     → { forEach: "sourceField", flatten: params.path, fields: { ... } }
 *   "groupBy"     → { forEach: "sourceField", groupBy: params.field, fields: { ... } }
 *   "distinct"    → { forEach: "sourceField", distinct: params.field }
 *   "filter"      → { forEach: "sourceField", filter: params.condition }
 *   "sortBy"      → { forEach: "sourceField", sortBy: params.field, fields: { ... } }
 *   "template"    → { template: params.template, format: params.format }
 *   "coalesce"    → { coalesce: params.fields, default: params.default }
 *   "lookup"      → { from: params.keyField, lookup: params.dict, lookupPath: params.path }
 *   "value"       → { value: params.value }
 *   "default"     → { from: "sourceField", default: params.value }
 *   "passthrough" → mapping-level passthrough: { passthrough: true } or { passthrough: { exclude: [...] } }
 *   "schema"      → mapping-level schema block
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Date / type detection helpers ───────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC_STR_RE = /^-?\d+(\.\d+)?$/;

/**
 * Inspect a flat array of record objects.
 * Returns metadata about each top-level (and nested) field.
 */
export function inspect(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return { recordCount: 0, fields: {} };
  }

  const fields = {};
  const sample = data[0];

  function processValue(value, prefix) {
    if (value === null || value === undefined) return;

    if (Array.isArray(value)) {
      if (value.length > 0) {
        const first = value[0];
        if (typeof first === "object" && first !== null) {
          // Array of objects — recurse into first item
          processValue(first, prefix);
        }
        // Primitive arrays just get typed as "array"
        fields[prefix] = { type: "array", sample: value.length };
      } else {
        fields[prefix] = { type: "array", sample: 0 };
      }
      return;
    }

    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        processValue(v, prefix ? `${prefix}.${k}` : k);
      }
      return;
    }

    const type = typeof value;
    if (!fields[prefix]) {
      fields[prefix] = { type, sample: value };
    } else if (fields[prefix].type !== type) {
      // Mixed types → upgrade to mixed
      fields[prefix].type = "mixed";
    }
  }

  for (const [k, v] of Object.entries(sample)) {
    processValue(v, k);
  }

  // Second pass: collect distinct values and min/max for numbers
  const distinctMap = {};
  const numValues = {};

  for (const record of data) {
    function scan(value, prefix) {
      if (value === null || value === undefined) return;
      if (Array.isArray(value)) {
        if (value.length > 0 && typeof value[0] === "object") {
          value.forEach(item => scan(item, prefix));
        }
        return;
      }
      if (typeof value === "object") {
        for (const [k, v] of Object.entries(value)) scan(v, prefix ? `${prefix}.${k}` : k);
        return;
      }

      if (!distinctMap[prefix]) distinctMap[prefix] = new Set();
      distinctMap[prefix].add(String(value));

      if (typeof value === "number" || NUMERIC_STR_RE.test(String(value))) {
        const n = Number(value);
        if (!numValues[prefix]) numValues[prefix] = { min: n, max: n };
        else { numValues[prefix].min = Math.min(numValues[prefix].min, n); numValues[prefix].max = Math.max(numValues[prefix].max, n); }
      }
    }

    for (const [k, v] of Object.entries(record)) scan(v, k);
  }

  const result = {};
  for (const [field, meta] of Object.entries(fields)) {
    const info = { ...meta };
    if (distinctMap[field]) {
      info.distinctValues = [...distinctMap[field]];
      if (info.distinctValues.length <= 10) info.distinctValues = info.distinctValues;
    }
    if (numValues[field]) {
      info.min = numValues[field].min;
      info.max = numValues[field].max;
    }
    result[field] = info;
  }

  return { recordCount: data.length, fields: result };
}

/**
 * Detect if a string field looks like a date.
 */
export function looksLikeDate(value) {
  if (typeof value !== "string") return false;
  return ISO_DATE_RE.test(value.trim());
}

/**
 * Convert a field name to snake_case.
 */
export function toSnakeCase(name) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s\-]+/g, "_")
    .toLowerCase();
}

/**
 * Convert a field name to camelCase.
 */
export function toCamelCase(name) {
  const words = name.replace(/[-_\s]+/g, " ").split(" ");
  return words.map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
}

// ── buildMapping: main entry point ───────────────────────────────────────────

/**
 * Build a mapping object from inspection metadata and per-field answers.
 *
 * @param {object} inspection  - result of inspect()
 * @param {Array}  answers     - array of field answer objects (see file header)
 * @param {object} opts
 *   outputFormat: "js" | "json"  (default "js")
 *   passthrough: boolean | { include?: string[], exclude?: string[] }
 *   schema: object (optional schema definition)
 *   id: string (mapping id)
 */
export function buildMapping(inspection, answers = [], opts = {}) {
  const { outputFormat = "js", passthrough, schema, id } = opts;

  const mapping = {};
  if (id) mapping.id = id;

  // Handle top-level passthrough
  if (passthrough !== undefined) {
    mapping.passthrough = passthrough;
  }

  // Schema
  if (schema) {
    mapping.schema = schema;
  }

  // Build fields
  const fields = {};
  for (const answer of answers) {
    const fieldEntry = buildFieldEntry(answer);
    if (fieldEntry !== null) {
      // targetField defaults to sourceField for most features
      const target = answer.targetField || answer.sourceField;
      fields[target] = fieldEntry;
    }
  }

  if (Object.keys(fields).length > 0) {
    mapping.fields = fields;
  }

  // Validate .json constraints
  validateForFormat(mapping, outputFormat);

  return mapping;
}

/**
 * Convert a single answer object into a mapping field entry.
 */
function buildFieldEntry(answer) {
  const { feature, sourceField, targetField, params = {} } = answer;

  switch (feature) {
    case "value":
      return { value: params.value };

    case "from":
    case "rename":
      return { from: sourceField };

    case "format": {
      const entry = { from: sourceField, format: params.format };
      // Pass through format-specific extra params only if defined
      if (params.outputFormat !== undefined) entry.outputFormat = params.outputFormat;
      if (params.separator    !== undefined) entry.separator    = params.separator;
      if (params.length       !== undefined) entry.length       = params.length;
      if (params.suffix       !== undefined) entry.suffix       = params.suffix;
      if (params.find         !== undefined) entry.find         = params.find;
      if (params.replaceWith  !== undefined) entry.replaceWith  = params.replaceWith;
      if (params.precision    !== undefined) entry.precision    = params.precision;
      if (params.flags        !== undefined) entry.flags        = params.flags;
      return entry;
    }

    case "map":
      return { from: sourceField, map: params.mapObject };

    case "compute":
      return { from: params.fields || sourceField, compute: params.fn };

    case "if": {
      const entry = { if: params.condition };
      if (params.then !== undefined) entry.then = params.then;
      if (params.else !== undefined) entry.else = params.else;
      if (params.thenMap)           entry.thenMap = params.thenMap;
      if (params.elseMap)           entry.elseMap = params.elseMap;
      return entry;
    }

    case "forEach":
      return { forEach: sourceField, fields: params.fields || {} };

    case "aggregate": {
      const entry = { forEach: sourceField, aggregate: params.op, from: params.field };
      if (params.default !== undefined) entry.default = params.default;
      return entry;
    }

    case "flatten":
      return {
        forEach: sourceField,
        flatten: params.path || undefined,
        fields: params.fields || {},
      };

    case "groupBy":
      return {
        forEach: sourceField,
        groupBy: params.field,
        fields: params.fields || {},
      };

    case "distinct":
      return { forEach: sourceField, distinct: params.field };

    case "filter":
      return { forEach: sourceField, filter: params.condition };

    case "sortBy": {
      const entry = { forEach: sourceField, sortBy: params.field };
      if (params.order) entry.sortBy = { field: params.field, order: params.order };
      return entry;
    }

    case "template":
      return {
        template: params.template,
        ...(params.format ? { format: params.format } : {}),
        ...(params.outputFormat ? { outputFormat: params.outputFormat } : {}),
      };

    case "coalesce":
      return {
        coalesce: params.fields,
        default: params.default,
      };

    case "lookup":
      return {
        from: params.keyField || sourceField,
        lookup: params.dict,
        lookupPath: params.lookupPath,
      };

    case "default":
      return { from: sourceField, default: params.value };

    case "passthrough":
      // Handled at mapping level; return null here
      return null;

    case "schema":
      // Handled at mapping level; return null here
      return null;

    default:
      return null;
  }
}

// ── Auto mode ────────────────────────────────────────────────────────────────

/**
 * Auto-generate a mapping from inspection data with sensible defaults.
 *
 * Rules:
 *   - Snake_case target field names
 *   - ISO-8601 date strings → format: "date", outputFormat: "YYYY-MM-DD"
 *   - Numeric strings → format: "number"
 *   - Arrays of objects → forEach blocks with inferred sub-fields
 *   - String fields with ≤10 distinct values → suggest map feature
 *   - All others → simple from: sourceField
 */
export function buildMappingAuto(inspection, opts = {}) {
  // Only set passthrough if explicitly requested (undefined means no passthrough key)
  const hasPassthrough = "passthrough" in opts;
  const answers = [];

  const { fields } = inspection;

  for (const [sourceField, meta] of Object.entries(fields)) {
    const targetField = toSnakeCase(sourceField);
    const { type, distinctValues } = meta;

    // Handle nested (dot-path) — always just do from
    if (sourceField.includes(".")) {
      answers.push({ sourceField, targetField, feature: "from" });
      continue;
    }

    // Arrays of objects → forEach with inferred sub-fields.
    // Use source field name as target (not snake_case) — the transform engine
    // resolves forEach:"LineItems" against fields["LineItems"].
    if (type === "array") {
      // For auto mode, we just flag it; sub-field mapping would need deeper inspection
      answers.push({
        sourceField, targetField: sourceField, feature: "forEach",
        params: { fields: {} }, // sub-fields would be filled by deeper inspect
      });
      continue;
    }

    // Date detection
    if (type === "string" && looksLikeDate(meta.sample || "")) {
      answers.push({
        sourceField, targetField, feature: "format",
        params: { format: "date", outputFormat: "YYYY-MM-DD" },
      });
      continue;
    }

    // Numeric string detection — only auto-convert strings with decimal points
    // to avoid treating zip codes, IDs, phone numbers as numeric.
    if (type === "string" && NUMERIC_STR_RE.test(String(meta.sample || ""))) {
      const sampleStr = String(meta.sample || "");
      if (sampleStr.includes(".")) {
        answers.push({
          sourceField, targetField, feature: "format",
          params: { format: "number" },
        });
        continue;
      }
    }

    // Mixed type → just passthrough rename
    if (type === "mixed") {
      answers.push({ sourceField, targetField, feature: "from" });
      continue;
    }

    // Boolean strings
    if (type === "string" && ["true", "false"].includes(String(meta.sample).toLowerCase())) {
      answers.push({
        sourceField, targetField, feature: "format",
        params: { format: "boolean" },
      });
      continue;
    }

    // Default: simple from/rename
    answers.push({ sourceField, targetField, feature: "from" });
  }

  const mappingOpts = hasPassthrough ? { passthrough: opts.passthrough } : {};
  const mapping = buildMapping(inspection, answers, mappingOpts);
  return mapping;
}

// ── Format validation ────────────────────────────────────────────────────────

/**
 * Throws if the mapping contains features illegal for the given output format.
 * `.json` output cannot include `compute` (JS functions) or `schema.validate`
 * (custom validation functions).
 */
export function validateForFormat(mapping, format = "js") {
  if (format !== "json") return;

  function check(obj, path) {
    if (!obj || typeof obj !== "object") return;

    if (typeof obj.compute === "function") {
      throw new Error(
        `compute (JS function) is not supported for .json output at "${path}". ` +
        `Use .js output format, or replace compute with a from/format/map expression.`
      );
    }

    if (obj.schema) {
      for (const [field, rules] of Object.entries(obj.schema)) {
        if (typeof rules.validate === "function") {
          throw new Error(
            `schema.validate (custom function) is not supported for .json output. ` +
            `Define rules with required/type/pattern/min/max only, or use .js output format.`
          );
        }
      }
    }

    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object") {
        check(v, path ? `${path}.${k}` : k);
      }
    }
  }

  check(mapping, "mapping");
}

// ── CLI helpers ─────────────────────────────────────────────────────────────

const VALID_FORMATS = [
  "date","lowercase","uppercase","trim","number","string","boolean","negate",
  "titlecase","camelcase","snakecase","kebabcase","truncate","replace",
  "round","split","join",
];

const VALID_AGGREGATES = ["sum","count","min","max","avg"];
const VALID_COND_OPS   = ["eq","neq","gte","lte","gt","lt","in","not-in","exists","matches","truthy","falsy"];

/**
 * Normalise a user-supplied answer bundle into the canonical answer shape.
 * Handles shorthand shortcuts (e.g. "r" → "rename", "A" → aggregate).
 */
export function normaliseAnswer(raw) {
  const a = { ...raw };

  // Feature shorthand
  const featureMap = {
    r: "rename", f: "format", m: "map", c: "compute", t: "template",
    co: "coalesce", v: "value", i: "if", fe: "forEach",
    ag: "aggregate", fl: "flatten", gb: "groupBy", di: "distinct",
    fi: "filter", so: "sortBy", lu: "lookup", d: "default",
    p: "passthrough", sc: "schema",
    // aggregate shortcuts
    sum: "aggregate", count: "aggregate", min: "aggregate", max: "aggregate", avg: "aggregate",
    // format shortcuts
    upper: "format", lower: "format", title: "format", date: "format", num: "format",
  };

  if (featureMap[a.feature]) a.feature = featureMap[a.feature];

  // Infer targetField from feature if not set
  if (!a.targetField && a.sourceField) {
    a.targetField = toSnakeCase(a.sourceField);
  }

  // Normalise format names
  if (a.feature === "format" && a.params?.format) {
    const fmt = a.params.format;
    if (fmt === "upper")   a.params.format = "uppercase";
    if (fmt === "lower")   a.params.format = "lowercase";
    if (fmt === "title")   a.params.format = "titlecase";
    if (fmt === "num")     a.params.format = "number";
  }

  // Validate format value
  if (a.feature === "format" && a.params?.format) {
    if (!VALID_FORMATS.includes(a.params.format)) {
      throw new Error(`Invalid format "${a.params.format}". Valid: ${VALID_FORMATS.join(", ")}`);
    }
  }

  // Validate aggregate op
  if (a.feature === "aggregate" && a.params?.op) {
    if (!VALID_AGGREGATES.includes(a.params.op)) {
      throw new Error(`Invalid aggregate op "${a.params.op}". Valid: ${VALID_AGGREGATES.join(", ")}`);
    }
  }

  // Validate condition ops
  if (a.feature === "if" && a.params?.condition?.op) {
    if (!VALID_COND_OPS.includes(a.params.condition.op)) {
      throw new Error(`Invalid condition op "${a.params.condition.op}". Valid: ${VALID_COND_OPS.join(", ")}`);
    }
  }

  return a;
}

// ── Export helpers ───────────────────────────────────────────────────────────

/**
 * Export a mapping object to a .js file with `export default { ... }`.
 */
export function exportJs(mapping, filePath) {
  const content = "export default " + JSON.stringify(mapping, null, 2) + ";\n";
  writeFileSync(filePath, content, "utf-8");
}

/**
 * Export a mapping object to a .json file.
 * Validates the mapping first to reject compute/schema.validate.
 */
export function exportJson(mapping, filePath) {
  validateForFormat(mapping, "json");
  const content = JSON.stringify(mapping, null, 2) + "\n";
  writeFileSync(filePath, content, "utf-8");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════════════════════

function parseCliArgs(argv) {
  const args = {
    inspect: null,
    data: null,
    output: null,
    format: "js",
    auto: false,
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    switch (a) {
      case "--inspect":
        i++; args.inspect = argv[i]; break;
      case "-d": case "--data":
        i++; args.data = argv[i]; break;
      case "-o": case "--output":
        i++; args.output = argv[i]; break;
      case "--format":
        i++; args.format = argv[i]; break;
      case "--auto":
        args.auto = true; break;
      case "-h": case "--help":
        args.help = true; break;
    }
    i++;
  }
  return args;
}

function printHelp() {
  console.log(`
mapping-builder — Generate json-xslt mapping files from source JSON data

USAGE
  node mapping-builder.js --inspect <file>
  node mapping-builder.js --data <file> [options]

OPTIONS
  --inspect <file>    Analyze source JSON and print field metadata report
  -d, --data <file>   Input JSON file to build a mapping for
  -o, --output <file> Output mapping file (default: stdout)
  --format js|json    Output format — js supports compute(), json does not
  --auto              Non-interactive: generate best-guess mapping
  -h, --help          Show this help

EXAMPLES
  node mapping-builder.js --inspect test-data.json
  node mapping-builder.js --data test-data.json --auto -o mapping.js
  node mapping-builder.js --data test-data.json -o mapping.js --format json
`);
}

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function loadDataFile(filePath) {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    die(`data file not found: ${resolved}`);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(resolved, "utf-8"));
  } catch (e) {
    die(`invalid JSON in data file "${filePath}": ${e.message}`);
  }

  if (!Array.isArray(data)) {
    die(`data file must contain a JSON array of objects: ${filePath}`);
  }

  if (data.length === 0) {
    die(`data file contains an empty array: ${filePath}`);
  }

  return data;
}

function formatInspectReport(report) {
  const lines = [];
  lines.push(`Records analyzed: ${report.recordCount}`);
  lines.push(`Fields discovered: ${Object.keys(report.fields).length}`);
  lines.push("");

  for (const [fieldName, meta] of Object.entries(report.fields)) {
    lines.push(`─ ${fieldName} ────────────────────────────────────────────────`.slice(0, 60));
    lines.push(`  type:         ${meta.type}`);

    if (meta.sample !== undefined && meta.sample !== null) {
      const sampleStr = typeof meta.sample === "string"
        ? `"${meta.sample}"`
        : JSON.stringify(meta.sample);
      lines.push(`  sample:       ${sampleStr}`);
    }

    if (meta.distinctValues && meta.distinctValues.length > 0) {
      lines.push(`  distinct:     ${meta.distinctValues.length} unique values`);
      if (meta.distinctValues.length <= 10) {
        const vals = meta.distinctValues.map(v =>
          typeof v === "string" ? `"${v}"` : JSON.stringify(v)
        ).join(", ");
        lines.push(`  values:       ${vals}`);
      }
    }

    if (meta.min !== undefined && meta.min !== null) {
      lines.push(`  range:        ${meta.min} → ${meta.max}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

// import { existsSync } from "node:fs";
import { existsSync } from "node:fs";

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  // ── Inspect mode ──────────────────────────────────────────────────────
  if (args.inspect) {
    const data = loadDataFile(args.inspect);
    const report = inspect(data);

    const output = args.output
      ? JSON.stringify(report, null, 2)
      : formatInspectReport(report);

    if (args.output) {
      writeFileSync(resolve(args.output), output + "\n", "utf-8");
      console.error(`Wrote inspection report to ${resolve(args.output)}`);
    } else {
      console.log(output);
    }
    return;
  }

  // ── Auto mode ───────────────────────────────────────────────────────
  if (args.data && args.auto) {
    const data = loadDataFile(args.data);
    const report = inspect(data);
    const mapping = buildMappingAuto(report);

    if (args.format === "json") {
      validateForFormat(mapping, "json");
    }

    if (args.output) {
      if (args.format === "json") {
        exportJson(mapping, resolve(args.output));
      } else {
        exportJs(mapping, resolve(args.output));
      }
      console.error(`Wrote ${args.format} mapping to ${resolve(args.output)}`);
    } else {
      if (args.format === "json") {
        console.log(JSON.stringify(mapping, null, 2));
      } else {
        console.log("export default " + JSON.stringify(mapping, null, 2) + ";");
      }
    }
    return;
  }

  // ── Interactive mode (not yet implemented) ─────────────────────────────
  if (args.data) {
    console.error("Interactive mapping builder is not yet implemented.");
    console.error("Use --auto to generate a mapping non-interactively, or --inspect to analyze your data.");
    process.exit(1);
  }

  printHelp();
}

main().catch(e => {
  console.error(`fatal: ${e.message}`);
  process.exit(1);
});

