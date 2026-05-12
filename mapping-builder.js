#!/usr/bin/env node
/**
 * mapping-builder.js — Interactive mapping file generator for json-xslt
 *
 * Modes:
 *   --inspect <file>          Analyze source JSON and print field metadata
 *   --data <file>             Start interactive mapping wizard
 *   --data <file> --auto      Generate best-guess mapping non-interactively
 *   --output <file>           Write generated mapping to file
 *   --format js|json          Output format (default: js)
 *
 * Examples:
 *   node mapping-builder.js --inspect test-data.json
 *   node mapping-builder.js --data test-data.json --auto --output map.js
 *   node mapping-builder.js --data test-data.json --output map.js
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ═══════════════════════════════════════════════════════════════════════════════
//  CLI Argument Parsing
// ═══════════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
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

// ═══════════════════════════════════════════════════════════════════════════════
//  Data Loader
// ═══════════════════════════════════════════════════════════════════════════════

function loadData(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    die(`data file not found: ${resolved}`);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(resolved, "utf-8"));
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

// ═══════════════════════════════════════════════════════════════════════════════
//  Inspection Engine
// ═══════════════════════════════════════════════════════════════════════════════

const DISTINCT_CAP = 20;

function getType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isDateString(str) {
  if (typeof str !== "string") return false;
  // ISO 8601, common date formats
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/, // ISO
    /^\d{4}-\d{2}-\d{2}$/,                                              // YYYY-MM-DD
    /^\d{2}\/\d{2}\/\d{4}$/,                                            // MM/DD/YYYY
    /^\d{2}-\d{2}-\d{4}$/,                                             // DD-MM-YYYY
    /^\d{4}\/\d{2}\/\d{2}$/,                                            // YYYY/MM/DD
  ];
  if (!datePatterns.some(p => p.test(str))) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

function isNumericString(str) {
  if (typeof str !== "string") return false;
  return str !== "" && !isNaN(Number(str)) && !isNaN(parseFloat(str));
}

/**
 * Inspect a single value and return metadata.
 * This is the recursive heart of the inspection engine.
 */
function inspectValue(value, depth = 0) {
  const type = getType(value);
  const meta = { type };

  if (type === "null") {
    return meta;
  }

  if (type === "string") {
    meta.length = value.length;
    meta.isDate = isDateString(value);
    meta.isNumeric = isNumericString(value);
    meta.sample = value.length > 100 ? value.slice(0, 100) + "..." : value;
    return meta;
  }

  if (type === "number") {
    meta.isInteger = Number.isInteger(value);
    meta.sample = value;
    return meta;
  }

  if (type === "boolean") {
    meta.sample = value;
    return meta;
  }

  if (type === "array") {
    meta.length = value.length;
    if (value.length === 0) {
      meta.itemTypes = [];
      return meta;
    }

    // Collect item types
    const itemTypeSet = new Set();
    const itemMetas = [];
    for (const item of value) {
      const itemType = getType(item);
      itemTypeSet.add(itemType);
      itemMetas.push(inspectValue(item, depth + 1));
    }
    meta.itemTypes = Array.from(itemTypeSet);

    // If all items are objects, merge their field structures
    if (itemTypeSet.size === 1 && itemTypeSet.has("object")) {
      meta.itemFields = mergeObjectFields(value);
    }

    // If all items are primitives, summarize their properties
    if (!itemTypeSet.has("object") && !itemTypeSet.has("array")) {
      const strings = value.filter(v => typeof v === "string");
      if (strings.length > 0) {
        meta.itemIsDate = strings.some(isDateString);
        meta.itemIsNumeric = strings.some(isNumericString);
      }
    }

    return meta;
  }

  if (type === "object") {
    meta.fields = {};
    for (const [key, val] of Object.entries(value)) {
      meta.fields[key] = inspectValue(val, depth + 1);
    }
    return meta;
  }

  return meta;
}

/**
 * Merge field structures from multiple objects into a unified schema.
 */
