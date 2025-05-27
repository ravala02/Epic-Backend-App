// smtpTest.ts
import 'dotenv/config';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true',    // true = SSL/TLS, false = STARTTLS
    auth: {
        user: process.env.EMAIL_USER!,
        pass: process.env.EMAIL_PASS!,                // Your 16‑char App Password
    },
    requireTLS: process.env.EMAIL_SECURE === 'false',
    logger: true,
    debug: true
});

transporter
    .verify()
    .then(() => console.log('✅ SMTP connection OK'))
    .catch(err => {
        console.error('❌ SMTP connection error:', err);
        process.exit(1);
    });
