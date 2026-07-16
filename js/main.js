// js/main.js
// Handles feedback form submission and stores data in Firestore.

import { db } from "./firebase-init.js";
import { 
  doc, getDoc, collection, addDoc, serverTimestamp, getDocs, query 
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// Helper to get query param value
function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

// Dom elements
const loadingCard = document.getElementById('loadingCard');
const errorCard = document.getElementById('errorCard');
const errorMessage = document.getElementById('errorMessage');
const formContainer = document.getElementById('formContainer');
const employeeCard = document.getElementById('employeeCard');
const employeeAvatar = document.getElementById('employeeAvatar');
const employeeNameEl = document.getElementById('employeeName');
const employeeBadge = document.getElementById('employeeBadge');
const formTitle = document.getElementById('formTitle');
const form = document.getElementById('feedbackForm');
const thankYou = document.getElementById('thankYouMessage');
const welcomeCard = document.getElementById('welcomeCard');
const ratingDesc = document.getElementById('ratingDesc');

// State variables
let currentEmployeeId = null;
let currentCounterName = 'Unknown Counter';
let loggedEmployee = null;

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

function getEmployeeSelectedDateRange() {
  const select = document.getElementById("empCycleSelect");
  const fromInput = document.getElementById("empDateFrom");
  const toInput = document.getElementById("empDateTo");

  const val = select ? select.value : "current-15";
  const today = new Date();
  let start = new Date();
  let end = new Date();

  if (val === "current-15") {
    if (today.getDate() <= 15) {
      start = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0);
      end = new Date(today.getFullYear(), today.getMonth(), 15, 23, 59, 59, 999);
    } else {
      start = new Date(today.getFullYear(), today.getMonth(), 16, 0, 0, 0);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
    }
  } else if (val === "prev-15") {
    if (today.getDate() <= 15) {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 16, 0, 0, 0);
      end = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
    } else {
      start = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0);
      end = new Date(today.getFullYear(), today.getMonth(), 15, 23, 59, 59, 999);
    }
  } else if (val === "current-month") {
    start = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0);
    end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (val === "prev-month") {
    start = new Date(today.getFullYear(), today.getMonth() - 1, 1, 0, 0, 0);
    end = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
  } else if (val === "custom") {
    if (fromInput && fromInput.value) {
      start = new Date(fromInput.value);
      start.setHours(0, 0, 0, 0);
    } else {
      start = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0);
    }
    if (toInput && toInput.value) {
      end = new Date(toInput.value);
      end.setHours(23, 59, 59, 999);
    } else {
      end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
    }
  }
  return { start, end };
}

