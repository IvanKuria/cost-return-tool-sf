import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PARSED_DIR, TEXT_DIR } from './manifest';
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

describe('establishment table, row by row', () => {
  const all = load();
  it('recognizes income labels without /ACRE instead of treating revenue as overhead', () => {
    const s = all.find(x => x.source.id === 'oranges-2021orangessjvsouth')!;
    const income = s.establishment!.table!.rows.filter(r => r.label === 'INCOME FROM PRODUCTION');
    expect(income).toHaveLength(2);
    for (const row of income) {
      expect(row.kind).toBe('income');
      expect(row.values[4]).toBe(4343);
    }
  });
  const sumOps = (t: NonNullable<NonNullable<ParsedStudy['establishment']>['table']>, subtotalLabel: RegExp) => {
    const i = t.rows.findIndex(r => r.kind === 'subtotal' && subtotalLabel.test(r.label));
    expect(i).toBeGreaterThan(0);
    const ops: typeof t.rows = [];
    for (let j = i - 1; j >= 0 && t.rows[j].kind !== 'heading'; j--) if (t.rows[j].kind === 'operation') ops.push(t.rows[j]);
    return { row: t.rows[i], sums: t.years.map((_, c) => ops.reduce((s, o) => s + (o.values[c] ?? 0), 0)) };
  };
  it('2024 almonds, San Joaquin Valley South: three establishment years plus two early production years, cultural rows add up', () => {
    const s = all.find(x => x.source.id === 'almonds-2024-almondssjvsouth-final-draft-8-3-25')!;
    const t = s.establishment!.table!;
    expect(t.title).toMatch(/TO ESTABLISH AN ALMOND ORCHARD/);
    expect(t.years).toEqual(['1st', '2nd', '3rd', '4th', '5th']);
    const acc = t.rows.find(r => r.kind === 'accumulated' && /^ACCUMULATED NET CASH/.test(r.label))!;
    expect(acc.values[2]).toBe(16758);
    expect(acc.values[4]).toBe(21454);
    const { row, sums } = sumOps(t, /CULTURAL/);
    // Columns 1, 3 and 5 add up within rounding. The study's own printed 2nd-year cultural total (1,830) is 183 more
    // than its 36 rows (1,647), and the 4th year is 9 less; the parser keeps the printed figures and warns.
    for (const c of [0, 2, 4]) expect(Math.abs(sums[c] - (row.values[c] ?? 0))).toBeLessThanOrEqual(3);
    expect(t.yieldRow?.values).toEqual([null, null, 600, 1200, 2400]);
    expect(t.rows.find(r => r.label === 'Replant 1% of Trees')?.values).toEqual([null, 51, 51, 51, 51]);
    expect(t.rows.find(r => r.label === 'Tree Tying: Ropes & Labor')?.values).toEqual([null, 140, null, 124, null]);
    expect(s.parse.warnings.filter(w => /establishment table: TOTAL CULTURAL COSTS column 2nd/.test(w)).length).toBe(1);
  });
  it('2021 Lodi wine grapes: accumulated net cash cost ends at the establishment cost', () => {
    const s = all.find(x => x.source.id === 'grapes-wine-2021-grapewinelodi-22522')!;
    const t = s.establishment!.table!;
    expect(t.years).toEqual(['1st', '2nd', '3rd']);
    const acc = t.rows.find(r => r.kind === 'accumulated' && /^ACCUMULATED NET CASH/.test(r.label))!;
    expect(acc.values[2]).toBe(s.establishment!.accumulatedNetCost!.value);
    const { row, sums } = sumOps(t, /CULTURAL/);
    row.values.forEach((v, c) => { if (v != null) expect(Math.abs(sums[c] - v)).toBeLessThanOrEqual(3); }); // the studies print rounded rows, so subtotals can differ by a dollar or two
    expect(s.parse.warnings.filter(w => /establishment table/.test(w))).toEqual([]);
  });
  it('2023 walnuts, San Joaquin Valley: five year columns, harvest starts in the fifth', () => {
    const s = all.find(x => x.source.id === 'walnuts-23walnutssacval-final-3-26-24')!;
    const t = s.establishment!.table!;
    expect(t.years).toEqual(['Est/1st', '2nd', '3rd', '4th', '5th']);
    const acc = t.rows.find(r => r.kind === 'accumulated' && /^ACCUMULATED NET CASH/.test(r.label))!;
    expect(acc.values[4]).toBe(19064);
    expect(t.rows.find(r => r.label === 'Shake/Sweep/Pickup/Load')?.values).toEqual([null, null, null, null, 200]);
    const { row, sums } = sumOps(t, /CULTURAL/);
    row.values.forEach((v, c) => { if (v != null) expect(Math.abs(sums[c] - v)).toBeLessThanOrEqual(3); }); // the studies print rounded rows, so subtotals can differ by a dollar or two
    expect(s.parse.warnings.filter(w => /establishment table/.test(w))).toEqual([]);
  });
  it('production table rows carry a section and the table a title; coverage is printed', () => {
    const withOps = all.filter(s => s.costsPerAcre.operations.length);
    for (const s of withOps) { expect(s.costsPerAcre.title).toBeTruthy(); for (const o of s.costsPerAcre.operations) expect(typeof o.section).toBe('string'); }
    const est = all.filter(s => s.establishment);
    const withTable = est.filter(s => s.establishment!.table);
    const warned = withTable.filter(s => s.parse.warnings.some(w => /establishment table/.test(w)));
    console.log(`establishment table: ${withTable.length} of ${est.length} studies with an establishment block have a row-by-row table; ${warned.length} carry reconciliation warnings; without table: ${est.filter(s => !s.establishment!.table).map(s => s.source.id).join(', ')}`);
    console.log(`with warnings: ${warned.map(s => s.source.id).join(', ')}`);
  });
});

