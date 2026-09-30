import { DEFAULT_FARM } from './store';
import { describe, expect, it } from 'vitest';
import { computePlan, crf, hiredHourly, machineHoursInPlan, machineRates, newBlankCrop, ownership, toAcres } from './engine';
import { SAMPLE_PLAN } from '../data/sample';
import type { CropOperation, Equipment, Plan } from './types';

describe('capital recovery', () => {
  it('reproduces the UC Davis 2015 spinach study 205 HP tractor row', () => {
    // Table 5: price 350,000, salvage 132,768, 7 years, 4.75 percent, capital recovery 43,509
    const rate = 0.0475;
    const capitalRecovery = (350000 - 132768) * crf(rate, 7) + 132768 * rate;
    expect(Math.abs(capitalRecovery - 43509) / 43509).toBeLessThan(0.01);
  });

  it('ownership adds insurance and tax on average value, and per-hour rates spread it over the hours', () => {
    const e: Equipment = { id: 'x', typeId: 'tractor-compact', name: 't', condition: 'used', pricePaid: 18500, yearBought: 2019, keepYears: 8, salvageValue: 6000, citations: {}, fuelLubePerHour: 7.4, repairsPctPerYear: 0.03 };
    const rates = { interestRate: 0.0475, insuranceRate: 0.00843, propertyTaxRate: 0.01 };
    const o = ownership(e, rates);
    expect(o.capitalRecovery).toBeGreaterThan(1800);
    expect(o.insuranceAndTax).toBeCloseTo(12250 * 0.01843, 0);
    expect(o.repairsPerYear).toBeCloseTo(555, 6);
    const r = machineRates(e, rates, 350);
    expect(r.ownPerHour).toBeCloseTo(o.totalPerYear / 350, 6);
    expect(r.repairsPerHour).toBeCloseTo(555 / 350, 6);
    expect(r.allInPerHour).toBeCloseTo(r.ownPerHour + 7.4 + 555 / 350, 6);
    // With no hours there is nothing to spread owning and repairs over; only fuel and lube remain per hour.
    expect(machineRates(e, rates, 0).ownPerHour).toBe(0);
    expect(machineRates(e, rates, 0).allInPerHour).toBeCloseTo(7.4, 6);
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
    const e = computePlan({ farm: SAMPLE_PLAN.farm, crops: [], equipment: [], customWork: [] });
    expect(e.net).toBe(0); // no crops means nothing is allocated, so nothing is lost on paper
    expect(e.crops).toHaveLength(0);
    expect(e.monthlyCash.every((m) => !Number.isNaN(m))).toBe(true);
  });

  it('charges interest on cash spent ahead of sales, and none at a zero rate', async () => {
    const { SAMPLE_PLAN } = await import('../data/sample');
    const timed = SAMPLE_PLAN.crops.find(c => c.costMonths && c.revenueMonths);
    expect(timed).toBeTruthy();
    const plan = { ...SAMPLE_PLAN, crops: [timed!], farm: { ...SAMPLE_PLAN.farm, operatingInterestRate: 0.06 } };
    const withInterest = computePlan(plan).crops[0];
    expect(withInterest.costParts.interest).toBeGreaterThan(0);
    const noInterest = computePlan({ ...plan, farm: { ...plan.farm, operatingInterestRate: 0 } }).crops[0];
    expect(noInterest.costParts.interest).toBe(0);
    expect(withInterest.operating - noInterest.operating).toBeCloseTo(withInterest.costParts.interest, 6);
  });

  it('converts 100 ft rows with the farm bed width', () => {
    const farm = { ...DEFAULT_FARM, areaUnit: 'rows100ft' as const, bedWidthIn: 60 };
    expect(toAcres(1, farm)).toBeCloseTo((100 * 5) / 43560, 8);
  });
});

