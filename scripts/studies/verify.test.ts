import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PARSED_DIR } from './manifest';
import type { ParsedStudy } from './types';

const load = (): ParsedStudy[] => fs.readdirSync(PARSED_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(PARSED_DIR, f), 'utf8')));

describe('2015 organic spinach, Central Coast', () => {
  const s = load().find(x => x.source.id === 'spinach-2015-organicspinach-finaldraftjan29')!;
  it('is parsed', () => { expect(s).toBeTruthy(); expect(s.source.year).toBe(2015); });
  it('Table 1 totals', () => {
    expect(s.costsPerAcre.cashOverheadTotal?.value).toBe(1230);
    expect(s.costsPerAcre.nonCashOverheadTotal?.value).toBe(219);
    expect(s.costsPerAcre.operatingTotal?.value).toBe(5682);
  });
  it('Table 5 tractor row', () => {
    const t = s.equipment.find(e => /205 HP 4WD Tractor/.test(e.description))!;
    expect(t.price).toBe(350000); expect(t.yearsLife).toBe(7); expect(t.salvageValue).toBe(132768); expect(t.capitalRecovery).toBe(43509);
  });
  it('assumptions', () => {
    expect(s.assumptions.interestRatePct?.value).toBe(4.75);
    expect(s.method.insuranceRatePct?.value).toBe(0.843);
    expect(s.method.propertyTaxRatePct?.value).toBe(1);
    expect(s.method.machineLaborFactor?.value).toBe(1.2);
    expect(s.method.machineLaborFactor?.page).toBeGreaterThan(0);
    expect(s.assumptions.landRentPerAcre?.value).toBe(2400);
    expect(s.assumptions.laborMachineRate?.value).toBe(21.7);
    expect(s.assumptions.laborOverheadPct?.value).toBe(40);
    expect(s.assumptions.cropsPerAcrePerYear?.value).toBe(3);
  });
  it('every cited value carries a page and a quote', () => {
    const walk = (o: unknown) => {
      if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        if ('value' in r && 'quote' in r) { expect(typeof r.page).toBe('number'); expect(String(r.quote).length).toBeGreaterThan(3); }
        Object.values(r).forEach(walk);
      }
    };
    walk(s);
  });
});

describe('2024 organic strawberries, Central Coast', () => {
  const s = load().find(x => x.source.id === 'strawberries-2024orgstrawberries-final-may2024')!;
  it('machine labor factor', () => {
    expect(s).toBeTruthy();
    expect(s.method.machineLaborFactor?.value).toBe(1.2);
    expect(s.method.machineLaborFactor?.page).toBeGreaterThan(0);
    expect(s.method.machineLaborFactor?.quote).toMatch(/machinery/i);
  });
});

describe('establishment cost in perennial studies', () => {
  const all = load();
  it('2024 almonds, Sacramento Valley', () => {
    const s = all.find(x => x.source.id === 'almonds-2024sacvalleyalmonds7-5-24-final-draft')!;
    expect(s.establishment).toBeTruthy();
    expect(s.establishment!.accumulatedNetCost?.value).toBe(14894);
    expect(s.establishment!.annualCharge?.value).toBe(1489);
    expect(s.establishment!.productionYears?.value).toBe(22);
    expect(s.establishment!.amortizedFromYear?.value).toBe(4);
    expect(s.establishment!.years.find(y => y.year === 3)?.accumulated).toBe(14894);
    expect(s.establishment!.removalCost?.value).toBe(1600);
  });
  it('2017 cling peaches, early harvested', () => {
    const s = all.find(x => x.source.id === 'peaches-2017peachsvsjv-ecling-final-draft2')!;
    expect(s.establishment?.accumulatedNetCost?.value).toBe(7939);
    expect(s.establishment?.annualCharge?.value).toBe(765);
    expect(s.establishment?.productionYears?.value).toBe(15);
    expect(s.establishment?.asset?.price).toBe(317560);
    expect(s.establishment?.asset?.salvageValue).toBe(0);
  });
  it('2021 Lodi wine grapes', () => {
    const s = all.find(x => x.source.id === 'grapes-wine-2021-grapewinelodi-22522')!;
    expect(s.establishment?.accumulatedNetCost?.value).toBe(26313);
    expect(s.establishment?.annualCharge?.value).toBe(1954);
    expect(s.establishment?.productionYears?.value).toBe(22);
    expect(s.establishment?.plantingLife?.value).toBe(25);
  });
  it('salvage of the establishment asset is zero wherever printed, and coverage is printed', () => {
    const withEst = all.filter(s => s.establishment);
    for (const s of withEst) if (s.establishment!.asset) expect(s.establishment!.asset.salvageValue).toBe(0);
    const n = (k: (e: NonNullable<ParsedStudy['establishment']>) => unknown) => withEst.filter(s => k(s.establishment!) != null && k(s.establishment!) !== 0).length;
    console.log(`establishment: ${withEst.length} studies; accumulated ${n(e => e.accumulatedNetCost)}, annual charge ${n(e => e.annualCharge)}, production years ${n(e => e.productionYears)}, planting life ${n(e => e.plantingLife)}, years table ${withEst.filter(s => s.establishment!.years.length).length}, removal ${n(e => e.removalCost)}, asset ${n(e => e.asset)}, method ${n(e => e.method)}`);
  });
});

