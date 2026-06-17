import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

export async function sendEmail(student, pdfPath) {
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: student.Email,
        subject: "Your Certificate 🎓",
        text: `Hello ${student.Name},\n\nCongratulations! Please find your certificate attached.`,
        attachments: [
            {
                filename: "certificate.pdf",
                path: pdfPath
            }
        ]
    });

    console.log(`Email sent to ${student.Email}`);
}