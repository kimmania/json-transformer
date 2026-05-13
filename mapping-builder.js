/**
 * mapping-builder.js — Phase 3: buildMapping() core
 *
 * Converts inspection metadata + user answers into valid json-transformer mapping objects.
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

import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
//  Interactive Wizard
// ═══════════════════════════════════════════════════════════════════════════════

import { createInterface } from "node:readline";

// ── Readline helpers ─────────────────────────────────────────────────────────

function createRl() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

async function ask(rl, question, defaultValue) {
  const prompt = defaultValue !== undefined
    ? `${question} [${defaultValue}] > `
    : `${question} > `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

async function askChoice(rl, question, choices, defaultIndex = 0) {
  console.log(`\n${question}`);
  choices.forEach((c, i) => {
    const marker = i === defaultIndex ? "← default" : "";
    console.log(`  [${c.key}] ${c.label} ${marker}`);
  });
  const defKey = choices[defaultIndex]?.key || "";
  const answer = await ask(rl, "Choice", defKey);
  const found = choices.find(c => c.key === answer);
  if (!found) {
    console.log(`  Invalid choice "${answer}". Using default.`);
    return choices[defaultIndex]?.value;
  }
  return found.value;
}

async function askYesNo(rl, question, defaultYes = false) {
  const def = defaultYes ? "Y" : "N";
  const answer = await ask(rl, `${question} (y/n)`, def);
  return /^y/i.test(answer);
}

// ── Wizard state ─────────────────────────────────────────────────────────────

function initWizardState(report, sourceData) {
  const fields = [];
  const allFieldNames = Object.keys(report.fields);

  for (const sourceField of allFieldNames) {
    const meta = report.fields[sourceField];
    const { targetField, feature, params } = inferFieldDefaults(sourceField, meta);
    fields.push({
      sourceField,
      targetField,
      feature,
      params: params || {},
      skipped: false,
      meta,
    });
  }

  return {
    fields,
    cursor: 0,
    passthrough: undefined,
    schema: undefined,
    mappingId: undefined,
    sourceData,
    report,
  };
}

function inferFieldDefaults(sourceField, meta) {
  const targetField = toSnakeCase(sourceField);

  if (sourceField.includes(".")) {
    return { targetField, feature: "from", params: {} };
  }

  if (meta.type === "array") {
    return { targetField: sourceField, feature: "forEach", params: { fields: {} } };
  }

  if (meta.type === "string" && looksLikeDate(meta.sample || "")) {
    return { targetField, feature: "format", params: { format: "date", outputFormat: "YYYY-MM-DD" } };
  }

  if (meta.type === "string" && NUMERIC_STR_RE.test(String(meta.sample || ""))) {
    const sampleStr = String(meta.sample || "");
    if (sampleStr.includes(".")) {
      return { targetField, feature: "format", params: { format: "number" } };
    }
  }

  if (meta.type === "mixed") {
    return { targetField, feature: "from", params: {} };
  }

  if (meta.type === "string" && ["true", "false"].includes(String(meta.sample).toLowerCase())) {
    return { targetField, feature: "format", params: { format: "boolean" } };
  }

  return { targetField, feature: "from", params: {} };
}

// ── Field presentation ───────────────────────────────────────────────────────

function printFieldHeader(state) {
  const f = state.fields[state.cursor];
  const total = state.fields.length;
  console.log(`\n═══════════════════════════════════════════════════════════════════════════════`);
  console.log(`Field ${state.cursor + 1} of ${total}: ${f.sourceField}`);
  console.log(`───────────────────────────────────────────────────────────────────────────────`);
  console.log(`  type:         ${f.meta.type}`);
  if (f.meta.sample !== undefined) {
    const s = typeof f.meta.sample === "string" ? `"${f.meta.sample}"` : JSON.stringify(f.meta.sample);
    console.log(`  sample:       ${s}`);
  }
  if (f.meta.distinctValues && f.meta.distinctValues.length <= 10) {
    console.log(`  values:       ${f.meta.distinctValues.map(v => `"${v}"`).join(", ")}`);
  }
  if (f.meta.min !== undefined) {
    console.log(`  range:        ${f.meta.min} → ${f.meta.max}`);
  }
  console.log("");
}

// ── Feature prompts ──────────────────────────────────────────────────────────

async function promptFeature(rl, state) {
  const f = state.fields[state.cursor];
  const choices = [
    { key: "r", label: "rename (simple from mapping)", value: "from" },
    { key: "f", label: "format (date, number, case, trim, etc.)", value: "format" },
    { key: "m", label: "map (value substitution)", value: "map" },
    { key: "t", label: "template (combine fields into a string)", value: "template" },
    { key: "i", label: "if / then / else", value: "if" },
    { key: "c", label: "coalesce (first non-null of several fields)", value: "coalesce" },
    { key: "v", label: "value (static literal)", value: "value" },
    { key: "d", label: "default (fallback if missing/null)", value: "default" },
    { key: "e", label: "forEach (array of objects)", value: "forEach" },
    { key: "x", label: "compute (arithmetic / concatenate)", value: "compute" },
  ];

  const validChoices = choices.filter(c => {
    if (f.meta.type === "array" && c.value !== "forEach" && c.value !== "value") return false;
    if (c.value === "forEach" && f.meta.type !== "array") return false;
    return true;
  });

  const defaultValue = f.feature;
  const defaultIndex = validChoices.findIndex(c => c.value === defaultValue);
  const feature = await askChoice(rl, "Feature:", validChoices, Math.max(0, defaultIndex));
  f.feature = feature;

  switch (feature) {
    case "from":
      f.params = {};
      break;
    case "format":
      f.params = await promptFormatParams(rl, f.meta);
      break;
    case "map":
      f.params = await promptMapParams(rl, f.meta);
      break;
    case "template":
      f.params = await promptTemplateParams(rl, state);
      break;
    case "if":
      f.params = await promptIfParams(rl, state);
      break;
    case "coalesce":
      f.params = await promptCoalesceParams(rl, state);
      break;
    case "value":
      f.params = await promptValueParams(rl);
      break;
    case "default":
      f.params = await promptDefaultParams(rl);
      break;
    case "forEach":
      f.params = await promptForEachParams(rl, state);
      break;
    case "compute":
      f.params = await promptComputeParams(rl, state);
      break;
  }
}

async function promptFormatParams(rl, meta) {
  const formatChoices = [
    { key: "1", label: "uppercase", value: "uppercase" },
    { key: "2", label: "lowercase", value: "lowercase" },
    { key: "3", label: "titlecase", value: "titlecase" },
    { key: "4", label: "trim", value: "trim" },
    { key: "5", label: "number", value: "number" },
    { key: "6", label: "boolean", value: "boolean" },
    { key: "7", label: "date", value: "date" },
    { key: "8", label: "round", value: "round" },
    { key: "9", label: "truncate", value: "truncate" },
    { key: "10", label: "replace", value: "replace" },
    { key: "11", label: "split", value: "split" },
    { key: "12", label: "camelcase", value: "camelcase" },
    { key: "13", label: "snakecase", value: "snakecase" },
    { key: "14", label: "kebabcase", value: "kebabcase" },
  ];

  let defIdx = 0;
  if (meta.type === "string" && looksLikeDate(meta.sample || "")) defIdx = 6;
  else if (meta.type === "string" && NUMERIC_STR_RE.test(String(meta.sample || "")) && String(meta.sample).includes(".")) defIdx = 4;

  const format = await askChoice(rl, "Format type:", formatChoices, defIdx);
  const params = { format };

  if (format === "date") {
    const fmt = await ask(rl, "Output format", "YYYY-MM-DD");
    params.outputFormat = fmt;
  }
  if (format === "round") {
    const prec = await ask(rl, "Precision (decimal places)", "2");
    params.precision = parseInt(prec, 10);
  }
  if (format === "truncate") {
    const len = await ask(rl, "Max length", "50");
    params.length = parseInt(len, 10);
    const sfx = await ask(rl, "Suffix", "...");
    params.suffix = sfx;
  }
  if (format === "replace") {
    const find = await ask(rl, "Find pattern");
    params.find = find;
    const replaceWith = await ask(rl, "Replace with", "");
    params.replaceWith = replaceWith;
  }
  if (format === "split") {
    const sep = await ask(rl, "Separator", ",");
    params.separator = sep;
  }
  return params;
}

async function promptMapParams(rl, meta) {
  const mapObj = {};
  console.log("\nMap values:");
  if (meta.distinctValues && meta.distinctValues.length > 0) {
    for (const val of meta.distinctValues.slice(0, 20)) {
      const mapped = await ask(rl, `  "${val}" →`, val);
      mapObj[val] = mapped;
    }
  } else {
    console.log("  No distinct values found. Add mappings manually.");
    while (await askYesNo(rl, "Add another mapping?")) {
      const from = await ask(rl, "  Source value");
      const to = await ask(rl, "  Target value");
      mapObj[from] = to;
    }
  }
  return { mapObject: mapObj };
}

async function promptTemplateParams(rl, state) {
  const available = state.fields.filter(f => !f.skipped).map(f => f.sourceField);
  console.log("\nAvailable fields: " + available.join(", "));
  const template = await ask(rl, "Template (use {fieldName} for substitutions)");
  const wantFormat = await askYesNo(rl, "Apply a format to the result?");
  const params = { template };
  if (wantFormat) {
    const fmt = await ask(rl, "Format (uppercase/lowercase/titlecase/trim)", "titlecase");
    params.format = fmt;
  }
  return params;
}

async function promptIfParams(rl, state) {
  const available = state.fields.map(f => f.sourceField);
  console.log("\nAvailable fields: " + available.join(", "));
  const field = await ask(rl, "Condition field");
  const op = await ask(rl, "Operator (eq/neq/gt/gte/lt/lte/truthy/falsy)", "eq");
  let condition = { field, op };
  if (!["truthy", "falsy", "exists"].includes(op)) {
    const value = await ask(rl, "Compare value");
    condition.value = value;
  }
  const thenVal = await ask(rl, "Then (value if true)");
  const elseVal = await ask(rl, "Else (value if false)");
  return { condition, then: thenVal, else: elseVal };
}

async function promptCoalesceParams(rl, state) {
  const available = state.fields.map(f => f.sourceField);
  console.log("\nAvailable fields: " + available.join(", "));
  const fields = [];
  while (true) {
    const f = await ask(rl, `Field ${fields.length + 1} (blank to finish)`);
    if (!f) break;
    fields.push(f);
  }
  const def = await ask(rl, "Default if all null");
  return { fields, default: def || undefined };
}

async function promptValueParams(rl) {
  const value = await ask(rl, "Static value");
  return { value };
}

async function promptDefaultParams(rl) {
  const value = await ask(rl, "Default value if source is missing/null");
  return { value };
}

async function promptForEachParams(rl, state) {
  const f = state.fields[state.cursor];
  const sampleItems = extractSampleArray(state.sourceData, f.sourceField);

  if (sampleItems.length === 0) {
    console.log("  Warning: could not find non-empty array items for this field.");
    return { fields: {} };
  }

  console.log(`\n  Found ${sampleItems.length} sample item(s) for array inspection.`);
  const proceed = await askYesNo(rl, "Configure sub-fields for forEach?", true);
  if (!proceed) {
    return { fields: {} };
  }

  const subReport = inspect(sampleItems);
  const subState = initWizardState(subReport, sampleItems);
  await runWizardLoop(rl, subState);

  const subFields = {};
  for (const sf of subState.fields) {
    if (sf.skipped) continue;
    const entry = buildFieldEntry({
      sourceField: sf.sourceField,
      targetField: sf.targetField,
      feature: sf.feature,
      params: sf.params,
    });
    if (entry) subFields[sf.targetField] = entry;
  }

  return { fields: subFields };
}

function extractSampleArray(sourceData, fieldName) {
  for (const record of sourceData) {
    const val = getValueAtPath(record, fieldName);
    if (Array.isArray(val) && val.length > 0) {
      if (typeof val[0] === "object" && val[0] !== null) {
        return val;
      }
    }
  }
  return [];
}

function getValueAtPath(obj, path) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

// ── Compute template picker (Option C) ───────────────────────────────────────

async function promptComputeParams(rl, state) {
  const computeChoices = [
    { key: "1", label: "concatenate fields into a string", value: "concat" },
    { key: "2", label: "arithmetic on two number fields", value: "arithmetic" },
    { key: "3", label: "custom template", value: "template" },
  ];

  const mode = await askChoice(rl, "Compute type:", computeChoices, 0);

  if (mode === "concat") {
    const available = state.fields.filter(f => !f.skipped).map(f => f.sourceField);
    console.log("\nAvailable fields: " + available.join(", "));
    const fields = [];
    while (true) {
      const f = await ask(rl, `Field ${fields.length + 1} (blank to finish)`);
      if (!f) break;
      fields.push(f);
    }
    const sep = await ask(rl, "Separator", " ");
    const template = fields.map(f => `{${f}}`).join(sep);
    return { template };
  }

  if (mode === "arithmetic") {
    const available = state.fields
      .filter(f => !f.skipped && (f.meta.type === "number" || (f.feature === "format" && f.params?.format === "number")))
      .map(f => f.sourceField);
    console.log("\nNumber fields: " + available.join(", "));
    const a = await ask(rl, "First field");
    const ops = [
      { key: "+", label: "add", value: "+" },
      { key: "-", label: "subtract", value: "-" },
      { key: "*", label: "multiply", value: "*" },
      { key: "/", label: "divide", value: "/" },
    ];
    const op = await askChoice(rl, "Operator:", ops, 0);
    const b = await ask(rl, "Second field");

    // Sanitize field names to prevent code injection via new Function()
    const SAFE_FIELD_RE = /^[a-zA-Z0-9_.]+$/;
    if (!SAFE_FIELD_RE.test(a) || !SAFE_FIELD_RE.test(b)) {
      throw new Error("Invalid field name. Only alphanumeric, underscore, and dot characters are allowed.");
    }
    const SAFE_OPS = new Set(["+", "-", "*", "/"]);
    if (!SAFE_OPS.has(op)) {
      throw new Error(`Invalid operator "${op}". Only +, -, *, / are allowed.`);
    }

    const fnBody = `return ${a} ${op} ${b}`;
    // eslint-disable-next-line no-new-func
    const fn = new Function(a, b, fnBody);
    return { fields: [a, b], fn };
  }

  if (mode === "template") {
    const available = state.fields.filter(f => !f.skipped).map(f => f.sourceField);
    console.log("\nAvailable fields: " + available.join(", "));
    const template = await ask(rl, "Template (use {fieldName})", "{field1} {field2}");
    return { template };
  }

  return {};
}

// ── Wizard main loop ─────────────────────────────────────────────────────────

async function runWizardLoop(rl, state) {
  while (state.cursor < state.fields.length) {
    printFieldHeader(state);
    const f = state.fields[state.cursor];

    const target = await ask(rl, "Target field name", f.targetField);
    f.targetField = target;

    const actionChoices = [
      { key: "c", label: "customize", value: "customize" },
      { key: "s", label: "skip", value: "skip" },
      { key: "a", label: "accept default", value: "accept" },
      { key: "b", label: "back", value: "back" },
      { key: "p", label: "preview mapping so far", value: "preview" },
    ];
    const action = await askChoice(rl, "Action:", actionChoices, 2);

    if (action === "skip") {
      f.skipped = true;
      state.cursor++;
      continue;
    }

    if (action === "back") {
      if (state.cursor > 0) state.cursor--;
      continue;
    }

    if (action === "preview") {
      previewPartialMapping(state);
      continue;
    }

    if (action === "customize") {
      await promptFeature(rl, state);
    }

    state.cursor++;
  }
}

function previewPartialMapping(state) {
  const fields = {};
  for (const f of state.fields) {
    if (f.skipped) continue;
    const entry = buildFieldEntry({
      sourceField: f.sourceField,
      targetField: f.targetField,
      feature: f.feature,
      params: f.params,
    });
    if (entry) fields[f.targetField] = entry;
  }
  const partial = { fields };
  console.log("\n── Preview ────────────────────────────────────────────────────────────────────");
  console.log(JSON.stringify(partial, null, 2));
  console.log("");
}

// ── Final screen ─────────────────────────────────────────────────────────────

async function runFinalScreen(rl, state) {
  const configured = state.fields.filter(f => !f.skipped).length;
  const skipped = state.fields.filter(f => f.skipped).length;

  console.log(`\n═══════════════════════════════════════════════════════════════════════════════`);
  console.log(`PREVIEW (${configured} fields configured, ${skipped} skipped)`);
  previewPartialMapping(state);

  const action = await askChoice(rl, "What next?", [
    { key: "w", label: "write to file", value: "write" },
    { key: "e", label: "edit a field", value: "edit" },
    { key: "t", label: "test transform (first 3 records)", value: "test" },
    { key: "q", label: "quit without saving", value: "quit" },
  ], 0);

  return action;
}

async function editField(rl, state) {
  console.log("\nFields:");
  state.fields.forEach((f, i) => {
    const status = f.skipped ? "[skipped]" : `[${f.feature}]`;
    console.log(`  ${i + 1}. ${f.sourceField} → ${f.targetField} ${status}`);
  });
  const num = await ask(rl, "Edit which field #");
  const idx = parseInt(num, 10) - 1;
  if (idx >= 0 && idx < state.fields.length) {
    state.cursor = idx;
    state.fields[idx].skipped = false;
    await runWizardLoop(rl, state);
  }
}

async function testTransformPreview(state) {
  try {
    const { transform } = await import("./transform.js");
    const fields = {};
    for (const f of state.fields) {
      if (f.skipped) continue;
      const entry = buildFieldEntry({
        sourceField: f.sourceField,
        targetField: f.targetField,
        feature: f.feature,
        params: f.params,
      });
      if (entry) fields[f.targetField] = entry;
    }
    const mapping = { fields };
    const sample = state.sourceData.slice(0, 3);
    const result = transform(sample, mapping);
    console.log("\n── Test Transform Output (first 3 records) ────────────────────────────────────");
    console.log(JSON.stringify(result, null, 2));
    console.log("");
  } catch (e) {
    console.error(`Transform test failed: ${e.message}`);
  }
}

// ── Public wizard entry point ────────────────────────────────────────────────

export async function runWizard(report, sourceData) {
  const rl = createRl();
  const state = initWizardState(report, sourceData);

  try {
    state.passthrough = await askYesNo(rl, "Include all unmapped fields (passthrough)?", false);
    const id = await ask(rl, "Mapping ID (optional)");
    if (id) state.mappingId = id;

    await runWizardLoop(rl, state);

    while (true) {
      const action = await runFinalScreen(rl, state);
      if (action === "write") break;
      if (action === "quit") {
        rl.close();
        return null;
      }
      if (action === "edit") {
        await editField(rl, state);
        continue;
      }
      if (action === "test") {
        await testTransformPreview(state);
        const back = await askChoice(rl, "Continue?", [
          { key: "y", label: "return to preview", value: "y" },
        ], 0);
        if (back === "y") continue;
      }
    }

    rl.close();

    const answers = state.fields
      .filter(f => !f.skipped)
      .map(f => ({
        sourceField: f.sourceField,
        targetField: f.targetField,
        feature: f.feature,
        params: f.params,
      }));

    const opts = {};
    if (state.mappingId) opts.id = state.mappingId;
    if (state.passthrough) opts.passthrough = true;

    return buildMapping(report, answers, opts);
  } catch (e) {
    rl.close();
    throw e;
  }
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
mapping-builder — Generate json-transformer mapping files from source JSON data

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

export function formatInspectReport(report) {
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

  // ── Interactive wizard mode ──────────────────────────────────────────────────────
  if (args.data) {
    const data = loadDataFile(args.data);
    const report = inspect(data);

    // Non-TTY fallback to auto mode
    if (!process.stdin.isTTY) {
      console.error("Non-interactive environment detected. Using --auto mode.");
      const mapping = buildMappingAuto(report);
      if (args.format === "json") validateForFormat(mapping, "json");
      if (args.output) {
        if (args.format === "json") exportJson(mapping, resolve(args.output));
        else exportJs(mapping, resolve(args.output));
        console.error(`Wrote ${args.format} mapping to ${resolve(args.output)}`);
      } else {
        if (args.format === "json") console.log(JSON.stringify(mapping, null, 2));
        else console.log("export default " + JSON.stringify(mapping, null, 2) + ";");
      }
      return;
    }

    const mapping = await runWizard(report, data);
    if (mapping === null) {
      console.log("Quit without saving.");
      return;
    }

    if (args.format === "json") {
      validateForFormat(mapping, "json");
    }

    let outputPath = args.output;
    if (!outputPath) {
      const rl = createRl();
      try {
        outputPath = await ask(rl, "Output file path (press Enter for stdout)");
      } finally {
        rl.close();
      }
    }

    if (outputPath) {
      if (args.format === "json") {
        exportJson(mapping, resolve(outputPath));
      } else {
        exportJs(mapping, resolve(outputPath));
      }
      console.error(`Wrote ${args.format} mapping to ${resolve(outputPath)}`);
    } else {
      if (args.format === "json") {
        console.log(JSON.stringify(mapping, null, 2));
      } else {
        console.log("export default " + JSON.stringify(mapping, null, 2) + ";");
      }
    }
    return;
  }

  printHelp();
}

if (import.meta.main) {
  main().catch(e => {
    console.error(`fatal: ${e.message}`);
    process.exit(1);
  });
}

