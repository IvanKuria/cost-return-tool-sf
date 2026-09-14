import { describe, expect, it } from 'vitest';
import { newBlankCrop, newBlankEquipment } from './engine';
import { DEFAULT_FARM } from './store';
import { SAMPLE_PLAN } from '../data/sample';
import type { Citation, NumericField, Crop } from './types';
import { canRestoreSource, restoreSourceValue, sourceDisplayValue, sourceStatus, sourceUnitChanged } from './source';

const citation = (value: number | null): Citation => ({ studyId: 'test', title: 'Study', year: 2020, region: 'California', url: 'https://example.com/study.pdf', page: 2, quote: 'Original value', field: 'Price', value });

describe('source values', () => {
  it('distinguishes cleared values, cited zero and farmer edits', () => {
    expect(sourceStatus(0, citation(0), true)).toBe('missing');
    expect(sourceStatus(0, citation(0))).toBe('study');
    expect(sourceStatus(12, citation(10))).toBe('yours');
    expect(sourceStatus(0, undefined)).toBe('yours');
  });
  it('restores cited zero and clears only that field missing flag', () => {
    const equipment = newBlankEquipment();
    const patch = restoreSourceValue(equipment, 'salvageValue', citation(0));
    expect(patch.salvageValue).toBe(0);
    expect(patch.missingFields).not.toContain('salvageValue');
    expect(patch.missingFields).toContain('pricePaid');
    expect(patch).not.toHaveProperty('pricePaid');
  });
  it('converts farm percentages back to stored fractions', () => {
    expect(sourceDisplayValue(DEFAULT_FARM, 'interestRate')).toBe(4.75);
    expect(restoreSourceValue(DEFAULT_FARM, 'interestRate', citation(5))).toMatchObject({ interestRate: 0.05 });
    expect(restoreSourceValue(DEFAULT_FARM, 'payrollOverhead', citation(40))).toMatchObject({ payrollOverhead: 0.4 });
    expect(restoreSourceValue(DEFAULT_FARM, 'ownLaborRate', citation(25))).toMatchObject({ ownLaborRate: 25 });
  });
  it('does not restore nonnumeric timing, absent citation values, or already matching values', () => {
    const crop = { ...newBlankCrop(), timingSource: 'custom' as const };
    expect(restoreSourceValue(crop, 'price', citation(null))).toEqual({});
    expect(restoreSourceValue(crop, 'costMonths' as NumericField<Crop>, citation(1))).toEqual({});
    expect(canRestoreSource(crop, 'months', citation(1))).toBe(false);
    expect(canRestoreSource({ ...crop, price: 2, missingFields: [] }, 'price', citation(2))).toBe(false);
  });
  it('refuses study price or yield restoration if the sales unit changed', () => {
    const crop = { ...SAMPLE_PLAN.crops[0], unit: 'my custom box' };
    expect(sourceUnitChanged(crop, 'price')).toBe(true);
    expect(sourceUnitChanged(crop, 'yieldPerAcre')).toBe(true);
    expect(restoreSourceValue(crop, 'price', citation(2))).toEqual({});
    expect(canRestoreSource(crop, 'price', citation(2))).toBe(false);
    expect(restoreSourceValue(crop, 'operatingCostPerAcre', citation(200))).toMatchObject({ operatingCostPerAcre: 200 });
    expect(crop.unit).toBe('my custom box');
  });
});
