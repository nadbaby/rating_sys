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

// State variables
let currentEmployeeId = null;
let currentCounterName = 'Unknown Counter';

async function init() {
  const empId = getQueryParam('empId');
  const counterParam = getQueryParam('counter');

  if (empId) {
    try {
      // Fetch employee details from Firestore
      const docRef = doc(db, "employees", empId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const employeeData = docSnap.data();
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
      } else {
        // Employee ID doesn't exist
        showError(`Employee with ID "${empId}" was not found in our directory.`);
      }
    } catch (err) {
      console.error("Error loading employee info:", err);
      showError("Could not retrieve employee details. Please try again later.");
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
    // General Feedback fallback
    currentEmployeeId = null;
    currentCounterName = "Store Feedback";

    employeeNameEl.textContent = "General Store Feedback";
    employeeBadge.textContent = "General";
    employeeAvatar.textContent = "S";
    employeeAvatar.style.background = 'linear-gradient(135deg, #1e293b, #475569)';
    employeeCard.style.display = 'flex';

    formTitle.textContent = "Your Feedback";

    loadingCard.style.display = 'none';
    formContainer.style.display = 'block';
  }
}

function showError(msg) {
  loadingCard.style.display = 'none';
  errorMessage.textContent = msg;
  errorCard.style.display = 'flex';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const rating = form.rating.value;
  const comment = form.comment.value.trim();
  if (!rating) {
    alert('Please select a star rating.');
    return;
  }

  try {
    await addDoc(collection(db, 'feedback'), {
      employeeId: currentEmployeeId,
      counter: currentCounterName,
      rating: Number(rating),
      comment: comment || null,
      createdAt: serverTimestamp()
    });
    formContainer.style.display = 'none';
    thankYou.style.display = 'flex';
  } catch (err) {
    console.error('Error saving feedback:', err);
    alert('Something went wrong. Please try again later.');
  }
});

// Run init
init();