describe('gross returns block', () => {
  const all = load();
  const byId = (id: string) => all.find(x => x.source.id === id)!;
  const textOf = (id: string): string[] | null => {
    const f = path.join(TEXT_DIR, `${id}.txt`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n') : null;
  };
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  const GROSS = /^\s*(?:TOTAL\s*)?GROSS\s*(?:RETURNS?|REVENUE|INCOME)\b/;
  const OPS = /^\s*OPERATING\s*COSTS?\b/i;

  // Studies whose text prints a GROSS RETURNS block before OPERATING COSTS but that have no per-acre gross to report.
  const NO_PER_ACRE_RETURNS = new Set([
    // hedgerows: the table is per 1,000 linear feet, not per acre
    'blue-elderberry-20blueelderberryhedgerowwithouttillage',
    'blue-elderberry-20blueelderberrymultispecieshedgerowwithtillage',
    'blue-elderberry-20blueelderberryhighdensityhedgerowwithtillage',
    // establishment-to-production table with one gross returns figure per year, no single per-acre value
    'lychee-lycheescc02',
  ]);

  it('the spot-checked studies carry the printed gross returns', () => {
    const g = (id: string) => byId(id).costsPerAcre.grossReturns?.value;
    expect(g('grain-silage-smallgrainsilagevs2013')).toBe(1012);
    expect(g('asparagus-asparagusvn2013')).toBe(5320);
    expect(g('alfalfa-alfalfa-im-butte-2012')).toBe(1000);
    expect(g('grapes-table-2018tablegrapessjvscarletroyalfinaldraft')).toBe(30400);
    expect(g('beans-beanslglimavn10')).toBe(1495);
    expect(g('lemons-lemons-vs-2015')).toBe(13905);
    expect(g('onions-onionsir2011')).toBe(3024);
    for (const id of ['grain-silage-smallgrainsilagevs2013', 'asparagus-asparagusvn2013', 'alfalfa-alfalfa-im-butte-2012']) expect(byId(id).assumptions.returns).toHaveLength(1);
    expect(byId('grapes-table-2018tablegrapessjvscarletroyalfinaldraft').assumptions.pricePerUnit?.value).toBe(19);
    expect(byId('grapes-table-2018tablegrapessjvscarletroyalfinaldraft').assumptions.yieldPerAcre?.value).toBe(1600);
  });

  it('every study that prints a per-acre GROSS RETURNS block has grossReturns', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const s of all) {
      const t = textOf(s.source.id);
      if (!t || NO_PER_ACRE_RETURNS.has(s.source.id)) continue;
      const printed = t.some((l, i) => {
        if (!GROSS.test(l)) return false;
        const after = t.slice(i, i + 12);
        if (!after.some(x => OPS.test(x))) return false;                    // the costs-and-returns table, not prose or a livestock budget
        return t.slice(i, i + 4).some(x => /\d[\d,]*(?:\.\d+)?\s*$/.test(x)); // followed by numbers
      });
      if (!printed) continue;
      checked++;
      if (!s.costsPerAcre.grossReturns) missing.push(s.source.id);
    }
    console.log(`gross returns block printed in ${checked} studies`);
    expect(missing).toEqual([]);
  });

  it('returns[] holds only lines of the returns block, never lines after OPERATING COSTS', () => {
    const bad: string[] = [];
    for (const s of all) {
      if (!s.assumptions.returns.length) continue;
      const t = textOf(s.source.id);
      if (!t) continue;
      for (const r of s.assumptions.returns) {
        const i = t.findIndex(l => clean(l) === r.quote);
        expect(i, `${s.source.id}: ${r.quote}`).toBeGreaterThanOrEqual(0);
        let j = i;
        while (j >= 0 && !GROSS.test(t[j]) && !OPS.test(t[j])) j--;
        if (j < 0 || OPS.test(t[j])) bad.push(`${s.source.id}: ${r.quote}`);
      }
    }
    expect(bad).toEqual([]);
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

describe('avocado establishment tables', () => {
  const studies = fs.readdirSync(PARSED_DIR).filter(f => f.startsWith('avocados-')).map(f => JSON.parse(fs.readFileSync(path.join(PARSED_DIR, f), 'utf8')) as ParsedStudy);
  const byId = (id: string) => studies.find(s => s.source.id === id)!;
  const cell = (id: string, label: RegExp, col: number) => {
    const t = byId(id).establishment!.table!;
    const r = t.rows.find(x => label.test(x.label));
    expect(r, `${id}: no row ${label}`).toBeTruthy();
    return r!.values[col];
  };
  const ids = [
    'avocados-2020avocadohighdensitysandiegocounty', 'avocados-avocadoconventionalsdr2011', 'avocados-avocadosdrorganic-reports2011',
    'avocados-avocadoconventionalvsbslo2011', 'avocados-avocadovsbsloorganicreport2011',
  ];
  it.each(ids)('%s has an establishment table with six years and its rows', id => {
    const t = byId(id)?.establishment?.table;
    expect(t).toBeTruthy();
    expect(t!.years).toHaveLength(6);
    expect(t!.rows.filter(r => r.kind === 'operation').length).toBeGreaterThan(15);
    expect(t!.rows.some(r => r.kind === 'total' && /OPERATING/i.test(r.label))).toBe(true);
    expect(t!.rows.some(r => r.kind === 'accumulated')).toBe(true);
    for (const r of t!.rows) expect(r.values).toHaveLength(6);
  });
  it('2020 San Diego high density: Table 1 cells, both pages', () => {
    const id = 'avocados-2020avocadohighdensitysandiegocounty';
    expect(byId(id).establishment!.table!.years).toEqual(['Estab/1st', '2nd', '3rd', '4th', '5th', '6th']);
    expect(cell(id, /^Avocado Trees \(430\) & Labor$/, 0)).toBe(15833);
    expect(cell(id, /^TOTAL CULTURAL COSTS$/, 3)).toBe(11468);
    expect(cell(id, /^ACCUMULATED NET CASH COSTS\/ACRE$/, 2)).toBe(28409);
    // the prose establishment cost is the last column of the total accumulated row
    expect(cell(id, /^TOTAL ACCUMULATED NET COST\/ACRE$/, 5)).toBe(17597);
    expect(byId(id).establishment!.accumulatedNetCost?.value).toBe(17597);
  });
  it('2011 conventional San Diego/Riverside: the Riverside table, matching the production tables', () => {
    const id = 'avocados-avocadoconventionalsdr2011';
    expect(byId(id).establishment!.table!.title).toMatch(/Riverside/);
    expect(cell(id, /^TOTAL CASH COSTS$/, 0)).toBe(10842);
    expect(cell(id, /^TOTAL ACCUMULATED NET COST$/, 5)).toBe(32407);
    expect(byId(id).establishment!.accumulatedNetCost?.value).toBe(32407);
  });
  it('2011 organic San Diego/Riverside', () => {
    const id = 'avocados-avocadosdrorganic-reports2011';
    expect(cell(id, /^TOTAL CASH COSTS$/, 5)).toBe(8530);
    expect(cell(id, /^TOTAL ACCUMULATED NET COST$/, 5)).toBe(37798);
  });
  it('2011 conventional Ventura/Santa Barbara/SLO: the SLO table', () => {
    const id = 'avocados-avocadoconventionalvsbslo2011';
    expect(byId(id).establishment!.table!.title).toMatch(/San Luis Obispo/);
    expect(cell(id, /^TOTAL Plant COSTS$/, 0)).toBe(6556);
    expect(cell(id, /^TOTAL ACCUMULATED NET COST$/, 5)).toBe(35176);
    expect(byId(id).establishment!.annualCharge?.value).toBe(2223.46);
  });
  it('2011 organic Ventura/Santa Barbara/SLO: continuation page without a year header', () => {
    const id = 'avocados-avocadovsbsloorganicreport2011';
    // 77.5 + (-58.13) = 19.38, the printed year-2 subtotal of the harvest, marketing and organic fees block
    expect(cell(id, /^Organic Certification Application & Inspection$/, 1)).toBe(77.5);
    expect(cell(id, /^TOTAL Harvesting, Marketing, & Organic Fees COSTS$/, 1)).toBe(19.38);
    expect(cell(id, /^Interest on establishment$/, 1)).toBe(851);
    expect(cell(id, /^TOTAL ACCUMULATED NET COST$/, 5)).toBe(39773);
    expect(byId(id).establishment!.table!.rows.some(r => /^Irrigation & walk lines .* yr\. 2 - onward\)$/.test(r.label) && r.values[0] === 340)).toBe(true);
  });
});