function mergeObjectFields(objects) {
  const fieldMap = new Map();

  for (const obj of objects) {
    for (const [key, val] of Object.entries(obj)) {
      if (!fieldMap.has(key)) {
        fieldMap.set(key, {
          types: new Set(),
          presentIn: 0,
          nullCount: 0,
          samples: [],
          distinctValues: new Set(),
          min: Infinity,
          max: -Infinity,
          childFields: null,
          arrayItemFields: null,
        });
      }
      const fm = fieldMap.get(key);
      fm.presentIn++;

      const valType = getType(val);
      fm.types.add(valType);

      if (valType === "null") {
        fm.nullCount++;
      } else {
        if (fm.samples.length < 3) {
          const sample = typeof val === "string" && val.length > 100
            ? val.slice(0, 100) + "..."
            : val;
          fm.samples.push(sample);
        }
        if (fm.distinctValues.size < DISTINCT_CAP) {
          fm.distinctValues.add(JSON.stringify(val));
        }
        if (valType === "number") {
          fm.min = Math.min(fm.min, val);
          fm.max = Math.max(fm.max, val);
        }
        if (valType === "object") {
          // We don't recursively merge child objects here; that's handled
          // at the inspectRecord level for top-level fields
        }
      }
    }
  }

  // Convert Sets to arrays, build final structure
  const result = {};
  for (const [key, fm] of fieldMap) {
    result[key] = {
      types: Array.from(fm.types),
      presentIn: fm.presentIn,
      nullCount: fm.nullCount,
      sample: fm.samples[0] !== undefined ? fm.samples[0] : null,
      distinctValues: Array.from(fm.distinctValues).map(v => {
        try { return JSON.parse(v); } catch { return v; }
      }),
      distinctCount: fm.distinctValues.size,
    };
    if (fm.types.has("number")) {
      result[key].min = fm.min === Infinity ? null : fm.min;
      result[key].max = fm.max === -Infinity ? null : fm.max;
    }
  }

  return result;
}

/**
 * Inspect an array of records and return unified field metadata.
 */
