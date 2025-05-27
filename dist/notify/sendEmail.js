"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
// src/notify/sendEmail.ts
const nodemailer_1 = __importDefault(require("nodemailer"));
let transporter;
let initPromise;
/**
 * Kick off Ethereal account creation at module‐load.
 * We hold on to the Promise so sendEmail can await it.
 */
initPromise = (async () => {
    const testAccount = await nodemailer_1.default.createTestAccount();
    console.log('⚗️  Ethereal test account created:');
    console.log(`    user: ${testAccount.user}`);
    console.log(`    pass: ${testAccount.pass}`);
    transporter = nodemailer_1.default.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
            user: testAccount.user,
            pass: testAccount.pass,
        },
    });
    // Verify connection
    await transporter.verify();
    console.log('✅ Ethereal SMTP connection OK');
})();
async function sendEmail(to, subject, html) {
    // Wait until init is done
    await initPromise;
    const info = await transporter.sendMail({
        from: `"FHIR Demo" <${transporter.options.auth.user}>`,
        to,
        subject,
        html,
    });
    console.log('📨 Preview URL:', nodemailer_1.default.getTestMessageUrl(info));
}
