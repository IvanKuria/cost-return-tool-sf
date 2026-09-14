import type { Crop } from '../lib/types';
import { Button } from '../ui';
import { useT } from '../i18n';

export function CropTiming({ crop, onChange }: { crop: Crop; onChange: (patch: Partial<Crop>) => void }) {
  const { t } = useT();
  const update = (field: 'costMonths' | 'revenueMonths', months: number[]) => {
    const total = months.reduce((sum, value) => sum + value, 0);
    const { months: _previousTiming, ...citations } = crop.citations;
    onChange({ [field]: total ? months.map(n => n / total) : null, timingSource: 'custom', citations });
  };
  return <section className="border-t border-line pt-5 space-y-4">
    <div><h3 className="font-semibold">{t('inputs.months')}</h3><p className="text-sm text-ink-2 mt-1">{t('inputs.monthsHint')}</p>
      <p className="text-sm text-ink-2 mt-1">{t(crop.timingSource === 'custom' ? 'inputs.customTiming' : crop.costMonths && crop.revenueMonths ? 'inputs.studyTiming' : 'inputs.noTiming')}</p></div>
    {(['costMonths', 'revenueMonths'] as const).map(field => <fieldset key={field} className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">{t(field === 'costMonths' ? 'inputs.costMonths' : 'inputs.salesMonths')}</legend>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">{Array.from({ length: 12 }, (_, i) => {
        const selected = (crop[field]?.[i] ?? 0) > 0;
        return <button type="button" key={i} aria-pressed={selected} aria-label={t(`monthLong.${i}` as Parameters<typeof t>[0])} onClick={() => update(field, Array.from({ length: 12 }, (_, j) => j === i ? Number(!selected) : Number((crop[field]?.[j] ?? 0) > 0)))} className={`h-11 rounded-lg border text-sm focus-visible:outline-2 focus-visible:outline-accent ${selected ? 'bg-accent-soft border-accent text-accent-deep font-semibold' : 'border-line-strong text-ink-2'}`}>{t(`month.${i}` as Parameters<typeof t>[0])}</button>;
      })}</div>
      <div className="flex gap-2"><Button variant="ghost" className="h-10 px-2 text-sm" onClick={() => update(field, Array(12).fill(1))}>{t('inputs.allMonths')}</Button><Button variant="ghost" className="h-10 px-2 text-sm" onClick={() => update(field, Array(12).fill(0))}>{t('inputs.clearMonths')}</Button></div>
    </fieldset>)}
  </section>;
}
