/**
 * The app's own calculations: the ones that turn a single-crop study budget into a whole-farm plan.
 * None of these come from a study. Each is either standard enterprise budgeting or a stated assumption,
 * and the Sources screen and the PDF print all of them so nothing is hidden.
 */
export type MethodKind = 'standard' | 'assumption';
export interface AppMethod { key: string; kind: MethodKind; formula: string }

export const APP_METHODS: AppMethod[] = [
  { key: 'scale', kind: 'standard', formula: 'acre-plantings = acres x plantings per year; sales = acre-plantings x yield per acre x price' },
  { key: 'labor', kind: 'standard', formula: 'hired hourly = hired wage x (1 + payroll overhead); hand labor = hand hours x hired hourly; operator labor = operator hours x hired hourly' },
  { key: 'ownLabor', kind: 'standard', formula: 'own labor = acre-plantings x your hours per acre x what you pay yourself' },
  { key: 'machineOwned', kind: 'standard', formula: 'machine cost (owned) = machine hours x (fuel and lube + repairs per hour) + operator labor' },
  { key: 'machineHired', kind: 'assumption', formula: 'machine cost (hired) = the study\'s fuel, lube, repairs and operator labor for that row, unless you type a quote' },
  { key: 'operating', kind: 'standard', formula: 'operating = sum of enabled operations x acre-plantings + own labor + hired jobs + interest on operating capital' },
  { key: 'interest', kind: 'standard', formula: 'interest = sum over months of (cash spent so far - sales so far, when positive) x operating rate / 12' },
  { key: 'landRent', kind: 'standard', formula: 'land rent share = land rent x crop acres / total acres' },
  { key: 'overhead', kind: 'assumption', formula: 'overhead item share = amount x crop acres / total acres, or x crop sales / total sales, as chosen per item' },
  { key: 'equipment', kind: 'standard', formula: 'machine ownership share = yearly ownership x crop hours on it / all crop hours on it; with no hours listed, by acres or sales' },
  { key: 'totals', kind: 'standard', formula: 'all costs = operating + overhead share + equipment share; net = sales - all costs; contribution = sales - operating' },
  { key: 'breakEven', kind: 'standard', formula: 'break-even price = all costs / units; break-even yield = all costs / (price x acre-plantings)' },
  { key: 'cashMonths', kind: 'assumption', formula: 'costs by month follow the study\'s monthly table or your percents; sales are spread equally over harvest months unless you set percents; overhead and ownership are charged evenly, one twelfth a month' },
  { key: 'units', kind: 'standard', formula: 'beds to acres = beds x bed length x bed width / 43,560 sq ft; 100 ft rows use the same bed width' },
];
