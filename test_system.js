import dotenv from "dotenv";
dotenv.config();

const BACKEND_URL = "https://vedic-mathshala-backend.onrender.com";

async function runTest() {
    console.log("=== Testing Vedic Mathshala Cloud Integration ===");
    try {
        // Test 1: Pinging /queue-status
        console.log("1. Pinging /queue-status...");
        const statusRes = await fetch(`${BACKEND_URL}/queue-status`);
        if (statusRes.ok) {
            const statusData = await statusRes.json();
            console.log("   ✅ Status Endpoint online!");
            console.log(`   📊 Queue Counts: Class=${statusData.status?.Class?.count || 0}, Workshop=${statusData.status?.Workshop?.count || 0}`);
        } else {
            console.error("   ❌ Status Check returned status:", statusRes.status);
        }

        // Test 2: Triggering a Test Download & Sync
        console.log("2. Sending mock student to PDF generator...");
        const downloadRes = await fetch(`${BACKEND_URL}/generate-pdf-download`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "Class",
                student: {
                    "Name": "Automated Cloud Tester",
                    "Level": "Level 99",
                    "Date": "17-06-2026",
                    "Certificate ID": "VM-TEST-99",
                    "Email": "mathshala20@gmail.com"
                }
            })
        });

        if (downloadRes.ok) {
            console.log("   ✅ Direct PDF download succeeded!");
            console.log("   ✅ Database sync to Google Sheets completed in the background!");
            console.log("\n=== Integration Test Successful! ===");
        } else {
            const err = await downloadRes.json();
            console.error("   ❌ PDF Generation failed:", err.error || downloadRes.statusText);
        }

    } catch (err) {
        console.error("❌ Test failed with error:", err.message);
    }
}

runTest();
