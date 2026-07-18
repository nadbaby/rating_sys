// js/admin.js
// Handles admin login, authentication state, dashboard data fetching, analytics, employee directory, and CSV export.

import { auth, db } from "./firebase-init.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { 
  collection, query, where, orderBy, getDocs, Timestamp, doc, getDoc, setDoc, deleteDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

function parseDate(ts) {
  if (!ts) return null;
  if (ts.toDate && typeof ts.toDate === "function") {
    return ts.toDate();
  }
  if (ts.seconds !== undefined) {
    return new Date(ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1000000));
  }
  if (ts._seconds !== undefined) {
    return new Date(ts._seconds * 1000 + Math.floor((ts._nanoseconds || 0) / 1000000));
  }
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

// Helper to format date to YYYY-MM-DD
function formatDate(ts) {
  const d = parseDate(ts);
  if (!d) return "N/A";
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
// Global flag for Firebase vs Local mode
let useFirebase = true;

if (document.getElementById("loginForm")) {
  const loginForm = document.getElementById("loginForm");
  const errorDiv = document.getElementById("loginError");
  const submitBtn = loginForm.querySelector("button[type='submit']");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    // Disable button to prevent duplicate submissions
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in...";
    errorDiv.style.display = "none";

    const isEmployeeAttempt = !email.includes("@");

    if (isEmployeeAttempt) {
      const empName = email;
      let employees = [];

      // Race Firestore and local API — use whichever responds first with data
      try {
        const [fbResult, apiResult] = await Promise.allSettled([
          getDocs(collection(db, "employees")),
          fetch("/api/employees").then(r => r.ok ? r.json() : [])
        ]);

        if (fbResult.status === "fulfilled" && fbResult.value.size > 0) {
          fbResult.value.forEach((doc) => employees.push({ id: doc.id, ...doc.data() }));
        } else if (apiResult.status === "fulfilled" && Array.isArray(apiResult.value) && apiResult.value.length > 0) {
          employees = apiResult.value;
        }
      } catch (err) {
        console.warn("Employee fetch error during login:", err);
      }

      const emp = employees.find(e => e.name.trim().toLowerCase() === empName.toLowerCase());
      if (emp) {
        const expectedPass = emp.name.trim().toLowerCase() + '123';
        if (password.trim().toLowerCase() === expectedPass) {
          let baseUrl = window.location.href.split('?')[0];
          baseUrl = baseUrl.replace('login.html', 'index.html');
          window.location.href = `${baseUrl}?empId=${encodeURIComponent(emp.employeeId || emp.id)}&view=progress`;
          return;
        }
      }

      errorDiv.style.display = "block";
      errorDiv.textContent = "Invalid employee name or password.";
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      return;
    }
    
    let loggedIn = false;
    
    // Race Firebase Auth and local API login in parallel
    try {
      const [fbResult, localResult] = await Promise.allSettled([
        signInWithEmailAndPassword(auth, email, password),
        fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        }).then(r => r.ok ? r.json() : null)
      ]);

      if (fbResult.status === "fulfilled") {
        sessionStorage.setItem("auth_mode", "firebase");
        loggedIn = true;
      } else if (localResult.status === "fulfilled" && localResult.value?.success) {
        sessionStorage.setItem("auth_mode", "local");
        sessionStorage.setItem("local_token", localResult.value.token);
        loggedIn = true;
      }
    } catch (err) {
      console.error("Login error:", err);
    }
    
    if (loggedIn) {
      window.location.href = "admin.html";
    } else {
      errorDiv.style.display = "block";
      errorDiv.textContent = "Invalid email or password.";
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// ==================== Dashboard Page Logic (admin.html) ====================
if (document.getElementById("dashboardSection")) {
  const authMode = sessionStorage.getItem("auth_mode");
  
  if (authMode === "local") {
    const token = sessionStorage.getItem("local_token");
    if (!token) {
      window.location.href = "login.html";
    } else {
      useFirebase = false;
      initDashboard();
    }
  } else {
    // Default to Firebase Auth check
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        // Double check local token as backup
        const localToken = sessionStorage.getItem("local_token");
        if (localToken) {
          useFirebase = false;
          initDashboard();
        } else {
          window.location.href = "login.html";
        }
      } else {
        useFirebase = true;
        initDashboard();
      }
    });
  }

  async function initDashboard() {
    let cachedEmployees = [];
    let cachedFeedbacks = [];
    let leaderboardType = "monthly";
    let myChart = null;
    let myTrendChart = null;

    // Theme Mutation Observer for Chart redraw
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "data-theme") {
          if (cachedEmployees.length > 0) {
            const empStats = {};
            cachedEmployees.forEach(e => {
              empStats[e.employeeId] = { count: 0, sum: 0 };
              cachedFeedbacks.forEach(f => {
                if (f.employeeId === e.employeeId || f.counter === e.name) {
                  empStats[e.employeeId].count++;
                  empStats[e.employeeId].sum += f.rating;
                }
              });
            });
            updatePerformanceChart(cachedEmployees, empStats);
            updateTrendChart(cachedFeedbacks);
          }
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true });

    // Helper to generate Report Card HTML content
    function buildReportCardHtml(emp, rank, custAvg, kpiAvgVal, finalScore, penalty, pickedItems, indentNumbers, performanceStatus, range, statsCount) {
      const hasValidKpi = isKpiValidForRange(emp.kpiUpdatedAt, range);
      const startStr = formatDate(range.start);
      const endStr = formatDate(range.end);
      const penaltyComments = (hasValidKpi && emp.penaltyComments) ? emp.penaltyComments : "No penalty comments recorded.";

      // Detailed KPI rows
      let kpiRowsHtml = "";
      const addMetricRow = (name, val, isCount = false) => {
        const numVal = (hasValidKpi && val !== undefined) ? Number(val) : (isCount ? 0 : 10);
        const starsCount = isCount ? 0 : Math.min(5, Math.max(0, Math.round(numVal / 2)));
        const starsHtml = isCount ? "" : `<span style="font-size: 0.8rem; color: var(--color-text-secondary); margin-right: 0.5rem; font-weight: normal;">${"★".repeat(starsCount) + "☆".repeat(5 - starsCount)}</span>`;
        const displayVal = isCount ? numVal.toString() : numVal.toFixed(1);
        kpiRowsHtml += `
          <tr style="border-bottom: 1px solid var(--color-border);">
            <td style="padding: 0.65rem 0; color: var(--color-text-primary); font-weight: 500;">${name}</td>
            <td style="padding: 0.65rem 0; text-align: right; font-weight: 700; color: var(--color-primary);">
              ${starsHtml}${displayVal}
            </td>
          </tr>
        `;
      };

      addMetricRow("Discipline", emp.discipline);
      addMetricRow("Attendance", emp.attendance);

      const category = getNormalizedCategory(emp.category);
      if (category === "Sales") {
        addMetricRow("Customer Handling", emp.customerHandling);
        addMetricRow("Billing & Quotation Accuracy", emp.billingAccuracy);
        addMetricRow("Independent Handling", emp.independentHandling);
        addMetricRow("Follow-up & reporting", emp.followUpReport);
        addMetricRow("Customer Satisfaction", emp.customerSatisfaction);
        addMetricRow("Cleanliness & Hygiene", emp.cleanliness);
        addMetricRow("15d Invoices Generated", emp.pickedItems, true);
        addMetricRow("Indents Created", indentNumbers, true);
      } else if (category === "Store") {
        addMetricRow("Picking Speed & Accuracy", emp.pickingAccuracy);
        addMetricRow("Stock Placement & Sorting", emp.stockSorting);
        addMetricRow("Material Security & Safety", emp.materialSecurity);
        addMetricRow("Cleanliness & Maintenance", emp.storeCleanliness);
        addMetricRow("15d Picked Items Count", emp.pickedItems, true);
        addMetricRow("Indents Created", indentNumbers, true);
      } else if (category === "Admin") {
        addMetricRow("Billing & Taxation Accuracy", emp.billingTaxAccuracy);
        addMetricRow("Outstanding Payments Follow-up", emp.paymentFollowUp);
        addMetricRow("Filing & Bookkeeping", emp.filingBookkeeping);
        addMetricRow("Office Decorum & Cleanliness", emp.officeDecorum);
        addMetricRow("15d Tasks Completed", emp.pickedItems, true);
        addMetricRow("Indents Created", indentNumbers, true);
      }

      const improvements = [];
      const checkImprovement = (val, metricName, advice) => {
        const score = (hasValidKpi && val !== undefined) ? Number(val) : 10.0;
        if (score < 8.0) {
          improvements.push(`<li style="margin-bottom: 0.35rem;"><strong>${metricName} (${score.toFixed(1)}/10):</strong> ${advice}</li>`);
        }
      };

      checkImprovement(emp.discipline, "Discipline", "Focus on workplace behavior and professional conduct.");
      checkImprovement(emp.attendance, "Attendance", "Improve attendance consistency and punctuality.");

      if (category === "Sales") {
        checkImprovement(emp.customerHandling, "Customer Handling", "Enhance customer interaction, greeting, and support.");
        checkImprovement(emp.billingAccuracy, "Billing Accuracy", "Reduce errors in invoice and quote calculations.");
        checkImprovement(emp.independentHandling, "Independent Handling", "Build capability to manage customers with less supervision.");
        checkImprovement(emp.followUpReport, "Follow-up & Reporting", "Be more prompt with follow-up calls and daily reports.");
        checkImprovement(emp.customerSatisfaction, "Customer Satisfaction", "Address customer concerns more effectively.");
        checkImprovement(emp.cleanliness, "Cleanliness & Hygiene", "Maintain high standards of workspace tidiness.");
      } else if (category === "Store") {
        checkImprovement(emp.pickingAccuracy, "Picking Speed/Accuracy", "Double-check items against orders before dispatch.");
        checkImprovement(emp.stockSorting, "Stock Placement/Sorting", "Ensure stock items are stored in their designated bins.");
        checkImprovement(emp.materialSecurity, "Material Security/Safety", "Adhere strictly to stock security protocols.");
        checkImprovement(emp.storeCleanliness, "Cleanliness & Maintenance", "Keep storage aisles clean and free of obstructions.");
      } else if (category === "Admin") {
        checkImprovement(emp.billingTaxAccuracy, "Billing & Tax Accuracy", "Verify GST entries and accounting records for tax compliance.");
        checkImprovement(emp.paymentFollowUp, "Payment Follow-up", "Follow up more actively on outstanding customer balances.");
        checkImprovement(emp.filingBookkeeping, "Filing & Bookkeeping", "Organize files and vouchers in a timely and systematic order.");
        checkImprovement(emp.officeDecorum, "Office Decorum", "Maintain a clean, quiet, and professional office environment.");
      }

      let improvementHtmlContent = "";
      if (hasValidKpi && emp.improvements) {
        improvementHtmlContent += `
          <div style="margin-bottom: 0.75rem;">
            <p style="font-weight: 600; color: var(--color-primary); margin-bottom: 0.25rem;">Admin Comments & Feedback:</p>
            <p style="font-style: italic; color: var(--color-text-secondary); margin: 0 0 0.5rem 0; padding-left: 0.5rem; border-left: 2px solid var(--color-primary);">${escapeHtml(emp.improvements)}</p>
          </div>
        `;
      }

      if (improvements.length > 0) {
        improvementHtmlContent += `
          <p style="margin-bottom: 0.35rem; font-weight: 600; color: var(--color-primary);">System Identified Areas of Development:</p>
          <ul style="margin-left: 1.25rem; padding-left: 0; margin-top: 0; margin-bottom: 0; color: var(--color-text-secondary);">
            ${improvements.join("")}
          </ul>
        `;
      } else if (!emp.improvements) {
        improvementHtmlContent += `<p style="color: #22c55e; font-weight: 600; display: flex; align-items: center; gap: 0.25rem; margin: 0;">✨ Excellent performance! All evaluated metrics met or exceeded target standards (8.0+).</p>`;
      } else {
        improvementHtmlContent += `<p style="color: #22c55e; font-weight: 600; display: flex; align-items: center; gap: 0.25rem; margin: 0;">✨ No additional low scores identified. General performance standards are met.</p>`;
      }

      let statusClass = "status-good";
      if (performanceStatus === "Excellent") statusClass = "status-excellent";
      else if (performanceStatus === "Average") statusClass = "status-average";
      else if (performanceStatus === "Needs Improvement" || performanceStatus === "Needs Imp.") statusClass = "status-warning";

      return `
        <div class="report-card-container" style="padding: 1.5rem; background: transparent; border: 1px solid var(--color-border); border-radius: 12px; color: var(--color-text-primary); margin-bottom: 1.5rem;">
          <div style="text-align: center; margin-bottom: 1.5rem; border-bottom: 2px dashed var(--color-border); padding-bottom: 1rem;">
            <h1 style="font-size: 1.5rem; color: var(--color-primary); font-weight: 800; letter-spacing: 1px; margin-bottom: 0.25rem;">FINE BEARING & OIL SEAL STORE</h1>
            <p style="font-size: 0.85rem; color: var(--color-text-secondary); text-transform: uppercase;">Employee Performance Report Card</p>
          </div>

          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.5rem; background: var(--color-bg-card); padding: 1rem; border-radius: 8px; border: 1px solid var(--color-border);">
            <div>
              <div style="font-size: 0.75rem; color: var(--color-text-secondary); text-transform: uppercase;">Employee Name</div>
              <div id="rcEmpName" style="font-size: 1.1rem; font-weight: 700; color: var(--color-text-primary); margin-top: 0.25rem;">${escapeHtml(emp.name)}</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: var(--color-text-secondary); text-transform: uppercase;">Employee ID</div>
              <div id="rcEmpId" style="font-size: 1.1rem; font-weight: 700; color: var(--color-text-primary); margin-top: 0.25rem;">${escapeHtml(emp.employeeId)}</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: var(--color-text-secondary); text-transform: uppercase;">Category / Role</div>
              <div id="rcEmpCategory" style="font-size: 1rem; font-weight: 600; color: var(--color-text-primary); margin-top: 0.25rem;">${escapeHtml(emp.category || "Sales")}</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: var(--color-text-secondary); text-transform: uppercase;">Evaluation Period</div>
              <div id="rcPeriod" style="font-size: 1rem; font-weight: 600; color: var(--color-text-primary); margin-top: 0.25rem;">${startStr} to ${endStr}</div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem; text-align: center;">
            <div style="background: var(--color-bg-card); padding: 1rem; border-radius: 8px; border: 1px solid var(--color-border);">
              <div style="font-size: 0.75rem; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 0.25rem;">Final Score</div>
              <div id="rcFinalScore" style="font-size: 1.8rem; font-weight: 800; color: var(--color-primary);">${Number(finalScore).toFixed(2)} / 10</div>
            </div>
            <div style="background: var(--color-bg-card); padding: 1rem; border-radius: 8px; border: 1px solid var(--color-border);">
              <div style="font-size: 0.75rem; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 0.25rem;">Leaderboard Rank</div>
              <div id="rcRank" style="font-size: 1.8rem; font-weight: 800; color: var(--color-text-primary);">#${rank}</div>
            </div>
            <div style="background: var(--color-bg-card); padding: 1rem; border-radius: 8px; border: 1px solid var(--color-border);">
              <div style="font-size: 0.75rem; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 0.25rem;">Performance Status</div>
              <div style="margin-top: 0.25rem;"><span class="performance-status ${statusClass}" style="font-size: 0.9rem; padding: 0.35rem 0.75rem;">${performanceStatus}</span></div>
            </div>
          </div>

          <div style="margin-bottom: 1.5rem;">
            <h3 style="font-size: 0.95rem; text-transform: uppercase; color: var(--color-primary); border-bottom: 1px solid var(--color-border); padding-bottom: 0.35rem; margin-bottom: 0.75rem; letter-spacing: 0.5px;">Detailed KPI Scores</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
              <thead>
                <tr style="border-bottom: 1px solid var(--color-border); color: var(--color-text-secondary); text-align: left;">
                  <th style="padding: 0.5rem 0;">Metric Description</th>
                  <th style="padding: 0.5rem 0; text-align: right;">Score (out of 10)</th>
                </tr>
              </thead>
              <tbody>
                ${kpiRowsHtml}
              </tbody>
            </table>
          </div>

          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 2rem;">
            <div style="background: rgba(239, 68, 68, 0.06); padding: 1rem; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.15);">
              <h4 style="font-size: 0.85rem; text-transform: uppercase; color: var(--color-warning); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.25rem;">
                ⚠️ Deductions & Penalties
              </h4>
              <div style="font-size: 0.85rem; color: var(--color-text-primary); margin-bottom: 0.25rem;">
                Points Deducted: <strong style="color: var(--color-warning);">${Number(penalty).toFixed(1)}</strong>
              </div>
              <p style="font-size: 0.8rem; color: var(--color-text-secondary); font-style: italic;">${escapeHtml(penaltyComments)}</p>
            </div>
            
            <div style="background: rgba(6, 182, 212, 0.08); padding: 1rem; border-radius: 8px; border: 1px solid rgba(6, 182, 212, 0.15);">
              <h4 style="font-size: 0.85rem; text-transform: uppercase; color: var(--color-accent); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.25rem;">
                👤 Customer Satisfaction
              </h4>
              <div style="font-size: 0.85rem; color: var(--color-text-primary); margin-bottom: 0.25rem;">
                Average Rating: <strong style="color: var(--color-accent);">${Number(custAvg).toFixed(2)} / 5.0</strong>
              </div>
              <p style="font-size: 0.8rem; color: var(--color-text-secondary);">${statsCount} reviews submitted by customers.</p>
            </div>
          </div>

          <div style="background: rgba(234, 88, 12, 0.08); padding: 1.25rem; border-radius: 8px; border: 1px solid rgba(234, 88, 12, 0.15); margin-bottom: 2rem;">
            <h4 style="font-size: 0.85rem; text-transform: uppercase; color: var(--color-primary); margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.25rem; letter-spacing: 0.5px;">
              📈 Areas of Improvement & Feedback
            </h4>
            <div style="font-size: 0.85rem; color: var(--color-text-primary); line-height: 1.6;">
              ${improvementHtmlContent}
            </div>
          </div>

          <div class="print-signature-section" style="display: flex; justify-content: space-between; margin-top: 3.5rem; padding-top: 1.5rem; border-top: 1px solid var(--color-border);">
            <div style="text-align: center; width: 40%;">
              <div style="border-bottom: 1px solid var(--color-text-secondary); width: 100%; margin-bottom: 0.25rem; height: 1.5rem;"></div>
              <span style="font-size: 0.75rem; color: var(--color-text-secondary); text-transform: uppercase;">Employee Signature</span>
            </div>
            <div style="text-align: center; width: 40%;">
              <div style="border-bottom: 1px solid var(--color-text-secondary); width: 100%; margin-bottom: 0.25rem; height: 1.5rem;"></div>
              <span style="font-size: 0.75rem; color: var(--color-text-secondary); text-transform: uppercase;">Authorized Signatory</span>
            </div>
          </div>
        </div>
      `;
    }

    // Blended performance scoring formula
    function getBlendedScore(kpiAvg, penalty, custAvg, reviewsCount, hasValidKpi) {
      let score = 0;
      if (hasValidKpi) {
        if (reviewsCount > 0) {
          // CustAvg (out of 5) scaled to 10 (custAvg * 2) has 40% weight, KpiAvg has 60%
          score = (custAvg * 2) * 0.4 + kpiAvg * 0.6 - penalty;
        } else {
          score = kpiAvg - penalty;
        }
      } else {
        if (reviewsCount > 0) {
          // Only CustAvg scaled to 10
          score = (custAvg * 2) - penalty;
        } else {
          score = 0.0;
        }
      }
      return Math.max(0, Number(score));
    }

    // Helper to render and show digital report card
    function showReportCard(empId) {
      const emp = cachedEmployees.find(e => e.employeeId === empId);
      if (!emp) return;

      const range = getActiveDateRange();
      const empStats = {};
      cachedEmployees.forEach(e => {
        empStats[e.employeeId] = { count: 0, sum: 0 };
        cachedFeedbacks.forEach(f => {
          if (f.employeeId === e.employeeId || f.counter === e.name) {
            empStats[e.employeeId].count++;
            empStats[e.employeeId].sum += f.rating;
          }
        });
      });

      const ranked = cachedEmployees.map(e => {
        const stats = empStats[e.employeeId] || { count: 0, sum: 0 };
        const custAvg = stats.count ? stats.sum / stats.count : 0;
        const hasValidKpi = isKpiValidForRange(e.kpiUpdatedAt, range);
        const { kpiAvg, penalty } = calculateKpi(e, hasValidKpi);
        const finalScore = getBlendedScore(kpiAvg, penalty, custAvg, stats.count, hasValidKpi);
        const pickedItems = (hasValidKpi && e.pickedItems !== undefined) ? e.pickedItems : 0;
        return { employeeId: e.employeeId, custAvg, kpiAvg, pickedItems, finalScore, reviewsCount: stats.count };
      });

      ranked.sort((a, b) => {
        if (b.reviewsCount !== a.reviewsCount) return b.reviewsCount - a.reviewsCount;
        if (b.custAvg !== a.custAvg) return b.custAvg - a.custAvg;
        return b.finalScore - a.finalScore;
      });

      const rankIdx = ranked.findIndex(r => r.employeeId === empId);
      const rank = rankIdx !== -1 ? rankIdx + 1 : "-";
      
      const stats = empStats[emp.employeeId] || { count: 0, sum: 0 };
      const custAvg = stats.count ? stats.sum / stats.count : 0;
      const hasValidKpi = isKpiValidForRange(emp.kpiUpdatedAt, range);
      const { kpiAvg, penalty } = calculateKpi(emp, hasValidKpi);
      const finalScore = getBlendedScore(kpiAvg, penalty, custAvg, stats.count, hasValidKpi);
      const pickedItems = (hasValidKpi && emp.pickedItems !== undefined) ? emp.pickedItems : 0;
      const indentNumbers = (hasValidKpi && emp.indentNumbers !== undefined) ? emp.indentNumbers : 0;

      let performanceStatus = "Needs Imp.";
      if (finalScore === 0 && !hasValidKpi && stats.count === 0) performanceStatus = "No Evaluation";
      else if (finalScore >= 9.0) performanceStatus = "Excellent";
      else if (finalScore >= 7.0) performanceStatus = "Good";
      else if (finalScore >= 5.0) performanceStatus = "Average";

      const html = buildReportCardHtml(emp, rank, custAvg, kpiAvg, finalScore, penalty, pickedItems, indentNumbers, performanceStatus, range, stats.count);
      document.getElementById("reportCardPrintArea").innerHTML = html;

      // Ensure individual actions are visible
      const printBtn = document.getElementById("printReportCardBtn");
      const downloadPdf = document.getElementById("downloadPdfBtn");
      const shareEmail = document.getElementById("shareEmailBtn");
      const shareWhatsapp = document.getElementById("shareWhatsappBtn");
      if (printBtn) printBtn.style.display = "flex";
      if (downloadPdf) downloadPdf.style.display = "flex";
      if (shareEmail) shareEmail.style.display = "flex";
      if (shareWhatsapp) shareWhatsapp.style.display = "flex";

      document.getElementById("reportCardModal").classList.add("active");
    }

    // Print all reports stacked
    function printAllReports() {
      if (cachedEmployees.length === 0) {
        alert("No employees registered yet to print reports for.");
        return;
      }

      const range = getActiveDateRange();
      const empStats = {};
      cachedEmployees.forEach(e => {
        empStats[e.employeeId] = { count: 0, sum: 0 };
        cachedFeedbacks.forEach(f => {
          if (f.employeeId === e.employeeId || f.counter === e.name) {
            empStats[e.employeeId].count++;
            empStats[e.employeeId].sum += f.rating;
          }
        });
      });

      const ranked = cachedEmployees.map(e => {
        const stats = empStats[e.employeeId] || { count: 0, sum: 0 };
        const custAvg = stats.count ? stats.sum / stats.count : 0;
        const hasValidKpi = isKpiValidForRange(e.kpiUpdatedAt, range);
        const { kpiAvg, penalty } = calculateKpi(e, hasValidKpi);
        const finalScore = getBlendedScore(kpiAvg, penalty, custAvg, stats.count, hasValidKpi);
        const pickedItems = (hasValidKpi && e.pickedItems !== undefined) ? e.pickedItems : 0;
        const indentNumbers = (hasValidKpi && e.indentNumbers !== undefined) ? e.indentNumbers : 0;
        return { ...e, custAvg, kpiAvg, pickedItems, indentNumbers, penalty, finalScore, reviewsCount: stats.count };
      });

      ranked.sort((a, b) => {
        if (b.reviewsCount !== a.reviewsCount) return b.reviewsCount - a.reviewsCount;
        if (b.custAvg !== a.custAvg) return b.custAvg - a.custAvg;
        return b.finalScore - a.finalScore;
      });

      let allHtml = "";
      ranked.forEach((emp, index) => {
        const rank = index + 1;
        const stats = empStats[emp.employeeId] || { count: 0, sum: 0 };
        const custAvg = stats.count ? stats.sum / stats.count : 0;
        const hasValidKpi = isKpiValidForRange(emp.kpiUpdatedAt, range);
        const { kpiAvg, penalty } = calculateKpi(emp, hasValidKpi);
        const finalScore = getBlendedScore(kpiAvg, penalty, custAvg, stats.count, hasValidKpi);
        const pickedItems = (hasValidKpi && emp.pickedItems !== undefined) ? emp.pickedItems : 0;
        const indentNumbers = (hasValidKpi && emp.indentNumbers !== undefined) ? emp.indentNumbers : 0;

        let performanceStatus = "Needs Imp.";
        if (finalScore === 0 && !hasValidKpi && stats.count === 0) performanceStatus = "No Evaluation";
        else if (finalScore >= 9.0) performanceStatus = "Excellent";
        else if (finalScore >= 7.0) performanceStatus = "Good";
        else if (finalScore >= 5.0) performanceStatus = "Average";

        const cardHtml = buildReportCardHtml(emp, rank, custAvg, kpiAvg, finalScore, penalty, pickedItems, indentNumbers, performanceStatus, range, stats.count);
        allHtml += `
          <div class="report-card-print-block" style="page-break-after: always; padding: 10px 0;">
            ${cardHtml}
          </div>
        `;
      });

      const printArea = document.getElementById("reportCardPrintArea");
      const modal = document.getElementById("reportCardModal");

      const printBtn = document.getElementById("printReportCardBtn");
      const downloadPdf = document.getElementById("downloadPdfBtn");
      const shareEmail = document.getElementById("shareEmailBtn");
      const shareWhatsapp = document.getElementById("shareWhatsappBtn");

      if (printBtn) printBtn.style.display = "none";
      if (downloadPdf) downloadPdf.style.display = "none";
      if (shareEmail) shareEmail.style.display = "none";
      if (shareWhatsapp) shareWhatsapp.style.display = "none";

      printArea.innerHTML = allHtml;
      modal.classList.add("active");

      waitForImagesToLoad(printArea).then(() => {
        setTimeout(() => {
          window.print();
          if (printBtn) printBtn.style.display = "flex";
          if (downloadPdf) downloadPdf.style.display = "flex";
          if (shareEmail) shareEmail.style.display = "flex";
          if (shareWhatsapp) shareWhatsapp.style.display = "flex";
          modal.classList.remove("active");
        }, 500);
      });
    }

    // Render comparison chart
    function updatePerformanceChart(employees, empStats) {
      const canvas = document.getElementById("performanceChart");
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (myChart) {
        myChart.destroy();
      }

      if (employees.length === 0) return;

      const range = getActiveDateRange();
      const labels = [];
      const custAvgs = [];
      const kpiAvgs = [];

      employees.forEach(emp => {
        labels.push(emp.name);
        
        const stats = empStats[emp.employeeId] || { count: 0, sum: 0 };
        const custAvgVal = stats.count ? (stats.sum / stats.count) * 2 : 0; // scale to 10
        custAvgs.push(Number(custAvgVal.toFixed(2)));

        const hasValidKpi = isKpiValidForRange(emp.kpiUpdatedAt, range);
        const { kpiAvg } = calculateKpi(emp, hasValidKpi);
        kpiAvgs.push(Number(kpiAvg.toFixed(2)));
      });

      const isDark = document.documentElement.getAttribute("data-theme") !== "light";
      const textColor = isDark ? "rgba(255, 255, 255, 0.7)" : "#334155";
      const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.06)";

      myChart = new Chart(ctx, {
        type: "bar",
        data: {
          labels: labels,
          datasets: [
            {
              label: "Customer Rating (Scaled to 10)",
              data: custAvgs,
              backgroundColor: "rgba(34, 211, 238, 0.6)",
              borderColor: "#22d3ee",
              borderWidth: 1.5,
              borderRadius: 6
            },
            {
              label: "KPI Average (out of 10)",
              data: kpiAvgs,
              backgroundColor: "rgba(249, 115, 22, 0.6)",
              borderColor: "#f97316",
              borderWidth: 1.5,
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {
                color: textColor,
                font: {
                  family: "system-ui",
                  size: 11,
                  weight: "500"
                }
              }
            },
            tooltip: {
              padding: 10,
              cornerRadius: 8
            }
          },
          scales: {
            x: {
              grid: {
                display: false
              },
              ticks: {
                color: textColor,
                font: {
                  family: "system-ui"
                }
              }
            },
            y: {
              min: 0,
              max: 10,
              grid: {
                color: gridColor
              },
              ticks: {
                color: textColor,
                font: {
                  family: "system-ui"
                }
              }
            }
          }
        }
      });
    }

    // Render Trend Chart
    function updateTrendChart(feedbacks) {
      const canvas = document.getElementById("trendChart");
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (myTrendChart) {
        myTrendChart.destroy();
      }

      if (feedbacks.length === 0) return;

      // Group feedback by date
      const dateMap = {};
      feedbacks.forEach(f => {
        const dateStr = formatDate(f.createdAt);
        if (!dateMap[dateStr]) {
          dateMap[dateStr] = { count: 0, sum: 0 };
        }
        dateMap[dateStr].count++;
        dateMap[dateStr].sum += f.rating;
      });

      // Sort dates chronologically
      const sortedDates = Object.keys(dateMap).sort();
      const averages = sortedDates.map(d => Number((dateMap[d].sum / dateMap[d].count).toFixed(2)));

      const isDark = document.documentElement.getAttribute("data-theme") !== "light";
      const textColor = isDark ? "rgba(255, 255, 255, 0.7)" : "#334155";
      const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.06)";

      myTrendChart = new Chart(ctx, {
        type: "line",
        data: {
          labels: sortedDates,
          datasets: [
            {
              label: "Average Daily Rating",
              data: averages,
              borderColor: "#22d3ee",
              backgroundColor: "rgba(34, 211, 238, 0.1)",
              borderWidth: 2,
              tension: 0.3,
              fill: true,
              pointBackgroundColor: "#22d3ee",
              pointRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {
                color: textColor,
                font: { family: "system-ui", size: 11 }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: textColor, font: { family: "system-ui" } }
            },
            y: {
              min: 1,
              max: 5,
              grid: { color: gridColor },
              ticks: { stepSize: 1, color: textColor, font: { family: "system-ui" } }
            }
          }
        }
      });
    }

    // Render Sentiment & Word Themes Analysis
    function updateSentimentAndThemes(feedbacks) {
      const sentimentBar = document.getElementById("sentimentBar");
      const sentimentLegend = document.getElementById("sentimentLegend");
      const wordCloudTags = document.getElementById("wordCloudTags");

      if (!sentimentBar || !sentimentLegend || !wordCloudTags) return;

      if (feedbacks.length === 0) {
        sentimentBar.innerHTML = `<div style="width: 100%; text-align: center; line-height: 24px; color: var(--color-text-secondary); font-size: 0.8rem;">No feedback data.</div>`;
        sentimentLegend.innerHTML = "";
        wordCloudTags.innerHTML = `<span style="font-size: 0.85rem; color: var(--color-text-secondary);">No keywords available.</span>`;
        return;
      }

      // Sentiment calculations
      let pos = 0, neu = 0, neg = 0;
      feedbacks.forEach(f => {
        if (f.rating >= 4) pos++;
        else if (f.rating === 3) neu++;
        else neg++;
      });

      const total = feedbacks.length;
      const posPct = ((pos / total) * 100).toFixed(0);
      const neuPct = ((neu / total) * 100).toFixed(0);
      const negPct = ((neg / total) * 100).toFixed(0);

      sentimentBar.innerHTML = `
        <div style="width: ${posPct}%; background: #4ade80; transition: width 0.3s;" title="Positive: ${posPct}%"></div>
        <div style="width: ${neuPct}%; background: #facc15; transition: width 0.3s;" title="Neutral: ${neuPct}%"></div>
        <div style="width: ${negPct}%; background: #f87171; transition: width 0.3s;" title="Negative: ${negPct}%"></div>
      `;

      sentimentLegend.innerHTML = `
        <span style="color: #4ade80; font-weight: 600;">😊 Positive: ${pos} (${posPct}%)</span>
        <span style="color: #facc15; font-weight: 600;">😐 Neutral: ${neu} (${neuPct}%)</span>
        <span style="color: #f87171; font-weight: 600;">😡 Negative: ${neg} (${negPct}%)</span>
      `;

      // Word frequency analysis (Themes)
      const stopWords = new Set(["the", "a", "and", "or", "but", "is", "are", "was", "were", "to", "for", "with", "at", "by", "from", "on", "in", "it", "this", "that", "i", "you", "he", "she", "they", "we", "me", "my", "your", "them", "very", "good", "great", "excellent", "bad", "worst", "helpful", "friendly", "fast", "slow", "nice", "fine", "ok", "service", "work", "job", "store", "bearing", "oil", "seal", "counter"]);
      const wordCounts = {};

      feedbacks.forEach(f => {
        if (f.comment) {
          const words = f.comment.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g,"").split(/\s+/);
          words.forEach(w => {
            if (w.length > 3 && !stopWords.has(w)) {
              wordCounts[w] = (wordCounts[w] || 0) + 1;
            }
          });
        }
      });

      const sortedWords = Object.entries(wordCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      wordCloudTags.innerHTML = "";
      if (sortedWords.length === 0) {
        wordCloudTags.innerHTML = `<span style="font-size: 0.85rem; color: var(--color-text-secondary);">No common keywords found.</span>`;
      } else {
        const themeColors = ["#22d3ee", "#fb923c", "#c084fc", "#4ade80", "#f43f5e", "#38bdf8", "#fbbf24"];
        sortedWords.forEach(([word, count], idx) => {
          const tag = document.createElement("span");
          tag.className = "emp-id-badge";
          const color = themeColors[idx % themeColors.length];
          tag.style.background = `${color}15`;
          tag.style.color = color;
          tag.style.borderColor = `${color}40`;
          tag.style.fontSize = `${0.85 + (count * 0.03)}rem`;
          tag.style.fontWeight = "600";
          tag.style.padding = "0.35rem 0.65rem";
          tag.textContent = `${word} (${count})`;
          wordCloudTags.appendChild(tag);
        });
      }
    }

    // Render Attention Alerts
    function updateAttentionAlerts(employees, empStats) {
      const widget = document.getElementById("attentionAlertWidget");
      if (!widget) return;

      const range = getActiveDateRange();
      const flagged = [];

      employees.forEach(emp => {
        const stats = empStats[emp.employeeId] || { count: 0, sum: 0 };
        const custAvg = stats.count ? stats.sum / stats.count : 0;
        const hasValidKpi = isKpiValidForRange(emp.kpiUpdatedAt, range);
        const { finalScore } = calculateKpi(emp, hasValidKpi);

        // Alert if evaluated and finalScore < 6.5 OR has reviews and custAvg < 3.0
        const isFlagged = (hasValidKpi && finalScore < 6.5) || (stats.count > 0 && custAvg < 3.0);
        if (isFlagged) {
          flagged.push({
            name: emp.name,
            id: emp.employeeId,
            score: finalScore,
            custAvg: custAvg,
            count: stats.count
          });
        }
      });

      if (flagged.length === 0) {
        widget.style.display = "none";
        return;
      }

      let alertsHtml = "";
      flagged.forEach(item => {
        alertsHtml += `
          <div style="background: rgba(248, 113, 113, 0.08); border-left: 4px solid #f87171; padding: 0.75rem 1rem; border-radius: 0 8px 8px 0; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
            <div>
              <span style="font-weight: 700; color: var(--color-text-primary);">${escapeHtml(item.name)} (${escapeHtml(item.id)})</span>
              <span style="font-size: 0.85rem; color: var(--color-text-secondary); margin-left: 0.5rem;">
                KPI Score: <strong>${item.score.toFixed(2)}</strong> | Customer Rating: <strong>${item.count ? `${item.custAvg.toFixed(2)}/5.0 (${item.count} revs)` : 'No reviews'}</strong>
              </span>
            </div>
            <button class="btn-secondary btn-report-attention" data-id="${item.id}" style="font-size: 0.8rem; padding: 0.25rem 0.5rem;">View Report</button>
          </div>
        `;
      });

      widget.innerHTML = `
        <div class="glass-card" style="padding: 1.25rem; border: 1px solid rgba(248, 113, 113, 0.25); border-radius: 12px; background: rgba(248, 113, 113, 0.02);">
          <h3 style="color: #f87171; font-size: 1rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; text-transform: uppercase; font-weight: 700; margin-top: 0;">
            ⚠️ Proactive Attention Alerts (${flagged.length})
          </h3>
          <div style="display: flex; flex-direction: column;">
            ${alertsHtml}
          </div>
        </div>
      `;
      widget.style.display = "block";

      // Wire View Report buttons inside attention alerts
      widget.querySelectorAll(".btn-report-attention").forEach(btn => {
        btn.onclick = () => {
          const empId = btn.getAttribute("data-id");
          showReportCard(empId);
        };
      });
    }

    // Helper to wait for images in a container to load before printing
    function waitForImagesToLoad(container) {
      const imgs = container.querySelectorAll("img");
      const promises = Array.from(imgs).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      });
      return Promise.all(promises);
    }

    // Print All QR Codes Sheet
    function printAllQRCodes() {
      if (cachedEmployees.length === 0) {
        alert("No employees registered yet to print QR codes.");
        return;
      }

      let allHtml = "";
      cachedEmployees.forEach(emp => {
        const link = getEmployeeFeedbackLink(emp.employeeId);
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(link)}`;

        allHtml += `
          <div style="width: 250px; padding: 1.5rem; border: 2px solid #e2e8f0; border-radius: 12px; text-align: center; background: #ffffff; color: #0f172a; page-break-inside: avoid; break-inside: avoid; margin: 10px; display: inline-block; box-sizing: border-box; font-family: 'Inter', system-ui, sans-serif;">
            <div style="font-size: 1rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #ea580c; margin-bottom: 0.25rem;">Fine Bearing Store</div>
            <div style="font-size: 0.7rem; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 0.75rem;">Customer Feedback QR</div>
            <img src="${qrUrl}" alt="QR Code" style="width: 140px; height: 140px; margin-bottom: 0.75rem; border: 1px solid #e2e8f0; padding: 5px; border-radius: 8px; background: white;" />
            <div style="font-size: 1rem; font-weight: 700; color: #0f172a; margin-bottom: 0.15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(emp.name)}</div>
            <div style="font-size: 0.7rem; color: #64748b;">ID: ${escapeHtml(emp.employeeId)}</div>
          </div>
        `;
      });

      const printArea = document.getElementById("reportCardPrintArea");
      const modal = document.getElementById("reportCardModal");

      // Hide headers / actions
      const printBtn = document.getElementById("printReportCardBtn");
      const downloadPdf = document.getElementById("downloadPdfBtn");
      const shareEmail = document.getElementById("shareEmailBtn");
      const shareWhatsapp = document.getElementById("shareWhatsappBtn");

      if (printBtn) printBtn.style.display = "none";
      if (downloadPdf) downloadPdf.style.display = "none";
      if (shareEmail) shareEmail.style.display = "none";
      if (shareWhatsapp) shareWhatsapp.style.display = "none";

      printArea.innerHTML = `
        <div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; padding: 2rem 0; background: #ffffff;">
          ${allHtml}
        </div>
      `;
      modal.classList.add("active");

      waitForImagesToLoad(printArea).then(() => {
        setTimeout(() => {
          window.print();
          // Restore buttons
          if (printBtn) printBtn.style.display = "flex";
          if (downloadPdf) downloadPdf.style.display = "flex";
          if (shareEmail) shareEmail.style.display = "flex";
          if (shareWhatsapp) shareWhatsapp.style.display = "flex";
          modal.classList.remove("active");
        }, 500);
      });
    }

    // Helper to render and show employee feedback reviews
    function showEmployeeReviews(empId) {
      const emp = cachedEmployees.find(e => e.employeeId === empId);
      if (!emp) return;

      const empReviews = cachedFeedbacks.filter(f => f.employeeId === empId || f.counter === emp.name);
      
      document.getElementById("reviewsModalTitle").textContent = `${emp.name} - Reviews`;
      document.getElementById("reviewSummaryCount").textContent = empReviews.length;
      
      const avg = empReviews.length 
        ? (empReviews.reduce((sum, f) => sum + f.rating, 0) / empReviews.length).toFixed(2)
        : "0.00";
      document.getElementById("reviewSummaryAvg").textContent = avg;

      const container = document.getElementById("reviewsListContainer");
      container.innerHTML = "";

      if (empReviews.length === 0) {
        container.innerHTML = '<div class="no-data" style="text-align: center; padding: 2rem; color: var(--color-text-secondary);">No reviews submitted yet for this employee.</div>';
      } else {
        // Sort latest first
        const sortedReviews = [...empReviews].sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt) : 0;
          const dateB = b.createdAt ? new Date(b.createdAt) : 0;
          return dateB - dateA;
        });

        sortedReviews.forEach(f => {
          const item = document.createElement("div");
          item.className = "review-comment-item";
          
          const stars = "★".repeat(f.rating) + "☆".repeat(5 - f.rating);
          const customer = escapeHtml(f.customerName || "Anonymous");
          const text = escapeHtml(f.comment || "No comment provided.");
          const date = f.createdAt ? formatDate(f.createdAt) : "-";

          item.innerHTML = `
            <div class="review-comment-header">
              <span class="review-comment-customer">👤 ${customer}</span>
              <span class="review-comment-stars">${stars}</span>
            </div>
            <div class="review-comment-text">"${text}"</div>
            <div class="review-comment-date">📅 ${date}</div>
          `;
          container.appendChild(item);
        });
      }

      document.getElementById("reviewsModal").classList.add("active");
    }

    function getNormalizedCategory(categoryName) {
      const cat = (categoryName || "Sales").toLowerCase();
      if (cat.includes("store") || cat.includes("godown") || cat.includes("dispatch") || cat.includes("warehouse")) {
        return "Store";
      }
      if (cat.includes("admin") || cat.includes("office") || cat.includes("account") || cat.includes("billing")) {
        return "Admin";
      }
      return "Sales";
    }

    function calculateKpi(emp, hasValidKpi) {
      if (!hasValidKpi) {
        return { kpiAvg: 0.0, finalScore: 0.0, penalty: 0.0 };
      }
      const category = getNormalizedCategory(emp.category);
      const discipline = emp.discipline !== undefined ? emp.discipline : 10.0;
      const attendance = emp.attendance !== undefined ? emp.attendance : 10.0;
      
      let sum = discipline + attendance;
      let count = 2;

      if (category === "Sales") {
        sum += emp.customerHandling !== undefined ? emp.customerHandling : 10.0;
        sum += emp.billingAccuracy !== undefined ? emp.billingAccuracy : 10.0;
        sum += emp.independentHandling !== undefined ? emp.independentHandling : 10.0;
        sum += emp.followUpReport !== undefined ? emp.followUpReport : 10.0;
        sum += emp.customerSatisfaction !== undefined ? emp.customerSatisfaction : 10.0;
        sum += emp.cleanliness !== undefined ? emp.cleanliness : 10.0;
        count += 6;
      } else if (category === "Store") {
        sum += emp.pickingAccuracy !== undefined ? emp.pickingAccuracy : 10.0;
        sum += emp.stockSorting !== undefined ? emp.stockSorting : 10.0;
        sum += emp.materialSecurity !== undefined ? emp.materialSecurity : 10.0;
        sum += emp.storeCleanliness !== undefined ? emp.storeCleanliness : 10.0;
        count += 4;
      } else if (category === "Admin") {
        sum += emp.billingTaxAccuracy !== undefined ? emp.billingTaxAccuracy : 10.0;
        sum += emp.paymentFollowUp !== undefined ? emp.paymentFollowUp : 10.0;
        sum += emp.filingBookkeeping !== undefined ? emp.filingBookkeeping : 10.0;
        sum += emp.officeDecorum !== undefined ? emp.officeDecorum : 10.0;
        count += 4;
      }

      const kpiAvg = sum / count;
      const penalty = emp.penalty !== undefined ? emp.penalty : 0.0;
      const finalScore = Math.max(0, kpiAvg - penalty);

      return { kpiAvg, finalScore, penalty };
    }

    const totalFeedbackEl = document.getElementById("totalFeedback");
    const avgRatingEl = document.getElementById("avgRating");
    const todayFeedbackEl = document.getElementById("todayFeedback");
    const bestCounterEl = document.getElementById("bestCounter");
    const worstCounterEl = document.getElementById("worstCounter");
    const recentCommentsEl = document.getElementById("recentComments");
    const applyFilterBtn = document.getElementById("applyFilter");

    // Initialize 15-day cycle functions
    function initDateFilters() {
      const today = new Date();
      const year = today.getFullYear();
      const month = today.getMonth();
      const date = today.getDate();
      
      let start, end;
      if (date <= 15) {
        start = new Date(year, month, 1);
        end = new Date(year, month, 15);
      } else {
        start = new Date(year, month, 16);
        end = new Date(year, month + 1, 0);
      }
      
      const format = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      
      document.getElementById("dateFrom").value = format(start);
      document.getElementById("dateTo").value = format(end);
    }

    function getActiveDateRange() {
      const fromVal = document.getElementById("dateFrom").value;
      const toVal = document.getElementById("dateTo").value;
      
      let start, end;
      if (fromVal) {
        start = new Date(fromVal);
        start.setHours(0, 0, 0, 0);
      } else {
        const today = new Date();
        if (today.getDate() <= 15) {
          start = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0);
        } else {
          start = new Date(today.getFullYear(), today.getMonth(), 16, 0, 0, 0);
        }
      }
      
      if (toVal) {
        end = new Date(toVal);
        end.setHours(23, 59, 59, 999);
      } else {
        const today = new Date();
        if (today.getDate() <= 15) {
          end = new Date(today.getFullYear(), today.getMonth(), 15, 23, 59, 59, 999);
        } else {
          end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
        }
      }
      
      return { start, end };
    }

    function isKpiValidForRange(kpiUpdatedAt, range) {
      const d = parseDate(kpiUpdatedAt);
      if (!d) return false;
      return d >= range.start && d <= range.end;
    }

    // Call init date filters immediately to default to current 15-day cycle
    initDateFilters();

    function setDateRangeFilters(start, end, cycleValue = "custom") {
      const dateFromInput = document.getElementById("dateFrom");
      const dateToInput = document.getElementById("dateTo");
      const cycleSelect = document.getElementById("cycleSelect");

      const formatForInput = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };

      if (dateFromInput) dateFromInput.value = formatForInput(start);
      if (dateToInput) dateToInput.value = formatForInput(end);
      if (cycleSelect) cycleSelect.value = cycleValue;
    }
    
    // Wire Export CSV and Print All Buttons
    const existingExportBtn = document.getElementById("btnExportCSV");
    if (existingExportBtn) {
      existingExportBtn.addEventListener("click", exportCSV);
    }

    const printAllReportsBtn = document.getElementById("btnPrintAllReports");
    if (printAllReportsBtn) {
      printAllReportsBtn.addEventListener("click", printAllReports);
    }

    const printAllQRCodesBtn = document.getElementById("btnPrintAllQRCodes");
    if (printAllQRCodesBtn) {
      printAllQRCodesBtn.addEventListener("click", printAllQRCodes);
    }

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
        
        document.querySelectorAll(`.tab-btn[data-tab="${targetTab}"]`).forEach(b => b.classList.add("active"));
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
        const category = document.getElementById("newEmpCategory").value.trim() || "Sales";

        if (!empId || !empName) return;

        try {
          if (useFirebase) {
            const empDocRef = doc(db, "employees", empId);
            const empDocSnap = await getDoc(empDocRef);

            if (empDocSnap.exists()) {
              alert("An employee with this ID already exists. Please choose a different unique ID.");
              return;
            }

            await setDoc(empDocRef, {
              employeeId: empId,
              name: empName,
              category: category,
              createdAt: serverTimestamp()
            });
          } else {
            const res = await fetch("/api/employees", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ employeeId: empId, name: empName, category })
            });
            if (!res.ok) {
              const errData = await res.json();
              throw new Error(errData.error || "Failed to save employee");
            }
          }

          addEmployeeForm.reset();
          showToast("Employee registered successfully!");
          await refreshDashboardAndEmployees();
        } catch (err) {
          console.error("Error adding employee:", err);
          alert("Could not register employee: " + err.message);
        }
      });
    }

    // Wire Employee List Click Handlers (Copy Link, Delete Employee)
    const tbody = document.getElementById("employeeTableBody");
    if (tbody) {
      tbody.addEventListener("click", async (e) => {
        // Click name to show reviews
        const nameEl = e.target.closest(".clickable-name");
        if (nameEl) {
          const empId = nameEl.getAttribute("data-id");
          showEmployeeReviews(empId);
          return;
        }

        // Report Card click handler
        const reportBtn = e.target.closest(".btn-report");
        if (reportBtn) {
          const empId = reportBtn.getAttribute("data-id");
          showReportCard(empId);
          return;
        }

        // Copy link handler
        const copyBtn = e.target.closest(".btn-copy");
        if (copyBtn) {
          const link = copyBtn.getAttribute("data-link");
          try {
            await navigator.clipboard.writeText(link);
            showToast("Feedback link copied!");
          } catch (err) {
            console.error("Failed to copy link:", err);
            alert("Could not copy link automatically. Here it is:\n" + link);
          }
          return;
        }

        // Delete employee handler
        const deleteBtn = e.target.closest(".btn-delete");
        if (deleteBtn) {
          const empId = deleteBtn.getAttribute("data-id");
          const empName = deleteBtn.getAttribute("data-name");

          if (confirm(`Are you sure you want to delete employee "${empName}" (${empId})?`)) {
            try {
              if (useFirebase) {
                await deleteDoc(doc(db, "employees", empId));
              } else {
                const res = await fetch(`/api/employees/${empId}`, {
                  method: "DELETE"
                });
                if (!res.ok) {
                  const errData = await res.json();
                  throw new Error(errData.error || "Failed to delete employee");
                }
              }
              showToast("Employee removed successfully!");
              await refreshDashboardAndEmployees();
            } catch (err) {
              console.error("Error deleting employee:", err);
              alert("Could not delete employee. Please try again.");
            }
          }
          return;
        }

        // Manage KPIs click handler
        const kpiBtn = e.target.closest(".btn-kpi");
        if (kpiBtn) {
          const empId = kpiBtn.getAttribute("data-id");
          const emp = cachedEmployees.find(e => e.employeeId === empId);
          if (emp) {
            document.getElementById("kpiEmployeeId").value = emp.employeeId;
            document.getElementById("kpiEmployeeName").value = emp.name;
            
            const categoryInput = document.getElementById("kpiEmployeeCategory");
            if (categoryInput) {
              categoryInput.value = emp.category || "Sales";
              categoryInput.dispatchEvent(new Event("input"));
            }

            const range = getActiveDateRange();
            const hasValidKpi = isKpiValidForRange(emp.kpiUpdatedAt, range);

            const evalDateInput = document.getElementById("kpiEvaluationDate");
            if (evalDateInput) {
              if (hasValidKpi && emp.kpiUpdatedAt) {
                evalDateInput.value = formatDate(emp.kpiUpdatedAt);
              } else {
                evalDateInput.value = formatDate(range.end);
              }
            }

            const setKpiValue = (inputId, valId, value) => {
              const numVal = (hasValidKpi && value !== undefined) ? Number(value) : 10;
              const input = document.getElementById(inputId);
              if (input) input.value = numVal;
              
              const group = document.querySelector(`[data-target="${inputId}"]`);
              if (group) {
                group.querySelectorAll("button").forEach(btn => {
                  if (Number(btn.getAttribute("data-val")) === numVal) {
                    btn.classList.add("active");
                  } else {
                    btn.classList.remove("active");
                  }
                });
              }
            };

            // Set Common KPI values
            setKpiValue("kpiDiscipline", "valDiscipline", emp.discipline);
            setKpiValue("kpiAttendance", "valAttendance", emp.attendance);

            // Set Sales KPI values
            setKpiValue("kpiCustomerHandling", "valCustomerHandling", emp.customerHandling);
            setKpiValue("kpiBillingAccuracy", "valBillingAccuracy", emp.billingAccuracy);
            setKpiValue("kpiIndependentHandling", "valIndependentHandling", emp.independentHandling);
            setKpiValue("kpiFollowUp", "valFollowUp", emp.followUpReport);
            setKpiValue("kpiCustSatisfaction", "valCustSatisfaction", emp.customerSatisfaction);
            setKpiValue("kpiCleanliness", "valCleanliness", emp.cleanliness);

            // Set Store KPI values
            setKpiValue("kpiPickingAccuracy", "valPickingAccuracy", emp.pickingAccuracy);
            setKpiValue("kpiStockSorting", "valStockSorting", emp.stockSorting);
            setKpiValue("kpiMaterialSecurity", "valMaterialSecurity", emp.materialSecurity);
            setKpiValue("kpiStoreCleanliness", "valStoreCleanliness", emp.storeCleanliness);

            // Set Admin KPI values
            setKpiValue("kpiBillingTaxAccuracy", "valBillingTaxAccuracy", emp.billingTaxAccuracy);
            setKpiValue("kpiPaymentFollowUp", "valPaymentFollowUp", emp.paymentFollowUp);
            setKpiValue("kpiFilingBookkeeping", "valFilingBookkeeping", emp.filingBookkeeping);
            setKpiValue("kpiOfficeDecorum", "valOfficeDecorum", emp.officeDecorum);

            document.getElementById("kpiPickedItems").value = (hasValidKpi && emp.pickedItems !== undefined) ? emp.pickedItems : 0;
            document.getElementById("kpiIndentNumbers").value = (hasValidKpi && emp.indentNumbers !== undefined) ? emp.indentNumbers : 0;
            document.getElementById("kpiPenalty").value = (hasValidKpi && emp.penalty !== undefined) ? emp.penalty : 0.0;
            document.getElementById("kpiPenaltyComments").value = hasValidKpi ? (emp.penaltyComments || "") : "";
            document.getElementById("kpiImprovements").value = hasValidKpi ? (emp.improvements || "") : "";

            document.getElementById("kpiModal").classList.add("active");
          }
        }
      });
    }

    // Wire Leaderboard Click Handlers (Click Name to Show Reviews, Click Report Card to view Report)
    const leaderboardTbody = document.getElementById("leaderboardTableBody");
    if (leaderboardTbody) {
      leaderboardTbody.addEventListener("click", (e) => {
        const nameEl = e.target.closest(".clickable-name");
        if (nameEl) {
          const empId = nameEl.getAttribute("data-id");
          showEmployeeReviews(empId);
          return;
        }
        const reportBtn = e.target.closest(".btn-report");
        if (reportBtn) {
          const empId = reportBtn.getAttribute("data-id");
          showReportCard(empId);
          return;
        }
      });
    }

    // Load feedback data (with optional date filter)
    async function loadData() {
      const fromDate = document.getElementById("dateFrom").value;
      const toDate = document.getElementById("dateTo").value;
      
      if (useFirebase) {
        try {
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
        } catch (err) {
          console.warn("Firebase loadData failed, falling back to local API:", err);
          useFirebase = false;
        }
      }
      
      // Fallback local API
      try {
        let url = `/api/feedback?`;
        if (fromDate) url += `fromDate=${encodeURIComponent(fromDate)}&`;
        if (toDate) url += `toDate=${encodeURIComponent(toDate)}&`;
        const res = await fetch(url);
        if (res.ok) {
          return await res.json();
        }
      } catch (err) {
        console.error("Local API loadData failed:", err);
      }
      return [];
    }

    // Load employee directory
    async function loadEmployees() {
      if (useFirebase) {
        try {
          const q = query(collection(db, "employees"), orderBy("createdAt", "desc"));
          const snapshot = await getDocs(q);
          const employees = [];
          snapshot.forEach((doc) => {
            employees.push(doc.data());
          });
          // If Firestore is connected but empty, check if we should fall back to local API
          if (employees.length > 0) {
            return employees;
          }
          console.warn("Firebase returned 0 employees, checking local API...");
        } catch (err) {
          console.warn("Firebase loadEmployees failed, falling back to local API:", err);
          useFirebase = false;
        }
      }
      
      // Fallback local API
      try {
        const res = await fetch("/api/employees");
        if (res.ok) {
          return await res.json();
        }
      } catch (err) {
        console.error("Local API loadEmployees failed:", err);
      }
      return [];
    }

    // Refresh entire data & view
    async function refreshDashboardAndEmployees() {
      // Parallelize both fetches so they run simultaneously
      const [feedbacks, employees] = await Promise.all([loadData(), loadEmployees()]);
      cachedEmployees = employees;
      cachedFeedbacks = feedbacks;
      renderDashboard(feedbacks, employees);

      // Background sync — fire and forget, does NOT block the UI
      if (useFirebase) {
        (async () => {
          try {
            // Sync employees and ALL feedbacks in parallel
            const allFbSnapPromise = getDocs(collection(db, "feedback"));
            const syncEmpPromise = fetch("/api/sync/employees", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ employees })
            });

            const [allFbSnap] = await Promise.all([allFbSnapPromise, syncEmpPromise]);

            const allFeedbacks = [];
            allFbSnap.forEach((doc) => {
              allFeedbacks.push({ id: doc.id, ...doc.data() });
            });

            await fetch("/api/sync/feedback", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ feedbacks: allFeedbacks })
            });
            console.log("Background sync: local DB synced with Firestore.");
          } catch (err) {
            console.warn("Background sync failed:", err);
          }
        })();
      }
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
      renderLeaderboard(employees);

      // Render Performance Chart
      updatePerformanceChart(employees, empStats);

      // Render Trend Chart
      updateTrendChart(feedbacks);

      // Render Sentiment Distribution & Themes
      updateSentimentAndThemes(feedbacks);

      // Update Attention Alerts
      updateAttentionAlerts(employees, empStats);
    }

    // Render Table inside Employee Tab
    function renderEmployeeTable(employees, empStats) {
      const tbody = document.getElementById("employeeTableBody");
      if (!tbody) return;
      tbody.innerHTML = "";

      const searchQuery = (document.getElementById("searchEmployeeInput")?.value || "").toLowerCase().trim();
      const filterCategory = document.getElementById("filterCategorySelect")?.value || "all";

      let filtered = employees;

      // Apply Search Filter
      if (searchQuery) {
        filtered = filtered.filter(emp => 
          emp.name.toLowerCase().includes(searchQuery) || 
          emp.employeeId.toLowerCase().includes(searchQuery)
        );
      }

      // Apply Category Filter
      if (filterCategory !== "all") {
        filtered = filtered.filter(emp => {
          const norm = getNormalizedCategory(emp.category);
          return norm === filterCategory;
        });
      }

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="no-data">${employees.length === 0 ? "No employees registered yet." : "No matching employees found."}</td></tr>`;
        return;
      }

      const range = getActiveDateRange();
      filtered.forEach((emp) => {
        const stats = empStats[emp.employeeId] || { count: 0, sum: 0 };
        const custAvg = stats.count ? (stats.sum / stats.count).toFixed(2) : "-";

        const hasValidKpi = isKpiValidForRange(emp.kpiUpdatedAt, range);
        const { kpiAvg: kpiAvgVal, penalty } = calculateKpi(emp, hasValidKpi);
        const kpiAvg = kpiAvgVal.toFixed(2);

        const pickedItems = (hasValidKpi && emp.pickedItems !== undefined) ? emp.pickedItems : 0;
        const indentNumbers = (hasValidKpi && emp.indentNumbers !== undefined) ? emp.indentNumbers : 0;
        const link = getEmployeeFeedbackLink(emp.employeeId);

        let catBadgeColor = "rgba(234, 88, 12, 0.15)";
        let catColor = "#fb923c";
        const normalizedCategory = getNormalizedCategory(emp.category);
        if (normalizedCategory === "Store") {
          catBadgeColor = "rgba(6, 182, 212, 0.15)";
          catColor = "#22d3ee";
        } else if (normalizedCategory === "Admin") {
          catBadgeColor = "rgba(168, 85, 247, 0.15)";
          catColor = "#c084fc";
        }
        const catBadgeHtml = `<span class="emp-id-badge" style="background: ${catBadgeColor}; color: ${catColor}; border-color: ${catColor}50;">${escapeHtml(emp.category || "Sales")}</span>`;

        // Generate Avatar Initials
        const initials = emp.name ? emp.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() : "EE";
        const avatarHtml = `
          <div class="emp-cell-avatar">
            <div class="emp-avatar-circle" style="background: ${catBadgeColor}; border-color: ${catColor}40; color: ${catColor};">
              ${initials}
            </div>
            <div class="emp-cell-info">
              <div class="emp-name clickable-name" data-id="${emp.employeeId}">${escapeHtml(emp.name)}</div>
              <small class="emp-cell-id">ID: ${escapeHtml(emp.employeeId)}</small>
            </div>
          </div>
        `;

        const penaltyHtml = penalty > 0
          ? `<span style="color: #f87171; font-weight: 600;">-${penalty.toFixed(1)}</span>`
          : `<span style="color: var(--color-text-secondary);">0.0</span>`;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${avatarHtml}</td>
          <td>${catBadgeHtml}</td>
          <td class="emp-td-center"><span style="font-weight: 600;">${custAvg !== "-" ? `⭐ ${custAvg}` : "—"}</span></td>
          <td class="emp-td-center"><span style="font-weight: 600;">${stats.count}</span></td>
          <td class="emp-td-center"><span class="kpi-badge">${kpiAvg}</span></td>
          <td class="emp-td-center"><span style="font-weight: 600; color: var(--color-text-secondary);">${pickedItems}</span></td>
          <td class="emp-td-center"><span style="font-weight: 600; color: var(--color-text-secondary);">${indentNumbers}</span></td>
          <td class="emp-td-center">${penaltyHtml}</td>
          <td class="emp-td-center">
            <button class="emp-icon-btn btn-copy" data-link="${link}" title="Copy feedback link">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
            </button>
          </td>
          <td>
            <div class="emp-actions-group">
              <button class="emp-icon-btn btn-kpi" data-id="${emp.employeeId}" title="Manage KPIs">
                <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
              </button>
              <button class="emp-icon-btn btn-report" data-id="${emp.employeeId}" title="View Report Card">
                <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              </button>
              <button class="emp-icon-btn emp-icon-btn--danger btn-delete" data-id="${emp.employeeId}" data-name="${emp.name}" title="Delete Employee">
                <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
              </button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Render Table inside Leaderboard Tab
    function renderLeaderboard(employees) {
      const tbody = document.getElementById("leaderboardTableBody");
      const podiumContainer = document.getElementById("leaderboardPodium");
      
      tbody.innerHTML = "";
      if (podiumContainer) {
        podiumContainer.innerHTML = "";
        podiumContainer.style.display = "none";
      }

      if (employees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="no-data">No employees registered yet.</td></tr>';
        return;
      }

      // Synchronize switcher buttons state with current filters
      const range = getActiveDateRange();
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      const btnMonth = document.getElementById("leaderboardTypeMonth");
      const btnDay = document.getElementById("leaderboardTypeDay");

      if (btnMonth && btnDay) {
        btnMonth.classList.remove("active");
        btnDay.classList.remove("active");

        const isToday = range.start.getTime() === startOfToday.getTime() && range.end.getTime() === endOfToday.getTime();
        const isCurrentMonth = range.start.getTime() === startOfMonth.getTime() && range.end.getTime() === endOfMonth.getTime();

        if (isToday) {
          btnDay.classList.add("active");
        } else if (isCurrentMonth) {
          btnMonth.classList.add("active");
        }
      }

      // KPI validity range check
      const kpiRange = range;

      // Initialize stats map
      const leaderboardStats = {};
      employees.forEach(emp => {
        leaderboardStats[emp.employeeId] = { count: 0, sum: 0 };
      });

      // Filter and pre-aggregate loaded feedback based on active date range
      cachedFeedbacks.forEach(f => {
        const fDate = parseDate(f.createdAt);
        if (!fDate) return;

        const matchesPeriod = fDate >= range.start && fDate <= range.end;

        if (matchesPeriod) {
          employees.forEach(emp => {
            if (f.employeeId === emp.employeeId || f.counter === emp.name) {
              leaderboardStats[emp.employeeId].count++;
              leaderboardStats[emp.employeeId].sum += f.rating;
            }
          });
        }
      });

      // Map stats and calculate average
      let ranked = employees.map(emp => {
        const stats = leaderboardStats[emp.employeeId] || { count: 0, sum: 0 };
        const custAvg = stats.count ? stats.sum / stats.count : 0;

        const hasValidKpi = isKpiValidForRange(emp.kpiUpdatedAt, kpiRange);
        const { kpiAvg, penalty } = calculateKpi(emp, hasValidKpi);
        const finalScore = getBlendedScore(kpiAvg, penalty, custAvg, stats.count, hasValidKpi);
        const pickedItems = (hasValidKpi && emp.pickedItems !== undefined) ? emp.pickedItems : 0;

        return {
          ...emp,
          custAvg,
          kpiAvg,
          pickedItems,
          penalty,
          finalScore,
          hasValidKpi,
          reviewsCount: stats.count
        };
      });

      // Filter by Search Input and Category Select
      const searchVal = (document.getElementById("searchLeaderboardInput")?.value || "").trim().toLowerCase();
      const catVal = document.getElementById("filterLeaderboardCategorySelect")?.value || "all";

      if (searchVal || catVal !== "all") {
        ranked = ranked.filter(emp => {
          const matchesSearch = emp.name.toLowerCase().includes(searchVal) || emp.employeeId.toLowerCase().includes(searchVal);
          const matchesCategory = catVal === "all" || getNormalizedCategory(emp.category) === getNormalizedCategory(catVal);
          return matchesSearch && matchesCategory;
        });
      }

      // Sort by reviewsCount descending, then custAvg descending, then finalScore descending
      ranked.sort((a, b) => {
        if (b.reviewsCount !== a.reviewsCount) {
          return b.reviewsCount - a.reviewsCount;
        }
        if (b.custAvg !== a.custAvg) {
          return b.custAvg - a.custAvg;
        }
        return b.finalScore - a.finalScore;
      });

      if (ranked.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="no-data">No matching leaderboard results.</td></tr>';
        return;
      }

      // Render podium for Top 3
      if (podiumContainer) {
        const top3 = ranked.filter(emp => emp.finalScore > 0 || emp.reviewsCount > 0).slice(0, 3);
        if (top3.length > 0) {
          top3.forEach((emp, index) => {
            const rank = index + 1;
            let rankClass = "gold";
            let crown = "👑";
            if (rank === 2) {
              rankClass = "silver";
              crown = "🥈";
            } else if (rank === 3) {
              rankClass = "bronze";
              crown = "🥉";
            }

            const scoreText = emp.finalScore.toFixed(2);
            const avatarLetter = emp.name ? emp.name.charAt(0).toUpperCase() : "?";
            
            const podiumCard = document.createElement("div");
            podiumCard.className = `podium-card ${rankClass}`;
            podiumCard.setAttribute("data-id", emp.employeeId);
            podiumCard.innerHTML = `
              <div class="podium-badge-crown">${crown}</div>
              <div class="podium-avatar">${avatarLetter}</div>
              <div class="podium-name">${escapeHtml(emp.name)}</div>
              <div class="podium-category">${escapeHtml(emp.category || "General")}</div>
              <div class="podium-score">${scoreText} <span style="font-size:0.75rem; font-weight:500; opacity: 0.8;">/ 10</span></div>
              <div class="podium-reviews">${emp.reviewsCount} review${emp.reviewsCount === 1 ? '' : 's'}</div>
            `;
            
            podiumCard.addEventListener("click", () => {
              showReportCard(emp.employeeId);
            });
            
            podiumContainer.appendChild(podiumCard);
          });
          podiumContainer.style.display = "flex";
        }
      }

      ranked.forEach((emp, index) => {
        const rank = index + 1;
        let rankClass = "rank-other";
        let rankBadgeContent = rank;
        if (rank === 1) {
          rankClass = "rank-1";
          rankBadgeContent = "👑 1";
        } else if (rank === 2) {
          rankClass = "rank-2";
          rankBadgeContent = "🥈 2";
        } else if (rank === 3) {
          rankClass = "rank-3";
          rankBadgeContent = "🥉 3";
        }

        const custAvgText = emp.custAvg ? emp.custAvg.toFixed(2) : "0.00";
        const finalScoreText = emp.finalScore.toFixed(2);
        const percentage = Math.max(0, Math.min(100, (emp.finalScore / 10) * 100));

        let statusText = "Needs Imp.";
        let statusClass = "status-warning";
        let progressClass = "warning";
        if (emp.finalScore === 0 && !emp.hasValidKpi && emp.reviewsCount === 0) {
          statusText = "No Evaluation";
          statusClass = "status-pending";
          progressClass = "pending";
        } else if (emp.finalScore >= 9.0) {
          statusText = "Excellent";
          statusClass = "status-excellent";
          progressClass = "excellent";
        } else if (emp.finalScore >= 7.0) {
          statusText = "Good";
          statusClass = "status-good";
          progressClass = "good";
        } else if (emp.finalScore >= 5.0) {
          statusText = "Average";
          statusClass = "status-average";
          progressClass = "average";
        }

        let kpiAvgHtml = "";
        if (emp.hasValidKpi) {
          kpiAvgHtml = `<span class="kpi-badge">${emp.kpiAvg.toFixed(2)}</span>`;
        } else {
          kpiAvgHtml = `<span class="kpi-badge-missing" title="No KPI evaluation updated in this cycle">Pending Evaluation</span>`;
        }

        let catBadgeColor = "rgba(234, 88, 12, 0.15)";
        let catColor = "#fb923c";
        const normalizedCategory = getNormalizedCategory(emp.category);
        if (normalizedCategory === "Store") {
          catBadgeColor = "rgba(6, 182, 212, 0.15)";
          catColor = "#22d3ee";
        } else if (normalizedCategory === "Admin") {
          catBadgeColor = "rgba(168, 85, 247, 0.15)";
          catColor = "#c084fc";
        }
        const catBadgeHtml = `<span class="emp-id-badge" style="background: ${catBadgeColor}; color: ${catColor}; border-color: ${catColor}50;">${escapeHtml(emp.category || "Sales")}</span>`;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><span class="rank-badge ${rankClass}">${rankBadgeContent}</span></td>
          <td class="emp-name clickable-name" data-id="${emp.employeeId}">${escapeHtml(emp.name)}</td>
          <td><span class="emp-id-badge">${escapeHtml(emp.employeeId)}</span></td>
          <td>${catBadgeHtml}</td>
          <td><span style="font-weight: 500;">${custAvgText}</span></td>
          <td>${kpiAvgHtml}</td>
          <td><span style="color: ${emp.penalty > 0 ? '#f87171' : 'var(--color-text-secondary)'}; font-weight: 600;">${emp.penalty > 0 ? `-${emp.penalty.toFixed(1)}` : '0.0'}</span></td>
          <td><span style="font-weight: 800; color: var(--color-primary);">${finalScoreText}</span></td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 0.35rem; width: 100%;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="performance-status ${statusClass}">${statusText}</span>
                <span style="font-size: 0.75rem; color: var(--color-text-secondary); font-weight: 600;">${percentage.toFixed(0)}%</span>
              </div>
              <div class="progress-bar-container">
                <div class="progress-bar-fill ${progressClass}" style="width: ${percentage}%"></div>
              </div>
            </div>
          </td>
          <td>
            <button class="btn-secondary btn-report" data-id="${emp.employeeId}">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 0.9rem; height: 0.9rem; display: inline-block; vertical-align: middle;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              <span>Report</span>
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Wire report buttons inside leaderboard table
      tbody.querySelectorAll(".btn-report").forEach(btn => {
        btn.addEventListener("click", () => {
          const empId = btn.getAttribute("data-id");
          showReportCard(empId);
        });
      });
      tbody.querySelectorAll(".emp-name.clickable-name").forEach(btn => {
        btn.addEventListener("click", () => {
          const empId = btn.getAttribute("data-id");
          showReportCard(empId);
        });
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

    // Wire KPI Modal Close
    const kpiModal = document.getElementById("kpiModal");
    const closeKpiModal = document.getElementById("closeKpiModal");
    const cancelKpiModal = document.getElementById("cancelKpiModal");
    const kpiForm = document.getElementById("kpiForm");

    if (closeKpiModal) {
      closeKpiModal.onclick = () => kpiModal.classList.remove("active");
    }
    if (cancelKpiModal) {
      cancelKpiModal.onclick = () => kpiModal.classList.remove("active");
    }

    // Wire Reviews Modal Close
    const reviewsModal = document.getElementById("reviewsModal");
    const closeReviewsModal = document.getElementById("closeReviewsModal");
    if (closeReviewsModal) {
      closeReviewsModal.onclick = () => reviewsModal.classList.remove("active");
    }

    // Wire Report Card Modal Close
    const reportCardModal = document.getElementById("reportCardModal");
    const closeReportCardModal = document.getElementById("closeReportCardModal");
    if (closeReportCardModal) {
      closeReportCardModal.onclick = () => reportCardModal.classList.remove("active");
    }

    // Wire Print Report Card Button
    const printReportCardBtn = document.getElementById("printReportCardBtn");
    if (printReportCardBtn) {
      printReportCardBtn.onclick = () => {
        window.print();
      };
    }

    // Wire Download PDF Button
    const downloadPdfBtn = document.getElementById("downloadPdfBtn");
    if (downloadPdfBtn) {
      downloadPdfBtn.onclick = () => {
        const printArea = document.getElementById("reportCardPrintArea");
        if (!printArea) return;

        const empNameEl = printArea.querySelector("#rcEmpName");
        const empName = empNameEl ? empNameEl.textContent.trim() : "Employee";
        const empIdEl = printArea.querySelector("#rcEmpId");
        const empId = empIdEl ? empIdEl.textContent.trim() : "";
        const filename = `Report_Card_${empName.replace(/\s+/g, "_")}${empId ? "_" + empId : ""}`;

        const cardHtml = printArea.innerHTML;

        const printWindow = window.open("", "_blank", "width=820,height=1000,scrollbars=yes");
        if (!printWindow) {
          alert("Pop-up blocked. Please allow pop-ups for this site and try again.");
          return;
        }

        printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${filename}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #ffffff; color: #1e293b; font-family: 'Inter', system-ui, sans-serif; font-size: 14px; }
    body { padding: 24px; max-width: 720px; margin: 0 auto; }
    :root {
      --color-primary: #ea580c;
      --color-accent: #06b6d4;
      --color-text-primary: #1e293b;
      --color-text-secondary: #64748b;
      --color-bg-card: #f8fafc;
      --color-border: #e2e8f0;
      --color-warning: #ef4444;
    }
    .report-card-container { background: #ffffff !important; }
    table { width: 100%; border-collapse: collapse; }
    .performance-status { display: inline-block; border-radius: 999px; padding: 0.3rem 0.8rem; font-size: 0.78rem; font-weight: 700; border: 1px solid; }
    .status-excellent { background: rgba(34,197,94,0.12); color: #16a34a; border-color: rgba(34,197,94,0.35); }
    .status-good { background: rgba(59,130,246,0.12); color: #2563eb; border-color: rgba(59,130,246,0.35); }
    .status-average { background: rgba(234,179,8,0.12); color: #b45309; border-color: rgba(234,179,8,0.35); }
    .status-warning { background: rgba(239,68,68,0.12); color: #dc2626; border-color: rgba(239,68,68,0.35); }
    @media print { body { padding: 0; } @page { size: A4 portrait; margin: 12mm; } }
  </style>
</head>
<body>${cardHtml}<script>window.onload=function(){setTimeout(function(){window.print();},700);};<\/script>
</body>
</html>`);
        printWindow.document.close();
        showToast("Choose 'Save as PDF' in the print dialog");
      };
    }
    // Wire Export CSV Button
    const btnExportCSV = document.getElementById("btnExportCSV");
    if (btnExportCSV) {
      btnExportCSV.onclick = () => {
        exportCSV();
      };
    }

    // Wire Print All Reports Button
    const btnPrintAllReports = document.getElementById("btnPrintAllReports");
    if (btnPrintAllReports) {
      btnPrintAllReports.onclick = () => {
        printAllReports();
      };
    }

    // Wire Print All QR Codes Button
    const btnPrintAllQRCodes = document.getElementById("btnPrintAllQRCodes");
    if (btnPrintAllQRCodes) {
      btnPrintAllQRCodes.onclick = () => {
        printAllQRCodes();
      };
    }

    // Wire Download QR PDF Button
    const btnDownloadQRPdf = document.getElementById("btnDownloadQRPdf");
    if (btnDownloadQRPdf) {
      btnDownloadQRPdf.onclick = () => {
        if (cachedEmployees.length === 0) {
          alert("No employees registered yet to generate QR PDF.");
          return;
        }

        // Build QR card HTML for all employees (same as printAllQRCodes)
        let cardsHtml = "";
        cachedEmployees.forEach(emp => {
          const link = getEmployeeFeedbackLink(emp.employeeId);
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}`;
          cardsHtml += `
            <div style="width:240px; padding:1.25rem; border:2px solid #e2e8f0; border-radius:12px; text-align:center; background:#ffffff; color:#0f172a; page-break-inside:avoid; break-inside:avoid; margin:8px; display:inline-block; box-sizing:border-box; font-family:'Inter',system-ui,sans-serif; vertical-align:top;">
              <div style="font-size:0.9rem; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; color:#ea580c; margin-bottom:0.2rem;">Fine Bearing Store</div>
              <div style="font-size:0.65rem; color:#64748b; text-transform:uppercase; font-weight:600; margin-bottom:0.65rem;">Customer Feedback QR</div>
              <img src="${qrUrl}" alt="QR Code for ${escapeHtml(emp.name)}" style="width:150px; height:150px; margin-bottom:0.65rem; border:1px solid #e2e8f0; padding:5px; border-radius:8px; background:#ffffff;" crossorigin="anonymous" />
              <div style="font-size:0.95rem; font-weight:700; color:#0f172a; margin-bottom:0.1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(emp.name)}</div>
              <div style="font-size:0.65rem; color:#64748b;">ID: ${escapeHtml(emp.employeeId)}</div>
            </div>`;
        });

        const printWindow = window.open("", "_blank", "width=900,height=1000,scrollbars=yes");
        if (!printWindow) {
          alert("Pop-up blocked. Please allow pop-ups for this site and try again.");
          return;
        }

        printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>QR Codes - Fine Bearing Store</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #ffffff; font-family: 'Inter', system-ui, sans-serif; }
    body { padding: 20px; }
    .qr-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
    @media print {
      body { padding: 5px; }
      @page { size: A4 portrait; margin: 10mm; }
    }
  </style>
</head>
<body>
  <div class="qr-grid">${cardsHtml}</div>
  <script>
    // Wait for all QR images to load before printing
    window.onload = function() {
      var imgs = document.querySelectorAll('img');
      var total = imgs.length;
      if (total === 0) { setTimeout(function(){ window.print(); }, 300); return; }
      var loaded = 0;
      function tryPrint() {
        loaded++;
        if (loaded >= total) { setTimeout(function(){ window.print(); }, 400); }
      }
      imgs.forEach(function(img) {
        if (img.complete) { tryPrint(); }
        else { img.onload = tryPrint; img.onerror = tryPrint; }
      });
    };
  <\/script>
</body>
</html>`);
        printWindow.document.close();
        showToast("Choose 'Save as PDF' in the print dialog");
      };
    }

    // Wire Review Cycle Dropdown Selection
    const cycleSelect = document.getElementById("cycleSelect");
    if (cycleSelect) {
      cycleSelect.addEventListener("change", (e) => {
        const val = e.target.value;
        const dateFromInput = document.getElementById("dateFrom");
        const dateToInput = document.getElementById("dateTo");

        if (val === "custom" || !dateFromInput || !dateToInput) return;

        const today = new Date();
        let start = new Date();
        let end = new Date();

        if (val === "current-15") {
          if (today.getDate() <= 15) {
            start = new Date(today.getFullYear(), today.getMonth(), 1);
            end = new Date(today.getFullYear(), today.getMonth(), 15);
          } else {
            start = new Date(today.getFullYear(), today.getMonth(), 16);
            end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          }
        } else if (val === "prev-15") {
          if (today.getDate() <= 15) {
            start = new Date(today.getFullYear(), today.getMonth() - 1, 16);
            end = new Date(today.getFullYear(), today.getMonth(), 0);
          } else {
            start = new Date(today.getFullYear(), today.getMonth(), 1);
            end = new Date(today.getFullYear(), today.getMonth(), 15);
          }
        } else if (val === "current-month") {
          start = new Date(today.getFullYear(), today.getMonth(), 1);
          end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        } else if (val === "prev-month") {
          start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
          end = new Date(today.getFullYear(), today.getMonth(), 0);
        }

        const formatForInput = (d) => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          return `${y}-${m}-${day}`;
        };

        dateFromInput.value = formatForInput(start);
        dateToInput.value = formatForInput(end);

        refreshDashboardAndEmployees();
      });
    }

    // Wire Email Share Button
    const shareEmailBtn = document.getElementById("shareEmailBtn");
    if (shareEmailBtn) {
      shareEmailBtn.onclick = () => {
        const name = document.querySelector("#reportCardPrintArea #rcEmpName")?.textContent || "Employee";
        const id = document.querySelector("#reportCardPrintArea #rcEmpId")?.textContent || "";
        const score = document.querySelector("#reportCardPrintArea #rcFinalScore")?.textContent || "";
        const rank = document.querySelector("#reportCardPrintArea #rcRank")?.textContent || "";
        const period = document.querySelector("#reportCardPrintArea #rcPeriod")?.textContent || "";
        
        const subject = encodeURIComponent(`Performance Report Card - ${name} (${id})`);
        const body = encodeURIComponent(`Hello,\n\nHere is the performance report summary for ${name} (${id}) for the period ${period}:\n\nFinal Score: ${score}\nLeaderboard Rank: ${rank}\n\nBest regards,\nManagement`);
        
        window.open(`mailto:?subject=${subject}&body=${body}`);
      };
    }

    // Wire WhatsApp Share Button
    const shareWhatsappBtn = document.getElementById("shareWhatsappBtn");
    if (shareWhatsappBtn) {
      shareWhatsappBtn.onclick = () => {
        const name = document.querySelector("#reportCardPrintArea #rcEmpName")?.textContent || "Employee";
        const id = document.querySelector("#reportCardPrintArea #rcEmpId")?.textContent || "";
        const score = document.querySelector("#reportCardPrintArea #rcFinalScore")?.textContent || "";
        const rank = document.querySelector("#reportCardPrintArea #rcRank")?.textContent || "";
        const period = document.querySelector("#reportCardPrintArea #rcPeriod")?.textContent || "";
        
        const text = encodeURIComponent(`*Performance Report Summary*\n*Employee:* ${name} (${id})\n*Period:* ${period}\n*Final Score:* ${score}\n*Rank:* ${rank}`);
        
        window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank");
      };
    }

    // Close modals when clicking outside of them
    window.addEventListener("click", (e) => {
      if (e.target === kpiModal) {
        kpiModal.classList.remove("active");
      }
      if (e.target === reviewsModal) {
        reviewsModal.classList.remove("active");
      }
      if (e.target === reportCardModal) {
        reportCardModal.classList.remove("active");
      }
    });

    // Wire real-time category updates in KPI modal
    const kpiEmployeeCategory = document.getElementById("kpiEmployeeCategory");
    if (kpiEmployeeCategory) {
      kpiEmployeeCategory.addEventListener("input", (e) => {
        const rawCategory = e.target.value;
        const category = getNormalizedCategory(rawCategory);
        
        // Show only category-specific fields
        document.getElementById("kpiSalesFields").style.display = category === "Sales" ? "block" : "none";
        document.getElementById("kpiStoreFields").style.display = category === "Store" ? "block" : "none";
        document.getElementById("kpiAdminFields").style.display = category === "Admin" ? "block" : "none";

        // Update modal title and 15d field label
        const labelEl = document.getElementById("lblPickedItems");
        const modalTitleEl = document.querySelector("#kpiModal h2");
        if (category === "Sales") {
          if (labelEl) labelEl.textContent = "15d Invoices Generated";
          if (modalTitleEl) modalTitleEl.textContent = `KPI Evaluation - ${rawCategory || "Sales"}`;
        } else if (category === "Store") {
          if (labelEl) labelEl.textContent = "15d Picked Items Count";
          if (modalTitleEl) modalTitleEl.textContent = `KPI Evaluation - ${rawCategory}`;
        } else if (category === "Admin") {
          if (labelEl) labelEl.textContent = "15d Tasks/Vouchers Completed";
          if (modalTitleEl) modalTitleEl.textContent = `KPI Evaluation - ${rawCategory}`;
        }
      });
    }

    // Wire KPI Button Group Clicks
    const btnGroups = document.querySelectorAll(".btn-group-kpi");
    btnGroups.forEach(group => {
      group.addEventListener("click", (e) => {
        if (e.target.tagName === "BUTTON") {
          const val = Number(e.target.getAttribute("data-val"));
          const targetInputId = group.getAttribute("data-target");
          
          // Update input value and active button state
          document.getElementById(targetInputId).value = val;
          group.querySelectorAll("button").forEach(btn => btn.classList.remove("active"));
          e.target.classList.add("active");
        }
      });
    });

      if (kpiForm) {
        kpiForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          const empId = document.getElementById("kpiEmployeeId").value;
          const name = document.getElementById("kpiEmployeeName").value.trim();
          const rawCategory = document.getElementById("kpiEmployeeCategory").value.trim() || "Sales";
          const category = getNormalizedCategory(rawCategory);
          
          const discipline = Number(document.getElementById("kpiDiscipline").value);
          const attendance = Number(document.getElementById("kpiAttendance").value);
          const pickedItems = Number(document.getElementById("kpiPickedItems").value);
          const indentNumbers = Number(document.getElementById("kpiIndentNumbers").value);
          const penalty = Number(document.getElementById("kpiPenalty").value);
          const penaltyComments = document.getElementById("kpiPenaltyComments").value.trim();
          const improvementsVal = document.getElementById("kpiImprovements").value.trim();
 
          const updateData = {
            name,
            category: rawCategory,
            discipline,
            attendance,
            pickedItems,
            indentNumbers,
            penalty,
            penaltyComments,
            improvements: improvementsVal
          };

          if (category === "Sales") {
            updateData.customerHandling = Number(document.getElementById("kpiCustomerHandling").value);
            updateData.billingAccuracy = Number(document.getElementById("kpiBillingAccuracy").value);
            updateData.independentHandling = Number(document.getElementById("kpiIndependentHandling").value);
            updateData.followUpReport = Number(document.getElementById("kpiFollowUp").value);
            updateData.customerSatisfaction = Number(document.getElementById("kpiCustSatisfaction").value);
            updateData.cleanliness = Number(document.getElementById("kpiCleanliness").value);
          } else if (category === "Store") {
            updateData.pickingAccuracy = Number(document.getElementById("kpiPickingAccuracy").value);
            updateData.stockSorting = Number(document.getElementById("kpiStockSorting").value);
            updateData.materialSecurity = Number(document.getElementById("kpiMaterialSecurity").value);
            updateData.storeCleanliness = Number(document.getElementById("kpiStoreCleanliness").value);
          } else if (category === "Admin") {
            updateData.billingTaxAccuracy = Number(document.getElementById("kpiBillingTaxAccuracy").value);
            updateData.paymentFollowUp = Number(document.getElementById("kpiPaymentFollowUp").value);
            updateData.filingBookkeeping = Number(document.getElementById("kpiFilingBookkeeping").value);
            updateData.officeDecorum = Number(document.getElementById("kpiOfficeDecorum").value);
          }

          try {
            let evalDateVal = new Date();
            const evalDateInput = document.getElementById("kpiEvaluationDate");
            if (evalDateInput && evalDateInput.value) {
              evalDateVal = new Date(evalDateInput.value);
              // Set to midday to avoid timezone shift
              evalDateVal.setHours(12, 0, 0, 0);
            }

            if (useFirebase) {
              const empDocRef = doc(db, "employees", empId);
              await setDoc(empDocRef, {
                ...updateData,
                kpiUpdatedAt: Timestamp.fromDate(evalDateVal)
              }, { merge: true });
            } else {
              const res = await fetch(`/api/employees/${empId}/kpi`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...updateData,
                  kpiUpdatedAt: evalDateVal.toISOString()
                })
              });
              if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed to update KPI");
              }
            }

            kpiModal.classList.remove("active");
            showToast("Evaluation saved successfully!");
            await refreshDashboardAndEmployees();
          } catch (err) {
            console.error("Error saving evaluation:", err);
            alert("Could not save evaluation: " + err.message);
          }
        });
      }

    // Auto Report Period Reminder
    function checkEvaluationPeriod() {
      const today = new Date();
      const currentDay = today.getDate();
      
      const tomorrow = new Date(today);
      tomorrow.setDate(currentDay + 1);
      const isLastDay = tomorrow.getDate() === 1;
      
      const isMidMonth = currentDay === 15;
      
      if (isMidMonth || isLastDay) {
        const periodName = isMidMonth ? "Mid-Month" : "End-of-Month";
        const reminderEl = document.getElementById("autoReportReminder");
        if (reminderEl) {
          reminderEl.innerHTML = `
            <div class="reminder-banner">
              <div class="reminder-content">
                <div class="reminder-icon">
                  <svg style="width: 1.25rem; height: 1.25rem;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                  </svg>
                </div>
                <div class="reminder-text">
                  📅 <span>${periodName} Evaluation Period!</span> It is recommended to download the performance Excel report for your records.
                </div>
              </div>
              <div class="reminder-actions">
                <button class="btn-reminder-download" id="reminderDownloadBtn">
                  <svg style="width: 1rem; height: 1rem; margin-right: 0.25rem;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                  </svg>
                  Download Report
                </button>
                <button class="btn-reminder-dismiss" id="reminderDismissBtn">Dismiss</button>
              </div>
            </div>
          `;
          reminderEl.style.display = "block";
          
          document.getElementById("reminderDownloadBtn").onclick = () => {
            exportCSV();
          };
          
          document.getElementById("reminderDismissBtn").onclick = () => {
            reminderEl.style.display = "none";
          };
        }
      }
    }

    if (applyFilterBtn) {
      applyFilterBtn.addEventListener("click", () => {
        const cycleSelect = document.getElementById("cycleSelect");
        if (cycleSelect) {
          cycleSelect.value = "custom";
        }
        refreshDashboardAndEmployees();
      });
    }

    // Wire Real-time Table Searching & Filtering
    const searchEmployeeInput = document.getElementById("searchEmployeeInput");
    const filterCategorySelect = document.getElementById("filterCategorySelect");

    const triggerLocalTableFilter = () => {
      const empStats = {};
      cachedEmployees.forEach(e => {
        empStats[e.employeeId] = { count: 0, sum: 0 };
        cachedFeedbacks.forEach(f => {
          if (f.employeeId === e.employeeId || f.counter === e.name) {
            empStats[e.employeeId].count++;
            empStats[e.employeeId].sum += f.rating;
          }
        });
      });
      renderEmployeeTable(cachedEmployees, empStats);
    };

    if (searchEmployeeInput) {
      searchEmployeeInput.addEventListener("input", triggerLocalTableFilter);
    }
    if (filterCategorySelect) {
      filterCategorySelect.addEventListener("change", triggerLocalTableFilter);
    }

    // Wire Leaderboard Real-time Table Searching & Filtering
    const searchLeaderboardInput = document.getElementById("searchLeaderboardInput");
    const filterLeaderboardCategorySelect = document.getElementById("filterLeaderboardCategorySelect");

    const triggerLeaderboardFilter = () => {
      renderLeaderboard(cachedEmployees);
    };

    if (searchLeaderboardInput) {
      searchLeaderboardInput.addEventListener("input", triggerLeaderboardFilter);
    }
    if (filterLeaderboardCategorySelect) {
      filterLeaderboardCategorySelect.addEventListener("change", triggerLeaderboardFilter);
    }

    // Wire Leaderboard Type Switcher (Monthly vs Day)
    const btnMonth = document.getElementById("leaderboardTypeMonth");
    const btnDay = document.getElementById("leaderboardTypeDay");

    if (btnMonth && btnDay) {
      btnMonth.addEventListener("click", () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        setDateRangeFilters(start, end, "current-month");
        refreshDashboardAndEmployees();
      });

      btnDay.addEventListener("click", () => {
        const now = new Date();
        setDateRangeFilters(now, now, "custom");
        refreshDashboardAndEmployees();
      });
    }

    // Initial fetch
    refreshDashboardAndEmployees();
    checkEvaluationPeriod();
  }
}
