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
      createdAt: new Date().toISOString()
    });

    writeDb(data);
    return employee;
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
      id: Math.random().toString(36).substr(2, 9),
      employeeId: feedback.employeeId || null,
      counter: feedback.counter || "Unknown Counter",
      customerName: feedback.customerName || "Anonymous",
      rating: Number(feedback.rating),
      comment: feedback.comment || null,
      createdAt: new Date().toISOString()
    };

    data.feedback.push(newFeedback);
    writeDb(data);
    return newFeedback;
  }
};
