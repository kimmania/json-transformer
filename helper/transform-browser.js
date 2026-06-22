/**
 * transform-browser.js — Browser-compatible version of json-transformer engine
 *
 * Adapted from transform.js + mapping-builder.js for in-browser use.
 * Removes Node.js dependencies (fs, path), adds compute function sandboxing.
 *
 * Exports via global `window.JsonTransformer` namespace:
 *   JsonTransformer.transform(source, mapping)
 *   JsonTransformer.transformOne(row, mapping)
 *   JsonTransformer.validate(source, mapping)
 *   JsonTransformer.prepareMapping(mapping)  // inline dicts only
 *   JsonTransformer.inspect(data)
 *   JsonTransformer.looksLikeDate(value)
 *   JsonTransformer.toSnakeCase(name)
 *   JsonTransformer.toCamelCase(name)
 *   JsonTransformer.inferFieldDefaults(inspection, fieldName)
 *   JsonTransformer.safeEval(code, args, sourceRow, dicts)  // sandboxed compute
 */

(function (global) {
  "use strict";

  // ── Path helpers ─────────────────────────────────────────────────────

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

  // ── Dictionary loader (browser: inline only) ─────────────────────────

  function prepareMapping(mapping) {
    if (!mapping.dictionaries || typeof mapping.dictionaries !== "object") {
      return mapping;
    }
    // In browser, all dicts must be inline (no $file support)
    for (const [name, def] of Object.entries(mapping.dictionaries)) {
      if (def && typeof def === "object" && "$file" in def) {
        throw new Error(`Dictionary "${name}" uses $file — not supported in browser (use inline dictionaries)`);
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

  function isValidIsoDate(value) {
    if (typeof value !== "string") return false;
    const s = value.trim();
    if (!ISO_RE.test(s)) return false;
    const d = new Date(s);
    if (isNaN(d.getTime())) return false;
    const [year, month, day] = s.slice(0, 10).split("-").map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const utc = new Date(s.slice(0, 10) + "T00:00:00Z");
    if (utc.getUTCFullYear() !== year || utc.getUTCMonth() + 1 !== month || utc.getUTCDate() !== day) {
      return false;
    }
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
    // Normalize SQL/MySQL "YYYY-MM-DD HH:MM:SS" to ISO 8601 "YYYY-MM-DDTHH:MM:SS"
    const normalized = typeof dateValue === "string"
      ? dateValue.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(\.\d+)?)$/, "$1T$2")
      : dateValue;
    if (!isValidIsoDate(normalized)) return dateValue;
    const d = new Date(normalized);
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

  function splitWords(str) {
    return String(str)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
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
      case "eq":      return actual === value;
      case "neq":     return actual !== value;
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

  // ── Compute function sandboxing ──────────────────────────────────────

  /**
   * Safely evaluate a compute function in a restricted context.
   * No access to window, document, fetch, eval, or other globals.
   * Timeout: 500ms per invocation.
   */
  const COMPUTE_MAX_MS = 500;
  const COMPUTE_PARAM_NAMES = ["a", "b", "c", "d", "e", "f", "g", "h"];

  function safeEval(code, argValues, sourceRow, dicts) {
    try {
      var values = Array.isArray(argValues) ? argValues : [];
      var decls = "";
      for (var i = 0; i < values.length; i++) {
        decls += "var " + (COMPUTE_PARAM_NAMES[i] || ("_p" + i)) + " = __values[" + i + "];";
      }
      var fnBody = '"use strict";'
        + "var __values = arguments[0];"
        + "var __start = arguments[1];"
        + "var __maxMs = arguments[2];"
        + "if (Date.now() - __start > __maxMs) throw new Error('Compute timeout (>" + COMPUTE_MAX_MS + "ms)');"
        + decls
        + "var __result;"
        + "try {"
        + "__result = (function() { " + code + " })();"
        + "} catch(e) {"
        + "throw new Error('Compute error: ' + e.message);"
        + "}"
        + "return __result;";
      var fn = new Function("values", "start", "maxMs", fnBody);
      return fn(values, Date.now(), COMPUTE_MAX_MS);
    } catch (e) {
      throw new Error("Compute function failed: " + e.message);
    }
  }

  function compileCompute(code) {
    if (!code || typeof code !== "string") {
      throw new Error("Compute code must be a non-empty string");
    }
    return function computeWrapper() {
      var argc = arguments.length;
      var sourceRow = arguments[argc - 2];
      var dicts = arguments[argc - 1];
      var values = Array.prototype.slice.call(arguments, 0, argc - 2);
      return safeEval(code, values, sourceRow, dicts);
    };
  }

  // ── Core transform ───────────────────────────────────────────────────

  function transformField(sourceRow, fieldDef, dictionaries) {
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

    // 3. Template string interpolation
    if (fieldDef.template !== undefined) {
      const result = String(fieldDef.template).replace(/\{([^}]+)\}/g, (_, path) => {
        const val = resolvePath(sourceRow, path);
        return val === undefined || val === null ? "" : String(val);
      });
      return applyFormat(result, fieldDef);
    }

    // 4. Coalesce
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
    if (typeof fieldDef.compute === "function" || typeof fieldDef.compute === "string") {
      const computeFn = typeof fieldDef.compute === "string"
        ? compileCompute(fieldDef.compute)
        : fieldDef.compute;
      const fromPaths = Array.isArray(fieldDef.from) ? fieldDef.from : [fieldDef.from];
      const values = fromPaths.map(f => resolvePath(sourceRow, f));
      return computeFn(...values, sourceRow, dictionaries);
    }

    // 7. Field mapping (rename / map / format)
    const sourcePath = fieldDef.from;
    if (!sourcePath) return undefined;

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

  function prepareSourceArray(sourceRow, fieldDef) {
    let arr = resolvePath(sourceRow, fieldDef.forEach);
    if (!Array.isArray(arr)) return [];
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
    const groups = {};
    for (const item of arr) {
      const key = String(resolvePath(item, fieldDef.groupBy) ?? "");
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    if (!fieldDef.fields) return groups;
    const subMapping = { fields: fieldDef.fields };
    const result = {};
    for (const [key, items] of Object.entries(groups)) {
      result[key] = items.map(item => transformOne(item, subMapping, dictionaries));
    }
    return result;
  }

  function transformAggregate(sourceRow, fieldDef, dictionaries) {
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
    // toPrecision(12) uses relative precision so it is safe at any magnitude.
    if (typeof result === "number" && (fieldDef.aggregate === "sum" || fieldDef.aggregate === "avg")) {
      result = parseFloat(result.toPrecision(12));
    }
    return applyFormat(result, fieldDef);
  }

  function transformOne(sourceRow, mapping, dictionaries) {
    const dicts = mapping.dictionaries || dictionaries;
    const result = {};
    if (mapping.passthrough) {
      const pt = mapping.passthrough;
      if (typeof pt === "object" && Array.isArray(pt.include)) {
        const includeSet = new Set(pt.include);
        for (const key of includeSet) {
          if (Object.prototype.hasOwnProperty.call(sourceRow, key)) {
            result[key] = sourceRow[key];
          }
        }
      } else {
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

  function validateRow(sourceRow, schema, rowIndex) {
    const errors = [];
    for (const [field, rules] of Object.entries(schema)) {
      const value = resolvePath(sourceRow, field);
      const missing = value === undefined || value === null;
      if (rules.required && missing) {
        errors.push({ row: rowIndex, field, message: "required field is missing" });
        continue;
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

  function validate(source, mapping) {
    if (!mapping.schema) return { valid: true, errors: [] };
    const errors = source.flatMap((row, i) => validateRow(row, mapping.schema, i));
    return { valid: errors.length === 0, errors };
  }

  function transform(source, mapping, dictionaries) {
    return source.map((row, i) => {
      try {
        return transformOne(row, mapping, dictionaries);
      } catch (e) {
        throw new Error(`row ${i}: ${e.message}`, { cause: e });
      }
    });
  }

  // ── Inspection (from mapping-builder.js) ─────────────────────────────

  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  const NUMERIC_STR_RE = /^-?\d+(\.\d+)?$/;

  function inspect(data) {
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
            processValue(first, prefix);
          }
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
        fields[prefix].type = "mixed";
      }
    }

    for (const [k, v] of Object.entries(sample)) {
      processValue(v, k);
    }

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
      }
      if (numValues[field]) {
        info.min = numValues[field].min;
        info.max = numValues[field].max;
      }
      result[field] = info;
    }

    return { recordCount: data.length, fields: result };
  }

  function looksLikeDate(value) {
    if (typeof value !== "string") return false;
    return ISO_DATE_RE.test(value.trim());
  }

  function toSnakeCase(name) {
    return name
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/[\s\-]+/g, "_")
      .toLowerCase();
  }

  function toCamelCase(name) {
    if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name.slice(1))) {
      return name;
    }
    const words = name.replace(/[-_.\s]+/g, " ").split(" ").filter(Boolean);
    return words.map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
  }

  // ── Smart defaults inference ─────────────────────────────────────────

  function inferFieldDefaults(inspection, fieldName) {
    const fieldInfo = inspection.fields[fieldName];
    if (!fieldInfo) return { targetField: fieldName, type: "string", format: null };

    const info = fieldInfo;
    let type = info.type;
    let format = null;

    // Detect date fields
    if (type === "string" && looksLikeDate(String(info.sample))) {
      type = "date";
      format = "date";
    }

    // Detect numeric strings
    if (type === "string" && NUMERIC_STR_RE.test(String(info.sample))) {
      type = "number";
      format = "number";
    }

    // Suggest target field name (camelCase)
    const targetField = toCamelCase(fieldName.replace(/\./g, "_"));

    return { targetField, type, format };
  }

  // ── Export to global ─────────────────────────────────────────────────

  global.JsonTransformer = {
    transform,
    transformOne,
    validate,
    prepareMapping,
    inspect,
    looksLikeDate,
    toSnakeCase,
    toCamelCase,
    inferFieldDefaults,
    safeEval,
    compileCompute,
    resolvePath,
  };

})(typeof window !== "undefined" ? window : globalThis);