function updateEmployeeProgressUI(emp, range, feedbacks, employees) {
  const currentFeedbacks = feedbacks.filter(f => {
    if (!f.createdAt) return false;
    const d = f.createdAt.toDate ? f.createdAt.toDate() : new Date(f.createdAt);
    return d >= range.start && d <= range.end;
  });

  const empStats = {};
  employees.forEach(e => {
    empStats[e.employeeId] = { count: 0, sum: 0 };
    currentFeedbacks.forEach(f => {
      if (f.employeeId === e.employeeId || f.counter === e.name) {
        empStats[e.employeeId].count++;
        empStats[e.employeeId].sum += f.rating;
      }
    });
  });

  const hasKpi = emp.kpiUpdatedAt !== undefined && emp.kpiUpdatedAt !== null;
  const { kpiAvg, penalty } = calculateKpi(emp, hasKpi);

  const ranked = employees.map(e => {
    const stats = empStats[e.employeeId] || { count: 0, sum: 0 };
    const custAvg = stats.count ? stats.sum / stats.count : 0;
    const eHasKpi = e.kpiUpdatedAt !== undefined && e.kpiUpdatedAt !== null;
    const eKpi = calculateKpi(e, eHasKpi);
    const finalScore = getBlendedScore(eKpi.kpiAvg, eKpi.penalty, custAvg, stats.count, eHasKpi);
    return { employeeId: e.employeeId, custAvg, kpiAvg: eKpi.kpiAvg, finalScore, reviewsCount: stats.count };
  });

  ranked.sort((a, b) => {
    if (b.reviewsCount !== a.reviewsCount) return b.reviewsCount - a.reviewsCount;
    if (b.custAvg !== a.custAvg) return b.custAvg - a.custAvg;
    return b.finalScore - a.finalScore;
  });

  const rankIdx = ranked.findIndex(r => r.employeeId === emp.employeeId);
  const rank = rankIdx !== -1 ? rankIdx + 1 : "-";

  const stats = empStats[emp.employeeId] || { count: 0, sum: 0 };
  const custAvg = stats.count ? stats.sum / stats.count : 0;
  const finalScore = getBlendedScore(kpiAvg, penalty, custAvg, stats.count, hasKpi);

  document.getElementById('progressName').textContent = emp.name;
  document.getElementById('progressRole').textContent = emp.category || 'Sales';
  document.getElementById('progressRank').textContent = `#${rank}`;
  document.getElementById('progressScore').textContent = `${finalScore.toFixed(2)} / 10`;
  document.getElementById('progressPenalty').textContent = penalty.toFixed(1);
  document.getElementById('progressReviewsCount').textContent = stats.count;
  document.getElementById('progressAverageRating').textContent = `${custAvg.toFixed(2)} / 5.0`;

  const startStr = formatDate(range.start);
  const endStr = formatDate(range.end);
  document.getElementById('empReportPeriodText').textContent = `Report Period: ${startStr} to ${endStr}`;

  // Update KPI Section Title dynamically
  const progressKpiTitle = document.getElementById('progressKpiTitle');
  if (progressKpiTitle) {
    if (hasKpi) {
      const kpiDateStr = formatDate(emp.kpiUpdatedAt);
      progressKpiTitle.textContent = `Detailed KPI Scores (Evaluated: ${kpiDateStr})`;
    } else {
      progressKpiTitle.textContent = `Detailed KPI Scores (No Evaluation)`;
    }
  }

  const deductionsBox = document.getElementById('progressDeductionsBox');
  const penaltyCommentsEl = document.getElementById('progressPenaltyComments');
  if (hasKpi && emp.penaltyComments) {
    penaltyCommentsEl.textContent = emp.penaltyComments;
    deductionsBox.style.display = 'block';
  } else {
    deductionsBox.style.display = 'none';
  }

  const progressKpiBody = document.getElementById('progressKpiBody');
  progressKpiBody.innerHTML = '';
  
  const addProgressKpiRow = (metricName, scoreVal) => {
    const numVal = (hasKpi && scoreVal !== undefined) ? Number(scoreVal) : 10.0;
    const starsCount = Math.round(numVal / 2);
    const stars = '★'.repeat(starsCount) + '☆'.repeat(5 - starsCount);
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="kpi-metric-name">${metricName}</td>
      <td class="kpi-metric-score">
        <span class="kpi-stars-preview">${stars}</span>
        ${hasKpi ? numVal.toFixed(1) : 'Pending'}
      </td>
    `;
    progressKpiBody.appendChild(row);
  };

  addProgressKpiRow("Discipline", emp.discipline);
  addProgressKpiRow("Attendance", emp.attendance);

  const normCategory = getNormalizedCategory(emp.category);
  if (normCategory === "Sales") {
    addProgressKpiRow("Customer Handling", emp.customerHandling);
    addProgressKpiRow("Billing Accuracy", emp.billingAccuracy);
    addProgressKpiRow("Independent Handling", emp.independentHandling);
    addProgressKpiRow("Follow-up & Reporting", emp.followUpReport);
    addProgressKpiRow("Customer Satisfaction", emp.customerSatisfaction);
    addProgressKpiRow("Cleanliness", emp.cleanliness);
  } else if (normCategory === "Store") {
    addProgressKpiRow("Picking Accuracy", emp.pickingAccuracy);
    addProgressKpiRow("Stock Placement/Sorting", emp.stockSorting);
    addProgressKpiRow("Material Security", emp.materialSecurity);
    addProgressKpiRow("Cleanliness & Maintenance", emp.storeCleanliness);
  } else if (normCategory === "Admin") {
    addProgressKpiRow("Billing & Tax Accuracy", emp.billingTaxAccuracy);
    addProgressKpiRow("Payment Follow-up", emp.paymentFollowUp);
    addProgressKpiRow("Filing & Bookkeeping", emp.filingBookkeeping);
    addProgressKpiRow("Office Decorum", emp.officeDecorum);
  }
}

async function loadAndRenderEmployeeProgress(empId) {
  try {
    const { employees, feedbacks } = await loadAllData();
    const emp = employees.find(e => e.employeeId === empId || e.id === empId);
    if (!emp) {
      console.error("Employee not found for progress render:", empId);
      return;
    }
    loggedEmployee = emp;
    const range = getEmployeeSelectedDateRange();
    updateEmployeeProgressUI(emp, range, feedbacks, employees);
  } catch (err) {
    console.error("Error loading progress details:", err);
  }
}

function setupEmployeeProgressEvents() {
  const cycleSelect = document.getElementById("empCycleSelect");
  const customDatesGroup = document.getElementById("empCustomDatesGroup");
  const applyBtn = document.getElementById("empApplyFilterBtn");
  const logoutBtn = document.getElementById("empLogoutBtn");

  if (cycleSelect) {
    cycleSelect.addEventListener("change", (e) => {
      if (e.target.value === "custom") {
        customDatesGroup.style.display = "flex";
      } else {
        customDatesGroup.style.display = "none";
        if (loggedEmployee) {
          loadAndRenderEmployeeProgress(loggedEmployee.employeeId || loggedEmployee.id);
        }
      }
    });
  }

  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      if (loggedEmployee) {
        loadAndRenderEmployeeProgress(loggedEmployee.employeeId || loggedEmployee.id);
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      sessionStorage.removeItem("emp_logged_in_id");
      loggedEmployee = null;
      document.getElementById("employeeProgressCard").style.display = "none";
      document.getElementById("employeeLoginCard").style.display = "block";
      
      const loginNameInput = document.getElementById("empLoginName");
      const loginPasswordInput = document.getElementById("empLoginPassword");
      if (loginNameInput) loginNameInput.value = "";
      if (loginPasswordInput) loginPasswordInput.value = "";
    });
  }
}

// Helper functions for KPI & Blended Score calculations
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

function isKpiValidForRange(kpiUpdatedAt, range) {
  if (!kpiUpdatedAt) return false;
  const d = kpiUpdatedAt.toDate ? kpiUpdatedAt.toDate() : new Date(kpiUpdatedAt);
  if (isNaN(d.getTime())) return false;
  return d >= range.start && d <= range.end;
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

function getBlendedScore(kpiAvg, penalty, custAvg, reviewsCount, hasValidKpi) {
  let score = 0;
  if (hasValidKpi) {
    if (reviewsCount > 0) {
      score = (custAvg * 2) * 0.4 + kpiAvg * 0.6 - penalty;
    } else {
      score = kpiAvg - penalty;
    }
  } else {
    if (reviewsCount > 0) {
      score = (custAvg * 2) - penalty;
    } else {
      score = 0.0;
    }
  }
  return Math.max(0, Number(score));
}

function getActiveDateRange() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const date = today.getDate();
  
  let start, end;
  if (date <= 15) {
    start = new Date(year, month, 1, 0, 0, 0);
    end = new Date(year, month, 15, 23, 59, 59, 999);
  } else {
    start = new Date(year, month, 16, 0, 0, 0);
    end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  }
  return { start, end };
}

async function loadAllData() {
  let employees = [];
  let feedbacks = [];
  let useFb = true;

  try {
    const empSnap = await getDocs(query(collection(db, "employees")));
    empSnap.forEach(doc => employees.push(doc.data()));
    
    const fbSnap = await getDocs(query(collection(db, "feedback")));
    fbSnap.forEach(doc => feedbacks.push({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.warn("Firestore data load failed, using local API:", err);
    useFb = false;
  }

  if (!useFb || employees.length === 0) {
    try {
      const empRes = await fetch("/api/employees");
      if (empRes.ok) employees = await empRes.json();
      
      const fbRes = await fetch("/api/feedback");
      if (fbRes.ok) feedbacks = await fbRes.json();
    } catch (err) {
      console.error("Local API fetch failed:", err);
    }
  }

  return { employees, feedbacks };
}

async function init() {
  const empId = getQueryParam('empId');
  const counterParam = getQueryParam('counter');
  const view = getQueryParam('view');
  const isProgressView = (view === 'progress' || view === 'report');

  if (isProgressView) {
    loadingCard.style.display = 'none';
    formContainer.style.display = 'none';
    
    const loginCard = document.getElementById('employeeLoginCard');
    const progressCard = document.getElementById('employeeProgressCard');
    
    // Wire filter and logout events
    setupEmployeeProgressEvents();

    // Check if there is an active logged-in employee session
    const cachedEmpId = sessionStorage.getItem("emp_logged_in_id");
    if (cachedEmpId) {
      loginCard.style.display = 'none';
      progressCard.style.display = 'block';
      await loadAndRenderEmployeeProgress(cachedEmpId);
    } else {
      loginCard.style.display = 'block';
      progressCard.style.display = 'none';
    }

    const loginForm = document.getElementById('employeeLoginForm');
    const loginNameInput = document.getElementById('empLoginName');
    const loginPasswordInput = document.getElementById('empLoginPassword');
    const loginError = document.getElementById('empLoginError');

    // Pre-fill name if empId is provided in URL and not logged in yet
    if (empId && !cachedEmpId) {
      try {
        let employeeData = null;
        let fallback = false;
        try {
          const docRef = doc(db, "employees", empId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            employeeData = docSnap.data();
          } else {
            fallback = true;
          }
        } catch (err) {
          fallback = true;
        }

        if (fallback) {
          const res = await fetch(`/api/employees`);
          if (res.ok) {
            const list = await res.json();
            const emp = list.find(e => e.employeeId === empId);
            if (emp) employeeData = emp;
          }
        }

        if (employeeData) {
          loginNameInput.value = employeeData.name;
        }
      } catch (err) {
        console.warn("Failed to pre-fill name:", err);
      }
    }

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginError.style.display = 'none';
      
      const enteredName = loginNameInput.value.trim();
      const enteredPass = loginPasswordInput.value.trim();

      const submitBtn = loginForm.querySelector('button[type="submit"]');
      const originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying...';

      try {
        const { employees } = await loadAllData();
        
        // Find employee by name (case-insensitive and trimmed)
        const emp = employees.find(e => e.name.trim().toLowerCase() === enteredName.toLowerCase());
        
        if (!emp) {
          loginError.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          return;
        }

        // Expected password: name + '123' (case-insensitive name + '123')
        const expectedPass = emp.name.trim().toLowerCase() + '123';
        
        if (enteredPass.toLowerCase() !== expectedPass) {
          loginError.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          return;
        }

        // Successfully verified! Save session and load progress card.
        const empIdToSave = emp.employeeId || emp.id;
        sessionStorage.setItem("emp_logged_in_id", empIdToSave);
        loginCard.style.display = 'none';
        progressCard.style.display = 'block';
        await loadAndRenderEmployeeProgress(empIdToSave);
      } catch (err) {
        console.error("Verification failed:", err);
        loginError.textContent = "An error occurred. Please try again later.";
        loginError.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });

    return;
  }

  if (empId) {
    let employeeData = null;
    let fallback = false;
    try {
      // Fetch employee details from Firestore
      const docRef = doc(db, "employees", empId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        employeeData = docSnap.data();
      } else {
        // Employee ID doesn't exist
        showError(`Employee with ID "${empId}" was not found in our directory.`);
        return;
      }
    } catch (err) {
      console.warn("Firestore employee fetch failed, trying local API:", err);
      fallback = true;
    }

    if (fallback) {
      try {
        const res = await fetch(`/api/employees`);
        if (res.ok) {
          const list = await res.json();
          const emp = list.find(e => e.employeeId === empId);
          if (emp) {
            employeeData = emp;
          } else {
            showError(`Employee with ID "${empId}" was not found in our directory.`);
            return;
          }
        } else {
          showError("Could not retrieve employee details. Please try again later.");
          return;
        }
      } catch (err) {
        console.error("Local API employee fetch failed:", err);
        showError("Could not retrieve employee details. Please try again later.");
        return;
      }
    }

    if (employeeData) {
      currentEmployeeId = empId;
      currentCounterName = employeeData.name;

      // Render employee profile
      employeeNameEl.textContent = employeeData.name;
      employeeBadge.textContent = `Employee ID: ${empId}`;
      employeeAvatar.textContent = employeeData.name.charAt(0).toUpperCase();
      employeeAvatar.style.background = 'linear-gradient(135deg, var(--color-primary), #fdba74)';
      employeeCard.style.display = 'flex';

      formTitle.textContent = `Rate your interaction with ${employeeData.name}`;

      // Show form
      loadingCard.style.display = 'none';
      formContainer.style.display = 'block';
    }
  } else if (counterParam) {
    // Legacy support for counter query parameter
    currentEmployeeId = null;
    currentCounterName = counterParam;

    employeeNameEl.textContent = counterParam;
    employeeBadge.textContent = "Counter Service";
    employeeAvatar.textContent = counterParam.charAt(0).toUpperCase();
    employeeAvatar.style.background = 'linear-gradient(135deg, var(--color-accent), #22d3ee)';
    employeeCard.style.display = 'flex';

    formTitle.textContent = `Feedback for ${counterParam}`;

    loadingCard.style.display = 'none';
    formContainer.style.display = 'block';
  } else {
    // No employee ID or counter specified, show welcome instruction card
    loadingCard.style.display = 'none';
    if (welcomeCard) welcomeCard.style.display = 'flex';
  }
}

function showError(msg) {
  loadingCard.style.display = 'none';
  errorMessage.textContent = msg;
  errorCard.style.display = 'flex';
}

// Add change listener to update rating description
if (form && ratingDesc) {
  form.addEventListener('change', (e) => {
    if (e.target.name === 'rating') {
      const val = Number(e.target.value);
      const descriptions = {
        1: "Terrible 😠",
        2: "Bad 🙁",
        3: "Okay 😐",
        4: "Good 🙂",
        5: "Excellent 😄"
      };
      ratingDesc.textContent = descriptions[val] || "Tap a star to rate";
      ratingDesc.classList.add('selected');
    }
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const rating = form.rating.value;
  const comment = form.comment.value.trim();
  const customerName = form.customerName.value.trim();

  if (!rating) {
    alert('Please select a star rating.');
    return;
  }

  let saved = false;
  let docRef = null;
  try {
    docRef = await addDoc(collection(db, 'feedback'), {
      employeeId: currentEmployeeId,
      counter: currentCounterName,
      customerName: customerName || "Anonymous",
      rating: Number(rating),
      comment: comment || null,
      createdAt: serverTimestamp()
    });
    saved = true;
  } catch (err) {
    console.warn('Firestore feedback save failed, trying local API:', err);
  }

  // Always sync submitted feedback to local API so it is immediately visible in local mode / employee portals
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: docRef ? docRef.id : Math.random().toString(36).substr(2, 9),
        employeeId: currentEmployeeId,
        counter: currentCounterName,
        customerName: customerName || "Anonymous",
        rating: Number(rating),
        comment: comment || null,
        createdAt: new Date().toISOString()
      })
    });
    if (res.ok) {
      saved = true;
    }
  } catch (err) {
    console.error('Local API save feedback failed:', err);
  }

  if (saved) {
    formContainer.style.display = 'none';
    thankYou.style.display = 'flex';
  } else {
    alert('Something went wrong. Please try again later.');
  }
});

// Run init
init();
