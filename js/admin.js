// js/admin.js
// Handles admin login, authentication state, dashboard data fetching, analytics, employee directory, and CSV export.

import { auth, db } from "./firebase-init.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { 
  collection, query, where, orderBy, getDocs, Timestamp, doc, getDoc, setDoc, deleteDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// Helper to format date to YYYY-MM-DD
function formatDate(ts) {
  if (!ts) return "N/A";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "N/A";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Escape HTML to prevent XSS
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// CSV export utility
function downloadCSV(csvContent, filename = "feedback.csv") {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Toast notification helper
function showToast(msg) {
  const toast = document.getElementById("toast");
  if (toast) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 3000);
  }
}

// Helper to build employee feedback link
function getEmployeeFeedbackLink(employeeId) {
  const currentUrl = window.location.href;
  let baseUrl = currentUrl.split('?')[0];
  if (baseUrl.endsWith('admin.html')) {
    baseUrl = baseUrl.replace('admin.html', 'index.html');
  } else {
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }
    baseUrl += 'index.html';
  }
  return `${baseUrl}?empId=${encodeURIComponent(employeeId)}`;
}

// ==================== Login Page Logic ====================
if (document.getElementById("loginForm")) {
  const loginForm = document.getElementById("loginForm");
  const errorDiv = document.getElementById("loginError");
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Redirect to dashboard after successful login
      window.location.href = "admin.html";
    } catch (err) {
      console.error(err);
      errorDiv.style.display = "block";
    }
  });
}