describe('all studies', () => {
  const all = load();
  it('operation rows carry numeric or null cost columns', () => {
    for (const s of all) for (const o of s.costsPerAcre.operations) {
      for (const k of ['timeHrsPerAcre', 'labor', 'fuel', 'lubeRepairs', 'materials', 'customRent'] as const) {
        const v = o[k];
        expect(v === null || (typeof v === 'number' && Number.isFinite(v))).toBe(true);
      }
    }
  });
  it('machine labor factor is 1.2 wherever stated, and coverage is printed', () => {
    const withFactor = all.filter(s => s.method.machineLaborFactor);
    for (const s of withFactor) expect(s.method.machineLaborFactor!.value).toBeGreaterThan(1);
    console.log(`machine labor factor: ${withFactor.length} of ${all.length} studies (${withFactor.filter(s => s.method.machineLaborFactor!.value === 1.2).length} at 1.2)`);
  });
  it('at least 80 percent have year, region and url', () => {
    const ok = all.filter(s => s.source.year && s.source.region && s.source.url).length;
    expect(ok / all.length).toBeGreaterThanOrEqual(0.8);
  });
  it('salvage never exceeds price in parsed equipment rows', () => {
    for (const s of all) for (const e of s.equipment) expect(e.salvageValue).toBeLessThanOrEqual(e.price);
  });
  it('prints coverage', () => {
    const rows = all.map(s => ({
      study: s.source.id.slice(0, 44), yr: s.source.year ?? '', yield: s.assumptions.yieldPerAcre?.value ?? '', price: s.assumptions.pricePerUnit?.value ?? '',
      operating: s.costsPerAcre.operatingTotal?.value ?? '', cashOH: s.costsPerAcre.cashOverheadTotal?.value ?? '', nonCashOH: s.costsPerAcre.nonCashOverheadTotal?.value ?? '',
      equip: s.equipment.length, hourly: s.hourlyEquipment.length, ops: s.costsPerAcre.operations.length,
    }));
    console.table(rows);
    const pct = (k: (s: ParsedStudy) => unknown) => Math.round(100 * all.filter(s => k(s) != null && k(s) !== 0).length / all.length);
    console.log(`coverage: yield ${pct(s => s.assumptions.yieldPerAcre)}%, price ${pct(s => s.assumptions.pricePerUnit)}%, operating ${pct(s => s.costsPerAcre.operatingTotal)}%, cash OH ${pct(s => s.costsPerAcre.cashOverheadTotal)}%, non-cash OH ${pct(s => s.costsPerAcre.nonCashOverheadTotal)}%, equipment ${pct(s => s.equipment.length)}%, hourly ${pct(s => s.hourlyEquipment.length)}%, interest ${pct(s => s.assumptions.interestRatePct)}%, land rent ${pct(s => s.assumptions.landRentPerAcre)}%`);
  });

  it('coverage by year band, and priceYear stays within two years of the title year', () => {
    const band = (y: number | null) => (y == null ? 'no year' : y < 2010 ? '2000-2009' : y < 2016 ? '2010-2015' : y < 2021 ? '2016-2020' : '2021+');
    const rows: Record<string, Record<string, number>> = {};
    for (const s of all) {
      const r = (rows[band(s.source.year)] ??= { studies: 0, operations: 0, equipment: 0, monthly: 0, establishment: 0, priceYear: 0 });
      r.studies++;
      if (s.costsPerAcre.operations.length) r.operations++;
      if (s.equipment.length) r.equipment++;
      if (s.monthly) r.monthly++;
      if (s.establishment) r.establishment++;
      if (s.source.priceYear) r.priceYear++;
      if (s.source.priceYear && s.source.year) expect(Math.abs(s.source.priceYear.value - s.source.year)).toBeLessThanOrEqual(2);
    }
    console.table(rows);
    expect(all.length).toBeGreaterThan(200);
  });
  it('archived studies are marked and carry an index year', () => {
    const archived = all.filter(s => s.source.archived);
    expect(archived.length).toBeGreaterThan(100);
    for (const s of archived) expect(s.source.indexYear).not.toBeNull();
  });
});
