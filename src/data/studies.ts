// Access to the parsed UC Davis cost studies. Every default the app offers a farmer comes from
// here, and every one carries a Citation back to the page and line it was read from.
// Nothing in this file estimates a number. If a study does not give it, the answer is null.

import bundle from './studies.generated.json';
import type { Cited, EquipmentRow, HourlyEquipmentRow, ParsedStudy } from './studySchema';
import type { Citation, CropOperation } from '../lib/types';

interface Bundle {
  generatedAt: string;
  count: number;
  byCommodity: Record<string, string[]>;
  studies: ParsedStudy[];
  equipmentSalvage: { description: string; price: number; salvageValue: number; yearsLife: number; fraction: number; studyId: string; year: number | null; page: number }[];
  operationsIncluded: boolean;
}

const DATA = bundle as unknown as Bundle;

export const STUDIES: ParsedStudy[] = DATA.studies;
const BY_ID = new Map(STUDIES.map(s => [s.source.id, s]));

export function studyById(id: string | null | undefined): ParsedStudy | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Commodity id as listed on the index page, turned into a readable English name. */
export function commodityName(id: string): string {
  const words = id.replace(/–/g, ' (').replace(/-/g, ' ');
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  return name.includes(' (') ? name + ')' : name;
}

/** A study has usable crop data when it gives at least one of price, yield or an operating total. */
export function studyHasCropData(s: ParsedStudy): boolean {
  const a = s.assumptions;
  const c = s.costsPerAcre;
  return Boolean(a.yieldPerAcre || a.pricePerUnit || c.operatingTotal || a.returns.length > 0 || c.operations.length > 0);
}

export interface CommodityEntry { id: string; name: string; studies: ParsedStudy[] }

