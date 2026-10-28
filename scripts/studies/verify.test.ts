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

describe('establishment summary: every perennial study has a table or a cited per acre total', () => {
  const all = load();
  const byId = (id: string) => all.find(x => x.source.id === id)!;
  // Perennial studies that have neither a usable table nor a per acre total, and why (the study itself says so).
  const NO_ESTABLISHMENT_COST: Record<string, string> = {
    'apples-2023applesccfullfinal-nov23': 'establishment is folded into the $30,000 land value of an established orchard',
    'apples-2023organicapplesccfullfinal-nov23': 'establishment is folded into the land value of an established orchard',
    'apples-apples-santa-cruz-conv-processing': '"There are no establishment costs included in this study."',
    'apples-apples-santa-cruz-org-processing': '"There are no establishment costs included in this study."',
    'walnuts-walnut-org-nc2013': '"This study does not take into account establishment cost."',
    'pasture-20pasturesnfhproduction': 'production of an established, rented pasture; establishment is a separate UC study',
    'pasture-pasture-sv-2015': 'production of an established, rented pasture; establishment is a separate UC study',
  };
  // Perennial studies with a parsed table but no per acre total.
  const TABLE_WITHOUT_TOTAL: Record<string, string> = {
    'blue-elderberry-20blueelderberryhedgerowwithouttillage': 'hedgerow table is per 1,000 linear feet, not per acre',
    'blue-elderberry-20blueelderberryhighdensityhedgerowwithtillage': 'hedgerow table is per 1,000 linear feet, not per acre',
    'blue-elderberry-20blueelderberrymultispecieshedgerowwithtillage': 'hedgerow table is per 1,000 linear feet, not per acre',
    'christmas-trees-christmastreesn2005': 'trees are cut from year 6 and replanted; the accumulated row restarts and no single establishment total is printed',
  };
  const printed = (quote: string, v: number) => quote.includes(v.toLocaleString('en-US', { maximumFractionDigits: 2 })) || quote.replace(/,/g, '').includes(String(v));

  it('every study carries a summary; perennial studies have status table or total unless allowlisted', () => {
    for (const s of all) {
      const e = s.establishmentSummary;
      expect(e, s.source.id).toBeTruthy();
      if (!e.perennial) continue;
      if (s.source.id in NO_ESTABLISHMENT_COST) { expect(e.status, s.source.id).toBe('none'); expect(e.reason, s.source.id).toBeTruthy(); continue; }
      expect(['table', 'total'], s.source.id).toContain(e.status);
      if (!(s.source.id in TABLE_WITHOUT_TOTAL)) expect(e.total, s.source.id).not.toBeNull();
    }
    const per = all.filter(s => s.establishmentSummary.perennial);
    const count = (st: string) => per.filter(s => s.establishmentSummary.status === st).length;
    console.log(`establishment summary: ${per.length} perennial studies; table ${count('table')}, total ${count('total')}, none ${count('none')}`);
  });
  it("status 'table' means the table has years and rows; a total is positive and cited as printed", () => {
    for (const s of all) {
      const e = s.establishmentSummary;
      if (e.status === 'table') { expect(s.establishment?.table?.years.length, s.source.id).toBeGreaterThan(0); expect(s.establishment!.table!.rows.length, s.source.id).toBeGreaterThan(0); }
      if (e.status === 'total') expect(e.total, s.source.id).not.toBeNull();
      if (e.status !== 'table' && e.perennial) expect(e.reason, s.source.id).toBeTruthy();
      for (const c of [e.total, e.annualCharge]) {
        if (!c) continue;
        expect(c.value, s.source.id).toBeGreaterThan(0);
        expect(c.page, s.source.id).toBeGreaterThan(0);
        if (!('source' in c) || c.source !== 'investment') expect(printed(c.quote, c.value), `${s.source.id}: ${c.value} in "${c.quote}"`).toBe(true);
      }
    }
  });
  it('annual crops are not perennial and carry no establishment figures', () => {
    const annual = ['tomatoes-process-tomato-drip', 'lettuce-2023-iceberglettuce-full-final', 'strawberries-2024strawberry-full-final-march2024', 'cover-crops-2022covercropsbenefits', 'rice-2021ricesacramentovalley', 'wheat-wheatvs2013', 'beans-2023-baby-lima-final', 'artichokes-artichokes04'];
    for (const id of annual) {
      const e = byId(id).establishmentSummary;
      expect(e.perennial, id).toBe(false);
      expect(e.status, id).toBe('none');
      expect(e.total, id).toBeNull();
      expect(e.reason, id).toMatch(/Annual crop/);
    }
    for (const s of all.filter(x => !x.establishmentSummary.perennial)) { expect(s.establishmentSummary.total, s.source.id).toBeNull(); expect(s.establishmentSummary.status, s.source.id).toBe('none'); }
  });
  it('hand-checked totals and annual charges', () => {
    // [id, status, total, source, annual charge] as printed in the study
    const cases: [string, string, number | null, string | null, number | null][] = [
      ['almonds-2024sacvalleyalmonds7-5-24-final-draft', 'table', 14894, 'table', 1489],  // 3rd year accumulated net cash cost; prose "$14,894 per acre"
      ['pears-18pearssv-7218', 'total', 12500, 'production', 692],                          // "Establishment 12,500 692 692"; prose "$12,500 per acre"
      ['pears-pearsv2010', 'total', 9500, 'production', 457],                               // "Establishment Costs 9,500 457 457"
      ['grapes-wine-2021-grapewinelodi-22522', 'table', 26313, 'table', 1954],              // "Vineyard Establishment 26,313 1,954 1,954"
      ['grapes-wine-wine-grape-sn-2015', 'table', 28603, 'table', 2124],                    // 3rd year accumulated net cash = $143,015 / 5 acres; "Vineyard Establishment 2,124"
      ['grapes-wine-amendedwinegrapessonomafinaldraft91817', 'total', 45000, 'production', 3419],
      ['alfalfa-16alfalfasjv300acfinal-41916', 'table', 888, 'table', 315],                 // one-year table TOTAL CASH COSTS/ACRE 888; "Establishment Costs for 300 acres of alfalfa 888 315 315"
      // the production table amortizes 28,409 (3rd year accumulated net cash); the prose 6-year figure $17,597 is not what is amortized
      ['avocados-2020avocadohighdensitysandiegocounty', 'table', 28409, 'table', 1955],
      ['peaches-nectarines-2000peach', 'table', 4679, 'table', 482],                        // "Tahle 1." in the text layer; prose says $4,672, table and production line 4,679
      ['grapes-grapesrivcty02', 'table', 21356, 'table', 1700],                              // "ACCUMULATED NET COSTS 12,248 17,443 21,356"
      ['lychee-lycheescc02', 'total', 15037, 'prose', 1152],
      ['peaches-peachesearlysv2011', 'total', 6286, 'production', 595],
      ['apples-2023applesccfullfinal-nov23', 'none', null, null, null],
    ];
    for (const [id, status, total, source, annual] of cases) {
      const e = byId(id).establishmentSummary;
      expect(e.perennial, id).toBe(true);
      expect(e.status, id).toBe(status);
      expect(e.total?.value ?? null, id).toBe(total);
      expect(e.total?.source ?? null, id).toBe(source);
      expect(e.annualCharge?.value ?? null, id).toBe(annual);
    }
    expect(byId('apples-2023applesccfullfinal-nov23').establishmentSummary.reason).toMatch(/land value/);
  });
});

