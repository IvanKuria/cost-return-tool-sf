import type { Crop, Equipment, Farm, NumericField, Plan } from './types';

const cropFields = ['area', 'plantingsPerYear', 'yieldPerAcre', 'price', 'operatingCostPerAcre'] as const;
const equipmentFields = ['pricePaid', 'keepYears', 'salvageValue', 'fuelLubePerHour', 'repairsPerHour'] as const;
type InputItem = Crop | Equipment | Farm;

/** Explicit flags preserve the distinction between a blank and an intentional zero. */
export function isMissing(item: InputItem, field: string): boolean {
  if (item.missingFields !== undefined) return (item.missingFields as string[]).includes(field);
  if ('studyId' in item && item.studyId && cropFields.includes(field as typeof cropFields[number])) {
    return (item as unknown as Record<string, unknown>)[field] === 0
      && !(item.citations as Record<string, unknown>)[field];
  }
  if ('pricePaid' in item && Object.keys(item.citations).length && equipmentFields.includes(field as typeof equipmentFields[number])) {
    return (item as unknown as Record<string, unknown>)[field] === 0
      && !(item.citations as Record<string, unknown>)[field];
  }
  return false;
}

export function inputPatch<T extends InputItem>(item: T, field: NumericField<T>, value: number | undefined): Partial<T> {
  const fields: string[] = item.missingFields ? [...item.missingFields] as string[]
    : ('studyId' in item ? cropFields : 'pricePaid' in item ? equipmentFields : []).filter(f => isMissing(item, f));
  const missingFields = fields.filter(f => f !== field);
  if (value === undefined || !Number.isFinite(value)) missingFields.push(field as string);
  return { [field as string]: value !== undefined && Number.isFinite(value) ? value : 0, missingFields } as Partial<T>;
}

export interface MissingPlanInput { step: 'farm' | 'crops' | 'equipment'; id?: string; name: string; field: string }
export function missingPlanInputs(plan: Plan): MissingPlanInput[] {
  const result: MissingPlanInput[] = [];
  for (const field of plan.farm.missingFields ?? []) result.push({ step: 'farm', name: plan.farm.name || 'Your farm', field });
  for (const crop of plan.crops) for (const field of new Set([...cropFields, ...(crop.missingFields ?? [])])) {
    if (isMissing(crop, field) || !Number.isFinite(crop[field]) || (['area', 'plantingsPerYear'].includes(field) && crop[field] <= 0))
      result.push({ step: 'crops', id: crop.id, name: crop.name, field });
  }
  for (const item of plan.equipment) for (const field of new Set([...equipmentFields, ...(item.missingFields ?? [])])) {
    if (isMissing(item, field) || !Number.isFinite(item[field]) || (field === 'keepYears' && item[field] <= 0))
      result.push({ step: 'equipment', id: item.id, name: item.name, field });
  }
  return result;
}

export function isMonthlyProfile(weights: number[] | null | undefined): weights is number[] {
  return Array.isArray(weights) && weights.length === 12 && weights.every(n => Number.isFinite(n) && n >= 0)
    && Math.abs(weights.reduce((sum, n) => sum + n, 0) - 1) < 1e-6;
}
