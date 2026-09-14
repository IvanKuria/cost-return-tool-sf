import type { ExportCell, ExportSnapshot, ExportTable } from './exportData';

/** Literal strings are never converted into formula objects, even when they begin '='. */
export async function buildWorkbook(snapshot: ExportSnapshot): Promise<Uint8Array<ArrayBuffer>> {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  book.creator = 'Farm Cost Planner';
  book.created = new Date(snapshot.created);
  book.title = `${snapshot.title} - ${snapshot.subtitle}`;
  for (const table of snapshot.tables) {
    const sheet = book.addWorksheet(table.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const columns = table.headers.length;
    sheet.addRow([snapshot.title]);
    sheet.addRow([`${snapshot.subtitle} | ${snapshot.created}`]);
    sheet.addRow([snapshot.tables[0].notes?.[0] ?? '']);
    for (let i = 1; i <= 3; i++) sheet.mergeCells(i, 1, i, columns);
    sheet.getRow(1).font = { bold: true, size: 18, color: { argb: 'FF141619' } };
    sheet.getRow(2).font = { italic: true, size: 10 };
    sheet.getRow(3).alignment = { wrapText: true };
    sheet.getRow(3).height = 30;
    const header = sheet.addRow(table.headers);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141619' } };
    header.height = 32;
    header.alignment = { vertical: 'middle', wrapText: true };
    for (const [rowIndex, values] of table.rows.entries()) {
      const row = sheet.addRow(values);
      row.alignment = { vertical: 'top', wrapText: true };
      row.eachCell((cell, column) => { if (typeof cell.value === 'number') cell.numFmt = table.formats?.[rowIndex]?.[column - 1] ?? '#,##0.####'; });
      if (row.number % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F5F7' } };
    }
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + table.rows.length, column: columns } };
    table.headers.forEach((heading, index) => {
      const strings = table.rows.map(row => row[index]).filter(v => typeof v === 'string');
      sheet.getColumn(index + 1).width = Math.min(55, Math.max(18, heading.length + 2, ...strings.map(v => Math.min(55, v.length + 2))));
    });
    for (const note of table.notes ?? []) {
      const row = sheet.addRow([note]);
      sheet.mergeCells(row.number, 1, row.number, columns);
      row.font = { italic: true, size: 10, color: { argb: 'FF626872' } };
      row.alignment = { wrapText: true, vertical: 'top' };
      row.height = Math.max(30, Math.ceil(note.length / 100) * 15);
    }
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}

export async function buildPdf(snapshot: ExportSnapshot): Promise<Uint8Array<ArrayBuffer>> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `${snapshot.title} - ${snapshot.subtitle}`, creator: 'Farm Cost Planner' });
  // Helvetica's WinAnsi repertoire supports Spanish accents; normalize unsupported minus/smart spaces.
  const text = (value: string) => value.replace(/\u2212/g, '-').replace(/[\u202f\u00a0]/g, ' ');
  const number = new Intl.NumberFormat(snapshot.lang === 'es' ? 'es-US' : 'en-US', { maximumFractionDigits: 4 });
  const currency = new Intl.NumberFormat(snapshot.lang === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency: 'USD' });
  const cell = (value: ExportCell, format?: string | null) => value === null ? '' : typeof value === 'number' ? format?.includes('"$"') || format?.includes('"-$"') ? currency.format(format.includes('"-$"') ? -value : value) : format === '0.00%' ? `${number.format(value * 100)}%` : number.format(value) : text(value);
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  let y = 16;
  function pageHeader() {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(20, 22, 25);
    const titleLines: string[] = doc.splitTextToSize(text(snapshot.title), width - 28);
    doc.text(titleLines.slice(0, 2), 14, 15);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(70);
    const subY = 16 + Math.min(titleLines.length, 2) * 6;
    doc.text(text(`${snapshot.subtitle} | ${snapshot.created}`), 14, subY);
    return subY + 9;
  }
  y = pageHeader();
  const pdfTables: ExportTable[] = snapshot.tables.flatMap((table, index): ExportTable[] => {
    if (index !== snapshot.tables.length - 1) return [table];
    const references = new Map<string, { id: number; title: ExportCell }>();
    for (const row of table.rows) if (!references.has(String(row[7]))) references.set(String(row[7]), { id: references.size + 1, title: row[2] });
    return [
      { name: table.name, headers: ['#', table.headers[2], table.headers[7]], rows: [...references].map(([url, ref]) => [ref.id, ref.title, url]), notes: table.notes },
      { name: table.name, headers: [table.headers[0], table.headers[1], '# / ' + table.headers[3], table.headers[4], table.headers[5], table.headers[6]], rows: table.rows.map(row => [row[0], row[1], `${references.get(String(row[7]))!.id} / ${row[3]}`, row[4], row[5], row[6]]) },
    ];
  });
  for (let i = 0; i < pdfTables.length; i++) {
    const table = pdfTables[i];
    if (i > 0) { doc.addPage(); y = pageHeader(); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 22, 25);
    doc.text(text(table.name), 14, y); y += 6;
    for (const note of table.notes ?? []) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(70);
      const lines: string[] = doc.splitTextToSize(text(note), width - 28);
      if (y + lines.length * 4 > height - 24) { doc.addPage(); y = pageHeader(); }
      doc.text(lines, 14, y); y += lines.length * 4 + 3;
    }
    autoTable(doc, {
      startY: y, head: [table.headers.map(text)], body: table.rows.map((row, r) => row.map((value, c) => cell(value, table.formats?.[r]?.[c]))),
      margin: { top: 32, bottom: 18, left: 14, right: 14 },
      styles: { font: 'helvetica', fontSize: table.headers.length > 6 ? 8 : 9, cellPadding: 2.5, overflow: 'linebreak' },
      headStyles: { fillColor: [20, 22, 25] }, alternateRowStyles: { fillColor: [244, 245, 247] },
      columnStyles: i === pdfTables.length - 2 ? { 0: { cellWidth: 10 }, 1: { cellWidth: 115 }, 2: { cellWidth: 144 } } : i === pdfTables.length - 1 ? { 0: { cellWidth: 35 }, 1: { cellWidth: 65 }, 2: { cellWidth: 19 }, 3: { cellWidth: 28 }, 4: { cellWidth: 28 }, 5: { cellWidth: 94 } } : undefined,
      rowPageBreak: 'avoid',
      didParseCell: data => { if (data.section === 'body' && table.formats?.[data.row.index]?.[data.column.index]?.includes('"-$"')) data.cell.styles.textColor = [180, 45, 45]; },
      didDrawPage: (data) => { if (data.pageNumber > 1) pageHeader(); },
    });
  }
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page); doc.setFontSize(8); doc.setTextColor(90);
    doc.text(`${page} / ${totalPages}`, width - 14, height - 8, { align: 'right' });
    doc.text('Farm Cost Planner | USD', 14, height - 8);
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

export function downloadExport(bytes: Uint8Array<ArrayBuffer>, filename: string, kind: 'pdf' | 'xlsx') {
  const mime = kind === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
