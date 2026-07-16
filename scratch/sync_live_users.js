import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'db.json');

function extractValue(field) {
  if (!field) return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('integerValue' in field) return parseInt(field.integerValue, 10);
  if ('doubleValue' in field) return parseFloat(field.doubleValue);
  if ('timestampValue' in field) return field.timestampValue;
  if ('booleanValue' in field) return field.booleanValue;
  return undefined;
}

async function syncLiveUsers() {
  console.log("Fetching live users from Firestore REST API...");
  try {
    const res = await fetch('https://firestore.googleapis.com/v1/projects/docmindai-6f0e0/databases/(default)/documents/employees');
    if (!res.ok) {
      throw new Error(`Failed to fetch from Firestore: ${res.statusText}`);
    }
    const data = await res.json();
    if (!data.documents || data.documents.length === 0) {
      console.log("No documents found in Firestore employees collection.");
      return;
    }

    const liveEmployees = data.documents.map(doc => {
      const fields = doc.fields || {};
      const emp = {};
      
      // Basic Fields
      emp.employeeId = extractValue(fields.employeeId);
      emp.name = extractValue(fields.name);
      emp.category = extractValue(fields.category) || "Sales";
      emp.createdAt = extractValue(fields.createdAt) || new Date().toISOString();

      // Common KPIs
      if (fields.discipline) emp.discipline = extractValue(fields.discipline);
      if (fields.attendance) emp.attendance = extractValue(fields.attendance);
      if (fields.penalty) emp.penalty = extractValue(fields.penalty);
      if (fields.penaltyComments) emp.penaltyComments = extractValue(fields.penaltyComments);
      if (fields.improvements) emp.improvements = extractValue(fields.improvements);
      if (fields.pickedItems) emp.pickedItems = extractValue(fields.pickedItems);
      if (fields.kpiUpdatedAt) emp.kpiUpdatedAt = extractValue(fields.kpiUpdatedAt);

      // Sales specific KPIs
      if (fields.customerHandling) emp.customerHandling = extractValue(fields.customerHandling);
      if (fields.billingAccuracy) emp.billingAccuracy = extractValue(fields.billingAccuracy);
      if (fields.independentHandling) emp.independentHandling = extractValue(fields.independentHandling);
      if (fields.followUpReport) emp.followUpReport = extractValue(fields.followUpReport);
      if (fields.customerSatisfaction) emp.customerSatisfaction = extractValue(fields.customerSatisfaction);
      if (fields.cleanliness) emp.cleanliness = extractValue(fields.cleanliness);

      // Store specific KPIs
      if (fields.pickingAccuracy) emp.pickingAccuracy = extractValue(fields.pickingAccuracy);
      if (fields.stockSorting) emp.stockSorting = extractValue(fields.stockSorting);
      if (fields.materialSecurity) emp.materialSecurity = extractValue(fields.materialSecurity);
      if (fields.storeCleanliness) emp.storeCleanliness = extractValue(fields.storeCleanliness);

      // Admin/Accounts specific KPIs
      if (fields.billingTaxAccuracy) emp.billingTaxAccuracy = extractValue(fields.billingTaxAccuracy);
      if (fields.paymentFollowUp) emp.paymentFollowUp = extractValue(fields.paymentFollowUp);
      if (fields.filingBookkeeping) emp.filingBookkeeping = extractValue(fields.filingBookkeeping);
      if (fields.officeDecorum) emp.officeDecorum = extractValue(fields.officeDecorum);

      return emp;
    });

    console.log(`Successfully fetched ${liveEmployees.length} live employees.`);

    // Read current db.json
    let currentDb = { employees: [], feedback: [], admin: { email: "boss@fine.com", password: "boss123" } };
    if (fs.existsSync(DB_FILE)) {
      try {
        currentDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      } catch (e) {
        console.warn("Failed to parse db.json, starting with empty/default template");
      }
    }

    // Update employees list (overwriting or merging based on employeeId)
    // We will just set the new employees list to match the live one
    currentDb.employees = liveEmployees;

    // Write updated database back to db.json
    fs.writeFileSync(DB_FILE, JSON.stringify(currentDb, null, 2), 'utf8');
    console.log("Successfully updated db.json with live employees!");

  } catch (err) {
    console.error("Sync failed:", err);
  }
}

syncLiveUsers();
