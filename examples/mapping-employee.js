/**
 * Advanced mapping demo — shows composite conditions (and/or/not) and edge cases.
 */
export default {
  id: "employee-import",
  fields: {
    // ── Composite: AND ────────────────────────────────────────────
    // Eligible for bonus if active AND tenure > 1 year AND salary > 50000
    bonus_eligible: {
      if: {
        and: [
          { field: "Status", op: "eq", value: "active" },
          { field: "YearsEmployed", op: "gt", value: 1 },
          { field: "Salary", op: "gt", value: 50000 },
        ],
      },
      then: true,
      else: false,
    },

    // ── Composite: OR ─────────────────────────────────────────────
    // Eligible for remote if in engineering OR in leadership
    remote_ok: {
      if: {
        or: [
          { field: "Department", op: "eq", value: "Engineering" },
          { field: "Department", op: "eq", value: "Management" },
          { field: "Title", op: "matches", value: "(?i)(director|vp|chief)" },
        ],
      },
      then: true,
      else: false,
    },

    // ── Composite: NOT ────────────────────────────────────────────
    // Flag if NOT active
    needs_review: {
      if: {
        not: { field: "Status", op: "eq", value: "active" },
      },
      then: true,
      else: false,
    },

    // ── Deeply nested (and containing an or) ──────────────────────
    // Senior IC if (Engineering OR Data) AND (senior OR staff) AND NOT contractor
    senior_ic: {
      if: {
        and: [
          {
            or: [
              { field: "Department", op: "eq", value: "Engineering" },
              { field: "Department", op: "eq", value: "Data" },
            ],
          },
          {
            or: [
              { field: "Level", op: "eq", value: "senior" },
              { field: "Level", op: "eq", value: "staff" },
              { field: "Level", op: "eq", value: "principal" },
            ],
          },
          { field: "EmployeeType", op: "neq", value: "contractor" },
        ],
      },
      then: true,
      else: false,
    },

    // ── Leaf condition: simple operator ───────────────────────────
    employment_type: {
      if:    { field: "HourlyRate", op: "gt", value: 0 },
      then:  "hourly",
      else:  "salaried",
    },

    email_valid: {
      if:    { field: "Email", op: "matches", value: "^[^@]+@[^@]+\\.[^@]+$" },
      then:  true,
      else:  false,
    },

    // exists operator
    emergency_contact: {
      if:    { field: "EmergencyPhone", op: "exists", value: true },
      then:  { from: "EmergencyPhone" },  // nest: use the actual field value
      else:  "N/A",
    },

    // Type coercions
    age:      { from: "BirthYear", format: "number" },
    name:     { from: "EmployeeName", format: "trim" },

    // Multi-source with value map
    dept_code: { from: "Department", map: {
      "Engineering": "ENG",
      "Marketing":   "MKT",
      "Sales":       "SAL",
      "HR":          "HRS",
    }},
  },
};