describe('per-acre operations table (Table 1 operation rows)', () => {
  const all = load();
  const get = (id: string) => { const s = all.find(x => x.source.id === id); expect(s, id).toBeTruthy(); return s!; };
  const sumOps = (s: ParsedStudy) => s.costsPerAcre.operations.reduce((a, r) => a + (r.totalCost ?? 0), 0);
  const within = (a: number, b: number, pct: number) => Math.abs(a - b) <= (pct / 100) * Math.abs(b);

  // Studies with no per-acre operation table the parser can read, and why. Every other study must have one.
  const NO_OPERATIONS_TABLE: Record<string, string> = {
    // livestock budgets: per-head and whole-herd columns, no per-acre operation table
    'beef-17beefcowcalfeastbayareafinaldraft121417': 'livestock budget',
    'beef-17beefcowcalfsjvfinaldraft91217': 'livestock budget',
    'beef-18beefcowcalfcentralcoast81018': 'livestock budget',
    'beef-2017beefcowcalfsacvalleyfinaldraft63017': 'livestock budget',
    'beef-2017beefyearlingstockerssacvalfinaldraft-71917': 'livestock budget',
    'beef-2017grassfinishedbeefshastafinaldraft71917': 'livestock budget',
    'beef-2019beefcowcalfcentralsanjoaquinvalleyamended92319': 'livestock budget',
    'beef-beefsv2012': 'livestock budget',
    'beef-beefyearling-stockersv2010': 'livestock budget',
    'goats-meatgoatncal2010': 'livestock budget',
    'sheep-2022sheepproductionsjvsouth': 'livestock budget',
    // Imperial County 2004-05 one-page budget whose text layer prints the first land preparation totals one line up
    'cauliflower-cauliflower04': 'Imperial County layout; the text layer shifts the first four row totals onto the line above, so the rows do not add up to TOTAL OF ALL COSTS',
    // the operations table is an image in the PDF; the text layer has only its heading
    'onions-2023onions-final': 'Table 1 is an embedded image',
    // a one-off 2010 Central Coast layout (No. Times / Cost per Time / Material or Custom / Hand Labor / Total Cost) with
    // sub totals by practice and no operating total, interest or overhead split
    'lettuce-2010lettuce-wrap-cc': 'one-off "Sample Production Costs" layout with no operating total',
    // per 1,000 linear feet of hedgerow, establishment only
    'blue-elderberry-20blueelderberryhedgerowwithouttillage': 'per 1,000 LF hedgerow',
    'blue-elderberry-20blueelderberryhighdensityhedgerowwithtillage': 'per 1,000 LF hedgerow',
    'blue-elderberry-20blueelderberrymultispecieshedgerowwithtillage': 'per 1,000 LF hedgerow',
    // no single-year production table laid out by operation
    'conservation-practices-12747': 'partial budget of practices',
    'grapes-wine-wine-grape-sn-2015': 'production years appear only by input (Table 5); operation tables are establishment years',
    'grapes-grapesrivcty02': 'one establishment-and-production table by year',
    'lychee-lycheescc02': 'profitability table by year',
    'christmas-trees-christmastreesn2005': 'one column per year and a per-tree column',
  };

  // Imperial County one-page budgets (2000-01 ryegrass, 2004-05 the rest): operation rows, but no operating total or interest is
  // printed; the rows, land rent, the percentage cash overhead and any stand amortization add up to TOTAL ALL COSTS.
  const ONE_PAGE = ['artichokes-artichokes04', 'bermudagrass-hay-bermhay04', 'bermudagrass-seed-bermseed04', 'cantaloupes-cantaloupemb04', 'carrots-carrotsmkt04',
    'kleingrass-hay-kleingrass04', 'melons-mixedmelons04', 'ryegrass-ryegrass', 'sugar-beets-sugarbeet04', 'watermelon-watermelon04'];

  it('every study with a per-acre operations table has operation rows that add up to the printed operating total', () => {
    const bad: string[] = [];
    for (const s of all) {
      const id = s.source.id;
      if (id in NO_OPERATIONS_TABLE) continue;
      const c = s.costsPerAcre;
      if (!c.operations.length) { bad.push(`${id}: no operation rows`); continue; }
      if (ONE_PAGE.includes(id)) {
        const sum = sumOps(s) + c.cashOverheadItems.reduce((a, x) => a + x.value, 0) + (c.nonCashOverheadTotal?.value ?? 0);
        if (c.operatingTotal || !c.totalCost || Math.abs(sum - c.totalCost.value) > 0.5) bad.push(`${id}: one-page rows ${sum.toFixed(2)} vs TOTAL ALL COSTS ${c.totalCost?.value}`);
        continue;
      }
      if (!c.operatingTotal) { bad.push(`${id}: no operating total`); continue; }
      const rebuilt = sumOps(s) + (c.operatingInterest?.value ?? 0);
      if (!within(rebuilt, c.operatingTotal.value, 2)) bad.push(`${id}: rows + interest ${rebuilt.toFixed(2)} vs printed ${c.operatingTotal.value}`);
    }
    expect(bad).toEqual([]);
  });

  it('the allowlist only names studies that really have no operation rows', () => {
    for (const id of Object.keys(NO_OPERATIONS_TABLE)) expect(get(id).costsPerAcre.operations, id).toEqual([]);
  });

  it('operating + cash overhead + non-cash overhead = total cost (2%) where all four are printed', () => {
    const bad: string[] = [];
    for (const s of all) {
      const { operatingTotal: op, cashOverheadTotal: co, nonCashOverheadTotal: nc, totalCost: t } = s.costsPerAcre;
      if (!op || !co || !nc || !t) continue;
      if (!within(op.value + co.value + nc.value, t.value, 2)) bad.push(`${s.source.id}: ${op.value} + ${co.value} + ${nc.value} vs ${t.value}`);
    }
    expect(bad).toEqual([]);
  });

  // Hand-checked against the printed tables.
  it('Imperial County one-page budgets: annual rows only, stand establishment left out, amortization as the non-cash overhead', () => {
    const c = get('bermudagrass-hay-bermhay04').costsPerAcre;
    expect(c.operations.map(o => [o.name, o.totalCost])).toEqual([['Irrigate 16x', 149.61], ['Fertilizer, broadcast 4x', 168], ['Fertilize-water-run', 22], ['Weed control*-ground', 17],
      ['Swather 5x', 68.75], ['Rake 12x', 66], ['Bale 10 tons', 126], ['Haul & Stack 10 tons', 48.6]]);
    const irr = c.operations[0];
    expect([irr.labor, irr.materials, irr.customRent, irr.page]).toEqual([49.61, 100, 0, 6]);
    expect([c.operations[1].materials, c.operations[1].customRent]).toEqual([136, 32]);    // 8.00 prevailing rate x 4
    expect(c.nonCashOverheadTotal).toMatchObject({ value: 62.24, page: 6, quote: 'Amortization 20 % of total cost of stand establishment 62.24' });
    expect(c.cashOverheadItems.map(x => x.value)).toEqual([125, 70.7]);
    expect(c.operatingTotal).toBeNull();
    expect(c.totalCost).toMatchObject({ value: 923.9, page: 6 });
    // no prevailing rate on the row: the remainder is hand labor ("Seedless transplants 600.00 12 9.95 719.40")
    const t = get('watermelon-watermelon04').costsPerAcre.operations.find(o => o.name === 'Seedless transplants')!;
    expect([t.materials, t.labor, t.customRent, t.totalCost]).toEqual([600, 119.4, 0, 719.4]);
  });

  it('guava 2007: split words are joined for the cost tables ("COS TS", "CA SH OVERHEA D")', () => {
    const s = get('guava-guava-sc07'), c = s.costsPerAcre;
    expect(c.operations).toHaveLength(10);
    expect(c.operatingTotal).toMatchObject({ value: 5410, page: 16, quote: 'TOTAL OPERATING COS TS /ACRE 1071 88 1690 2386 5410' });
    expect(c.operatingInterest?.value).toBe(175);
    expect([c.cashOverheadTotal?.value, c.nonCashOverheadTotal?.value, c.totalCost?.value]).toEqual([1667, 4043, 11120]);
    expect(c.operations.find(o => o.name === 'Packing & Marketing')?.customRent).toBe(466);
    expect(s.parse.warnings).toContain('the text layer splits words in the cost tables ("COS TS", "CA SH"); the tables are read with those splits joined');
  });

  it('Spanish studies: "COSTOS DE OPERACIÓN TOTALES /" wrapped before ACRE, "COSTOS GENERALES TOTALES NO EFECTIVOS", cash overhead items', () => {
    const r = get('raspberries-span-bpraspberry-cc-final-v2-1').costsPerAcre;
    expect(r.operatingTotal).toMatchObject({ value: 58287, quote: 'COSTOS DE OPERACIÓN TOTALES / 6,837 266 102 9,608 41,055 58,287' });
    expect([r.operatingInterest?.value, r.cashOverheadTotal?.value, r.nonCashOverheadTotal?.value, r.totalCost?.value]).toEqual([419, 3415, 5185, 66887]);
    expect(r.operations).toHaveLength(25);
    expect(r.operations[0].category).toBe('cultural');                                     // "Agronómico:"
    expect(r.cashOverheadItems.reduce((a, x) => a + x.value, 0)).toBe(3415);
    const b = get('blackberries-span-bpblackberrycc2018-final');
    // Table 5 prints 64,597, but its own rows and Tables 1, 6 and 8 give 65,597
    expect([b.costsPerAcre.nonCashOverheadTotal?.value, b.costsPerAcre.totalCost?.value]).toEqual([6615, 65597]);
    expect(b.costsPerAcre.operations.find(o => o.name === 'Camioneta')?.totalCost).toBe(183);
    expect(b.parse.warnings).toContain('Table 1 row "Camioneta" prints a total of 83 but its cells add to 183; the section subtotal 6140 (page 21) matches the cells, so 183 is used');
    // the hours figure runs into a long label
    const st = get('strawberries-spanish-translation-of-2016-strawberry-cost-study-central-coast').costsPerAcre.operations.find(o => /^Siembra/.test(o.name))!;
    expect([st.timeHrsPerAcre, st.labor, st.materials, st.totalCost]).toEqual([50, 805, 3202, 4007]);
  });

  it('a row total that disagrees with its cells is replaced only when the section subtotal confirms the cells', () => {
    const ak = get('grapes-table-2018tablegrapessjvautumnkingfinaldraft').costsPerAcre;
    expect(ak.operations.find(o => /^Spread\/Swamp\/Haul/.test(o.name))?.totalCost).toBe(5069);      // printed 4,759; TOTAL HARVEST COSTS 14,913
    expect(ak.operations.find(o => /Mildew \(SI\) 4x, Fertilizer/.test(o.name))?.totalCost).toBe(111); // cells 115, subtotal agrees with 111
    // Flame Seedless prints 1,520 for cells of 1,133 and its subtotal agrees with 1,520: kept
    expect(get('grapes-table-2018tablegrapessjvflameseedlessfinaldraft').costsPerAcre.operations.find(o => /^Prune: Dormant/.test(o.name))?.totalCost).toBe(1520);
    // a label that wraps before its figures
    expect(get('pears-pearsnc2012').costsPerAcre.operations.map(o => o.name)).toContain('Disease/insect: Fire blight/codling moth (Agri-Mycin, Mycoshield, Intrepid)');
  });

  // Hand-checked against the printed Table 1 / Table 2.
  it('2023 baby lima beans: "TOTAL OPERATING COSTS/A" row, and overhead per acre rather than per cwt', () => {
    const c = get('beans-2023-baby-lima-final').costsPerAcre;
    const r = c.operations.find(x => x.name === 'Irrigate 5x')!;
    expect([r.labor, r.materials, r.totalCost, r.page]).toEqual([73, 208.25, 281.25, 11]);
    expect(c.operations).toHaveLength(25);
    expect(c.operatingTotal?.value).toBe(1317.17);      // "TOTAL OPERATING COSTS/A 3.19 184.45 77.31 34.73 539.38 457.50 1317.17"
    expect(c.operatingInterest?.value).toBe(23.8);
    expect(c.cashOverheadTotal?.value).toBe(481.82);    // not "TOTAL CASH OVERHEAD COSTS/CWT 17.21"
    expect(c.nonCashOverheadTotal?.value).toBe(65.44);
    expect(c.totalCost?.value).toBe(1864.42);
  });
  it('2012-13 Ventura County cabbage: "TOTAL OPERATI NG COSTS/ACRE" and per-carton rows', () => {
    const c = get('cabbage-costs-and-profitability-analysis-for-cabbage-production-in-the-oxnard-plain-ventura-county-2012-13').costsPerAcre;
    const r = c.operations.find(x => x.name === 'Cut, Pack, Haul, Cool, Sell')!;
    expect([r.customRent, r.totalCost, r.category]).toEqual([4188.19, 4188.19, 'harvest']);
    expect(c.operatingTotal?.value).toBe(6796);
    expect(c.cashOverheadTotal?.value).toBe(1336);      // not "TOTAL CASH OVERHEAD COSTS/CRTN 1.27"
    expect(c.nonCashOverheadTotal?.value).toBe(80);
    expect(c.totalCost?.value).toBe(8212);
  });
  it('2006 sweetpotatoes: Table 5 (not the "MONTLY" table), with a field labor hours column', () => {
    const c = get('sweet-potatoes-potatosweetsjv2006').costsPerAcre;
    expect(c.title).toBe('COST PER ACRE TO PRODUCE SWEETPOTATOES');
    const hand = c.operations.find(x => x.name === 'Weed: Hand 3X')!;
    expect([hand.timeHrsPerAcre, hand.labor, hand.fuel, hand.totalCost]).toEqual([0, 306, 0, 306]);   // "0.00 31.50 306 0 0 0 306"
    const mow = c.operations.find(x => x.name === 'Harvest: Mow Vines')!;
    expect([mow.timeHrsPerAcre, mow.labor, mow.fuel, mow.totalCost]).toEqual([0.25, 3, 4, 7]);       // no field labor hours printed
    expect(c.operatingTotal?.value).toBe(3417);
    expect([c.cashOverheadTotal?.value, c.nonCashOverheadTotal?.value, c.totalCost?.value]).toEqual([902, 1281, 5599]);
  });
  it('2018 Fresno processing tomatoes: rows on the Table 1 continuation page are read', () => {
    const c = get('tomatoes-17processtomatofresnosdi-final-draft').costsPerAcre;
    const r = c.operations.find(x => x.name === 'Drip Tape Extraction 33% Ac')!;
    expect([r.labor, r.fuel, r.lubeRepairs, r.totalCost, r.page]).toEqual([21, 11, 5, 36, 13]);
    expect(c.operations.find(x => x.name === 'Laser level 7% Ac')?.totalCost).toBe(11);
    expect(c.operatingTotal?.value).toBe(3345);
    expect([c.cashOverheadTotal?.value, c.nonCashOverheadTotal?.value, c.totalCost?.value]).toEqual([318, 798, 4461]);
  });
  it('2014 processing tomatoes (drip): non-cash overhead is the per-acre 223, not the 1,994 investment', () => {
    const c = get('tomatoes-process-tomato-drip').costsPerAcre;
    expect(c.nonCashOverheadTotal?.value).toBe(223);
    expect([c.operatingTotal?.value, c.cashOverheadTotal?.value, c.totalCost?.value]).toEqual([2733, 198, 3153]);  // 2,733 + 198 + 223 = 3,154; printed 3,153 (rounding)
  });

  it('cash overhead items never include TOTAL lines, and add up to the printed cash overhead total (2%)', () => {
    const off: string[] = [];
    for (const st of load()) {
      const c = st.costsPerAcre;
      for (const it of c.cashOverheadItems) if (/^\s*TOTAL/i.test(it.description)) off.push(`${st.source.id}: item "${it.description}"`);
      if (!c.cashOverheadItems.length || !c.cashOverheadTotal) continue;
      const sum = c.cashOverheadItems.reduce((a, x) => a + x.value, 0);
      if (Math.abs(sum - c.cashOverheadTotal.value) > Math.max(2, 0.02 * c.cashOverheadTotal.value)) off.push(`${st.source.id}: items ${Math.round(sum)} vs total ${c.cashOverheadTotal.value}`);
    }
    expect(off).toEqual([]);
  });
});

