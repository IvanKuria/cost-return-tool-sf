import { describe, expect, it } from 'vitest';
import { STUDIES } from './studies';
import type { ParsedStudy } from './studySchema';
import { countyMentioned, equipmentCategory, equipmentDisplayName, filterStudies, productionMethod, UNKNOWN } from './studyPicker';

function study(id: string, source: Partial<ParsedStudy['source']> = {}): ParsedStudy {
  return { ...STUDIES[0], source: { ...STUDIES[0].source, id, title: 'Production costs', description: null, region: null, counties: null, year: null, ...source } };
}

describe('study picker metadata', () => {
  it('does not infer conventional production from absent organic wording', () => {
    expect(productionMethod(study('unknown', { description: 'Drip irrigation' }))).toBe('unknown');
    expect(productionMethod(study('organic', { description: 'Organic spinach' }))).toBe('organic');
    expect(productionMethod(study('conventional', { description: 'Conventional production' }))).toBe('conventional');
    expect(productionMethod(study('mixed', { description: 'Organic and conventional' }))).toBe('mixed');
    expect(productionMethod(study('non', { description: 'Non-organic production' }))).toBe('conventional');
    expect(productionMethod(study('mixedNon', { description: 'Organic and non-organic production' }))).toBe('mixed');
  });

  it('filters exact metadata, preserves unknowns and sorts newest first', () => {
    const old = study('old', { year: 2000, region: 'Coast', description: 'Organic' });
    const recent = study('recent', { year: 2024, region: 'Coast', description: 'Organic' });
    const unknown = study('unknown');
    const inland = study('inland', { year: 2025, region: 'Inland' });
    const list = [unknown, old, inland, recent];
    expect(filterStudies(list, {}).map(s => s.source.id)).toEqual(['inland', 'recent', 'old', 'unknown']);
    expect(filterStudies(list, { region: 'Coast', method: 'organic', year: '2024' })).toEqual([recent]);
    expect(filterStudies(list, { region: UNKNOWN, year: UNKNOWN, method: 'unknown' })).toEqual([unknown]);
    expect(list[0]).toBe(unknown);
  });

  it('county ordering is opt-in and uses literal metadata mentions', () => {
    const local = study('local', { year: 2000, counties: 'Advisor for Yolo and Solano' });
    const newer = study('newer', { year: 2025, region: 'Central Coast' });
    expect(countyMentioned(local, 'Yolo County')).toBe(true);
    expect(countyMentioned(local, 'Solo')).toBe(false);
    expect(countyMentioned(local, '')).toBe(false);
    expect(filterStudies([local, newer], { county: 'Yolo' })[0]).toBe(newer);
    expect(filterStudies([local, newer], { county: 'Yolo', sort: 'county' })[0]).toBe(local);
  });
});

describe('equipment picker descriptions', () => {
  it('groups common descriptions without treating every investment as a tractor', () => {
    expect(equipmentCategory('Tractor 85 HP')).toBe('tractors');
    expect(equipmentCategory('Pickup truck 1/2 ton')).toBe('vehicles');
    expect(equipmentCategory('Irrigation pump')).toBe('irrigation');
    expect(equipmentCategory('Disc 12 ft')).toBe('soil');
    expect(equipmentCategory('Unknown accessory')).toBe('other');
  });

  it('preserves sizes and horsepower while expanding drive abbreviations', () => {
    expect(equipmentDisplayName('Tractor  85 hp 4WD')).toBe('Tractor 85 HP 4-wheel drive');
    expect(equipmentDisplayName('Disc 12\' 6"')).toBe('Disc 12\' 6"');
  });
});
