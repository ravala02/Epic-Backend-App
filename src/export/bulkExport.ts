// src/export/bulkExport.ts

import fetch from 'node-fetch';
import { FHIR_BASE } from '../config';

/**
 * Kick off a FHIR Bulk $export for both lab & vital Observations
 * and for the corresponding Patient resources.
 * @param groupId the Group/<id> to export
 * @param accessToken a valid Bearer token
 * @returns the Content-Location URL to poll for status
 */
export async function kickOffExport(
    groupId: string,
    accessToken: string
): Promise<string> {
    // start with the Group/$export endpoint
    let url = `${FHIR_BASE}/Group/${groupId}/$export`;

    // ask for both Observation and Patient bundles
    url += '?_type=Observation&_type=Patient';

    // now restrict only the Observation types
    url +=
        '&_typeFilter=' +
        encodeURIComponent('Observation?category=laboratory') +
        '&_typeFilter=' +
        encodeURIComponent('Observation?category=vital-signs');

    const res = await fetch(url, {
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
 * @param statusUrl the URL returned from kickOffExport()
 * @param accessToken a valid Bearer token
 * @param intervalMs how often to retry (ms)
 * @returns an array of NDJSON file URLs from the 'output' field
 */
export async function pollExportStatus(
    statusUrl: string,
    accessToken: string,
    intervalMs = 5000
): Promise<Array<{ type: string; url: string }>> {
    console.log('🔍 Polling export status at:', statusUrl);
    while (true) {
        const res = await fetch(statusUrl, {
            method: 'GET',
            headers: {
                Accept: 'application/fhir+json',
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (res.status === 202) {
            console.log('⏳ Export still processing...');
            await new Promise((r) => setTimeout(r, intervalMs));
            continue;
        }

        if (res.status === 200) {
            const body = (await res.json()) as { output?: Array<{ type: string; url: string }> };
            if (!body.output) {
                throw new Error('Missing output URLs in status response');
            }
            console.log('📦 Export complete. Files:', body.output.map(o => `${o.type}: ${o.url}`));
            return body.output;
        }

        const text = await res.text();
        throw new Error(`Error polling export status: ${res.status} ${text}`);
    }
}
