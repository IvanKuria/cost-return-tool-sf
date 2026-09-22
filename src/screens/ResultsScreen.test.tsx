import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n';
import { computePlan, newBlankCrop } from '../lib/engine';
import { DEFAULT_FARM } from '../lib/store';
import type { Crop, Plan } from '../lib/types';
import { ResultsScreen } from './ResultsScreen';

// A farmer-entered crop: $1,200 sales in July and $200 costs in January.
function enteredCrop(): Crop {
  return {
    ...newBlankCrop('beans'), name: 'Market beans', area: 1, plantingsPerYear: 1,
    yieldPerAcre: 100, price: 12, operatingCostPerAcre: 200, missingFields: [],
    timingSource: 'custom',
    costMonths: Array.from({ length: 12 }, (_, i) => i === 0 ? 1 : 0),
    revenueMonths: Array.from({ length: 12 }, (_, i) => i === 6 ? 1 : 0),
  };
}
function render(crops: Crop[]) {
  const plan: Plan = { farm: { ...DEFAULT_FARM }, crops, equipment: [] };
  return renderToStaticMarkup(<I18nProvider><ResultsScreen plan={plan} result={computePlan(plan)} dispatch={() => {}} /></I18nProvider>);
}
function chart(html: string) {
  const section = html.match(/<section aria-labelledby="cash-heading">([\s\S]*?)<\/section>/);
  expect(section, 'cash chart section is visible in the rendered results').not.toBeNull();
  return section![1];
}

describe('farmer-facing results', () => {
  it('leads with annual sales, costs and net, followed by cash and crop breakdown', () => {
    const html = render([enteredCrop()]);
    const summary = html.match(/<section>([\s\S]*?)<\/section>/)![1];
    expect(summary).toContain('Your farm results');
    expect(summary).toContain('$1,200');
    expect(summary).toContain('200');
    expect(summary).toContain('$1,000');
    expect(summary.indexOf('Sales')).toBeLessThan(summary.indexOf('Net return'));
    expect(html.indexOf('Net return')).toBeLessThan(html.indexOf('Cash through the year'));
    expect(html.indexOf('Cash through the year')).toBeLessThan(html.indexOf('Which crops carry the farm'));
    const disclosures = [...html.matchAll(/<details([^>]*)>/g)];
    expect(disclosures.length).toBeGreaterThan(0);
    expect(disclosures.every(match => !/\bopen\b/.test(match[1]))).toBe(true);
  });

  it('offers a labeled month selector without selecting January for the user', () => {
    const html = chart(render([enteredCrop()]));
    expect(html).toMatch(/<label for="cash-month"[^>]*>Inspect a month<\/label>/);
    const selector = html.match(/<select id="cash-month"[^>]*>([\s\S]*?)<\/select>/)?.[1];
    expect(selector).toBeDefined();
    expect(selector).toMatch(/<option value="" selected="">/);
    expect([...selector!.matchAll(/<option\b/g)]).toHaveLength(13);
    expect(selector).toContain('<option value="0">January</option>');
    expect(selector).toContain('<option value="11">December</option>');
    expect(html).toContain('<span class="">Jan</span>');
    expect(html).toMatch(/aria-live="polite">Select a month to see its exact value<\/p>/);
  });

  it('names untimed crops as excluded without dropping their annual sales', () => {
    const untimed = { ...enteredCrop(), id: 'peas', name: 'Untimed peas', costMonths: null, revenueMonths: null };
    const html = render([enteredCrop(), untimed]);
    const cash = chart(html);
    expect(cash).toContain('Included: Market beans.');
    expect(cash).toContain('Not included yet: Untimed peas.');
    const originalPlot = chart(render([enteredCrop()])).match(/<svg[\s\S]*?<\/svg>/)?.[0];
    expect(originalPlot).toBeDefined();
    expect(cash.match(/<svg[\s\S]*?<\/svg>/)?.[0]).toBe(originalPlot);
    expect(html.slice(0, html.indexOf('cash-heading'))).toContain('$2,400');
  });

  it('shows unfinished custom crops as provisional with a named edit action', () => {
    const html = render([{ ...newBlankCrop('draft'), name: 'My new orchard' }]);
    expect(html).toContain('Estimate so far');
    const warning = html.match(/<aside[^>]*aria-label="Review missing inputs"[\s\S]*?<\/aside>/)?.[0];
    expect(warning).toBeDefined();
    expect(warning).toMatch(/<button[^>]*>My new orchard<\/button>/);
    expect(warning).toContain('Yield');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });

  it('charts a complete custom crop without requiring study defaults', () => {
    const crop = enteredCrop();
    expect(crop.studyId).toBeNull();
    const html = render([crop]);
    expect(html).not.toContain('Review missing inputs');
    const cash = chart(html);
    expect(cash).toContain('role="img"');
    expect(cash).toContain('Monthly cash movement');
    expect(cash).toContain('Cumulative balance');
    expect(cash).toContain('Lowest projected month-end balance: −$200 in January');
    expect(cash).toContain('starting from $0.');
    expect(cash).toContain('charged evenly over 12 months');
  });

  it('shows a cash flow table by month with sales, costs, fixed costs, net and running balance', () => {
    const html = render([enteredCrop()]);
    const table = html.match(/<section aria-labelledby="cashflow-heading">([\s\S]*?)<\/section>/)?.[1];
    expect(table).toBeDefined();
    expect(html.indexOf('cashflow-heading')).toBeLessThan(html.indexOf('cash-heading'));
    expect(table).toContain('Market beans sales');
    expect(table).toContain('Market beans costs');
    expect(table).toContain('Overhead and equipment');
    expect(table).toContain('Running balance');
    expect(table).toContain('>Jan<');
    expect(table).toContain('>Dec<');
    expect(table).toContain('$1,200');
    expect(table).toContain('−$200');
    expect(table).toContain('Percent of year');
  });

  it('offers a per-crop detail of shared costs when the breakdown is on', () => {
    const html = render([enteredCrop()]);
    expect(html).toContain('Show what the costs are made of');
  });
});
