// src/notify/sendSms.ts
import Twilio from 'twilio';

const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_TO_NUMBER = process.env.TWILIO_TO_NUMBER;

if (!TWILIO_FROM_NUMBER || !TWILIO_TO_NUMBER) {
    throw new Error('Missing required Twilio environment variables');
}

// Initialize the Twilio client with your test credentials
const client = Twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
);

/**
 * Send a quick SMS. In demo mode this will be caught by the Console logs
 * when you use the Twilio "magic" +15005550006 test recipient.
 */
export function sendSms(body: string) {
    return client.messages.create({
        from: TWILIO_FROM_NUMBER as string,
        to: TWILIO_TO_NUMBER as string,
        body
    });
}
