import type { CatalogEntry, CatalogRow, MethodItem } from '../data/studies';
import { cropDefaultsFromStudy, equipmentDefaultsFromRow, methodFromStudies, commodityName, operationsFromStudy } from '../data/studies';
import type { ParsedStudy } from '../data/studySchema';
import type { AllocationBasis, Citation, Condition, Crop, CropOperation, CustomWorkResult, MachineRates, MachineUse, CropResult, Equipment, Farm, FarmResult, MachineResult, OwnershipBreakdown, Plan } from './types';
import { uid } from './store';
import { isMonthlyProfile } from './inputs';

const SQFT_PER_ACRE = 43560;
// Both rates are quoted from the UC Davis cost study method; see METHOD below and the Sources screen.
export { STUDY_INSURANCE_RATE, STUDY_PROPERTY_TAX_RATE } from './rates';

export type OwnershipRates = { interestRate: number; insuranceRate: number; propertyTaxRate: number };

/** Every formula the engine uses, with the study sentence it comes from. */
export const METHOD: MethodItem[] = methodFromStudies();

/** Capital recovery factor: the annual payment that repays 1 dollar over `years` at `rate`. */
export function crf(rate: number, years: number): number {
  if (years <= 0) return 1;
  if (rate === 0) return 1 / years;
  return rate / (1 - Math.pow(1 + rate, -years));
}

/** Annual cost of owning one machine, using the UC Davis capital recovery method. these should be documented in the sources */
export function ownership(e: Equipment, rates: OwnershipRates): OwnershipBreakdown {
  const rate = rates.interestRate;
  const salvage = Math.min(e.salvageValue, e.pricePaid);
  const capitalRecovery = (e.pricePaid - salvage) * crf(rate, e.keepYears);
  const interestOnSalvage = salvage * rate;
  const averageValue = (e.pricePaid + salvage) / 2;
  const insurance = averageValue * rates.insuranceRate;
  const taxes = averageValue * rates.propertyTaxRate;
  const insuranceAndTax = insurance + taxes;
  const totalPerYear = capitalRecovery + interestOnSalvage + insuranceAndTax;
  const repairsPerYear = e.pricePaid * (e.repairsPctPerYear || 0);
  return { capitalRecovery, interestOnSalvage, insurance, taxes, insuranceAndTax, totalPerYear, repairsPerYear };
}

/** Per-hour rates at a given number of hours a year. Owning and repairs are yearly amounts spread over the hours the machine actually runs. */
export function machineRates(e: Equipment, rates: OwnershipRates, hoursPerYear: number): MachineRates {
  const o = ownership(e, rates);
  const h = hoursPerYear > 0 ? hoursPerYear : 0;
  const ownPerHour = h > 0 ? o.totalPerYear / h : 0;
  const repairsPerHour = h > 0 ? o.repairsPerYear / h : 0;
  const fuelLubePerHour = e.fuelLubePerHour || 0;
  const runPerHour = fuelLubePerHour + repairsPerHour;
  return { hoursPerYear: h, ownPerHour, fuelLubePerHour, repairsPerHour, runPerHour, allInPerHour: ownPerHour + runPerHour };
}

/** Hours every machine runs in a year: each crop's own-machine operations plus custom work for others. */
export function machineHoursInPlan(plan: Plan): Map<string, { crop: number; custom: number }> {
  const out = new Map<string, { crop: number; custom: number }>();
  const bump = (id: string, key: 'crop' | 'custom', h: number) => { const cur = out.get(id) ?? { crop: 0, custom: 0 }; cur[key] += h; out.set(id, cur); };
  for (const c of plan.crops) {
    const seasons = toAcres(c.area, plan.farm) * c.plantingsPerYear;
    const uses = usesOperations(c) ? machineHoursFromOperations(c.operations) : (c.machineHours ?? []);
    for (const u of uses) bump(u.equipmentId, 'crop', u.hoursPerAcre * seasons);
  }
  for (const j of plan.customWork ?? []) bump(j.equipmentId, 'custom', j.hoursPerYear || 0);
  return out;
}

