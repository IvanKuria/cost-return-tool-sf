import { describe, expect, it } from 'vitest';
import { computePlan, crf,  ownership, toAcres } from './engine';
import { SAMPLE_PLAN } from '../data/sample';
import type { Equipment } from './types';

describe('capital recovery', () => {
  it('reproduces the UC Davis 2015 spinach study 205 HP tractor row', () => {
    // Table 5: price 350,000, salvage 132,768, 7 years, 4.75 percent, capital recovery 43,509
    const rate = 0.0475;
    const capitalRecovery = (350000 - 132768) * crf(rate, 7) + 132768 * rate;
    expect(Math.abs(capitalRecovery - 43509) / 43509).toBeLessThan(0.01);
  });

  it('ownership adds insurance and tax on average value', () => {
    const e: Equipment = { id: 'x', typeId: 'tractor-compact', name: 't', condition: 'used', pricePaid: 18500, yearBought: 2019, keepYears: 8, hoursPerYear: 350, salvageValue: 6000, citations: {}, fuelLubePerHour: 7.4, repairsPerHour: 2.0 };
    const o = ownership(e, { interestRate: 0.0475, insuranceRate: 0.00843, propertyTaxRate: 0.01 });
    expect(o.capitalRecovery).toBeGreaterThan(1800);
    expect(o.insuranceAndTax).toBeCloseTo(12250 * 0.01843, 0);
    expect(o.allInPerHour).toBeCloseTo(o.ownPerHour + 9.4, 6);
  });
});

describe('units', () => {
  it('converts beds and rows to acres', () => {
    const farm = { ...SAMPLE_PLAN.farm, areaUnit: 'beds' as const };
    expect(toAcres(174.24, farm)).toBeCloseTo(1, 2); // 174.24 beds of 100 ft x 30 in is one acre
    expect(toAcres(1, { ...farm, areaUnit: 'rows100ft' })).toBeCloseTo(250 / 43560, 6);
  });


});

describe('computePlan', () => {
  const r = computePlan(SAMPLE_PLAN);

  it('has no NaN anywhere', () => {
    // JSON turns NaN into null; `monthly: null` is a legitimate value, so check numbers directly instead.
    const walk = (v: unknown): void => { if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(r);
    expect(Number.isNaN(r.net)).toBe(false);
    r.crops.forEach((c) => Object.values(c).forEach((v) => { if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false); }));
  });

  it('restores a nonempty study-backed cash chart for the example', () => {
    expect(r.cashCoverage.withMonths).toBeGreaterThan(0);
    expect(r.monthlyCash.some(m => m !== 0)).toBe(true);
    for (const c of SAMPLE_PLAN.crops.filter(c => c.costMonths)) {
      expect(c.costMonths!.reduce((sum, n) => sum + n, 0)).toBeCloseTo(1, 8);
      expect(c.revenueMonths!.reduce((sum, n) => sum + n, 0)).toBeCloseTo(1, 8);
      expect(c.citations.months?.page).toBeGreaterThan(0);
    }
  });

  it('has 12 months of cash', () => {
    expect(r.monthlyCash).toHaveLength(12);
    expect(r.lowestCashPoint.month).toBeGreaterThanOrEqual(0);
  });

  it('allocates all overhead and machine ownership across crops', () => {
    expect(r.crops.reduce((sum, c) => sum + c.overheadShare, 0)).toBeCloseTo(r.overhead, 6);
    expect(r.crops.reduce((sum, c) => sum + c.equipmentShare, 0)).toBeCloseTo(r.equipmentOwnership, 6);
    expect(r.net).toBeCloseTo(r.revenue - r.totalCost, 6);
  });

  it('handles an empty plan', () => {
    const e = computePlan({ farm: SAMPLE_PLAN.farm, crops: [], equipment: [] });
    expect(e.net).toBe(0); // no crops means nothing is allocated, so nothing is lost on paper
    expect(e.crops).toHaveLength(0);
    expect(e.monthlyCash.every((m) => !Number.isNaN(m))).toBe(true);
  });
});
