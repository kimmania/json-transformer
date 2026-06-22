/**
 * mapping-features.js — Mapping build/parse, compute templates, validation
 * Used by app.js (loaded before app.js in index.html)
 */
(function (global) {
  "use strict";

  var COMPUTE_PARAM_NAMES = ["a", "b", "c", "d", "e", "f", "g", "h"];

  var COMPUTE_TEMPLATES = [
    {
      id: "concat",
      label: "Concatenate two fields",
      params: ["a", "b"],
      code: 'return [a, b].filter(function(v) { return v != null && v !== ""; }).join(" ");',
      sourceHint: "Two source paths (comma-separated)",
    },
    {
      id: "concat3",
      label: "Concatenate three fields",
      params: ["a", "b", "c"],
      code: 'return [a, b, c].filter(function(v) { return v != null && v !== ""; }).join(" ");',
      sourceHint: "Three source paths (comma-separated)",
    },
    {
      id: "add",
      label: "Add numbers (a + b)",
      params: ["a", "b"],
      code: "return Number(a) + Number(b);",
      sourceHint: "Two numeric source paths",
    },
    {
      id: "subtract",
      label: "Subtract (a - b)",
      params: ["a", "b"],
      code: "return Number(a) - Number(b);",
      sourceHint: "Two numeric source paths",
    },
    {
      id: "multiply",
      label: "Multiply (a × b)",
      params: ["a", "b"],
      code: "return Number(a) * Number(b);",
      sourceHint: "Two numeric source paths",
    },
    {
      id: "divide",
      label: "Divide (a ÷ b)",
      params: ["a", "b"],
      code: "return Number(b) !== 0 ? Number(a) / Number(b) : null;",
      sourceHint: "Two numeric source paths",
    },
    {
      id: "round",
      label: "Round number",
      params: ["a"],
      code: "return Math.round(Number(a) * 100) / 100;",
      sourceHint: "One numeric source path",
    },
    {
      id: "length",
      label: "String length",
      params: ["a"],
      code: 'return a == null ? 0 : String(a).length;',
      sourceHint: "One source path",
    },
    {
      id: "custom",
      label: "Custom expression",
      params: COMPUTE_PARAM_NAMES,
      code: "return a;",
      sourceHint: "Use parameters a, b, c… in your return statement",
    },
  ];

  var DATE_OUTPUT_PRESETS = [
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
    { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
    { value: "MMMM DD, YYYY", label: "MMMM DD, YYYY" },
    { value: "MM/DD/YYYY hh:mm AMPM", label: "MM/DD/YYYY hh:mm AMPM" },
    { value: "MMMM", label: "Month name (MMMM)" },
    { value: "YYYY", label: "Year (YYYY)" },
  ];

  var NUMBER_FORMAT_OPTIONS = [
    { value: "plain", label: "Plain number" },
    { value: "integer", label: "Integer (0 decimals)" },
    { value: "decimal2", label: "2 decimal places" },
    { value: "decimal4", label: "4 decimal places" },
  ];

  function numberFormatUiValue(field) {
    if (!field) return "plain";
    if (field.format === "round") {
      if (field.precision === 0 || field.precision === "0") return "integer";
      if (field.precision === 2 || field.precision === "2") return "decimal2";
      if (field.precision === 4 || field.precision === "4") return "decimal4";
      return "decimal2";
    }
    if (field.format === "number") return "plain";
    return "plain";
  }

  function applyNumberFormatUi(uiValue) {
    switch (uiValue) {
      case "integer":
        return { format: "round", precision: 0 };
      case "decimal2":
        return { format: "round", precision: 2 };
      case "decimal4":
        return { format: "round", precision: 4 };
      default:
        return { format: "number", precision: "" };
    }
  }

  function dateOutputPresetValue(outputFormat) {
    if (!outputFormat) return "YYYY-MM-DD";
    var found = DATE_OUTPUT_PRESETS.some(function (p) { return p.value === outputFormat; });
    return found ? outputFormat : "__custom__";
  }

  function defaultVisualField(overrides) {
    return Object.assign({
      target: "",
      source: "",
      type: "auto",
      format: "",
      outputFormat: "",
      precision: "",
      default: "",
      kind: "simple",
      sourceMode: "path",
      template: "",
      coalesce: "",
      mapPairs: "",
      mapEntries: [],
      forEachPath: "",
      nestedFields: [],
      computeTemplate: "concat",
      computeSources: "",
      computeCode: COMPUTE_TEMPLATES[0].code,
      advancedSummary: "",
      advancedDefJson: "",
    }, overrides || {});
  }

  function serializeFieldDefForDisplay(def) {
    return JSON.stringify(def, function (_key, val) {
      if (typeof val === "function") return "[Function]";
      return val;
    }, 2);
  }

  function describeFieldDef(def) {
    if (!def || typeof def !== "object") return "advanced field";
    if (def.if !== undefined) {
      return "if / then / else" + (def.elseIf ? " (+ elseIf)" : "");
    }
    if (def.template !== undefined) return "template: " + String(def.template).slice(0, 60);
    if ("value" in def) return "static value: " + JSON.stringify(def.value);
    if (typeof def.compute === "string") return "compute: " + def.compute.slice(0, 80);
    if (typeof def.compute === "function") return "compute function";
    if (def.groupBy) return "groupBy on " + def.forEach;
    if (def.flatten) return "flatten " + def.forEach;
    if (def.forEach !== undefined) return "forEach on " + def.forEach;
    return "advanced field";
  }

  function readonlyVisualFieldFromDef(target, def, kind) {
    return defaultVisualField({
      target: target,
      kind: kind,
      advancedSummary: describeFieldDef(def),
      advancedDefJson: serializeFieldDefForDisplay(def),
    });
  }

  function parseMapPairs(text) {
    if (!text || !String(text).trim()) return null;
    var map = {};
    String(text).split(",").forEach(function (pair) {
      var idx = pair.indexOf(":");
      if (idx < 0) return;
      var k = pair.slice(0, idx).trim();
      var v = pair.slice(idx + 1).trim();
      if (k) map[k] = v;
    });
    return Object.keys(map).length ? map : null;
  }

  function mapObjectToEntries(map) {
    if (!map || typeof map !== "object") return [];
    return Object.keys(map).map(function (k) {
      return { key: k, value: map[k] != null ? String(map[k]) : "" };
    });
  }

  function mapEntriesToObject(entries) {
    if (!entries || !entries.length) return null;
    var map = {};
    entries.forEach(function (entry) {
      if (!entry || entry.key == null) return;
      var key = String(entry.key).trim();
      if (!key) return;
      map[key] = entry.value != null ? String(entry.value) : "";
    });
    return Object.keys(map).length ? map : null;
  }

  function normalizeMapEntries(field) {
    if (!field) return [];
    if (field.mapEntries && field.mapEntries.length) {
      return field.mapEntries.map(function (entry) {
        return {
          key: entry.key != null ? String(entry.key) : "",
          value: entry.value != null ? String(entry.value) : "",
        };
      });
    }
    var parsed = parseMapPairs(field.mapPairs);
    return parsed ? mapObjectToEntries(parsed) : [];
  }

  function collectDistinctValuesForPath(data, path, inspection, max) {
    max = max || 50;
    if (inspection && inspection.fields && inspection.fields[path] && inspection.fields[path].distinctValues) {
      return inspection.fields[path].distinctValues.slice(0, max);
    }
    if (!data || !path) return [];
    var JT = global.JsonTransformer;
    if (!JT) return [];
    var values = [];
    var seen = {};
    var records = Array.isArray(data) ? data : [data];
    for (var i = 0; i < records.length && values.length < max; i++) {
      var v = JT.resolvePath(records[i], path);
      if (v === undefined || v === null) continue;
      if (typeof v === "object") continue;
      var s = String(v);
      if (!seen[s]) {
        seen[s] = true;
        values.push(s);
      }
    }
    return values;
  }

  function parseCoalesce(text) {
    if (!text || !String(text).trim()) return null;
    return String(text).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function coalescePathsToText(paths) {
    if (!paths || !paths.length) return "";
    return paths.map(function (p) { return String(p).trim(); }).filter(Boolean).join(", ");
  }

  function validateComputeExpression(code) {
    if (!code || !String(code).trim()) return null;
    try {
      makeComputeFn(code);
      return null;
    } catch (e) {
      return e && e.message ? e.message : String(e);
    }
  }

  function computeParamLabels(sourcesText) {
    var paths = parseSourceList(sourcesText);
    var count = paths.length || 1;
    return COMPUTE_PARAM_NAMES.slice(0, Math.min(count, COMPUTE_PARAM_NAMES.length));
  }

  function parseSourceList(text) {
    if (!text || !String(text).trim()) return [];
    return String(text).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function makeComputeFn(code) {
    if (!global.JsonTransformer || !global.JsonTransformer.compileCompute) {
      return function () {
        throw new Error("Compute engine not available");
      };
    }
    return global.JsonTransformer.compileCompute(code);
  }

  function visualFieldUsesTemplate(f) {
    if (!f) return false;
    if (f.sourceMode === "template") return true;
    return !!(f.template && String(f.template).trim());
  }

  function extractTemplateFields(template) {
    if (!template) return [];
    var re = /\{([^}]+)\}/g;
    var out = [];
    var match;
    while ((match = re.exec(String(template))) !== null) {
      var path = String(match[1]).trim();
      if (path && out.indexOf(path) < 0) out.push(path);
    }
    return out;
  }

  function buildSimpleFieldDef(f) {
    var fieldDef = {};
    if (visualFieldUsesTemplate(f)) {
      fieldDef.template = String(f.template).trim();
    }
    if (f.source && String(f.source).trim() && !visualFieldUsesTemplate(f)) {
      fieldDef.from = f.source;
    }
    if (f.type && f.type !== "auto") fieldDef.type = f.type;
    if (f.format) fieldDef.format = f.format;
    if (f.outputFormat) fieldDef.outputFormat = f.outputFormat;
    if (f.precision !== "" && f.precision != null && !isNaN(Number(f.precision))) {
      fieldDef.precision = Number(f.precision);
    }
    if (f.default !== undefined && f.default !== "") fieldDef.default = f.default;
    if (f.value !== undefined && f.value !== "") fieldDef.value = f.value;
    var coalesce = parseCoalesce(f.coalesce);
    if (coalesce && coalesce.length) fieldDef.coalesce = coalesce;
    var map = mapEntriesToObject(normalizeMapEntries(f));
    if (!map) map = parseMapPairs(f.mapPairs);
    if (map) fieldDef.map = map;
    return fieldDef;
  }

  function fieldDefIsAdvanced(def) {
    if (!def || typeof def !== "object") return false;
    if (def.if || def.and || def.or || def.not) return true;
    if ("value" in def && def.from === undefined && def.template === undefined && !def.coalesce) return true;
    if (def.groupBy || def.flatten || def.filter || def.distinct || def.sortBy) return true;
    if (typeof def.compute === "function" || typeof def.compute === "string") return true;
    if (def.fields) {
      return Object.keys(def.fields).some(function (k) {
        return fieldDefIsAdvanced(def.fields[k]);
      });
    }
    return false;
  }

  function mappingRequiresCodeEditor(mapping) {
    if (!mapping || typeof mapping !== "object") return false;
    if (mapping.schema || mapping.dictionaries) return true;
    if (mapping.passthrough && typeof mapping.passthrough === "object") return true;
    if (!mapping.fields || typeof mapping.fields !== "object") return false;
    return Object.keys(mapping.fields).some(function (k) {
      return fieldDefIsAdvanced(mapping.fields[k]);
    });
  }

  function stripModuleWrapper(text) {
    var clean = String(text).trim();
    clean = clean.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "");
    clean = clean.replace(/^export\s+default\s+/m, "").trim();
    if (clean.endsWith(";")) clean = clean.slice(0, -1);
    return clean;
  }

  function parseMappingModule(text) {
    var clean = stripModuleWrapper(text);
    return new Function("return (" + clean + ")")();
  }

  function extractMappingMeta(mapping) {
    if (!mapping || typeof mapping !== "object") return {};
    return {
      id: mapping.id,
      version: mapping.version,
      passthrough: mapping.passthrough,
      schema: mapping.schema,
      dictionaries: mapping.dictionaries,
    };
  }

  function applyMappingMeta(mapping, meta) {
    if (!mapping || !meta) return mapping;
    if (meta.id) mapping.id = meta.id;
    if (meta.version) mapping.version = meta.version;
    if (meta.schema) mapping.schema = meta.schema;
    if (meta.dictionaries) mapping.dictionaries = meta.dictionaries;
    if (meta.passthrough !== undefined && meta.passthrough !== null) {
      mapping.passthrough = meta.passthrough;
    }
    return mapping;
  }

  function buildFullMapping(fields, options) {
    var mapping = buildMappingFromVisualFields(fields, options);
    return applyMappingMeta(mapping, options && options.meta);
  }

  function passthroughToBool(passthrough) {
    if (passthrough === true) return true;
    if (passthrough && typeof passthrough === "object") return true;
    return false;
  }

  function buildNestedFieldsDef(nestedFields) {
    var sub = {};
    (nestedFields || []).forEach(function (sf) {
      if (!sf.target) return;
      sub[sf.target] = visualFieldToDef(sf);
    });
    return sub;
  }

  function visualFieldToDef(f) {
    if (!f || !f.target) return null;

    if (f.kind === "forEach") {
      var path = f.forEachPath || f.source;
      if (!path) return null;
      var fe = {
        forEach: path,
        fields: buildNestedFieldsDef(f.nestedFields),
      };
      if (f.groupBy) fe.groupBy = f.groupBy;
      if (f.flatten) fe.flatten = f.flatten;
      return fe;
    }

    if (f.kind === "nested") {
      return { fields: buildNestedFieldsDef(f.nestedFields) };
    }

    if (f.kind === "compute") {
      var paths = parseSourceList(f.computeSources || f.source);
      if (!paths.length) return null;
      var code = f.computeCode || "return a;";
      var fieldDef = {
        from: paths.length === 1 ? paths[0] : paths,
        compute: makeComputeFn(code),
      };
      if (f.format) fieldDef.format = f.format;
      return fieldDef;
    }

    if (!f.source && !parseCoalesce(f.coalesce) && !visualFieldUsesTemplate(f)) return null;
    return buildSimpleFieldDef(f);
  }

  function defToVisualField(target, def) {
    if (!def || typeof def !== "object") return defaultVisualField({ target: target });

    if (def.forEach !== undefined && def.fields) {
      var nested = [];
      Object.keys(def.fields).forEach(function (k) {
        nested.push(defToVisualField(k, def.fields[k]));
      });
      return defaultVisualField({
        target: target,
        kind: "forEach",
        forEachPath: def.forEach,
        source: def.forEach,
        groupBy: def.groupBy || "",
        flatten: def.flatten || "",
        nestedFields: nested,
      });
    }

    if (def.fields && !def.from && !def.forEach) {
      var nestedObj = [];
      Object.keys(def.fields).forEach(function (k) {
        nestedObj.push(defToVisualField(k, def.fields[k]));
      });
      return defaultVisualField({
        target: target,
        kind: "nested",
        nestedFields: nestedObj,
      });
    }

    if (def.if !== undefined) {
      return readonlyVisualFieldFromDef(target, def, "condition");
    }

    if ("value" in def && !def.from && !def.coalesce && def.template === undefined) {
      return readonlyVisualFieldFromDef(target, def, "static");
    }

    if (typeof def.compute === "function") {
      return defaultVisualField({
        target: target,
        kind: "compute",
        source: Array.isArray(def.from) ? def.from.join(", ") : (def.from || ""),
        computeSources: Array.isArray(def.from) ? def.from.join(", ") : (def.from || ""),
        computeTemplate: "custom",
        computeCode: "return a;",
        format: def.format || "",
        advancedSummary: "compute function (edit in JS mode to change logic)",
      });
    }

    if (typeof def.compute === "string") {
      return defaultVisualField({
        target: target,
        kind: "compute",
        source: Array.isArray(def.from) ? def.from.join(", ") : (def.from || ""),
        computeSources: Array.isArray(def.from) ? def.from.join(", ") : (def.from || ""),
        computeTemplate: "custom",
        computeCode: def.compute,
        format: def.format || "",
        advancedSummary: "compute expression",
        advancedDefJson: serializeFieldDefForDisplay(def),
      });
    }

    if (def.groupBy || def.flatten || def.filter || def.distinct || def.sortBy) {
      return readonlyVisualFieldFromDef(target, def, "advanced");
    }

    if (fieldDefIsAdvanced(def)) {
      return readonlyVisualFieldFromDef(target, def, "advanced");
    }

    var vf = defaultVisualField({
      target: target,
      kind: "simple",
      sourceMode: def.template !== undefined && !def.from ? "template" : "path",
      source: Array.isArray(def.from) ? def.from[0] : (def.from || ""),
      type: def.type || "auto",
      format: def.format || "",
      outputFormat: def.outputFormat || "",
      precision: def.precision != null ? def.precision : "",
      default: def.default != null ? String(def.default) : "",
      template: def.template != null ? String(def.template) : "",
      value: "value" in def ? String(def.value) : "",
    });
    if (Array.isArray(def.coalesce)) vf.coalesce = def.coalesce.join(", ");
    if (def.map && typeof def.map === "object") {
      vf.mapEntries = mapObjectToEntries(def.map);
    }
    return vf;
  }

  function buildMappingFromVisualFields(fields, options) {
    options = options || {};
    var out = {};
    (fields || []).forEach(function (f) {
      if (!f.target || f.kind === "advanced" || f.kind === "condition" || f.kind === "static") return;
      var def = visualFieldToDef(f);
      if (def) out[f.target] = def;
    });
    var mapping = { fields: out };
    if (options.passthrough === true) mapping.passthrough = true;
    return applyMappingMeta(mapping, options.meta);
  }

  function mergeVisualFieldsIntoMapping(visualFields, baseMapping, options) {
    options = options || {};
    var baseFields = (baseMapping && baseMapping.fields) ? baseMapping.fields : {};
    var mergedFields = {};
    var readonlyKinds = { advanced: true, condition: true, static: true };

    (visualFields || []).forEach(function (f) {
      if (!f.target) return;
      if (readonlyKinds[f.kind]) {
        if (baseFields[f.target]) mergedFields[f.target] = baseFields[f.target];
        return;
      }
      var def = visualFieldToDef(f);
      if (def) mergedFields[f.target] = def;
    });

    var mapping = { fields: mergedFields };
    if (options.passthrough === true) {
      mapping.passthrough = true;
    } else if (baseMapping && baseMapping.passthrough !== undefined) {
      mapping.passthrough = baseMapping.passthrough;
    }
    return applyMappingMeta(mapping, options.meta || extractMappingMeta(baseMapping));
  }

  function formatMappingAsModule(mapping, asJsModule) {
    var body = JSON.stringify(mapping, null, 2);
    return asJsModule ? ("export default " + body + ";") : body;
  }

  function mappingFromCodeText(text, mode) {
    if (mode === "json") return JSON.parse(text);
    return parseMappingModule(text);
  }

  function visualFieldsFromMapping(mapping) {
    if (!mapping || !mapping.fields) return [];
    var list = [];
    Object.keys(mapping.fields).forEach(function (target) {
      list.push(defToVisualField(target, mapping.fields[target]));
    });
    return list;
  }

  function fieldSummaryKind(def) {
    if (!def || typeof def !== "object") return "unknown";
    if (fieldDefIsAdvanced(def)) return "advanced";
    if (def.forEach !== undefined) return "forEach";
    if (def.fields && !def.from) return "nested";
    if (typeof def.compute === "function" || typeof def.compute === "string") return "compute";
    if (def.if) return "condition";
    return "simple";
  }

  function fieldSummaryFromMapping(mapping) {
    if (!mapping || !mapping.fields) return [];
    return Object.keys(mapping.fields).map(function (target) {
      var def = mapping.fields[target];
      return {
        target: target,
        kind: fieldSummaryKind(def),
        label: fieldSummaryKind(def) === "advanced" || def.if
          ? "condition / advanced"
          : def.from
            ? (Array.isArray(def.from) ? def.from.join(", ") : String(def.from))
            : "",
      };
    });
  }

  function pathExistsInData(data, path) {
    if (!data || !path) return false;
    var JT = global.JsonTransformer;
    if (!JT || !JT.resolvePath) return true;
    var records = Array.isArray(data) ? data : [data];
    return records.some(function (row) {
      return JT.resolvePath(row, path) !== undefined;
    });
  }

  function validateVisualFields(fields, sourceData) {
    var errors = [];
    (fields || []).forEach(function (f, i) {
      if (!f.target || !String(f.target).trim()) {
        errors.push({ index: i, target: f.target, message: "Missing target field name" });
      }
      if (f.kind === "simple" || f.kind === "compute") {
        var paths = f.kind === "compute"
          ? parseSourceList(f.computeSources || f.source)
          : visualFieldUsesTemplate(f)
            ? extractTemplateFields(f.template)
            : [f.source].concat(parseCoalesce(f.coalesce) || []);
        paths.filter(Boolean).forEach(function (p) {
          if (sourceData && !pathExistsInData(sourceData, p)) {
            errors.push({
              index: i,
              target: f.target,
              message: 'Source path "' + p + '" not found in loaded data',
            });
          }
        });
      }
      if (f.kind === "forEach" && f.forEachPath && sourceData && !pathExistsInData(sourceData, f.forEachPath)) {
        errors.push({
          index: i,
          target: f.target,
          message: 'forEach path "' + f.forEachPath + '" not found in loaded data',
        });
      }
      if ((f.kind === "forEach" || f.kind === "nested") && (!f.nestedFields || !f.nestedFields.length)) {
        errors.push({
          index: i,
          target: f.target,
          message: "Add at least one nested field mapping",
        });
      }
    });
    return errors;
  }

  function mappingHasCompute(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (typeof obj.compute === "function") return true;
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && mappingHasCompute(obj[k])) {
        return true;
      }
    }
    return false;
  }

  function getSampleValuesForPath(data, path, max) {
    max = max || 3;
    if (!data || !path) return [];
    var JT = global.JsonTransformer;
    var values = [];
    var seen = {};
    var records = Array.isArray(data) ? data : [data];
    for (var i = 0; i < records.length && values.length < max; i++) {
      var v = JT ? JT.resolvePath(records[i], path) : undefined;
      if (v === undefined || v === null) continue;
      if (typeof v === "object") continue;
      var s = String(v);
      if (!seen[s]) {
        seen[s] = true;
        values.push(s);
      }
    }
    return values;
  }

  function diffRecords(expected, actual) {
    var lines = [];
    if (expected === actual) {
      return [{ type: "same", text: "Records match" }];
    }
    if (expected == null || actual == null) {
      lines.push({ type: "removed", text: "Expected: " + JSON.stringify(expected) });
      lines.push({ type: "added", text: "Actual:   " + JSON.stringify(actual) });
      return lines;
    }
    if (typeof expected !== "object" || typeof actual !== "object") {
      lines.push({ type: "changed", text: "Expected: " + JSON.stringify(expected) });
      lines.push({ type: "changed", text: "Actual:   " + JSON.stringify(actual) });
      return lines;
    }
    var keys = {};
    Object.keys(expected).forEach(function (k) { keys[k] = true; });
    Object.keys(actual).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).sort().forEach(function (k) {
      var ev = expected[k];
      var av = actual[k];
      if (JSON.stringify(ev) === JSON.stringify(av)) {
        lines.push({ type: "same", text: k + ": " + JSON.stringify(av) });
      } else if (!(k in expected)) {
        lines.push({ type: "added", text: "+ " + k + ": " + JSON.stringify(av) });
      } else if (!(k in actual)) {
        lines.push({ type: "removed", text: "- " + k + ": " + JSON.stringify(ev) });
      } else {
        lines.push({ type: "changed", text: "~ " + k + ": " + JSON.stringify(ev) + " → " + JSON.stringify(av) });
      }
    });
    return lines;
  }

  global.MappingFeatures = {
    COMPUTE_TEMPLATES: COMPUTE_TEMPLATES,
    DATE_OUTPUT_PRESETS: DATE_OUTPUT_PRESETS,
    NUMBER_FORMAT_OPTIONS: NUMBER_FORMAT_OPTIONS,
    numberFormatUiValue: numberFormatUiValue,
    applyNumberFormatUi: applyNumberFormatUi,
    dateOutputPresetValue: dateOutputPresetValue,
    defaultVisualField: defaultVisualField,
    buildMappingFromVisualFields: buildMappingFromVisualFields,
    buildFullMapping: buildFullMapping,
    mergeVisualFieldsIntoMapping: mergeVisualFieldsIntoMapping,
    formatMappingAsModule: formatMappingAsModule,
    mappingFromCodeText: mappingFromCodeText,
    describeFieldDef: describeFieldDef,
    serializeFieldDefForDisplay: serializeFieldDefForDisplay,
    visualFieldsFromMapping: visualFieldsFromMapping,
    fieldSummaryFromMapping: fieldSummaryFromMapping,
    visualFieldToDef: visualFieldToDef,
    validateVisualFields: validateVisualFields,
    mappingHasCompute: mappingHasCompute,
    mappingRequiresCodeEditor: mappingRequiresCodeEditor,
    parseMappingModule: parseMappingModule,
    stripModuleWrapper: stripModuleWrapper,
    extractMappingMeta: extractMappingMeta,
    applyMappingMeta: applyMappingMeta,
    passthroughToBool: passthroughToBool,
    fieldDefIsAdvanced: fieldDefIsAdvanced,
    getSampleValuesForPath: getSampleValuesForPath,
    diffRecords: diffRecords,
    parseSourceList: parseSourceList,
    parseCoalesce: parseCoalesce,
    coalescePathsToText: coalescePathsToText,
    visualFieldUsesTemplate: visualFieldUsesTemplate,
    extractTemplateFields: extractTemplateFields,
    validateComputeExpression: validateComputeExpression,
    computeParamLabels: computeParamLabels,
    normalizeMapEntries: normalizeMapEntries,
    mapEntriesToObject: mapEntriesToObject,
    collectDistinctValuesForPath: collectDistinctValuesForPath,
  };
})(typeof window !== "undefined" ? window : globalThis);
