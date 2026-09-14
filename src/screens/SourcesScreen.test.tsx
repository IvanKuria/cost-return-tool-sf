import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourcesScreen } from './SourcesScreen';
import { I18nProvider } from '../i18n';
import { DEFAULT_FARM } from '../lib/store';
import { newBlankCrop, newBlankEquipment } from '../lib/engine';
import { en } from '../i18n/en';

describe('Sources screen', () => {
  it('explains manual-only plans without empty crop or equipment headings', () => {
    const markup = renderToStaticMarkup(<I18nProvider><SourcesScreen plan={{ farm: DEFAULT_FARM, crops: [{ ...newBlankCrop(), name: 'Manual carrots' }], equipment: [{ ...newBlankEquipment(), name: 'Manual tractor' }] }} /></I18nProvider>);
    expect(markup).toContain(en['sources.none']);
    expect(markup).toContain(en['sources.plan.intro']);
    expect(markup).not.toContain('Manual carrots');
    expect(markup).not.toContain('Manual tractor');
    expect(markup).not.toContain('<h3');
  });
});
