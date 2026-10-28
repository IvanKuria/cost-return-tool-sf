// Shape of one parsed UC Davis cost study. Every number is either cited (value + page + quote)
// or null. Nothing here is ever estimated.

export interface Cited { value: number; unit: string | null; page: number; quote: string }

export interface StudySource {
  id: string;                 // slug, also the parsed file name
  commodity: string;          // index category, e.g. 'strawberries'
  title: string;              // study title as printed on the cover
  year: number | null;
  region: string | null;      // as listed on the index page
  counties: string | null;    // as stated in the study text
  description: string | null; // index row description
  language: 'en' | 'es';
  url: string;
  indexPage: string;
  publisher: string;
  fetchedAt: string;
  archived: boolean;          // listed on the archived index rather than the current one
  indexYear: number | null;   // year as listed on the index page
  /** The year (and month when stated) the study says its prices are for: "based on January 2024 figures". Null when not stated. */
  priceYear: { value: number; month: number | null; page: number; quote: string } | null;
}

export interface Assumptions {
  acresFarmed: Cited | null;
  acresCrop: Cited | null;
  yieldPerAcre: Cited | null;
  yieldUnit: string | null;
  pricePerUnit: Cited | null;
  returns: { name: string; quantity: number; unit: string; price: number; value: number; page: number; quote: string }[];
  interestRatePct: Cited | null;          // capital recovery rate
  operatingInterestRatePct: Cited | null; // operating loan rate
  laborMachineRate: Cited | null;
  laborNonMachineRate: Cited | null;
  laborOverheadPct: Cited | null;
  landRentPerAcre: Cited | null;
  cropsPerAcrePerYear: Cited | null;
  fuelPriceDiesel: Cited | null;
  fuelPriceGas: Cited | null;
  yieldStatement: Quote | null;   // the study's own sentence about yield, when it gives a range rather than one number
  priceStatement: Quote | null;
}

export type OperationCategory = 'cultural' | 'harvest' | 'assessment' | 'postharvest' | 'other';

export interface OperationRow {
  name: string; category: OperationCategory;
  section?: string;           // the section heading as printed above the row
  timeHrsPerAcre: number | null; labor: number | null; fuel: number | null; lubeRepairs: number | null;
  materials: number | null; customRent: number | null; totalCost: number | null; page: number; quote: string;
}

export interface CostsPerAcre {
  title?: string | null;      // the production costs table heading as printed
  operatingTotal: Cited | null;
  operatingInterest?: Cited | null; // interest on operating capital; operations rows + this = operatingTotal
  cashOverheadTotal: Cited | null;
  nonCashOverheadTotal: Cited | null;
  totalCost: Cited | null;
  grossReturns: Cited | null;
  netReturnsAboveOperating: Cited | null;
  netReturnsAboveTotal: Cited | null;
  cashOverheadItems: { description: string; value: number; page: number; quote: string }[];
  operations: OperationRow[];
}

export interface EquipmentRow {
  description: string; yearCode: string | null; price: number; yearsLife: number; salvageValue: number;
  capitalRecovery: number; insurance: number; taxes: number; repairs: number | null; total: number | null; page: number; line: string;
}

export interface HourlyEquipmentRow {
  description: string; hoursUsedOnCrop: number; totalHours: number | null; capitalRecoveryPerHr: number; insurancePerHr: number;
  taxesPerHr: number; repairsPerHr: number; fuelPerHr: number; totalOperatingPerHr: number; totalCostPerHr: number; page: number; line: string;
}

export interface BusinessOverheadRow { description: string; unitsPerFarm: number; unit: string; pricePerUnit: number; totalCost: number; page: number; line: string }

export interface Quote { page: number; quote: string }

export interface Method {
  capitalRecoveryFormula: Quote | null;
  salvageMethod: Quote | null;
  insuranceRatePct: Cited | null;
  propertyTaxRatePct: Cited | null;
  /** Operator labor hours divided by machine time in the costs table (1.2 when the study says labor is 20 percent higher). Null when the study does not say. */
  machineLaborFactor: Cited | null;
}

export interface ParseReport { fieldsFound: string[]; fieldsMissing: string[]; warnings: string[] }

/** Monthly cash costs per acre from the study's monthly table. Jan..Dec calendar months. */
export interface MonthlyCosts {
  basis: string;
  cashCostsPerAcre: number[] | null;
  operatingPerAcre: number[] | null;
  harvestMonths: boolean[];
  totalCheck: number;
  checkedRow: string;
  columns: string[];
  spansTwoYears: boolean;
  page: number;
  quote: string;
}

