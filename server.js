import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";

import { generatePDF } from "./utils/generatePDF.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// State to track processing
let isProcessing = false;
let queueCheckRequested = false; // Tracks if a new check request arrived while processing
let queueStatus = {
    Class: { count: 0, active: false },
    Workshop: { count: 0, active: false }
};

// Background queue processor
async function processQueues() {
    if (isProcessing) {
        queueCheckRequested = true; // Flag that a request arrived during active run
        return;
    }
    isProcessing = true;
    
    try {
        const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;
        if (!googleScriptUrl || googleScriptUrl.includes("YOUR_ACTUAL_SCRIPT_ID")) {
            console.warn("[Queue Processor] Skipping: GOOGLE_SCRIPT_URL is not configured.");
            isProcessing = false;
            return;
        }

        console.log("[Queue Processor] Starting background queue check...");

        for (let type of ["Class", "Workshop"]) {
            let hasMore = true;
            queueStatus[type].active = true;

            while (hasMore) {
                try {
                    // 1. Fetch next student in queue from Google Sheets
                    const response = await fetch(`${googleScriptUrl}?action=getQueue&type=${type}`);
                    if (!response.ok) {
                        throw new Error(`GAS returned HTTP ${response.status}`);
                    }
                    
                    const qData = await response.json();
                    queueStatus[type].count = qData.count || 0;
                    
                    if (qData.count > 0 && qData.nextStudent) {
                        const student = qData.nextStudent;
                        console.log(`[Queue Processor] Processing: ${student.Name} (${type}) - ID: ${student["Certificate ID"]}`);
                        
                        // 2. Generate PDF certificate
                        const pdfPath = await generatePDF(student);
                        
                        // 3. Read generated PDF into base64 and delete local file immediately
                        let pdfBase64 = null;
                        try {
                            const pdfBuffer = fs.readFileSync(pdfPath);
                            pdfBase64 = pdfBuffer.toString("base64");
                            fs.unlinkSync(pdfPath);
                            console.log(`[Queue Processor] Generated and read PDF to base64, deleted temporary file: ${pdfPath}`);
                        } catch (pdfErr) {
                            console.error(`[Queue Processor] Failed to process/delete PDF:`, pdfErr.message);
                        }
                        
                        // 4. Record as complete in Google Sheets AND send email (Moves to final tab, deletes from Queue tab)
                        const completeResponse = await fetch(googleScriptUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                action: "complete",
                                type: type,
                                student: student,
                                emailConfig: student.Email ? {
                                    to: student.Email,
                                    subject: "Your Certificate of Completion - Vedic Mathshala 🎓",
                                    body: `Dear ${student.Name || "Student"},\n\nCongratulations on completing your course with Vedic Mathshala!\n\nPlease find your certificate of completion attached to this email.\n\nBest regards,\nVedic Mathshala Team`,
                                    pdfBase64: pdfBase64,
                                    filename: `${(student.Name || "Certificate").replace(/\s+/g, "_")}.pdf`
                                } : null
                            })
                        });
                        
                        const completeRes = await completeResponse.json();
                        if (!completeRes.success) {
                            console.error(`[Queue Processor] Failed to complete student in Google Sheet:`, completeRes.error);
                            break; // Halt loop to prevent infinite loop on write errors
                        }
                        
                        // Decrement count locally
                        queueStatus[type].count = Math.max(0, queueStatus[type].count - 1);
                        
                    } else {
                        hasMore = false;
                    }
                } catch (procErr) {
                    console.error(`[Queue Processor] Error processing batch iteration:`, procErr.message);
                    hasMore = false; // Stop queue processing temporarily to avoid hammering SMTP/API
                }

                // Add a small 2-second sleep to respect SMTP rate limits and quotas
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            queueStatus[type].active = false;
        }
    } catch (err) {
        console.error("[Queue Processor] Fatal error:", err);
    } finally {
        isProcessing = false;
        console.log("[Queue Processor] Background queue check finished.");
        
        // Re-check lock: If a check was requested during execution, run it again
        if (queueCheckRequested) {
            console.log("[Queue Processor] Re-triggering queue check due to pending requests...");
            queueCheckRequested = false;
            process.nextTick(processQueues);
        }
    }
}

