"use strict";
// src/export/bulkExport.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.kickOffExport = kickOffExport;
exports.pollExportStatus = pollExportStatus;
const node_fetch_1 = __importDefault(require("node-fetch"));
const config_1 = require("../config");
/**
 * Kick off a FHIR Bulk $export for both lab & vital Observations
 * and for the corresponding Patient resources.
 * @returns the Content-Location URL to poll for status
 */
async function kickOffExport(groupId, accessToken) {
    // start with the Group/$export endpoint
    let url = `${config_1.FHIR_BASE}/Group/${groupId}/$export`;
    // ask for both Observation and Patient bundles
    url += '?_type=Observation&_type=Patient';
    // now restrict only the Observation types
    url +=
        '&_typeFilter=' +
            encodeURIComponent('Observation?category=laboratory') +
            '&_typeFilter=' +
            encodeURIComponent('Observation?category=vital-signs');
    const res = await (0, node_fetch_1.default)(url, {
        method: 'GET',
        headers: {
            Accept: 'application/fhir+json',
            Prefer: 'respond-async',
            Authorization: `Bearer ${accessToken}`,
        },
    });
    if (res.status !== 202) {
        const body = await res.text();
        throw new Error(`Export kick-off failed: ${res.status} ${body}`);
    }
    const statusUrl = res.headers.get('content-location');
    if (!statusUrl) {
        throw new Error('No Content-Location header on export kick-off');
    }
    return statusUrl;
}
/**
 * Poll the status endpoint until it returns 200 OK.
 * @returns an array of NDJSON file URLs from the 'output' field
 */
async function pollExportStatus(statusUrl, accessToken, intervalMs = 5000) {
    while (true) {
        const res = await (0, node_fetch_1.default)(statusUrl, {
            method: 'GET',
            headers: {
                Accept: 'application/fhir+json',
                Authorization: `Bearer ${accessToken}`,
            },
        });
        if (res.status === 202) {
            // still processing
            await new Promise((r) => setTimeout(r, intervalMs));
            continue;
        }
        if (res.status === 200) {
            const body = (await res.json());
            if (!body.output) {
                throw new Error('Missing output URLs in status response');
            }
            return body.output.map((o) => o.url);
        }
        const text = await res.text();
        throw new Error(`Error polling export status: ${res.status} ${text}`);
    }
}
