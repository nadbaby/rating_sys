// server.js
// Main Node.js Express server to host the feedback portal and APIs.

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbHelper } from './js/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Initialize database
dbHelper.init();

// ==================== API Endpoints ====================

// Admin Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const success = dbHelper.verifyAdmin(email, password);
  if (success) {
    // Return a simple session token
    res.json({ success: true, token: "admin_token_session" });
  } else {
    res.status(401).json({ error: "Invalid credentials." });
  }
});

// Get all employees
app.get('/api/employees', (req, res) => {
  try {
    const list = dbHelper.getEmployees();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get employee by ID
app.get('/api/employees/:id', (req, res) => {
  try {
    const employee = dbHelper.getEmployeeById(req.params.id);
    if (employee) {
      res.json(employee);
    } else {
      res.status(404).json({ error: "Employee not found." });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new employee
app.post('/api/employees', (req, res) => {
  const { employeeId, name, category } = req.body;
  if (!employeeId || !name) {
    return res.status(400).json({ error: "Employee ID and Name are required." });
  }

  try {
    const created = dbHelper.addEmployee({ employeeId, name, category });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update employee KPIs
app.post('/api/employees/:id/kpi', (req, res) => {
  try {
    const updated = dbHelper.updateEmployeeKpi(req.params.id, req.body);
    if (updated) {
      res.json(updated);
    } else {
      res.status(404).json({ error: "Employee not found." });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete employee
app.delete('/api/employees/:id', (req, res) => {
  try {
    const success = dbHelper.deleteEmployee(req.params.id);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Employee not found." });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get feedback entries
app.get('/api/feedback', (req, res) => {
  const { dateFrom, dateTo } = req.query;
  try {
    const list = dbHelper.getFeedback(dateFrom, dateTo);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add feedback
app.post('/api/feedback', (req, res) => {
  const { employeeId, counter, rating, comment, customerName } = req.body;
  if (rating === undefined) {
    return res.status(400).json({ error: "Rating is required." });
  }

  try {
    const created = dbHelper.addFeedback({ employeeId, counter, rating, comment, customerName });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== Serve Static Frontend Files ====================

// Serve static assets (js, css, images)
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/icons', express.static(path.join(__dirname, 'icons')));

app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'sw.js'));
});

// Serve firebase-config.js specifically
app.get('/firebase-config.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'firebase-config.js'));
});

// Serve index.html as homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve other HTML pages directly
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
