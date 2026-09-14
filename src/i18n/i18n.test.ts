import { describe, expect, it } from 'vitest';
import { en } from './en';
import { es } from './es';
import { fill } from './index';

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('translations', () => {
  const enKeys = Object.keys(en).sort();
  const esKeys = Object.keys(es).sort();

  it('es has exactly the keys en has', () => {
    expect(esKeys).toEqual(enKeys);
  });

  it('no value is empty', () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), `en ${k}`).not.toBe('');
    for (const [k, v] of Object.entries(es)) expect(v.trim(), `es ${k}`).not.toBe('');
  });

  it('no value contains an em dash', () => {
    for (const [k, v] of Object.entries(en)) expect(v, `en ${k}`).not.toContain('—');
    for (const [k, v] of Object.entries(es)) expect(v, `es ${k}`).not.toContain('—');
  });

  it('every placeholder in en also appears in es', () => {
    for (const k of enKeys) {
      const e = en[k as keyof typeof en];
      const s = es[k as keyof typeof es];
      expect(placeholders(s), k).toEqual(placeholders(e));
    }
  });

  it('fill replaces placeholders and leaves unknown ones', () => {
    expect(fill('Next: {step}', { step: 'Crops' })).toBe('Next: Crops');
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });
});
