import type { CashRow, ExportSnapshot, ValueKind } from './exportData';
import { buildCashFlowCsv } from './exportData';

export { buildCashFlowCsv };

// ---------------------------------------------------------------------------
// Spreadsheet: one sheet per view, laid out horizontally (crops or months across).
// ---------------------------------------------------------------------------

const MONEY = '"$"#,##0;[Red]-"$"#,##0;"$"0';
const PERCENT = '0%';
const NUMBER = '#,##0.##';
const INK = 'FF141619';
const GREY = 'FF626872';
const RED = 'FFB42D2D';

export async function buildWorkbook(snapshot: ExportSnapshot): Promise<Uint8Array<ArrayBuffer>> {
  const { default: ExcelJS } = await import('exceljs');
  type Sheet = import('exceljs').Worksheet;
  const L = snapshot.labels;
  const book = new ExcelJS.Workbook();
  book.creator = 'Farm Cost Planner';
  book.created = new Date(snapshot.created);
  book.title = snapshot.title;

  const sheetName = (name: string) => name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
  const header = (sheet: Sheet, cells: (string | number)[]) => {
    const row = sheet.addRow(cells);
    row.font = { bold: true, color: { argb: INK } };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.eachCell(cell => { cell.border = { bottom: { style: 'medium', color: { argb: INK } } }; });
    return row;
  };
  const fmtRow = (sheet: Sheet, cells: (string | number | null)[], numFmt: string, opts: { bold?: boolean; grey?: boolean; red?: boolean } = {}) => {
    const row = sheet.addRow(cells);
    row.eachCell((cell, col) => {
      if (typeof cell.value === 'number' && col > 1) cell.numFmt = numFmt;
      if (col > 1) cell.alignment = { horizontal: 'right' };
    });
    if (opts.bold) row.font = { bold: true, color: { argb: INK } };
    if (opts.grey) row.font = { color: { argb: GREY }, italic: true };
    if (opts.red) row.font = { color: { argb: RED } };
    return row;
  };
  const widths = (sheet: Sheet, first: number, rest: number) => {
    sheet.columns.forEach((col, i) => { col.width = i === 0 ? first : rest; });
  };
  const titleRows = (sheet: Sheet, section: string) => {
    sheet.addRow([snapshot.title]).font = { bold: true, size: 16, color: { argb: INK } };
    sheet.addRow([`${section}, ${snapshot.dateText}`]).font = { color: { argb: GREY } };
    sheet.addRow([]);
  };

  // Summary: crops across, metrics down.
  {
    const sheet = book.addWorksheet(sheetName(L.summary), { views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }] });
    titleRows(sheet, snapshot.headline);
    const cols = [...snapshot.cropTable.rows, snapshot.cropTable.total];
    header(sheet, [L.metric, ...cols.map(c => c.name)]);
    const metric = (label: string, pick: (c: typeof cols[number]) => number, kind: ValueKind, bold = false) =>
      fmtRow(sheet, [label, ...cols.map(c => kind === 'expense' ? -Math.round(pick(c)) : kind === 'number' ? pick(c) : Math.round(pick(c)))], kind === 'number' ? NUMBER : MONEY, { bold });
    metric(L.acres, c => c.acres, 'number');
    metric(L.sales, c => c.sales, 'money');
    metric(L.operating, c => c.operating, 'expense');
    metric(L.ownLabor, c => c.ownLabor, 'expense');
    metric(L.machineRunning, c => c.machineRunning, 'expense');
    metric(L.hiredWork, c => c.hiredWork, 'expense');
    metric(L.overheadShare, c => c.overheadShare, 'expense');
    metric(L.equipmentShare, c => c.equipmentShare, 'expense');
    metric(L.costs, c => c.costs, 'expense', true);
    metric(L.left, c => c.net, 'net', true);
    metric(L.perAcre, c => c.perAcre, 'net');
    fmtRow(sheet, [L.breakEven, ...cols.map(c => c.breakEvenPrice > 0 ? Math.round(c.breakEvenPrice * 100) / 100 : null)], '"$"#,##0.00');
    if (snapshot.paperLoser) { sheet.addRow([]); fmtRow(sheet, [snapshot.paperLoser], NUMBER, { grey: true }); }
    if (snapshot.draftNote) fmtRow(sheet, [snapshot.draftNote], NUMBER, { grey: true });
    widths(sheet, 34, 16);
  }

  // Cash flow: months across.
  {
    const sheet = book.addWorksheet(sheetName(L.cashFlow), { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    header(sheet, [L.cashFlow, ...snapshot.cashFlow.months, L.total]);
    for (const r of snapshot.cashFlow.rows) fmtRow(sheet, [r.label, ...r.values.map(Math.round), Math.round(r.total)], MONEY, { bold: r.kind === 'net' || r.kind === 'balance' });
    if (snapshot.cashFlow.excluded.length) { sheet.addRow([]); fmtRow(sheet, [`${L.notInView}: ${snapshot.cashFlow.excluded.join(', ')}`], NUMBER, { grey: true }); }
    sheet.addRow([]); fmtRow(sheet, [snapshot.cashFlow.intro], NUMBER, { grey: true });
    widths(sheet, 30, 12);
  }

  // Crops: crops across, inputs down.
  {
    const sheet = book.addWorksheet(sheetName(L.crops), { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
    const crops = snapshot.cropDetails;
    header(sheet, [L.inputs, ...crops.map(c => c.name)]);
    const inputLabels = crops[0]?.inputs.map(i => i.label) ?? [];
    inputLabels.forEach((label, i) => fmtRow(sheet, [label, ...crops.map(c => c.inputs[i]?.value ?? '')], NUMBER));
    const machines = [...new Set(crops.flatMap(c => c.machineHours.map(m => m.label)))];
    if (machines.length) {
      sheet.addRow([]); fmtRow(sheet, [L.machineHours], NUMBER, { bold: true });
      for (const m of machines) fmtRow(sheet, [m, ...crops.map(c => c.machineHours.find(h => h.label === m)?.value ?? '')], NUMBER);
    }
    const jobs = [...new Set(crops.flatMap(c => c.hiredJobs.map(h => h.label)))];
    if (jobs.length) {
      sheet.addRow([]); fmtRow(sheet, [L.hiredJobs], NUMBER, { bold: true });
      for (const j of jobs) fmtRow(sheet, [j, ...crops.map(c => c.hiredJobs.find(h => h.label === j)?.value ?? '')], NUMBER);
    }
    sheet.addRow([]); fmtRow(sheet, [L.whereMoneyGoes], NUMBER, { bold: true });
    const lines = [...new Set(crops.flatMap(c => c.breakdown.map(b => b.label)))];
    for (const label of lines) fmtRow(sheet, [label, ...crops.map(c => { const b = c.breakdown.find(k => k.label === label); return b ? -Math.round(b.amount) : null; })], MONEY);
    const opNames = [...new Set(crops.flatMap(c => c.operations.filter(o => o.enabled).map(o => o.name)))];
    if (opNames.length) {
      sheet.addRow([]); fmtRow(sheet, [`${L.operations} (${L.costForYear})`], NUMBER, { bold: true });
      for (const name of opNames) fmtRow(sheet, [name, ...crops.map(c => { const o = c.operations.find(k => k.name === name && k.enabled); return o ? -Math.round(o.costForYear) : null; })], MONEY);
    }
    widths(sheet, 40, 22);
  }

  // Operations: one row per crop operation.
  if (snapshot.cropDetails.some(c => c.operations.length)) {
    const sheet = book.addWorksheet(sheetName(L.operations), { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
    header(sheet, [L.crop, L.operation, L.category, L.who, L.machineHoursCol, L.operatorHoursCol, L.handHoursCol, L.materialsCol, L.customCol, L.costPerAcre, L.costForYear]);
    for (const c of snapshot.cropDetails) for (const o of c.operations) {
      const row = fmtRow(sheet, [c.name, o.enabled ? o.name : `${o.name} (${L.offLine})`, o.category, o.who, o.machineHours, o.operatorHours, o.handHours, -Math.round(o.materials), -Math.round(o.custom), -Math.round(o.costPerAcre), -Math.round(o.costForYear)], NUMBER, { grey: !o.enabled });
      row.eachCell((cell, col) => { if (col >= 8 && typeof cell.value === 'number') cell.numFmt = MONEY; });
    }
    sheet.columns.forEach((col, i) => { col.width = i < 2 ? 34 : i < 4 ? 18 : 14; });
  }

  // Timing: months across, two rows per crop, percents.
  {
    const sheet = book.addWorksheet(sheetName(L.timing), { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
    header(sheet, [L.timing, ...snapshot.cashFlow.months, L.total]);
    for (const c of snapshot.cropDetails) {
      const rowOf = (label: string, w: number[] | null) => fmtRow(sheet, [`${c.name}: ${label}`, ...(w ? w.map(v => Math.round(v * 1000) / 1000) : Array<null>(12).fill(null)), w ? 1 : null], PERCENT);
      rowOf(L.costs, c.timing.costs); rowOf(L.sales, c.timing.sales);
    }
    widths(sheet, 34, 9);
  }

  // Table 1: one block per crop, per acre, one planting (UC study Table 1).
  if (snapshot.table1.length) {
    const sheet = book.addWorksheet(sheetName('Table 1'), { views: [{ state: 'frozen', xSplit: 1, ySplit: 0 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    sheet.addRow([L.sheetTable1Note]).font = { color: { argb: GREY } };
    const groupLabel: Record<string, string> = { cultural: L.t1Cultural, harvest: L.t1Harvest, assessment: L.t1Assessment, postharvest: L.t1Postharvest, other: L.t1Other };
    const extraLabel: Record<string, string> = { ownLabor: L.t1OwnLabor, hiredJobs: L.t1HiredJobs, lump: L.t1Lump, repairPool: L.t1RepairPool, interest: L.t1Interest };
    const one = (label: string, n: number, bold = false, positive = false) => fmtRow(sheet, [label, null, null, null, null, null, positive ? Math.round(n) : -Math.round(n)], MONEY, { bold });
    for (const tb of snapshot.table1) {
      sheet.addRow([]);
      sheet.addRow([L.t1Title.replace('{crop}', tb.name)]).font = { bold: true, size: 13, color: { argb: INK } };
      sheet.addRow([L.t1PerAcreNote.replace('{acres}', String(Math.round(tb.acres * 100) / 100)).replace('{plantings}', String(tb.plantings))]).font = { color: { argb: GREY } };
      header(sheet, [L.t1Operation, L.t1Time, L.t1Labor, L.t1Flr, L.t1Materials, L.t1Custom, L.t1Total]);
      for (const g of tb.groups) {
        fmtRow(sheet, [groupLabel[g.category]], NUMBER, { bold: true });
        for (const r of g.rows) fmtRow(sheet, [`  ${r.name}`, r.time > 0 ? Math.round(r.time * 100) / 100 : null, -Math.round(r.labor), -Math.round(r.flr), -Math.round(r.materials), -Math.round(r.custom), -Math.round(r.total)], MONEY).getCell(2).numFmt = NUMBER;
        fmtRow(sheet, [L.t1Subtotal.replace('{group}', groupLabel[g.category].toLowerCase()), null, -Math.round(g.subtotal.labor), -Math.round(g.subtotal.flr), -Math.round(g.subtotal.materials), -Math.round(g.subtotal.custom), -Math.round(g.subtotal.total)], MONEY, { bold: true });
      }
      for (const e of tb.extra) one(extraLabel[e.key], e.amount);
      one(L.t1TotalOperating, tb.totalOperating, true);
      if (tb.cashOverhead.length) fmtRow(sheet, [L.t1CashOverhead], NUMBER, { bold: true });
      for (const o of tb.cashOverhead) one(`  ${o.id === 'land-rent' ? L.t1LandRent : o.name}`, o.amount);
      one(L.t1TotalCashOverhead, tb.totalCashOverhead, true);
      if (tb.nonCash.length || tb.establishment) fmtRow(sheet, [L.t1NonCash], NUMBER, { bold: true });
      for (const m of tb.nonCash) one(`  ${m.name}`, m.amount);
      if (tb.establishment) one(`  ${L.t1Establishment}`, tb.establishment.total);
      one(L.t1TotalNonCash, tb.totalNonCash, true);
      one(L.t1TotalCosts, tb.totalCosts, true);
      one(L.t1Gross, tb.grossReturns, true, true);
      one(L.t1NetOperating, tb.netAboveOperating, true, true);
      one(L.t1NetTotal, tb.netAboveTotal, true, true);
    }
    widths(sheet, 44, 16);
  }

  // Table 4: ranging analysis, one block per crop.
  if (snapshot.ranging.length) {
    const sheet = book.addWorksheet(sheetName('Table 4'));
    sheet.addRow([L.sheetRangingNote]).font = { color: { argb: GREY } };
    for (const rg of snapshot.ranging) {
      sheet.addRow([]);
      sheet.addRow([L.t4Title.replace('{crop}', rg.name)]).font = { bold: true, size: 13, color: { argb: INK } };
      header(sheet, [L.t4Yield.replace('{unit}', rg.unit), ...rg.prices.map(p => `${L.t4Price.replace('{unit}', rg.unit)} $${Math.round(p * 100) / 100}`)]);
      rg.yields.forEach((yv, i) => { fmtRow(sheet, [Math.round(yv * 100) / 100, ...rg.net[i].map(Math.round)], MONEY).getCell(1).numFmt = NUMBER; });
    }
    widths(sheet, 30, 18);
  }

  // Table 5: whole farm annual equipment, investments and business overhead.
  {
    const sheet = book.addWorksheet(sheetName('Table 5'), { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
    sheet.addRow([L.t5Title]).font = { bold: true, size: 13, color: { argb: INK } };
    header(sheet, [L.t5Description, L.t5Price, L.t5Years, L.t5Salvage, L.t5CapitalRecovery, L.t5Insurance, L.t5Taxes, L.t5Repairs, L.t5Total]);
    const t5 = snapshot.table5;
    const t5row = (m: typeof t5.machines[number]) => { fmtRow(sheet, [m.name, Math.round(m.price), m.years, Math.round(m.salvage), -Math.round(m.capitalRecovery), -Math.round(m.insurance), -Math.round(m.taxes), -Math.round(m.repairs), -Math.round(m.total)], MONEY).getCell(3).numFmt = NUMBER; };
    for (const m of t5.machines) t5row(m);
    if (t5.investments.length) { fmtRow(sheet, [L.t5Investments], NUMBER, { bold: true }); for (const m of t5.investments) t5row(m); }
    fmtRow(sheet, [L.t5EquipmentTotal, Math.round(t5.totals.price), null, Math.round(t5.totals.salvage), -Math.round(t5.totals.capitalRecovery), -Math.round(t5.totals.insurance), -Math.round(t5.totals.taxes), -Math.round(t5.totals.repairs), -Math.round(t5.totals.total)], MONEY, { bold: true });
    if (t5.overhead.length) {
      sheet.addRow([]); fmtRow(sheet, [L.t5Overhead], NUMBER, { bold: true });
      for (const o of t5.overhead) fmtRow(sheet, [o.name, null, null, null, null, null, null, null, -Math.round(o.amount)], MONEY);
      fmtRow(sheet, [L.t5OverheadTotal, null, null, null, null, null, null, null, -Math.round(t5.overheadTotal)], MONEY, { bold: true });
    }
    widths(sheet, 34, 16);
  }

  // Table 6: hourly equipment costs at the hours each machine runs in this plan.
  if (snapshot.table6.length) {
    const sheet = book.addWorksheet(sheetName('Table 6'), { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
    sheet.addRow([L.t6Title]).font = { bold: true, size: 13, color: { argb: INK } };
    header(sheet, [L.t6Machine, L.t6Hours, L.t6CapitalRecovery, L.t6Insurance, L.t6Taxes, L.t6Repairs, L.t6FuelLube, L.t6TotalOperating, L.t6TotalCost, L.t6CarriedBy]);
    const c2 = (n: number) => -Math.round(n * 100) / 100;
    for (const m of snapshot.table6) {
      const carried = [...m.carriedBy.map(b => `${b.name} ${Math.round(b.share * 100)}%`), ...(m.customShare > 0 ? [`${L.t6Custom} ${Math.round(m.customShare * 100)}%`] : [])].join(', ');
      const row = fmtRow(sheet, [m.name, Math.round(m.hours), c2(m.capitalRecovery), c2(m.insurance), c2(m.taxes), c2(m.repairs), c2(m.fuelLube), c2(m.totalOperating), c2(m.totalCost), carried], '"$"#,##0.00;[Red]-"$"#,##0.00');
      row.getCell(2).numFmt = NUMBER; row.getCell(10).alignment = { horizontal: 'left' };
    }
    widths(sheet, 34, 14); sheet.getColumn(10).width = 40;
  }

  // Custom work for others.
  if (snapshot.customWork.jobs.length) {
    const sheet = book.addWorksheet(sheetName(L.cwTitle));
    header(sheet, [L.cwJob, L.cwMachine, L.cwHours, L.cwPaid, `${L.cwCost} (${L.cwCostNote})`, L.cwNet]);
    for (const j of snapshot.customWork.jobs) fmtRow(sheet, [j.name, j.machineName, j.hours, Math.round(j.income), -Math.round(j.cost), Math.round(j.net)], MONEY).getCell(3).numFmt = NUMBER;
    const cw = snapshot.customWork;
    fmtRow(sheet, [L.cwTotal, '', cw.jobs.reduce((a, j) => a + j.hours, 0), Math.round(cw.income), -Math.round(cw.cost), Math.round(cw.net)], MONEY, { bold: true });
    widths(sheet, 30, 18);
  }

  // Equipment inputs: machines across, figures down.
  {
    const sheet = book.addWorksheet(sheetName(L.equipment), { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
    const eq = snapshot.equipment;
    header(sheet, [L.machine, ...eq.map(e => e.name)]);
    fmtRow(sheet, [L.condition, ...eq.map(e => e.condition)], NUMBER);
    fmtRow(sheet, [L.paid, ...eq.map(e => Math.round(e.paid))], MONEY);
    fmtRow(sheet, [L.year, ...eq.map(e => e.year || null)], '0');
    fmtRow(sheet, [L.keepYears, ...eq.map(e => e.keepYears)], NUMBER);
    fmtRow(sheet, [L.hoursPerYear, ...eq.map(e => Math.round(e.hoursPerYear))], NUMBER);
    fmtRow(sheet, [L.salvage, ...eq.map(e => Math.round(e.salvage))], MONEY);
    fmtRow(sheet, [L.fuelLube, ...eq.map(e => Math.round(e.fuelLube * 100) / 100)], '"$"#,##0.00');
    fmtRow(sheet, [L.repairsPct, ...eq.map(e => Math.round(e.repairsPct * 10000) / 10000)], '0.00%');
    sheet.addRow([]);
    fmtRow(sheet, [L.capitalRecovery, ...eq.map(e => -Math.round(e.capitalRecovery))], MONEY);
    fmtRow(sheet, [L.interestOnSalvage, ...eq.map(e => -Math.round(e.interestOnSalvage))], MONEY);
    fmtRow(sheet, [L.insurance, ...eq.map(e => -Math.round(e.insurance))], MONEY);
    fmtRow(sheet, [L.taxes, ...eq.map(e => -Math.round(e.taxes))], MONEY);
    fmtRow(sheet, [L.totalPerYear, ...eq.map(e => -Math.round(e.totalPerYear))], MONEY, { bold: true });
    fmtRow(sheet, [L.t5Repairs, ...eq.map(e => -Math.round(e.repairsPerYear))], MONEY);
    fmtRow(sheet, [L.ownPerHour, ...eq.map(e => -Math.round(e.ownPerHour * 100) / 100)], '"$"#,##0.00;[Red]-"$"#,##0.00');
    fmtRow(sheet, [L.allInPerHour, ...eq.map(e => -Math.round(e.allInPerHour * 100) / 100)], '"$"#,##0.00;[Red]-"$"#,##0.00', { bold: true });
    widths(sheet, 30, 20);
  }

  // Farm: key and value, overhead items, rules.
  {
    const sheet = book.addWorksheet(sheetName(L.farm));
    titleRows(sheet, L.farm);
    for (const f of snapshot.farm.fields) fmtRow(sheet, [f.label, f.value], NUMBER);
    sheet.addRow([]); fmtRow(sheet, [L.rates], NUMBER, { bold: true });
    for (const r of snapshot.farm.rates) fmtRow(sheet, [r.label, r.value], NUMBER);
    sheet.addRow([]); header(sheet, [L.overheadItems, L.amount, L.basis]);
    for (const o of snapshot.farm.overheadItems) fmtRow(sheet, [o.name, -Math.round(o.amount), o.basis], MONEY);
    sheet.addRow([]); fmtRow(sheet, [L.rules], NUMBER, { bold: true });
    for (const r of snapshot.farm.rules) fmtRow(sheet, [r], NUMBER);
    widths(sheet, 40, 24);
    sheet.getColumn(2).alignment = { horizontal: 'left' };
  }

  // Sources.
  {
    const sheet = book.addWorksheet(sheetName(L.sources), { views: [{ state: 'frozen', ySplit: 1 }] });
    header(sheet, [L.study, L.owner, L.field, L.citedValue, L.page, L.quote, L.url]);
    for (const s of snapshot.sources.studies) {
      const label = [s.title, s.year, s.region].filter(v => v != null).join(', ');
      for (const it of s.items) { const row = sheet.addRow([label, it.owner, it.what, it.value, it.page, it.quote, s.url]); row.alignment = { vertical: 'top', wrapText: true }; }
    }
    sheet.addRow([]);
    fmtRow(sheet, [L.methods], NUMBER, { bold: true });
    for (const m of snapshot.sources.methods) { const row = sheet.addRow([m.studyTitle, '', m.name, '', m.page, m.quote, '']); row.alignment = { vertical: 'top', wrapText: true }; }
    sheet.addRow([]);
    fmtRow(sheet, [snapshot.sources.oursTitle], NUMBER, { bold: true });
    for (const m of snapshot.sources.ours) { const row = sheet.addRow(['', m.kind, m.name, '', '', m.formula, '']); row.alignment = { vertical: 'top', wrapText: true }; }
    [40, 22, 34, 16, 8, 70, 40].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  }

  return new Uint8Array(await book.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// PDF: consistent portrait US Letter pages, with wide tables split into readable sections.
// ---------------------------------------------------------------------------

type Doc = import('jspdf').jsPDF;

export async function buildPdf(snapshot: ExportSnapshot, options: { includeDetails?: boolean; sourcesUrl?: string } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const L = snapshot.labels;
  const doc: Doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  doc.setProperties({ title: `${snapshot.title}, ${snapshot.dateText}`, creator: L.publisher });

  const ink: [number, number, number] = [0, 0, 0];
  const FONT = 'times';
  const locale = snapshot.lang === 'es' ? 'es-US' : 'en-US';
  const year = new Date(snapshot.created).getFullYear();
  const place = [snapshot.county, String(year)].filter(Boolean).join(' - ');
  const text = (v: string) => v.replace(/−/g, '-').replace(/[  ]/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const upper = (v: string) => v.toLocaleUpperCase(locale);
  const cap = (v: string) => v.charAt(0).toLocaleUpperCase(locale) + v.slice(1);
  const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
  // UC tables print whole dollars with no sign or symbol for costs; only a loss carries a minus.
  const whole = (n: number) => `${Math.round(n) < 0 ? '-' : ''}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
  const cents = (n: number) => `${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const M = 16; // margin
  const TOP = 16;
  const BOTTOM = 18;
  const HEAD_END = 33; // where the body starts under a table header block
  let y = TOP;
  const pageWidth = () => doc.internal.pageSize.getWidth();
  const pageHeight = () => doc.internal.pageSize.getHeight();
  const center = () => pageWidth() / 2;
  const newPage = () => { doc.addPage('letter', 'portrait'); y = TOP; };
  // Every continuation uses the same portrait Letter dimensions.
  const ensure = (needed: number) => { if (y + needed > pageHeight() - BOTTOM) newPage(); };
  const rule = (y0: number, width = 0.2, x0 = M, x1 = pageWidth() - M) => { doc.setDrawColor(...ink); doc.setLineWidth(width); doc.line(x0, y0, x1, y0); };
  const font = (size: number, style: 'normal' | 'bold' | 'italic' = 'normal') => { doc.setFont(FONT, style); doc.setFontSize(size); doc.setTextColor(...ink); };

  // "Table 1. Costs per acre to produce beans" -> "Table 1." + "COSTS PER ACRE TO PRODUCE BEANS"
  const splitTitle = (title: string) => {
    const m = /^(\S+ \d+\.)\s*(.*)$/.exec(title);
    return m ? { prefix: m[1], rest: m[2] } : { prefix: '', rest: title };
  };
  const ucTitle = (title: string) => { const { prefix, rest } = splitTitle(title); return [prefix, upper(rest)].filter(Boolean).join(' '); };
  // The centered block every UC table opens with: publisher, bold table title, region and year.
  let currentTitle = '';
  const headerBlock = (title: string, continued = false) => {
    let y0 = 15;
    font(10.5); doc.text(text(upper(L.publisher)), center(), y0, { align: 'center' }); y0 += 4.8;
    font(11, 'bold');
    const { prefix } = splitTitle(title);
    const shown = continued ? `${prefix || ucTitle(title)} ${upper(L.continued)}`.trim() : ucTitle(title);
    const lines: string[] = doc.splitTextToSize(text(shown), pageWidth() - 2 * M);
    doc.text(lines, center(), y0, { align: 'center' }); y0 += lines.length * 4.8;
    font(10.5); doc.text(text(place), center(), y0, { align: 'center' }); y0 += 6;
    y = Math.max(y0, HEAD_END - 2);
  };
  const tablePage = (title: string) => { newPage(); currentTitle = title; headerBlock(title); };
  // A table that starts part way down a page, under its own smaller heading.
  const inlineTitle = (title: string) => {
    ensure(40); currentTitle = title; y += 4;
    font(11, 'bold'); doc.text(text(ucTitle(title)), center(), y, { align: 'center' }); y += 6;
  };
  // Narrative pages: a centered bold capital heading, as in the ASSUMPTIONS section of a study.
  const heading = (s: string, forceNew = false) => {
    currentTitle = '';
    if (forceNew) newPage(); else { ensure(30); y += 5; }
    font(11.5, 'bold'); doc.text(text(upper(s)), center(), y, { align: 'center' }); y += 7;
  };
  const para = (s: string, size = 10.5, style: 'normal' | 'bold' | 'italic' = 'normal', justify = false) => {
    font(size, style);
    const width = pageWidth() - 2 * M;
    const lines: string[] = doc.splitTextToSize(text(s), width);
    const lh = size * 0.42;
    ensure(lines.length * lh + 2);
    if (justify && lines.length > 1) {
      doc.text(lines.slice(0, -1), M, y, { align: 'justify', maxWidth: width });
      doc.text(lines[lines.length - 1], M, y + (lines.length - 1) * lh);
    } else doc.text(lines, M, y);
    y += lines.length * lh + 2;
  };
  const note = (s: string) => para(s, 8.5, 'italic');
  // Run-in head, as UC writes "Farm. The hypothetical farm consists of ..."
  const runIn = (head: string, body: string) => {
    font(10.5, 'bold');
    const headText = `${text(head)}. `;
    const headW = doc.getTextWidth(headText);
    font(10.5);
    const width = pageWidth() - 2 * M;
    const first: string[] = doc.splitTextToSize(text(body), width - headW);
    const firstLine = first[0] ?? '';
    const rest: string[] = first.length > 1 ? doc.splitTextToSize(text(body).slice(firstLine.length).trim(), width) : [];
    const lh = 10.5 * 0.42;
    ensure((1 + rest.length) * lh + 3);
    font(10.5, 'bold'); doc.text(headText, M, y);
    font(10.5); doc.text(firstLine, M + headW, y);
    if (rest.length) doc.text(rest, M, y + lh);
    y += (1 + rest.length) * lh + 3;
  };

  type Cell = { text: string; bold?: boolean; italic?: boolean; align?: 'left' | 'right' | 'center' };
  type Row = Cell[] & { ruled?: boolean };
  const cell = (t: string, extra: Partial<Cell> = {}): Cell => ({ text: t, ...extra });
  const amt = (n: number, bold = false): Cell => ({ text: whole(n), bold });
  const blank = (n: number) => Array.from({ length: n }, () => cell(''));
  // A TOTAL row: capital label, set between thin rules.
  const total = (label: string, cells: Cell[]): Row => Object.assign([cell(upper(label)), ...cells], { ruled: true });
  const plain = (cells: Cell[]): Row => cells as Row;
  const table = (head: string[] | string[][] | null, body: Row[], opts: { fontSize?: number; widths?: (number | 'auto')[]; rightFrom?: number; closeRule?: boolean; tableWidth?: number } = {}) => {
    const rightFrom = opts.rightFrom ?? 1;
    const heads = head == null ? [] : Array.isArray(head[0]) ? (head as string[][]) : [head as string[]];
    const cols = heads[heads.length - 1]?.length ?? body[0]?.length ?? 0;
    const columnStyles: Record<number, { halign?: 'left' | 'right'; cellWidth?: number | 'auto' }> = {};
    for (let i = 0; i < cols; i++) columnStyles[i] = { halign: i >= rightFrom ? 'right' : 'left', cellWidth: opts.widths?.[i] ?? 'auto' };
    const titleForTable = currentTitle;
    const left = opts.tableWidth ? (pageWidth() - opts.tableWidth) / 2 : M;
    autoTable(doc, {
      startY: y,
      head: heads.map(h => h.map(text)),
      body: body.map(r => r.map(c => text(c.text))),
      showHead: head == null ? 'never' : 'everyPage',
      margin: { top: titleForTable ? HEAD_END : TOP, bottom: BOTTOM, left, right: left },
      tableWidth: opts.tableWidth ?? 'auto',
      styles: { font: FONT, fontSize: opts.fontSize ?? 9, cellPadding: { top: 0.5, bottom: 0.5, left: 1.2, right: 1.2 }, textColor: ink, lineColor: ink, lineWidth: 0, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: false, textColor: ink, fontStyle: 'normal', valign: 'bottom', lineWidth: { top: 0, bottom: 0 }, cellPadding: { top: 1, bottom: 1, left: 1.2, right: 1.2 } },
      bodyStyles: { fillColor: false },
      alternateRowStyles: { fillColor: false },
      columnStyles,
      theme: 'plain',
      didParseCell: d => {
        if (d.section === 'head') {
          // A heavy rule over the column headings and a thin one under them.
          const first = d.row.index === 0, last = d.row.index === heads.length - 1;
          d.cell.styles.lineWidth = { top: first ? 0.5 : 0, bottom: last ? 0.2 : 0 };
          // A heading sits over its column's text: right for numbers, or whatever the first row asks for.
          d.cell.styles.halign = body[0]?.[d.column.index]?.align ?? (d.column.index >= rightFrom ? 'right' : 'left');
          return;
        }
        const row = body[d.row.index];
        const c = row?.[d.column.index];
        if (!c) return;
        if (row.ruled) d.cell.styles.lineWidth = { top: 0.2, bottom: 0.2 };
        if (c.bold) d.cell.styles.fontStyle = 'bold';
        if (c.italic) d.cell.styles.fontStyle = 'italic';
        if (c.align) d.cell.styles.halign = c.align;
      },
      didDrawPage: d => {
        // pageNumber counts pages of this table, so anything past 1 is a continuation.
        if (titleForTable && d.pageNumber > 1) headerBlock(titleForTable, true);
      },
    });
    const at = (doc as Doc & { lastAutoTable: { finalY: number } }).lastAutoTable;
    if (opts.closeRule !== false && head != null) rule(at.finalY, 0.2, left, pageWidth() - left);
    y = at.finalY + 5;
  };

  // ---- Cover: the title page of a study, then the whole-farm summary ----
  {
    rule(18, 0.5);
    y = 25;
    font(12);
    doc.text(text(upper(L.publisher)), center(), y, { align: 'center' }); y += 5.2;
    font(15, 'bold'); doc.text(String(year), center(), y, { align: 'center' }); y += 6.5;
    doc.text(text(upper(L.costsAndReturns)), center(), y, { align: 'center' }); y += 9.5;
    font(22, 'bold');
    const titleLines: string[] = doc.splitTextToSize(text(upper(snapshot.title)), pageWidth() - 2 * M);
    doc.text(titleLines.slice(0, 2), center(), y, { align: 'center' }); y += Math.min(titleLines.length, 2) * 9;
    if (snapshot.county) { font(14, 'bold'); doc.text(text(upper(snapshot.county)), center(), y, { align: 'center' }); y += 6; }
    font(11); doc.text(text(snapshot.dateText), center(), y, { align: 'center' }); y += 12;

    heading(L.farmSummary);
    para(snapshot.headline, 11, 'bold', true);
    if (snapshot.draftNote) note(snapshot.draftNote);
    y += 2;
    // Key figures as a two column list, the way a study lists its assumptions.
    const factValue = (f: typeof snapshot.facts[number]) => typeof f.value === 'number' ? (f.kind === 'number' ? num(f.value) : money(f.value)) : f.value;
    table(null, snapshot.facts.map(f => plain([cell(cap(f.label)), cell(factValue(f), { align: 'right' })])), { fontSize: 10.5, rightFrom: 1, tableWidth: 120 });
    y += 2;
    const rows = snapshot.cropTable.rows;
    const t = snapshot.cropTable.total;
    const body: Row[] = rows.map(r => plain([cell(r.name), cell(num(r.acres)), amt(r.sales), amt(r.costs), amt(r.net), amt(r.perAcre)]));
    body.push(total(t.name, [cell(num(t.acres)), amt(t.sales), amt(t.costs), amt(t.net), amt(t.perAcre)]));
    table([L.crop, cap(L.acres), L.sales, L.costs, L.left, L.perAcre], body, { fontSize: 9.5, widths: [56, 'auto', 'auto', 'auto', 'auto', 'auto'] });
    if (snapshot.paperLoser) note(snapshot.paperLoser);

    const footY = pageHeight() - 34;
    if (y < footY - 4) {
      rule(footY, 0.3);
      font(10, 'italic'); doc.text(text(L.prepared), M, footY + 6);
      font(10); doc.text(doc.splitTextToSize(text(L.preparedWith.replace('{date}', snapshot.dateText)), pageWidth() - 2 * M - 42), M + 42, footY + 6);
    }
  }

  // Monthly cash flow: two six-month sections, with full-year totals on the second.
  if (snapshot.cashFlow.rows.length) {
    tablePage(`${L.t3Title}: ${L.cashFlow}`);
    for (const start of [0, 6]) {
      const months = snapshot.cashFlow.months.slice(start, start + 6);
      ensure(35);
      font(10, 'bold'); doc.text(`${months[0]} - ${months[5]}`, M, y); y += 5;
      const lastHalf = start === 6;
      const head = ['', ...months.map(upper), ...(lastHalf ? [L.total] : [])];
      const rowCells = (r: CashRow): Row => {
        const cells = [...r.values.slice(start, start + 6).map(v => amt(v)), ...(lastHalf ? [amt(r.total)] : [])];
        return r.kind === 'net' || r.kind === 'balance' ? total(r.label, cells) : plain([cell(r.label), ...cells]);
      };
      const numericCols = lastHalf ? 7 : 6;
      const monthW = (pageWidth() - 2 * M - 44) / numericCols;
      table(head, snapshot.cashFlow.rows.map(rowCells), { fontSize: 8.5, widths: [44, ...Array<number>(numericCols).fill(monthW)] });
    }
    note(snapshot.cashFlow.intro);
    if (snapshot.cashFlow.excluded.length) note(`${L.notInView}: ${snapshot.cashFlow.excluded.join(', ')}.`);
  }

  // ---- Costs per acre, per crop ----
  const groupLabel: Record<string, string> = { cultural: L.t1Cultural, harvest: L.t1Harvest, assessment: L.t1Assessment, postharvest: L.t1Postharvest, other: L.t1Other };
  const extraLabel: Record<string, string> = { ownLabor: L.t1OwnLabor, hiredJobs: L.t1HiredJobs, lump: L.t1Lump, repairPool: L.t1RepairPool, interest: L.t1Interest };
  for (const tb of snapshot.table1) {
    const detail = snapshot.cropDetails.find(c => c.id === tb.cropId);
    tablePage(L.t1Title.replace('{crop}', tb.name));
    const w = pageWidth() - 2 * M;
    if (detail) {
      const trios: Row[] = [];
      for (let i = 0; i < detail.inputs.length; i += 3) {
        const trio = [detail.inputs[i], detail.inputs[i + 1], detail.inputs[i + 2]];
        trios.push(plain(trio.flatMap(v => [cell(v ? `${v.label}:` : '', { italic: true }), cell(v?.value ?? '')])));
      }
      table(null, trios, { fontSize: 8.5, rightFrom: 99, widths: [w * 0.12, w * 0.21, w * 0.12, w * 0.21, w * 0.12, w * 0.22] });
      y -= 1;
    }
    const body: Row[] = [];
    const sub = (c: { labor: number; flr: number; materials: number; custom: number; total: number }, time = '') => [cell(time), amt(c.labor), amt(c.flr), amt(c.materials), amt(c.custom), amt(c.total), cell('')];
    for (const g of tb.groups) {
      body.push(plain([cell(`${groupLabel[g.category]}:`), ...blank(7)]));
      for (const r of g.rows) body.push(plain([cell(r.name), cell(r.time > 0 ? r.time.toFixed(2) : '0.00'), ...sub(r).slice(1)]));
      const hours = g.rows.reduce((a, r) => a + (r.time > 0 ? r.time : 0), 0);
      body.push(total(L.t1Subtotal.replace('{group}', groupLabel[g.category]), sub(g.subtotal, hours.toFixed(2))));
    }
    for (const e of tb.extra) body.push(plain([cell(extraLabel[e.key]), ...blank(5), amt(e.amount), cell('')]));
    body.push(total(L.t1TotalOperating, [...blank(5), amt(tb.totalOperating), cell('')]));
    if (tb.cashOverhead.length) body.push(plain([cell(`${L.t1CashOverhead}:`), ...blank(7)]));
    for (const o of tb.cashOverhead) body.push(plain([cell(o.id === 'land-rent' ? L.t1LandRent : o.name), ...blank(5), amt(o.amount), cell('')]));
    body.push(total(L.t1TotalCashOverhead, [...blank(5), amt(tb.totalCashOverhead), cell('')]));
    if (tb.nonCash.length || tb.establishment) body.push(plain([cell(`${L.t1NonCash}:`), ...blank(7)]));
    for (const m of tb.nonCash) body.push(plain([cell(m.name), ...blank(5), amt(m.amount), cell('')]));
    if (tb.establishment) body.push(plain([cell(L.t1Establishment), ...blank(5), amt(tb.establishment.total), cell('')]));
    body.push(total(L.t1TotalNonCash, [...blank(5), amt(tb.totalNonCash), cell('')]));
    body.push(total(L.t1TotalCosts, [...blank(5), amt(tb.totalCosts), cell('')]));
    body.push(total(L.t1Gross, [...blank(5), amt(tb.grossReturns), cell('')]));
    body.push(total(L.t1NetOperating, [...blank(5), amt(tb.netAboveOperating), cell('')]));
    body.push(total(L.t1NetTotal, [...blank(5), amt(tb.netAboveTotal), cell('')]));
    table([L.t1Operation, L.t1Time, L.t1Labor, L.t1Flr, L.t1Materials, L.t1Custom, L.t1Total], body.map(r => Object.assign(r.slice(0, -1), { ruled: r.ruled })),
      { fontSize: 8.5, widths: [w * 0.34, w * 0.09, w * 0.11, w * 0.12, w * 0.11, w * 0.11, w * 0.12] });
    note(`${L.t1Caption} ${L.t1PerAcreNote.replace('{acres}', num(tb.acres)).replace('{plantings}', num(tb.plantings))}`);
    if (detail && (detail.timing.costs || detail.timing.sales)) {
      for (const start of [0, 6]) {
        const pct = (wts: number[] | null) => wts ? wts.slice(start, start + 6).map(v => cell(v > 0 ? `${Math.round(v * 100)}%` : '')) : blank(6);
        const lw = 44, mw = (w - lw) / 6;
        ensure(24); y += 2;
        table(['%', ...snapshot.cashFlow.months.slice(start, start + 6).map(upper)], [plain([cell(L.timingCosts.replace(/, .*$/, '')), ...pct(detail.timing.costs)]), plain([cell(L.timingSales.replace(/, .*$/, '')), ...pct(detail.timing.sales)])], { fontSize: 8.5, widths: [lw, ...Array<number>(6).fill(mw)] });
      }
    }
  }

  // ---- Table 4: ranging analysis (portrait) ----
  if (snapshot.ranging.length) {
    tablePage(L.t4Title.replace(/ ?(for|para) \{crop\}/, '').replace('{crop}', '').trim());
    for (const rg of snapshot.ranging) {
      ensure(56);
      font(10); doc.text(text(`${L.t4Net}: ${rg.name}`), center(), y, { align: 'center' });
      const tw = doc.getTextWidth(text(`${L.t4Net}: ${rg.name}`));
      rule(y + 0.8, 0.15, center() - tw / 2, center() + tw / 2); y += 4;
      const head = [[L.t4Yield.replace('{unit}', rg.unit), ...rg.prices.map(p => `$${cents(p)}`)]];
      const body = rg.yields.map((yv, i) => plain([cell(num(yv), { bold: i === 2 }), ...rg.net[i].map((n, j) => amt(n, i === 2 && j === 2))]));
      table(head, body, { fontSize: 9 });
      y += 2;
    }
    note(L.t4Caption);
  }

  // ---- Whole farm equipment, investment and business overhead ----
  if (snapshot.table5.machines.length || snapshot.table5.investments.length || snapshot.table5.overhead.length) {
    tablePage(L.t5Title);
    const t5 = snapshot.table5;
    const t5row = (m: typeof t5.machines[number]): Row => plain([cell(m.name), amt(m.price), cell(num(m.years)), amt(m.salvage), amt(m.capitalRecovery), amt(m.insurance), amt(m.taxes), amt(m.repairs), amt(m.total)]);
    const body: Row[] = t5.machines.map(t5row);
    if (t5.investments.length) { body.push(plain([cell(upper(L.t5Investments)), ...blank(8)])); for (const m of t5.investments) body.push(t5row(m)); }
    body.push(total(L.t5EquipmentTotal, [amt(t5.totals.price), cell('-'), amt(t5.totals.salvage), amt(t5.totals.capitalRecovery), amt(t5.totals.insurance), amt(t5.totals.taxes), amt(t5.totals.repairs), amt(t5.totals.total)]));
    const t5w = pageWidth() - 2 * M;
    table([L.t5Description, L.t5Price, L.t5Years, L.t5Salvage, L.t5CapitalRecovery, L.t5Insurance, L.t5Taxes, L.t5Repairs, L.t5Total], body, { fontSize: 8.5, widths: [t5w * 0.28, ...Array<number>(8).fill(t5w * 0.09)] });
    note(L.t5Caption);
    if (t5.overhead.length) {
      ensure(30); y += 3;
      font(10); doc.text(text(upper(L.t5Overhead)), center(), y, { align: 'center' }); y += 4;
      const ob: Row[] = t5.overhead.map(o => plain([cell(o.name), amt(o.amount)]));
      ob.push(total(L.t5OverheadTotal, [amt(t5.overheadTotal)]));
      table([L.item, L.amount], ob, { fontSize: 8.5, tableWidth: 150, widths: [110, 40] });
    }
  }

  // ---- Hourly equipment costs ----
  if (snapshot.table6.length) {
    tablePage(L.t6Title);
    const body: Row[] = snapshot.table6.map(m => {
      const carried = [...m.carriedBy.map(b => `${b.name} ${Math.round(b.share * 100)}%`), ...(m.customShare > 0 ? [`${L.t6Custom} ${Math.round(m.customShare * 100)}%`] : [])].join(', ');
      if (m.hours <= 0) return plain([cell(m.name), cell('0'), cell(L.t6None, { italic: true, align: 'left' }), ...blank(6), cell(carried, { align: 'left' })]);
      return plain([cell(m.name), cell(`${num(m.hours)}\n${L.t6HoursSplit.replace('{crop}', num(m.cropHours)).replace('{custom}', num(m.customHours))}`), cell(cents(m.capitalRecovery)), cell(cents(m.insurance)), cell(cents(m.taxes)), cell(cents(m.repairs)), cell(cents(m.fuelLube)), cell(cents(m.totalOperating)), cell(cents(m.totalCost)), cell(carried, { align: 'left' })]);
    });
    table([L.t6Machine, L.t6Hours, L.t6CapitalRecovery, L.t6Insurance, L.t6Taxes, L.t6Repairs, L.t6FuelLube, L.t6TotalOperating, L.t6TotalCost], body.map(r => r.slice(0, -1) as Row), { fontSize: 8, widths: [34, 18, ...Array<number>(7).fill((pageWidth() - 2 * M - 52) / 7)] });
    ensure(25);
    table([L.t6Machine, L.t6CarriedBy], body.map(r => plain([r[0], r[r.length - 1]])), { fontSize: 9, rightFrom: 2, widths: [52, 'auto'] });
    note(L.t6Caption);
  }

  // ---- Custom work ----
  if (snapshot.customWork.jobs.length) {
    inlineTitle(L.cwTitle);
    const cw = snapshot.customWork;
    const body: Row[] = cw.jobs.map(j => plain([cell(j.name), cell(j.machineName, { align: 'left' }), cell(num(j.hours)), amt(j.income), amt(j.cost), amt(j.net)]));
    body.push(total(L.cwTotal, [cell(''), cell(num(cw.jobs.reduce((a, j) => a + j.hours, 0))), amt(cw.income), amt(cw.cost), amt(cw.net)]));
    table([L.cwJob, L.cwMachine, L.cwHours, L.cwPaid, `${L.cwCost} (${L.cwCostNote})`, L.cwNet], body, { fontSize: 8.5, rightFrom: 2 });
    note(L.cwCaption);
  }

  // ---- Farm inputs and rules: the ASSUMPTIONS section ----
  heading(L.farm, true);
  table(null, snapshot.farm.fields.map(f => plain([cell(`${f.label}:`, { italic: true }), cell(f.value)])), { fontSize: 10, rightFrom: 99, widths: [80, 'auto'] });
  heading(L.rates);
  table(null, snapshot.farm.rates.map(r => plain([cell(`${r.label}:`, { italic: true }), cell(r.value)])), { fontSize: 10, rightFrom: 99, widths: [80, 'auto'] });
  if (snapshot.farm.overheadItems.length) {
    heading(L.overheadItems);
    table([L.item, L.amount, L.basis], snapshot.farm.overheadItems.map(o => plain([cell(o.name), amt(o.amount), cell(o.basis, { align: 'left' })])), { fontSize: 9.5, widths: [80, 30, 'auto'] });
  }
  heading(L.rules);
  for (const r of snapshot.farm.rules) para(r, 10.5, 'normal', true);

  // ---- Optional sources appendix ----
  if (options.includeDetails) {
  heading(L.sources, true);
  for (const s of snapshot.sources.studies) {
    ensure(40);
    para([s.title, s.year, s.region].filter(v => v != null).join(', '), 10.5, 'bold');
    para(s.url, 8.5, 'italic');
    const body = s.items.map(it => plain([cell(it.owner), cell(it.what), cell(it.value, { align: 'right' }), cell(String(it.page), { align: 'right' }), cell(it.quote, { italic: true, align: 'left' })]));
    table([L.owner, L.field, L.citedValue, L.page, L.quote], body, { fontSize: 8, rightFrom: 2, widths: [30, 42, 22, 12, 'auto'] });
  }
  if (snapshot.sources.methods.length) {
    heading(L.methods);
    for (const m of snapshot.sources.methods) runIn(m.name, `${m.quote} (${m.studyTitle}, ${L.page.toLowerCase()} ${m.page})`);
  }
  if (snapshot.sources.ours.length) {
    heading(snapshot.sources.oursTitle);
    para(snapshot.sources.oursIntro, 10.5, 'normal', true);
    y += 1;
    for (const m of snapshot.sources.ours) runIn(`${m.name} (${m.kind})`, m.formula);
  }

  }

  // The footer every study page carries: a centered citation line and the page number.
  const pages = doc.getNumberOfPages();
  const footLine = text([snapshot.title, place, L.publisher].filter(Boolean).join('    '));
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const h = doc.internal.pageSize.getHeight();
    font(8);
    const sourcesUrl = options.sourcesUrl ?? (typeof window !== 'undefined' ? new URL('#sources', window.location.href).href : undefined);
    if (sourcesUrl) doc.textWithLink(snapshot.lang === 'es' ? 'Fuentes y cálculos' : 'Sources and calculations', 14, h - 15, { url: sourcesUrl });
    font(8.5);
    doc.text(`${footLine}    ${p}`, doc.internal.pageSize.getWidth() / 2, h - 9, { align: 'center' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

export function downloadExport(bytes: Uint8Array<ArrayBuffer>, filename: string, kind: 'pdf' | 'xlsx' | 'csv') {
  const mime = kind === 'pdf' ? 'application/pdf' : kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
