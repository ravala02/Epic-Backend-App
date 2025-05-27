"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSms = sendSms;
// src/notify/sendSms.ts
const twilio_1 = __importDefault(require("twilio"));
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_TO_NUMBER = process.env.TWILIO_TO_NUMBER;
if (!TWILIO_FROM_NUMBER || !TWILIO_TO_NUMBER) {
    throw new Error('Missing required Twilio environment variables');
}
// Initialize the Twilio client with your test credentials
const client = (0, twilio_1.default)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
/**
 * Send a quick SMS. In demo mode this will be caught by the Console logs
 * when you use the Twilio "magic" +15005550006 test recipient.
 */
function sendSms(body) {
    return client.messages.create({
        from: TWILIO_FROM_NUMBER,
        to: TWILIO_TO_NUMBER,
        body
    });
}
