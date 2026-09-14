import type { CatalogEntry, CatalogRow, MethodItem } from '../data/studies';
import { cropDefaultsFromStudy, equipmentDefaultsFromRow, methodFromStudies, commodityName } from '../data/studies';
import type { ParsedStudy } from '../data/studySchema';
import type { Citation, Condition, Crop, CropResult, Equipment, Farm, FarmResult, MachineResult, OwnershipBreakdown, Plan } from './types';
import { uid } from './store';
import { isMonthlyProfile } from './inputs';

const SQFT_PER_ACRE = 43560;
// Both rates are quoted from the UC Davis cost study method; see METHOD below and the Sources screen.
const INSURANCE_RATE = 0.00843; // property insurance on average value
const PROPERTY_TAX_RATE = 0.01; // county property tax on average value

/** Every formula the engine uses, with the study sentence it comes from. */
export const METHOD: MethodItem[] = methodFromStudies();

/** Capital recovery factor: the annual payment that repays 1 dollar over `years` at `rate`. */
export function crf(rate: number, years: number): number {
  if (years <= 0) return 1;
  if (rate === 0) return 1 / years;
  return rate / (1 - Math.pow(1 + rate, -years));
}

/** Annual cost of owning one machine, using the UC Davis capital recovery method. */
export function ownership(e: Equipment, rate: number): OwnershipBreakdown {
  const salvage = Math.min(e.salvageValue, e.pricePaid);
  const capitalRecovery = (e.pricePaid - salvage) * crf(rate, e.keepYears);
  const interestOnSalvage = salvage * rate;
  const averageValue = (e.pricePaid + salvage) / 2;
  const insuranceAndTax = averageValue * (INSURANCE_RATE + PROPERTY_TAX_RATE);
  const totalPerYear = capitalRecovery + interestOnSalvage + insuranceAndTax;
  const ownPerHour = e.hoursPerYear > 0 ? totalPerYear / e.hoursPerYear : 0;
  const runPerHour = e.operatingCostPerHour;
  return { capitalRecovery, interestOnSalvage, insuranceAndTax, totalPerYear, ownPerHour, runPerHour, allInPerHour: ownPerHour + runPerHour };
}

/** Convert the farmer's land unit to acres. */
export function toAcres(area: number, farm: Farm): number {
  switch (farm.areaUnit) {
    case 'acres': return area;
    case 'beds': return (area * farm.bedLengthFt * (farm.bedWidthIn / 12)) / SQFT_PER_ACRE;
    case 'rows100ft': return (area * 100 * (30 / 12)) / SQFT_PER_ACRE;
  }
}

const zeros = (): number[] => Array.from({ length: 12 }, () => 0);

