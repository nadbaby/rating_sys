// js/main.js
// Handles feedback form submission and stores data in Firestore.

import { db } from "./firebase-init.js";
import { doc, getDoc, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

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

async function init() {
  const empId = getQueryParam('empId');
  const counterParam = getQueryParam('counter');

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
  try {
    await addDoc(collection(db, 'feedback'), {
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

  if (!saved) {
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
