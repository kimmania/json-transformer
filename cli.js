#!/usr/bin/env node
/**
 * json-transformer CLI
 *
 * Usage:
 *   node cli.js transform --data input.json --mapping mapping.js
 *   node cli.js transform -d data.json -m mapping.json -o output.json
 *   node cli.js transform -d data.json -m mapping.json --compact
 *   node cli.js --help
 *
 * Mapping format:
 *   .json  — pure data mapping (no compute functions)
 *   .js    — full mapping with compute() support
 *
 * If --output is omitted, results are written to stdout (piped-friendly).
 */

import { transform, validate, prepareMapping } from "./transform.js";
import { inspect, formatInspectReport } from "./mapping-builder.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── Helpers ──────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`
json-transformer — Declarative JSON transformation CLI

USAGE
  node cli.js transform --data <file> --mapping <file> [options]
  node cli.js --inspect <file> [options]
  node cli.js --sample <file> [options]
  node cli.js --convert <file> [options]

OPTIONS
  -d, --data      <file>   Input data file (.json array or .csv); repeat to merge multiple files
  -m, --mapping   <file>   Mapping definition (.js or .json)
  -o, --output    <file>   Output file (default: stdout)
  -i, --inspect   <file>   Inspect a data file and print a field analysis report
      --sample    <file>   Extract the first N rows of a CSV (or JSON array) as JSON
      --head      <n>      Number of rows for --sample (default: 5)
      --convert   <file>   Convert a CSV (or JSON array) to JSON with no mapping applied
  --compact                Minified JSON output (no whitespace)
  -h, --help               Show this help

EXAMPLES
  node cli.js transform -d users.json -m crm-map.js
  node cli.js transform -d users.csv -m crm-map.js
  node cli.js transform -d jan.json -d feb.json -d mar.json -m map.js
  node cli.js transform -d src.json -m map.json -o out.json
  node cli.js transform -d data.json -m map.js | jq '.[0]'
  node cli.js --inspect data.json
  node cli.js -i data.json -o inspection.json
  node cli.js --sample data.csv -o sample.json
  node cli.js --sample data.csv --head 10 -o sample.json
  node cli.js --convert data.csv -o data.json
  node cli.js --convert data.csv --compact -o data.json

MAPPING FORMATS
  .json  Pure declarative mapping (all features except compute functions)
  .js    Full mapping with compute(), dynamic import support

SECURITY NOTE
  .js mapping files are loaded via dynamic import and can execute arbitrary
  code. Only run mapping files from trusted sources.

BUILDING MAPPINGS
  Need help creating a mapping? Use mapping-builder.js to inspect your
  data and generate a mapping interactively or automatically:

    node mapping-builder.js --inspect <file>   # Analyze data structure
    node mapping-builder.js --data <file>       # Interactive wizard
    node mapping-builder.js --data <file> --auto # Auto-generate
