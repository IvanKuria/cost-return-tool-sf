// Rates the UC cost studies apply to a machine's average value each year. Kept in their own module
// so store.ts can use them without importing engine.ts (which imports store.ts for uid).
export const STUDY_INSURANCE_RATE = 0.00843; // 0.843 percent property insurance
export const STUDY_PROPERTY_TAX_RATE = 0.01;  // 1 percent county property tax
