/**
 * json-xslt — Lightweight declarative JSON transformation engine
 *
 * Usage:
 *   import { transform } from './transform.js';
 *   import mapping from './my-mapping.js';
 *   const result = transform(sourceData, mapping);
 *
 * Supports nested source paths ("address.city") and nested target blocks.
 */

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
    // Support numeric index into arrays
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
    // If the next key looks like an array index, create an array
    if (!cursor[key] || typeof cursor[key] !== "object") {
      cursor[key] = /^\d+$/.test(next) ? [] : {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

// ── Date helpers ─────────────────────────────────────────────────────

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDate(dateValue, outputFormat) {
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return dateValue;

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

// ── Condition evaluation ─────────────────────────────────────────────

function evaluateCondition(sourceRow, condition) {
  // ── Composable logic ────────────────────────────────────────────
  if (condition.and) {
    return Array.isArray(condition.and) && condition.and.every(c => evaluateCondition(sourceRow, c));
  }
  if (condition.or) {
    return Array.isArray(condition.or) && condition.or.some(c => evaluateCondition(sourceRow, c));
  }
  if (condition.not) {
    return !evaluateCondition(sourceRow, condition.not);
  }

  // ── Leaf condition ──────────────────────────────────────────────
  const { field, op, value } = condition;

  // Support dot-path in condition field
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

function transformField(sourceRow, fieldDef) {
  // 0. Nested sub-mapping (recursive)
  if ("fields" in fieldDef && typeof fieldDef.fields === "object") {
    // Check if this is also a forEach
    if (fieldDef.forEach !== undefined) {
      return transformForEach(sourceRow, fieldDef);
    }
    return transformOne(sourceRow, { fields: fieldDef.fields });
  }

  // 1. forEach — array iteration
  if (fieldDef.forEach !== undefined) {
    return transformForEach(sourceRow, fieldDef);
  }

  // 2. Literal / static value
  if ("value" in fieldDef) return fieldDef.value;

  // 3. Conditional (if / then / else)
  if (fieldDef.if) {
    const passes = evaluateCondition(sourceRow, fieldDef.if);
    const result = passes ? fieldDef.then : fieldDef.else;
    if (passes && typeof fieldDef.thenMap === "object" && result !== undefined && result !== null) {
      return fieldDef.thenMap[result] ?? result;
    }
    if (!passes && typeof fieldDef.elseMap === "object" && result !== undefined && result !== null) {
      return fieldDef.elseMap[result] ?? result;
    }
    return result;
  }

  // 4. Custom compute function
  if (typeof fieldDef.compute === "function") {
    const fromPaths = Array.isArray(fieldDef.from) ? fieldDef.from : [fieldDef.from];
    const values = fromPaths.map(f => resolvePath(sourceRow, f));
    return fieldDef.compute(...values, sourceRow);
  }

  // 5. Field mapping (rename / map / format)
  const sourcePath = fieldDef.from;
  if (!sourcePath) return undefined;

  const rawValue = Array.isArray(sourcePath)
    ? sourcePath.map(p => resolvePath(sourceRow, p))
    : resolvePath(sourceRow, sourcePath);

  let result = rawValue;

  // Apply value map
  if (typeof fieldDef.map === "object" && result !== undefined && result !== null) {
    result = fieldDef.map[result] ?? result;
  }

  // Apply format (null-safe)
  if (fieldDef.format) {
    if (result === undefined || result === null) {
      return null;  // propagate null through formats
    }
    switch (fieldDef.format) {
      case "date":
        result = formatDate(result, fieldDef.outputFormat || "YYYY-MM-DD");
        break;
      case "lowercase":
        result = String(result).toLowerCase();
        break;
      case "uppercase":
        result = String(result).toUpperCase();
        break;
      case "trim":
        result = String(result).trim();
        break;
      case "number":
        result = Number(result);
        break;
      case "string":
        result = String(result);
        break;
      case "boolean":
        result = Boolean(result);
        break;
      case "negate":
        result = !result;
        break;
      default:
        break;
    }
  }

  return result;
}

/**
 * Handle forEach: iterate over a source array, transform each item.
 *
 * {
 *   forEach: "LineItems",
 *   fields: {
 *     product: { from: "ProductSKU" },
 *     qty: { from: "Quantity", format: "number" },
 *   }
 * }
 */
function transformForEach(sourceRow, fieldDef) {
  const sourceArray = resolvePath(sourceRow, fieldDef.forEach);
  if (!Array.isArray(sourceArray)) return [];

  const subMapping = { fields: fieldDef.fields };
  return sourceArray.map(item => transformOne(item, subMapping));
}

/**
 * Transform a single source object.
 * Supports dot-path target keys:
 *   "contact.email" → { contact: { email: ... } }
 */
export function transformOne(sourceRow, mapping) {
  const result = {};
  for (const [targetKey, fieldDef] of Object.entries(mapping.fields)) {
    const value = transformField(sourceRow, fieldDef);
    if (targetKey.includes(".")) {
      setPath(result, targetKey, value);
    } else {
      result[targetKey] = value;
    }
  }
  return result;
}

/**
 * Transform an array of source objects.
 * @param {Array<Object>} source  — input JSON array
 * @param {Object} mapping        — mapping definition
 * @returns {Array<Object>}       — transformed array
 */
export function transform(source, mapping) {
  return source.map(row => transformOne(row, mapping));
}