`);
}

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// ── Arg parsing ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    data: null,
    mapping: null,
    output: null,
    inspect: null,
    sample: null,
    head: 5,
    convert: null,
    pretty: true,
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    switch (a) {
      case "-d": case "--data":
        i++; if (!args.data) args.data = []; args.data.push(argv[i]); break;
      case "-m": case "--mapping":
        i++; args.mapping = argv[i]; break;
      case "-o": case "--output":
        i++; args.output = argv[i]; break;
      case "--compact":
        args.pretty = false; break;
      case "-i": case "--inspect":
        i++; args.inspect = argv[i]; break;
      case "--sample":
        i++; args.sample = argv[i]; break;
      case "--convert":
        i++; args.convert = argv[i]; break;
      case "--head": {
        i++;
        const n = parseInt(argv[i], 10);
        if (isNaN(n) || n < 1) die(`--head requires a positive integer, got "${argv[i]}"`);
        args.head = n;
        break;
      }
      case "-h": case "--help":
        args.help = true; break;
      default:
        // Skip subcommand like "transform" or unknown flags
        break;
    }
    i++;
  }

  return args;
}

// ── CSV parser ───────────────────────────────────────────────────────

/**
 * Parse a CSV string into an array of objects using the header row as keys.
 * Handles quoted fields (including commas and newlines inside quotes).
 *
 * Line endings inside quoted fields are normalized to '\n' so that a CRLF
 * sequence (\r\n) or a lone CR (\r) becomes a single LF (\n). Unquoted
 * rows are split on the original line terminators.
 *
 * This is a lightweight built-in parser. For large or production CSV files,
 * consider a dedicated streaming parser instead (see README).
 */
function parseCsv(text) {
  const rows = [];
  let field = "";
  let inQuotes = false;
  const currentRow = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else if (ch === '\r' && next === '\n') {
        field += '\n';
        i++;
      } else if (ch === '\r' || ch === '\n') {
        field += '\n';
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(field);
      field = "";
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(field);
      field = "";
      rows.push([...currentRow]);
      currentRow.length = 0;
      i++;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(field);
      field = "";
      rows.push([...currentRow]);
      currentRow.length = 0;
    } else {
      field += ch;
    }
  }

  // Flush last field/row
  if (field || currentRow.length > 0) {
    currentRow.push(field);
    rows.push([...currentRow]);
  }

  if (rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1)
    .filter(row => row.some(f => f.trim() !== ""))
    .map(row => {
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = row[i] ?? "";
      }
      return obj;
    });
}

// ── Mapping loader ───────────────────────────────────────────────────

async function loadMapping(mappingPath) {
  const resolved = path.resolve(mappingPath);

  if (!fs.existsSync(resolved)) {
    die(`mapping file not found: ${resolved}`);
  }

  if (mappingPath.endsWith(".json")) {
    return JSON.parse(fs.readFileSync(resolved, "utf-8"));
  }

  if (mappingPath.endsWith(".js")) {
    const mod = await import(pathToFileURL(resolved).href);
    return mod.default || mod;
  }

  die(`unsupported mapping format: ${mappingPath} (use .js or .json)`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(rawArgs) {
  // Strip "node cli.js [transform]" prefix — parseArgs skips unknown tokens like "transform"
  const rest = rawArgs.slice(2);
  const args = parseArgs(rest);

  if (args.help || (!args.data && !args.mapping && !args.inspect && !args.sample && !args.convert)) {
    printHelp();
    return;
  }

  // ── Inspect mode ────────────────────────────────────────────────────────
  if (args.inspect) {
    const dataPath = path.resolve(args.inspect);
    if (!fs.existsSync(dataPath)) {
      die(`data file not found: ${dataPath}`);
    }
    let data;
    if (args.inspect.endsWith(".csv")) {
      try {
        data = parseCsv(fs.readFileSync(dataPath, "utf-8"));
      } catch (e) {
        die(`failed to parse CSV file "${args.inspect}": ${e.message}`);
      }
    } else {
      try {
        data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
      } catch (e) {
        die(`invalid JSON in data file "${args.inspect}": ${e.message}`);
      }
      if (!Array.isArray(data)) {
        die(`data file must contain a JSON array of objects: ${args.inspect}`);
      }
    }

    const report = inspect(data, args.output ? { maxDistinctValues: 50 } : {});
    const output = args.output
      ? JSON.stringify(report, null, 2)
      : formatInspectReport(report);

    if (args.output) {
      fs.writeFileSync(path.resolve(args.output), output + "\n", "utf-8");
      console.error(`Wrote inspection report to ${path.resolve(args.output)}`);
    } else {
      process.stdout.write(output + "\n");
    }
    return;
  }

  // ── Transform mode ─────────────────────────────────────────────────────
  if (!args.data || args.data.length === 0) die("missing --data parameter");
  if (!args.mapping) die("missing --mapping parameter");

  // Load and merge data files
  const sourceData = [];
  for (const dataArg of args.data) {
    const dataPath = path.resolve(dataArg);
    if (!fs.existsSync(dataPath)) {
      die(`data file not found: ${dataPath}`);
    }
    let records;
    if (dataArg.endsWith(".csv")) {
      try {
        records = parseCsv(fs.readFileSync(dataPath, "utf-8"));
      } catch (e) {
        die(`failed to parse CSV file "${dataArg}": ${e.message}`);
      }
    } else {
      try {
        records = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
      } catch (e) {
        die(`invalid JSON in data file "${dataArg}": ${e.message}`);
      }
      if (!Array.isArray(records)) {
        die(`data file must contain a JSON array of objects: ${dataArg}`);
      }
    }
    for (const record of records) sourceData.push(record);
  }

  // Load mapping
  const mapping = await loadMapping(args.mapping).catch(e => {
    die(`failed to load mapping: ${e.message}`);
  });

  // Resolve the directory of the mapping file for $file relative paths
  const mappingDir = path.dirname(path.resolve(args.mapping));

  // Prepare mapping (loads external dictionaries, builds lookup maps)
  const ready = await prepareMapping(mapping, mappingDir);

  // Validate (if the mapping defines a schema)
  if (ready.schema) {
    const { errors } = validate(sourceData, ready);
    if (errors.length > 0) {
      console.error(`\n${errors.length} validation error(s):`);
      for (const e of errors) {
        console.error(`  row ${e.row}, field "${e.field}": ${e.message}`);
      }
      console.error();
    }
  }

  // Transform
  const results = transform(sourceData, ready);

  // Output
  const output = args.pretty
    ? JSON.stringify(results, null, 2)
    : JSON.stringify(results);

  if (args.output) {
    fs.writeFileSync(path.resolve(args.output), output + "\n", "utf-8");
    console.error(`wrote ${results.length} record(s) to ${path.resolve(args.output)}`);
  } else {
    process.stdout.write(output + "\n");
  }
}

main(process.argv).catch(e => {
  console.error(`fatal: ${e.message}`);
  process.exit(1);
});

export { parseCsv };
