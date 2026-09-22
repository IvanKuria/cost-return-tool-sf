import { useEffect, useReducer } from 'react';
import { cropDefaultsFromStudy, studyById } from '../data/studies';
import { STUDY_INSURANCE_RATE, STUDY_PROPERTY_TAX_RATE } from './rates';
import type { Citation, Crop, Equipment, Farm, Plan } from './types';

export type Step = 'farm' | 'crops' | 'equipment' | 'results' | 'sources';
export const STEPS: { id: Step; label: string }[] = [
  { id: 'farm', label: 'Your farm' },
  { id: 'crops', label: 'What you grow' },
  { id: 'equipment', label: 'What you own' },
  { id: 'results', label: 'Results' },
];

export interface State { step: Step; plan: Plan; editId?: string }

export type Action =
  | { type: 'go'; step: Step; editId?: string }
  | { type: 'farm'; patch: Partial<Farm> }
  | { type: 'crop.add'; crop: Crop }
  | { type: 'crop.update'; id: string; patch: Partial<Crop> }
  | { type: 'crop.remove'; id: string }
  | { type: 'equipment.add'; item: Equipment }
  | { type: 'equipment.update'; id: string; patch: Partial<Equipment> }
  | { type: 'equipment.remove'; id: string }
  | { type: 'reset'; state: State };

/**
 * A plan with nothing filled in. Money fields start at 0 rather than at a guessed number.
 * Interest and payroll rates are the ones the UC cost studies use; the hints on the farm screen say so.
 */
export const DEFAULT_FARM: Farm = {
  name: '', county: 'Santa Cruz', areaUnit: 'acres', bedLengthFt: 100, bedWidthIn: 30,
  interestRate: 0.0475, ownLaborRate: 0, hiredLaborRate: 0, payrollOverhead: 0.40,
  landRentPerAcre: 0, overheadItems: [], overheadBasis: 'acres', equipmentBasis: 'hours',
  insuranceRate: STUDY_INSURANCE_RATE, propertyTaxRate: STUDY_PROPERTY_TAX_RATE,
  citations: {},
};

export const EMPTY_PLAN: Plan = { farm: DEFAULT_FARM, crops: [], equipment: [], example: false };

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'go': return { ...s, step: a.step, editId: a.editId };
    case 'farm': return { ...s, plan: { ...s.plan, farm: { ...s.plan.farm, ...a.patch } } };
    case 'crop.add': return { ...s, plan: { ...s.plan, crops: [...s.plan.crops, a.crop] } };
    case 'crop.update': return { ...s, plan: { ...s.plan, crops: s.plan.crops.map(c => c.id === a.id ? { ...c, ...a.patch } : c) } };
    case 'crop.remove': return { ...s, plan: { ...s.plan, crops: s.plan.crops.filter(c => c.id !== a.id) } };
    case 'equipment.add': return { ...s, plan: { ...s.plan, equipment: [...s.plan.equipment, a.item] } };
    case 'equipment.update': return { ...s, plan: { ...s.plan, equipment: s.plan.equipment.map(e => e.id === a.id ? { ...e, ...a.patch } : e) } };
    case 'equipment.remove': return { ...s, plan: { ...s.plan, equipment: s.plan.equipment.filter(e => e.id !== a.id) } };
    case 'reset': return a.state;
  }
}

// v3: plans carry citations. v4: itemized overhead, allocation bases, split running cost (migrated from v3).
const KEY = 'farm-cost-planner.v4';
const OLD_KEY = 'farm-cost-planner.v3';

/** Bring a v3 plan up to v4 without losing anything the farmer typed. */
export function migratePlan(raw: unknown): Plan {
  const p = raw as Plan & { farm: Farm & { otherOverheadPerYear?: number }; equipment: (Equipment & { operatingCostPerHour?: number })[] };
  const farm: Farm = { ...DEFAULT_FARM, ...p.farm };
  if (!Array.isArray(farm.overheadItems)) {
    const legacy = p.farm.otherOverheadPerYear ?? 0;
    const legacyCitation = (p.farm.citations as Record<string, Citation | undefined>).otherOverheadPerYear;
    farm.overheadItems = legacy > 0 ? [{ id: 'other', name: 'Other farm costs', amountPerYear: legacy, basis: 'acres', ...(legacyCitation ? { citation: legacyCitation } : {}) }] : [];
  }
  if (!farm.overheadBasis) farm.overheadBasis = 'acres';
  if (!farm.equipmentBasis) farm.equipmentBasis = 'hours';
  if (typeof farm.insuranceRate !== 'number') farm.insuranceRate = STUDY_INSURANCE_RATE;
  if (typeof farm.propertyTaxRate !== 'number') farm.propertyTaxRate = STUDY_PROPERTY_TAX_RATE;
  const equipment: Equipment[] = p.equipment.map(e => {
    if (typeof e.fuelLubePerHour === 'number' && typeof e.repairsPerHour === 'number') return e;
    // A v3 plan held one running figure. Keep it whole under fuel and lube rather than invent a split.
    const legacy = (e as { operatingCostPerHour?: number }).operatingCostPerHour ?? 0;
    const cits = e.citations as Record<string, Citation | undefined>;
    const citations = { ...e.citations } as Equipment['citations'];
    if (cits.operatingCostPerHour) citations.fuelLubePerHour = { ...cits.operatingCostPerHour, field: 'Fuel, lube and repairs per hour (not split in this saved plan)' };
    const missing = (e.missingFields ?? []).filter(f => (f as string) !== 'operatingCostPerHour') as Equipment['missingFields'];
    return { ...e, fuelLubePerHour: legacy, repairsPerHour: 0, citations, missingFields: missing };
  });
  const crops = p.crops.map(c => ({ ...c, operations: Array.isArray(c.operations) ? c.operations : [] }));
  return { ...p, farm, equipment, crops };
}

function isCurrentPlan(p: unknown): p is Plan {
  if (!p || typeof p !== 'object') return false;
  const plan = p as Partial<Plan>;
  if (!plan.farm || !Array.isArray(plan.crops) || !Array.isArray(plan.equipment)) return false;
  if (typeof plan.farm.citations !== 'object') return false;
  return plan.crops.every(c => 'studyId' in c && typeof c.citations === 'object')
    && plan.equipment.every(e => typeof e.citations === 'object');
}

/** Fill legacy absent study timing without replacing a farmer's custom schedule or numbers. */
export function hydratePlan(plan: Plan): Plan {
  return { ...plan, crops: plan.crops.map(c => {
    const study = studyById(c.studyId);
    if (c.timingSource === 'custom' || (c.costMonths && c.revenueMonths) || !study) return c;
    const defaults = cropDefaultsFromStudy(study);
    return { ...c, costMonths: c.costMonths ?? defaults.costMonths, revenueMonths: c.revenueMonths ?? defaults.revenueMonths,
      citations: { ...c.citations, ...(defaults.citations.months ? { months: defaults.citations.months } : {}) } };
  }) };
}

export function usePlanStore(initial: State) {
  const [state, dispatch] = useReducer(reducer, initial, (init) => {
    try {
      const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<State>;
        if (saved.plan && isCurrentPlan(saved.plan)) {
          const plan = hydratePlan(migratePlan(saved.plan));
          const step = saved.step && [...STEPS.map(s => s.id), 'sources'].includes(saved.step) ? saved.step : init.step;
          return { step: window.location.hash === '#results' ? 'results' as const : step, plan };
        }
      }
    } catch { /* ignore */ }
    return init;
  });
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } }, [state]);
  return [state, dispatch] as const;
}

export const uid = () => Math.random().toString(36).slice(2, 10);
