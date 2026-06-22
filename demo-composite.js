/**
 * Test composite conditions (and/or/not)
 */
import { transform } from "./transform.js";
import employeeMapping from "./examples/mapping-employee.js";

const employees = [
  {
    EmployeeName: "Jane Smith",
    Department: "Engineering",
    Level: "senior",
    Status: "active",
    YearsEmployed: 5,
    Salary: 120000,
    EmployeeType: "fulltime",
    Title: "Senior Engineer",
    HourlyRate: 0,
    Email: "jane@example.com",
    BirthYear: 1985,
  },
  {
    EmployeeName: "Bob Jones",
    Department: "Data",
    Level: "staff",
    Status: "active",
    YearsEmployed: 3,
    Salary: 95000,
    EmployeeType: "fulltime",
    Title: "Staff Data Scientist",
    HourlyRate: 0,
    Email: "bob@example.com",
    BirthYear: 1990,
  },
  {
    EmployeeName: "Alice Temp",
    Department: "Engineering",
    Level: "senior",
    Status: "active",
    YearsEmployed: 2,
    Salary: 80000,
    EmployeeType: "contractor",
    Title: "Contract Senior Dev",
    HourlyRate: 0,
    Email: "alice@contractor.com",
    BirthYear: 1988,
  },
  {
    EmployeeName: "Tom Sales",
    Department: "Sales",
    Level: "junior",
    Status: "inactive",
    YearsEmployed: 1,
    Salary: 45000,
    EmployeeType: "fulltime",
    Title: "Sales Associate",
    HourlyRate: 0,
    Email: "tom@example.com",
    BirthYear: 1995,
  },
  {
    EmployeeName: "CEO Sarah",
    Department: "Management",
    Level: "executive",
    Status: "active",
    YearsEmployed: 10,
    Salary: 250000,
    EmployeeType: "fulltime",
    Title: "Chief Executive Officer",
    HourlyRate: 0,
    Email: "sarah@example.com",
    BirthYear: 1975,
  },
];

console.log("═══ Employee Mapping: " + employeeMapping.id + " ═══\n");

const results = transform(employees, employeeMapping);

for (const row of results) {
  console.log(JSON.stringify(row, null, 2));
  console.log("---");
}
