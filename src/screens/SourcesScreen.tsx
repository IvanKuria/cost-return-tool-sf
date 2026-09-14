import type { Dispatch } from 'react';
import type { Plan, Citation, Farm, Crop, Equipment, NumericField } from '../lib/types';
import type { Action } from '../lib/store';
import { METHOD } from '../lib/engine';
import { isMissing } from '../lib/inputs';
import { canRestoreSource, restoreSourceValue, sourceDisplayValue, sourceStatus, sourceUnitChanged } from '../lib/source';
import { CitationCard } from '../ui';
import { useT, useTypeName } from '../i18n';

export function SourcesScreen({ plan, dispatch }: { plan: Plan; dispatch?: Dispatch<Action> }) {
  const { t } = useT();
  const typeName = useTypeName();
  const groups = [
    { name: t('sources.farm'), values: plan.farm, citations: plan.farm.citations,
      restore: (field: string, citation: Citation) => dispatch?.({ type: 'farm', patch: restoreSourceValue(plan.farm, field as NumericField<Farm>, citation) }) },
    ...plan.crops.map(c => ({ name: typeName('crop', c.typeId, c.name), values: c, citations: c.citations,
      restore: (field: string, citation: Citation) => dispatch?.({ type: 'crop.update', id: c.id, patch: restoreSourceValue(c, field as NumericField<Crop>, citation) }) })),
    ...plan.equipment.map(e => ({ name: e.name, values: e, citations: e.citations,
      restore: (field: string, citation: Citation) => dispatch?.({ type: 'equipment.update', id: e.id, patch: restoreSourceValue(e, field as NumericField<Equipment>, citation) }) })),
  ].filter(group => Object.values(group.citations).some(Boolean));
  return <div className="max-w-[680px] mx-auto space-y-8">
    <div><h1 className="text-[28px] font-bold">{t('sources.title')}</h1><p className="mt-2 text-ink-2">{t('sources.intro')}</p></div>
    <section className="space-y-4"><h2 className="text-xl font-semibold">{t('sources.formulas')}</h2><p>{t('sources.method.hours')}</p>{METHOD.map(m => <details key={m.key} className="border-b border-line pb-3"><summary className="cursor-pointer font-medium py-2">{t(`sources.method.${m.key}`)}</summary><CitationCard citation={m.citation} /></details>)}</section>
    <section className="space-y-5"><h2 className="text-xl font-semibold">{t('sources.plan')}</h2><p className="text-ink-2">{t('sources.plan.intro')}</p>{groups.length === 0 && <p className="rounded-[var(--radius-ctl)] bg-well p-4 text-ink-2">{t('sources.none')}</p>}{groups.map((g, i) => <div key={i} className="space-y-3"><h3 className="font-semibold">{g.name}</h3>{Object.entries(g.citations).filter(([, citation]) => Boolean(citation)).map(([key, raw]) => {
      const citation = raw as Citation;
      const value = sourceDisplayValue(g.values, key);
      const missing = isMissing(g.values, key);
      const changedUnit = sourceUnitChanged(g.values, key);
      const status = !missing && changedUnit ? 'yours' : sourceStatus(value, citation, missing);
      const customTiming = key === 'months' && 'timingSource' in g.values && g.values.timingSource === 'custom';
      return <details key={key} className="border-b border-line pb-3">
        <summary className="cursor-pointer py-2">{citation.field}{value !== undefined && <span className="ml-2 text-[12px] text-ink-2">{t(status === 'missing' ? 'source.missing' : status === 'study' ? 'source.fromStudy' : 'source.yours')}</span>}</summary>
        {value !== undefined && <p className="mb-1 text-[14px]">{t('source.current', { value: missing ? t('source.missing') : value.toLocaleString('en-US') })}</p>}
        {citation.value !== null && <p className="mb-2 text-[14px] text-ink-2">{t('source.original', { value: citation.value.toLocaleString('en-US') })}</p>}
        {customTiming && <p className="mb-2 text-[14px] text-ink-2">{t('source.customTiming')}</p>}
        <CitationCard citation={citation} />
        {changedUnit && <p className="mt-2 text-[14px] text-ink-2">{t('source.restoreUnitHint')}</p>}
        {dispatch && canRestoreSource(g.values, key, citation) && <button type="button" className="mt-2 py-2 text-[14px] font-medium text-accent underline underline-offset-2" onClick={() => g.restore(key, citation)}>{t('source.restore')}</button>}
      </details>;
    })}</div>)}</section>
  </div>;
}