export interface EstablishmentYear { year: number; label: string; totalCost: number | null; returns: number | null; netCost: number | null; accumulated: number | null; page: number; quote: string }
/** How a perennial study turns its establishment years into a yearly charge during production. Only what the study prints. */
export type EstablishmentRowKind = 'operation' | 'subtotal' | 'total' | 'overheadItem' | 'interest' | 'income' | 'net' | 'accumulated' | 'heading';
export interface EstablishmentTableRow { label: string; kind: EstablishmentRowKind; section: string; values: (number | null)[]; page: number; quote: string }
/** The establishment table row by row, in the study's order and wording, one value per year column. Blanks are null. */
export interface EstablishmentTable { title: string; years: string[]; rows: EstablishmentTableRow[]; yieldRow: { label: string; values: (number | null)[]; quote: string } | null }
export interface Establishment {
  table?: EstablishmentTable | null;
  years: EstablishmentYear[];
  accumulatedNetCost: { value: number; page: number; quote: string } | null;
  annualCharge: { value: number; page: number; quote: string } | null;
  productionYears: { value: number; page: number; quote: string } | null;
  plantingLife: { value: number; page: number; quote: string } | null;
  amortizedFromYear: { value: number; page: number; quote: string } | null;
  removalCost: { value: number; note: string; page: number; quote: string } | null;
  asset: { price: number; yearsLife: number; salvageValue: number; capitalRecovery: number; page: number; line: string } | null;
  method: { page: number; quote: string } | null;
}

/** Per study answer to "what does it cost to establish this crop, per acre", in the order the repricer reads it.
 *  table: establishment.table has years and rows; total: no usable table but `total` is cited; none: neither. */
export type EstablishmentSource = 'table' | 'investment' | 'production' | 'prose';
export interface EstablishmentSummary {
  perennial: boolean;            // the crop is established once and produces for several years (orchards, vineyards, berries, asparagus, alfalfa/hay/pasture stands, artichokes, Christmas trees ...)
  status: 'table' | 'total' | 'none';  // table: establishment.table has years and rows; total: no usable table but `total` is cited; none: neither
  total: { value: number; page: number; quote: string; source: EstablishmentSource } | null; // per acre accumulated establishment cost (net cost to establish), even when status is 'table'
  annualCharge: { value: number; page: number; quote: string } | null; // per acre per production year establishment charge in the production table's non-cash overhead, when printed
  reason: string | null;         // when status is 'none' (or perennial with only a total), a short plain-language reason
  /** True when the study charges no yearly establishment cost in its production years (it says the cost is in the land
   *  value or recovered in the first production year, or prints no charge line and no establishment row); `reason` says which.
   *  capitalRecovery is then null. */
  noYearlyCharge?: boolean;
  /** Index into establishment.table.years of the column whose accumulated net cash cost the study amortizes (tier 'table'); null otherwise. */
  basisYear?: {
    index: number; label: string;
    /** The table row whose value in column `index` equals total.value (e.g. 'ACCUMULATED NET CASH COSTS/ACRE',
     *  'NET CASH COSTS/ACRE FOR THE YEAR', 'TOTAL OPERATING COSTS/ACRE'). With lessReturns, the row whose value minus
     *  lessReturns.value equals total.value within $1. Null when no row holds the total. */
    row: string | null;
    /** A one-column costs-only table amortized net of the year's returns: the cited TOTAL GROSS RETURNS figure. */
    lessReturns: { value: number; page: number; quote: string } | null;
  } | null;
  /** The study's yearly establishment charge recomputed the UC way: total x CRF(rate, years), salvage 0. Null when rate, years or total is missing. */
  capitalRecovery?: {
    ratePct: { value: number; page: number; quote: string };  // long-term rate used for capital recovery
    years: { value: number; page: number; quote: string };    // remaining production years the charge runs
    computed: number;          // total.value x CRF(rate, years), unrounded
    reproduces: boolean;       // |computed - annualCharge.value| <= max(3, 2% of it); false when the study prints no annual charge
    // ratePct 0 means a straight-line charge (CRF(0, n) = 1 / n), as in "Amortization 20 % of total cost of stand establishment"
  } | null;
  /** The establishment row of the whole-farm investment table, converted to per acre. */
  investmentCharges?: {
    insurance: number;         // per acre per year, as printed / crop acres
    taxes: number;             // per acre per year, as printed / crop acres
    acres: number;             // crop acres used for the division
    insuranceRatePct: number | null; // method.insuranceRatePct when stated
    taxRatePct: number | null;       // method.propertyTaxRatePct when stated
    page: number; quote: string;     // the investment row line, and where the acres are printed
  } | null;
}

export interface ParsedStudy {
  source: StudySource;
  assumptions: Assumptions;
  costsPerAcre: CostsPerAcre;
  equipment: EquipmentRow[];
  investments: EquipmentRow[];
  hourlyEquipment: HourlyEquipmentRow[];
  businessOverhead: BusinessOverheadRow[];
  method: Method;
  monthly?: MonthlyCosts | null;
  establishment?: Establishment | null;
  establishmentSummary?: EstablishmentSummary;
  parse: ParseReport;
}
