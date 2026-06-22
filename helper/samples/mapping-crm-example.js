/**
 * Example mapping: legacy CRM → modern schema
 *
 * This file exports a reusable mapping definition that can be
 * imported anywhere and passed to transform().
 */
export default {
  id: "crm-legacy-to-modern",
  version: "1.0.0",
  fields: {
    // ── 1. Simple rename ──────────────────────────────────────
    full_name:       { from: "FullName" },
    email_address:   { from: "EmailAddr" },

    // ── 2. Value map (status codes → human-readable) ──────────
    status:          { from: "StatusCode", map: {
      "A": "active",
      "I": "inactive",
      "P": "pending",
      "X": "cancelled",
    }},

    // ── 3. Date formatting ────────────────────────────────────
    created:         { from: "CreatedDate", format: "date", outputFormat: "YYYY-MM-DD" },
    last_login:      { from: "LastActive",  format: "date", outputFormat: "MM/DD/YYYY hh:mm AMPM" },
    join_month:      { from: "CreatedDate", format: "date", outputFormat: "MMMM" },

    // ── 4. Conditional logic ──────────────────────────────────
    tier: {
      if:    { field: "TotalSpend", op: "gte", value: 10000 },
      then:  "platinum",
      thenMap: { platinum: "VIP Platinum" },   // optional post-map on the then value
    },
    is_vip: {
      if:    { field: "StatusCode", op: "eq", value: "A" },
      then:  true,
      else:  false,
    },

    // ── 5. Computed field (multi-field, custom function) ──────
    display_name: {
      from: ["FirstName", "LastName"],
      compute: (first, last, row) => `${first} ${last}`.trim(),
    },

    // ── 6. Static / literal value ─────────────────────────────
    source_system: { value: "crm-legacy" },

    // ── 7. Format-only transforms ─────────────────────────────
    country:       { from: "Country", format: "uppercase" },
    email_lower:   { from: "EmailAddr", format: "lowercase" },

    // ── 8. Conditional with computed else ─────────────────────
    message: {
      if:    { field: "StatusCode", op: "in", value: ["A", "P"] },
      then:  "Welcome!",
      else:  "Account is currently unavailable.",
    },
  },
};
