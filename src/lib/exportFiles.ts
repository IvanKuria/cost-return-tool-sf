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

  // Equipment: machines across, figures down.
  {
    const sheet = book.addWorksheet(sheetName(L.equipment), { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
    const eq = snapshot.equipment;
    header(sheet, [L.machine, ...eq.map(e => e.name)]);
    fmtRow(sheet, [L.condition, ...eq.map(e => e.condition)], NUMBER);
    fmtRow(sheet, [L.paid, ...eq.map(e => Math.round(e.paid))], MONEY);
    fmtRow(sheet, [L.year, ...eq.map(e => e.year || null)], '0');
    fmtRow(sheet, [L.keepYears, ...eq.map(e => e.keepYears)], NUMBER);
    fmtRow(sheet, [L.hoursPerYear, ...eq.map(e => e.hoursPerYear)], NUMBER);
    fmtRow(sheet, [L.salvage, ...eq.map(e => Math.round(e.salvage))], MONEY);
    fmtRow(sheet, [L.fuelLube, ...eq.map(e => Math.round(e.fuelLube * 100) / 100)], '"$"#,##0.00');
    fmtRow(sheet, [L.repairs, ...eq.map(e => Math.round(e.repairs * 100) / 100)], '"$"#,##0.00');
    sheet.addRow([]);
    fmtRow(sheet, [L.capitalRecovery, ...eq.map(e => -Math.round(e.capitalRecovery))], MONEY);
    fmtRow(sheet, [L.interestOnSalvage, ...eq.map(e => -Math.round(e.interestOnSalvage))], MONEY);
    fmtRow(sheet, [L.insurance, ...eq.map(e => -Math.round(e.insurance))], MONEY);
    fmtRow(sheet, [L.taxes, ...eq.map(e => -Math.round(e.taxes))], MONEY);
    fmtRow(sheet, [L.totalPerYear, ...eq.map(e => -Math.round(e.totalPerYear))], MONEY, { bold: true });
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
    [40, 22, 34, 16, 8, 70, 40].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  }

  return new Uint8Array(await book.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// PDF: a short report. Letter, portrait; landscape only for the month table and equipment.
// ---------------------------------------------------------------------------

type Doc = import('jspdf').jsPDF;

export async function buildPdf(snapshot: ExportSnapshot): Promise<Uint8Array<ArrayBuffer>> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const L = snapshot.labels;
  const doc: Doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  doc.setProperties({ title: `${snapshot.title}, ${snapshot.dateText}`, creator: 'Farm Cost Planner' });

  const ink: [number, number, number] = [20, 22, 25];
  const grey: [number, number, number] = [98, 104, 114];
  const rule: [number, number, number] = [200, 204, 210];
  const red: [number, number, number] = [160, 40, 40];
  const green: [number, number, number] = [26, 127, 75];
  const text = (v: string) => v.replace(/−/g, '-').replace(/[  ]/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
  const cents = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const M = 16; // margin
  const TOP = 22;
  const BOTTOM = 16;
  const sectionOfPage: string[] = [];
  let section = L.summary;
  let y = TOP;
  const pageWidth = () => doc.internal.pageSize.getWidth();
  const pageHeight = () => doc.internal.pageSize.getHeight();
  const noteSection = () => { sectionOfPage[doc.getCurrentPageInfo().pageNumber] = section; };
  const newPage = (orientation: 'portrait' | 'landscape' = 'portrait') => { doc.addPage('letter', orientation); y = TOP; noteSection(); };
  const ensure = (needed: number) => { if (y + needed > pageHeight() - BOTTOM) newPage(); };
  const sectionTitle = (title: string, orientation: 'portrait' | 'landscape' = 'portrait', forceNew = true) => {
    section = title;
    if (forceNew) newPage(orientation); else { ensure(24); noteSection(); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...ink);
    doc.text(text(title), M, y); y += 8;
  };
  const para = (s: string, size = 10, color: [number, number, number] = ink, style: 'normal' | 'bold' = 'normal') => {
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color);
    const lines: string[] = doc.splitTextToSize(text(s), pageWidth() - 2 * M);
    ensure(lines.length * size * 0.45 + 2);
    doc.text(lines, M, y); y += lines.length * size * 0.45 + 2;
  };
  const subhead = (s: string) => { ensure(30); y += 2; para(s, 11, ink, 'bold'); };
  const kindColor = (kind: ValueKind, n: number): [number, number, number] => kind === 'expense' ? red : kind === 'net' ? (n < 0 ? red : green) : ink;

  type Cell = { text: string; color?: [number, number, number]; bold?: boolean; align?: 'left' | 'right' };
  const table = (head: string[], body: Cell[][], opts: { fontSize?: number; widths?: (number | 'auto')[]; rightFrom?: number; startY?: number } = {}) => {
    const rightFrom = opts.rightFrom ?? 1;
    const columnStyles: Record<number, { halign?: 'left' | 'right'; cellWidth?: number | 'auto' }> = {};
    head.forEach((_, i) => { columnStyles[i] = { halign: i >= rightFrom ? 'right' : 'left', cellWidth: opts.widths?.[i] ?? 'auto' }; });
    autoTable(doc, {
      startY: opts.startY ?? y,
      head: [head.map(text)],
      body: body.map(r => r.map(c => text(c.text))),
      margin: { top: TOP, bottom: BOTTOM, left: M, right: M },
      styles: { font: 'helvetica', fontSize: opts.fontSize ?? 9, cellPadding: 1.6, textColor: ink, lineColor: rule, lineWidth: 0, overflow: 'linebreak' },
      headStyles: { fillColor: [255, 255, 255], textColor: grey, fontStyle: 'normal', lineWidth: { bottom: 0.4 }, lineColor: ink },
      bodyStyles: { lineWidth: { bottom: 0.15 }, lineColor: rule },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      columnStyles,
      theme: 'plain',
      didParseCell: d => {
        if (d.section !== 'body') return;
        const c = body[d.row.index]?.[d.column.index];
        if (!c) return;
        if (c.color) d.cell.styles.textColor = c.color;
        if (c.bold) d.cell.styles.fontStyle = 'bold';
        if (c.align) d.cell.styles.halign = c.align;
      },
      didDrawPage: () => noteSection(),
    });
    y = (doc as Doc & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  };
  const cell = (t: string, extra: Partial<Cell> = {}): Cell => ({ text: t, ...extra });
  const moneyCell = (n: number, kind: ValueKind, bold = false): Cell => ({ text: money(kind === 'expense' ? -Math.abs(n) : n), color: kindColor(kind, n), bold });

  // ---- 1. Summary ----
  noteSection();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...ink);
  const titleLines: string[] = doc.splitTextToSize(text(snapshot.title), pageWidth() - 2 * M);
  doc.text(titleLines.slice(0, 2), M, y); y += Math.min(titleLines.length, 2) * 9;
  para([snapshot.county, snapshot.dateText].filter(Boolean).join(', '), 10, grey);
  y += 4;
  para(snapshot.headline, 15, ink, 'bold');
  if (snapshot.draftNote) para(snapshot.draftNote, 9.5, grey);
  y += 3;
  // facts row
  {
    const facts = snapshot.facts;
    const colW = (pageWidth() - 2 * M) / Math.max(facts.length, 1);
    ensure(20);
    doc.setDrawColor(...rule); doc.setLineWidth(0.2); doc.line(M, y, pageWidth() - M, y); y += 5;
    facts.forEach((f, i) => {
      const x0 = M + i * colW;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...grey);
      doc.text(doc.splitTextToSize(text(f.label), colW - 4)[0] ?? '', x0, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      const v = typeof f.value === 'number' ? (f.kind === 'number' ? num(f.value) : money(f.kind === 'expense' ? -Math.abs(f.value) : f.value)) : f.value;
      doc.setTextColor(...(typeof f.value === 'number' ? kindColor(f.kind, f.value) : ink));
      doc.text(text(v), x0, y + 6.5);
    });
    y += 12;
    doc.setDrawColor(...rule); doc.line(M, y, pageWidth() - M, y); y += 8;
  }
  {
    const rows = [...snapshot.cropTable.rows, snapshot.cropTable.total];
    const body = rows.map((r, i) => {
      const isTotal = i === rows.length - 1;
      return [cell(`${r.name}\n${num(r.acres)} ${L.acres}`, { bold: isTotal }), moneyCell(r.sales, 'money', isTotal), moneyCell(r.costs, 'expense', isTotal), moneyCell(r.net, 'net', true), moneyCell(r.perAcre, 'net', isTotal)];
    });
    table([L.crop, L.sales, L.costs, L.left, L.perAcre], body, { widths: [60, 'auto', 'auto', 'auto', 'auto'] });
  }
  if (snapshot.paperLoser) para(snapshot.paperLoser, 9.5, grey);

  // ---- 2. Cash flow by month (landscape) ----
  if (snapshot.cashFlow.rows.length) {
    sectionTitle(L.cashFlow, 'landscape');
    para(snapshot.cashFlow.intro, 9, grey);
    const head = ['', ...snapshot.cashFlow.months, L.total];
    const rowCells = (r: CashRow): Cell[] => {
      const strong = r.kind === 'net' || r.kind === 'balance';
      const color = (n: number): [number, number, number] | undefined => r.kind === 'out' || r.kind === 'fixed' ? red : r.kind === 'balance' || r.kind === 'net' ? (n < 0 ? red : n > 0 ? green : grey) : n === 0 ? grey : ink;
      return [cell(r.label, { bold: strong }), ...r.values.map(v => cell(money(v), { color: color(v), bold: strong })), cell(money(r.total), { color: color(r.total), bold: true })];
    };
    const monthW = (pageWidth() - 2 * M - 52) / 13;
    table(head, snapshot.cashFlow.rows.map(rowCells), { fontSize: 7.5, widths: [52, ...Array<number>(13).fill(monthW)] });
    if (snapshot.cashFlow.excluded.length) para(`${L.notInView}: ${snapshot.cashFlow.excluded.join(', ')}.`, 9, grey);
    // bar chart of monthly net
    const net = snapshot.cashFlow.rows.find(r => r.kind === 'net');
    if (net) {
      const h = 52; ensure(h + 14);
      para(L.chart, 10, ink, 'bold');
      const x0 = M + 18, w = pageWidth() - 2 * M - 18, top = y, mid = y + h / 2;
      const max = Math.max(1, ...net.values.map(Math.abs));
      const scale = (h / 2 - 4) / max;
      doc.setDrawColor(...rule); doc.setLineWidth(0.2); doc.line(x0, mid, x0 + w, mid);
      doc.setFontSize(7.5); doc.setTextColor(...grey); doc.setFont('helvetica', 'normal');
      doc.text(money(max), x0 - 2, top + 4, { align: 'right' }); doc.text('$0', x0 - 2, mid + 1, { align: 'right' }); doc.text(money(-max), x0 - 2, top + h - 1, { align: 'right' });
      const bw = w / 12;
      net.values.forEach((v, i) => {
        const bh = Math.abs(v) * scale;
        doc.setFillColor(...(v < 0 ? red : green));
        if (bh > 0) doc.rect(x0 + i * bw + bw * 0.2, v >= 0 ? mid - bh : mid, bw * 0.6, bh, 'F');
        doc.setTextColor(...grey); doc.text(text(snapshot.cashFlow.months[i]), x0 + i * bw + bw / 2, top + h + 4, { align: 'center' });
      });
      y = top + h + 10;
    }
  }

  // ---- 3. Crop details ----
  if (snapshot.cropDetails.length) {
    sectionTitle(L.cropDetails);
    for (const c of snapshot.cropDetails) {
      // Start a crop on a fresh page unless most of a page is still free.
      if (y > pageHeight() - BOTTOM - 95) newPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...ink); doc.text(text(c.name), M, y); y += 5;
      // inputs as label/value pairs, two per row
      const pairs: Cell[][] = [];
      for (let i = 0; i < c.inputs.length; i += 2) {
        const a = c.inputs[i], b = c.inputs[i + 1];
        pairs.push([cell(a.label, { color: grey }), cell(a.value, { align: 'left' }), cell(b?.label ?? '', { color: grey }), cell(b?.value ?? '', { align: 'left' })]);
      }
      const w = pageWidth() - 2 * M;
      table(['', '', '', ''], pairs, { fontSize: 8.5, rightFrom: 99, widths: [w * 0.2, w * 0.3, w * 0.2, w * 0.3] });
      y -= 3;
      // where the money goes: operating and overhead lines, then one row per machine
      const lines = c.breakdown.filter(b => b.group !== 'machine');
      const machinesByName = new Map<string, { capitalRecovery: number; interestOnSalvage: number; insurance: number; taxes: number; basis?: string }>();
      for (const b of c.breakdown.filter(b => b.group === 'machine')) {
        const [name, part] = b.label.split(': ');
        const m = machinesByName.get(name) ?? { capitalRecovery: 0, interestOnSalvage: 0, insurance: 0, taxes: 0, basis: b.basis };
        if (part === L.capitalRecovery) m.capitalRecovery += b.amount; else if (part === L.interestOnSalvage) m.interestOnSalvage += b.amount; else if (part === L.insurance) m.insurance += b.amount; else m.taxes += b.amount;
        machinesByName.set(name, m);
      }
      const totalCost = c.breakdown.reduce((s, b) => s + b.amount, 0);
      const body: Cell[][] = lines.map(b => [cell(b.label + (b.basis ? ` (${b.basis})` : ''), { color: b.group === 'operating' ? ink : grey }), cell(''), cell(''), cell(''), cell(''), moneyCell(b.amount, 'expense')]);
      if (machinesByName.size) {
        body.push([cell(L.equipmentShare, { bold: true }), cell(L.capitalRecovery, { color: grey, align: 'right' }), cell(L.interestOnSalvage, { color: grey, align: 'right' }), cell(L.insurance, { color: grey, align: 'right' }), cell(L.taxes, { color: grey, align: 'right' }), cell('')]);
        for (const [name, m] of machinesByName) body.push([cell(`${name}${m.basis ? ` (${m.basis})` : ''}`, { color: grey }), moneyCell(m.capitalRecovery, 'expense'), moneyCell(m.interestOnSalvage, 'expense'), moneyCell(m.insurance, 'expense'), moneyCell(m.taxes, 'expense'), moneyCell(m.capitalRecovery + m.interestOnSalvage + m.insurance + m.taxes, 'expense')]);
      }
      body.push([cell(L.costs, { bold: true }), cell(''), cell(''), cell(''), cell(''), moneyCell(totalCost, 'expense', true)]);
      table([L.whereMoneyGoes, '', '', '', '', L.amount], body, { fontSize: 8.5, widths: [w * 0.4, w * 0.12, w * 0.12, w * 0.12, w * 0.12, w * 0.12] });
      y -= 3;
      if ((c.machineHours.length && !c.operations.length) || c.hiredJobs.length) {
        para([...(c.machineHours.length && !c.operations.length ? [`${L.machineHours}: ${c.machineHours.map(m => `${m.label} ${m.value}`).join('; ')}.`] : []), ...(c.hiredJobs.length ? [`${L.hiredJobs}: ${c.hiredJobs.map(h => `${h.label} ${h.value}`).join('; ')}.`] : [])].join(' '), 8.5, grey);
      }
      const ops = c.operations.filter(o => o.enabled);
      if (ops.length) {
        const opsBody: Cell[][] = ops.map(o => [cell(o.name), cell(o.who, { color: grey }), cell(o.machineHours > 0 ? num(o.machineHours) : '', { align: 'right' }), cell(o.handHours > 0 ? num(o.handHours) : '', { align: 'right' }), moneyCell(o.materials, 'expense'), moneyCell(o.custom, 'expense'), moneyCell(o.costForYear, 'expense')]);
        opsBody.push([cell(L.total, { bold: true }), cell(''), cell(''), cell(''), cell(''), cell(''), moneyCell(ops.reduce((sum, o) => sum + o.costForYear, 0), 'expense', true)]);
        table([L.operation, L.who, L.machineHoursCol, L.handHoursCol, L.materialsCol, L.customCol, L.costForYear], opsBody, { fontSize: 7.5, rightFrom: 2, widths: [w * 0.34, w * 0.18, w * 0.09, w * 0.09, w * 0.1, w * 0.1, w * 0.1] });
        y -= 3;
      }
      // timing: one small table, two rows
      const pct = (wts: number[] | null) => wts ? wts.map(v => cell(`${Math.round(v * 100)}%`, { color: v > 0 ? ink : grey })) : Array.from({ length: 12 }, () => cell(''));
      const lw = 44, mw = (w - lw) / 12;
      table(['%', ...snapshot.cashFlow.months], [[cell(L.timingCosts.replace(/, .*$/, ''), { color: grey }), ...pct(c.timing.costs)], [cell(L.timingSales.replace(/, .*$/, ''), { color: grey }), ...pct(c.timing.sales)]], { fontSize: 7.5, widths: [lw, ...Array<number>(12).fill(mw)] });
      y += 4;
    }
  }

  // ---- 4. Equipment (landscape) ----
  if (snapshot.equipment.length) {
    sectionTitle(L.equipment, 'landscape');
    const head = [L.machine, L.condition, L.paid, L.year, L.keepYears, L.hoursPerYear, L.salvage, L.fuelLube, L.repairs, L.capitalRecovery, L.interestOnSalvage, L.insurance, L.taxes, L.totalPerYear, L.ownPerHour, L.allInPerHour];
    const body = snapshot.equipment.map(e => [
      cell(e.name), cell(e.condition), cell(money(e.paid)), cell(e.year ? String(e.year) : ''), cell(num(e.keepYears)), cell(num(e.hoursPerYear)), cell(money(e.salvage)),
      cell(cents(e.fuelLube)), cell(cents(e.repairs)),
      moneyCell(e.capitalRecovery, 'expense'), moneyCell(e.interestOnSalvage, 'expense'), moneyCell(e.insurance, 'expense'), moneyCell(e.taxes, 'expense'), moneyCell(e.totalPerYear, 'expense', true),
      cell(cents(-e.ownPerHour), { color: red }), cell(cents(-e.allInPerHour), { color: red, bold: true }),
    ]);
    table(head, body, { fontSize: 7.5, rightFrom: 2, widths: [40, 16] });
  }

  // ---- 5. Farm inputs and rules ----
  sectionTitle(L.farm, 'portrait', false);
  table([L.inputs, ''], snapshot.farm.fields.map(f => [cell(f.label, { color: grey }), cell(f.value, { align: 'left' })]), { rightFrom: 99, widths: [80, 'auto'] });
  subhead(L.rates);
  table(['', ''], snapshot.farm.rates.map(r => [cell(r.label, { color: grey }), cell(r.value, { align: 'left' })]), { rightFrom: 99, widths: [80, 'auto'] });
  if (snapshot.farm.overheadItems.length) {
    subhead(L.overheadItems);
    table([L.item, L.amount, L.basis], snapshot.farm.overheadItems.map(o => [cell(o.name), moneyCell(o.amount, 'expense'), cell(o.basis, { align: 'left', color: grey })]), { widths: [80, 40, 'auto'] });
  }
  subhead(L.rules);
  for (const r of snapshot.farm.rules) para(r, 10);

  // ---- 6. Sources ----
  sectionTitle(L.sources, 'portrait', false);
  for (const s of snapshot.sources.studies) {
    ensure(40);
    para([s.title, s.year, s.region].filter(v => v != null).join(', '), 10.5, ink, 'bold');
    para(s.url, 8, grey);
    const body = s.items.map(it => [cell(it.owner, { color: grey }), cell(it.what), cell(it.value, { align: 'right' }), cell(String(it.page), { align: 'right' }), cell(it.quote, { color: grey, align: 'left' })]);
    table([L.owner, L.field, L.citedValue, L.page, L.quote], body, { fontSize: 7.5, rightFrom: 2, widths: [30, 42, 22, 12, 'auto'] });
  }
  if (snapshot.sources.methods.length) {
    subhead(L.methods);
    for (const m of snapshot.sources.methods) {
      ensure(16);
      para(`${m.name} (${m.studyTitle}, ${L.page.toLowerCase()} ${m.page})`, 9.5, ink, 'bold');
      para(m.quote, 8.5, grey);
    }
  }

  // running header and footer on every page
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...grey);
    if (p > 1) {
      doc.text(text(snapshot.title), M, 12);
      doc.text(text(sectionOfPage[p] ?? ''), w - M, 12, { align: 'right' });
      doc.setDrawColor(...rule); doc.setLineWidth(0.2); doc.line(M, 14.5, w - M, 14.5);
    }
    doc.text(text(L.footer), M, h - 8);
    doc.text(text(L.pageOf.replace('{page}', String(p)).replace('{total}', String(total))), w - M, h - 8, { align: 'right' });
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
