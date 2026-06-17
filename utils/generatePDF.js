import fs from "fs";
import puppeteer from "puppeteer";

function getBase64(filePath) {
    const file = fs.readFileSync(filePath);
    return `data:image/png;base64,${file.toString("base64")}`;
}

export async function generatePDF(student) {

    const browser = await puppeteer.launch({
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu"
        ]
    });
    const page = await browser.newPage();

    let html = fs.readFileSync("./templates/certificate.html", "utf8");

    // 🔥 convert images to base64
    const bgBase64 = getBase64("./templates/finalbg.png");
    const signBase64 = getBase64("./templates/sign3.png");

    const name = student.Name ? String(student.Name).trim() : "Student";
    const level = student.Level ? String(student.Level).trim() : "";
    const date = student.Date ? String(student.Date).trim() : "";
    const certId = student["Certificate ID"] ? String(student["Certificate ID"]).trim() : "";

    html = html
        .replace("{{name}}", name)
        .replace("{{level}}", level)
        .replace("{{date}}", date)
        .replace("{{id}}", certId)
        .replace("{{bg}}", bgBase64)
        .replace("{{sign}}", signBase64);

    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const safeName = name.replace(/\s+/g, "_");
    const filePath = `certificates/${safeName}.pdf`;

    await page.pdf({
        path: filePath,
        width: "1100px",
        height: "778px",
        printBackground: true
    });

    await browser.close();

    return filePath;
}