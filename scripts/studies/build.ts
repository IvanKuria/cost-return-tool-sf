// Aggregates parsed studies into one importable JSON bundle for the app.
import fs from 'node:fs';
import path from 'node:path';
import { PARSED_DIR, ROOT } from './manifest';
import type { ParsedStudy } from './types';

const OUT = path.join(ROOT, 'src/data/studies.generated.json');
const MAX_BYTES = 3 * 1024 * 1024;

export interface SalvageObservation {
  description: string; price: number; salvageValue: number; yearsLife: number; fraction: number;
  studyId: string; year: number | null; page: number;
}

export interface StudiesBundle {
  generatedAt: string;
  count: number;
  byCommodity: Record<string, string[]>;
  studies: ParsedStudy[];            // operations dropped when the bundle would exceed MAX_BYTES
  equipmentSalvage: SalvageObservation[];
  operationsIncluded: boolean;
}

function main() {
  const files = fs.readdirSync(PARSED_DIR).filter(f => f.endsWith('.json')).sort();
  const studies: ParsedStudy[] = files.map(f => JSON.parse(fs.readFileSync(path.join(PARSED_DIR, f), 'utf8')));
  const byCommodity: Record<string, string[]> = {};
  for (const s of studies) (byCommodity[s.source.commodity] ??= []).push(s.source.id);

  const equipmentSalvage: SalvageObservation[] = [];
  for (const s of studies) for (const e of s.equipment) {
    if (e.price > 0 && e.salvageValue >= 0 && e.salvageValue <= e.price && e.yearsLife > 0) {
      equipmentSalvage.push({ description: e.description, price: e.price, salvageValue: e.salvageValue, yearsLife: e.yearsLife, fraction: e.salvageValue / e.price, studyId: s.source.id, year: s.source.year, page: e.page });
    }
  }

  const bundle: StudiesBundle = { generatedAt: new Date().toISOString().slice(0, 10), count: studies.length, byCommodity, studies, equipmentSalvage, operationsIncluded: true };
  let json = JSON.stringify(bundle);
  if (Buffer.byteLength(json) > MAX_BYTES) {
    bundle.operationsIncluded = false;
    bundle.studies = studies.map(s => ({ ...s, costsPerAcre: { ...s.costsPerAcre, operations: [] } }));
    json = JSON.stringify(bundle);
  }
  fs.writeFileSync(OUT, json);
  console.log(`wrote ${OUT}: ${studies.length} studies, ${equipmentSalvage.length} equipment rows, ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB, operations ${bundle.operationsIncluded ? 'included' : 'dropped'}`);
}
main();
