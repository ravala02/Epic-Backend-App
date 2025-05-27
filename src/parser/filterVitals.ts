// src/parser/filterVitals.ts

import fetch from 'node-fetch';
import thresholdsData from '../thresholds.json';

export interface VitalResult {
  patientId: string;
  display: string;    // ← make sure you have this
  value: number;
  unit: string;
  low?: number;
  high?: number;
}

export async function categorizeVitals(
  urls: string[],
  token: string
): Promise<{ normal: VitalResult[]; abnormal: VitalResult[] }> {
  const normal: VitalResult[] = [];
  const abnormal: VitalResult[] = [];

  for (const url of urls) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const ndjson = await res.text();

    for (const line of ndjson.split('\n')) {
      if (!line.trim()) continue;
      const obs: any = JSON.parse(line);

      const patientId = obs.subject?.reference?.split('/')[1];
      const coding = obs.code?.coding?.[0];
      const display = coding?.display || obs.code?.text || '‹no-display›';
      const val = obs.valueQuantity?.value;
      const unit = obs.valueQuantity?.unit;
      if (!patientId || val == null || !unit) continue;

      // Look up thresholds by code
      const thrEntry = (thresholdsData as Record<string, {
        name: string;
        low: number;
        high: number;
        unit: string;
      }>)[coding.code as string];

      const low = thrEntry?.low;
      const high = thrEntry?.high;

      const result: VitalResult = { patientId, display, value: val, unit, low, high };

      if (thrEntry) {
        if (val < low! || val > high!) {
          abnormal.push(result);
        } else {
          normal.push(result);
        }
      } else {
        // no threshold defined → treat as normal
        normal.push(result);
      }
    }
  }

  return { normal, abnormal };
}
