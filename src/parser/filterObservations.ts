import fetch from 'node-fetch';
import thresholds from '../thresholds.json';
import { LabResult } from '../types';

interface Observation {
  id: string;
  subject: { reference: string };
  code?: {
    coding?: Array<{ code: string; display?: string }>;
    text?: string;
  };
  valueQuantity?: { value: number; unit?: string };
  category?: Array<{
    coding?: Array<{ code: string; system?: string }>;
  }>;
}

export async function categorizeLabResults(
  urls: string[],
  token: string,
  patientMap: Record<string, string>
): Promise<{ normal: LabResult[]; abnormal: LabResult[] }> {
  const normal: LabResult[] = [];
  const abnormal: LabResult[] = [];

  for (const url of urls) {
    console.log('🔬 Processing lab observations from:', url);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Failed to fetch labs at ${url}: ${res.status}`);
    const ndjson = await res.text();
    const lines = ndjson.split('\n').filter(line => line.trim());
    console.log(`📊 Found ${lines.length} total observations`);
    if (lines.length > 0) {
      try {
        console.log('Sample lab observation:', JSON.parse(lines[0]));
      } catch (e) {
        console.log('Sample lab observation (raw):', lines[0]);
      }
    }
    let skipped = 0, missingThreshold = 0;
    for (const line of lines) {
      const obs = JSON.parse(line) as Observation;
      // Try to extract LOINC code from multiple possible locations
      let loinc: string | undefined = undefined;
      let coding = obs.code?.coding?.[0];
      if (coding && coding.code) {
        loinc = coding.code;
      } else if ((obs as any).loincCode) {
        loinc = (obs as any).loincCode;
      } else if ((obs as any).code) {
        loinc = (obs as any).code;
      }
      if (!loinc) { skipped++; console.log('⏭️  Skipped: missing LOINC code', obs); continue; }
      if (!(loinc in thresholds)) { missingThreshold++; console.log(`⏭️  Skipped: missing threshold for LOINC ${loinc}`); continue; }
      const def = thresholds[loinc as keyof typeof thresholds];
      const patientId = obs.subject.reference.split('/').pop()!;
      const vq = obs.valueQuantity;
      if (!vq) { skipped++; console.log('⏭️  Skipped: missing valueQuantity'); continue; }
      const value = vq.value;
      const unit = vq.unit;
      const result: LabResult = {
        id: obs.id,
        patientId,
        patientName: patientMap[patientId] || patientId,
        test: obs.code?.text ?? coding?.display ?? loinc,
        value,
        unit,
        low: def.low,
        high: def.high,
      };
      if (typeof value !== 'number' || typeof def.low !== 'number' || typeof def.high !== 'number') {
        skipped++;
        console.log('⏭️  Skipped: missing/invalid value, low, or high', { value, low: def.low, high: def.high });
        continue;
      }
      if (value < def.low || value > def.high) abnormal.push(result);
      else normal.push(result);
    }
    console.log(`✅ Labs processed: ${lines.length}, Normal: ${normal.length}, Abnormal: ${abnormal.length}, Skipped: ${skipped}, Missing thresholds: ${missingThreshold}`);
  }

  console.log(`📊 Final counts - Normal: ${normal.length}, Abnormal: ${abnormal.length}`);
  return { normal, abnormal };
}
