import fetch from 'node-fetch';
import thresholds from '../thresholds.json';
import { VitalResult } from '../types';

interface Observation {
  id: string;
  subject: { reference: string };
  code?: {
    coding?: Array<{ code: string; display?: string; system?: string }>;
    text?: string;
  };
  valueQuantity?: { value: number; unit?: string };
  category?: Array<{
    coding?: Array<{ code: string; system?: string }>;
  }>;
  effectiveDateTime?: string;
}

export async function categorizeVitals(
  urls: string[],
  token: string,
  patientMap: Record<string, string>
): Promise<{ normal: VitalResult[]; abnormal: VitalResult[]; unclassified: VitalResult[] }> {
  const normal: VitalResult[] = [];
  const abnormal: VitalResult[] = [];
  const unclassified: VitalResult[] = [];

  for (const url of urls) {
    console.log('🫀 Processing vital observations from:', url);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Failed to fetch vitals at ${url}: ${res.status}`);
    const ndjson = await res.text();
    const lines = ndjson.split('\n').filter(line => line.trim());
    console.log(`📊 Found ${lines.length} total observations`);

    for (const line of lines) {
      const obs = JSON.parse(line) as Observation;

      // Filter by category: only process vital-signs observations
      const isVitalSign = obs.category?.some(cat =>
        cat.coding?.some(c => c.system === 'http://terminology.hl7.org/CodeSystem/observation-category' && c.code === 'vital-signs')
      );

      if (!isVitalSign) {
        continue;
      }

      // Debug category
      console.log('🔍 Observation category:', JSON.stringify(obs.category));

      // guard against missing code/coding
      const coding = obs.code?.coding?.[0];
      let loinc: string | undefined = undefined;

      if (coding?.code) {
        loinc = coding.code;
      } else if (obs.code?.text) {
        // Attempt to map common text descriptions to LOINC codes if possible
        // This is a simplistic approach; a more robust solution might involve a lookup table
        // or a more sophisticated mapping mechanism.
        if (obs.code.text.toLowerCase().includes('heart rate')) {
          loinc = '8867-4'; // LOINC for Heart Rate
        } else if (obs.code.text.toLowerCase().includes('blood pressure')) {
          // This would need to be more specific for systolic/diastolic
          loinc = '8480-6'; // LOINC for Systolic Blood Pressure (example)
        } else if (obs.code.text.toLowerCase().includes('temperature')) {
          loinc = '8310-5'; // LOINC for Body Temperature
        }
        // Add more mappings as needed
      }

      const patientId = obs.subject.reference.split('/').pop()!;

      if (!loinc) {
        console.log('⚠️  Missing LOINC code or text description for vital', obs);
        unclassified.push({
          id: obs.id,
          patientId,
          patientName: patientMap[patientId] || patientId,
          display: obs.code?.text || 'Unknown Vital',
          value: obs.valueQuantity?.value,
          unit: obs.valueQuantity?.unit,
          low: undefined, // No threshold available
          high: undefined, // No threshold available
          timestamp: obs.effectiveDateTime,
        });
        continue;
      }

      console.log('Vital LOINC code:', loinc);
      if (!(loinc in thresholds)) {
        console.warn(`⚠️  No threshold defined for LOINC ${loinc}. Adding to unclassified.`);
        unclassified.push({
          id: obs.id,
          patientId,
          patientName: patientMap[patientId] || patientId,
          display: obs.code?.text ?? coding?.display ?? loinc,
          value: obs.valueQuantity?.value,
          unit: obs.valueQuantity?.unit,
          low: undefined, // No threshold available
          high: undefined, // No threshold available
          timestamp: obs.effectiveDateTime,
        });
        continue;
      }
      const def = thresholds[loinc as keyof typeof thresholds];

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
        display: obs.code?.text ?? coding?.display ?? loinc,
        value,
        unit,
        low: def.low,
        high: def.high,
        timestamp: obs.effectiveDateTime,
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

  console.log(`📊 Final counts - Normal: ${normal.length}, Abnormal: ${abnormal.length}, Unclassified: ${unclassified.length}`);
  return { normal, abnormal, unclassified };
}
