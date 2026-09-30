import { en, type Key } from '../i18n/en';
import { es } from '../i18n/es';
import { cropNames } from '../i18n/names';
import type { Lang } from '../i18n';
import { studyById } from '../data/studies';
import type { Citation, Crop, CropResult, Equipment, FarmResult, OperationCategory, Plan } from './types';
import { isMissing, missingPlanInputs } from './inputs';
import { APP_METHODS } from './methods';
import { METHOD, computePlan, machineRatesInPlan, operationCost, ownership, toAcres, usesOperations } from './engine';
import { sourceDisplayValue, sourceStatus } from './source';

/**
 * One structured snapshot feeds the PDF, the spreadsheet and the CSV. Every number here is
 * a plain figure the writers format; nothing recalculates in the exported files.
 */
export type ValueKind = 'money' | 'expense' | 'net' | 'number' | 'percent' | 'text';
export interface Fact { label: string; value: number | string; kind: ValueKind }
export interface LabeledValue { label: string; value: string }
export interface CropRow { name: string; acres: number; sales: number; costs: number; net: number; perAcre: number; breakEvenPrice: number; operating: number; ownLabor: number; machineRunning: number; hiredWork: number; overheadShare: number; equipmentShare: number }
export interface CashRow { label: string; values: number[]; total: number; kind: 'in' | 'out' | 'fixed' | 'net' | 'balance' }
export interface BreakdownLine { label: string; amount: number; basis?: string; group: 'operating' | 'overhead' | 'machine' | 'establishment' }
export interface OperationLine { name: string; category: string; who: string; enabled: boolean; machineHours: number; operatorHours: number; handHours: number; materials: number; custom: number; costPerAcre: number; costForYear: number }
export interface CropDetail { id: string; name: string; inputs: LabeledValue[]; breakdown: BreakdownLine[]; timing: { costs: number[] | null; sales: number[] | null }; machineHours: LabeledValue[]; hiredJobs: LabeledValue[]; operations: OperationLine[] }
export interface EquipmentRow { name: string; condition: string; paid: number; year: number; keepYears: number; hoursPerYear: number; cropHours: number; customHours: number; salvage: number; fuelLube: number; repairsPct: number; repairsPerYear: number; repairsPerHour: number; capitalRecovery: number; interestOnSalvage: number; insurance: number; taxes: number; totalPerYear: number; ownPerHour: number; allInPerHour: number; capitalRecoveryPerHour: number; insurancePerHour: number; taxesPerHour: number; carriedBy: string }

// ---------- UC study style tables, numeric only; the screen and the writers put words on them ----------

export interface Table1Row { name: string; time: number; labor: number; flr: number; materials: number; custom: number; total: number }
export interface Table1Group { category: OperationCategory; rows: Table1Row[]; subtotal: Omit<Table1Row, 'name' | 'time'> }
export interface Table1 {
  cropId: string; acres: number; plantings: number; seasons: number;
  groups: Table1Group[];
  extra: { key: 'ownLabor' | 'hiredJobs' | 'lump' | 'repairPool' | 'interest'; amount: number }[];
  totalOperating: number;
  cashOverhead: { id: string; name: string; amount: number }[]; totalCashOverhead: number;
  nonCash: { equipmentId: string; name: string; amount: number }[]; establishment: { capitalRecovery: number; insurance: number; taxes: number; total: number } | null; totalNonCash: number;
  totalCosts: number; grossReturns: number; netAboveOperating: number; netAboveTotal: number;
}
export interface Ranging { cropId: string; unit: string; yields: number[]; prices: number[]; net: number[][] }
export interface Table5Row { equipmentId: string; name: string; price: number; years: number; salvage: number; capitalRecovery: number; insurance: number; taxes: number; repairs: number; total: number }
export interface Table5 { machines: Table5Row[]; investments: Table5Row[]; totals: { price: number; salvage: number; capitalRecovery: number; insurance: number; taxes: number; repairs: number; total: number }; overhead: { id: string; name: string; amount: number }[]; overheadTotal: number }
export interface Table6Row { equipmentId: string; name: string; hours: number; cropHours: number; customHours: number; capitalRecovery: number; insurance: number; taxes: number; repairs: number; fuelLube: number; totalOperating: number; totalCost: number; carriedBy: { cropId: string; name: string; share: number }[]; customShare: number }

const perAcre = (v: number, seasons: number) => (seasons > 0 ? v / seasons : 0);
const CATEGORY_ORDER: OperationCategory[] = ['cultural', 'harvest', 'assessment', 'postharvest', 'other'];

