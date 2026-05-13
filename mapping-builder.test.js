/**
 * Unit tests for mapping-builder.js
 * Run with: node --test mapping-builder.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
// Test data paths
const TEST_DATA_CRM = [
  { FullName: "Jane Doe", FirstName: "Jane", LastName: "Doe", EmailAddr: "JANE@Example.com", StatusCode: "A", CreatedDate: "2025-01-15T08:30:00Z", LastActive: "2025-06-20T14:22:00Z", TotalSpend: 12500, Country: "us" },
  { FullName: "John Smith", FirstName: "John", LastName: "Smith", EmailAddr: "JOHN@Test.com", StatusCode: "I", CreatedDate: "2023-03-07T12:00:00Z", LastActive: "2024-01-10T09:15:00Z", TotalSpend: 3200, Country: "uk" },
  { FullName: "Bob Jones", FirstName: "Bob", LastName: "Jones", EmailAddr: "bob@demo.com", StatusCode: "P", CreatedDate: "2025-11-01T18:00:00Z", LastActive: "2025-11-01T18:00:00Z", TotalSpend: 0, Country: "ca" },
];

const TEST_DATA_NESTED = [
  { order_id: "ORD-1001", customer: { FullName: "Alice Johnson", Email: "ALICE@example.com", tier: "gold" }, LineItems: [{ ProductSKU: "WIDGET-A", Qty: 2, Price: "29.99" }, { SKU: "GADGET-X", Qty: 1, Price: "149.00" }, { SKU: "CABLE-B", Qty: 3, Price: "12.50" }], ship_city: "nyc", ship_state: "NY", ship_zip: "10001", date_shipped: "2025-06-15T10:00:00Z", grand_total: "234.48" },
  { order_id: "ORD-1002", customer: { FullName: "Bob Chen", Email: "BOB@demo.org", tier: "silver" }, LineItems: [{ SKU: "PART-Y", Qty: 10, Price: "4.99" }], ship_city: "la", ship_state: "CA", ship_zip: "90001", date_shipped: "2025-07-01T08:30:00Z", grand_total: "49.90" },
  { order_id: "ORD-1003", customer: null, LineItems: [], ship_city: "chi", ship_state: "IL", ship_zip: "60601", date_shipped: null, grand_total: "0" },
];

const TEST_DATA_CLEANING = [
  { first_name: "alice", last_name: "SMITH", mobile: "555-0100", work_phone: null, home_phone: "555-0199", street: "123 main st", city: "springfield", state: "il", zip: "62701", tags: "javascript,nodejs,json", keywords: ["search", "filter", "sort"], price: 12.3456, score: 87.666, description: "This is a very long product description that should be trimmed for display", api_key_name: "My API Key Name", component_name: "UserProfileCard", source_system: "CRM", internal_id: "INT-001" },
  { first_name: "BOB", last_name: "jones", mobile: null, work_phone: null, home_phone: null, street: "456 oak ave", city: "SHELBYVILLE", state: "IL", zip: "62565", tags: "python,data,etl", keywords: ["import", "export"], price: 99.9999, score: 42.123, description: "Short desc", api_key_name: "data_export_job", component_name: "order-summary-table", source_system: "ERP", internal_id: "INT-002" },
];

// Load the module under test
const mb = await import("./mapping-builder.js");

// ── inspect() ───────────────────────────────────────────────────────────────

describe("inspect()", () => {
  it("counts records correctly", () => {
    const result = mb.inspect(TEST_DATA_CRM);
    assert.equal(result.recordCount, 3);
  });

  it("detects string fields", () => {
    const result = mb.inspect(TEST_DATA_CRM);
    assert.equal(result.fields.FullName.type, "string");
    assert.equal(result.fields.FullName.sample, "Jane Doe");
  });

  it("detects number fields", () => {
    const result = mb.inspect(TEST_DATA_CRM);
    assert.equal(result.fields.TotalSpend.type, "number");
  });

  it("collects distinct values for string fields", () => {
    const result = mb.inspect(TEST_DATA_CRM);
    assert.deepEqual(result.fields.StatusCode.distinctValues, ["A", "I", "P"]);
  });

  it("detects ISO date strings as string type (not date)", () => {
    const result = mb.inspect(TEST_DATA_CRM);
    assert.equal(result.fields.CreatedDate.type, "string");
    assert.equal(result.fields.CreatedDate.sample, "2025-01-15T08:30:00Z");
  });

  it("detects nested fields via dot-notation", () => {
    const result = mb.inspect(TEST_DATA_NESTED);
    assert.ok(result.fields["customer.FullName"]);
    assert.equal(result.fields["customer.FullName"].type, "string");
  });

  it("detects arrays of objects", () => {
    const result = mb.inspect(TEST_DATA_NESTED);
    assert.equal(result.fields.LineItems.type, "array");
  });

  it("handles empty array", () => {
    const result = mb.inspect([{ items: [] }]);
    assert.equal(result.fields.items.type, "array");
  });

  it("handles null values", () => {
    // null values are skipped during inspection (they carry no type info)
    const result = mb.inspect([{ a: null, b: "hello" }]);
    // null is skipped; only 'b' appears in fields
    assert.ok(result.fields.b);
    assert.equal(result.fields.b.type, "string");
  });

  it("tracks min/max for number fields", () => {
    const result = mb.inspect(TEST_DATA_CRM);
    assert.equal(result.fields.TotalSpend.min, 0);
    assert.equal(result.fields.TotalSpend.max, 12500);
  });
});

// ── toSnakeCase() / toCamelCase() ───────────────────────────────────────────

describe("String transforms", () => {
  it("toSnakeCase converts camelCase", () => {
    assert.equal(mb.toSnakeCase("FullName"), "full_name");
    assert.equal(mb.toSnakeCase("customerEmail"), "customer_email");
  });

  it("toSnakeCase handles PascalCase", () => {
    assert.equal(mb.toSnakeCase("FirstName"), "first_name");
  });

  it("toSnakeCase handles existing snake_case", () => {
    assert.equal(mb.toSnakeCase("full_name"), "full_name");
  });

  it("toSnakeCase handles spaces/dashes", () => {
    assert.equal(mb.toSnakeCase("Full Name"), "full_name");
    assert.equal(mb.toSnakeCase("Full-Name"), "full_name");
  });

  it("toCamelCase", () => {
    assert.equal(mb.toCamelCase("full_name"), "fullName");
    assert.equal(mb.toCamelCase("customer_email_address"), "customerEmailAddress");
  });
});

// ── looksLikeDate() ───────────────────────────────────────────────────────────

describe("looksLikeDate()", () => {
  it("detects ISO date only strings", () => {
    assert.equal(mb.looksLikeDate("2025-01-15"), true);
    assert.equal(mb.looksLikeDate("2025-01-15T08:30:00Z"), true);
    assert.equal(mb.looksLikeDate("2025-01-15T08:30:00.123Z"), true);
    assert.equal(mb.looksLikeDate("2025-01-15T08:30:00+05:30"), true);
  });

  it("rejects plain numbers", () => {
    assert.equal(mb.looksLikeDate("12345"), false);
  });

  it("rejects random strings", () => {
    assert.equal(mb.looksLikeDate("hello"), false);
  });
});

// ── normaliseAnswer() ────────────────────────────────────────────────────────

describe("normaliseAnswer()", () => {
  it("maps 'r' to 'rename'", () => {
    const a = mb.normaliseAnswer({ sourceField: "FullName", feature: "r" });
    assert.equal(a.feature, "rename");
  });

  it("maps 'upper' format to 'uppercase'", () => {
    const a = mb.normaliseAnswer({ sourceField: "Name", feature: "format", params: { format: "upper" } });
    assert.equal(a.params.format, "uppercase");
  });

  it("auto-sets targetField from sourceField as snake_case", () => {
    const a = mb.normaliseAnswer({ sourceField: "FullName", feature: "rename" });
    assert.equal(a.targetField, "full_name");
  });

  it("throws on invalid format", () => {
    assert.throws(
      () => mb.normaliseAnswer({ sourceField: "X", feature: "format", params: { format: "invalid" } }),
      /Invalid format/
    );
  });

  it("throws on invalid aggregate op", () => {
    assert.throws(
      () => mb.normaliseAnswer({ sourceField: "X", feature: "aggregate", params: { op: "median" } }),
      /Invalid aggregate op/
    );
  });
});

// ── buildMapping(): DSL features ─────────────────────────────────────────────

describe("buildMapping(): DSL features", () => {

  it("from/rename → simple field mapping", () => {
    const inspection = { recordCount: 1, fields: { FullName: { type: "string", sample: "Jane" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "FullName", targetField: "full_name", feature: "from" }
    ]);
    assert.deepEqual(mapping.fields.full_name, { from: "FullName" });
  });

  it("format: date", () => {
    const inspection = { recordCount: 1, fields: { CreatedDate: { type: "string", sample: "2025-01-15" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "CreatedDate", targetField: "created", feature: "format", params: { format: "date", outputFormat: "YYYY-MM-DD" } }
    ]);
    assert.deepEqual(mapping.fields.created, { from: "CreatedDate", format: "date", outputFormat: "YYYY-MM-DD" });
  });

  it("format: number", () => {
    const inspection = { recordCount: 1, fields: { TotalSpend: { type: "number", sample: 12500 } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "TotalSpend", targetField: "total_spend", feature: "format", params: { format: "number" } }
    ]);
    assert.deepEqual(mapping.fields.total_spend, { from: "TotalSpend", format: "number" });
  });

  it("format: lowercase", () => {
    const inspection = { recordCount: 1, fields: { EmailAddr: { type: "string", sample: "JANE@X.COM" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "EmailAddr", targetField: "email", feature: "format", params: { format: "lowercase" } }
    ]);
    assert.deepEqual(mapping.fields.email, { from: "EmailAddr", format: "lowercase" });
  });

  it("map: value object", () => {
    const inspection = { recordCount: 1, fields: { StatusCode: { type: "string", sample: "A" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "StatusCode", targetField: "status", feature: "map", params: { mapObject: { A: "active", I: "inactive", P: "pending" } } }
    ]);
    assert.deepEqual(mapping.fields.status, { from: "StatusCode", map: { A: "active", I: "inactive", P: "pending" } });
  });

  it("compute: custom function", () => {
    const fn = (a, b) => a + b;
    const inspection = { recordCount: 1, fields: { A: { type: "number" }, B: { type: "number" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "AB", targetField: "sum", feature: "compute", params: { fields: ["A", "B"], fn } }
    ]);
    assert.equal(typeof mapping.fields.sum.compute, "function");
    assert.deepEqual(mapping.fields.sum.from, ["A", "B"]);
  });

  it("if/then/else", () => {
    const inspection = { recordCount: 1, fields: { TotalSpend: { type: "number", sample: 12500 } } };
    const mapping = mb.buildMapping(inspection, [
      {
        sourceField: "TotalSpend", targetField: "tier",
        feature: "if",
        params: { condition: { field: "TotalSpend", op: "gte", value: 10000 }, then: "platinum", else: "standard" }
      }
    ]);
    assert.deepEqual(mapping.fields.tier, {
      if: { field: "TotalSpend", op: "gte", value: 10000 },
      then: "platinum",
      else: "standard",
    });
  });

  it("forEach: basic array iteration", () => {
    const inspection = { recordCount: 1, fields: { LineItems: { type: "array" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "LineItems", targetField: "items", feature: "forEach", params: { fields: {} } }
    ]);
    assert.deepEqual(mapping.fields.items, { forEach: "LineItems", fields: {} });
  });

  it("aggregate: sum", () => {
    const inspection = { recordCount: 1, fields: { LineItems: { type: "array" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "LineItems", targetField: "total", feature: "aggregate", params: { op: "sum", field: "Price" } }
    ]);
    assert.deepEqual(mapping.fields.total, { forEach: "LineItems", aggregate: "sum", from: "Price" });
  });

  it("distinct", () => {
    const inspection = { recordCount: 1, fields: { Items: { type: "array" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "Items", targetField: "unique_tags", feature: "distinct", params: { field: "tag" } }
    ]);
    assert.deepEqual(mapping.fields.unique_tags, { forEach: "Items", distinct: "tag" });
  });

  it("filter", () => {
    const inspection = { recordCount: 1, fields: { Items: { type: "array" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "Items", targetField: "active", feature: "filter", params: { condition: { field: "status", op: "eq", value: "active" } } }
    ]);
    assert.deepEqual(mapping.fields.active, { forEach: "Items", filter: { field: "status", op: "eq", value: "active" } });
  });

  it("sortBy", () => {
    const inspection = { recordCount: 1, fields: { Items: { type: "array" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "Items", targetField: "sorted", feature: "sortBy", params: { field: "price", order: "desc" } }
    ]);
    assert.deepEqual(mapping.fields.sorted, { forEach: "Items", sortBy: { field: "price", order: "desc" } });
  });

  it("template", () => {
    const inspection = { recordCount: 1, fields: { first_name: { type: "string" }, last_name: { type: "string" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "name", targetField: "full_name", feature: "template", params: { template: "{first_name} {last_name}", format: "titlecase" } }
    ]);
    assert.deepEqual(mapping.fields.full_name, { template: "{first_name} {last_name}", format: "titlecase" });
  });

  it("coalesce", () => {
    const inspection = { recordCount: 1, fields: { mobile: { type: "string" }, home: { type: "string" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "phone", targetField: "phone", feature: "coalesce", params: { fields: ["mobile", "home"], default: "N/A" } }
    ]);
    assert.deepEqual(mapping.fields.phone, { coalesce: ["mobile", "home"], default: "N/A" });
  });

  it("value: static literal", () => {
    const inspection = { recordCount: 1, fields: {} };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "_", targetField: "source_system", feature: "value", params: { value: "crm-legacy" } }
    ]);
    assert.deepEqual(mapping.fields.source_system, { value: "crm-legacy" });
  });

  it("default value", () => {
    const inspection = { recordCount: 1, fields: { TotalSpend: { type: "number" } } };
    const mapping = mb.buildMapping(inspection, [
      { sourceField: "TotalSpend", targetField: "total", feature: "default", params: { value: 0 } }
    ]);
    assert.deepEqual(mapping.fields.total, { from: "TotalSpend", default: 0 });
  });

  it("passthrough at mapping level", () => {
    const inspection = { recordCount: 1, fields: { FullName: { type: "string" } } };
    const mapping = mb.buildMapping(inspection, [], { passthrough: true });
    assert.equal(mapping.passthrough, true);
  });

  it("passthrough with exclude", () => {
    const inspection = { recordCount: 1, fields: { FullName: { type: "string" }, internal_id: { type: "string" } } };
    const mapping = mb.buildMapping(inspection, [], { passthrough: { exclude: ["internal_id"] } });
    assert.deepEqual(mapping.passthrough, { exclude: ["internal_id"] });
  });

  it("schema at mapping level", () => {
    const inspection = { recordCount: 1, fields: { Name: { type: "string" } } };
    const schema = { Name: { required: true, type: "string" } };
    const mapping = mb.buildMapping(inspection, [], { schema });
    assert.deepEqual(mapping.schema, schema);
  });

  it("sets id when provided", () => {
    const inspection = { recordCount: 1, fields: {} };
    const mapping = mb.buildMapping(inspection, [], { id: "my-mapping" });
    assert.equal(mapping.id, "my-mapping");
  });
});

// ── buildMappingAuto() ───────────────────────────────────────────────────────

describe("buildMappingAuto()", () => {
  it("applies snake_case to all field names", () => {
    const inspection = { recordCount: 1, fields: { FullName: { type: "string", sample: "Jane" } } };
    const mapping = mb.buildMappingAuto(inspection);
    assert.ok(mapping.fields.full_name);
  });

  it("auto-detects ISO date strings → format:date", () => {
    const inspection = { recordCount: 1, fields: { CreatedDate: { type: "string", sample: "2025-01-15T08:30:00Z" } } };
    const mapping = mb.buildMappingAuto(inspection);
    assert.equal(mapping.fields.created_date.format, "date");
    assert.equal(mapping.fields.created_date.outputFormat, "YYYY-MM-DD");
  });

  it("auto-detects numeric strings → format:number", () => {
    const inspection = { recordCount: 1, fields: { Price: { type: "string", sample: "12.50" } } };
    const mapping = mb.buildMappingAuto(inspection);
    assert.equal(mapping.fields.price.format, "number");
  });

  it("dot-path fields get simple from", () => {
    const inspection = { recordCount: 1, fields: { "customer.FullName": { type: "string", sample: "Alice" } } };
    const mapping = mb.buildMappingAuto(inspection);
    // toSnakeCase("customer.FullName") → "customer.full_name" (dot is preserved; only rF→r_F is replaced)
    assert.deepEqual(mapping.fields["customer.full_name"], { from: "customer.FullName" });
  });

  it("passthrough: false by default (no passthrough key)", () => {
    const inspection = { recordCount: 1, fields: { Name: { type: "string" } } };
    const mapping = mb.buildMappingAuto(inspection);
    assert.equal(mapping.passthrough, undefined);
  });

  it("passthrough: true when option set", () => {
    const inspection = { recordCount: 1, fields: { Name: { type: "string" } } };
    const mapping = mb.buildMappingAuto(inspection, { passthrough: true });
    assert.equal(mapping.passthrough, true);
  });
});

// ── validateForFormat() ──────────────────────────────────────────────────────

describe("validateForFormat()", () => {
  it(".js format accepts compute functions", () => {
    const mapping = {
      fields: {
        full_name: { from: ["FirstName", "LastName"], compute: (f, l) => `${f} ${l}` }
      }
    };
    // Should not throw
    mb.validateForFormat(mapping, "js");
  });

  it(".json format rejects compute functions", () => {
    const mapping = {
      fields: {
        full_name: { from: ["FirstName", "LastName"], compute: (f, l) => `${f} ${l}` }
      }
    };
    assert.throws(
      () => mb.validateForFormat(mapping, "json"),
      /compute.*not supported for \.json/
    );
  });

  it(".json format rejects schema.validate custom functions", () => {
    const mapping = {
      schema: {
        Name: { required: true, validate: (v) => v.length > 0 || "must not be empty" }
      }
    };
    assert.throws(
      () => mb.validateForFormat(mapping, "json"),
      /schema\.validate.*not supported for \.json/
    );
  });

  it(".json format accepts schema with only static rules", () => {
    const mapping = {
      schema: {
        Name: { required: true, type: "string", minLength: 2, pattern: "^\\w+$" }
      }
    };
    // Should not throw
    mb.validateForFormat(mapping, "json");
  });

  it(".json format accepts nested compute in forEach", () => {
    const mapping = {
      fields: {
        items: { forEach: "LineItems", compute: (price, qty) => price * qty }
      }
    };
    assert.throws(
      () => mb.validateForFormat(mapping, "json"),
      /compute.*not supported for \.json/
    );
  });

  it("accepts 'js' format (default)", () => {
    const mapping = { fields: {} };
    mb.validateForFormat(mapping, "js");
    mb.validateForFormat(mapping);
  });
});

// ── Integration: inspect + buildMappingAuto ─────────────────────────────────

describe("Integration: inspect + buildMappingAuto on real data", () => {
  it("generates a valid mapping for test-data.json", () => {
    const inspection = mb.inspect(TEST_DATA_CRM);
    const mapping = mb.buildMappingAuto(inspection);

    // Should have all fields mapped (snake_case)
    assert.ok(mapping.fields.full_name);
    assert.ok(mapping.fields.email_addr);        // EmailAddr → email_addr
    assert.ok(mapping.fields.status_code);       // StatusCode → status_code
    assert.ok(mapping.fields.created_date);      // CreatedDate → created_date
    assert.ok(mapping.fields.last_active);       // LastActive → last_active
    assert.ok(mapping.fields.total_spend);       // TotalSpend → total_spend
    assert.ok(mapping.fields.country);

    // Dates should use format:date
    assert.equal(mapping.fields.created_date.format, "date");
    assert.equal(mapping.fields.last_active.format, "date");

    // Numbers (TotalSpend is already a number, not a string) → simple from
    // Numeric string fields like grand_total would be format:number but TotalSpend is already number type

    // No passthrough
    assert.equal(mapping.passthrough, undefined);
  });

  it("generates a valid mapping for test-data-cleaning.json", () => {
    const inspection = mb.inspect(TEST_DATA_CLEANING);
    const mapping = mb.buildMappingAuto(inspection);

    assert.ok(mapping.fields.first_name);
    assert.ok(mapping.fields.last_name);
    assert.ok(mapping.fields.price);       // number (float)
    assert.ok(mapping.fields.score);        // number (float)
    assert.ok(mapping.fields.description); // string
  });

  it("generates a valid mapping for test-nested.json", () => {
    const inspection = mb.inspect(TEST_DATA_NESTED);
    const mapping = mb.buildMappingAuto(inspection);

    assert.ok(mapping.fields.order_id);
    // customer.FullName → toSnakeCase → "customer.full_name"
    assert.ok(mapping.fields["customer.full_name"]);
    // LineItems is an array → forEach with source field name as target
    assert.ok(mapping.fields.LineItems);
    assert.equal(mapping.fields.LineItems.forEach, "LineItems");
  });
});

console.log("All tests defined — run with: node --test mapping-builder.test.js");

// ── Wizard exports ───────────────────────────────────────────────────────────

describe("Wizard exports", () => {
  it("runWizard is exported as a function", () => {
    assert.equal(typeof mb.runWizard, "function");
  });
});
