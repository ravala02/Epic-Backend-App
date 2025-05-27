"use strict";
// src/parser/filterVitals.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.categorizeVitals = categorizeVitals;
const node_fetch_1 = __importDefault(require("node-fetch"));
const thresholds_json_1 = __importDefault(require("../thresholds.json"));
const STATIC_THRESHOLDS = thresholds_json_1.default;
async function categorizeVitals(fileUrls, accessToken) {
    const normal = [];
    const abnormal = [];
    for (const url of fileUrls) {
        const res = await (0, node_fetch_1.default)(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const ndjson = await res.text();
        for (const line of ndjson.split('\n')) {
            if (!line.trim())
                continue;
            const obs = JSON.parse(line);
            // only vital-signs
            if (obs.category?.[0]?.coding?.[0]?.code !== 'vital-signs')
                continue;
            const qty = obs.valueQuantity;
            if (typeof qty?.value !== 'number')
                continue;
            const value = qty.value;
            const unit = qty.unit;
            const patientId = obs.subject.reference.split('/').pop();
            // extract LOINC code
            const loinc = obs.code.coding
                .find((c) => c.system?.toLowerCase().includes('loinc'))
                ?.code;
            const thr = loinc ? STATIC_THRESHOLDS[loinc] : undefined;
            if (!thr) {
                // no static threshold: treat as normal (or you can log)
                normal.push({ patientId, type: obs.code.text, value, unit, abnormal: false });
                continue;
            }
            const isAbn = value < thr.low || value > thr.high;
            const result = {
                patientId,
                type: thr.name,
                value,
                unit: thr.unit || unit,
                low: thr.low,
                high: thr.high,
                abnormal: isAbn,
            };
            if (isAbn)
                abnormal.push(result);
            else
                normal.push(result);
        }
    }
    return { normal, abnormal };
}