/** UC Table 1 for one crop: costs per acre, one planting, from the crop's operations and its shares of farm costs. */
export function buildTable1(plan: Plan, result: FarmResult, cropId: string): Table1 | null {
  const crop = plan.crops.find(c => c.id === cropId);
  const r = result.crops.find(c => c.cropId === cropId);
  if (!crop || !r) return null;
  const acres = toAcres(crop.area, plan.farm);
  const seasons = acres * crop.plantingsPerYear;
  const rates = machineRatesInPlan(plan);
  const ops = usesOperations(crop) ? crop.operations.filter(o => o.enabled) : [];
  const rows = ops.map(o => {
    const c = operationCost(o, plan.farm, plan.equipment, rates);
    const labor = c.parts.handLabor + c.parts.operatorLabor + c.parts.otherLabor;
    const flr = c.parts.machineRunning + c.parts.rent;
    const custom = c.parts.hiredMachine + c.parts.custom;
    return { category: o.category, row: { name: o.name, time: o.machineHoursPerAcre, labor, flr, materials: c.parts.materials, custom, total: c.perAcre } };
  });
  const groups: Table1Group[] = CATEGORY_ORDER.map(category => {
    const gr = rows.filter(x => x.category === category).map(x => x.row);
    const sum = (k: keyof Omit<Table1Row, 'name' | 'time'>) => gr.reduce((a, b) => a + b[k], 0);
    return { category, rows: gr, subtotal: { labor: sum('labor'), flr: sum('flr'), materials: sum('materials'), custom: sum('custom'), total: sum('total') } };
  }).filter(g => g.rows.length > 0);
  const opsMachineRunning = rows.reduce((a, x) => a + x.row.flr, 0) * seasons - r.costParts.rent;
  const repairPool = r.costParts.machineRunning - opsMachineRunning;
  const extra: Table1['extra'] = ([
    { key: 'ownLabor', amount: perAcre(r.costParts.ownLabor, seasons) },
    { key: 'hiredJobs', amount: perAcre(r.costParts.hiredJobs, seasons) },
    { key: 'lump', amount: perAcre(r.costParts.lump, seasons) },
    { key: 'repairPool', amount: repairPool > 0.5 ? perAcre(repairPool, seasons) : 0 },
    { key: 'interest', amount: perAcre(r.costParts.interest, seasons) },
  ] as Table1['extra']).filter(e => e.amount > 0);
  const cashOverhead = r.overheadItems.map(o => ({ id: o.id, name: o.name, amount: perAcre(o.amount, seasons) }));
  const nonCash = r.machines.filter(m => m.ownership > 0).map(m => ({ equipmentId: m.equipmentId, name: m.name, amount: perAcre(m.ownership, seasons) }));
  const est = r.establishment;
  const establishment = est ? { capitalRecovery: perAcre(est.capitalRecovery, seasons), insurance: perAcre(est.insurance, seasons), taxes: perAcre(est.taxes, seasons), total: perAcre(est.total, seasons) } : null;
  return {
    cropId, acres, plantings: crop.plantingsPerYear, seasons, groups, extra,
    totalOperating: perAcre(r.operating, seasons),
    cashOverhead, totalCashOverhead: perAcre(r.overheadShare, seasons),
    nonCash, establishment, totalNonCash: perAcre(r.equipmentShare + (est?.total ?? 0), seasons),
    totalCosts: perAcre(r.totalCost, seasons), grossReturns: perAcre(r.revenue, seasons),
    netAboveOperating: perAcre(r.revenue - r.operating, seasons), netAboveTotal: perAcre(r.net, seasons),
  };
}

/** UC Table 4: net return per acre for one crop across a grid of yields and prices, costs held where they are. */
export function buildRanging(plan: Plan, cropId: string, factors: number[] = [0.6, 0.8, 1, 1.2, 1.4]): Ranging | null {
  const crop = plan.crops.find(c => c.id === cropId);
  if (!crop) return null;
  const acres = toAcres(crop.area, plan.farm);
  const yields = factors.map(f => crop.yieldPerAcre * f);
  const prices = factors.map(f => crop.price * f);
  const net = yields.map(y => prices.map(p => {
    const trial = computePlan({ ...plan, crops: plan.crops.map(c => c.id === cropId ? { ...c, yieldPerAcre: y, price: p } : c) });
    const tc = trial.crops.find(c => c.cropId === cropId);
    return tc && acres > 0 ? tc.net / acres : 0;
  }));
  return { cropId, unit: crop.unit, yields, prices, net };
}

/** UC Table 5: what each machine costs to own each year, then the farm's business overhead. */
export function buildTable5(plan: Plan, result: FarmResult, landRentLabel: string, plantingLabel = (crop: string) => `Planting: ${crop}`): Table5 {
  const machines: Table5Row[] = plan.equipment.map(e => {
    const o = ownership(e, plan.farm);
    return { equipmentId: e.id, name: e.name, price: e.pricePaid, years: e.keepYears, salvage: Math.min(e.salvageValue, e.pricePaid), capitalRecovery: o.capitalRecovery + o.interestOnSalvage, insurance: o.insurance, taxes: o.taxes, repairs: o.repairsPerYear, total: o.totalPerYear + o.repairsPerYear };
  });
  // Perennial plantings are investments: accumulated establishment cost (plus removal) over the production years, salvage zero.
  const investments: Table5Row[] = result.crops.flatMap(r => {
    const crop = plan.crops.find(c => c.id === r.cropId);
    const est = crop?.establishment;
    if (!r.establishment || !est) return [];
    return [{ equipmentId: `planting-${r.cropId}`, name: plantingLabel(r.name), price: (est.accumulatedNetCostPerAcre + (est.removalCostPerAcre || 0)) * r.acres, years: est.productionYears, salvage: 0,
      capitalRecovery: r.establishment.capitalRecovery, insurance: r.establishment.insurance, taxes: r.establishment.taxes, repairs: 0, total: r.establishment.total }];
  });
  const all = [...machines, ...investments];
  const sum = (k: 'price' | 'salvage' | 'capitalRecovery' | 'insurance' | 'taxes' | 'repairs' | 'total') => all.reduce((a, m) => a + m[k], 0);
  const landRent = plan.farm.landRentPerAcre * result.totalAcres;
  const overhead = [
    ...(landRent > 0 ? [{ id: 'land-rent', name: landRentLabel, amount: landRent }] : []),
    ...(plan.farm.overheadItems ?? []).map(o => ({ id: o.id, name: o.name, amount: o.amountPerYear })),
  ];
  return { machines, investments, totals: { price: sum('price'), salvage: sum('salvage'), capitalRecovery: sum('capitalRecovery'), insurance: sum('insurance'), taxes: sum('taxes'), repairs: sum('repairs'), total: sum('total') }, overhead, overheadTotal: overhead.reduce((a, o) => a + o.amount, 0) };
}