function inspect(records) {
  const recordCount = records.length;
  const fieldMap = new Map();

  for (const record of records) {
    const recordType = getType(record);
    if (recordType !== "object") {
      continue; // Skip non-object records (shouldn't happen with validated data)
    }

    for (const [key, val] of Object.entries(record)) {
      if (!fieldMap.has(key)) {
        fieldMap.set(key, {
          types: new Set(),
          presentIn: 0,
          nullCount: 0,
          samples: [],
          distinctValues: new Set(),
          min: Infinity,
          max: -Infinity,
          arrayStats: { lengths: [], itemTypes: new Set() },
          childFields: null,
        });
      }

      const fm = fieldMap.get(key);
      fm.presentIn++;

      const valType = getType(val);
      fm.types.add(valType);

      if (valType === "null") {
        fm.nullCount++;
      } else {
        // Collect sample (up to 3)
        if (fm.samples.length < 3) {
          const sample = typeof val === "string" && val.length > 100
            ? val.slice(0, 100) + "..."
            : val;
          fm.samples.push(sample);
        }

        // Collect distinct values (capped)
        if (fm.distinctValues.size < DISTINCT_CAP) {
          fm.distinctValues.add(JSON.stringify(val));
        }

        // Number stats
        if (valType === "number") {
          fm.min = Math.min(fm.min, val);
          fm.max = Math.max(fm.max, val);
        }

        // Array stats
        if (valType === "array") {
          fm.arrayStats.lengths.push(val.length);
          for (const item of val) {
            fm.arrayStats.itemTypes.add(getType(item));
          }
        }
      }
    }
  }

  // Build final report
  const fields = {};
  for (const [key, fm] of fieldMap) {
    const report = {
      types: Array.from(fm.types),
      presentIn: fm.presentIn,
      nullCount: fm.nullCount,
      missingCount: recordCount - fm.presentIn,
      sample: fm.samples[0] !== undefined ? fm.samples[0] : null,
      samples: fm.samples,
      distinctValues: Array.from(fm.distinctValues).map(v => {
        try { return JSON.parse(v); } catch { return v; }
      }),
      distinctCount: fm.distinctValues.size,
    };

    if (fm.types.has("number")) {
      report.min = fm.min === Infinity ? null : fm.min;
      report.max = fm.max === -Infinity ? null : fm.max;
    }

    if (fm.types.has("array")) {
      const lengths = fm.arrayStats.lengths;
      report.arrayStats = {
        minLength: lengths.length ? Math.min(...lengths) : 0,
        maxLength: lengths.length ? Math.max(...lengths) : 0,
        avgLength: lengths.length
          ? Math.round((lengths.reduce((a, b) => a + b, 0) / lengths.length) * 10) / 10
          : 0,
        itemTypes: Array.from(fm.arrayStats.itemTypes),
      };

      // If all array items are objects, do a deep inspection of merged item fields
      if (fm.arrayStats.itemTypes.size === 1 && fm.arrayStats.itemTypes.has("object")) {
        const allItems = [];
        for (const record of records) {
          const arr = record[key];
          if (Array.isArray(arr)) {
            allItems.push(...arr);
          }
        }
        if (allItems.length > 0) {
          report.itemFields = mergeObjectFields(allItems);
        }
      }
    }

    // If field is consistently an object, inspect its structure
    if (fm.types.size === 1 && fm.types.has("object")) {
      const childRecords = records
        .map(r => r[key])
        .filter(v => v !== null && typeof v === "object" && !Array.isArray(v));
      if (childRecords.length > 0) {
        report.childFields = mergeObjectFields(childRecords);
      }
    }

    fields[key] = report;
  }

  return {
    recordCount,
    fields,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Inspect Output Formatting
// ═══════════════════════════════════════════════════════════════════════════════

function formatInspectReport(report) {
  const lines = [];
  lines.push(`Records analyzed: ${report.recordCount}`);
  lines.push(`Fields discovered: ${Object.keys(report.fields).length}`);
  lines.push("");

  for (const [fieldName, meta] of Object.entries(report.fields)) {
    lines.push(`─ ${fieldName} ────────────────────────────────────────────────`.slice(0, 60));
    lines.push(`  types:        ${meta.types.join(" | ")}`);
    lines.push(`  present in:   ${meta.presentIn}/${report.recordCount} records`);

    if (meta.missingCount > 0) {
      lines.push(`  missing:      ${meta.missingCount} records`);
    }
    if (meta.nullCount > 0) {
      lines.push(`  null values:  ${meta.nullCount}`);
    }

    if (meta.sample !== null) {
      const sampleStr = typeof meta.sample === "string"
        ? `"${meta.sample}"`
        : JSON.stringify(meta.sample);
      lines.push(`  sample:       ${sampleStr}`);
    }

    if (meta.distinctCount > 0) {
      lines.push(`  distinct:     ${meta.distinctCount} unique values`);
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

    if (meta.arrayStats) {
      lines.push(`  array length: ${meta.arrayStats.minLength}–${meta.arrayStats.maxLength} (avg ${meta.arrayStats.avgLength})`);
      lines.push(`  item types:   ${meta.arrayStats.itemTypes.join(" | ")}`);
    }

    if (meta.itemFields) {
      lines.push(`  item fields:`);
      for (const [itemField, itemMeta] of Object.entries(meta.itemFields)) {
        const typeStr = itemMeta.types.join("|");
        const distStr = itemMeta.distinctCount > 0
          ? ` (${itemMeta.distinctCount} distinct)`
          : "";
        lines.push(`    • ${itemField}: ${typeStr}${distStr}`);
      }
    }

    if (meta.childFields) {
      lines.push(`  child fields:`);
      for (const [childField, childMeta] of Object.entries(meta.childFields)) {
        const typeStr = childMeta.types.join("|");
        const distStr = childMeta.distinctCount > 0
          ? ` (${childMeta.distinctCount} distinct)`
          : "";
        lines.push(`    • ${childField}: ${typeStr}${distStr}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  // ── Inspect mode ──────────────────────────────────────────────────────
  if (args.inspect) {
    const data = loadData(args.inspect);
    const report = inspect(data);

    const output = args.output
      ? JSON.stringify(report, null, 2)
      : formatInspectReport(report);

    if (args.output) {
      fs.writeFileSync(path.resolve(args.output), output + "\n", "utf-8");
      console.error(`Wrote inspection report to ${path.resolve(args.output)}`);
    } else {
      console.log(output);
    }
    return;
  }

  // ── Build mode (not yet implemented) ──────────────────────────────────
  if (args.data) {
    console.error("Interactive mapping builder is not yet implemented.");
    console.error("Use --inspect to analyze your data, or --auto for a basic mapping.");
    process.exit(1);
  }

  printHelp();
}

main().catch(e => {
  console.error(`fatal: ${e.message}`);
  process.exit(1);
});