export function computePlan(plan: Plan): FarmResult {
  // Incomplete drafts use zero placeholders; malformed nonfinite values must not poison totals.
  const finiteFields = <T extends object>(item: T): T => Object.fromEntries(Object.entries(item).map(([key, value]) =>
    [key, typeof value === 'number' && !Number.isFinite(value) ? 0 : value])) as T;
  const farm = finiteFields(plan.farm);
  const crops = plan.crops.map(c => ({ ...finiteFields(c), machineHours: (c.machineHours ?? []).map(finiteFields), customHire: (c.customHire ?? []).map(finiteFields) }));
  const equipment = plan.equipment.map(finiteFields);
  const acresByCrop = crops.map((c) => toAcres(c.area, farm));
  const totalAcres = acresByCrop.reduce((a, b) => a + b, 0);
  const share = (acres: number) => (totalAcres > 0 ? acres / totalAcres : 0);

  const overhead = farm.landRentPerAcre * totalAcres + farm.otherOverheadPerYear;

  // Hours each crop puts on each machine in a year: hoursPerAcre x acres x plantings.
  const hoursOn = (c: Crop, i: number, equipmentId: string) =>
    (c.machineHours ?? []).filter((m) => m.equipmentId === equipmentId).reduce((s, m) => s + m.hoursPerAcre, 0) * acresByCrop[i] * c.plantingsPerYear;

  // Ownership cost is shared by the hours each crop uses. A machine no crop has claimed hours on
  // is shared by acres instead, so its cost is never dropped.
  const machines: MachineResult[] = equipment.map((e) => {
    const o = ownership(e, farm.interestRate);
    const hours = crops.map((c, i) => hoursOn(c, i, e.id));
    const hoursAssigned = hours.reduce((a, b) => a + b, 0);
    const byCrop = crops.map((c, i) => ({
      cropId: c.id, name: c.name, hours: hours[i],
      share: hoursAssigned > 0 ? hours[i] / hoursAssigned : share(acresByCrop[i]),
    }));
    return {
      equipmentId: e.id, name: e.name, hoursPerYear: e.hoursPerYear, hoursAssigned,
      ownPerYear: o.totalPerYear, ownPerHour: o.ownPerHour, runPerHour: o.runPerHour, allInPerHour: o.allInPerHour, byCrop,
    };
  });
  const equipmentOwnership = machines.reduce((s, m) => s + m.ownPerYear, 0);

  const monthlyCash = zeros();
  let ownLaborPaid = 0;
  let withMonths = 0;

  const cropResults: CropResult[] = crops.map((c, i) => {
    const acres = acresByCrop[i];
    const seasons = acres * c.plantingsPerYear; // acre-plantings in the year
    const units = seasons * c.yieldPerAcre;
    const revenue = units * c.price;
    const ownLabor = seasons * c.ownLaborHoursPerAcre * farm.ownLaborRate;
    ownLaborPaid += ownLabor;
    const machineRunning = machines.reduce((s, m) => s + m.byCrop[i].hours * m.runPerHour, 0);
    const customHire = (c.customHire ?? []).reduce((s, h) => s + h.costPerAcre, 0) * seasons;
    const operating = seasons * c.operatingCostPerAcre + ownLabor + machineRunning + customHire;
    const overheadShare = overhead * share(acres);
    const equipmentShare = machines.reduce((s, m) => s + m.ownPerYear * m.byCrop[i].share, 0);
    const totalCost = operating + overheadShare + equipmentShare;
    const net = revenue - totalCost;
    const contribution = revenue - operating;
    const breakEvenPrice = units > 0 ? totalCost / units : 0;
    const perAcreDenominator = c.price * seasons;
    const breakEvenYieldPerAcre = perAcreDenominator > 0 ? totalCost / perAcreDenominator : 0;

    // Cash timing comes from the farmer or a study; require valid profiles for both costs and sales.
    const hasMonths = isMonthlyProfile(c.costMonths) && isMonthlyProfile(c.revenueMonths);
    if (hasMonths) {
      withMonths++;
      for (let m = 0; m < 12; m++) {
        monthlyCash[m] += revenue * c.revenueMonths![m] - operating * c.costMonths![m];
      }
    }

    return { cropId: c.id, name: c.name, acres, units, revenue, operating, machineRunning, customHire, overheadShare, equipmentShare, totalCost, net, contribution, breakEvenPrice, breakEvenYieldPerAcre, hasMonths };
  });

  // Overhead goes out evenly through the year, but only the share of the crops in the cash view,
  // so the chart is not charged for crops it cannot show.
  const acresWithMonths = cropResults.reduce((s, r) => s + (r.hasMonths ? r.acres : 0), 0);
  const overheadInView = overhead * share(acresWithMonths);
  if (withMonths > 0) for (let m = 0; m < 12; m++) monthlyCash[m] -= overheadInView / 12;

  let cumulative = 0;
  let lowest = { month: 0, cumulative: 0 };
  for (let m = 0; m < 12; m++) {
    cumulative += monthlyCash[m];
    if (m === 0 || cumulative < lowest.cumulative) lowest = { month: m, cumulative };
  }

  const revenue = cropResults.reduce((s, r) => s + r.revenue, 0);
  const totalCost = cropResults.reduce((s, r) => s + r.totalCost, 0);

  return {
    totalAcres, revenue, totalCost, net: revenue - totalCost, overhead, equipmentOwnership, ownLaborPaid,
    crops: cropResults, machines, monthlyCash, lowestCashPoint: lowest,
    cashCoverage: { withMonths, total: crops.length },
  };
}

