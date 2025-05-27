// src/parser/filterObservations.ts

import fetch from 'node-fetch';
import rawThresholds from '../thresholds.json';
import { Observation, ThresholdDef } from '../types';

export interface LabResult {
  patientId: string;
  test: string;
  value: number;
  unit: string;
  low?: number;
  high?: number;
}

// tell TypeScript “this is a string→ThresholdDef map”
const thresholds = rawThresholds as Record<string, ThresholdDef>;

export async function categorizeLabResults(
  urls: string[],
  token: string
): Promise<{ normal: LabResult[]; abnormal: LabResult[] }> {
  const normal: LabResult[] = [];
  const abnormal: LabResult[] = [];

  for (const url of urls) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.warn(`⚠️  Skipping lab file ${url}: ${res.status}`);
      continue;
    }

    const ndjson = await res.text();
    for (const line of ndjson.split('\n')) {
      if (!line.trim()) continue;

      const obs = JSON.parse(line) as Observation;
      const patRef = obs.subject?.reference || '';
      const patientId = patRef.split('/')[1] || '';

      const coding = obs.code?.coding?.[0];
      const code = coding?.code;
      if (!code) continue;

      const th = thresholds[code];
      const testName = th?.name || coding.display || obs.code?.text || 'Unknown';
      const val = obs.valueQuantity?.value;
      const unit = obs.valueQuantity?.unit || '';

      if (typeof val !== 'number') continue;

      const result: LabResult = { patientId, test: testName, value: val, unit };
      if (th) {
        result.low = th.low;
        result.high = th.high;
        if (val < th.low || val > th.high) {
          abnormal.push(result);
        } else {
          normal.push(result);
        }
      } else {
        normal.push(result);
      }
    }
  }

  return { normal, abnormal };
}
