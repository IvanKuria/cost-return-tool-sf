import { en, type Key } from '../i18n/en';
import { es } from '../i18n/es';
import { cropNames } from '../i18n/names';
import type { Lang } from '../i18n';
import type { Crop, Equipment, Farm, FarmResult, Plan } from './types';
import { isMissing, missingPlanInputs } from './inputs';
import { METHOD } from './engine';
import { sourceDisplayValue, sourceStatus, sourceUnitChanged } from './source';

export type ExportCell = string | number | null;
export interface ExportTable { name: string; headers: string[]; rows: ExportCell[][]; notes?: string[]; formats?: (string | null)[][] }
export interface ExportSnapshot { title: string; subtitle: string; created: string; lang: Lang; provisional: boolean; tables: ExportTable[] }

/** Keep text as text (including formula-looking names); writers never evaluate it. */
export const exportText = (value: string) => Array.from(value).filter(char => char.charCodeAt(0) >= 32 || '\t\n\r'.includes(char)).join('');
export function exportFilename(name: string, extension: 'pdf' | 'xlsx', date = new Date()) {
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'farm-plan';
  return `${slug}-${date.toISOString().slice(0, 10)}.${extension}`;
}

export function createExportSnapshot(plan: Plan, result: FarmResult, lang: Lang, date = new Date()): ExportSnapshot {
  const dict = lang === 'es' ? es : en;
  const t = (key: Key): string => dict[key];
  const x = (field: string) => t(`export.${field}` as Key) ?? field;
  const cropName = (crop: Crop) => lang === 'es' ? cropNames[crop.typeId] ?? crop.name : crop.name;
  const nameFor = (id: string, fallback: string) => { const c = plan.crops.find(c => c.id === id); return c ? cropName(c) : fallback; };
  const missing = missingPlanInputs(plan);
  const included = result.crops.filter(c => c.hasMonths).map(c => nameFor(c.cropId, c.name));
  const excluded = result.crops.filter(c => !c.hasMonths).map(c => nameFor(c.cropId, c.name));
  const tables: ExportTable[] = [{ name: x('summary'), headers: [x('field'), x('value')], rows: [
    [t('results.sales'), result.revenue], [t('results.allCosts'), result.totalCost], [t('summary.net'), result.net],
    [t('common.acres'), result.totalAcres], [x('status'), t(missing.length ? 'inputs.provisional' : 'summary.title')],
    [x('included'), included.join(', ') || x('none')], [x('excluded'), excluded.join(', ') || x('none')],
  ], notes: [t('export.snapshot'), ...(missing.length ? [t('inputs.draftHint')] : [])] }];
  tables.push({ name: x('crops'), headers: [x('name'), t('common.acres'), t('results.sales'), t('results.col.operating'), t('results.col.overhead'), t('results.col.equipment'), t('results.allCosts'), t('summary.net')], rows: result.crops.map(c => [nameFor(c.cropId, c.name), c.acres, c.revenue, c.operating, c.overheadShare, c.equipmentShare, c.totalCost, c.net]) });
  tables.push({ name: x('equipment'), headers: [x('name'), x('hoursPerYear'), x('ownPerYear'), x('ownPerHour'), x('runPerHour'), x('allInPerHour')], rows: result.machines.map(m => [plan.equipment.find(e => e.id === m.equipmentId)?.name ?? m.name, m.hoursPerYear, m.ownPerYear, m.ownPerHour, m.runPerHour, m.allInPerHour]) });
  let balance = 0;
  tables.push({ name: x('cash'), headers: [x('month'), t('chart.monthly'), t('chart.cumulative')], rows: result.cashCoverage.withMonths ? result.monthlyCash.map((value, i) => [t(`monthLong.${i}` as Key), value, balance += value]) : [], notes: [
    `${x('included')}: ${included.join(', ') || x('none')}`, `${x('excluded')}: ${excluded.join(', ') || x('none')}`,
    t('chart.cumulativeHelp'), t('chart.assumptions'),
  ] });
  const inputRows = (item: Farm | Crop | Equipment, name: string, fields: string[]): ExportCell[][] => fields.map(field => {
    const value = (item as unknown as Record<string, unknown>)[field];
    const absent = isMissing(item, field) || (typeof value === 'number' && !Number.isFinite(value));
    const citation = (item.citations as Record<string, import('./types').Citation | undefined>)[field];
    const status = absent ? x('missing') : sourceUnitChanged(item, field) ? t('source.restoreUnitHint') : sourceStatus(sourceDisplayValue(item, field), citation) === 'study' ? t('source.fromStudy') : t('source.yours');
    return [name, x(field), absent ? null : typeof value === 'number' ? value : String(value ?? ''), status];
  });
  const headers = [x('name'), x('field'), x('value'), x('status')];
  tables.push({ name: x('farmInputs'), headers, rows: [
    [plan.farm.name, t('farm.county'), plan.farm.county, x('entered')], [plan.farm.name, t('farm.landUnit'), t(plan.farm.areaUnit === 'acres' ? 'farm.landUnit.acres' : plan.farm.areaUnit === 'beds' ? 'farm.landUnit.beds' : 'farm.landUnit.rows'), x('entered')],
    ...inputRows(plan.farm, plan.farm.name, ['bedLengthFt', 'bedWidthIn', 'interestRate', 'ownLaborRate', 'hiredLaborRate', 'payrollOverhead', 'landRentPerAcre', 'otherOverheadPerYear']),
  ], notes: [x('blankNote'), t('farm.hiredRate.hint')] });
  tables.push({ name: x('cropInputs'), headers, rows: plan.crops.flatMap(c => [
    [cropName(c), x('units'), c.unit, x('entered')],
    ...inputRows(c, cropName(c), ['area', 'plantingsPerYear', 'yieldPerAcre', 'price', 'operatingCostPerAcre', 'ownLaborHoursPerAcre']),
  ]), notes: [x('blankNote')] });
  tables.push({ name: x('equipmentInputs'), headers, rows: plan.equipment.flatMap(e => inputRows(e, e.name, ['pricePaid', 'yearBought', 'keepYears', 'hoursPerYear', 'salvageValue', 'operatingCostPerHour'])), notes: [x('blankNote')] });
  tables.push({ name: x('timing'), headers: [x('name'), x('month'), x('costWeight'), x('salesWeight')], rows: plan.crops.flatMap(c => Array.from({ length: 12 }, (_, i) => [cropName(c), t(`monthLong.${i}` as Key), c.costMonths?.[i] ?? null, c.revenueMonths?.[i] ?? null])), notes: [t('chart.assumptions')] });
  tables.push({ name: x('assignments'), headers: [t('results.table.crop'), x('name'), x('field'), x('value')], rows: plan.crops.flatMap(c => [
    ...c.machineHours.map(m => [cropName(c), plan.equipment.find(e => e.id === m.equipmentId)?.name ?? m.equipmentId, x('hoursPerAcre'), m.hoursPerAcre]),
    ...c.customHire.map(h => [cropName(c), h.name, x('hireCost'), h.costPerAcre]),
  ]) });
  const sources: ExportCell[][] = [];
  for (const item of [plan.farm, ...plan.crops, ...plan.equipment]) for (const [field, citation] of Object.entries(item.citations)) {
    if (!citation) continue;
    const current = isMissing(item, field) ? null : sourceDisplayValue(item, field) ?? null;
    const status = isMissing(item, field) ? x('missing') : sourceUnitChanged(item, field) ? t('source.restoreUnitHint') : field === 'months' ? ('timingSource' in item && item.timingSource === 'custom' ? t('source.customTiming') : t('source.fromStudy')) : sourceStatus(current ?? undefined, citation) === 'study' ? t('source.fromStudy') : t('source.yours');
    sources.push([item.name || t('farm.title'), citation.field || x(field), [citation.title, citation.year, citation.region].filter(v => v != null).join(' · '), citation.page, citation.value, current, status, citation.url]);
  }
  for (const method of METHOD) sources.push([t('sources.formulas'), t(`sources.method.${method.key}`), method.citation.title, method.citation.page, method.citation.value, null, '', method.citation.url]);
  tables.push({ name: x('sources'), headers: [x('name'), x('sourceField'), x('sourceTitle'), x('page'), x('citedValue'), x('currentValue'), x('status'), x('url')], rows: sources, notes: [x('sourceValuesNote')] });
  const usd = '"$"#,##0.00;[Red]-"$"#,##0.00;"$"0.00';
  const expense = '[Red]"-$"#,##0.00;"$"#,##0.00;"$"0.00';
  const moneyFields = ['price', 'operatingCostPerAcre', 'ownLaborRate', 'hiredLaborRate', 'landRentPerAcre', 'otherOverheadPerYear', 'pricePaid', 'salvageValue', 'operatingCostPerHour'].map(x);
  tables.forEach((table, index) => {
    table.rows = table.rows.map(row => row.map(cell => typeof cell === 'string' ? exportText(cell) : typeof cell === 'number' && !Number.isFinite(cell) ? null : cell));
    table.formats = table.rows.map((row, r) => row.map((cell, c) => {
      if (typeof cell !== 'number') return null;
      if ((index === 0 && r === 1) || (index === 1 && c >= 3 && c <= 6) || (index === 2 && c >= 2)) return expense;
      if ((index === 0 && r < 3) || (index === 1 && c >= 2) || (index === 2 && c >= 2) || (index === 3 && c >= 1)) return usd;
      if ([4, 5, 6].includes(index) && c === 2) {
        if (moneyFields.includes(String(row[1]))) return usd;
        if ([x('interestRate'), x('payrollOverhead')].includes(String(row[1]))) return '0.00%';
      }
      if (index === 8 && row[2] === x('hireCost')) return usd;
      return '#,##0.####;[Red]-#,##0.####;0';
    }));
  });
  return { title: exportText(plan.farm.name || t('app.title')), subtitle: t(missing.length ? 'inputs.provisional' : 'summary.title'), created: date.toISOString(), lang, provisional: missing.length > 0, tables };
}
