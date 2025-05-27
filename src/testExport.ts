// src/testExport.ts

import 'dotenv/config';
import fetch from 'node-fetch';
import { fetchAccessToken } from './authClient';
import { kickOffExport, pollExportStatus } from './export/bulkExport';
import { categorizeLabResults } from './parser/filterObservations';
import { categorizeVitals } from './parser/filterVitals';
import { sendEmail } from './notify/sendEmail';
import { GROUP_ID } from './config';

(async () => {
    try {
        // 0) ensure we have a 'to' address
        const toAddr = process.env.ALERT_EMAIL;
        if (!toAddr) {
            throw new Error('Please set ALERT_EMAIL in your .env (any address is fine for Ethereal).');
        }

        // 1) Kick off bulk-export
        const token = await fetchAccessToken();
        console.log('🔑 Got token');

        let statusUrl: string;
        try {
            statusUrl = await kickOffExport(GROUP_ID, token);
        } catch (err: any) {
            if (err.message.includes('Another request for this same Client')) {
                console.log('🔁 Export already running, waiting 30s …');
                await new Promise(r => setTimeout(r, 30_000));
                statusUrl = await kickOffExport(GROUP_ID, token);
            } else {
                throw err;
            }
        }
        console.log('🚀 Export kicked off, status URL:', statusUrl);

        // 2) Poll until the NDJSON files are ready
        console.log('⏳ Polling for file URLs…');
        const fileUrls = await pollExportStatus(statusUrl, token);
        console.log('📂 All export file URLs:', fileUrls);

        // assume the first is labs, second vitals, third patients
        const [labUrl, vitalUrl, patientUrl] = fileUrls;

        // 3) Download & index patients (IDs only)
        console.log('👤 Building patient index…');
        const patientMap: Record<string, string> = {};
        {
            const res = await fetch(patientUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) throw new Error(`Failed to fetch Patient file: ${res.status}`);
            const ndjson = await res.text();
            for (const line of ndjson.split('\n')) {
                if (!line.trim()) continue;
                const pat: any = JSON.parse(line);
                patientMap[pat.id] = pat.id;
            }
        }
        console.log('🔗 Patient map sample:', Object.entries(patientMap).slice(0, 3));

        // 4) Categorize Labs
        console.log('🔬 Categorizing lab results…');
        const { normal: normalLabs, abnormal: abnormalLabs } =
            await categorizeLabResults([labUrl], token);
        console.log(`✅ Normal labs:   ${normalLabs.length}`);
        console.table(
            normalLabs.slice(0, 20).map(lr => ({
                patient: lr.patientId,
                test: lr.test,
                value: lr.value,
                unit: lr.unit,
            })),
            ['patient', 'test', 'value', 'unit']
        );
        console.log(`⚠️  Abnormal labs: ${abnormalLabs.length}`);
        console.table(
            abnormalLabs.slice(0, 20).map(lr => ({
                patient: lr.patientId,
                test: lr.test,
                value: lr.value,
                unit: lr.unit,
            })),
            ['patient', 'test', 'value', 'unit']
        );

        // 5) Categorize Vitals
        console.log('🫀 Categorizing vital signs…');
        const { normal: normalVitals, abnormal: abnormalVitals } =
            await categorizeVitals([vitalUrl], token);
        console.log(`✅ Normal vitals:   ${normalVitals.length}`);
        console.table(
            normalVitals.slice(0, 20).map(vr => ({
                patient: vr.patientId,
                display: vr.display,
                value: vr.value,
                unit: vr.unit,
            })),
            ['patient', 'display', 'value', 'unit']
        );
        console.log(`⚠️  Abnormal vitals: ${abnormalVitals.length}`);
        console.table(
            abnormalVitals.slice(0, 20).map(vr => ({
                patient: vr.patientId,
                display: vr.display,
                value: vr.value,
                unit: vr.unit,
            })),
            ['patient', 'display', 'value', 'unit']
        );

        // 6) Send Email summary
        console.log('✉️  Sending email summary…');
        const subject = `Daily Patient Report: ${abnormalLabs.length} Abnormal Labs, ${abnormalVitals.length} Abnormal Vitals`;
        const html = `
      <h1>Daily Patient Report</h1>
      <p><strong>Abnormal Labs:</strong> ${abnormalLabs.length}</p>
      <p><strong>Abnormal Vitals:</strong> ${abnormalVitals.length}</p>
      <h2>Abnormal Labs (up to 20)</h2>
      <ul>${abnormalLabs.slice(0, 20).map(lr =>
            `<li>${lr.patientId} — ${lr.test}: ${lr.value}${lr.unit || ''}</li>`
        ).join('')}</ul>
      <h2>Abnormal Vitals (up to 20)</h2>
      <ul>${abnormalVitals.slice(0, 20).map(vr =>
            `<li>${vr.patientId} — ${vr.display}: ${vr.value}${vr.unit || ''}</li>`
        ).join('')}</ul>
    `;
        await sendEmail(toAddr, subject, html);
        console.log('✅ Email alert sent—check the Preview URL above');

    } catch (err: any) {
        console.error('❌ Error during testExport:', err.message || err);
        process.exit(1);
    }
})();
