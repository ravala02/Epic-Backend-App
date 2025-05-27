// src/config.ts
import * as dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
    const val = process.env[key];
    if (!val) {
        throw new Error(`Missing required environment variable ${key}`);
    }
    return val;
}

export const CLIENT_ID = requireEnv('CLIENT_ID');
export const EPIC_TOKEN_URL = requireEnv('EPIC_TOKEN_URL');
export const PRIVATE_KEY_PATH = requireEnv('PRIVATE_KEY_PATH');
export const FHIR_BASE = requireEnv('FHIR_BASE');
export const GROUP_ID = requireEnv('GROUP_ID');
