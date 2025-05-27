// src/authClient.ts

import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import {
    CLIENT_ID,
    EPIC_TOKEN_URL,
    PRIVATE_KEY_PATH,
} from './config';

// Load your private key (must be the **private** key, not the .pub file)
const PRIVATE_KEY = readFileSync(PRIVATE_KEY_PATH, 'utf8');

if (
    !PRIVATE_KEY.includes('BEGIN RSA PRIVATE KEY') &&
    !PRIVATE_KEY.includes('BEGIN PRIVATE KEY')
) {
    console.warn(
        `⚠️  Warning: "${PRIVATE_KEY_PATH}" doesn’t look like a private key!`
    );
}

function buildClientAssertion(): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: CLIENT_ID,
        sub: CLIENT_ID,
        aud: EPIC_TOKEN_URL,
        jti: uuidv4(),
        iat: now,
        nbf: now,
        exp: now + 300,
    };
    const header = { alg: 'RS384' as const, typ: 'JWT' as const };

    console.log('🔑 JWT Header:', header);
    console.log('🔑 JWT Payload:', payload);

    return jwt.sign(payload, PRIVATE_KEY, {
        algorithm: 'RS384',
        header,
    });
}

export async function fetchAccessToken(): Promise<string> {
    if (!CLIENT_ID) {
        throw new Error('⚠️ CLIENT_ID is not set in your config');
    }
    if (!EPIC_TOKEN_URL) {
        throw new Error('⚠️ EPIC_TOKEN_URL is not set in your config');
    }

    console.log('🔑 Using CLIENT_ID:', CLIENT_ID);
    console.log('🔑 Using EPIC_TOKEN_URL:', EPIC_TOKEN_URL);

    const clientAssertion = buildClientAssertion();

    // Build the form body, now including scope
    const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type:
            'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: clientAssertion,
        scope: 'system/*.read',
    });

    console.log('↗️  POSTing to token endpoint...');
    console.log('   → Request body:', params.toString());

    const res = await fetch(EPIC_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    const text = await res.text();
    let body: any;
    try {
        body = JSON.parse(text);
    } catch {
        throw new Error(
            `Token endpoint returned non-JSON (${res.status}):\n${text}`
        );
    }

    if (!res.ok) {
        throw new Error(
            `Token request failed (${res.status}): ${JSON.stringify(body)}`
        );
    }
    if (!body.access_token) {
        throw new Error(
            `Token response missing access_token: ${JSON.stringify(body)}`
        );
    }

    console.log('✅ Access token acquired');
    return body.access_token as string;
}
