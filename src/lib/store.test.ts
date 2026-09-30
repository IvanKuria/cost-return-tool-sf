import { describe, expect, it } from 'vitest';
import { migratePlan, DEFAULT_FARM } from './store';
import type { Citation } from './types';

const citation: Citation = { studyId: 's', title: 'T', year: 2015, region: 'Central Coast', url: 'u', page: 6, quote: 'q', field: 'f', value: 9.4 };

describe('migratePlan (v3 to v4)', () => {
  it('turns the single other-overhead figure into one overhead item split by acres', () => {
    const plan = migratePlan({
      farm: { ...DEFAULT_FARM, otherOverheadPerYear: 6000, overheadItems: undefined, overheadBasis: undefined, equipmentBasis: undefined, insuranceRate: undefined, propertyTaxRate: undefined, citations: { otherOverheadPerYear: { ...citation, value: 6000 } } },
      crops: [], equipment: [], customWork: [],
    });
    expect(plan.farm.overheadItems).toHaveLength(1);
    expect(plan.farm.overheadItems[0]).toMatchObject({ amountPerYear: 6000, basis: 'acres' });
    expect(plan.farm.overheadItems[0].citation?.value).toBe(6000);
    expect(plan.farm.overheadBasis).toBe('acres');
    expect(plan.farm.equipmentBasis).toBe('hours');
    expect(plan.farm.insuranceRate).toBeCloseTo(0.00843);
    expect(plan.farm.propertyTaxRate).toBeCloseTo(0.01);
  });

  it('keeps a v3 running cost whole under fuel and lube with its citation', () => {
    const plan = migratePlan({
      farm: DEFAULT_FARM, crops: [],
      equipment: [{ id: 'e', typeId: 't', name: 'Tractor', condition: 'used', pricePaid: 18500, yearBought: 2019, keepYears: 8, hoursPerYear: 350, salvageValue: 6000,
        operatingCostPerHour: 9.4, citations: { operatingCostPerHour: citation }, missingFields: ['operatingCostPerHour'] }],
    });
    const e = plan.equipment[0];
    expect(e.fuelLubePerHour).toBe(9.4);
    expect(e.repairsPctPerYear).toBe(0);
    expect(e.citations.fuelLubePerHour?.value).toBe(9.4);
    expect(e.missingFields).toEqual([]);
  });

  it('turns repairs per hour and hours per year into a yearly percent of price', () => {
    const plan = migratePlan({
      farm: DEFAULT_FARM, crops: [], customWork: [],
      equipment: [{ id: 'e', typeId: 't', name: 'x', condition: 'new', pricePaid: 10000, yearBought: 2020, keepYears: 5, hoursPerYear: 100, salvageValue: 0, fuelLubePerHour: 1, repairsPerHour: 2, citations: { repairsPerHour: { ...citation, value: 2 } } }],
    });
    const e = plan.equipment[0];
    expect(e.repairsPctPerYear).toBeCloseTo(0.02, 8);
    expect(e.citations.repairsPctPerYear?.value).toBeCloseTo(0.02, 8);
    expect('repairsPerHour' in e).toBe(false);
    expect('hoursPerYear' in e).toBe(false);
  });

  it('leaves a current plan alone', () => {
    const farm = { ...DEFAULT_FARM, overheadItems: [{ id: 'a', name: 'Insurance', amountPerYear: 1200, basis: 'revenue' as const }] };
    const plan = migratePlan({ farm, crops: [], customWork: [], equipment: [{ id: 'e', typeId: 't', name: 'x', condition: 'new', pricePaid: 1, yearBought: 2020, keepYears: 1, salvageValue: 0, fuelLubePerHour: 1, repairsPctPerYear: 0.02, citations: {} }] });
    expect(plan.farm.overheadItems[0].basis).toBe('revenue');
    expect(plan.equipment[0].repairsPctPerYear).toBe(0.02);
  });
});
