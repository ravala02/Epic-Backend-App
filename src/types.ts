// src/types.ts

export interface Coding {
    system?: string;
    code?: string;
    display?: string;
  }
  
  export interface CodeableConcept {
    coding?: Coding[];
    text?: string;
  }
  
  export interface Quantity {
    value?: number;
    unit?: string;
  }
  
  export interface ReferenceRange {
    low?: { value?: number };
    high?: { value?: number };
  }
  
  export interface Observation {
    id?: string;
    code?: CodeableConcept;
    subject?: { reference?: string };
    valueQuantity?: Quantity;
    referenceRange?: ReferenceRange[];
  }
  
  export interface ThresholdDef {
    name: string;
    low: number;
    high: number;
    unit: string;
  }
  