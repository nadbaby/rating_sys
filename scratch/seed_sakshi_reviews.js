import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'db.json');

const firstNames = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen"];
const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"];
const comments = [
  "Excellent customer service!",
  "Very polite and helpful.",
  "Quick billing and friendly behavior.",
  "Highly professional, answered all my queries.",
  "Great experience, will visit again.",
  "She was very patient and handled the crowd well.",
  "Super fast checkout!",
  "Loved the service, Sakshi was wonderful.",
  "Very attentive and efficient.",
  "Clean counter and smiling face."
];

function generateReview(index) {
  const customerName = firstNames[Math.floor(Math.random() * firstNames.length)] + " " + lastNames[Math.floor(Math.random() * lastNames.length)];
  const rating = Math.random() > 0.15 ? 5 : 4; // Mostly 5s and some 4s
  const comment = Math.random() > 0.3 ? comments[Math.floor(Math.random() * comments.length)] : "";
  
  // Distribute across June 2026
  const day = String(Math.floor(Math.random() * 30) + 1).padStart(2, '0');
  const hour = String(Math.floor(Math.random() * 12) + 9).padStart(2, '0'); // 9 AM to 9 PM
  const minute = String(Math.floor(Math.random() * 60)).padStart(2, '0');
  const second = String(Math.floor(Math.random() * 60)).padStart(2, '0');
  const createdAt = `2026-06-${day}T${hour}:${minute}:${second}.000Z`;

  return {
    id: `sakshi_rev_${index}_` + Math.random().toString(36).substr(2, 5),
    employeeId: "4",
    counter: "Sakshi",
    customerName,
    rating,
    comment,
    createdAt
  };
}

function seedReviews() {
  if (!fs.existsSync(DB_FILE)) {
    console.error("db.json not found!");
    return;
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!db.feedback) db.feedback = [];

  // Filter out any existing seeded reviews for Sakshi to avoid duplicates
  db.feedback = db.feedback.filter(fb => !fb.id.startsWith("sakshi_rev_"));

  console.log(`Generating 49 reviews for Sakshi...`);
  for (let i = 1; i <= 49; i++) {
    db.feedback.push(generateReview(i));
  }

  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  console.log(`Successfully seeded 49 reviews for Sakshi in db.json!`);
}

seedReviews();
