// Shared contract between the calculation engine and the screens.
// Plain-language field names on purpose: the UI shows these words to farmers.
//
// Rule for every number in this app: it is either typed by the farmer or it carries a Citation
// to a UC Davis cost study the farmer can open. Nothing is estimated from a made-up formula.

export type NumericField<T> = { [K in Exclude<keyof T, 'missingFields'>]: T[K] extends number ? K : never }[Exclude<keyof T, 'missingFields'>];

export type AreaUnit = 'acres' | 'beds' | 'rows100ft';

/** Where a default number came from. `value` is the cited number so the UI can tell whether the farmer has changed it. */
export interface Citation {
  studyId: string;
  title: string;
  year: number | null;
  region: string | null;
  url: string;
  page: number;
  quote: string;
  field: string;              // what the number is, in the study's words (e.g. 'Table 5 salvage value')
  value: number | null;       // null when the study only gives a sentence, not a number
}

export type FarmCitedField = 'interestRate' | 'hiredLaborRate' | 'ownLaborRate' | 'payrollOverhead' | 'landRentPerAcre' | 'otherOverheadPerYear';

export interface Farm {
  missingFields?: NumericField<Farm>[];
  name: string;
  county: string;
  areaUnit: AreaUnit;          // how the farmer thinks about land; engine converts to acres
  bedLengthFt: number;         // used when areaUnit is 'beds'
  bedWidthIn: number;
  interestRate: number;        // 0.0475 means 4.75 percent
  ownLaborRate: number;        // $/hr the farmer pays themself
  hiredLaborRate: number;      // $/hr for hired field work, before payroll overhead
  payrollOverhead: number;     // 0.34 means 34 percent on top of wages
  landRentPerAcre: number;     // $/acre/yr, 0 if owned outright
  otherOverheadPerYear: number; // insurance, certification, office, market fees: whole farm, per year
  citations: Partial<Record<FarmCitedField, Citation>>;
}

export type SalesChannel = 'market' | 'csa' | 'wholesale';

/** Hours of one owned machine used on this crop, per acre, per planting. */
export interface MachineUse { equipmentId: string; hoursPerAcre: number }

/** A job hired out to someone else with their equipment, priced per acre per planting. */
export interface CustomHire { id: string; name: string; costPerAcre: number }

export type CropCitedField = 'yieldPerAcre' | 'price' | 'operatingCostPerAcre' | 'months' | 'plantingsPerYear';

export interface Crop {
  missingFields?: NumericField<Crop>[];
  id: string;
  typeId: string;              // commodity id from the study index, e.g. 'strawberries'
  studyId: string | null;      // the UC study this crop started from
  name: string;                // commodity name in English as printed on the index
  area: number;                // in farm.areaUnit
  plantingsPerYear: number;
  yieldPerAcre: number;        // units per acre per planting; 0 until the farmer or a study fills it
  unit: string;                // 'tray', 'carton', 'ton', 'lb' ...
  price: number;               // $ per unit, blended across channels
  channel: SalesChannel;
  operatingCostPerAcre: number; // $ per acre per planting for seed, materials and hired labor
  ownLaborHoursPerAcre: number; // farmer's own hours per acre per planting
  machineHours: MachineUse[];   // which owned machines this crop uses and for how long
  customHire: CustomHire[];     // work hired out, like custom seeding or mowing
  timingSource?: 'custom' | 'study';
  costMonths: number[] | null;    // 12 weights summing to 1, only when a study gives a monthly table
  revenueMonths: number[] | null; // 12 weights summing to 1, only when a study gives harvest months
  citations: Partial<Record<CropCitedField, Citation>>;
}

export type Condition = 'new' | 'used';

export type EquipmentCitedField = 'pricePaid' | 'keepYears' | 'salvageValue' | 'operatingCostPerHour';

export interface Equipment {
  missingFields?: NumericField<Equipment>[];
  id: string;
  typeId: string;              // normalized description, groups the same machine across studies
  name: string;                // description as printed in the study
  condition: Condition;
  pricePaid: number;           // what the farmer actually paid
  yearBought: number;
  keepYears: number;           // years from now they expect to keep it
  hoursPerYear: number;
  salvageValue: number;        // what they expect to sell it for at the end
  operatingCostPerHour: number; // fuel, oil, repairs
  citations: Partial<Record<EquipmentCitedField, Citation>>;
}

export interface Plan {
  farm: Farm;
  crops: Crop[];
  equipment: Equipment[];
  example?: boolean;           // true while the plan is the loaded example, so the UI can offer to clear it
}

// ---------- engine outputs ----------

export interface OwnershipBreakdown {
  capitalRecovery: number;     // (paid - salvage) x CRF
  interestOnSalvage: number;   // salvage x rate
  insuranceAndTax: number;     // on average value
  totalPerYear: number;
  ownPerHour: number;
  runPerHour: number;
  allInPerHour: number;
}

export interface CropResult {
  cropId: string;
  name: string;
  acres: number;
  units: number;               // total units sold per year
  revenue: number;
  operating: number;           // growing and selling: materials, hired labor, own labor, machine running, hired-out work
  machineRunning: number;      // fuel, oil and repairs for the hours this crop used owned machines
  customHire: number;          // work hired out
  overheadShare: number;       // share of land rent and other farm overhead
  equipmentShare: number;      // share of equipment ownership cost
  totalCost: number;
  net: number;
  contribution: number;        // revenue minus operating: what the crop adds before overhead
  breakEvenPrice: number;      // total cost / units
  breakEvenYieldPerAcre: number;
  hasMonths: boolean;          // whether this crop is in the monthly cash view
}

export interface MachineResult {
  equipmentId: string;
  name: string;
  hoursPerYear: number;        // what the farmer said they use it
  hoursAssigned: number;       // hours the crops account for
  ownPerYear: number;
  ownPerHour: number;
  runPerHour: number;
  allInPerHour: number;
  byCrop: { cropId: string; name: string; hours: number; share: number }[]; // share of ownership cost, sums to 1
}

export interface FarmResult {
  totalAcres: number;
  revenue: number;
  totalCost: number;
  net: number;
  overhead: number;            // whole farm overhead including land rent
  equipmentOwnership: number;  // sum of ownership totals
  ownLaborPaid: number;        // what the farmer paid themself, already inside totalCost
  crops: CropResult[];
  machines: MachineResult[];
  monthlyCash: number[];       // 12 entries, Jan..Dec, revenue minus cash costs, crops with month data only
  lowestCashPoint: { month: number; cumulative: number };
  cashCoverage: { withMonths: number; total: number }; // how many crops the monthly view covers
}
