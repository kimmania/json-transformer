/**
 * demo.js — run with: node --experimental-vm-modules demo.js
 * or just:  node demo.js (works in Node 22+ with ES modules)
 */
import { transform, transformOne } from "./transform.js";
import crmMigration from "./examples/mapping-crm-example.js";

// ── Sample source data ────────────────────────────────────────
const source = [
  {
    FullName: "Jane Doe",
    FirstName: "Jane",
    LastName: "Doe",
    EmailAddr: "JANE@Example.com",
    StatusCode: "A",
    CreatedDate: "2025-01-15T08:30:00Z",
    LastActive: "2025-06-20T14:22:00Z",
    TotalSpend: 12500,
    Country: "us",
  },
  {
    FullName: "John Smith",
    FirstName: "John",
    LastName: "Smith",
    EmailAddr: "JOHN@Test.com",
    StatusCode: "I",
    CreatedDate: "2023-03-07T12:00:00Z",
    LastActive: "2024-01-10T09:15:00Z",
    TotalSpend: 3200,
    Country: "uk",
  },
  {
    FullName: "Bob Jones",
    FirstName: "Bob",
    LastName: "Jones",
    EmailAddr: "bob@demo.com",
    StatusCode: "P",
    CreatedDate: "2025-11-01T18:00:00Z",
    LastActive: "2025-11-01T18:00:00Z",
    TotalSpend: 0,
    Country: "ca",
  },
];

console.log("═══ Mapping:", crmMigration.id, "═══\n");

const results = transform(source, crmMigration);

for (const row of results) {
  console.log(JSON.stringify(row, null, 2));
  console.log("---");
}

// ── Show transformOne for a single record ─────────────────────
const single = transformOne(source[0], crmMigration);
console.log("\n═══ Single record (transformOne) ═══\n");
console.log(JSON.stringify(single, null, 2));
