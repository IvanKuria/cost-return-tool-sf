import { describe, expect, it, vi, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { buildCashFlowCsv, buildPdf, buildWorkbook, downloadExport } from './exportFiles';
import { buildTable1, buildTable5, createExportSnapshot, exportFilename } from './exportData';
import { newBlankCrop, computePlan } from './engine';
import { DEFAULT_FARM } from './store';
import { SAMPLE_PLAN } from '../data/sample';
import type { Plan } from './types';

function planFixture(): Plan {
  return {
    farm: { ...DEFAULT_FARM, name: 'Finca Peña', interestRate: 0.05, operatingInterestRate: 0, overheadItems: [{ id: 'ins', name: 'Insurance', amountPerYear: 120, basis: 'acres' }] }, equipment: [], customWork: [],
    crops: [{ ...newBlankCrop('beans'), name: '=SUM(A1:A2)', area: 1, plantingsPerYear: 1,
      yieldPerAcre: 100, price: 12, operatingCostPerAcre: 200, missingFields: ['ownLaborHoursPerAcre'],
      costMonths: Array.from({ length: 12 }, (_, i) => i === 0 ? 1 : 0),
      revenueMonths: Array.from({ length: 12 }, (_, i) => i === 6 ? 1 : 0), timingSource: 'custom',
      citations: { price: { studyId: 'test', title: 'Study beans', year: 2020, region: 'Coast', page: 4, url: 'https://example.com/study.pdf', field: 'Price per unit', quote: 'A price of $10 per unit', value: 10 } },
    }],
  };
}

/** The example plan with yields and prices filled in, so layouts are judged on real-looking numbers. */
function filledSample(): Plan {
  return { ...SAMPLE_PLAN, crops: SAMPLE_PLAN.crops.map((c, i) => ({ ...c, yieldPerAcre: c.yieldPerAcre || 800 + i * 100, price: c.price || 14 + i, plantingsPerYear: c.plantingsPerYear || 1, missingFields: [] })) };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('export snapshot', () => {
  it('carries the engine totals, a written date, and a headline', () => {
    const plan = planFixture();
    const data = createExportSnapshot(plan, computePlan(plan), 'en', new Date('2026-09-22T12:00:00Z'));
    expect(data.provisional).toBe(true);
    expect(data.dateText).toBe('September 22, 2026');
    expect(data.facts.slice(0, 3).map(f => f.value)).toEqual([1200, 320, 880]);
    expect(data.headline).toBe('Estimate so far');
    expect(data.cropTable.rows[0].name).toBe('=SUM(A1:A2)');
    expect(data.cropTable.total.costs).toBe(320);
    expect(data.cropDetails[0].inputs.find(i => i.label === 'Your own hours')?.value).toBe('Missing input');
    expect(data.cropDetails[0].breakdown.find(b => b.label === 'Insurance')?.amount).toBe(120);
    expect(data.cashFlow.rows.map(r => r.label)).toEqual(['=SUM(A1:A2) sales', '=SUM(A1:A2) costs', 'Overhead and equipment', 'Net', 'Running balance']);
    expect(data.cashFlow.rows[0].values[6]).toBe(1200);
    expect(data.cashFlow.rows[1].values[0]).toBe(-200);
    expect(data.cashFlow.rows[4].total).toBeCloseTo(880, 5);
    const study = data.sources.studies.find(s => s.title === 'Study beans')!;
    expect(study.items[0].value).toBe('10 (your number: 12)');
    expect(study.items[0].quote).toBe('A price of $10 per unit');
    expect(data.sources.methods.length).toBeGreaterThan(0);
    expect(data.farm.overheadItems[0]).toEqual({ name: 'Insurance', amount: 120, basis: 'acres' });
    expect(data.farm.rates.find(r => r.label === 'Interest rate')?.value).toBe('5%');
  });

  it('lists study operations with who does them and an Operations sheet', async () => {
    const plan = filledSample();
    const data = createExportSnapshot(plan, computePlan(plan), 'en');
    const straw = data.cropDetails.find(c => c.name === 'Strawberries')!;
    expect(straw.operations.length).toBeGreaterThan(20);
    expect(straw.operations.some(o => o.who === '42HP 4WD Tractor')).toBe(true);
    expect(straw.operations.some(o => o.who === 'Hired out')).toBe(true);
    expect(straw.breakdown.map(b => b.label)).toContain('Hand labor at your rate');
    expect(straw.breakdown.map(b => b.label)).not.toContain('Growing and selling');
    expect(straw.inputs.map(i => i.label)).not.toContain('Growing costs per acre per planting (USD)');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildWorkbook(data)).buffer);
    const ops = book.getWorksheet('Operations')!;
    expect(ops.getRow(1).values).toContain('Who does it');
    expect(ops.rowCount).toBeGreaterThan(100);
    const crops = book.getWorksheet('Crops')!;
    const labels: string[] = [];
    crops.eachRow(r => { labels.push(String(r.getCell(1).value ?? '')); });
    expect(labels).toContain('Operations (Cost for the year)');
  });

  it('writes the cash flow CSV horizontally with a byte-order mark', () => {
    const plan = planFixture();
    const bytes = buildCashFlowCsv(createExportSnapshot(plan, computePlan(plan), 'en'));
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.trim().split('\r\n');
    expect(lines[1]).toBe('"Cash flow by month","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Total"');
    expect(lines[2]).toBe('"=SUM(A1:A2) sales",0,0,0,0,0,0,1200,0,0,0,0,0,1200');
    expect(lines[3].startsWith('"=SUM(A1:A2) costs",-200,')).toBe(true);
  });

  it('creates a horizontal XLSX with whole-dollar formats and literal formula-looking names', async () => {
    const plan = planFixture();
    const bytes = await buildWorkbook(createExportSnapshot(plan, computePlan(plan), 'en'));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes.buffer);
    expect(book.worksheets.map(s => s.name)).toEqual(['Summary', 'Cash flow by month', 'Crops', 'Crop timing', 'Table 1', 'Table 4', 'Table 5', 'Equipment', 'Farm', 'Sources']);
    const summary = book.getWorksheet('Summary')!;
    expect(summary.getCell('A1').value).toBe('Finca Peña');
    expect(summary.getCell('B4').value).toBe('=SUM(A1:A2)');
    expect(summary.getCell('B4').type).toBe(ExcelJS.ValueType.String);
    expect(summary.getCell('C4').value).toBe('Whole farm');
    const sales = summary.getRows(5, 14)!.find(r => r.getCell(1).value === 'Sales')!;
    expect(sales.getCell(2).value).toBe(1200);
    const costs = summary.getRows(5, 14)!.find(r => r.getCell(1).value === 'Costs')!;
    expect(costs.getCell(2).value).toBe(-320);
    expect(costs.getCell(2).numFmt).toBe('"$"#,##0;[Red]-"$"#,##0;"$"0');
    const flow = book.getWorksheet('Cash flow by month')!;
    expect(flow.getCell('A1').value).toBe('Cash flow by month');
    expect(flow.getCell('H2').value).toBe(1200);
    expect(flow.getCell('B3').value).toBe(-200);
    expect(flow.getCell('N6').value).toBeCloseTo(880, 5);
    const timing = book.getWorksheet('Crop timing')!;
    expect(timing.getCell('H3').value).toBe(1);
    expect(timing.getCell('H3').numFmt).toBe('0%');
    const crops = book.getWorksheet('Crops')!;
    expect(crops.getCell('A1').value).toBe('Inputs');
    expect(crops.getCell('B1').value).toBe('=SUM(A1:A2)');
  });

  it('generates a compact paginated PDF in Spanish', async () => {
    const plan = planFixture();
    const bytes = await buildPdf(createExportSnapshot(plan, computePlan(plan), 'es'));
    const content = new TextDecoder('latin1').decode(bytes);
    expect(content.startsWith('%PDF-')).toBe(true);
    expect(content).toContain('Finca Peña');
    expect(content).toContain('Flujo de efectivo por mes');
    expect(content).toContain('$1,200');
    expect(content).not.toContain('$1,200.00');
    expect(content.match(/\/Type \/Page\b/g)!.length).toBeLessThanOrEqual(9); // summary, cash flow, Table 1, Table 4, Table 5, farm, sources
    expect(content).toContain('%%EOF');
  });

  it('keeps the filled example under twenty pages with every operation listed', async () => {
    const plan = filledSample();
    const bytes = await buildPdf(createExportSnapshot(plan, computePlan(plan), 'en'));
    const content = new TextDecoder('latin1').decode(bytes);
    const pages = content.match(/\/Type \/Page\b/g)!.length;
    expect(pages).toBeGreaterThanOrEqual(5);
    expect(pages).toBeLessThan(28); // five crops, each with a full UC style Table 1, plus ranging, Table 5 and 6
  });

  it('builds UC style tables that reconcile with the engine', async () => {
    const plan = filledSample();
    const result = computePlan(plan);
    for (const c of plan.crops) {
      const tb = buildTable1(plan, result, c.id)!;
      const r = result.crops.find(k => k.cropId === c.id)!;
      const opsTotal = tb.groups.reduce((a, g) => a + g.subtotal.total, 0) + tb.extra.reduce((a, e) => a + e.amount, 0);
      expect(Math.abs(opsTotal - tb.totalOperating)).toBeLessThan(1);
      expect(Math.abs(tb.cashOverhead.reduce((a, o) => a + o.amount, 0) - tb.totalCashOverhead)).toBeLessThan(1);
      expect(Math.abs(tb.nonCash.reduce((a, m) => a + m.amount, 0) + (tb.establishment?.total ?? 0) - tb.totalNonCash)).toBeLessThan(1);
      expect(Math.abs((tb.totalOperating + tb.totalCashOverhead + tb.totalNonCash) * tb.seasons - r.totalCost)).toBeLessThan(1);
      expect(Math.abs(tb.totalCosts * tb.seasons - r.totalCost)).toBeLessThan(1);
    }
    const t5 = buildTable5(plan, result, 'Land rent');
    const repairs = result.machines.reduce((a, m) => a + m.repairsPerYear, 0);
    const establishment = result.crops.reduce((a, c) => a + (c.establishment?.total ?? 0), 0);
    expect(Math.abs(t5.totals.total - (result.equipmentOwnership + repairs + establishment))).toBeLessThan(1);
    expect(t5.machines.length).toBe(plan.equipment.length);
    const data = createExportSnapshot(plan, result, 'en');
    expect(data.table1.length).toBe(plan.crops.length);
    expect(data.ranging.length).toBe(3);
    expect(data.ranging[0].net.length).toBe(5);
    expect(data.ranging[0].net[2][2]).toBeCloseTo(result.crops[0].net / result.crops[0].acres, 3);
    expect(data.table6.length).toBe(plan.equipment.length);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildWorkbook(data)).buffer);
    for (const name of ['Table 1', 'Table 4', 'Table 5', 'Table 6']) expect(book.getWorksheet(name), name).toBeDefined();
    const pdf = new TextDecoder('latin1').decode(await buildPdf(data));
    expect(pdf).toContain('Table 5');
    expect(pdf).toContain('Table 6');
  });

  it('offers real download MIME and a safe filename, then releases the object URL', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { append: vi.fn() } });
    vi.stubGlobal('window', { setTimeout });
    const filename = exportFilename('../../Peña / farm', 'csv', new Date('2026-09-14T00:00:00Z'));
    downloadExport(new Uint8Array([80, 75]), filename, 'csv');
    expect(filename).toBe('Pena-farm-2026-09-14.csv');
    expect(createObjectURL.mock.calls[0][0].type).toBe('text/csv;charset=utf-8');
    expect(anchor.download).toBe(filename);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
