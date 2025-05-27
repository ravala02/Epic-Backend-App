"use strict";
// src/parser/filterObservations.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.categorizeLabResults = categorizeLabResults;
const node_fetch_1 = __importDefault(require("node-fetch"));
const thresholds_json_1 = __importDefault(require("../thresholds.json"));
const thresholds = thresholds_json_1.default;
/**
 * Fetches each NDJSON lab file, parses into Observations,
 * then splits into normal vs abnormal based on either
 * your thresholds.json or the resource's referenceRange.
 */
async function categorizeLabResults(fileUrls, accessToken) {
    const normals = [];
    const abnormals = [];
    for (const url of fileUrls) {
        const res = await (0, node_fetch_1.default)(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const ndjson = await res.text();
        for (const line of ndjson.split('\n')) {
            if (!line.trim())
                continue;
            const obs = JSON.parse(line);
            const pid = obs.subject?.reference?.replace(/^Patient\//, '');
            const vq = obs.valueQuantity;
            if (!vq?.value || typeof vq.value !== 'number') {
                console.log(`[SKIP] ${obs.id} has no numeric valueQuantity.`);
                continue;
            }
            // find a LOINC code
            const coding = obs.code?.coding?.find((c) => c.system?.includes('loinc'));
            const code = coding?.code;
            const thr = code ? thresholds[code] : undefined;
            const testName = thr?.name ?? coding?.display ?? obs.code?.text ?? code ?? '<unnamed>';
            const unit = thr?.unit ?? vq.unit ?? '';
            const low = thr?.low ?? obs.referenceRange?.[0]?.low?.value;
            const high = thr?.high ?? obs.referenceRange?.[0]?.high?.value;
            const value = vq.value;
            const target = { patientId: pid, test: testName, value, unit, low, high };
            // decide normal vs abnormal
            if (low != null && value < low || high != null && value > high) {
                abnormals.push(target);
            }
            else {
                normals.push(target);
            }
        }
    }
    return { normal: normals, abnormal: abnormals };
}