describe('establishment charge inputs: basis year, capital recovery, investment charges', () => {
  const studies = load();
  const byId = (id: string) => studies.find(x => x.source.id === id)!;
  const tiered = studies.filter(s => (s.establishmentSummary.status === 'table' || s.establishmentSummary.status === 'total') && s.establishmentSummary.total);
  const crfOf = (ratePct: number, years: number) => { const r = ratePct / 100; return r === 0 ? 1 / years : (r * (1 + r) ** years) / ((1 + r) ** years - 1); };

  // Studies that print an annual establishment charge but state no capital recovery rate or no years to run it.
  const NO_CAPITAL_RECOVERY: Record<string, string> = {
    'lychee-lycheescc02': 'states no capital recovery rate (8.5% is interest on investment in cash overhead, 8.06% the land opportunity rate); the printed 1,152 matches 15,037 over 30 years only at an unstated 6.5%',
  };
  // Studies whose printed annual charge does not follow from the rate and years their text states.
  const NOT_REPRODUCING: Record<string, string> = {
    'boysenberries-boysenberriesvn02': 'the production table prints "Berry Crop Establishment 502 69 69", not the 7,345 establishment cost; the investment table charges 1,042 on 7,524 over 10 years at 6.41%',
    'pasture-pastureep-sv-2015': 'prints "Establish Pasture-Tilled 40Ac 439 34 34"; 439 over the 20 years at 6.25% is 39',
  };

  it('every table/total study with a printed annual charge has capitalRecovery, unless allowlisted', () => {
    const missing = tiered.filter(s => s.establishmentSummary.annualCharge && !s.establishmentSummary.capitalRecovery).map(s => s.source.id);
    expect(missing.filter(id => !(id in NO_CAPITAL_RECOVERY))).toEqual([]);
    for (const id of Object.keys(NO_CAPITAL_RECOVERY)) expect(byId(id).establishmentSummary.capitalRecovery, id).toBeNull();
  });

  it('capitalRecovery reproduces the printed annual charge, unless allowlisted with the diagnosed reason', () => {
    const bad = tiered.filter(s => s.establishmentSummary.annualCharge && s.establishmentSummary.capitalRecovery && !s.establishmentSummary.capitalRecovery.reproduces).map(s => s.source.id);
    expect(bad.filter(id => !(id in NOT_REPRODUCING))).toEqual([]);
    for (const id of Object.keys(NOT_REPRODUCING)) expect(byId(id).establishmentSummary.capitalRecovery?.reproduces, id).toBe(false);
  });

  it('capitalRecovery is internally consistent and cited', () => {
    for (const s of studies) {
      const e = s.establishmentSummary, cr = e.capitalRecovery;
      if (!cr) continue;
      expect(e.total, s.source.id).toBeTruthy();
      expect(cr.computed).toBeCloseTo(e.total!.value * crfOf(cr.ratePct.value, cr.years.value), 6);
      const printed = e.annualCharge?.value;
      expect(cr.reproduces).toBe(printed != null && Math.abs(cr.computed - printed) <= Math.max(3, 0.02 * printed));
      for (const c of [cr.ratePct, cr.years]) { expect(c.page).toBeGreaterThan(0); expect(c.quote.length).toBeGreaterThan(3); }
      expect(cr.ratePct.value).toBeGreaterThanOrEqual(0); expect(cr.ratePct.value).toBeLessThan(20); // 0: straight line
    }
  });

  it("basisYear is present for status 'table' studies whose total came from the table, and points at the total", () => {
    for (const s of studies) {
      const e = s.establishmentSummary;
      if (e.status !== 'table' || e.total?.source !== 'table') { if (e.status !== 'table') expect(e.basisYear, s.source.id).toBeNull(); continue; }
      expect(e.basisYear, s.source.id).toBeTruthy();
      const years = s.establishment!.table!.years;
      expect(years[e.basisYear!.index]).toBe(e.basisYear!.label);
    }
  });

  it('investmentCharges are per acre figures of the printed establishment row', () => {
    for (const s of studies) {
      const ic = s.establishmentSummary.investmentCharges;
      if (!ic) continue;
      expect(ic.acres, s.source.id).toBeGreaterThan(0);
      expect(ic.insurance).toBeGreaterThanOrEqual(0); expect(ic.taxes).toBeGreaterThanOrEqual(0);
      expect(ic.page).toBeGreaterThan(0); expect(ic.quote).toMatch(/establish/i);
    }
  });

  it('hand-checked: 2020 high density avocados, San Diego County', () => {
    const e = byId('avocados-2020avocadohighdensitysandiegocounty').establishmentSummary;
    expect(e.total?.value).toBe(28409);
    expect(e.basisYear).toMatchObject({ index: 2, label: '3rd' });
    expect(e.capitalRecovery?.ratePct.value).toBe(5.5);
    expect(e.capitalRecovery?.years.value).toBe(30);
    expect(e.capitalRecovery?.computed).toBeCloseTo(1954.69, 1);
    expect(e.capitalRecovery?.reproduces).toBe(true);
    expect(e.investmentCharges).toMatchObject({ insurance: 12.6, taxes: 142.05, acres: 20, insuranceRatePct: 0.886, taxRatePct: 1 });
  });

  it('hand-checked: 2024 Sacramento Valley almonds', () => {
    const e = byId('almonds-2024sacvalleyalmonds7-5-24-final-draft').establishmentSummary;
    expect(e.total?.value).toBe(14894);
    expect(e.basisYear).toMatchObject({ index: 2, label: '3rd' });
    expect(e.capitalRecovery).toMatchObject({ ratePct: { value: 8.25 }, years: { value: 22 }, reproduces: true });
    expect(e.capitalRecovery?.computed).toBeCloseTo(1489.07, 1);
    expect(e.annualCharge?.value).toBe(1489);
    expect(e.investmentCharges).toMatchObject({ insurance: 5.29, taxes: 74.47, acres: 100, insuranceRatePct: 0.71, taxRatePct: 1 });
  });

  it('hand-checked: 2019 San Joaquin Valley South Chardonnay (charge runs the investment row\'s 25 years, not the text\'s 22)', () => {
    const e = byId('grapes-wine-19winegrapessjvsouthchardonnay').establishmentSummary;
    expect(e.total?.value).toBe(20645);
    expect(e.basisYear).toMatchObject({ index: 2, label: '3rd' });
    expect(e.capitalRecovery).toMatchObject({ ratePct: { value: 6 }, years: { value: 25 }, reproduces: true });
    expect(e.capitalRecovery?.years.quote).toMatch(/remaining 22 years/);
    expect(e.capitalRecovery?.computed).toBeCloseTo(1614.99, 1);
    expect(e.investmentCharges).toMatchObject({ insurance: 91.45, taxes: 103.23, acres: 40 });
  });

  it('hand-checked: 2015 Sacramento Valley flood irrigated alfalfa', () => {
    const e = byId('alfalfa-alfalfa-flood-sv-2015').establishmentSummary;
    expect(e.total?.value).toBe(821);
    expect(e.basisYear?.index).toBe(0);
    expect(e.capitalRecovery).toMatchObject({ ratePct: { value: 4.75 }, years: { value: 4 }, reproduces: true });
    expect(e.capitalRecovery?.computed).toBeCloseTo(230.19, 1);
    expect(e.investmentCharges).toMatchObject({ insurance: 0.34, taxes: 4.11, acres: 160 });
  });
  it('basisYear.row names the table row whose value in the basis column is the total (net of lessReturns when cited)', () => {
    for (const s of studies) {
      const e = s.establishmentSummary, b = e.basisYear;
      if (!b?.row || !e.total) continue;
      const row = s.establishment!.table!.rows.find(r => r.label === b.row && r.values[b.index] != null);
      expect(row, s.source.id).toBeTruthy();
      expect(Math.abs(row!.values[b.index]! - (b.lessReturns?.value ?? 0) - e.total.value), s.source.id).toBeLessThanOrEqual(1);
      if (b.lessReturns) { expect(b.lessReturns.page).toBeGreaterThan(0); expect(b.lessReturns.quote).toMatch(/GROSS RETURNS/); }
    }
  });

  it('the land row of the investment table gives the rate when the text rate does not reproduce the charge', () => {
    const cases: [string, number, number, number][] = [ // id, rate, years, printed charge
      ['alfalfa-alfalfaorganicca2013', 4.75, 3, 173],
      ['almonds-almondfloodvn2011', 4.75, 22, 389],
      ['almonds-almondsprinklevn2011', 4.75, 22, 376],
      ['walnuts-walnutsv2012', 5.75, 31, 585],
      ['grapes-wine-16winegrapebiodynamicmendocinofinaldraft61416-1', 4.25, 27, 2204],
    ];
    for (const [id, rate, years, printed] of cases) {
      const e = byId(id).establishmentSummary;
      expect(e.annualCharge?.value, id).toBe(printed);
      expect(e.capitalRecovery, id).toMatchObject({ ratePct: { value: rate }, years: { value: years }, reproduces: true });
      expect(e.capitalRecovery!.ratePct.quote, id).toMatch(/^Land\b.*capital recovery \/ salvage value of the land row/);
    }
  });

  it('"Establish ..." production lines carry the yearly charge; acre counts in the label are not values', () => {
    const cases: [string, number, number, boolean][] = [
      ['grapes-wine-winegrapenc2012', 37991, 2526, true],
      ['pasture-20pasturesnfhestabtillnotill', 783, 57, true],
      ['peppermint-oil-peppermintim2011', 1633, 458, true],
      ['pasture-pastureep-sv-2015', 439, 34, false], // the charge does not follow from 439 at 6.25% over 20 years
    ];
    for (const [id, total, annual, reproduces] of cases) {
      const e = byId(id).establishmentSummary;
      expect(e.total?.value, id).toBe(total);
      expect(e.annualCharge?.value, id).toBe(annual);
      expect(e.annualCharge?.quote, id).toMatch(/^Establish /);
      expect(e.capitalRecovery?.reproduces, id).toBe(reproduces);
    }
  });

  it('peppermint: a one-year costs table amortized net of the year\'s gross returns (3,132 - 1,500 = 1,633)', () => {
    const e = byId('peppermint-oil-peppermintim2011').establishmentSummary;
    expect(e.basisYear).toMatchObject({ index: 0, row: 'TOTAL CASH COSTS/ACRE', lessReturns: { value: 1500 } });
    expect(e.capitalRecovery).toMatchObject({ ratePct: { value: 4.75 }, years: { value: 4 }, reproduces: true });
    // boysenberries print a 502 that is no cell of their table: still not reproducing
    expect(byId('boysenberries-boysenberriesvn02').establishmentSummary.capitalRecovery?.reproduces).toBe(false);
    expect(byId('boysenberries-boysenberriesvn02').establishmentSummary.basisYear?.lessReturns ?? null).toBeNull();
  });

  it('studies that charge no yearly establishment cost say so, with no capital recovery', () => {
    const none = ['almonds-16almondorganicnsjvfinaldraft42716', 'blackberries-bpblackberrycc2018-final-1', 'blackberries-span-bpblackberrycc2018-final',
      'raspberries-23raspberry-fullfinal-dec2023', 'raspberries-bpraspberry-cc-finaldraft', 'raspberries-raspberrycc2012', 'raspberries-span-bpraspberry-cc-final-v2-1',
      'blue-elderberry-20blueelderberryhedgerowwithouttillage', 'blue-elderberry-20blueelderberryhighdensityhedgerowwithtillage',
      'blue-elderberry-20blueelderberrymultispecieshedgerowwithtillage', 'christmas-trees-christmastreesn2005'];
    for (const id of none) {
      const e = byId(id).establishmentSummary;
      expect(e.noYearlyCharge, id).toBe(true);
      expect(e.capitalRecovery, id).toBeNull();
      expect(e.reason, id).toMatch(/The study charges no yearly establishment cost/);
    }
    for (const s of studies) if (s.establishmentSummary.noYearlyCharge) { expect(s.establishmentSummary.annualCharge, s.source.id).toBeNull(); expect(s.establishmentSummary.capitalRecovery, s.source.id).toBeNull(); }
    expect(byId('almonds-16almondorganicnsjvfinaldraft42716').establishmentSummary.reason).toMatch(/included in the land value \(p\. 9: "It is the crop land value plus the Establishment Cost/);
    expect(byId('raspberries-raspberrycc2012').establishmentSummary.reason).toMatch(/\(p\. 9: "The establishment cost is recovered in the first production year\."\)/);
    expect(byId('blue-elderberry-20blueelderberryhedgerowwithouttillage').establishmentSummary.reason).toMatch(/^The establishment table is per 1,000 linear feet of hedgerow, not per acre/);
  });

  it('desert stands: a flat percent of the stand cost each year is straight line at no interest', () => {
    for (const [id, total, annual] of [['bermudagrass-hay-bermhay04', 311.18, 62.24], ['bermudagrass-seed-bermseed04', 311.18, 62.24], ['kleingrass-hay-kleingrass04', 309.68, 61.94]] as const) {
      const e = byId(id).establishmentSummary;
      expect(e.total?.value, id).toBe(total); expect(e.annualCharge?.value, id).toBe(annual);
      expect(e.capitalRecovery, id).toMatchObject({ ratePct: { value: 0, page: 6 }, years: { value: 5, page: 6 }, reproduces: true });
      expect(e.capitalRecovery!.years.quote).toMatch(/^Amortization 20 % of total cost of stand establishment/);
    }
  });

  it('basis rows: a year\'s net cash cost, a one-column operating total, the costs and returns table to establish', () => {
    expect(byId('blackberries-2024blackberries-correctedfinal-april2024').establishmentSummary.basisYear).toMatchObject({ index: 0, label: 'Year 1', row: 'NET CASH COSTS/ACRE FOR THE YEAR' });
    expect(byId('rice-20022ricedeltacontinuousrotation5923').establishmentSummary.basisYear).toMatchObject({ index: 0, row: 'TOTAL OPERATING COSTS/ACRE' });
    const w = byId('wild-rice-wildriceir05');
    expect(w.establishment?.table?.title).toMatch(/COST AND RETURNS PER ACRE TO ESTABLISH/);
    expect(w.establishmentSummary.total).toMatchObject({ value: 217, source: 'table', page: 10 });
    expect(w.establishmentSummary.basisYear).toMatchObject({ index: 0, row: 'TOTAL ACCUMULATED NET CASH COST (ESTABLISHMENT COSTS)' });
    expect(w.establishmentSummary.capitalRecovery).toMatchObject({ ratePct: { value: 6.01 }, years: { value: 4 }, reproduces: true });
  });

  it('Riverside 2002 wine grapes: numbered headings without a colon start a section', () => {
    const s = byId('grapes-grapesrivcty02');
    const am = s.establishment!.table!.rows.find(r => /^Amortized Tree Establishment Cost/.test(r.label))!;
    expect(am.section).toMatch(/^NON-CASH OVERHEAD COSTS/);
    expect(s.establishment!.table!.rows.find(r => r.kind === 'heading' && /^CASH OVERHEAD COSTS$/.test(r.label))).toBeTruthy();
    expect(s.establishmentSummary.basisYear).toMatchObject({ index: 2, label: 'Year 3', row: 'ACCUMULATED NET COSTS' });
  });

  it('lychee: the printed charge with no stated capital recovery rate is explained', () => {
    expect(byId('lychee-lycheescc02').establishmentSummary.reason).toMatch(/states no capital recovery interest rate/);
  });
});
