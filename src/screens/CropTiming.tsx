import { useState } from 'react';
import type { Crop } from '../lib/types';
import { cropDefaultsFromStudy, studyById } from '../data/studies';
import { Button, NumberInput, money } from '../ui';
import { useT } from '../i18n';
import type { Key } from '../i18n/en';

type Row = 'costMonths' | 'revenueMonths';
const EVEN = Array.from({ length: 12 }, () => 1 / 12);

/**
 * When the farmer pays and when the farmer sells, as percent per month. The crop stores weights
 * that sum to 1; this grid shows them as whole percents and the dollars each percent means.
 */
export function CropTiming({ crop, onChange, yearlyCosts, yearlySales }: { crop: Crop; onChange: (patch: Partial<Crop>) => void; yearlyCosts: number; yearlySales: number }) {
  const { t } = useT();
  const study = studyById(crop.studyId);
  const studyDefaults = study ? cropDefaultsFromStudy(study) : null;
  const studyHasMonths = !!(studyDefaults?.costMonths && studyDefaults?.revenueMonths);

  // Percent edits are kept locally so a row can be mid-edit (not 100) without being renormalized under the farmer.
  const [percents, setPercents] = useState<Record<Row, number[] | null>>({
    costMonths: crop.costMonths ? toPercents(crop.costMonths) : null,
    revenueMonths: crop.revenueMonths ? toPercents(crop.revenueMonths) : null,
  });

  const commit = (field: Row, next: number[] | null, source: Crop['timingSource'] = 'custom') => {
    setPercents(p => ({ ...p, [field]: next }));
    const total = next ? next.reduce((a, b) => a + b, 0) : 0;
    const { months: _drop, ...citations } = crop.citations;
    onChange({ [field]: next && total > 0 ? next.map(n => n / total) : null, timingSource: source, citations: source === 'study' ? crop.citations : citations });
  };
  const setCell = (field: Row, i: number, value: number) => {
    const row = [...(percents[field] ?? Array(12).fill(0))];
    row[i] = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
    commit(field, row);
  };
  const useStudy = () => {
    if (!studyDefaults?.costMonths || !studyDefaults.revenueMonths) return;
    const next = { costMonths: toPercents(studyDefaults.costMonths), revenueMonths: toPercents(studyDefaults.revenueMonths) };
    setPercents(next);
    onChange({ costMonths: studyDefaults.costMonths, revenueMonths: studyDefaults.revenueMonths, timingSource: 'study',
      citations: { ...crop.citations, ...(studyDefaults.citations.months ? { months: studyDefaults.citations.months } : {}) } });
  };

  const status: Key = crop.timingSource === 'custom' ? 'inputs.customTiming' : crop.costMonths && crop.revenueMonths ? 'inputs.studyTiming' : 'inputs.noTiming';

  return <section className="border-t border-line pt-5 space-y-4">
    <div>
      <h3 className="font-semibold text-[17px]">{t('inputs.months')}</h3>
      <p className="text-[14px] text-ink-2 mt-1">{t('timing.hint')}</p>
      <p className="text-[14px] text-ink-2 mt-1">{t(status)}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      {studyHasMonths && <Button variant="secondary" className="h-10 px-3 text-[14px]" onClick={useStudy}>{t('timing.useStudy')}</Button>}
      <Button variant="secondary" className="h-10 px-3 text-[14px]" onClick={() => { commit('costMonths', toPercents(EVEN)); commit('revenueMonths', toPercents(EVEN)); }}>{t('timing.spreadEvenly')}</Button>
      <Button variant="ghost" className="h-10 px-3 text-[14px]" onClick={() => { commit('costMonths', null); commit('revenueMonths', null); }}>{t('inputs.clearMonths')}</Button>
    </div>
    {(['costMonths', 'revenueMonths'] as const).map(field => {
      const row = percents[field];
      const total = row ? Math.round(row.reduce((a, b) => a + b, 0)) : 0;
      const ok = total === 100;
      const yearly = field === 'costMonths' ? yearlyCosts : yearlySales;
      return <fieldset key={field} className="min-w-0 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <legend className="text-[15px] font-medium">{t(field === 'costMonths' ? 'inputs.costMonths' : 'inputs.salesMonths')}</legend>
          <span className={`text-[14px] tnum font-medium ${row === null ? 'text-ink-3' : ok ? 'text-gain' : 'text-loss'}`}>
            {row === null ? t('timing.notSet') : t(ok ? 'timing.totalOk' : 'timing.totalOff', { total })}
          </span>
        </div>
        <div className="overflow-x-auto -mx-1 px-1">
          <div className="grid grid-cols-12 gap-1 min-w-[640px]">
            {Array.from({ length: 12 }, (_, i) => {
              const pct = row?.[i] ?? 0;
              const dollars = yearly * (total > 0 && row ? pct / total : 0);
              return <div key={i} className="min-w-0">
                <div className="text-[12px] text-ink-2 text-center mb-1">{t(`month.${i}` as Key)}</div>
                <NumberInput plain value={pct} onChange={v => setCell(field, i, v)} min={0} max={100} className="h-10" aria-label={t('timing.cellAria', { month: t(`monthLong.${i}` as Key) })} />
                <div className="text-[11px] text-ink-3 text-center mt-1 tnum truncate" title={money(dollars)}>{row ? money(dollars) : ''}</div>
              </div>;
            })}
          </div>
        </div>
      </fieldset>;
    })}
  </section>;
}

/** Whole percents that add up to exactly 100 (largest remainder rounding). */
function toPercents(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Array(12).fill(0);
  const exact = weights.map(w => (w / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => ({ i, r: v - floors[i] })).sort((a, b) => b.r - a.r);
  for (const { i } of order) { if (left <= 0) break; floors[i] += 1; left -= 1; }
  return floors;
}
