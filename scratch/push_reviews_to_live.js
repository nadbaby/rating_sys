import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'db.json');
const FIRESTORE_URL = 'https://firestore.googleapis.com/v1/projects/docmindai-6f0e0/databases/(default)/documents/feedback';

async function pushToLive() {
  if (!fs.existsSync(DB_FILE)) {
    console.error("db.json not found!");
    return;
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const feedbacks = db.feedback || [];
  
  // Filter for Sakshi's reviews only
  const sakshiFeedbacks = feedbacks.filter(fb => fb.employeeId === "4" || fb.counter === "Sakshi");

  console.log(`Found ${sakshiFeedbacks.length} reviews for Sakshi locally.`);
  console.log("Uploading to live Firestore...");

  let successCount = 0;
  for (let i = 0; i < sakshiFeedbacks.length; i++) {
    const fb = sakshiFeedbacks[i];
    
    // Construct Firestore REST payload
    const payload = {
      fields: {
        employeeId: { stringValue: fb.employeeId || "4" },
        counter: { stringValue: fb.counter || "Sakshi" },
        customerName: { stringValue: fb.customerName || "Anonymous" },
        rating: { integerValue: String(fb.rating || 5) },
        comment: { stringValue: fb.comment || "" },
        createdAt: { timestampValue: fb.createdAt }
      }
    };

    try {
      const res = await fetch(FIRESTORE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        successCount++;
        if (successCount % 10 === 0 || successCount === sakshiFeedbacks.length) {
          console.log(`Uploaded ${successCount}/${sakshiFeedbacks.length} reviews...`);
        }
      } else {
        const errData = await res.json();
        console.error(`Failed to upload review ${fb.id}:`, errData);
      }
    } catch (err) {
      console.error(`Error uploading review ${fb.id}:`, err.message);
    }
  }

  console.log(`Push complete! Successfully uploaded ${successCount} reviews to the live Firestore.`);
}

pushToLive();
