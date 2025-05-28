import fetch from 'node-fetch';
import thresholds from '../thresholds.json';
import { VitalResult } from '../types';

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

export async function categorizeVitals(
  urls: string[],
  token: string,
  patientMap: Record<string, string>
): Promise<{ normal: VitalResult[]; abnormal: VitalResult[] }> {
  const normal: VitalResult[] = [];
  const abnormal: VitalResult[] = [];

  for (const url of urls) {
    console.log('🫀 Processing vital observations from:', url);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Failed to fetch vitals at ${url}: ${res.status}`);
    const ndjson = await res.text();
    const lines = ndjson.split('\n').filter(line => line.trim());
    console.log(`📊 Found ${lines.length} total observations`);

    for (const line of lines) {
      const obs = JSON.parse(line) as Observation;

      // Debug category
      console.log('🔍 Observation category:', JSON.stringify(obs.category));

      // guard against missing code/coding
      const coding = obs.code?.coding?.[0];
      if (!coding) {
        console.log('⚠️  Missing code/coding');
        continue;
      }

      const loinc = coding.code;
      console.log('Vital LOINC code:', loinc);
      if (!(loinc in thresholds)) {
        console.warn(`⚠️  No threshold defined for LOINC ${loinc}`);
        continue;
      }
      const def = thresholds[loinc as keyof typeof thresholds];

      const patientId = obs.subject.reference.split('/').pop()!;

      const vq = obs.valueQuantity;
      if (!vq) {
        console.log('⚠️  Missing valueQuantity');
        continue;
      }
      const value = vq.value;
      const unit = vq.unit;

      const result: VitalResult = {
        id: obs.id,
        patientId,
        patientName: patientMap[patientId] || patientId,
        display: obs.code!.text ?? coding.display ?? loinc,
        value,
        unit,
        low: def.low,
        high: def.high,
      };

      if (value < def.low || value > def.high) {
        console.log('⚠️  Abnormal vital value:', result);
        abnormal.push(result);
      } else {
        console.log('✅ Normal vital value:', result);
        normal.push(result);
      }
    }
  }

  console.log(`📊 Final counts - Normal: ${normal.length}, Abnormal: ${abnormal.length}`);
  return { normal, abnormal };
}