describe('machine hours, repairs pool, rent and custom work', () => {
  const rates = { interestRate: 0.05, insuranceRate: 0.00843, propertyTaxRate: 0.01 };
  const farm = { ...DEFAULT_FARM, ...rates, operatingInterestRate: 0, hiredLaborRate: 20, payrollOverhead: 0.5, ownLaborRate: 25 };
  const tractor: Equipment = { id: 'm1', typeId: 't', name: 'Tractor', condition: 'used', pricePaid: 10000, yearBought: 2020, keepYears: 5, salvageValue: 2000, fuelLubePerHour: 5, repairsPctPerYear: 0.02, citations: {} };
  const op = (over: Partial<CropOperation>): CropOperation => ({ id: 'op', name: 'Disc', category: 'cultural', enabled: true, machineHoursPerAcre: 2, operatorHoursPerAcre: 2.4, mode: 'own', equipmentId: 'm1', rentPerHour: 0, hiredMachinePerAcre: 150, handHoursPerAcre: 0, otherLaborPerAcre: 0, materialsPerAcre: 0, customPerAcre: 0, source: 'custom', ...over });
  const crop = (ops: CropOperation[]) => ({ ...newBlankCrop('c1'), name: 'Crop', unit: 'lb', area: 10, plantingsPerYear: 1, yieldPerAcre: 100, price: 1, missingFields: [], operations: ops });
  const plan = (ops: CropOperation[], customHours = 0): Plan => ({ farm, crops: [crop(ops)], equipment: [tractor], customWork: customHours > 0 ? [{ id: 'j', name: 'Discing for a neighbor', equipmentId: 'm1', hoursPerYear: customHours, incomePerYear: 1500 }] : [] });

  it('derives machine hours from crop operations plus custom work', () => {
    const p = plan([op({})], 20);
    const h = machineHoursInPlan(p).get('m1')!;
    expect(h.crop).toBeCloseTo(20, 6);
    expect(h.custom).toBe(20);
    const m = computePlan(p).machines[0];
    expect(m.hoursPerYear).toBeCloseTo(40, 6);
    expect(m.cropHours).toBeCloseTo(20, 6);
    expect(m.customHours).toBe(20);
  });

  it('lets custom work carry its share of ownership so crops carry less', () => {
    const alone = computePlan(plan([op({})]));
    const shared = computePlan(plan([op({})], 20));
    const own = ownership(tractor, rates).totalPerYear;
    expect(alone.crops[0].equipmentShare).toBeCloseTo(own, 6);
    expect(shared.crops[0].equipmentShare).toBeCloseTo(own / 2, 6);
    expect(shared.customWork.ownership).toBeCloseTo(own / 2, 6);
    expect(shared.customWork.income).toBe(1500);
    expect(shared.customWork.operatorLabor).toBeCloseTo(20 * 25, 6);
    expect(shared.customWork.net).toBeCloseTo(1500 - shared.customWork.cost, 6);
    expect(shared.net).toBeCloseTo(shared.crops[0].net + shared.customWork.net, 6);
  });

  it('charges a rented machine rent per hour plus operator labor and no ownership', () => {
    const r = computePlan(plan([op({ mode: 'rent', equipmentId: null, rentPerHour: 30 })]));
    const c = r.crops[0];
    expect(c.costParts.rent).toBeCloseTo(2 * 30 * 10, 6);
    expect(c.costParts.operatorLabor).toBeCloseTo(2.4 * hiredHourly(farm) * 10, 6);
    // The tractor has no hours, so its yearly repair pool and ownership fall back to the acre split, all on the one crop.
    expect(c.machines[0].fuelLube).toBe(0);
    expect(c.costParts.machineRunning).toBeCloseTo(ownership(tractor, rates).repairsPerYear, 6);
    expect(r.machines[0].hoursPerYear).toBe(0);
    expect(c.machines[0].hours).toBe(0);
  });

  it('allocates the whole repairs pool whether or not the machine has hours', () => {
    const pool = ownership(tractor, rates).repairsPerYear;
    expect(pool).toBeCloseTo(200, 6);
    const withHours = computePlan(plan([op({})], 20));
    const cropRepairs = withHours.crops[0].machines[0].repairs;
    expect(cropRepairs + withHours.customWork.repairs).toBeCloseTo(pool, 6);
    expect(withHours.crops[0].costParts.machineRunning).toBeCloseTo(20 * 5 + cropRepairs, 6);
    const noHours = computePlan(plan([op({ mode: 'hire', equipmentId: null })]));
    expect(noHours.crops[0].machines[0].repairs).toBeCloseTo(pool, 6);
    expect(noHours.crops[0].costParts.hiredMachine).toBeCloseTo(150 * 10, 6);
  });
});
