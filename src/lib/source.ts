import { cropDefaultsFromStudy, normalizeUnit, studyById } from '../data/studies';
import { inputPatch, isMissing } from './inputs';
import type { Citation, Crop, Equipment, Farm, NumericField } from './types';

type SourceItem = Farm | Crop | Equipment;
export function sourceDisplayValue(item: SourceItem, field: string): number | undefined {
  const value = (item as unknown as Record<string, unknown>)[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value * ('county' in item && (field === 'interestRate' || field === 'payrollOverhead') ? 100 : 1);
}
export function sourceStatus(value: number | undefined, citation: Citation | undefined, missing = false): 'missing' | 'study' | 'yours' {
  if (missing) return 'missing';
  return value !== undefined && citation?.value != null && Math.abs(value - citation.value) < 1e-9 ? 'study' : 'yours';
}
export function sourceUnitChanged(item: SourceItem, field: string): boolean {
  if (!('studyId' in item) || !['price', 'yieldPerAcre'].includes(field) || !item.studyId) return false;
  const study = studyById(item.studyId);
  return !!study && normalizeUnit(item.unit) !== normalizeUnit(cropDefaultsFromStudy(study).unit);
}
export function restoreSourceValue<T extends SourceItem>(item: T, field: NumericField<T>, citation: Citation | undefined): Partial<T> {
  if (sourceUnitChanged(item, field as string) || citation?.value == null || !Number.isFinite(citation.value) || typeof item[field] !== 'number') return {};
  const factor = 'county' in item && (field === 'interestRate' || field === 'payrollOverhead') ? 100 : 1;
  return inputPatch(item, field, citation.value / factor);
}
export function canRestoreSource(item: SourceItem, field: string, citation: Citation): boolean {
  const value = sourceDisplayValue(item, field);
  return !sourceUnitChanged(item, field) && value !== undefined && citation.value !== null && Number.isFinite(citation.value)
    && sourceStatus(value, citation, isMissing(item, field)) !== 'study';
}
