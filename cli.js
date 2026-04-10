#!/usr/bin/env node
/**
 * json-xslt CLI
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

import { transform, prepareMapping } from "./transform.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Helpers ──────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`
json-xslt — Declarative JSON transformation CLI

USAGE
  node cli.js transform --data <file> --mapping <file> [options]

OPTIONS
  -d, --data      <file>   Input JSON data (array of objects)
  -m, --mapping   <file>   Mapping definition (.js or .json)
  -o, --output    <file>   Output file (default: stdout)
  --compact                Minified JSON output (no whitespace)
  -h, --help               Show this help

EXAMPLES
  node cli.js transform -d users.json -m crm-map.js
  node cli.js transform -d src.json -m map.json -o out.json
  node cli.js transform -d data.json -m map.js | jq '.[0]'

MAPPING FORMATS
  .json  Pure declarative mapping (all features except compute functions)
  .js    Full mapping with compute(), dynamic import support
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
    pretty: true,
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    switch (a) {
      case "-d": case "--data":
        i++; args.data = argv[i]; break;
      case "-m": case "--mapping":
        i++; args.mapping = argv[i]; break;
      case "-o": case "--output":
        i++; args.output = argv[i]; break;
      case "--compact":
        args.pretty = false; break;
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

  if (args.help || (!args.data && !args.mapping)) {
    printHelp();
    return;
  }

  if (!args.data) die("missing --data parameter");
  if (!args.mapping) die("missing --mapping parameter");

  // Load data
  const dataPath = path.resolve(args.data);
  if (!fs.existsSync(dataPath)) {
    die(`data file not found: ${dataPath}`);
  }
  let sourceData;
  try {
    sourceData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  } catch (e) {
    die(`invalid JSON in data file: ${e.message}`);
  }
  if (!Array.isArray(sourceData)) {
    die("data file must contain a JSON array of objects");
  }

  // Load mapping
  const mapping = await loadMapping(args.mapping).catch(e => {
    die(`failed to load mapping: ${e.message}`);
  });

  // Resolve the directory of the mapping file for $file relative paths
  const mappingDir = path.dirname(path.resolve(args.mapping));

  // Prepare mapping (loads external dictionaries, builds lookup maps)
  const ready = await prepareMapping(mapping, mappingDir);

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
