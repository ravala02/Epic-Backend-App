"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAccessToken = fetchAccessToken;
// src/authClient.ts
const fs_1 = require("fs");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const node_fetch_1 = __importDefault(require("node-fetch"));
const config_1 = require("./config");
// Load your private key
const PRIVATE_KEY = (0, fs_1.readFileSync)(config_1.PRIVATE_KEY_PATH, 'utf8');
function buildClientAssertion() {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: config_1.CLIENT_ID,
        sub: config_1.CLIENT_ID,
        aud: config_1.EPIC_TOKEN_URL,
        jti: (0, uuid_1.v4)(),
        iat: now,
        nbf: now,
        exp: now + 300
    };
    return jsonwebtoken_1.default.sign(payload, PRIVATE_KEY, { algorithm: 'RS384' });
}
/**
 * Fetch an OAuth2 access token via client_credentials + JWT assertion
 */
async function fetchAccessToken() {
    const clientAssertion = buildClientAssertion();
    const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: clientAssertion
    });
    const res = await (0, node_fetch_1.default)(config_1.EPIC_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Token request failed (${res.status}): ${txt}`);
    }
    const body = await res.json();
    return body.access_token;
}