/** Rates for every machine in the plan at the hours it runs. Screens use this for live figures. */
export function machineRatesInPlan(plan: Plan): Map<string, MachineRates> {
  const hours = machineHoursInPlan(plan);
  return new Map(plan.equipment.map(e => { const h = hours.get(e.id); return [e.id, machineRates(e, plan.farm, (h?.crop ?? 0) + (h?.custom ?? 0))]; }));
}

/** Convert the farmer's land unit to acres. */
export function toAcres(area: number, farm: Farm): number {
  switch (farm.areaUnit) {
    case 'acres': return area;
    case 'beds': return (area * farm.bedLengthFt * (farm.bedWidthIn / 12)) / SQFT_PER_ACRE;
    case 'rows100ft': return (area * 100 * (farm.bedWidthIn / 12)) / SQFT_PER_ACRE;
  }
}

const zeros = (): number[] => Array.from({ length: 12 }, () => 0);

/** Hired labor cost per hour, wages plus payroll overhead. */
export const hiredHourly = (farm: Pick<Farm, 'hiredLaborRate' | 'payrollOverhead'>) => farm.hiredLaborRate * (1 + (farm.payrollOverhead || 0));

export interface OperationCost { id: string; name: string; category: CropOperation['category']; perAcre: number; assigned: string | null; mode: CropOperation['mode']; parts: { materials: number; handLabor: number; operatorLabor: number; machineRunning: number; rent: number; hiredMachine: number; custom: number; otherLabor: number } }

/**
 * Cost of one operation per acre, one planting. `rates` gives each owned machine's run rate at its
 * hours for the year (see machineRatesInPlan). Ownership is not in here; computePlan shares it by hours.
 */
export function operationCost(op: CropOperation, farm: Farm, equipment: Equipment[], rates?: Map<string, MachineRates>): OperationCost {
  const mode = op.mode ?? (op.equipmentId ? 'own' : 'hire');
  const machine = mode === 'own' && op.equipmentId ? equipment.find(e => e.id === op.equipmentId) ?? null : null;
  const hourly = hiredHourly(farm);
  const hours = op.machineHoursPerAcre || 0;
  const runRate = machine ? (rates?.get(machine.id)?.runPerHour ?? (machine.fuelLubePerHour || 0)) : 0;
  const parts = {
    materials: op.materialsPerAcre || 0,
    custom: op.customPerAcre || 0,
    otherLabor: op.otherLaborPerAcre || 0,
    handLabor: (op.handHoursPerAcre || 0) * hourly,
    operatorLabor: mode !== 'hire' && hours > 0 ? (op.operatorHoursPerAcre || 0) * hourly : 0,
    machineRunning: machine ? hours * runRate : 0,
    rent: mode === 'rent' ? hours * (op.rentPerHour || 0) : 0,
    hiredMachine: mode === 'hire' && hours > 0 ? (op.hiredMachinePerAcre || 0) : 0,
  };
  const perAcre = Object.values(parts).reduce((a, b) => a + b, 0);
  return { id: op.id, name: op.name, category: op.category, perAcre, assigned: machine ? machine.id : null, mode, parts };
}

/** Owned machine hours per acre implied by a crop's operations, grouped by machine. */
export function machineHoursFromOperations(ops: CropOperation[]): MachineUse[] {
  const acc = new Map<string, number>();
  for (const op of ops) if (op.enabled && (op.mode ?? (op.equipmentId ? 'own' : 'hire')) === 'own' && op.equipmentId && op.machineHoursPerAcre > 0) acc.set(op.equipmentId, (acc.get(op.equipmentId) ?? 0) + op.machineHoursPerAcre);
  return [...acc].map(([equipmentId, hoursPerAcre]) => ({ equipmentId, hoursPerAcre }));
}

export const usesOperations = (c: Pick<Crop, 'operations'>) => (c.operations?.length ?? 0) > 0;

