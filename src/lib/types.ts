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

export type FarmCitedField = 'interestRate' | 'operatingInterestRate' | 'hiredLaborRate' | 'ownLaborRate' | 'payrollOverhead' | 'landRentPerAcre' | 'insuranceRate' | 'propertyTaxRate';

/** How a whole-farm cost is split between crops. */
export type AllocationBasis = 'acres' | 'revenue';
/** How a machine's ownership cost is split: by the hours each crop uses it, falling back to the farm basis when no crop lists hours. */
export type EquipmentBasis = 'hours' | 'acres' | 'revenue';

/** One whole-farm cost the farmer pays regardless of crop: insurance, certification, office, market fees. */
export interface OverheadItem {
  id: string;
  name: string;
  amountPerYear: number;
  basis: AllocationBasis;
  citation?: Citation;
}

export interface Farm {
  missingFields?: NumericField<Farm>[];
  name: string;
  county: string;
  areaUnit: AreaUnit;          // how the farmer thinks about land; engine converts to acres
  bedLengthFt: number;         // used when areaUnit is 'beds'
  bedWidthIn: number;
  interestRate: number;        // 0.0475 means 4.75 percent, for capital recovery
  operatingInterestRate: number; // yearly rate charged on cash spent before sales come in (the studies' interest on operating capital)
  ownLaborRate: number;        // $/hr the farmer pays themself
  hiredLaborRate: number;      // $/hr for hired field work, before payroll overhead
  payrollOverhead: number;     // 0.34 means 34 percent on top of wages
  landRentPerAcre: number;     // $/acre/yr, 0 if owned outright; always split by acres
  overheadItems: OverheadItem[]; // other whole-farm costs, each with its own split basis
  overheadBasis: AllocationBasis;   // default basis for new overhead items
  equipmentBasis: EquipmentBasis;   // how machine ownership cost is split
  insuranceRate: number;       // 0.00843 means 0.843 percent of a machine's average value per year
  propertyTaxRate: number;     // 0.01 means 1 percent of a machine's average value per year
  citations: Partial<Record<FarmCitedField, Citation>>;
}

export type SalesChannel = 'market' | 'csa' | 'wholesale';

/** Hours of one owned machine used on this crop, per acre, per planting. */
export interface MachineUse { equipmentId: string; hoursPerAcre: number }

/** A job hired out to someone else with their equipment, priced per acre per planting. */
export interface CustomHire { id: string; name: string; costPerAcre: number }

export type CropCitedField = 'yieldPerAcre' | 'price' | 'operatingCostPerAcre' | 'months' | 'plantingsPerYear';

export type OperationCategory = 'cultural' | 'harvest' | 'assessment' | 'postharvest' | 'other';

/**
 * One line of work on a crop, per acre, one planting: the rows of a UC study's costs-per-acre table.
 * Machine work is either assigned to a machine the farmer owns (then it costs their running rate and
 * operator time, and shares that machine's ownership by hours) or left hired (then it costs
 * hiredMachinePerAcre, the study's price for that work). Never both, so nothing is counted twice.
 */
export interface CropOperation {
  id: string;
  name: string;
  category: OperationCategory;
  enabled: boolean;
  machineHoursPerAcre: number;     // machine time, from the study's Time column
  operatorHoursPerAcre: number;    // operator labor hours; the study's machine time times its labor factor
  equipmentId: string | null;      // owned machine doing it, or null when hired out
  hiredMachinePerAcre: number;     // fuel, lube, repairs and operator labor the study priced for this work
  handHoursPerAcre: number;        // hand labor hours, repriced at the farm's hired rate
  otherLaborPerAcre: number;       // labor dollars the study gave that could not be turned into hours
  materialsPerAcre: number;
  customPerAcre: number;           // the study's custom or rent column
  source: 'study' | 'custom';
  citation?: Citation;
}

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
  operatingCostPerAcre: number; // $ per acre per planting for seed, materials and hired labor; used only when operations is empty
  ownLaborHoursPerAcre: number; // farmer's own hours per acre per planting
  machineHours: MachineUse[];   // owned machine hours typed directly; used only when operations is empty
  operations: CropOperation[];  // the crop's work, line by line; when present it replaces operatingCostPerAcre and machineHours
  customHire: CustomHire[];     // work hired out, like custom seeding or mowing
  timingSource?: 'custom' | 'study';
  costMonths: number[] | null;    // 12 weights summing to 1, only when a study gives a monthly table
  revenueMonths: number[] | null; // 12 weights summing to 1, only when a study gives harvest months
  citations: Partial<Record<CropCitedField, Citation>>;
}

export type Condition = 'new' | 'used';

export type EquipmentCitedField = 'pricePaid' | 'keepYears' | 'salvageValue' | 'fuelLubePerHour' | 'repairsPerHour';

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
  fuelLubePerHour: number;     // fuel and lube per hour of use
  repairsPerHour: number;      // repairs per hour of use
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
  insurance: number;           // insuranceRate x average value
  taxes: number;               // propertyTaxRate x average value
  insuranceAndTax: number;     // the two above
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
  costParts: { materials: number; handLabor: number; operatorLabor: number; machineRunning: number; hiredMachine: number; custom: number; otherLabor: number; ownLabor: number; hiredJobs: number; lump: number; interest: number }; // what operating is made of; lump is the typed per-acre cost when no operations exist
  operationRows: { id: string; name: string; category: OperationCategory; cost: number; assigned: string | null }[]; // per enabled operation, for the year
  overheadItems: { id: string; name: string; amount: number; basis: AllocationBasis }[]; // this crop's share of each whole-farm cost, land rent first
  machines: { equipmentId: string; name: string; share: number; ownership: number; capitalRecovery: number; interestOnSalvage: number; insurance: number; taxes: number; running: number; hours: number }[];
  monthly: { revenue: number[]; costs: number[] } | null; // 12 entries each, dollars, when the crop has month data
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
  monthlyOverhead: number[];   // 12 entries, the overhead charged in the cash view each month
  runningCash: number[];       // 12 entries, cumulative monthlyCash
  lowestCashPoint: { month: number; cumulative: number };
  cashCoverage: { withMonths: number; total: number }; // how many crops the monthly view covers
}
