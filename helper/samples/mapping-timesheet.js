/**
 * Time tracking import — enriches timesheet data with employee and department info.
 *
 * Demonstrates:
 *   - External dictionary loading ($file + indexBy)
 *   - Inline dictionaries (statusMap)
 *   - lookupPath to drill into nested dictionary values
 *   - Missing key default fallback
 *   - compute() with dictionary access for multi-hop lookups
 */
export default {
  id: "timesheet-enrich",

  dictionaries: {
    // External: load from JSON file, index by employee_id
    employees: {
      $file: "./dictionaries/employees.json",
      indexBy: "employee_id",
    },
    departments: {
      $file: "./dictionaries/departments.json",
      indexBy: "code",
    },
    // Inline value map
    statusMap: {
      "A": "Approved",
      "P": "Pending",
      "L": "Late",
    },
  },

  fields: {
    // ── Fields from timesheet data ──────────────────────────
    week:         { from: "week" },
    hours:        { from: "hours", format: "number" },
    project:      { from: "project_code" },
    entry_status: { from: "status", lookup: "statusMap" },

    // ── Simple dictionary lookup: employee_id → employee record ──
    employee_id:   { from: "employee_id" },

    // ── Lookup with lookupPath: get specific field from the employee record ──
    employee_name: { from: "employee_id", lookup: "employees", lookupPath: "full_name" },
    hire_date:     { from: "employee_id", lookup: "employees", lookupPath: "hire_date", format: "date", outputFormat: "MMMM DD, YYYY" },
    mgr_id:        { from: "employee_id", lookup: "employees", lookupPath: "manager_id" },

    // ── Default when employee not found ──────────────────────
    dept_code: {
      from: "employee_id",
      lookup: "employees",
      lookupPath: "dept_code",
      default: "UNASSIGNED",
      format: "uppercase",
    },

    // ── Multi-hop lookup via compute (employee → dept → department name) ──
    department: {
      from: ["employee_id"],
      compute: (empId, row, dicts) => {
        const emp = dicts.employees?.[empId];
        if (!emp) return "Unknown Department";
        const dept = dicts.departments?.[emp.dept_code];
        return dept?.name ?? emp.dept_code;
      },
    },
    budget_center: {
      from: ["employee_id"],
      compute: (empId, row, dicts) => {
        const emp = dicts.employees?.[empId];
        if (!emp) return "N/A";
        return dicts.departments?.[emp.dept_code]?.budget_center ?? "N/A";
      },
    },

    // ── Manager name via compute (two-hop through employees dictionary) ──
    manager: {
      from: ["employee_id"],
      compute: (empId, row, dicts) => {
        const emp = dicts.employees?.[empId];
        if (!emp || !emp.manager_id) return "No manager";
        const mgr = dicts.employees?.[emp.manager_id];
        return mgr?.full_name ?? emp.manager_id;
      },
      default: "No manager",
    },
  },
};
