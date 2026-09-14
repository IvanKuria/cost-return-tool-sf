import type { Citation, Crop, Equipment, Plan } from '../lib/types';
import { newCropFromStudy, newEquipmentFromCatalog } from '../lib/engine';
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
    interestRate: 0.0475, ownLaborRate: 0, hiredLaborRate: 0, payrollOverhead: 0.40,
    landRentPerAcre: 0, otherOverheadPerYear: 0, citations,
  };
  if (a.interestRatePct) { farm.interestRate = a.interestRatePct.value / 100; citations.interestRate = cite(s, a.interestRatePct.page, a.interestRatePct.quote, 'Interest rate for capital recovery', a.interestRatePct.value); }
  if (a.laborNonMachineRate) {
    farm.hiredLaborRate = a.laborNonMachineRate.value;
    citations.hiredLaborRate = cite(s, a.laborNonMachineRate.page, a.laborNonMachineRate.quote, 'Field labor rate', a.laborNonMachineRate.value);
    farm.ownLaborRate = a.laborNonMachineRate.value;
    citations.ownLaborRate = cite(s, a.laborNonMachineRate.page, `${a.laborNonMachineRate.quote} (The example pays the farmer the same field labor rate.)`, 'Field labor rate, used for the farmer', a.laborNonMachineRate.value);
  }
  if (a.laborOverheadPct) { farm.payrollOverhead = a.laborOverheadPct.value / 100; citations.payrollOverhead = cite(s, a.laborOverheadPct.page, a.laborOverheadPct.quote, 'Labor overhead percent', a.laborOverheadPct.value); }
  if (a.landRentPerAcre) { farm.landRentPerAcre = a.landRentPerAcre.value; citations.landRentPerAcre = cite(s, a.landRentPerAcre.page, a.landRentPerAcre.quote, 'Land rent per acre', a.landRentPerAcre.value); }
  // Other yearly costs: the study's business overhead rows other than land rent, per acre, times the example's acres.
  const rows = s.businessOverhead.filter(r => !/land rent/i.test(r.description));
  if (rows.length > 0) {
    const perAcre = rows.reduce((sum, r) => sum + r.pricePerUnit, 0);
    const total = Math.round(perAcre * SAMPLE_ACRES);
    farm.otherOverheadPerYear = total;
    const c: Citation = cite(s, rows[0].page, `${rows.map(r => `${r.description} $${r.pricePerUnit} per acre`).join('; ')}. Added up ($${Math.round(perAcre)} per acre) and multiplied by the example's ${SAMPLE_ACRES} acres.`, 'Business overhead rows other than land rent', total);
    citations.otherOverheadPerYear = c;
  }
  return farm;
}

export function buildSamplePlan(): Plan {
  return {
    example: true,
    farm: sampleFarm(),
    crops: [
      crop('c-straw', STRAW, 2, {
        machineHours: [{ equipmentId: 'e-tractor', hoursPerAcre: 12 }, { equipmentId: 'e-disc', hoursPerAcre: 2 }, { equipmentId: 'e-sprayer', hoursPerAcre: 6 }, { equipmentId: 'e-pickup', hoursPerAcre: 20 }],
      }),
      crop('c-lettuce', LETTUCE, 1.5, {
        machineHours: [{ equipmentId: 'e-tractor', hoursPerAcre: 8 }, { equipmentId: 'e-disc', hoursPerAcre: 1.5 }, { equipmentId: 'e-pickup', hoursPerAcre: 6 }],
      }),
      crop('c-broccoli', BROCCOLI, 1.5, {
        machineHours: [{ equipmentId: 'e-tractor', hoursPerAcre: 8 }, { equipmentId: 'e-disc', hoursPerAcre: 1.5 }, { equipmentId: 'e-sprayer', hoursPerAcre: 3 }, { equipmentId: 'e-pickup', hoursPerAcre: 6 }],
      }),
      crop('c-blackberry', BLACKBERRY, 1, {
        machineHours: [{ equipmentId: 'e-tractor', hoursPerAcre: 6 }, { equipmentId: 'e-mower', hoursPerAcre: 3 }, { equipmentId: 'e-pickup', hoursPerAcre: 15 }],
      }),
      crop('c-raspberry', RASPBERRY, 1, {
        machineHours: [{ equipmentId: 'e-tractor', hoursPerAcre: 6 }, { equipmentId: 'e-mower', hoursPerAcre: 3 }, { equipmentId: 'e-pickup', hoursPerAcre: 15 }],
      }),
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