/** True while a value still equals the number its citation gave. Once the farmer edits it, the tag flips to "your number". */
export function isCited(value: number, citation: Citation | undefined): boolean {
  return Boolean(citation && citation.value !== null && Math.abs(value - citation.value) < 1e-9);
}

/** Start a crop from a UC study. Every number the study gives is cited; anything it does not give starts at 0. */
export function newCropFromStudy(s: ParsedStudy, area: number, id: string = uid()): Crop {
  const d = cropDefaultsFromStudy(s);
  return {
    id, typeId: s.source.commodity, studyId: s.source.id, name: commodityName(s.source.commodity), area,
    plantingsPerYear: d.plantingsPerYear ?? 0,
    yieldPerAcre: d.yieldPerAcre ?? 0, unit: d.unit, price: d.price ?? 0, channel: 'market',
    operatingCostPerAcre: d.operatingCostPerAcre ?? 0, ownLaborHoursPerAcre: 0,
    machineHours: [], customHire: [],
    costMonths: d.costMonths, revenueMonths: d.revenueMonths,
    citations: d.citations,
    missingFields: [
      ...(area > 0 ? [] : ['area' as const]),
      ...(d.plantingsPerYear == null ? ['plantingsPerYear' as const] : []),
      ...(d.yieldPerAcre == null ? ['yieldPerAcre' as const] : []),
      ...(d.price == null ? ['price' as const] : []),
      ...(d.operatingCostPerAcre == null ? ['operatingCostPerAcre' as const] : []),
    ],
  };
}

/** Start an equipment entry from a study's equipment table row. The farmer then types what they actually paid. */
export function newEquipmentFromCatalog(entry: CatalogEntry, condition: Condition, id: string = uid(), pick?: CatalogRow): Equipment {
  const d = equipmentDefaultsFromRow(entry, pick);
  return {
    id, typeId: d.typeId, name: d.name, condition,
    pricePaid: d.pricePaid, yearBought: new Date().getFullYear(), keepYears: d.keepYears,
    hoursPerYear: 0,
    salvageValue: d.salvageValue,
    operatingCostPerHour: d.operatingCostPerHour ?? 0,
    citations: d.citations,
    missingFields: d.operatingCostPerHour == null ? ['operatingCostPerHour'] : [],
  };
}

/**
 * When the farmer changes the price and the salvage value was still the study's, keep the study's
 * salvage-to-price ratio so the resale value stays proportional, and say so in the citation.
 */
export function withPricePaid(e: Equipment, pricePaid: number): Equipment {
  const c = e.citations.salvageValue;
  if (!isCited(e.salvageValue, c) || !e.citations.pricePaid || !e.citations.pricePaid.value) {
    return { ...e, pricePaid };
  }
  const ratio = (c!.value as number) / e.citations.pricePaid.value;
  const salvageValue = Math.round(pricePaid * ratio);
  const salvageCitation: Citation = {
    ...c!, value: salvageValue,
    quote: `${c!.quote} (Your price times the study's salvage-to-price ratio of ${Math.round(ratio * 100)} percent.)`,
    field: 'Salvage value, scaled to your price from the study row',
  };
  return { ...e, pricePaid, salvageValue, citations: { ...e.citations, salvageValue: salvageCitation } };
}

/** A farmer-entered draft: no study numbers are assumed. */
export function newBlankCrop(id: string = uid()): Crop {
  return { id, typeId: 'custom', studyId: null, name: '', area: 0, plantingsPerYear: 0,
    yieldPerAcre: 0, unit: 'unit', price: 0, channel: 'market', operatingCostPerAcre: 0,
    ownLaborHoursPerAcre: 0, machineHours: [], customHire: [], costMonths: null, revenueMonths: null,
    citations: {}, missingFields: ['area', 'plantingsPerYear', 'yieldPerAcre', 'price', 'operatingCostPerAcre'] };
}

export function newBlankEquipment(id: string = uid()): Equipment {
  return { id, typeId: 'custom', name: '', condition: 'used', pricePaid: 0,
    yearBought: 0, keepYears: 0, hoursPerYear: 0, salvageValue: 0,
    operatingCostPerHour: 0, citations: {}, missingFields: ['pricePaid', 'keepYears', 'salvageValue', 'operatingCostPerHour', 'hoursPerYear', 'yearBought'] };
}
