"use strict";
// src/testExport.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_fetch_1 = __importDefault(require("node-fetch"));
const authClient_1 = require("./authClient");
const bulkExport_1 = require("./export/bulkExport");
const filterObservations_1 = require("./parser/filterObservations");
const filterVitals_1 = require("./parser/filterVitals");
const sendEmail_1 = require("./notify/sendEmail");
const config_1 = require("./config");
(async () => {
    try {
        // 0) ensure we have a 'to' address
        const toAddr = process.env.ALERT_EMAIL;
        if (!toAddr) {
            throw new Error('Please set ALERT_EMAIL in your .env (any address is fine for Ethereal).');
        }
        // 1) Kick off bulk‑export (labs + vitals + patients)
        const token = await (0, authClient_1.fetchAccessToken)();
        console.log('🔑 Got token');
        let statusUrl;
        try {
            statusUrl = await (0, bulkExport_1.kickOffExport)(config_1.GROUP_ID, token);
        }
        catch (err) {
            if (err.message.includes('Another request for this same Client')) {
                console.log('🔁 Export already running, waiting 30s …');
                await new Promise(r => setTimeout(r, 30000));
                statusUrl = await (0, bulkExport_1.kickOffExport)(config_1.GROUP_ID, token);
            }
            else {
                throw err;
            }
        }
        console.log('🚀 Export kicked off, status URL:', statusUrl);
        // 2) Poll until the NDJSON files are ready
        console.log('⏳ Polling for file URLs…');
        const fileUrls = await (0, bulkExport_1.pollExportStatus)(statusUrl, token);
        if (fileUrls.length < 3) {
            throw new Error(`Expected ≥3 files (labs + vitals + patients), got ${fileUrls.length}`);
        }
        const [labUrl, vitalUrl, patientUrl] = fileUrls;
        // 3) Download & index patients for names
        console.log('👤 Building patient index…');
        const patientMap = {};
        {
            const res = await (0, node_fetch_1.default)(patientUrl, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok)
                throw new Error(`Failed to fetch Patient file: ${res.status}`);
            const ndjson = await res.text();
            for (const line of ndjson.split('\n')) {
                if (!line.trim())
                    continue;
                const pat = JSON.parse(line);
                const id = pat.id;
                const nm = pat.name?.[0];
                const full = nm
                    ? `${(nm.given || []).join(' ')} ${nm.family || ''}`.trim()
                    : '‹no-name›';
                patientMap[id] = full;
            }
        }
        console.log('🔗 Patient map sample:', Object.entries(patientMap).slice(0, 3));
        // 4) Categorize Labs
        console.log('🔬 Categorizing lab results…');
        const { normal: normalLabs, abnormal: abnormalLabs } = await (0, filterObservations_1.categorizeLabResults)([labUrl], token);
        console.log(`✅ Normal labs:   ${normalLabs.length}`);
        console.table(normalLabs.slice(0, 20).map(lr => ({
            patient: patientMap[lr.patientId] || lr.patientId,
            test: lr.test,
            value: lr.value,
            unit: lr.unit,
            low: lr.low,
            high: lr.high,
        })), ['patient', 'test', 'value', 'unit', 'low', 'high']);
        console.log(`⚠️  Abnormal labs: ${abnormalLabs.length}`);
        console.table(abnormalLabs.slice(0, 20).map(lr => ({
            patient: patientMap[lr.patientId] || lr.patientId,
            test: lr.test,
            value: lr.value,
            unit: lr.unit,
            low: lr.low,
            high: lr.high,
        })), ['patient', 'test', 'value', 'unit', 'low', 'high']);
        // 5) Categorize Vitals
        console.log('🫀 Categorizing vital signs…');
        const { normal: normalVitals, abnormal: abnormalVitals } = await (0, filterVitals_1.categorizeVitals)([vitalUrl], token);
        console.log(`✅ Normal vitals:   ${normalVitals.length}`);
        console.table(normalVitals.slice(0, 20).map(vr => ({
            patient: patientMap[vr.patientId] || vr.patientId,
            type: vr.type,
            value: vr.value,
            unit: vr.unit,
        })), ['patient', 'type', 'value', 'unit']);
        console.log(`⚠️  Abnormal vitals: ${abnormalVitals.length}`);
        console.table(abnormalVitals.slice(0, 20).map(vr => ({
            patient: patientMap[vr.patientId] || vr.patientId,
            type: vr.type,
            value: vr.value,
            unit: vr.unit,
        })), ['patient', 'type', 'value', 'unit']);
        // 6) Send Email summary via Ethereal
        console.log('✉️  Sending email summary…');
        const subject = `Daily Patient Report: ${abnormalLabs.length} Abnormal Labs, ${abnormalVitals.length} Abnormal Vitals`;
        const html = `
      <h1>Daily Patient Report</h1>
      <p><strong>Total Patients:</strong> ${Object.keys(patientMap).length}</p>
      <p><strong>Abnormal Labs:</strong> ${abnormalLabs.length}</p>
      <p><strong>Abnormal Vitals:</strong> ${abnormalVitals.length}</p>
      <h2>Abnormal Labs (up to 20)</h2>
      <ul>
        ${abnormalLabs.slice(0, 20).map(lr => `<li>${patientMap[lr.patientId] || lr.patientId} — ${lr.test}: ${lr.value}${lr.unit || ''} (ref ${lr.low ?? '?'}–${lr.high ?? '?'})</li>`).join('')}
      </ul>
      <h2>Abnormal Vitals (up to 20)</h2>
      <ul>
        ${abnormalVitals.slice(0, 20).map(vr => `<li>${patientMap[vr.patientId] || vr.patientId} — ${vr.type}: ${vr.value}${vr.unit || ''}</li>`).join('')}
      </ul>
    `;
        await (0, sendEmail_1.sendEmail)(toAddr, subject, html);
        console.log('✅ Email alert sent—check the Preview URL above');
    }
    catch (err) {
        console.error('❌ Error during testExport:', err.message || err);
        process.exit(1);
    }
})();
