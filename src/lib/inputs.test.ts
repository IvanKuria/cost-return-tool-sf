import { describe, expect, it } from 'vitest';
import { computePlan, newBlankCrop, newBlankEquipment } from './engine';
import { inputPatch, isMissing, isMonthlyProfile, missingPlanInputs } from './inputs';
import { DEFAULT_FARM, hydratePlan } from './store';
import { SAMPLE_PLAN } from '../data/sample';

describe('farmer inputs', () => {
  it('retains blank versus deliberate zero through save and reload', () => {
    let crop = newBlankCrop('crop');
    expect(isMissing(crop, 'price')).toBe(true);
    crop = { ...crop, ...inputPatch(crop, 'price', 0) };
    crop = JSON.parse(JSON.stringify(crop));
    expect(isMissing(crop, 'price')).toBe(false);
    expect(crop.price).toBe(0);
    crop = { ...crop, ...inputPatch(crop, 'price', undefined) };
    expect(isMissing(crop, 'price')).toBe(true);
  });

  it('accepts intentional zero amounts but requires positive area, plantings and useful life', () => {
    const crop = { ...newBlankCrop(), missingFields: [], area: 1, plantingsPerYear: 1 };
    const equipment = { ...newBlankEquipment(), missingFields: [], keepYears: 1 };
    expect(missingPlanInputs({ farm: DEFAULT_FARM, crops: [crop], equipment: [equipment] })).toEqual([]);
    crop.area = 0;
    equipment.keepYears = 0;
    expect(missingPlanInputs({ farm: DEFAULT_FARM, crops: [crop], equipment: [equipment] }).map(x => x.field)).toEqual(['area', 'keepYears']);
  });

  it('reports explicitly cleared optional inputs alongside critical fields', () => {
    const crop = { ...newBlankCrop(), area: 1, plantingsPerYear: 1, missingFields: ['ownLaborHoursPerAcre' as const] };
    const equipment = { ...newBlankEquipment(), keepYears: 1, missingFields: ['hoursPerYear' as const] };
    expect(missingPlanInputs({ farm: DEFAULT_FARM, crops: [crop], equipment: [equipment] }).map(x => x.field)).toEqual(['ownLaborHoursPerAcre', 'hoursPerYear']);
  });

  it('infers legacy missing study amounts without treating explicitly entered zero as absent', () => {
    const crop = { ...newBlankCrop(), studyId: 'legacy', missingFields: undefined };
    expect(isMissing(crop, 'price')).toBe(true);
    expect(isMissing({ ...crop, price: 3 }, 'price')).toBe(false);
    expect(isMissing({ ...crop, missingFields: [] }, 'price')).toBe(false);
  });

  it('keeps incomplete drafts finite and excludes invalid monthly weights', () => {
    const crop = { ...newBlankCrop(), price: NaN, costMonths: Array(12).fill(-1), revenueMonths: Array(12).fill(1 / 12) };
    const result = computePlan({ farm: DEFAULT_FARM, crops: [crop], equipment: [newBlankEquipment()] });
    expect(result.net).toBe(0);
    expect(result.cashCoverage.withMonths).toBe(0);
    expect(result.monthlyCash.every(Number.isFinite)).toBe(true);
    expect(isMonthlyProfile(Array(12).fill(1 / 12))).toBe(true);
    expect(isMonthlyProfile(Array(12).fill(0))).toBe(false);
    expect(isMonthlyProfile(Array(11).fill(1 / 11))).toBe(false);
    expect(isMonthlyProfile(Array(12).fill(NaN))).toBe(false);
  });

  it('preserves custom timing and entered values during saved-plan hydration', () => {
    const crop = { ...SAMPLE_PLAN.crops[0], timingSource: 'custom' as const, costMonths: null, revenueMonths: null, price: 0, missingFields: [] };
    const plan = hydratePlan({ ...SAMPLE_PLAN, crops: [crop] });
    expect(plan.crops[0]).toEqual(crop);
    const partial = { ...SAMPLE_PLAN.crops[0], costMonths: Array(12).fill(1 / 12), revenueMonths: null };
    expect(hydratePlan({ ...SAMPLE_PLAN, crops: [partial] }).crops[0].costMonths).toEqual(partial.costMonths);
  });
});