/** UC Table 6: yearly costs spread over the hours each machine runs in this plan. */
export function buildTable6(plan: Plan, result: FarmResult): Table6Row[] {
  return result.machines.map(m => {
    const e = plan.equipment.find(x => x.id === m.equipmentId);
    const o = e ? ownership(e, plan.farm) : null;
    const h = m.hoursPerYear;
    const per = (v: number) => (h > 0 ? v / h : 0);
    return { equipmentId: m.equipmentId, name: m.name, hours: h, cropHours: m.cropHours, customHours: m.customHours,
      capitalRecovery: o ? per(o.capitalRecovery + o.interestOnSalvage) : 0, insurance: o ? per(o.insurance) : 0, taxes: o ? per(o.taxes) : 0,
      repairs: m.repairsPerHour, fuelLube: m.fuelLubePerHour, totalOperating: m.runPerHour, totalCost: m.allInPerHour,
      carriedBy: [...m.byCrop].filter(b => b.share > 0).sort((a, b) => b.share - a.share).slice(0, 3).map(b => ({ cropId: b.cropId, name: b.name, share: b.share })), customShare: m.customShare };
  });
}
export interface SourceStudy { title: string; year: number | null; region: string | null; url: string; items: { owner: string; what: string; value: string; page: number; quote: string }[] }
export interface MethodLine { name: string; quote: string; page: number; studyTitle: string }
export interface OurMethodLine { name: string; kind: string; formula: string }

export interface ExportSnapshot {
  title: string;
  county: string;
  dateText: string;
  created: string;
  lang: Lang;
  provisional: boolean;
  headline: string;
  draftNote: string | null;
  facts: Fact[];
  cropTable: { headers: string[]; rows: CropRow[]; total: CropRow };
  paperLoser: string | null;
  cashFlow: { months: string[]; rows: CashRow[]; excluded: string[]; intro: string };
  cropDetails: CropDetail[];
  equipment: EquipmentRow[];
  farm: { fields: LabeledValue[]; overheadItems: { name: string; amount: number; basis: string }[]; rules: string[]; rates: LabeledValue[] };
  sources: { studies: SourceStudy[]; methods: MethodLine[]; ours: OurMethodLine[]; oursTitle: string; oursIntro: string };
  table1: (Table1 & { name: string; unit: string; timing: { costs: number[] | null; sales: number[] | null } })[];
  ranging: (Ranging & { name: string })[];
  table5: Table5;
  table6: Table6Row[];
  customWork: FarmResult['customWork'];
  labels: Record<string, string>;
}

/** Keep text as text (including formula-looking names); writers never evaluate it. */
export const exportText = (value: string) => Array.from(value).filter(char => char.charCodeAt(0) >= 32 || '\t\n\r'.includes(char)).join('');
export function exportFilename(name: string, extension: 'pdf' | 'xlsx' | 'csv', date = new Date()) {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'farm-plan';
  return `${slug}-${date.toISOString().slice(0, 10)}.${extension}`;
}

const sum = (a: number[]) => a.reduce((p, q) => p + q, 0);
const round = (n: number) => Math.round(n);

