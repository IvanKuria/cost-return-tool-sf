import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { en } from '../i18n/en';
import { es } from '../i18n/es';
import { CropStudyPicker, EquipmentStudyPicker } from './StudyPickers';

function renderPicker(kind: 'crop' | 'equipment', language: 'en' | 'es' = 'en') {
  vi.stubGlobal('localStorage', { getItem: () => language });
  const picker = kind === 'crop'
    ? <CropStudyPicker county="Yolo" onPick={() => {}} onCancel={() => {}} />
    : <EquipmentStudyPicker onPick={() => {}} onCancel={() => {}} />;
  return renderToStaticMarkup(<I18nProvider>{picker}</I18nProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe('optional study pickers', () => {
  it('starts crop selection with a labeled search and editable-values explanation', () => {
    const html = renderPicker('crop');
    expect(html).toContain(en['picker.optional']);
    expect(html).toMatch(/<input[^>]*aria-label="Find a crop"/);
    expect(html).toContain('role="status"');
    expect(html).toContain(en['crops.which']);
    expect(html).toContain('Spinach');
    expect(html).not.toContain('<select'); // Metadata filters follow choosing a crop.
    expect(html).not.toContain('Use values from this study');
    expect(html).not.toContain('<svg');
  });

  it('offers a labeled category filter and leaves study groups closed until chosen', () => {
    const html = renderPicker('equipment');
    expect(html).toContain(en['picker.optional']);
    expect(html).toMatch(/<input[^>]*aria-label="Find equipment"/);
    expect(html).toMatch(/<select[^>]*aria-label="Equipment category"/);
    expect(html).toContain('<option value="" selected="">All categories</option>');
    expect(html).toContain('Tractors (');
    expect(html).toContain('Irrigation (');
    expect(html).toContain('Categories group words in equipment descriptions.');
    const states = [...html.matchAll(/aria-expanded="(true|false)"/g)].map(m => m[1]);
    expect(states.length).toBeGreaterThan(0);
    expect(states.every(state => state === 'false')).toBe(true);
    expect(html).not.toContain('Study purchase price:');
    expect(html).not.toContain('<svg');
  });

  it('renders crop search and equipment category choices in Spanish', () => {
    const crop = renderPicker('crop', 'es');
    expect(crop).toContain(es['picker.optional']);
    expect(crop).toMatch(/<input[^>]*aria-label="Busque un cultivo"/);
    expect(crop).toContain('Espinaca');
    const equipment = renderPicker('equipment', 'es');
    expect(equipment).toMatch(/<input[^>]*aria-label="Busque equipo"/);
    expect(equipment).toMatch(/<select[^>]*aria-label="Categoría de equipo"/);
    expect(equipment).toContain('Todas las categorías');
    expect(equipment).toContain('Tractores (');
    expect(equipment).toContain('Ver opciones de ');
    expect(equipment).not.toContain('View options from ');
  });

  it('provides every picker label in both languages with matching variables', () => {
    const keys = Object.keys(en).filter(k => k.startsWith('picker.')) as Array<keyof typeof en>;
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(es[key], key).toBeTruthy();
      expect([...es[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), key)
        .toEqual([...en[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort());
    }
  });
});