// Route to check status of queue processor (polled by frontend)
app.get("/queue-status", async (req, res) => {
    try {
        const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;
        if (!googleScriptUrl || googleScriptUrl.includes("YOUR_ACTUAL_SCRIPT_ID")) {
            return res.json({
                isProcessing: false,
                status: queueStatus
            });
        }

        // Fetch latest queue counts from Google Sheets to ensure sync
        let totalCount = 0;
        for (let type of ["Class", "Workshop"]) {
            try {
                const gasResponse = await fetch(`${googleScriptUrl}?action=getQueue&type=${type}`);
                if (gasResponse.ok) {
                    const qData = await gasResponse.json();
                    queueStatus[type].count = qData.count || 0;
                    totalCount += qData.count || 0;
                }
            } catch (err) {
                console.error(`Failed to update ${type} queue count:`, err.message);
            }
        }

        // Self-healing: If there are items in the queue but the processor is inactive, wake it up
        if (!isProcessing && totalCount > 0) {
            console.log(`[Queue Status] Queue is idle with ${totalCount} pending items. Triggering wake-up...`);
            processQueues();
        }

        res.json({
            isProcessing,
            status: queueStatus
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Route to accept parsed list and queue them in Google Sheets
app.post("/upload", async (req, res) => {
    try {
        const { students, type } = req.body;

        if (!students || !Array.isArray(students) || students.length === 0) {
            return res.status(400).json({ error: "Missing or invalid students array" });
        }

        if (!type || (type !== "Class" && type !== "Workshop")) {
            return res.status(400).json({ error: "Invalid or missing category type" });
        }

        const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;
        if (!googleScriptUrl || googleScriptUrl.includes("YOUR_ACTUAL_SCRIPT_ID")) {
            return res.status(500).json({ error: "Google Apps Script URL is not configured. Configure it in .env file." });
        }

        console.log(`Queueing ${students.length} students to Google Sheets (${type})...`);
        
        // Post list to Google Sheets Queue sheet
        const gasResponse = await fetch(googleScriptUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                action: "queue",
                type,
                students
            })
        });

        const gasResult = await gasResponse.json();
        if (!gasResult || !gasResult.success) {
            throw new Error(gasResult ? gasResult.error : "Unknown Google Sheets error");
        }

        // Trigger queue processor to start background processing (non-blocking)
        processQueues();

        res.json({
            message: `Successfully queued ${students.length} students! PDF generation and emails are running in the background.`,
            count: students.length
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || "Something went wrong" });
    }
});

// Route to fetch last 5 students from final tabs
app.get("/recent-students/:type", async (req, res) => {
    try {
        const { type } = req.params;
        const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;

        if (!type || (type !== "Class" && type !== "Workshop")) {
            return res.status(400).json({ error: "Invalid category type" });
        }

        if (!googleScriptUrl || googleScriptUrl.includes("YOUR_ACTUAL_SCRIPT_ID")) {
            return res.json([]); 
        }

        const gasResponse = await fetch(`${googleScriptUrl}?action=recent&type=${encodeURIComponent(type)}`);
        
        if (!gasResponse.ok) {
            throw new Error(`Google Apps Script returned status ${gasResponse.status}`);
        }

        const data = await gasResponse.json();
        res.json(data);

    } catch (err) {
        console.error("Error fetching recent students:", err);
        res.status(500).json({ error: err.message || "Failed to fetch recent students" });
    }
});

// Route to generate and return a PDF directly for manual download
app.post("/generate-pdf-download", async (req, res) => {
    try {
        const { student, type } = req.body;

        if (!student || !student.Name) {
            return res.status(400).json({ error: "Student Name is required" });
        }

        console.log(`[Manual Download] Generating certificate for ${student.Name}...`);
        const pdfPath = await generatePDF(student);

        // Non-blocking background sync to Google Sheets (action="complete" appends directly to main sheet)
        const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;
        if (googleScriptUrl && !googleScriptUrl.includes("YOUR_ACTUAL_SCRIPT_ID") && type) {
            console.log(`[Manual Download Sync] Syncing record for ${student.Name} to Google Sheet (${type}) in background...`);
            fetch(googleScriptUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "complete",
                    type: type,
                    student: student
                })
            }).then(async (gasRes) => {
                const gasData = await gasRes.json();
                if (gasData.success) {
                    console.log(`[Manual Download Sync] Success:`, gasData.message);
                } else {
                    console.error(`[Manual Download Sync] GAS Error response:`, gasData.error);
                }
            }).catch(err => {
                console.error(`[Manual Download Sync] Connection error:`, err.message);
            });
        }

        // Send PDF for download and clean up afterward
        res.download(pdfPath, `${student.Name.replace(/\s+/g, "_")}.pdf`, (err) => {
            // Delete the temporary file from the certificates folder
            try {
                fs.unlinkSync(pdfPath);
                console.log(`[Manual Download] Cleaned up temporary PDF: ${pdfPath}`);
            } catch (unlinkErr) {
                console.error(`[Manual Download] Failed to delete PDF:`, unlinkErr.message);
            }

            if (err) {
                console.error("Failed to send PDF to client:", err.message);
                if (!res.headersSent) {
                    res.status(500).json({ error: "Failed to download certificate" });
                }
            }
        });
    } catch (err) {
        console.error("Error generating manual PDF:", err);
        res.status(500).json({ error: err.message || "Something went wrong" });
    }
});

app.listen(5000, () => {
    console.log("Server running on http://localhost:5000");
    
    // Auto-resume queue processing on boot (safeguards against server crashes)
    setTimeout(processQueues, 5000); // Wait 5s for initial startup bindings
});