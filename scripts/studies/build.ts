// Aggregates parsed studies into one importable JSON bundle for the app.
import fs from 'node:fs';
import path from 'node:path';
import { PARSED_DIR, ROOT } from './manifest';
import type { ParsedStudy } from './types';

const OUT = path.join(ROOT, 'src/data/studies.generated.json');
const INDEX_OUT = path.join(ROOT, 'src/data/studies/index.json');
const MAX_BYTES = 4 * 1024 * 1024; // the browser loads this file, so it stays under 4 MB

export interface SalvageObservation {
  description: string; price: number; salvageValue: number; yearsLife: number; fraction: number;
  studyId: string; year: number | null; page: number;
}

export interface StudiesBundle {
  generatedAt: string;
  count: number;
  byCommodity: Record<string, string[]>;
  studies: ParsedStudy[];            // operations dropped, archived studies first, when the bundle would exceed MAX_BYTES
  equipmentSalvage: SalvageObservation[];
  operationsIncluded: boolean;       // true when at least the current studies keep their operation rows
  operationsDroppedFor: string[];    // study ids whose operation rows are not in the bundle (full rows stay in data/studies/parsed)
}

function main() {
  const files = fs.readdirSync(PARSED_DIR).filter(f => f.endsWith('.json')).sort();
  const studies: ParsedStudy[] = files.map(f => JSON.parse(fs.readFileSync(path.join(PARSED_DIR, f), 'utf8')));
  const byCommodity: Record<string, string[]> = {};
  for (const s of studies) (byCommodity[s.source.commodity] ??= []).push(s.source.id);

  // Salvage observations come from the current studies; the archived ones are older prices.
  const equipmentSalvage: SalvageObservation[] = [];
  for (const s of studies.filter(x => !x.source.archived)) for (const e of s.equipment) {
    if (e.price > 0 && e.salvageValue >= 0 && e.salvageValue <= e.price && e.yearsLife > 0) {
      equipmentSalvage.push({ description: e.description, price: e.price, salvageValue: e.salvageValue, yearsLife: e.yearsLife, fraction: e.salvageValue / e.price, studyId: s.source.id, year: s.source.year, page: e.page });
    }
  }

  // The parse report (found/missing lists and warnings) stays in data/studies/parsed; the app does not read it.
  const light = studies.map(s => ({ ...s, parse: { fieldsFound: [], fieldsMissing: [], warnings: [] } }));
  const bundle: StudiesBundle = { generatedAt: new Date().toISOString().slice(0, 10), count: studies.length, byCommodity, studies: light, equipmentSalvage, operationsIncluded: true, operationsDroppedFor: [] };
  const strip = (s: ParsedStudy): ParsedStudy => ({ ...s, costsPerAcre: { ...s.costsPerAcre, operations: [] } });
  let json = JSON.stringify(bundle);
  if (Buffer.byteLength(json) > MAX_BYTES) {
    // Archived studies lose their operation rows first; the current studies are what the farmer app builds crops from.
    bundle.operationsDroppedFor = studies.filter(s => s.source.archived).map(s => s.source.id);
    bundle.studies = light.map(s => (s.source.archived ? strip(s) : s));
    json = JSON.stringify(bundle);
  }
  if (Buffer.byteLength(json) > MAX_BYTES) {
    bundle.operationsIncluded = false;
    bundle.operationsDroppedFor = studies.map(s => s.source.id);
    bundle.studies = light.map(strip);
    json = JSON.stringify(bundle);
  }
  fs.writeFileSync(OUT, json);
  // Lightweight index for tools that load studies one at a time (the lender tool, lazy loading): one row per study.
  const index = studies.map(s => ({
    id: s.source.id, commodity: s.source.commodity, title: s.source.title, year: s.source.year, priceYear: s.source.priceYear?.value ?? null,
    region: s.source.region, description: s.source.description, archived: s.source.archived, url: s.source.url, language: s.source.language,
    operatingTotal: s.costsPerAcre.operatingTotal?.value ?? null, totalCost: s.costsPerAcre.totalCost?.value ?? null,
    operations: s.costsPerAcre.operations.length, equipment: s.equipment.length, hasMonthly: Boolean(s.monthly), hasEstablishment: Boolean(s.establishment),
  }));
  fs.mkdirSync(path.dirname(INDEX_OUT), { recursive: true });
  fs.writeFileSync(INDEX_OUT, JSON.stringify(index));
  console.log(`wrote ${INDEX_OUT}: ${index.length} rows, ${(Buffer.byteLength(JSON.stringify(index)) / 1024).toFixed(0)} KB`);
  console.log(`wrote ${OUT}: ${studies.length} studies, ${equipmentSalvage.length} equipment rows, ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB, operations dropped for ${bundle.operationsDroppedFor.length} studies`);
}
main();