export function computePlan(plan: Plan): FarmResult {
  // Incomplete drafts use zero placeholders; malformed nonfinite values must not poison totals.
  const finiteFields = <T extends object>(item: T): T => Object.fromEntries(Object.entries(item).map(([key, value]) =>
    [key, typeof value === 'number' && !Number.isFinite(value) ? 0 : value])) as T;
  const farm = finiteFields(plan.farm);
  const equipment = plan.equipment.map(finiteFields);
  const crops = plan.crops.map(c => {
    const operations = (c.operations ?? []).map(finiteFields);
    const fromOps = operations.length > 0;
    return { ...finiteFields(c), operations, customHire: (c.customHire ?? []).map(finiteFields),
      // Machines with hours come from the operations when the crop has them, else from the typed list.
      machineHours: fromOps ? machineHoursFromOperations(operations) : (c.machineHours ?? []).map(finiteFields) };
  });
  const acresByCrop = crops.map((c) => toAcres(c.area, farm));
  const totalAcres = acresByCrop.reduce((a, b) => a + b, 0);

  // Revenue per crop is needed before costs so it can be an allocation basis.
  const seasonsByCrop = crops.map((c, i) => acresByCrop[i] * c.plantingsPerYear);
  const revenueByCrop = crops.map((c, i) => seasonsByCrop[i] * c.yieldPerAcre * c.price);
  const totalRevenue = revenueByCrop.reduce((a, b) => a + b, 0);
  const shareBy = (basis: AllocationBasis, i: number) => {
    if (basis === 'revenue' && totalRevenue > 0) return revenueByCrop[i] / totalRevenue;
    return totalAcres > 0 ? acresByCrop[i] / totalAcres : 0;
  };

  // Whole-farm costs: land rent (by acres, since it is priced per acre) then each overhead item on its own basis.
  const landRent = farm.landRentPerAcre * totalAcres;
  const overheadItems = farm.overheadItems ?? [];
  const overhead = landRent + overheadItems.reduce((s, o) => s + o.amountPerYear, 0);

  // Hours each crop puts on each machine in a year: hoursPerAcre x acres x plantings.
  const hoursOn = (c: Crop, i: number, equipmentId: string) =>
    (c.machineHours ?? []).filter((m) => m.equipmentId === equipmentId).reduce((s, m) => s + m.hoursPerAcre, 0) * seasonsByCrop[i];
  const customWork = (plan.customWork ?? []).map(finiteFields);

  // A machine's year is the crop hours plus custom work hours. Ownership and the yearly repair pool
  // are shared by those hours; when no one lists hours, crops share them by the farm's fallback basis.
  const fallbackBasis: AllocationBasis = farm.equipmentBasis === 'revenue' ? 'revenue' : 'acres';
  const ownershipByMachine = equipment.map(e => ownership(e, farm));
  const machines: MachineResult[] = equipment.map((e, k) => {
    const o = ownershipByMachine[k];
    const hours = crops.map((c, i) => hoursOn(c, i, e.id));
    const cropHours = hours.reduce((a, b) => a + b, 0);
    const customHours = customWork.filter(j => j.equipmentId === e.id).reduce((s, j) => s + (j.hoursPerYear || 0), 0);
    const total = cropHours + customHours;
    const byHours = farm.equipmentBasis === 'hours' && total > 0;
    const byCrop = crops.map((c, i) => ({ cropId: c.id, name: c.name, hours: hours[i], share: byHours ? hours[i] / total : (customHours > 0 && total > 0 ? shareBy(fallbackBasis, i) * (cropHours / total) : shareBy(fallbackBasis, i)) }));
    const customShare = total > 0 ? customHours / total : 0;
    const r = machineRates(e, farm, total);
    return { equipmentId: e.id, name: e.name, hoursPerYear: total, cropHours, customHours, ownPerYear: o.totalPerYear, repairsPerYear: o.repairsPerYear,
      ownPerHour: r.ownPerHour, fuelLubePerHour: r.fuelLubePerHour, repairsPerHour: r.repairsPerHour, runPerHour: r.runPerHour, allInPerHour: r.allInPerHour, byCrop, customShare };
  });
  const ratesById = new Map(machines.map(m => [m.equipmentId, { hoursPerYear: m.hoursPerYear, ownPerHour: m.ownPerHour, fuelLubePerHour: m.fuelLubePerHour, repairsPerHour: m.repairsPerHour, runPerHour: m.runPerHour, allInPerHour: m.allInPerHour } as MachineRates]));
  const equipmentOwnership = machines.reduce((s, m) => s + m.ownPerYear, 0);

  // Custom work for others: income minus fuel, the hours' share of repairs and ownership, and the farmer's time.
  const customJobs = customWork.map(j => {
    const m = machines.find(x => x.equipmentId === j.equipmentId);
    const hours = j.hoursPerYear || 0;
    const fuelLube = m ? hours * m.fuelLubePerHour : 0;
    const repairs = m ? hours * m.repairsPerHour : 0;
    const ownershipCost = m && m.hoursPerYear > 0 ? m.ownPerYear * (hours / m.hoursPerYear) : 0;
    const operatorLabor = hours * (farm.ownLaborRate || 0);
    const cost = fuelLube + repairs + ownershipCost + operatorLabor;
    return { id: j.id, name: j.name, equipmentId: j.equipmentId, machineName: m?.name ?? '', hours, income: j.incomePerYear || 0, cost, net: (j.incomePerYear || 0) - cost, fuelLube, repairs, ownershipCost, operatorLabor };
  });
  const customResult: CustomWorkResult = {
    income: customJobs.reduce((s, j) => s + j.income, 0), fuelLube: customJobs.reduce((s, j) => s + j.fuelLube, 0), repairs: customJobs.reduce((s, j) => s + j.repairs, 0),
    operatorLabor: customJobs.reduce((s, j) => s + j.operatorLabor, 0), ownership: customJobs.reduce((s, j) => s + j.ownershipCost, 0),
    cost: customJobs.reduce((s, j) => s + j.cost, 0), net: customJobs.reduce((s, j) => s + j.net, 0),
    jobs: customJobs.map(({ id, name, equipmentId, machineName, hours, income, cost, net }) => ({ id, name, equipmentId, machineName, hours, income, cost, net })),
  };

  const monthlyCash = zeros();
  const monthlyOverhead = zeros();
  let ownLaborPaid = 0;
  let withMonths = 0;

  const cropResults: CropResult[] = crops.map((c, i) => {
    const acres = acresByCrop[i];
    const seasons = seasonsByCrop[i];
    const units = seasons * c.yieldPerAcre;
    const revenue = revenueByCrop[i];
    const ownLabor = seasons * c.ownLaborHoursPerAcre * farm.ownLaborRate;
    ownLaborPaid += ownLabor;
    const machineRows = machines.map((m, k) => {
      const o = ownershipByMachine[k];
      const share = m.byCrop[i].share;
      const hours = m.byCrop[i].hours;
      // Repairs are a yearly pool; a machine with hours pays by hours, one without shares the pool like ownership.
      const fuelLube = hours * m.fuelLubePerHour;
      const repairs = m.hoursPerYear > 0 ? hours * m.repairsPerHour : o.repairsPerYear * share;
      return { equipmentId: m.equipmentId, name: m.name, share, hours, ownership: o.totalPerYear * share,
        capitalRecovery: o.capitalRecovery * share, interestOnSalvage: o.interestOnSalvage * share, insurance: o.insurance * share, taxes: o.taxes * share,
        running: fuelLube + repairs, fuelLube, repairs };
    });
    const hiredJobs = (c.customHire ?? []).reduce((s, h) => s + h.costPerAcre, 0) * seasons;
    const fromOps = usesOperations(c);
    const opCosts = fromOps ? c.operations.filter(o => o.enabled).map(o => operationCost(o, farm, equipment, ratesById)) : [];
    const sumPart = (k: keyof OperationCost['parts']) => opCosts.reduce((s, o) => s + o.parts[k], 0) * seasons;
    const costParts = {
      materials: sumPart('materials'), handLabor: sumPart('handLabor'), operatorLabor: sumPart('operatorLabor'),
      machineRunning: machineRows.reduce((s, r) => s + r.running, 0),
      rent: sumPart('rent'), hiredMachine: sumPart('hiredMachine'), custom: sumPart('custom'), otherLabor: sumPart('otherLabor'),
      ownLabor, hiredJobs, lump: fromOps ? 0 : seasons * c.operatingCostPerAcre,
    };
    const machineRunning = costParts.machineRunning;
    const customHire = hiredJobs + costParts.hiredMachine + costParts.custom;
    const operatingBeforeInterest = Object.values(costParts).reduce((a, b) => a + b, 0);
    const operationRows = opCosts.map(o => ({ id: o.id, name: o.name, category: o.category, cost: o.perAcre * seasons, assigned: o.assigned }));

    // Cash timing comes from the farmer or a study; require valid profiles for both costs and sales.
    // Interest on operating capital, as the studies charge it: each month's cash spent ahead of sales
    // carries the operating rate for that month. Without month timing there is nothing to charge it on.
    const hasMonths = isMonthlyProfile(c.costMonths) && isMonthlyProfile(c.revenueMonths);
    let monthly: CropResult['monthly'] = null;
    let interest = 0;
    if (hasMonths) {
      withMonths++;
      const monthlyRate = (farm.operatingInterestRate || 0) / 12;
      const revenueByMonth = c.revenueMonths!.map(w => revenue * w);
      const costsByMonth = c.costMonths!.map(w => operatingBeforeInterest * w);
      let balance = 0;
      for (let m = 0; m < 12; m++) {
        balance += costsByMonth[m] - revenueByMonth[m];
        const charge = balance > 0 ? balance * monthlyRate : 0;
        costsByMonth[m] += charge;
        interest += charge;
      }
      monthly = { revenue: revenueByMonth, costs: costsByMonth };
      for (let m = 0; m < 12; m++) monthlyCash[m] += monthly.revenue[m] - monthly.costs[m];
    }
    const costPartsFull = { ...costParts, interest };
    const operating = operatingBeforeInterest + interest;

    const overheadRows = [
      ...(landRent > 0 ? [{ id: 'land-rent', name: 'Land rent', amount: landRent * shareBy('acres', i), basis: 'acres' as AllocationBasis }] : []),
      ...overheadItems.map(o => ({ id: o.id, name: o.name, amount: o.amountPerYear * shareBy(o.basis, i), basis: o.basis })),
    ];
    const overheadShare = overheadRows.reduce((s, r) => s + r.amount, 0);
    const equipmentShare = machineRows.reduce((s, r) => s + r.ownership, 0);
    // A perennial planting is an investment: accumulated establishment cost (plus any removal the
    // farmer adds as a pre-plant cost) recovered over its production years, salvage zero, with the
    // same insurance and tax the studies charge on an investment.
    const est = c.establishment;
    let establishment: CropResult['establishment'] = null;
    if (est && est.productionYears > 0 && (est.accumulatedNetCostPerAcre > 0 || est.removalCostPerAcre > 0)) {
      const price = (est.accumulatedNetCostPerAcre + (est.removalCostPerAcre || 0)) * acres;
      const o = ownership({ pricePaid: price, salvageValue: 0, keepYears: est.productionYears, repairsPctPerYear: 0 } as Equipment, farm);
      establishment = { capitalRecovery: o.capitalRecovery, insurance: o.insurance, taxes: o.taxes, total: o.totalPerYear, perAcre: acres > 0 ? o.totalPerYear / acres : 0 };
    }
    const totalCost = operating + overheadShare + equipmentShare + (establishment?.total ?? 0);
    const net = revenue - totalCost;
    const contribution = revenue - operating;
    const breakEvenPrice = units > 0 ? totalCost / units : 0;
    const perAcreDenominator = c.price * seasons;
    const breakEvenYieldPerAcre = perAcreDenominator > 0 ? totalCost / perAcreDenominator : 0;

    return { cropId: c.id, name: c.name, acres, units, revenue, operating, machineRunning, customHire, overheadShare, equipmentShare, totalCost, net, contribution, breakEvenPrice, breakEvenYieldPerAcre, hasMonths, overheadItems: overheadRows, machines: machineRows, monthly, costParts: costPartsFull, operationRows, establishment };
  });

  // Overhead and equipment ownership go out evenly through the year, but only the share belonging to
  // the crops in the cash view, so the chart is not charged for crops it cannot show.
  const fixedInView = cropResults.reduce((s, r) => s + (r.hasMonths ? r.overheadShare + r.equipmentShare + (r.establishment?.total ?? 0) : 0), 0);
  if (withMonths > 0) for (let m = 0; m < 12; m++) { monthlyOverhead[m] = fixedInView / 12; monthlyCash[m] -= monthlyOverhead[m]; }

  const runningCash = zeros();
  let cumulative = 0;
  let lowest = { month: 0, cumulative: 0 };
  for (let m = 0; m < 12; m++) {
    cumulative += monthlyCash[m];
    runningCash[m] = cumulative;
    if (m === 0 || cumulative < lowest.cumulative) lowest = { month: m, cumulative };
  }

  const revenue = cropResults.reduce((s, r) => s + r.revenue, 0);
  const totalCost = cropResults.reduce((s, r) => s + r.totalCost, 0);

  return {
    totalAcres, revenue, totalCost, net: revenue - totalCost + customResult.net, overhead, equipmentOwnership, ownLaborPaid,
    crops: cropResults, machines, customWork: customResult, monthlyCash, monthlyOverhead, runningCash, lowestCashPoint: lowest,
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
    plantingsPerYear: d.plantingsPerYear ?? 1, // a study's costs-per-acre table covers one crop year unless it says otherwise
    yieldPerAcre: d.yieldPerAcre ?? 0, unit: d.unit, price: d.price ?? 0, channel: 'market',
    operatingCostPerAcre: d.operatingCostPerAcre ?? 0, ownLaborHoursPerAcre: 0,
    machineHours: [], customHire: [],
    operations: operationsFromStudy(s),
    establishment: d.establishment,
    costMonths: d.costMonths, revenueMonths: d.revenueMonths,
    citations: d.citations,
    missingFields: [
      ...(area > 0 ? [] : ['area' as const]),
      ...(d.yieldPerAcre == null ? ['yieldPerAcre' as const] : []),
      ...(d.price == null ? ['price' as const] : []),
      ...(d.operatingCostPerAcre == null && s.costsPerAcre.operations.length === 0 ? ['operatingCostPerAcre' as const] : []),
    ],
  };
}

