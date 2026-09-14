import type { ParsedStudy } from './studySchema';

export const UNKNOWN = '__unknown__';
export type ProductionMethod = 'organic' | 'conventional' | 'mixed' | 'unknown';
export type EquipmentCategory = 'tractors' | 'vehicles' | 'soil' | 'planting' | 'spraying' | 'irrigation' | 'harvest' | 'buildings' | 'other';
export const EQUIPMENT_CATEGORIES: EquipmentCategory[] = ['tractors', 'vehicles', 'soil', 'planting', 'spraying', 'irrigation', 'harvest', 'buildings', 'other'];

/** Only identify methods explicitly named in human-readable source metadata. */
export function productionMethod(study: ParsedStudy): ProductionMethod {
  const text = `${study.source.title} ${study.source.description ?? ''}`.toLowerCase();
  const organic = /\borganic\b/.test(text.replace(/\bnon[- ]organic\b/g, ''));
  const conventional = /\bconventional\b|\bnon[- ]organic\b/.test(text);
  if (organic && conventional) return 'mixed';
  return conventional ? 'conventional' : organic ? 'organic' : 'unknown';
}

export function countyMentioned(study: ParsedStudy, county: string): boolean {
  const normalized = county.trim().replace(/\s+county$/i, '').toLowerCase();
  if (!normalized) return false;
  const text = `${study.source.region ?? ''} ${study.source.counties ?? ''}`.toLowerCase();
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

export interface StudyFilters { region?: string; year?: string; method?: string; county?: string; sort?: 'newest' | 'county' }
export function filterStudies(studies: ParsedStudy[], filters: StudyFilters): ParsedStudy[] {
  return studies.filter(s => (!filters.region || (s.source.region?.trim() || UNKNOWN) === filters.region)
    && (!filters.year || String(s.source.year ?? UNKNOWN) === filters.year)
    && (!filters.method || productionMethod(s) === filters.method))
    .sort((a, b) => (filters.sort === 'county' ? Number(countyMentioned(b, filters.county ?? '')) - Number(countyMentioned(a, filters.county ?? '')) : 0)
      || (b.source.year ?? -Infinity) - (a.source.year ?? -Infinity)
      || a.source.id.localeCompare(b.source.id));
}

/** Browsing categories use description keywords, never change study data or prices. */
export function equipmentCategory(description: string): EquipmentCategory {
  const d = description.toLowerCase();
  if (/\btractor\b|\bcrawler\b/.test(d)) return 'tractors';
  if (/\btruck\b|\bpickup\b|\batv\b|\butv\b|\btrailer\b/.test(d)) return 'vehicles';
  if (/\birrig|\bpump\b|\bwell\b|\bsprinkler\b/.test(d)) return 'irrigation';
  if (/\bspray|\bduster\b/.test(d)) return 'spraying';
  if (/\bplanter\b|\bseed|\btransplant/.test(d)) return 'planting';
  if (/\bharvest|\bpick|\bcombine\b|\bbaler\b|\bmower\b|\bshaker\b/.test(d)) return 'harvest';
  if (/\bdisc\b|\bdisk\b|\bplow\b|\bcultivat|\bripper\b|\btiller\b|\bharrow\b|\blister\b/.test(d)) return 'soil';
  if (/\bbuild|\bshed\b|\bbarn\b|\bshop\b|\bfence\b|\bgreenhouse\b/.test(d)) return 'buildings';
  return 'other';
}

/** Expand only unambiguous abbreviations; retain numbers, dimensions and horsepower. */
export function equipmentDisplayName(description: string): string {
  return description.replace(/\bpto\b/gi, 'PTO').replace(/\bhp\b/gi, 'HP').replace(/\b4wd\b/gi, '4-wheel drive').replace(/\b2wd\b/gi, '2-wheel drive').replace(/\s+/g, ' ').trim();
}
