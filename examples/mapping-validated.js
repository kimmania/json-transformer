/**
 * Validated employee import — demonstrates schema validation.
 *
 * The schema block is checked by validate() before transforming. All errors
 * are collected across every row so you get a complete picture at once:
 *
 *   const { valid, errors } = validate(source, mapping);
 *   if (valid) {
 *     const data = transform(source, mapping);
 *   }
 *
 * Run with:
 *   node cli.js transform -d test-invalid.json -m mapping-validated.js
 *
 * Expected output: 3 transformed records + validation errors for rows 1 and 2.
 */
export default {
  id: "employee-validated",

  schema: {
    // required + type
    EmployeeID: { required: true, type: "string" },

    // required + minLength
    Name: { required: true, type: "string", minLength: 2 },

    // numeric range
    Age: { required: true, type: "number", min: 16, max: 120 },

    // required + regex pattern
    Email: { required: true, pattern: "^[^@]+@[^@]+\\.[^@]+$" },

    // optional but must be non-negative if present
    Salary: { type: "number", min: 0 },

    // custom validate function
    Department: {
      validate: (v) =>
        ["Engineering", "Marketing", "Sales", "HR"].includes(v) ||
        `"${v}" is not a recognised department`,
    },
  },

  fields: {
    id:         { from: "EmployeeID" },
    name:       { from: "Name",       format: "titlecase" },
    age:        { from: "Age",        format: "number" },
    email:      { from: "Email",      format: "lowercase" },
    salary:     { from: "Salary",     format: "number", default: 0 },
    department: { from: "Department", format: "uppercase" },
  },
};
