"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// smtpTest.ts
require("dotenv/config");
const nodemailer_1 = __importDefault(require("nodemailer"));
const transporter = nodemailer_1.default.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true', // true = SSL/TLS, false = STARTTLS
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // Your 16‑char App Password
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
