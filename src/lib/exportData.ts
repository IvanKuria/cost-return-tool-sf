import { en, type Key } from '../i18n/en';
import { es } from '../i18n/es';
import { cropNames } from '../i18n/names';
import type { Lang } from '../i18n';
import { studyById } from '../data/studies';
import type { Citation, Crop, Equipment, FarmResult, Plan } from './types';
import { isMissing, missingPlanInputs } from './inputs';
import { APP_METHODS } from './methods';
import { METHOD, operationCost, ownership, toAcres, usesOperations } from './engine';
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
export interface BreakdownLine { label: string; amount: number; basis?: string; group: 'operating' | 'overhead' | 'machine' }
export interface OperationLine { name: string; category: string; who: string; enabled: boolean; machineHours: number; operatorHours: number; handHours: number; materials: number; custom: number; costPerAcre: number; costForYear: number }
export interface CropDetail { id: string; name: string; inputs: LabeledValue[]; breakdown: BreakdownLine[]; timing: { costs: number[] | null; sales: number[] | null }; machineHours: LabeledValue[]; hiredJobs: LabeledValue[]; operations: OperationLine[] }
export interface EquipmentRow { name: string; condition: string; paid: number; year: number; keepYears: number; hoursPerYear: number; salvage: number; fuelLube: number; repairs: number; capitalRecovery: number; interestOnSalvage: number; insurance: number; taxes: number; totalPerYear: number; ownPerHour: number; allInPerHour: number }
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
  ];
  const cropRow = (c: FarmResult['crops'][number]): CropRow => {
    const crop = plan.crops.find(p => p.id === c.cropId);
    const seasons = crop ? toAcres(crop.area, plan.farm) * crop.plantingsPerYear : 0;
    const ownLabor = crop ? seasons * crop.ownLaborHoursPerAcre * plan.farm.ownLaborRate : 0;
    return { name: nameFor(c.cropId, c.name), acres: c.acres, sales: c.revenue, costs: c.totalCost, net: c.net, perAcre: c.acres > 0 ? c.net / c.acres : 0, breakEvenPrice: c.breakEvenPrice,
      operating: c.operating - ownLabor - c.machineRunning - c.customHire, ownLabor, machineRunning: c.machineRunning, hiredWork: c.customHire, overheadShare: c.overheadShare, equipmentShare: c.equipmentShare };
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
    const partKeys = ['materials', 'handLabor', 'operatorLabor', 'machineRunning', 'hiredMachine', 'custom', 'otherLabor', 'ownLabor', 'hiredJobs', 'lump'] as const;
    const breakdown: BreakdownLine[] = row ? [
      ...partKeys.filter(k => r!.costParts[k] > 0).map((k): BreakdownLine => ({ label: t(`ops.part.${k}` as Key), amount: r!.costParts[k], group: 'operating' })),
      ...(r!.overheadItems.map((o): BreakdownLine => ({ label: o.id === 'land-rent' ? t('results.breakdown.landRent') : exportText(o.name || x('item')), amount: o.amount, basis: basisWord(o.basis), group: 'overhead' }))),
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
        const cost = operationCost(o, plan.farm, plan.equipment);
        const seasons = toAcres(c.area, plan.farm) * c.plantingsPerYear;
        return { name: exportText(o.name || x('item')), category: t(`ops.category.${o.category}` as Key), who: o.machineHoursPerAcre > 0 ? (o.equipmentId ? equipmentName(o.equipmentId, o.equipmentId) : t('ops.hired')) : '',
          enabled: o.enabled, machineHours: o.machineHoursPerAcre, operatorHours: o.equipmentId ? o.operatorHoursPerAcre : 0, handHours: o.handHoursPerAcre, materials: o.materialsPerAcre, custom: o.customPerAcre,
          costPerAcre: o.enabled ? cost.perAcre : 0, costForYear: o.enabled ? cost.perAcre * seasons : 0 };
      }),
    };
  });

  // ---- equipment ----
  const equipment: EquipmentRow[] = plan.equipment.map(e => {
    const o = ownership(e, plan.farm);
    return { name: exportText(e.name), condition: x(e.condition === 'new' ? 'conditionNew' : 'conditionUsed'), paid: e.pricePaid, year: e.yearBought, keepYears: e.keepYears, hoursPerYear: e.hoursPerYear,
      salvage: e.salvageValue, fuelLube: e.fuelLubePerHour, repairs: e.repairsPerHour, capitalRecovery: o.capitalRecovery, interestOnSalvage: o.interestOnSalvage, insurance: o.insurance, taxes: o.taxes,
      totalPerYear: o.totalPerYear, ownPerHour: o.ownPerHour, allInPerHour: o.allInPerHour };
  });

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
    methods: t('sources.formulas'), notInView: x('notInView'), chart: x('chartTitle'), footer: x('footer'), pageOf: x('pageOf'), owner: x('name'), csvNote: x('csvNote'), wholeFarm: t('results.table.wholeFarm'),
    hoursPerAcre: x('hoursPerAcreShort'), value: x('value'), noStudy: x('noStudy'),
    operations: x('operations'), operation: x('operation'), who: x('who'), machineHoursCol: x('machineHoursCol'), operatorHoursCol: x('operatorHoursCol'), handHoursCol: x('handHoursCol'),
    materialsCol: x('materialsCol'), customCol: x('customCol'), costPerAcre: x('costPerAcre'), costForYear: x('costForYear'), category: x('category'), offLine: x('offLine'),
  };

  return {
    title, county: exportText(f.county), dateText, created: date.toISOString(), lang, provisional, headline,
    draftNote: provisional ? t('inputs.draftHint') : null,
    facts, cropTable: { headers: [labels.crop, labels.acres, labels.sales, labels.costs, labels.left, labels.perAcre], rows, total }, paperLoser,
    cashFlow: { months, rows: cashRows, excluded, intro: t('results.cashFlow.intro') },
    cropDetails, equipment,
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
