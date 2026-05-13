/**
 * End-to-end tests for transform.js via cli.js
 * Verifies example mappings produce exact expected output.
 *
 * Run: node --test transform.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function runTransform(dataFile, mappingFile) {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "cli.js"), "transform", "-d", dataFile, "-m", mappingFile],
    { cwd: __dirname, encoding: "utf-8" }
  );
  if (result.status !== 0) {
    throw new Error(`transform failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function loadExpected(name) {
  const p = path.join(__dirname, "expected", name);
  return JSON.parse(readFileSync(p, "utf-8"));
}

describe("Example mappings produce expected output", () => {
  it("mapping-crm-example.js on test-data.json", () => {
    const result = runTransform("test-data.json", "mapping-crm-example.js");
    assert.deepStrictEqual(result, loadExpected("expected-crm.json"));
  });

  it("mapping-nested.js on test-nested.json", () => {
    const result = runTransform("test-nested.json", "mapping-nested.js");
    assert.deepStrictEqual(result, loadExpected("expected-nested.js.json"));
  });

  it("mapping-nested.json on test-nested.json", () => {
    const result = runTransform("test-nested.json", "mapping-nested.json");
    assert.deepStrictEqual(result, loadExpected("expected-nested.json"));
  });

  it("mapping-order-summary.js on test-order-summary.json", () => {
    const result = runTransform("test-order-summary.json", "mapping-order-summary.js");
    assert.deepStrictEqual(result, loadExpected("expected-order-summary.json"));
  });

  it("mapping-shaping.js on test-shaping.json", () => {
    const result = runTransform("test-shaping.json", "mapping-shaping.js");
    assert.deepStrictEqual(result, loadExpected("expected-shaping.json"));
  });

  it("mapping-data-cleaning.js on test-data-cleaning.json", () => {
    const result = runTransform("test-data-cleaning.json", "mapping-data-cleaning.js");
    assert.deepStrictEqual(result, loadExpected("expected-data-cleaning.json"));
  });

  it("mapping-timesheet.js on test-timesheet.json", () => {
    const result = runTransform("test-timesheet.json", "mapping-timesheet.js");
    assert.deepStrictEqual(result, loadExpected("expected-timesheet.json"));
  });

  it("mapping-employee.js on test-employees.csv", () => {
    const result = runTransform("test-employees.csv", "mapping-employee.js");
    assert.deepStrictEqual(result, loadExpected("expected-employee.json"));
  });

  it("mapping-validated.js on test-invalid.json (outputs with validation errors)", () => {
    const result = runTransform("test-invalid.json", "mapping-validated.js");
    assert.deepStrictEqual(result, loadExpected("expected-validated.json"));
  });
});