/** Start an equipment entry from a study's equipment table row. The farmer then types what they actually paid. */
export function newEquipmentFromCatalog(entry: CatalogEntry, condition: Condition, id: string = uid(), pick?: CatalogRow): Equipment {
  const d = equipmentDefaultsFromRow(entry, pick);
  return {
    id, typeId: d.typeId, name: d.name, condition,
    pricePaid: d.pricePaid, yearBought: new Date().getFullYear(), keepYears: d.keepYears,
    salvageValue: d.salvageValue,
    fuelLubePerHour: d.fuelLubePerHour ?? 0,
    repairsPctPerYear: d.repairsPctPerYear ?? 0,
    citations: d.citations,
    missingFields: [...(d.fuelLubePerHour == null ? ['fuelLubePerHour' as const] : []), ...(d.repairsPctPerYear == null ? ['repairsPctPerYear' as const] : [])],
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
    ownLaborHoursPerAcre: 0, machineHours: [], customHire: [], operations: [], costMonths: null, revenueMonths: null,
    citations: {}, missingFields: ['area', 'plantingsPerYear', 'yieldPerAcre', 'price', 'operatingCostPerAcre'] };
}

/** A farmer-written operation with nothing filled in. */
export function newBlankOperation(id: string = uid()): CropOperation {
  return { id, name: '', category: 'cultural', enabled: true, machineHoursPerAcre: 0, operatorHoursPerAcre: 0, mode: 'hire', equipmentId: null, rentPerHour: 0,
    hiredMachinePerAcre: 0, handHoursPerAcre: 0, otherLaborPerAcre: 0, materialsPerAcre: 0, customPerAcre: 0, source: 'custom' };
}

export function newBlankEquipment(id: string = uid()): Equipment {
  return { id, typeId: 'custom', name: '', condition: 'used', pricePaid: 0,
    yearBought: 0, keepYears: 0, salvageValue: 0,
    fuelLubePerHour: 0, repairsPctPerYear: 0, citations: {}, missingFields: ['pricePaid', 'keepYears', 'salvageValue', 'fuelLubePerHour', 'repairsPctPerYear', 'yearBought'] };
}
