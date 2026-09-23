import type { Citation, Crop, Equipment, Plan } from '../lib/types';
import { newCropFromStudy, newEquipmentFromCatalog, STUDY_INSURANCE_RATE, STUDY_PROPERTY_TAX_RATE } from '../lib/engine';
import { cite, equipmentCatalog, normalizeDescription, studyById } from './studies';

// Example farm built only from UC Davis Central Coast cost studies. Every default here is cited.
// The example inputs that are the farmer's own to make (acres, machine hours, year bought,
// hours a year) are plain example entries and carry no citation, like a farmer's own typing.

const STRAW = 'strawberries-2024strawberry-full-final-march2024';
const LETTUCE = 'lettuce-2023-romheartslettuce-full-final';
const BROCCOLI = 'broccoli-2023-broccrowncut-full-final';
const BLACKBERRY = 'blackberries-2024blackberries-correctedfinal-april2024';
const RASPBERRY = 'raspberries-23raspberry-fullfinal-dec2023';

const SAMPLE_ACRES = 7;

function crop(id: string, studyId: string, area: number, over: Partial<Crop> = {}): Crop {
  const s = studyById(studyId);
  if (!s) throw new Error(`sample: missing study ${studyId}`);
  return { ...newCropFromStudy(s, area, id), ...over };
}

function machine(id: string, studyId: string, description: string, over: Partial<Equipment>): Equipment {
  const key = normalizeDescription(description);
  const entry = equipmentCatalog().find(e => e.key === key);
  const row = entry?.rows.find(r => r.studyId === studyId);
  if (!entry || !row) throw new Error(`sample: ${description} not found in ${studyId}`);
  return { ...newEquipmentFromCatalog(entry, 'used', id, row), ...over };
}

function sampleFarm(): Plan['farm'] {
  const s = studyById(STRAW);
  if (!s) throw new Error('sample: missing strawberry study');
  const a = s.assumptions;
  const citations: Plan['farm']['citations'] = {};
  const farm: Plan['farm'] = {
    name: 'Example farm', county: 'Santa Cruz', areaUnit: 'acres', bedLengthFt: 100, bedWidthIn: 30,
    interestRate: 0.0475, operatingInterestRate: 0.0575, ownLaborRate: 0, hiredLaborRate: 0, payrollOverhead: 0.40,
    landRentPerAcre: 0, overheadItems: [], overheadBasis: 'acres', equipmentBasis: 'hours',
    insuranceRate: STUDY_INSURANCE_RATE, propertyTaxRate: STUDY_PROPERTY_TAX_RATE, citations,
  };
  if (a.operatingInterestRatePct) { farm.operatingInterestRate = a.operatingInterestRatePct.value / 100; citations.operatingInterestRate = cite(s, a.operatingInterestRatePct.page, a.operatingInterestRatePct.quote, 'Interest rate on operating capital', a.operatingInterestRatePct.value); }
  if (a.interestRatePct) { farm.interestRate = a.interestRatePct.value / 100; citations.interestRate = cite(s, a.interestRatePct.page, a.interestRatePct.quote, 'Interest rate for capital recovery', a.interestRatePct.value); }
  if (a.laborNonMachineRate) {
    farm.hiredLaborRate = a.laborNonMachineRate.value;
    citations.hiredLaborRate = cite(s, a.laborNonMachineRate.page, a.laborNonMachineRate.quote, 'Field labor rate', a.laborNonMachineRate.value);
    farm.ownLaborRate = a.laborNonMachineRate.value;
    citations.ownLaborRate = cite(s, a.laborNonMachineRate.page, `${a.laborNonMachineRate.quote} (The example pays the farmer the same field labor rate.)`, 'Field labor rate, used for the farmer', a.laborNonMachineRate.value);
  }
  if (a.laborOverheadPct) { farm.payrollOverhead = a.laborOverheadPct.value / 100; citations.payrollOverhead = cite(s, a.laborOverheadPct.page, a.laborOverheadPct.quote, 'Labor overhead percent', a.laborOverheadPct.value); }
  if (a.landRentPerAcre) { farm.landRentPerAcre = a.landRentPerAcre.value; citations.landRentPerAcre = cite(s, a.landRentPerAcre.page, a.landRentPerAcre.quote, 'Land rent per acre', a.landRentPerAcre.value); }
  // Other yearly costs: one item per business overhead row in the study (other than land rent), per acre times the example's acres.
  const rows = s.businessOverhead.filter(r => !/land rent/i.test(r.description));
  farm.overheadItems = rows.map((r, i) => {
    const amountPerYear = Math.round(r.pricePerUnit * SAMPLE_ACRES);
    const citation: Citation = cite(s, r.page, `${r.description} $${r.pricePerUnit} per ${r.unit || 'acre'}, multiplied by the example's ${SAMPLE_ACRES} acres.`, 'Business overhead row', amountPerYear);
    return { id: `oh-${i}`, name: r.description, amountPerYear, basis: 'acres' as const, citation };
  });
  return farm;
}

/**
 * Example inputs that are the farmer's to make: which owned machine does each of the study's
 * machine operations. Matched by the operation's name; anything else with machine time stays hired.
 */
function assign(c: Crop): Crop {
  const pick = (name: string): string | null => {
    const n = name.toLowerCase();
    if (/disc/.test(n)) return 'e-disc';
    if (/mow|flail/.test(n)) return 'e-mower';
    if (/spray|fungicide|insecticide|herbicide/.test(n)) return 'e-sprayer';
    if (/haul|truck|pickup|deliver/.test(n)) return 'e-pickup';
    if (/subsoil|chisel|level|list|shape|bed|cultivat|plant|fertiliz|compost|mulch|drip|trench|grade|irrigat/.test(n)) return 'e-tractor';
    return null;
  };
  return { ...c, operations: c.operations.map(o => o.machineHoursPerAcre > 0 ? { ...o, equipmentId: pick(o.name) } : o) };
}

export function buildSamplePlan(): Plan {
  return {
    example: true,
    farm: sampleFarm(),
    crops: [
      assign(crop('c-straw', STRAW, 2)),
      assign(crop('c-lettuce', LETTUCE, 1.5)),
      assign(crop('c-broccoli', BROCCOLI, 1.5)),
      assign(crop('c-blackberry', BLACKBERRY, 1)),
      assign(crop('c-raspberry', RASPBERRY, 1)),
    ],
    equipment: [
      machine('e-tractor', STRAW, '42HP 4WD Tractor', { condition: 'used', yearBought: 2021, hoursPerYear: 140 }),
      machine('e-disc', STRAW, "Disc Offset 14'", { condition: 'used', yearBought: 2021, hoursPerYear: 15 }),
      machine('e-sprayer', STRAW, "Sprayer 20' boom", { condition: 'new', yearBought: 2023, hoursPerYear: 20 }),
      machine('e-mower', BLACKBERRY, "Mower-Flail 7'", { condition: 'used', yearBought: 2022, hoursPerYear: 10 }),
      machine('e-pickup', STRAW, 'Pickup Truck 1/2 T', { condition: 'used', yearBought: 2019, hoursPerYear: 200 }),
    ],
  };
}

export const SAMPLE_PLAN: Plan = buildSamplePlan();
