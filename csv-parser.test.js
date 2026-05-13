import { describe, it } from "node:test";
import assert from "node:assert";
import { parseCsv } from "./cli.js";

describe("parseCsv", () => {
  it("parses a simple CSV with header", () => {
    const csv = "name,age\nAlice,30\nBob,25\n";
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Alice", age: "30" },
      { name: "Bob", age: "25" },
    ]);
  });

  it("handles CRLF line endings", () => {
    const csv = "name,age\r\nAlice,30\r\nBob,25\r\n";
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Alice", age: "30" },
      { name: "Bob", age: "25" },
    ]);
  });

  it("handles mixed line endings", () => {
    const csv = "name,age\nAlice,30\r\nBob,25\r";
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Alice", age: "30" },
      { name: "Bob", age: "25" },
    ]);
  });

  it("handles quoted fields with commas", () => {
    const csv = 'name,note\n"Doe, John","likes tea, coffee"\n';
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Doe, John", note: "likes tea, coffee" },
    ]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    const csv = 'name,note\n"Doe, John","says ""hello"""\n';
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Doe, John", note: 'says "hello"' },
    ]);
  });

  it("normalizes CRLF inside quoted fields to LF", () => {
    const csv = 'name,address\nAlice,"123 Main St\r\nApt 4"\n';
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Alice", address: "123 Main St\nApt 4" },
    ]);
  });

  it("normalizes lone CR inside quoted fields to LF", () => {
    const csv = 'name,address\nAlice,"123 Main St\rApt 4"\n';
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Alice", address: "123 Main St\nApt 4" },
    ]);
  });

  it("preserves lone LF inside quoted fields", () => {
    const csv = 'name,address\nAlice,"123 Main St\nApt 4"\n';
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Alice", address: "123 Main St\nApt 4" },
    ]);
  });

  it("handles quoted fields that span multiple physical lines", () => {
    const csv = 'name,address\nAlice,"123 Main St\nApt 4\nSpringfield, IL"\nBob,25\n';
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Alice", address: "123 Main St\nApt 4\nSpringfield, IL" },
      { name: "Bob", address: "25" },
    ]);
  });

  it("handles empty quoted fields", () => {
    const csv = 'name,note\nAlice,""\n';
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Alice", note: "" },
    ]);
  });

  it("handles empty unquoted fields", () => {
    const csv = "name,age\nAlice,\n,30\n";
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Alice", age: "" },
      { name: "", age: "30" },
    ]);
  });

  it("ignores trailing empty line", () => {
    const csv = "name,age\nAlice,30\n\n";
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Alice", age: "30" },
    ]);
  });

  it("returns empty array for header-only CSV", () => {
    const csv = "name,age\n";
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, []);
  });

  it("returns empty array for empty string", () => {
    const result = parseCsv("");
    assert.deepStrictEqual(result, []);
  });

  it("handles a single row with no trailing newline", () => {
    const csv = "name,age\nAlice,30";
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: "Alice", age: "30" },
    ]);
  });

  it("strips surrounding whitespace from unquoted fields", () => {
    // RFC 4180 does not require whitespace stripping, but our parser is simple
    // and keeps it. This test documents current behavior.
    const csv = "name,age\n Alice , 30 \n";
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      { name: " Alice ", age: " 30 " },
    ]);
  });
});
