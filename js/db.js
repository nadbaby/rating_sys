// js/db.js
// A simple, robust, server-side JSON file database helper.

import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'db.json');

// Default initial database state
const defaultDb = {
  employees: [],
  feedback: [],
  admin: {
    email: process.env.ADMIN_EMAIL || "boss@fine.com",
    password: process.env.ADMIN_PASSWORD || "boss123"
  }
};

// Helper to read database
function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      writeDb(defaultDb);
      return defaultDb;
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading db file:", err);
    return defaultDb;
  }
}

// Helper to write database atomically
function writeDb(data) {
  try {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
    return true;
  } catch (err) {
    console.error("Error writing db file:", err);
    return false;
  }
}

// Database CRUD operations
export const dbHelper = {
  init() {
    readDb();
    console.log("Database initialized at:", DB_FILE);
  },

  // Admin login check
  verifyAdmin(email, password) {
    const data = readDb();
    // Support dynamic env updates or file storage
    const adminEmail = process.env.ADMIN_EMAIL || data.admin.email;
    const adminPassword = process.env.ADMIN_PASSWORD || data.admin.password;
    return email === adminEmail && password === adminPassword;
  },

  // Employees
  getEmployees() {
    const data = readDb();
    return data.employees || [];
  },

  getEmployeeById(id) {
    const data = readDb();
    return (data.employees || []).find(e => e.employeeId === id) || null;
  },

  addEmployee(employee) {
    const data = readDb();
    if (!data.employees) data.employees = [];

    // Check for duplicate ID
    if (data.employees.some(e => e.employeeId === employee.employeeId)) {
      throw new Error("Employee ID already exists");
    }

    data.employees.push({
      employeeId: employee.employeeId,
      name: employee.name,
      category: employee.category || "Sales",
      createdAt: new Date().toISOString()
    });

    writeDb(data);
    return employee;
  },

  updateEmployeeKpi(id, kpi) {
    const data = readDb();
    if (!data.employees) data.employees = [];

    const empIndex = data.employees.findIndex(e => e.employeeId === id);
    if (empIndex !== -1) {
      const getNum = (val, def) => (val !== undefined && val !== null && !isNaN(Number(val))) ? Number(val) : def;
      
      data.employees[empIndex] = {
        ...data.employees[empIndex],
        name: kpi.name || data.employees[empIndex].name,
        category: kpi.category || data.employees[empIndex].category || "Sales",
        // Standard/Common KPIs
        discipline: getNum(kpi.discipline, 10.0),
        attendance: getNum(kpi.attendance, 10.0),
        penalty: getNum(kpi.penalty, 0.0),
        penaltyComments: kpi.penaltyComments || "",
        improvements: kpi.improvements || "",
        pickedItems: getNum(kpi.pickedItems, 0),
        indentNumbers: getNum(kpi.indentNumbers, 0),
        kpiUpdatedAt: kpi.kpiUpdatedAt || new Date().toISOString(),

        // Sales specific KPIs
        customerHandling: getNum(kpi.customerHandling, 10.0),
        billingAccuracy: getNum(kpi.billingAccuracy, 10.0),
        independentHandling: getNum(kpi.independentHandling, 10.0),
        followUpReport: getNum(kpi.followUpReport, 10.0),
        customerSatisfaction: getNum(kpi.customerSatisfaction, 10.0),
        cleanliness: getNum(kpi.cleanliness, 10.0),

        // Store specific KPIs
        pickingAccuracy: getNum(kpi.pickingAccuracy, 10.0),
        stockSorting: getNum(kpi.stockSorting, 10.0),
        materialSecurity: getNum(kpi.materialSecurity, 10.0),
        storeCleanliness: getNum(kpi.storeCleanliness, 10.0),

        // Admin/Accounts specific KPIs
        billingTaxAccuracy: getNum(kpi.billingTaxAccuracy, 10.0),
        paymentFollowUp: getNum(kpi.paymentFollowUp, 10.0),
        filingBookkeeping: getNum(kpi.filingBookkeeping, 10.0),
        officeDecorum: getNum(kpi.officeDecorum, 10.0)
      };
      writeDb(data);
      return data.employees[empIndex];
    }
    return null;
  },

  deleteEmployee(id) {
    const data = readDb();
    if (!data.employees) return false;

    const initialLength = data.employees.length;
    data.employees = data.employees.filter(e => e.employeeId !== id);

    // Optional: remove their feedback or keep it? We keep it to preserve historical statistics

    if (data.employees.length < initialLength) {
      writeDb(data);
      return true;
    }
    return false;
  },

  // Feedback
  getFeedback(fromDate, toDate) {
    const data = readDb();
    let list = data.feedback || [];

    if (fromDate) {
      const fromTs = new Date(fromDate).getTime();
      list = list.filter(f => new Date(f.createdAt).getTime() >= fromTs);
    }
    if (toDate) {
      const toTs = new Date(toDate).getTime();
      list = list.filter(f => new Date(f.createdAt).getTime() <= toTs);
    }

    // Sort by createdAt descending
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  addFeedback(feedback) {
    const data = readDb();
    if (!data.feedback) data.feedback = [];

    const newFeedback = {
      id: feedback.id || Math.random().toString(36).substr(2, 9),
      employeeId: feedback.employeeId || null,
      counter: feedback.counter || "Unknown Counter",
      customerName: feedback.customerName || "Anonymous",
      rating: Number(feedback.rating),
      comment: feedback.comment || null,
      createdAt: feedback.createdAt || new Date().toISOString()
    };

    data.feedback.push(newFeedback);
    writeDb(data);
    return newFeedback;
  },

  syncEmployees(employeesList) {
    const data = readDb();
    if (!data.employees) data.employees = [];
    
    employeesList.forEach(emp => {
      const idx = data.employees.findIndex(e => e.employeeId === emp.employeeId);
      if (idx !== -1) {
        data.employees[idx] = {
          ...data.employees[idx],
          ...emp
        };
      } else {
        data.employees.push(emp);
      }
    });
    
    writeDb(data);
    return true;
  },

  syncFeedback(feedbackList) {
    const data = readDb();
    if (!data.feedback) data.feedback = [];
    
    feedbackList.forEach(fb => {
      const idx = data.feedback.findIndex(f => f.id === fb.id);
      if (idx !== -1) {
        data.feedback[idx] = fb;
      } else {
        data.feedback.push(fb);
      }
    });
    
    writeDb(data);
    return true;
  }
};
