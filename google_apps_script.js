/**
 * Google Apps Script Web App Code
 * 
 * Paste this code into the Extensions > Apps Script editor of your Google Sheet.
 * Make sure to deploy this as a Web App:
 * 1. Click "Deploy" > "New deployment"
 * 2. Select type: "Web app"
 * 3. Set "Execute as": "Me"
 * 4. Set "Who has access": "Anyone"
 * 5. Copy the Web App URL and save it in your Express backend's .env file.
 */

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action || "queue"; // "queue" or "complete"
    const type = payload.type; // "Class" or "Workshop"
    
    if (!type || (type !== "Class" && type !== "Workshop")) {
      return response({ success: false, error: "Invalid type: " + type });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (action === "queue") {
      const students = payload.students;
      if (!students || !Array.isArray(students)) {
        return response({ success: false, error: "Students array is missing." });
      }
      
      const qSheetName = "Queue_" + type;
      let qSheet = ss.getSheetByName(qSheetName);
      if (!qSheet) {
        qSheet = ss.insertSheet(qSheetName);
      }
      
      if (qSheet.getLastRow() === 0) {
        qSheet.appendRow(["Certificate ID", "Name", "Level", "Date", "Email"]);
      }
      
      for (let s of students) {
        qSheet.appendRow([
          s["Certificate ID"] || "",
          s["Name"] || "",
          s["Level"] || "",
          s["Date"] || "",
          s["Email"] || ""
        ]);
      }
      
      return response({ success: true, message: "Queued " + students.length + " students in " + qSheetName });
      
    } else if (action === "complete") {
      const student = payload.student;
      if (!student) {
        return response({ success: false, error: "Student data is missing." });
      }
      
      // Append to final category sheet
      let mainSheet = ss.getSheetByName(type);
      if (!mainSheet) {
        mainSheet = ss.insertSheet(type);
      }
      if (mainSheet.getLastRow() === 0) {
        mainSheet.appendRow(["Certificate ID", "Name", "Level", "Date", "Email"]);
      }
      mainSheet.appendRow([
        student["Certificate ID"] || "",
        student["Name"] || "",
        student["Level"] || "",
        student["Date"] || "",
        student["Email"] || ""
      ]);
      
      // Delete from the queue sheet (first student row is always row 2)
      const qSheetName = "Queue_" + type;
      const qSheet = ss.getSheetByName(qSheetName);
      if (qSheet && qSheet.getLastRow() > 1) {
        qSheet.deleteRow(2);
      }
      
      return response({ success: true, message: "Successfully sync and removed student from queue." });
    }
    
    return response({ success: false, error: "Unknown action: " + action });
  } catch (err) {
    return response({ success: false, error: err.toString() });
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action || "recent"; // "recent" or "getQueue"
    const type = e.parameter.type || "Class";
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (action === "recent") {
      const sheet = ss.getSheetByName(type);
      if (!sheet) return response([]);
      
      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) return response([]);
      
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const numRows = Math.min(5, lastRow - 1);
      const startRow = lastRow - numRows + 1;
      const values = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();
      
      const result = [];
      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        const student = {};
        for (let j = 0; j < headers.length; j++) {
          student[headers[j]] = row[j];
        }
        result.push(student);
      }
      result.reverse();
      return response(result);
      
    } else if (action === "getQueue") {
      const qSheetName = "Queue_" + type;
      const qSheet = ss.getSheetByName(qSheetName);
      
      if (!qSheet) {
        return response({ count: 0, nextStudent: null });
      }
      
      const lastRow = qSheet.getLastRow();
      if (lastRow <= 1) {
        return response({ count: 0, nextStudent: null });
      }
      
      const headers = qSheet.getRange(1, 1, 1, qSheet.getLastColumn()).getValues()[0];
      const nextStudentValues = qSheet.getRange(2, 1, 1, qSheet.getLastColumn()).getValues()[0];
      
      const nextStudent = {};
      for (let j = 0; j < headers.length; j++) {
        nextStudent[headers[j]] = nextStudentValues[j];
      }
      
      return response({
        count: lastRow - 1,
        nextStudent: nextStudent
      });
    }
    
    return response({ error: "Unknown action" });
  } catch (err) {
    return response({ error: err.toString() });
  }
}

function response(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