export function createExportSnapshot(plan: Plan, result: FarmResult, lang: Lang, date = new Date()): ExportSnapshot {
  const dict = lang === 'es' ? es : en;
  const t = (key: Key, vars?: Record<string, string>): string => (dict[key] as string).replace(/\{(\w+)\}/g, (m, k) => vars?.[k] ?? m);
  const x = (field: string) => t(`export.${field}` as Key);
  const locale = lang === 'es' ? 'es-US' : 'en-US';
  const moneyText = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(round(n)).toLocaleString('en-US')}`;
  const numText = (n: number, digits = 2) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
  const pctText = (fraction: number) => `${numText(fraction * 100, 3)}%`;
  const cropName = (crop: Crop) => exportText(lang === 'es' ? cropNames[crop.typeId] ?? crop.name : crop.name);
  const nameFor = (id: string, fallback: string) => { const c = plan.crops.find(c => c.id === id); return c ? cropName(c) : exportText(fallback); };
  const equipmentName = (id: string, fallback: string) => exportText(plan.equipment.find(e => e.id === id)?.name ?? fallback);
  const basisWord = (b: 'acres' | 'revenue' | 'hours') => t(`basis.${b}` as Key);
  const equipmentBasisWord = (b: 'hours' | 'acres' | 'revenue') => b === 'hours' ? t('basis.hoursFallback', { fallback: basisWord(plan.farm.overheadBasis) }) : basisWord(b);
  const months = Array.from({ length: 12 }, (_, i) => t(`month.${i}` as Key));
  const monthLong = (i: number) => t(`monthLong.${i}` as Key);
  const missing = missingPlanInputs(plan);
  const provisional = missing.length > 0;

  // ---- summary ----
  const title = exportText(plan.farm.name || t('app.title'));
  const dateText = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date);
  const headline = provisional ? t('inputs.provisional')
    : result.net < 0 ? `${t('results.answer.loss.before')}${moneyText(-result.net)}${t('results.answer.loss.after')}`
    : `${t('results.answer.before')}${moneyText(result.net)}${t('results.answer.after')}`;
  const lowest = result.lowestCashPoint;
  const facts: Fact[] = [
    { label: t('results.sales'), value: round(result.revenue), kind: 'money' },
    { label: t('results.allCosts'), value: round(result.totalCost), kind: 'expense' },
    { label: t('summary.net'), value: round(result.net), kind: 'net' },
    { label: t('common.acres'), value: Math.round(result.totalAcres * 100) / 100, kind: 'number' },
    ...(result.cashCoverage.withMonths > 0 ? [{ label: t('results.lowestCash', { month: monthLong(lowest.month) }), value: round(lowest.cumulative), kind: 'net' as const }] : []),
    ...(result.customWork.income > 0 ? [{ label: t('uc.cw.income'), value: round(result.customWork.net), kind: 'net' as const }] : []),
  ];
  const cropRow = (c: CropResult): CropRow => {
    const p = c.costParts;
    return { name: nameFor(c.cropId, c.name), acres: c.acres, sales: c.revenue, costs: c.totalCost, net: c.net, perAcre: c.acres > 0 ? c.net / c.acres : 0, breakEvenPrice: c.breakEvenPrice,
      operating: p.materials + p.handLabor + p.operatorLabor + p.otherLabor + p.lump + p.interest, ownLabor: p.ownLabor, machineRunning: p.machineRunning + p.rent, hiredWork: p.hiredMachine + p.custom + p.hiredJobs, overheadShare: c.overheadShare, equipmentShare: c.equipmentShare };
  };
  const rows = [...result.crops].sort((a, b) => b.net - a.net).map(cropRow);
  const total: CropRow = {
    name: t('results.table.wholeFarm'), acres: result.totalAcres, sales: result.revenue, costs: result.totalCost, net: result.net,
    perAcre: result.totalAcres > 0 ? result.net / result.totalAcres : 0, breakEvenPrice: 0,
    operating: sum(rows.map(r => r.operating)), ownLabor: sum(rows.map(r => r.ownLabor)), machineRunning: sum(rows.map(r => r.machineRunning)), hiredWork: sum(rows.map(r => r.hiredWork)),
    overheadShare: sum(rows.map(r => r.overheadShare)), equipmentShare: sum(rows.map(r => r.equipmentShare)),
  };
  const loser = [...result.crops].sort((a, b) => b.net - a.net).find(c => c.net < 0 && c.contribution > 0);
  const paperLoser = loser ? `${t('results.paperLoser', { crop: nameFor(loser.cropId, loser.name) })} ${t('results.paperLoser.text', { amount: moneyText(loser.overheadShare + loser.equipmentShare) })}` : null;

  // ---- cash flow ----
  const timed = result.crops.filter(c => c.monthly);
  const excluded = result.crops.filter(c => !c.hasMonths).map(c => nameFor(c.cropId, c.name));
  const cashRows: CashRow[] = [
    ...timed.flatMap((c): CashRow[] => [
      { label: t('results.cashFlow.in', { crop: nameFor(c.cropId, c.name) }), values: c.monthly!.revenue, total: sum(c.monthly!.revenue), kind: 'in' },
      { label: t('results.cashFlow.out', { crop: nameFor(c.cropId, c.name) }), values: c.monthly!.costs.map(v => -v), total: -sum(c.monthly!.costs), kind: 'out' },
    ]),
    ...(timed.length ? [
      { label: t('results.cashFlow.fixed'), values: result.monthlyOverhead.map(v => -v), total: -sum(result.monthlyOverhead), kind: 'fixed' as const },
      { label: t('results.cashFlow.net'), values: result.monthlyCash, total: sum(result.monthlyCash), kind: 'net' as const },
      { label: t('results.cashFlow.balance'), values: result.runningCash, total: result.runningCash[11] ?? 0, kind: 'balance' as const },
    ] : []),
  ];

  // ---- crop details ----
  const channel = (c: Crop) => t(`channel.${c.channel}` as Key);
  const unitWord = (c: Crop) => exportText(c.unit);
  const areaUnit = t(plan.farm.areaUnit === 'acres' ? 'farm.landUnit.acres' : plan.farm.areaUnit === 'beds' ? 'farm.landUnit.beds' : 'farm.landUnit.rows').toLowerCase();
  const inputText = (item: Crop | Equipment, field: string, format: (n: number) => string) =>
    isMissing(item, field) ? x('missing') : format((item as unknown as Record<string, number>)[field]);
  const machineRateMap = machineRatesInPlan(plan);
  const cropDetails: CropDetail[] = plan.crops.map(c => {
    const r = result.crops.find(k => k.cropId === c.id);
    const study = studyById(c.studyId);
    const studyText = study ? exportText([study.source.title, study.source.year, study.source.region].filter(v => v != null).join(', ')) : x('noStudy');
    const inputs: LabeledValue[] = [
      { label: t('crops.area'), value: `${inputText(c, 'area', n => numText(n))} ${c.area === 1 && plan.farm.areaUnit === 'acres' ? t('common.acre') : areaUnit}` },
      { label: t('crops.plantings'), value: inputText(c, 'plantingsPerYear', n => numText(n)) },
      { label: t('crops.yield'), value: `${inputText(c, 'yieldPerAcre', n => numText(n))} ${unitWord(c)} ${t('common.perAcre')}` },
      { label: t('crops.price'), value: `${inputText(c, 'price', n => `$${numText(n)}`)} / ${unitWord(c)}` },
      { label: t('crops.channel'), value: channel(c) },
      ...(usesOperations(c) ? [] : [{ label: x('operatingCostPerAcre'), value: inputText(c, 'operatingCostPerAcre', n => `$${numText(n)}`) }]),
      { label: t('crops.ownHours'), value: inputText(c, 'ownLaborHoursPerAcre', n => numText(n)) },
      { label: x('study'), value: studyText },
    ];
    const row = r ? cropRow(r) : null;
    const partKeys = ['materials', 'handLabor', 'operatorLabor', 'machineRunning', 'rent', 'hiredMachine', 'custom', 'otherLabor', 'ownLabor', 'hiredJobs', 'lump', 'interest'] as const;
    const breakdown: BreakdownLine[] = row ? [
      ...partKeys.filter(k => r!.costParts[k] > 0).map((k): BreakdownLine => ({ label: t(`ops.part.${k}` as Key), amount: r!.costParts[k], group: 'operating' })),
      ...(r!.overheadItems.map((o): BreakdownLine => ({ label: o.id === 'land-rent' ? t('results.breakdown.landRent') : exportText(o.name || x('item')), amount: o.amount, basis: basisWord(o.basis), group: 'overhead' }))),
      ...(r!.establishment ? [{ label: t('results.breakdown.establishment'), amount: r!.establishment.total, group: 'establishment' as const }] : []),
      ...(r!.machines.flatMap((m): BreakdownLine[] => {
        const name = equipmentName(m.equipmentId, m.name);
        const basis = plan.farm.equipmentBasis === 'hours' && m.hours > 0 ? basisWord('hours') : basisWord(plan.farm.equipmentBasis === 'revenue' ? 'revenue' : 'acres');
        return [
          { label: `${name}: ${t('results.breakdown.capitalRecovery')}`, amount: m.capitalRecovery, basis, group: 'machine' },
          { label: `${name}: ${t('results.breakdown.interestOnSalvage')}`, amount: m.interestOnSalvage, basis, group: 'machine' },
          { label: `${name}: ${t('results.breakdown.insurance')}`, amount: m.insurance, basis, group: 'machine' },
          { label: `${name}: ${t('results.breakdown.propertyTax')}`, amount: m.taxes, basis, group: 'machine' },
        ];
      })),
    ] : [];
    return {
      id: c.id, name: cropName(c), inputs, breakdown,
      timing: { costs: c.costMonths, sales: c.revenueMonths },
      machineHours: c.machineHours.map(m => ({ label: equipmentName(m.equipmentId, m.equipmentId), value: `${numText(m.hoursPerAcre)} ${x('hoursPerAcreShort')}` })),
      hiredJobs: c.customHire.map(h => ({ label: exportText(h.name || x('item')), value: `$${numText(h.costPerAcre)} ${t('common.perAcre')}` })),
      operations: (c.operations ?? []).map((o): OperationLine => {
        const cost = operationCost(o, plan.farm, plan.equipment, machineRateMap);
        const seasons = toAcres(c.area, plan.farm) * c.plantingsPerYear;
        const who = o.machineHoursPerAcre <= 0 ? '' : cost.mode === 'own' && o.equipmentId ? equipmentName(o.equipmentId, o.equipmentId) : cost.mode === 'rent' ? t('ops.rented') : t('ops.hired');
        return { name: exportText(o.name || x('item')), category: t(`ops.category.${o.category}` as Key), who,
          enabled: o.enabled, machineHours: o.machineHoursPerAcre, operatorHours: cost.mode !== 'hire' ? o.operatorHoursPerAcre : 0, handHours: o.handHoursPerAcre, materials: o.materialsPerAcre, custom: o.customPerAcre,
          costPerAcre: o.enabled ? cost.perAcre : 0, costForYear: o.enabled ? cost.perAcre * seasons : 0 };
      }),
    };
  });

  // ---- equipment ----
  const table6 = buildTable6(plan, result);
  const equipment: EquipmentRow[] = plan.equipment.map(e => {
    const o = ownership(e, plan.farm);
    const m = result.machines.find(k => k.equipmentId === e.id);
    const t6 = table6.find(k => k.equipmentId === e.id);
    const carried = t6 ? [...t6.carriedBy.map(b => `${nameFor(b.cropId, b.name)} ${Math.round(b.share * 100)}%`), ...(t6.customShare > 0 ? [`${t('uc.t6.custom')} ${Math.round(t6.customShare * 100)}%`] : [])].join(', ') : '';
    return { name: exportText(e.name), condition: x(e.condition === 'new' ? 'conditionNew' : 'conditionUsed'), paid: e.pricePaid, year: e.yearBought, keepYears: e.keepYears,
      hoursPerYear: m?.hoursPerYear ?? 0, cropHours: m?.cropHours ?? 0, customHours: m?.customHours ?? 0,
      salvage: e.salvageValue, fuelLube: e.fuelLubePerHour, repairsPct: e.repairsPctPerYear, repairsPerYear: o.repairsPerYear, repairsPerHour: m?.repairsPerHour ?? 0,
      capitalRecovery: o.capitalRecovery, interestOnSalvage: o.interestOnSalvage, insurance: o.insurance, taxes: o.taxes,
      totalPerYear: o.totalPerYear, ownPerHour: m?.ownPerHour ?? 0, allInPerHour: m?.allInPerHour ?? 0,
      capitalRecoveryPerHour: t6?.capitalRecovery ?? 0, insurancePerHour: t6?.insurance ?? 0, taxesPerHour: t6?.taxes ?? 0, carriedBy: carried };
  });
  const table1 = plan.crops.map(c => { const tb = buildTable1(plan, result, c.id); return tb ? { ...tb, name: cropName(c), unit: exportText(c.unit), timing: { costs: c.costMonths, sales: c.revenueMonths } } : null; }).filter((v): v is NonNullable<typeof v> => v !== null);
  const ranging = plan.crops.slice(0, 3).map(c => { const rg = buildRanging(plan, c.id); return rg ? { ...rg, name: cropName(c) } : null; }).filter((v): v is NonNullable<typeof v> => v !== null);
  const table5 = buildTable5(plan, result, t('uc.t5.landRent'), crop => t('uc.t5.planting', { crop: nameFor(plan.crops.find(c => c.name === crop)?.id ?? '', crop) }));
  const customWork = { ...result.customWork, jobs: result.customWork.jobs.map(j => ({ ...j, name: exportText(j.name), machineName: exportText(j.machineName) })) };

  // ---- farm ----
  const f = plan.farm;
  const farmFields: LabeledValue[] = [
    { label: t('farm.county'), value: exportText(f.county) },
    { label: t('farm.landUnit'), value: t(f.areaUnit === 'acres' ? 'farm.landUnit.acres' : f.areaUnit === 'beds' ? 'farm.landUnit.beds' : 'farm.landUnit.rows') },
    ...(f.areaUnit === 'beds' ? [{ label: x('bedLengthFt'), value: numText(f.bedLengthFt) }, { label: x('bedWidthIn'), value: numText(f.bedWidthIn) }] : []),
    { label: t('farm.rent'), value: `${moneyText(f.landRentPerAcre)} ${t('common.perAcre')}` },
    { label: t('farm.ownRate'), value: `$${numText(f.ownLaborRate)} / ${x('hour')}` },
    { label: t('farm.hiredRate'), value: `$${numText(f.hiredLaborRate)} / ${x('hour')}` },
  ];
  const rates: LabeledValue[] = [
    { label: t('farm.interest'), value: pctText(f.interestRate) },
    { label: t('farm.payroll'), value: pctText(f.payrollOverhead) },
    { label: t('farm.insuranceRate'), value: pctText(f.insuranceRate) },
    { label: t('farm.propertyTaxRate'), value: pctText(f.propertyTaxRate) },
  ];
  const rules = [t('results.breakdown.rule', { overhead: basisWord(f.overheadBasis), equipment: equipmentBasisWord(f.equipmentBasis) })];
  const overheadItems = (f.overheadItems ?? []).map(o => ({ name: exportText(o.name || x('item')), amount: o.amountPerYear, basis: basisWord(o.basis) }));

  // ---- sources ----
  const studies = new Map<string, SourceStudy>();
  const addCitation = (owner: string, field: string, citation: Citation | undefined, current: number | null | undefined) => {
    if (!citation) return;
    const key = citation.studyId || citation.url;
    if (!studies.has(key)) studies.set(key, { title: exportText(citation.title), year: citation.year, region: citation.region ? exportText(citation.region) : null, url: citation.url, items: [] });
    const status = current == null ? '' : sourceStatus(current, citation) === 'study' ? '' : ` (${t('source.yours')}: ${numText(current, 4)})`;
    const value = citation.value == null ? '' : numText(citation.value, 4);
    studies.get(key)!.items.push({ owner, what: exportText(citation.field || field), value: `${value}${status}`, page: citation.page, quote: exportText(citation.quote) });
  };
  for (const [field, citation] of Object.entries(f.citations)) addCitation(t('farm.title'), field, citation, sourceDisplayValue(f, field));
  for (const o of f.overheadItems ?? []) addCitation(exportText(o.name || x('item')), 'amountPerYear', o.citation, o.amountPerYear);
  for (const c of plan.crops) for (const [field, citation] of Object.entries(c.citations)) addCitation(cropName(c), field, citation, field === 'months' ? null : (isMissing(c, field) ? null : sourceDisplayValue(c, field)));
  for (const e of plan.equipment) for (const [field, citation] of Object.entries(e.citations)) addCitation(exportText(e.name), field, citation, isMissing(e, field) ? null : sourceDisplayValue(e, field));
  const methods: MethodLine[] = METHOD.map(m => ({ name: t(`sources.method.${m.key}` as Key), quote: exportText(m.quote), page: m.page, studyTitle: exportText(m.citation.title) }));

  const labels: Record<string, string> = {
    summary: x('summary'), cashFlow: x('cashFlow'), cropDetails: x('cropDetails'), equipment: x('sheetEquipment'), farm: x('sheetFarm'), sources: x('sources'),
    crops: x('sheetCrops'), timing: x('timing'), metric: x('metric'), month: x('month'), total: x('total'),
    crop: t('results.table.crop'), acres: t('common.acres'), sales: t('results.table.sales'), costs: t('results.table.costs'), left: t('results.table.left'), perAcre: t('results.table.perAcre'),
    breakEven: x('breakEven'), operating: t('results.col.operating'), ownLabor: x('ownLabor'), machineRunning: x('machineRunning'), hiredWork: x('hiredWork'),
    overheadShare: t('results.col.overhead'), equipmentShare: t('results.col.equipment'), inputs: x('inputs'), whereMoneyGoes: x('whereMoneyGoes'),
    timingCosts: x('timingCosts'), timingSales: x('timingSales'), machineHours: x('machineHoursTitle'), hiredJobs: x('hiredJobsTitle'), basis: x('basis'), amount: x('amount'),
    machine: t('results.machine'), condition: x('condition'), paid: t('equip.paid'), year: t('equip.year'), keepYears: t('equip.keep'), hoursPerYear: t('results.hoursAYear'), salvage: t('equip.salvage'),
    fuelLube: t('equip.fuel'), repairs: t('equip.repairs'), capitalRecovery: t('results.breakdown.capitalRecovery'), interestOnSalvage: t('results.breakdown.interestOnSalvage'),
    insurance: t('results.breakdown.insurance'), taxes: t('results.breakdown.propertyTax'), totalPerYear: t('equip.breakdown.total'), ownPerHour: t('results.owning'), allInPerHour: t('results.allIn'),
    overheadItems: x('overheadItems'), rules: x('rules'), rates: x('rates'), item: x('item'), study: x('study'), field: x('what'), citedValue: x('citedValue'), page: x('page'), quote: x('quote'), url: x('url'),
    methods: t('sources.formulas'), notInView: x('notInView'), chart: x('chartTitle'), footer: x('footer'), pageOf: x('pageOf'), publisher: x('publisher'), formatLine: x('formatLine'), costsAndReturns: x('costsAndReturns'), prepared: x('prepared'), preparedWith: x('preparedWith'), continued: x('continued'), yourCost: x('yourCost'), farmSummary: x('farmSummary'), owner: x('name'), csvNote: x('csvNote'), wholeFarm: t('results.table.wholeFarm'),
    hoursPerAcre: x('hoursPerAcreShort'), value: x('value'), noStudy: x('noStudy'),
    operations: x('operations'), operation: x('operation'), who: x('who'), machineHoursCol: x('machineHoursCol'), operatorHoursCol: x('operatorHoursCol'), handHoursCol: x('handHoursCol'),
    materialsCol: x('materialsCol'), customCol: x('customCol'), costPerAcre: x('costPerAcre'), costForYear: x('costForYear'), category: x('category'), offLine: x('offLine'),
    ucTables: t('uc.tables'), ucIntro: t('uc.tables.intro'),
    t1Title: t('uc.table1', { crop: '{crop}' }), t1Caption: t('uc.table1.caption'), t1Operation: t('uc.col.operation'), t1Time: t('uc.col.time'), t1Labor: t('uc.col.labor'), t1Flr: t('uc.col.flr'), t1Materials: t('uc.col.materials'), t1Custom: t('uc.col.custom'), t1Total: t('uc.col.total'),
    t1Cultural: t('uc.row.cultural'), t1Harvest: t('uc.row.harvest'), t1Assessment: t('uc.row.assessment'), t1Postharvest: t('uc.row.postharvest'), t1Other: t('uc.row.other'), t1Subtotal: t('uc.row.subtotal', { group: '{group}' }),
    t1OwnLabor: t('uc.row.ownLabor'), t1HiredJobs: t('uc.row.hiredJobs'), t1Lump: t('uc.row.lump'), t1RepairPool: t('uc.row.repairPool'), t1Interest: t('uc.row.interest'), t1TotalOperating: t('uc.row.totalOperating'),
    t1CashOverhead: t('uc.row.cashOverhead'), t1TotalCashOverhead: t('uc.row.totalCashOverhead'), t1NonCash: t('uc.row.nonCashOverhead'), t1TotalNonCash: t('uc.row.totalNonCash'), t1TotalCosts: t('uc.row.totalCosts'),
    t1Gross: t('uc.row.grossReturns'), t1NetOperating: t('uc.row.netAboveOperating'), t1NetTotal: t('uc.row.netAboveTotal'), t1PerAcreNote: t('uc.perAcreNote', { acres: '{acres}', plantings: '{plantings}' }), t1LandRent: t('uc.t5.landRent'),
    t3Title: t('uc.table3'), t3Caption: t('uc.table3.caption'),
    t4Title: t('uc.table4', { crop: '{crop}' }), t4Caption: t('uc.table4.caption'), t4Yield: t('uc.ranging.yield', { unit: '{unit}' }), t4Price: t('uc.ranging.price', { unit: '{unit}' }), t4Net: t('uc.ranging.netPerAcre'),
    t5Title: t('uc.table5'), t5Caption: t('uc.table5.caption'), t5Investments: t('uc.t5.investments'), t1Establishment: t('uc.row.establishment'), t5Description: t('uc.t5.description'), t5Price: t('uc.t5.price'), t5Years: t('uc.t5.years'), t5Salvage: t('uc.t5.salvage'), t5CapitalRecovery: t('uc.t5.capitalRecovery'), t5Insurance: t('uc.t5.insurance'), t5Taxes: t('uc.t5.taxes'), t5Repairs: t('uc.t5.repairs'), t5Total: t('uc.t5.total'), t5EquipmentTotal: t('uc.t5.equipmentTotal'), t5Overhead: t('uc.t5.overhead'), t5OverheadTotal: t('uc.t5.overheadTotal'),
    t6Title: t('uc.table6'), t6Caption: t('uc.table6.caption'), t6Machine: t('uc.t6.machine'), t6Hours: t('uc.t6.hours'), t6HoursSplit: t('uc.t6.hoursSplit', { crop: '{crop}', custom: '{custom}' }), t6CapitalRecovery: t('uc.t6.capitalRecovery'), t6Insurance: t('uc.t6.insurance'), t6Taxes: t('uc.t6.taxes'), t6Repairs: t('uc.t6.repairs'), t6FuelLube: t('uc.t6.fuelLube'), t6TotalOperating: t('uc.t6.totalOperating'), t6TotalCost: t('uc.t6.totalCost'), t6CarriedBy: t('uc.t6.carriedBy'), t6None: t('uc.t6.none'), t6Custom: t('uc.t6.custom'),
    cwTitle: t('uc.customWork'), cwCaption: t('uc.customWork.caption'), cwJob: t('uc.cw.job'), cwMachine: t('uc.cw.machine'), cwHours: t('uc.cw.hours'), cwPaid: t('uc.cw.paid'), cwCost: t('uc.cw.cost'), cwCostNote: t('uc.cw.costNote'), cwNet: t('uc.cw.net'), cwTotal: t('uc.cw.total'),
    perHour: t('uc.perHour'), sheetTable1Note: t('uc.sheet.table1Note'), sheetRangingNote: t('uc.sheet.rangingNote'), repairsPct: t('sources.field.repairsPctPerYear'),
  };

  return {
    title, county: exportText(f.county), dateText, created: date.toISOString(), lang, provisional, headline,
    draftNote: provisional ? t('inputs.draftHint') : null,
    facts, cropTable: { headers: [labels.crop, labels.acres, labels.sales, labels.costs, labels.left, labels.perAcre], rows, total }, paperLoser,
    cashFlow: { months, rows: cashRows, excluded, intro: t('results.cashFlow.intro') },
    cropDetails, equipment, table1, ranging, table5, table6: table6.map(r => ({ ...r, name: exportText(r.name), carriedBy: r.carriedBy.map(b => ({ ...b, name: nameFor(b.cropId, b.name) })) })), customWork,
    farm: { fields: farmFields, overheadItems, rules, rates },
    sources: { studies: [...studies.values()], methods, oursTitle: t('sources.ours'), oursIntro: t('sources.ours.intro'),
      ours: APP_METHODS.map(m => ({ name: t(`sources.ours.${m.key}` as Key), kind: t(m.kind === 'assumption' ? 'sources.ours.assumption' : 'sources.ours.standard'), formula: m.formula })) },
    labels,
  };
}

/** The horizontal cash flow table as CSV with a byte-order mark so Excel opens it as UTF-8. */
export function buildCashFlowCsv(snapshot: ExportSnapshot): Uint8Array<ArrayBuffer> {
  const q = (v: string | number) => typeof v === 'number' ? String(Math.round(v)) : `"${v.replace(/"/g, '""')}"`;
  const lines = [
    [snapshot.title, snapshot.dateText].map(q).join(','),
    [snapshot.labels.cashFlow, ...snapshot.cashFlow.months, snapshot.labels.total].map(q).join(','),
    ...snapshot.cashFlow.rows.map(r => [r.label, ...r.values, r.total].map(q).join(',')),
    ...(snapshot.cashFlow.excluded.length ? ['', `${snapshot.labels.notInView}: ${snapshot.cashFlow.excluded.join(', ')}`].map(q).join(',') : []),
  ];
  const text = '﻿' + lines.join('\r\n') + '\r\n';
  const bytes = new TextEncoder().encode(text);
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return out;
}