// ==================== Dashboard Page Logic (admin.html) ====================
if (document.getElementById("dashboardSection")) {
  // Ensure the user is authenticated via Firebase Auth
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    initDashboard();
  });

  async function initDashboard() {
    const totalFeedbackEl = document.getElementById("totalFeedback");
    const avgRatingEl = document.getElementById("avgRating");
    const todayFeedbackEl = document.getElementById("todayFeedback");
    const bestCounterEl = document.getElementById("bestCounter");
    const worstCounterEl = document.getElementById("worstCounter");
    const recentCommentsEl = document.getElementById("recentComments");
    const applyFilterBtn = document.getElementById("applyFilter");
    
    // Create and insert Export CSV button
    const exportBtn = document.createElement("button");
    exportBtn.className = "btn-secondary";
    exportBtn.innerHTML = `
      <svg class="tab-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
      Export CSV
    `;
    exportBtn.onclick = () => exportCSV();
    applyFilterBtn.parentNode.appendChild(exportBtn);

    // Wire Logout Button
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try {
          await signOut(auth);
          window.location.href = "login.html";
        } catch (err) {
          console.error("Logout error:", err);
        }
      });
    }

    // Tabs Navigation Logic
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");
    tabBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");
        
        tabBtns.forEach(b => b.classList.remove("active"));
        tabContents.forEach(c => c.classList.remove("active"));
        
        btn.classList.add("active");
        const targetContent = document.getElementById(targetTab);
        if (targetContent) targetContent.classList.add("active");
      });
    });

    // Wire Add Employee Form
    const addEmployeeForm = document.getElementById("addEmployeeForm");
    if (addEmployeeForm) {
      addEmployeeForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const empId = document.getElementById("newEmpId").value.trim();
        const empName = document.getElementById("newEmpName").value.trim();

        if (!empId || !empName) return;

        try {
          const empDocRef = doc(db, "employees", empId);
          const empDocSnap = await getDoc(empDocRef);

          if (empDocSnap.exists()) {
            alert("An employee with this ID already exists. Please choose a different unique ID.");
            return;
          }

          await setDoc(empDocRef, {
            employeeId: empId,
            name: empName,
            createdAt: serverTimestamp()
          });

          addEmployeeForm.reset();
          showToast("Employee registered successfully!");
          await refreshDashboardAndEmployees();
        } catch (err) {
          console.error("Error adding employee:", err);
          alert("Could not register employee. Please try again.");
        }
      });
    }

    // Wire Employee List Click Handlers (Copy Link, Delete Employee)
    const tbody = document.getElementById("employeeTableBody");
    if (tbody) {
      tbody.addEventListener("click", async (e) => {
        // Copy link handler
        if (e.target.classList.contains("btn-copy")) {
          const link = e.target.getAttribute("data-link");
          try {
            await navigator.clipboard.writeText(link);
            showToast("Feedback link copied!");
          } catch (err) {
            console.error("Failed to copy link:", err);
            alert("Could not copy link automatically. Here it is:\n" + link);
          }
        }

        // Delete employee handler
        if (e.target.classList.contains("btn-delete")) {
          const empId = e.target.getAttribute("data-id");
          const empName = e.target.getAttribute("data-name");

          if (confirm(`Are you sure you want to delete employee "${empName}" (${empId})?`)) {
            try {
              await deleteDoc(doc(db, "employees", empId));
              showToast("Employee removed successfully!");
              await refreshDashboardAndEmployees();
            } catch (err) {
              console.error("Error deleting employee:", err);
              alert("Could not delete employee. Please try again.");
            }
          }
        }
      });
    }

    // Load feedback data (with optional date filter)
    async function loadData() {
      const fromDate = document.getElementById("dateFrom").value;
      const toDate = document.getElementById("dateTo").value;
      let q = collection(db, "feedback");
      const constraints = [];
      if (fromDate) constraints.push(where("createdAt", ">=", Timestamp.fromDate(new Date(fromDate))));
      if (toDate) constraints.push(where("createdAt", "<=", Timestamp.fromDate(new Date(toDate))));
      if (constraints.length) q = query(q, ...constraints, orderBy("createdAt", "desc"));
      else q = query(q, orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);
      const feedbacks = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        feedbacks.push({ id: doc.id, ...data });
      });
      return feedbacks;
    }

    // Load employee directory
    async function loadEmployees() {
      const q = query(collection(db, "employees"), orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);
      const employees = [];
      snapshot.forEach((doc) => {
        employees.push(doc.data());
      });
      return employees;
    }

    // Refresh entire data & view
    async function refreshDashboardAndEmployees() {
      const feedbacks = await loadData();
      const employees = await loadEmployees();
      renderDashboard(feedbacks, employees);
    }

    // Render dashboard and directory elements
    function renderDashboard(feedbacks, employees) {
      const total = feedbacks.length;
      const avgRating = total ? (feedbacks.reduce((sum, f) => sum + f.rating, 0) / total).toFixed(2) : "0.00";
      const todayStr = formatDate(Timestamp.fromDate(new Date()));
      const todayCount = feedbacks.filter((f) => formatDate(f.createdAt) === todayStr).length;

      // Group feedback for Stats Grid
      const counterMap = {};
      const empStats = {}; // employeeId -> { count, sum }

      feedbacks.forEach((f) => {
        // Counter-wise stats (works for legacy counters and new employee names mapped to f.counter)
        if (!counterMap[f.counter]) counterMap[f.counter] = { count: 0, sum: 0 };
        counterMap[f.counter].count += 1;
        counterMap[f.counter].sum += f.rating;

        // Employee specific ID stats
        if (f.employeeId) {
          if (!empStats[f.employeeId]) {
            empStats[f.employeeId] = { count: 0, sum: 0 };
          }
          empStats[f.employeeId].count += 1;
          empStats[f.employeeId].sum += f.rating;
        }
      });

      let bestCounter = "-";
      let worstCounter = "-";
      let bestAvg = -1;
      let worstAvg = 11;
      for (const [name, stats] of Object.entries(counterMap)) {
        const avg = stats.sum / stats.count;
        if (avg > bestAvg) {
          bestAvg = avg;
          bestCounter = `${name} (${avg.toFixed(2)})`;
        }
        if (avg < worstAvg) {
          worstAvg = avg;
          worstCounter = `${name} (${avg.toFixed(2)})`;
        }
      }

      // Recent comments (latest 5 with non‑empty comment)
      const recent = feedbacks.filter((f) => f.comment && f.comment.trim()).slice(0, 5);

      // Update Dashboard DOM
      totalFeedbackEl.textContent = total;
      avgRatingEl.textContent = avgRating;
      todayFeedbackEl.textContent = todayCount;
      bestCounterEl.textContent = bestCounter;
      worstCounterEl.textContent = worstCounter;

      recentCommentsEl.innerHTML = "";
      if (recent.length === 0) {
        recentCommentsEl.innerHTML = '<div class="no-data">No comments available.</div>';
      } else {
        recent.forEach((f) => {
          const div = document.createElement("div");
          div.className = "comment-item";
          const starsStr = "★".repeat(f.rating) + "☆".repeat(5 - f.rating);
          const dateStr = formatDate(f.createdAt);

          div.innerHTML = `
            <div class="comment-meta">
              <span class="comment-meta-target">${escapeHtml(f.counter)}</span>
              <span class="comment-rating">${starsStr}</span>
            </div>
            <div class="comment-text">"${escapeHtml(f.comment)}"</div>
            <div class="comment-meta">
              <span>By: ${escapeHtml(f.customerName || "Anonymous")}</span>
              <span>Date: ${dateStr}</span>
            </div>
          `;
          recentCommentsEl.appendChild(div);
        });
      }

      // Render Employee List Table
      renderEmployeeTable(employees, empStats);

      // Render Leaderboard Table
      renderLeaderboard(employees, empStats);
    }

    // Render Table inside Employee Tab
    function renderEmployeeTable(employees, empStats) {
      const tbody = document.getElementById("employeeTableBody");
      tbody.innerHTML = "";

      if (employees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="no-data">No employees registered yet.</td></tr>';
        return;
      }

      employees.forEach((emp) => {
        const stats = empStats[emp.employeeId] || { count: 0, sum: 0 };
        const avg = stats.count ? (stats.sum / stats.count).toFixed(2) : "-";
        
        let starsStr = "";
        if (stats.count) {
          const roundedAvg = Math.round(stats.sum / stats.count);
          starsStr = "★".repeat(roundedAvg) + "☆".repeat(5 - roundedAvg);
        } else {
          starsStr = "☆☆☆☆☆";
        }

        const link = getEmployeeFeedbackLink(emp.employeeId);

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><span class="emp-id-badge">${escapeHtml(emp.employeeId)}</span></td>
          <td class="emp-name">${escapeHtml(emp.name)}</td>
          <td>
            <div class="emp-rating">
              <span>${avg}</span>
              <span class="emp-rating-stars">${starsStr}</span>
            </div>
          </td>
          <td>${stats.count} reviews</td>
          <td>
            <div class="emp-link-container">
              <input type="text" readonly class="emp-link-input" value="${link}" />
              <button class="btn-secondary btn-copy" data-link="${link}">Copy Link</button>
            </div>
          </td>
          <td>
            <button class="btn-danger btn-delete" data-id="${emp.employeeId}" data-name="${emp.name}">Delete</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Render Table inside Leaderboard Tab
    function renderLeaderboard(employees, empStats) {
      const tbody = document.getElementById("leaderboardTableBody");
      tbody.innerHTML = "";

      if (employees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="no-data">No employees registered yet.</td></tr>';
        return;
      }

      // Map stats and calculate average
      const ranked = employees.map(emp => {
        const stats = empStats[emp.employeeId] || { count: 0, sum: 0 };
        const avg = stats.count ? stats.sum / stats.count : 0;
        return {
          ...emp,
          avg: avg,
          count: stats.count
        };
      });

      // Sort by average rating descending, then by reviews count descending
      ranked.sort((a, b) => {
        if (b.avg !== a.avg) {
          return b.avg - a.avg;
        }
        return b.count - a.count;
      });

      ranked.forEach((emp, index) => {
        const rank = index + 1;
        let rankClass = "rank-other";
        if (rank === 1) rankClass = "rank-1";
        else if (rank === 2) rankClass = "rank-2";
        else if (rank === 3) rankClass = "rank-3";

        const avgText = emp.count ? emp.avg.toFixed(2) : "0.00";
        const percentage = emp.count ? (emp.avg / 5) * 100 : 0;

        let starsStr = "";
        if (emp.count) {
          const roundedAvg = Math.round(emp.avg);
          starsStr = "★".repeat(roundedAvg) + "☆".repeat(5 - roundedAvg);
        } else {
          starsStr = "☆☆☆☆☆";
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><span class="rank-badge ${rankClass}">${rank}</span></td>
          <td class="emp-name">${escapeHtml(emp.name)}</td>
          <td><span class="emp-id-badge">${escapeHtml(emp.employeeId)}</span></td>
          <td>
            <div class="emp-rating">
              <span>${avgText}</span>
              <span class="emp-rating-stars">${starsStr}</span>
            </div>
          </td>
          <td>${emp.count} rating${emp.count === 1 ? "" : "s"}</td>
          <td>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" style="width: ${percentage}%"></div>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }



    // Export to CSV
    async function exportCSV() {
      const data = await loadData();
      let csv = "Counter,EmployeeId,CustomerName,Rating,Comment,CreatedAt\n";
      data.forEach((f) => {
        const row = [
          `"${f.counter || ""}"`,
          `"${f.employeeId || ""}"`,
          `"${f.customerName || "Anonymous"}"`,
          f.rating,
          `"${(f.comment || "").replace(/"/g, '""')}"`,
          formatDate(f.createdAt),
        ].join(",");
        csv += row + "\n";
      });
      downloadCSV(csv);
    }

    applyFilterBtn.addEventListener("click", refreshDashboardAndEmployees);
    // Initial fetch
    refreshDashboardAndEmployees();
  }
}
