// src/types.ts

export interface ThresholdDef {
  name: string;
  low: number;
  high: number;
  unit: string;
}

/**
 * A minimal FHIR Observation resource shape
 */
export interface Observation {
  resourceType: 'Observation';
  id: string;
  subject: {
    reference: string;        // e.g. "Patient/{patientId}"
  };
  code: {
    coding: Array<{
      system?: string;
      code: string;
      display?: string;
    }>;
    text?: string;
  };
  effectiveDateTime?: string;
  valueQuantity: {
    value: number;
    unit: string;
  };
}

export interface LabResult {
  id: string;
  patientId: string;
  patientName: string;
  test: string;
  value: number;
  unit?: string;
  low: number;
  high: number;
}

export interface VitalResult {
  id: string;
  patientId: string;
  patientName: string;
  display: string;
  value: number;
  unit?: string;
  low: number;
  high: number;
  timestamp?: string;
}