/** Commodities that have at least one study with usable crop data, alphabetical. */
export function commoditiesWithData(): CommodityEntry[] {
  return Object.entries(DATA.byCommodity)
    .map(([id, ids]) => ({ id, name: commodityName(id), studies: ids.map(i => BY_ID.get(i)).filter((s): s is ParsedStudy => Boolean(s && studyHasCropData(s))) }))
    .filter(e => e.studies.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function studiesFor(commodity: string): ParsedStudy[] {
  return (DATA.byCommodity[commodity] ?? []).map(i => BY_ID.get(i)).filter((s): s is ParsedStudy => Boolean(s));
}

export function cite(s: ParsedStudy, page: number, quote: string, field: string, value: number | null): Citation {
  return { studyId: s.source.id, title: s.source.title, year: s.source.year, region: s.source.region, url: s.source.url, page, quote, field, value };
}

function citeCited(s: ParsedStudy, c: Cited, field: string): Citation {
  return cite(s, c.page, c.quote, field, c.value);
}

/** Yield, price and unit in one place. Studies print units many ways; the app keeps one spelling. */
export function normalizeUnit(u: string | null | undefined): string {
  if (!u) return 'unit';
  const x = u.toLowerCase().replace(/\.$/, '').replace(/^\$\//, '').trim();
  if (x === 'lbs' || x === 'lb') return 'lb';
  if (x === 'ctn' || x === 'cartons') return 'carton';
  if (x === 'tons') return 'ton';
  if (x === 'trays') return 'tray';
  if (x === 'boxes') return 'box';
  return x;
}

export interface CropDefaults {
  yieldPerAcre: number | null;
  unit: string;
  price: number | null;
  plantingsPerYear: number | null;
  operatingCostPerAcre: number | null;
  costMonths: number[] | null;
  revenueMonths: number[] | null;
  citations: { yieldPerAcre?: Citation; price?: Citation; operatingCostPerAcre?: Citation; months?: Citation; plantingsPerYear?: Citation };
}

/** The main product row of the returns table: the one with the largest value. */
function mainReturn(s: ParsedStudy) {
  return [...s.assumptions.returns].sort((a, b) => b.value - a.value)[0];
}

const normalize = (w: number[]) => { const t = w.reduce((a, b) => a + b, 0); return t > 0 ? w.map(x => x / t) : null; };

/** Everything a study can tell us about a crop, each number with its citation, or null. */
export function cropDefaultsFromStudy(s: ParsedStudy): CropDefaults {
  const a = s.assumptions;
  const cit: CropDefaults['citations'] = {};
  const ret = mainReturn(s);

  let yieldPerAcre: number | null = null;
  let unit = normalizeUnit(a.yieldUnit);
  if (a.yieldPerAcre) {
    yieldPerAcre = a.yieldPerAcre.value;
    unit = normalizeUnit(a.yieldPerAcre.unit ?? a.yieldUnit);
    cit.yieldPerAcre = citeCited(s, a.yieldPerAcre, 'Yield per acre');
  } else if (ret) {
    yieldPerAcre = ret.quantity;
    unit = normalizeUnit(ret.unit);
    cit.yieldPerAcre = cite(s, ret.page, ret.quote, 'Yield per acre, from the returns table', ret.quantity);
  } else if (a.yieldStatement) {
    cit.yieldPerAcre = cite(s, a.yieldStatement.page, a.yieldStatement.quote, 'What the study says about yield', null);
  }

  let price: number | null = null;
  if (a.pricePerUnit) {
    price = a.pricePerUnit.value;
    cit.price = citeCited(s, a.pricePerUnit, 'Price per unit');
  } else if (ret) {
    price = ret.price;
    cit.price = cite(s, ret.page, ret.quote, 'Price per unit, from the returns table', ret.price);
  } else if (a.priceStatement) {
    cit.price = cite(s, a.priceStatement.page, a.priceStatement.quote, 'What the study says about price', null);
  }

  let plantingsPerYear: number | null = null;
  if (a.cropsPerAcrePerYear) {
    plantingsPerYear = a.cropsPerAcrePerYear.value;
    cit.plantingsPerYear = citeCited(s, a.cropsPerAcrePerYear, 'Crops per acre per year');
  }

  // Cost to grow and sell, per acre. From the operations table: labor and materials for every
  // operation, plus contract work for harvest, cooling, selling and assessments. Fuel, lube,
  // repairs and contract machine work in the field are left out because the farmer enters their
  // own machines and hired field jobs separately.
  let operatingCostPerAcre: number | null = null;
  const ops = s.costsPerAcre.operations;
  if (ops.length > 0) {
    let sum = 0;
    for (const o of ops) {
      sum += (o.labor ?? 0) + (o.materials ?? 0);
      if (o.category !== 'cultural') sum += o.customRent ?? 0;
    }
    operatingCostPerAcre = Math.round(sum);
    const page = ops[0].page;
    cit.operatingCostPerAcre = cite(s, page,
      `Sum of the labor and materials columns for all ${ops.length} operations on the costs per acre table, plus contract costs for harvest, post-harvest and assessments. Fuel, lube, repairs and contract field work are left out because you enter your own machines and hired field jobs separately.`,
      'Cost to grow and sell, per acre', operatingCostPerAcre);
  } else if (s.costsPerAcre.operatingTotal) {
    operatingCostPerAcre = s.costsPerAcre.operatingTotal.value;
    cit.operatingCostPerAcre = cite(s, s.costsPerAcre.operatingTotal.page,
      `${s.costsPerAcre.operatingTotal.quote} (This total includes fuel, repairs and machine work, so your own machine hours below would count some of it twice.)`,
      'Total operating costs per acre', operatingCostPerAcre);
  }

  let costMonths: number[] | null = null;
  let revenueMonths: number[] | null = null;
  const m = s.monthly;
  const monthlyOperating = m?.operatingPerAcre;
  if (m && !m.spansTwoYears && monthlyOperating?.length === 12 && m.harvestMonths.length === 12) {
    costMonths = normalize(monthlyOperating.map(x => Math.max(0, x)));
    revenueMonths = normalize(m.harvestMonths.map(h => (h ? 1 : 0)));
    if (costMonths && revenueMonths) cit.months = cite(s, m.page, m.quote, 'Monthly cash costs and harvest months', null);
    else { costMonths = null; revenueMonths = null; }
  }

  return { yieldPerAcre, unit, price, plantingsPerYear, operatingCostPerAcre, costMonths, revenueMonths, citations: cit };
}

/**
 * The study's costs-per-acre rows as crop operations, each cited to its table line. The study's own
 * labor rates and machine labor factor are used to turn its labor dollars back into hours, so the
 * farm can reprice them at its own wages. Anything that cannot be turned into hours stays as dollars.
 */
export function operationsFromStudy(s: ParsedStudy): CropOperation[] {
  const rows = s.costsPerAcre.operations;
  if (!rows || rows.length === 0) return [];
  const machineRate = s.assumptions.laborMachineRate?.value ?? null;
  const handRate = s.assumptions.laborNonMachineRate?.value ?? null;
  const factorItem = (s.method as { machineLaborFactor?: { value: number; page: number; quote: string } | null }).machineLaborFactor ?? null;
  const factor = factorItem?.value ?? 1;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return rows.map((o, i) => {
    const time = o.timeHrsPerAcre ?? 0;
    const labor = o.labor ?? 0;
    const fuelLube = (o.fuel ?? 0) + (o.lubeRepairs ?? 0);
    const isMachine = time > 0 && fuelLube > 0;
    const notes: string[] = [];
    let operatorHours = 0, operatorDollars = 0, handHours = 0, otherLabor = 0;
    if (isMachine) {
      operatorHours = r2(time * factor);
      notes.push(factorItem ? `Operator hours are the machine time times ${factor} (${factorItem.quote})` : 'Operator hours equal the machine time; this study states no machine labor factor');
      if (machineRate != null) {
        operatorDollars = Math.min(labor, operatorHours * machineRate);
        const rest = Math.max(0, labor - operatorDollars);
        if (rest > 0) {
          if (handRate) { handHours = r2(rest / handRate); notes.push(`Remaining labor $${Math.round(rest)} turned into hand hours at the study's $${handRate} per hour`); }
          else { otherLabor = rest; notes.push('Remaining labor kept in dollars; the study states no field labor rate'); }
        }
      } else {
        operatorDollars = labor; notes.push('All labor on this row counted as machine work; the study states no machine labor rate');
      }
    } else if (labor > 0) {
      if (handRate) { handHours = r2(labor / handRate); notes.push(`Hand hours are the labor column divided by the study's $${handRate} per hour`); }
      else { otherLabor = labor; notes.push('Labor kept in dollars; the study states no field labor rate'); }
    }
    const hiredMachine = isMachine ? Math.round(fuelLube + operatorDollars) : 0;
    if (isMachine) notes.push(`If hired out, the starting price $${hiredMachine} is the study's fuel, lube, repairs and operator labor for this row, not a custom rate; a custom operator also charges for owning the machine, so enter the quote you get`);
    const citation = cite(s, o.page, `${o.quote}${notes.length ? ' (' + notes.join('. ') + '.)' : ''}`, 'Costs per acre table row', o.totalCost ?? null);
    return {
      id: `op-${i}`, name: o.name, category: o.category, enabled: true,
      machineHoursPerAcre: isMachine ? time : 0, operatorHoursPerAcre: operatorHours, equipmentId: null,
      hiredMachinePerAcre: hiredMachine, handHoursPerAcre: handHours, otherLaborPerAcre: Math.round(otherLabor),
      materialsPerAcre: o.materials ?? 0, customPerAcre: o.customRent ?? 0, source: 'study', citation,
    };
  });
}

// ---------- equipment ----------

export interface CatalogRow {
  studyId: string;
  row: EquipmentRow;
  hourly: HourlyEquipmentRow | null;
  kind: 'equipment' | 'investment';
}

export interface CatalogEntry {
  key: string;            // normalized description
  name: string;           // description as printed in the newest study
  count: number;          // how many studies list it
  newest: CatalogRow;     // the row the form is seeded from
  rows: CatalogRow[];
}

/** Lowercase, drop years and duplicate markers, unify spacing. Sizes and horsepower stay, they change the price. */
export function normalizeDescription(d: string): string {
  return d.toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\bpickup truck\b/g, 'pickup')
    .replace(/\b1\/2 t\b/g, '1/2 ton')
    .replace(/\b3\/4 t\b/g, '3/4 ton')
    .replace(/[^a-z0-9/'"." ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let catalogCache: CatalogEntry[] | null = null;

/** Every machine and investment row across all studies, grouped by description. */
export function equipmentCatalog(): CatalogEntry[] {
  if (catalogCache) return catalogCache;
  const groups = new Map<string, CatalogRow[]>();
  for (const s of STUDIES) {
    const add = (row: EquipmentRow, kind: CatalogRow['kind']) => {
      const key = normalizeDescription(row.description);
      if (!key || key === 'land' || /establishment/.test(key)) return; // land and orchard establishment are not machines
      const hourly = s.hourlyEquipment.find(h => normalizeDescription(h.description) === key) ?? null;
      const list = groups.get(key) ?? [];
      list.push({ studyId: s.source.id, row, hourly, kind });
      groups.set(key, list);
    };
    s.equipment.forEach(r => add(r, 'equipment'));
    s.investments.forEach(r => add(r, 'investment'));
  }
  const year = (r: CatalogRow) => studyById(r.studyId)?.source.year ?? 0;
  catalogCache = [...groups.entries()].map(([key, rows]) => {
    const sorted = [...rows].sort((a, b) => year(b) - year(a));
    const studies = new Set(rows.map(r => r.studyId));
    return { key, name: sorted[0].row.description, count: studies.size, newest: sorted[0], rows: sorted };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return catalogCache;
}

export interface EquipmentDefaults {
  name: string;
  typeId: string;
  pricePaid: number;
  keepYears: number;
  salvageValue: number;
  fuelLubePerHour: number | null;
  repairsPerHour: number | null;
  citations: { pricePaid: Citation; keepYears: Citation; salvageValue: Citation; fuelLubePerHour?: Citation; repairsPerHour?: Citation };
}

/** Seed values for one machine from one study row, each cited to its table line. */
export function equipmentDefaultsFromRow(entry: CatalogEntry, pick: CatalogRow = entry.newest): EquipmentDefaults {
  const s = studyById(pick.studyId);
  if (!s) throw new Error(`unknown study ${pick.studyId}`);
  const r = pick.row;
  const year = s.source.year ? ` in ${s.source.year}` : '';
  const line = `${r.line} (price the study assumed for a new machine${year})`;
  const citations: EquipmentDefaults['citations'] = {
    pricePaid: cite(s, r.page, line, 'Purchase price, whole farm equipment table', r.price),
    keepYears: cite(s, r.page, r.line, 'Years of life, whole farm equipment table', r.yearsLife),
    salvageValue: cite(s, r.page, r.line, 'Salvage value, whole farm equipment table', r.salvageValue),
  };
  let fuelLubePerHour: number | null = null;
  let repairsPerHour: number | null = null;
  if (pick.hourly) {
    const h = pick.hourly;
    // The parser folds lube into fuelPerHr (fuel plus lube column).
    fuelLubePerHour = Math.round(h.fuelPerHr * 100) / 100;
    repairsPerHour = Math.round(h.repairsPerHr * 100) / 100;
    citations.fuelLubePerHour = cite(s, h.page, `${h.line} (fuel plus lube per hour)`, 'Fuel and lube per hour, hourly equipment table', fuelLubePerHour);
    citations.repairsPerHour = cite(s, h.page, `${h.line} (repairs per hour)`, 'Repairs per hour, hourly equipment table', repairsPerHour);
  }
  return { name: r.description, typeId: entry.key, pricePaid: r.price, keepYears: r.yearsLife, salvageValue: r.salvageValue, fuelLubePerHour, repairsPerHour, citations };
}

// ---------- method ----------

export interface MethodItem { key: 'capitalRecovery' | 'salvage' | 'insurance' | 'propertyTax' | 'interest' | 'allocation'; quote: string; page: number; citation: Citation }

/** The formulas the engine uses, quoted from the 2015 organic spinach study, the reference study for this tool. */
export function methodFromStudies(): MethodItem[] {
  const s = studyById('spinach-2015-organicspinach-finaldraftjan29') ?? STUDIES.find(x => x.method.capitalRecoveryFormula);
  if (!s) return [];
  const out: MethodItem[] = [];
  const m = s.method;
  if (m.capitalRecoveryFormula) out.push({ key: 'capitalRecovery', quote: m.capitalRecoveryFormula.quote, page: m.capitalRecoveryFormula.page, citation: cite(s, m.capitalRecoveryFormula.page, m.capitalRecoveryFormula.quote, 'Capital recovery formula', null) });
  if (m.salvageMethod) out.push({ key: 'salvage', quote: m.salvageMethod.quote, page: m.salvageMethod.page, citation: cite(s, m.salvageMethod.page, m.salvageMethod.quote, 'Salvage value', null) });
  if (m.insuranceRatePct) out.push({ key: 'insurance', quote: m.insuranceRatePct.quote, page: m.insuranceRatePct.page, citation: citeCited(s, m.insuranceRatePct, 'Property insurance rate') });
  if (m.propertyTaxRatePct) out.push({ key: 'propertyTax', quote: m.propertyTaxRatePct.quote, page: m.propertyTaxRatePct.page, citation: citeCited(s, m.propertyTaxRatePct, 'Property tax rate') });
  if (s.assumptions.interestRatePct) out.push({ key: 'interest', quote: s.assumptions.interestRatePct.quote, page: s.assumptions.interestRatePct.page, citation: citeCited(s, s.assumptions.interestRatePct, 'Interest rate for capital recovery') });
  if (s.assumptions.cropsPerAcrePerYear) out.push({ key: 'allocation', quote: s.assumptions.cropsPerAcrePerYear.quote, page: s.assumptions.cropsPerAcrePerYear.page, citation: citeCited(s, s.assumptions.cropsPerAcrePerYear, 'How overhead is shared between crops') });
  return out;
}
