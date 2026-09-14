import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Choice, Field, Input, Select } from './index';

function attribute(markup: string, name: string) {
  return markup.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

describe('accessible shared fields', () => {
  it('associates an existing input id and keeps interactive tags outside its label', () => {
    const markup = renderToStaticMarkup(<Field label="Farm name" tag={<button type="button">Source</button>}><Input id="farm-name" value="Farm" readOnly /></Field>);
    expect(markup).toContain('for="farm-name"');
    expect(markup).toContain('id="farm-name"');
    expect(markup).toContain('aria-label="Farm name"');
    expect(markup.match(/<label\b[^>]*>(.*?)<\/label>/)?.[1]).not.toContain('<button');
  });
  it('forwards the field id and hint to the select trigger', () => {
    const markup = renderToStaticMarkup(<Field label="County" hint="Choose your county"><Select value="county" onChange={() => {}}><option value="county">County</option></Select></Field>);
    const trigger = markup.match(/<button\b[^>]*role="combobox"[^>]*>/)?.[0] ?? '';
    expect(attribute(trigger, 'id')).toBe(attribute(markup, 'for'));
    expect(trigger).toContain('aria-label="County"');
    const hintId = attribute(trigger, 'aria-describedby');
    expect(hintId).toBeTruthy();
    expect(markup).toContain(`<span id="${hintId}"`);
  });
  it('names the radio group and associates its field hint', () => {
    const markup = renderToStaticMarkup(<Field label="Land unit" hint="How you measure your land"><Choice value="acres" onChange={() => {}} options={[{ value: 'acres', label: 'Acres' }, { value: 'beds', label: 'Beds' }]} /></Field>);
    const group = markup.match(/<div\b[^>]*role="radiogroup"[^>]*>/)?.[0] ?? '';
    expect(group).toContain('aria-label="Land unit"');
    expect(attribute(group, 'id')).toBe(attribute(markup, 'for'));
    expect(attribute(group, 'aria-describedby')).toBeTruthy();
    expect(markup).toContain(`<span id="${attribute(group, 'aria-describedby')}"`);
  });
});
