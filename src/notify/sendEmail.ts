// src/notify/sendEmail.ts
import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter;
let initPromise: Promise<void>;

/**
 * Kick off Ethereal account creation at module‐load.
 * We hold on to the Promise so sendEmail can await it.
 */
initPromise = (async () => {
    const testAccount = await nodemailer.createTestAccount();
    console.log('⚗️  Ethereal test account created:');
    console.log(`    user: ${testAccount.user}`);
    console.log(`    pass: ${testAccount.pass}`);

    transporter = nodemailer.createTransport({
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

export async function sendEmail(
    to: string,
    subject: string,
    html: string
) {
    // Wait until init is done
    await initPromise;

    const info = await transporter.sendMail({
        from: `"FHIR Demo" <${(transporter.options as any).auth.user}>`,
        to,
        subject,
        html,
    });

    console.log('📨 Preview URL:', nodemailer.getTestMessageUrl(info));
}
