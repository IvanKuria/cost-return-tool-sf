import { describe, expect, it, vi, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { buildPdf, buildWorkbook, downloadExport } from './exportFiles';
import { createExportSnapshot, exportFilename } from './exportData';
import { newBlankCrop, computePlan } from './engine';
import { DEFAULT_FARM } from './store';
import type { Plan } from './types';

function planFixture(): Plan {
  return {
    farm: { ...DEFAULT_FARM, name: 'Finca Peña', interestRate: 0.05 }, equipment: [],
    crops: [{ ...newBlankCrop('beans'), name: '=SUM(A1:A2)', area: 1, plantingsPerYear: 1,
      yieldPerAcre: 100, price: 12, operatingCostPerAcre: 200, missingFields: ['ownLaborHoursPerAcre'],
      costMonths: Array.from({ length: 12 }, (_, i) => i === 0 ? 1 : 0),
      revenueMonths: Array.from({ length: 12 }, (_, i) => i === 6 ? 1 : 0), timingSource: 'custom',
      citations: { price: { studyId: 'test', title: 'Study beans', year: 2020, region: 'Coast', page: 4, url: 'https://example.com/study.pdf', field: 'Price per unit', quote: '', value: 10 } },
    }],
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('download snapshots', () => {
  it('retains engine totals and missing inputs separately from intentional zero', () => {
    const plan = planFixture();
    const data = createExportSnapshot(plan, computePlan(plan), 'en', new Date('2026-09-14T12:00:00Z'));
    expect(data.provisional).toBe(true);
    expect(data.tables[0].rows.slice(0, 3).map(row => row[1])).toEqual([1200, 200, 1000]);
    expect(data.tables.find(t => t.name === 'Crop inputs')?.rows.find(row => String(row[1]).startsWith('Own labor'))?.[2]).toBeNull();
    expect(data.tables.find(t => t.name === 'Farm inputs')?.rows.find(row => String(row[1]).startsWith('Land rent'))?.[2]).toBe(0);
    const source = data.tables.find(t => t.name === 'Sources')?.rows.find(row => row[0] === '=SUM(A1:A2)');
    expect(source?.slice(4, 7)).toEqual([10, 12, 'your number']);
    expect(data.tables.find(t => t.name === 'Monthly cash')?.rows[6]).toEqual(['July', 1200, 1000]);
  });

  it('creates a real XLSX with numeric totals, blank missing cells and literal formula-looking names', async () => {
    const plan = planFixture();
    const bytes = await buildWorkbook(createExportSnapshot(plan, computePlan(plan), 'en'));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes.buffer);
    const summary = book.getWorksheet('Summary')!;
    expect(summary.getCell('B5').value).toBe(1200);
    expect(summary.getCell('B6').value).toBe(200);
    expect(summary.getCell('B6').numFmt).toContain('-$');
    const inputs = book.getWorksheet('Crop inputs')!;
    expect(inputs.getCell('A5').value).toBe('=SUM(A1:A2)');
    expect(inputs.getCell('A5').type).toBe(ExcelJS.ValueType.String);
    const missingRow = inputs.getRows(5, 7)!.find(row => String(row.getCell(2).value).startsWith('Own labor'))!;
    expect(missingRow.getCell(3).value).toBeNull();
    expect(missingRow.getCell(4).value).toBe('Missing input');
    const farm = book.getWorksheet('Farm inputs')!;
    const interest = farm.getRows(5, 10)!.find(row => String(row.getCell(2).value).startsWith('Interest'))!;
    expect(interest.getCell(3).value).toBe(0.05);
    expect(interest.getCell(3).numFmt).toBe('0.00%');
    expect(book.getWorksheet('Monthly cash')!.getCell('C16').value).toBe(1000);
  });

  it('generates a paginated PDF with Spanish text and the current result, not cited defaults', async () => {
    const plan = planFixture();
    const bytes = await buildPdf(createExportSnapshot(plan, computePlan(plan), 'es'));
    const content = new TextDecoder('latin1').decode(bytes);
    expect(content.startsWith('%PDF-')).toBe(true);
    expect(content).toContain('Finca Peña');
    expect(content).toContain('Resumen');
    expect(content).toContain('$1,200.00');
    expect(content.match(/\/Type \/Page\b/g)!.length).toBeGreaterThanOrEqual(10);
    expect(content).toContain('%%EOF');
  });

  it('offers real download MIME and a safe filename, then releases the object URL', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { append: vi.fn() } });
    vi.stubGlobal('window', { setTimeout });
    const filename = exportFilename('../../Peña / farm', 'xlsx', new Date('2026-09-14T00:00:00Z'));
    downloadExport(new Uint8Array([80, 75]), filename, 'xlsx');
    expect(filename).toBe('Pena-farm-2026-09-14.xlsx');
    expect(createObjectURL.mock.calls[0][0].type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(anchor.download).toBe(filename);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
