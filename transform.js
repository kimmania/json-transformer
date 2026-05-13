/**
 * json-transformer — Lightweight declarative JSON transformation engine
 *
 * Usage:
 *   import { transform, prepareMapping } from './transform.js';
 *   import mapping from './my-mapping.js';
 *
 *   // Programmatic (automatic dictionary loading):
 *   const ready = await prepareMapping(mapping);
 *   const result = transform(sourceData, ready);
 *
 * Supports nested source paths ("address.city"), nested target blocks,
 * external dictionary loading, and forEach iteration.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Path helpers ─────────────────────────────────────────────────────

/**
 * Resolve a dot-path on an object.
 *   resolvePath({ a: { b: 42 } }, "a.b")  →  42
 *   resolvePath({ a: { b: [10,20] } }, "a.b.1")  →  20
 *   resolvePath({ x: null }, "x.y")  →  undefined
 */
function resolvePath(obj, pathStr) {
  if (obj === null || obj === undefined) return undefined;
  const parts = pathStr.split(".");
  let cursor = obj;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

/**
 * Set a value at a dot-path, creating intermediate objects as needed.
 *   setPath({}, "a.b.c", 42)  →  { a: { b: { c: 42 } } }
 */
function setPath(obj, pathStr, value) {
  const parts = pathStr.split(".");
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = parts[i + 1];
    if (!cursor[key] || typeof cursor[key] !== "object") {
      cursor[key] = /^\d+$/.test(next) ? [] : {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

// ── Dictionary loader ────────────────────────────────────────────────

/**
 * Load and index dictionaries defined in a mapping.
 *
 * Supports two formats:
 *
 *   1. Inline:  { statusMap: { "A": "Active", ... } }
 *
 *   2. External: { employees: { $file: "./employees.json", indexBy: "id" } }
 *
 * $file paths are resolved relative to the mapping file's directory.
 * Returns a new mapping object with dictionaries resolved into lookup maps.
 *
 * @param {Object} mapping   — mapping definition (may be mutated)
 * @param {string} baseDir   — directory to resolve $file paths against
 * @returns {Promise<Object>} — mapping with loaded dictionaries
 */
export async function prepareMapping(mapping, baseDir = ".") {
  if (!mapping.dictionaries || typeof mapping.dictionaries !== "object") {
    return mapping;
  }

  const resolved = {};
  for (const [name, def] of Object.entries(mapping.dictionaries)) {
    if (def && typeof def === "object" && "$file" in def) {
      const filePath = resolve(baseDir, def.$file);
      let data;
      try {
        data = JSON.parse(readFileSync(filePath, "utf-8"));
      } catch (e) {
        throw new Error(`Failed to load dictionary "${name}" from ${filePath}: ${e.message}`);
      }

      if (def.indexBy) {
        // Build lookup map from array of objects
        if (!Array.isArray(data)) {
          throw new Error(`Dictionary "${name}": expected an array for indexBy "${def.indexBy}"`);
        }
        resolved[name] = {};
        for (const item of data) {
          const key = String(resolvePath(item, def.indexBy));
          resolved[name][key] = item;
        }
      } else {
        // Use as-is (must already be a key→value map)
        resolved[name] = data;
      }
    } else {
      // Inline dictionary — use as-is
      resolved[name] = def;
    }
  }

  return { ...mapping, dictionaries: resolved, __resolved: true };
}

/**
 * Synchronous alternative when all dictionaries are inline.
 * Throws if any dictionary uses $file (use prepareMapping instead).
 */
export function prepareMappingSync(mapping, baseDir = ".") {
  if (!mapping.dictionaries || typeof mapping.dictionaries !== "object") {
    return mapping;
  }
  for (const [name, def] of Object.entries(mapping.dictionaries)) {
    if (def && typeof def === "object" && "$file" in def) {
      throw new Error(
        `Dictionary "${name}" uses $file — use the async prepareMapping() instead of prepareMappingSync()`
      );
    }
  }
  return { ...mapping, dictionaries: mapping.dictionaries, __resolved: true };
}

// ── Date helpers ─────────────────────────────────────────────────────

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Strictly validate that a value is a well-formed ISO-8601 date string.
 * Invalid or ambiguous dates (e.g. 2025-02-30) are rejected.
 */
function isValidIsoDate(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!ISO_RE.test(s)) return false;

  const d = new Date(s);
  if (isNaN(d.getTime())) return false;

  // Component verification via UTC round-trip (catches invalid dates like Feb 30)
  const [year, month, day] = s.slice(0, 10).split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const utc = new Date(s.slice(0, 10) + "T00:00:00Z");
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() + 1 !== month || utc.getUTCDate() !== day) {
    return false;
  }

  // Validate time portion bounds when present
  if (s.length > 10) {
    const timeMatch = /T(\d{2}):(\d{2}):(\d{2})/.exec(s);
    if (timeMatch) {
      const hour = Number(timeMatch[1]);
      const minute = Number(timeMatch[2]);
      const second = Number(timeMatch[3]);
      if (hour > 23 || minute > 59 || second > 59) return false;
    }
  }

  return true;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDate(dateValue, outputFormat) {
  if (!isValidIsoDate(dateValue)) return dateValue;
  const d = new Date(dateValue);

  const pad2 = (n) => String(n).padStart(2, "0");
  const YYYY = d.getFullYear();
  const MM   = pad2(d.getMonth() + 1);
  const DD   = pad2(d.getDate());
  const HH   = pad2(d.getHours());
  const mm   = pad2(d.getMinutes());
  const ss   = pad2(d.getSeconds());

  const monthName = MONTHS[d.getMonth()];
  const monthShort = monthName.slice(0, 3);

  const tokens = {
    "YYYY": String(YYYY), "YY": String(YYYY).slice(-2),
    "MM": MM, "M": String(d.getMonth() + 1),
    "DD": DD, "D": String(d.getDate()),
    "HH": HH, "H": String(d.getHours()),
    "hh": pad2(d.getHours() % 12 || 12),
    "mm": mm, "m": String(d.getMinutes()),
    "ss": ss, "s": String(d.getSeconds()),
    "MMMM": monthName, "MMM": monthShort,
    "AMPM": d.getHours() >= 12 ? "PM" : "AM",
  };

  const sortedTokens = Object.keys(tokens)
    .filter(k => k.length > 0)
    .sort((a, b) => b.length - a.length);
  const pattern = new RegExp(sortedTokens.map(escapeRe).join("|"), "g");
  return outputFormat.replace(pattern, (match) => String(tokens[match]));
}

// ── Format helper ────────────────────────────────────────────────────

/**
 * Split a string into lowercase words, handling camelCase, PascalCase,
 * snake_case, kebab-case, SCREAMING_SNAKE, and space-separated input.
 */
function splitWords(str) {
  return String(str)
    .replace(/([a-z])([A-Z])/g, "$1 $2")       // camelCase → camel Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // SQLQuery  → SQL Query
    .split(/[\s_\-]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase());
}

function applyFormat(value, fieldDef) {
  if (!fieldDef.format) return value;
  if (value === undefined || value === null) return undefined;
  switch (fieldDef.format) {
    case "date":      return formatDate(value, fieldDef.outputFormat || "YYYY-MM-DD");
    case "lowercase": return String(value).toLowerCase();
    case "uppercase": return String(value).toUpperCase();
    case "trim":      return String(value).trim();
    case "number":    return Number(value);
    case "string":    return String(value);
    case "boolean":   return Boolean(value);
    case "negate":    return !value;
    case "titlecase": return String(value).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    case "camelcase": {
      const words = splitWords(value);
      return words.map((w, i) => i === 0 ? w : w[0].toUpperCase() + w.slice(1)).join("");
    }
    case "snakecase":  return splitWords(value).join("_");
    case "kebabcase":  return splitWords(value).join("-");
    case "truncate": {
      const max    = fieldDef.length ?? 50;
      const suffix = fieldDef.suffix ?? "...";
      const str    = String(value);
      if (str.length <= max) return str;
      return str.slice(0, Math.max(0, max - suffix.length)) + suffix;
    }
    case "replace": {
      const str = String(value);
      try {
        return str.replace(
          new RegExp(fieldDef.find ?? "", fieldDef.flags ?? "g"),
          fieldDef.replaceWith ?? ""
        );
      } catch {
        return str.split(fieldDef.find ?? "").join(fieldDef.replaceWith ?? "");
      }
    }
    case "round": {
      const factor = Math.pow(10, fieldDef.precision ?? 0);
      return Math.round(Number(value) * factor) / factor;
    }
    case "split":
      return String(value).split(fieldDef.separator ?? ",");
    case "join":
      return Array.isArray(value) ? value.join(fieldDef.separator ?? ", ") : String(value);
    default:          return value;
  }
}

// ── Condition evaluation ─────────────────────────────────────────────

function evaluateCondition(sourceRow, condition) {
  if (condition.and) {
    return Array.isArray(condition.and) && condition.and.every(c => evaluateCondition(sourceRow, c));
  }
  if (condition.or) {
    return Array.isArray(condition.or) && condition.or.some(c => evaluateCondition(sourceRow, c));
  }
  if (condition.not) {
    return !evaluateCondition(sourceRow, condition.not);
  }

  const { field, op, value } = condition;
  if (!field || typeof field !== "string") return false;
  const actual = field.includes(".")
    ? resolvePath(sourceRow, field)
    : sourceRow[field];

  switch (op) {
    case "eq":      return actual == value;
    case "neq":     return actual != value;
    case "gte":     return actual >= value;
    case "lte":     return actual <= value;
    case "gt":      return actual > value;
    case "lt":      return actual < value;
    case "in":      return Array.isArray(value) ? value.includes(actual) : false;
    case "not-in":  return Array.isArray(value) ? !value.includes(actual) : true;
    case "exists":  return value
      ? (actual !== undefined && actual !== null)
      : (actual === undefined || actual === null);
    case "matches": try { return new RegExp(value).test(String(actual)); } catch { return false; }
    case "truthy":  return !!actual;
    case "falsy":   return !actual;
    default:        return false;
  }
}

// ── Core transform ───────────────────────────────────────────────────

function transformField(sourceRow, fieldDef, dictionaries = {}) {
  // 0. Nested sub-mapping (recursive)
  if ("fields" in fieldDef && typeof fieldDef.fields === "object") {
    if (fieldDef.forEach !== undefined) {
      if (fieldDef.groupBy) return transformGroupBy(sourceRow, fieldDef, dictionaries);
      return transformForEach(sourceRow, fieldDef, dictionaries);
    }
    return transformOne(sourceRow, { fields: fieldDef.fields }, dictionaries);
  }

  // 1. forEach — array iteration, aggregation, or groupBy
  if (fieldDef.forEach !== undefined) {
    if (fieldDef.aggregate) return transformAggregate(sourceRow, fieldDef, dictionaries);
    if (fieldDef.groupBy)   return transformGroupBy(sourceRow, fieldDef, dictionaries);
    return transformForEach(sourceRow, fieldDef, dictionaries);
  }

  // 2. Literal / static value
  if ("value" in fieldDef) return fieldDef.value;

  // 3. Template string interpolation — {dot.path} tokens resolved from sourceRow
  if (fieldDef.template !== undefined) {
    const result = String(fieldDef.template).replace(/\{([^}]+)\}/g, (_, path) => {
      const val = resolvePath(sourceRow, path);
      return val === undefined || val === null ? "" : String(val);
    });
    return applyFormat(result, fieldDef);
  }

  // 4. Coalesce — first non-null value from a list of source fields
  if (Array.isArray(fieldDef.coalesce)) {
    const found = fieldDef.coalesce
      .map(path => resolvePath(sourceRow, path))
      .find(v => v !== undefined && v !== null);
    const result = found !== undefined ? found : (fieldDef.default ?? null);
    return applyFormat(result, fieldDef);
  }

  // 5. Conditional (if / elseIf / else)
  if (fieldDef.if) {
    let branch;
    let map;

    if (evaluateCondition(sourceRow, fieldDef.if)) {
      branch = fieldDef.then;
      map    = fieldDef.thenMap;
    } else if (Array.isArray(fieldDef.elseIf)) {
      const matched = fieldDef.elseIf.find(c => evaluateCondition(sourceRow, c.if));
      branch = matched !== undefined ? matched.then : fieldDef.else;
      map    = matched === undefined ? fieldDef.elseMap : undefined;
    } else {
      branch = fieldDef.else;
      map    = fieldDef.elseMap;
    }

    // If the branch is a field definition object, resolve it recursively
    let result;
    if (branch !== null && branch !== undefined && typeof branch === "object" && !Array.isArray(branch)) {
      result = transformField(sourceRow, branch, dictionaries);
    } else {
      result = branch;
    }

    if (typeof map === "object" && result !== undefined && result !== null) {
      return map[result] ?? result;
    }
    return result;
  }

  // 6. Custom compute function
  if (typeof fieldDef.compute === "function") {
    const fromPaths = Array.isArray(fieldDef.from) ? fieldDef.from : [fieldDef.from];
    const values = fromPaths.map(f => resolvePath(sourceRow, f));
    return fieldDef.compute(...values, sourceRow, dictionaries);
  }

  // 7. Field mapping (rename / map / format)
  const sourcePath = fieldDef.from;
  if (!sourcePath) return undefined;

  // Determine the lookup key (from source field or explicit lookupKey)
  let lookupKey = fieldDef.lookupKey
    ? resolvePath(sourceRow, fieldDef.lookupKey)
    : Array.isArray(sourcePath)
      ? sourcePath.map(p => resolvePath(sourceRow, p))
      : resolvePath(sourceRow, sourcePath);

  let result = lookupKey;

  // 7a. Dictionary lookup
  if (fieldDef.lookup) {
    const dict = dictionaries[fieldDef.lookup];
    if (dict !== undefined) {
      if (result !== undefined && result !== null) {
        const key = String(result);
        const entry = dict[key];
        // If lookupPath is set, drill into the dictionary entry
        if (fieldDef.lookupPath && entry !== undefined) {
          result = resolvePath(entry, fieldDef.lookupPath);
        } else {
          result = entry;
        }
      }
    }
  }

  // 7b. Default value fallback
  if (result === undefined || result === null) {
    result = fieldDef.default;
  }

  // 7c. Apply value map
  if (typeof fieldDef.map === "object" && result !== undefined && result !== null) {
    result = fieldDef.map[result] ?? result;
  }

  // 7d. Apply format
  return applyFormat(result, fieldDef);
}

/**
 * Shared pre-processing for forEach-based fields.
 * Pipeline: get source array → flatten → filter → distinct → sortBy
 */
function prepareSourceArray(sourceRow, fieldDef) {
  let arr = resolvePath(sourceRow, fieldDef.forEach);
  if (!Array.isArray(arr)) return [];

  // Flatten: for each item in the source array, extract a sub-array and
  // concatenate all of them into a single flat list.
  if (fieldDef.flatten) {
    arr = arr.flatMap(item => {
      const sub = resolvePath(item, fieldDef.flatten);
      return Array.isArray(sub) ? sub : [];
    });
  }

  if (fieldDef.filter) {
    arr = arr.filter(item => evaluateCondition(item, fieldDef.filter));
  }

  if (fieldDef.distinct) {
    const seen = new Set();
    arr = arr.filter(item => {
      const key = String(resolvePath(item, fieldDef.distinct) ?? "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  if (fieldDef.sortBy) {
    const sortField = typeof fieldDef.sortBy === "string" ? fieldDef.sortBy : fieldDef.sortBy.field;
    const desc = typeof fieldDef.sortBy === "object" && fieldDef.sortBy.order === "desc";
    arr = [...arr].sort((a, b) => {
      const va = resolvePath(a, sortField);
      const vb = resolvePath(b, sortField);
      if (va === vb) return 0;
      const cmp = va < vb ? -1 : 1;
      return desc ? -cmp : cmp;
    });
  }

  return arr;
}

function transformForEach(sourceRow, fieldDef, dictionaries) {
  const arr = prepareSourceArray(sourceRow, fieldDef);
  const subMapping = { fields: fieldDef.fields };
  return arr.map(item => transformOne(item, subMapping, dictionaries));
}

function transformGroupBy(sourceRow, fieldDef, dictionaries) {
  const arr = prepareSourceArray(sourceRow, fieldDef);

  // Partition items into groups keyed by the groupBy field value
  const groups = {};
  for (const item of arr) {
    const key = String(resolvePath(item, fieldDef.groupBy) ?? "");
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  // Transform each item within its group if a fields block is provided
  if (!fieldDef.fields) return groups;

  const subMapping = { fields: fieldDef.fields };
  const result = {};
  for (const [key, items] of Object.entries(groups)) {
    result[key] = items.map(item => transformOne(item, subMapping, dictionaries));
  }
  return result;
}

function transformAggregate(sourceRow, fieldDef, dictionaries) {
  // Check the raw source before any preprocessing so missing/empty returns early
  const raw = resolvePath(sourceRow, fieldDef.forEach);
  if (!Array.isArray(raw) || raw.length === 0) {
    return fieldDef.aggregate === "count" ? 0 : (fieldDef.default ?? null);
  }

  const sourceArray = prepareSourceArray(sourceRow, fieldDef);

  if (sourceArray.length === 0) {
    return fieldDef.aggregate === "count" ? 0 : (fieldDef.default ?? null);
  }

  if (fieldDef.aggregate === "count") {
    return sourceArray.length;
  }

  // Compute a value for each item — via compute function or raw field path
  let perItemValues;
  if (typeof fieldDef.compute === "function") {
    const fromPaths = fieldDef.from
      ? (Array.isArray(fieldDef.from) ? fieldDef.from : [fieldDef.from])
      : [];
    perItemValues = sourceArray.map(item => {
      const args = fromPaths.map(p => resolvePath(item, p));
      return fieldDef.compute(...args, item, dictionaries);
    });
  } else if (fieldDef.from) {
    perItemValues = sourceArray.map(item => resolvePath(item, fieldDef.from));
  } else {
    return fieldDef.default ?? null;
  }

  const numbers = perItemValues.map(Number).filter(n => !isNaN(n));
  if (numbers.length === 0) return fieldDef.default ?? null;

  let result;
  switch (fieldDef.aggregate) {
    case "sum": result = numbers.reduce((a, b) => a + b, 0); break;
    case "min": result = Math.min(...numbers); break;
    case "max": result = Math.max(...numbers); break;
    case "avg": result = numbers.reduce((a, b) => a + b, 0) / numbers.length; break;
    default: return undefined;
  }

  // Strip JavaScript floating-point noise (e.g. 112.49000000000001 → 112.49)
  if (typeof result === "number" && (fieldDef.aggregate === "sum" || fieldDef.aggregate === "avg")) {
    result = Math.round(result * 1e10) / 1e10;
  }

  return applyFormat(result, fieldDef);
}

/**
 * Transform a single source object.
 */
export function transformOne(sourceRow, mapping, dictionaries = {}) {
  const dicts = mapping.dictionaries || dictionaries;
  const result = {};

  // Passthrough: copy source fields as a baseline before applying field definitions
  if (mapping.passthrough) {
    const pt = mapping.passthrough;
    if (typeof pt === "object" && Array.isArray(pt.include)) {
      // Allowlist — copy only the listed fields
      const includeSet = new Set(pt.include);
      for (const key of includeSet) {
        if (Object.prototype.hasOwnProperty.call(sourceRow, key)) {
          result[key] = sourceRow[key];
        }
      }
    } else {
      // Copy all fields, minus any exclusions
      const exclude = typeof pt === "object" && Array.isArray(pt.exclude)
        ? new Set(pt.exclude)
        : new Set();
      for (const [key, val] of Object.entries(sourceRow)) {
        if (!exclude.has(key)) result[key] = val;
      }
    }
  }

  for (const [targetKey, fieldDef] of Object.entries(mapping.fields)) {
    let value;
    try {
      value = transformField(sourceRow, fieldDef, dicts);
    } catch (e) {
      throw new Error(`field "${targetKey}": ${e.message}`, { cause: e });
    }
    if (targetKey.includes(".")) {
      setPath(result, targetKey, value);
    } else {
      result[targetKey] = value;
    }
  }
  return result;
}

// ── Schema validation ────────────────────────────────────────────────

/**
 * Validate a single source row against a schema definition.
 * Returns an array of { row, field, message } error objects.
 */
function validateRow(sourceRow, schema, rowIndex) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = resolvePath(sourceRow, field);
    const missing = value === undefined || value === null;

    if (rules.required && missing) {
      errors.push({ row: rowIndex, field, message: "required field is missing" });
      continue; // no point checking further rules if value is absent
    }

    if (missing) continue;

    if (rules.type) {
      if (rules.type === "date") {
        if (!isValidIsoDate(value)) {
          errors.push({ row: rowIndex, field, message: `expected type "date" (valid ISO-8601), got "${value}"` });
        }
      } else {
        const actual = Array.isArray(value) ? "array" : typeof value;
        if (actual !== rules.type) {
          errors.push({ row: rowIndex, field, message: `expected type "${rules.type}", got "${actual}"` });
        }
      }
    }

    if (rules.min !== undefined && Number(value) < rules.min) {
      errors.push({ row: rowIndex, field, message: `value ${value} is below minimum ${rules.min}` });
    }
    if (rules.max !== undefined && Number(value) > rules.max) {
      errors.push({ row: rowIndex, field, message: `value ${value} exceeds maximum ${rules.max}` });
    }

    if (rules.minLength !== undefined && value.length < rules.minLength) {
      errors.push({ row: rowIndex, field, message: `length ${value.length} is below minimum length ${rules.minLength}` });
    }
    if (rules.maxLength !== undefined && value.length > rules.maxLength) {
      errors.push({ row: rowIndex, field, message: `length ${value.length} exceeds maximum length ${rules.maxLength}` });
    }

    if (rules.pattern) {
      try {
        if (!new RegExp(rules.pattern).test(String(value))) {
          errors.push({ row: rowIndex, field, message: `value does not match pattern "${rules.pattern}"` });
        }
      } catch {
        errors.push({ row: rowIndex, field, message: `invalid pattern "${rules.pattern}"` });
      }
    }

    if (typeof rules.validate === "function") {
      const outcome = rules.validate(value, sourceRow);
      if (outcome !== true) {
        errors.push({ row: rowIndex, field, message: typeof outcome === "string" ? outcome : "validation failed" });
      }
    }
  }

  return errors;
}

/**
 * Validate an array of source objects against a mapping's schema.
 * Returns { valid, errors } without transforming any data.
 * errors is [] and valid is true when all rows pass.
 */
export function validate(source, mapping) {
  if (!mapping.schema) return { valid: true, errors: [] };

  const errors = source.flatMap((row, i) => validateRow(row, mapping.schema, i));
  return { valid: errors.length === 0, errors };
}

/**
 * Transform an array of source objects.
 * Returns Array<Object>. Schema is not checked — call validate() first if needed.
 */
export function transform(source, mapping, dictionaries = {}) {
  return source.map((row, i) => {
    try {
      return transformOne(row, mapping, dictionaries);
    } catch (e) {
      throw new Error(`row ${i}: ${e.message}`, { cause: e });
    }
  });
}
