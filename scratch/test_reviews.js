async function testFeedbackEndpoint() {
  console.log("Starting feedback endpoint integration tests...");
  
  const baseUrl = "http://localhost:8000";

  // 1. Submit a feedback review for our test employee
  console.log("\n1. Submitting feedback for 'test_store_emp_99'...");
  const feedbackSubmitRes = await fetch(`${baseUrl}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      employeeId: "test_store_emp_99",
      counter: "Jack Godown",
      rating: 5,
      customerName: "Alice Miller",
      comment: "Super friendly and helped load everything fast!",
      createdAt: new Date().toISOString()
    })
  });

  if (!feedbackSubmitRes.ok) {
    const errorText = await feedbackSubmitRes.text();
    console.error("Failed to submit feedback:", errorText);
    process.exit(1);
  }
  const submittedData = await feedbackSubmitRes.json();
  console.log("Successfully submitted feedback:", submittedData);

  // 2. Fetch feedback and ensure it contains the review
  console.log("\n2. Fetching feedback data...");
  const getRes = await fetch(`${baseUrl}/api/feedback`);
  if (!getRes.ok) {
    const errorText = await getRes.text();
    console.error("Failed to get feedback:", errorText);
    process.exit(1);
  }
  const feedbackList = await getRes.json();
  console.log(`Found ${feedbackList.length} feedback entries.`);
  
  const targetReview = feedbackList.find(f => f.employeeId === "test_store_emp_99");
  if (!targetReview) {
    console.error("Could not find the submitted review in the feedback list!");
    process.exit(1);
  }
  
  console.log("Target review details:", targetReview);
  console.log("\nFeedback integration tests passed successfully!");
}

testFeedbackEndpoint().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
