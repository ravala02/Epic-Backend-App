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
      if (!(loinc in thresholds)) {
        console.warn(`⚠️  No threshold defined for LOINC ${loinc}`);
        continue;
      }
      const def = thresholds[loinc as keyof typeof thresholds];

      // strip off "Patient/" from reference
      const patientId = obs.subject.reference.split('/').pop()!;

      const vq = obs.valueQuantity;
      if (!vq) {
        console.log('⚠️  Missing valueQuantity');
        continue;
      }
      const value = vq.value;
      const unit = vq.unit;

      const result: LabResult = {
        id: obs.id,
        patientId,
        patientName: patientMap[patientId] || patientId,
        test: obs.code!.text ?? coding.display ?? loinc,
        value,
        unit,
        low: def.low,
        high: def.high,
      };

      if (value < def.low || value > def.high) {
        console.log('⚠️  Abnormal lab value:', result);
        abnormal.push(result);
      } else {
        console.log('✅ Normal lab value:', result);
        normal.push(result);
      }
    }
  }

  console.log(`📊 Final counts - Normal: ${normal.length}, Abnormal: ${abnormal.length}`);
  return { normal, abnormal };
}
