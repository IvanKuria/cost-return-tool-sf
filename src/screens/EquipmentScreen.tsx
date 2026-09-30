import { restoreSourceValue } from '../lib/source';
import { useState, type Dispatch } from 'react';
import type { Action } from '../lib/store';
import type { Condition, Equipment, Farm, FarmResult, MachineRates, Plan } from '../lib/types';
import { machineHoursInPlan, machineRates, machineRatesInPlan, newBlankEquipment, newEquipmentFromCatalog, ownership } from '../lib/engine';
import { EquipmentStudyPicker } from './StudyPickers';
import { Button, Card, Choice, SourceTag, Field, Input, NumberInput, money, num, cents } from '../ui';
import { Slider as ShadSlider } from '@/components/ui/slider';
import { inputPatch, isMissing } from '../lib/inputs';
import { useT, useTypeName } from '../i18n';

/** Hours read better with a decimal when they are small. */
const hrs = (n: number) => num(n, n < 10 ? 1 : 0);

type Panel = { mode: 'closed' } | { mode: 'pick' } | { mode: 'new'; draft: Equipment } | { mode: 'edit'; draft: Equipment };

export function EquipmentScreen({ plan, dispatch, result, editId }: { plan: Plan; dispatch: Dispatch<Action>; result?: FarmResult; editId?: string }) {
  const { t } = useT();
  const typeName = useTypeName();
  const [panel, setPanel] = useState<Panel>(() => {
    const item = plan.equipment.find(e => e.id === editId);
    return item ? { mode: 'edit', draft: { ...item } } : { mode: 'closed' };
  });
  const farm = plan.farm;
  const hours = machineHoursInPlan(plan);
  const rates = machineRatesInPlan(plan);

  const save = (draft: Equipment) => {
    if (panel.mode === 'edit') dispatch({ type: 'equipment.update', id: draft.id, patch: draft });
    else dispatch({ type: 'equipment.add', item: draft });
    setPanel({ mode: 'closed' });
  };

  const cropName = (id: string, fallback: string) => {
    const c = plan.crops.find(x => x.id === id);
    return c ? typeName('crop', c.typeId, c.name) : fallback;
  };

  return (
    <div className="max-w-[680px] mx-auto">
      <h1 className="text-[28px] font-bold tracking-tight">{t('equip.title')}</h1>
      <p className="mt-1 text-ink-2">{t('equip.intro.first')}</p>

      <div className="mt-6 flex flex-col gap-3">
        {panel.mode === 'closed' && (
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="primary" className="flex-1" onClick={() => setPanel({ mode: 'new', draft: newBlankEquipment() })}>{t('inputs.ownEquipment')}</Button>
            <Button variant="secondary" onClick={() => setPanel({ mode: 'pick' })}>{t('inputs.useStudy')}</Button>
          </div>
        )}
        {panel.mode === 'pick' && (
          <EquipmentStudyPicker
            onPick={(entry, pick) => setPanel({ mode: 'new', draft: newEquipmentFromCatalog(entry, 'new', undefined, pick) })}
            onCancel={() => setPanel({ mode: 'closed' })}
          />
        )}
        {panel.mode === 'new' && (
          <EquipmentForm farm={farm} draft={panel.draft} hours={{ crop: 0, custom: 0 }} onChange={draft => setPanel({ mode: 'new', draft })} onSave={save} onCancel={() => setPanel({ mode: 'closed' })} />
        )}

        {plan.equipment.length === 0 && panel.mode === 'closed' && (
          <p className="text-center text-ink-2 py-8">{t('equip.none')}</p>
        )}

        {plan.equipment.map(e => {
          const h = hours.get(e.id) ?? { crop: 0, custom: 0 };
          if (panel.mode === 'edit' && panel.draft.id === e.id) {
            return (
              <EquipmentForm key={e.id} farm={farm} draft={panel.draft} hours={h} onChange={draft => setPanel({ mode: 'edit', draft })} onSave={save} onCancel={() => setPanel({ mode: 'closed' })} />
            );
          }
          const o = ownership(e, farm);
          const r = rates.get(e.id);
          const incomplete = !!e.missingFields?.length || isMissing(farm, 'interestRate');
          const m = result?.machines.find(x => x.equipmentId === e.id);
          const users = m ? m.byCrop.filter(b => b.hours > 0).map(b => cropName(b.cropId, b.name)) : [];
          const total = h.crop + h.custom;
          const condition = (e.condition === 'new' ? t('common.new') : t('common.used')).toLowerCase();
          return (
            <Card key={e.id} className="p-4 flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1 basis-48">
                <div className="font-semibold text-[17px] truncate">{typeName('equipment', e.typeId, e.name)}</div>
                <div className="text-[14px] text-ink-2">
                  {incomplete ? t('inputs.incomplete')
                    : total > 0 && r ? t('equip.rowSummary.derived', { condition, year: e.yearBought, price: money(e.pricePaid), hours: hrs(total), perHour: cents(r.allInPerHour), run: cents(r.runPerHour) })
                    : t('equip.rowSummary.noHours', { condition, year: e.yearBought, price: money(e.pricePaid) })}
                </div>
                <div className="text-[13px] text-ink-2">
                  {total > 0 ? t('equip.hoursDerived', { total: hrs(total), crop: hrs(h.crop), custom: hrs(h.custom) }) : t('equip.hoursNone')}
                  {users.length > 0 ? ` ${t('equip.usedOn', { crops: users.join(', ') })}` : ''}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold tnum text-[17px]">{incomplete ? '—' : money(o.totalPerYear)}</div>
                <div className="text-[13px] text-ink-2">{t('equip.aYearToOwn')}</div>
              </div>
              <div className="flex flex-col gap-1">
                <Button variant="ghost" className="h-9 px-3 text-[14px]" onClick={() => setPanel({ mode: 'edit', draft: { ...e } })}>{t('common.edit')}</Button>
                <Button variant="danger" className="h-9 px-3 text-[14px]" onClick={() => dispatch({ type: 'equipment.remove', id: e.id })}>{t('common.remove')}</Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** The study's annual hours, when the repairs citation carries them, for the hint under the repairs percent. */
function studyHoursFromCitation(e: Equipment): number | null {
  const q = e.citations.repairsPctPerYear?.quote ?? '';
  const m = /x\s*([\d,]+)\s*hours a year/.exec(q);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

function EquipmentForm({ farm, draft, hours, onChange, onSave, onCancel }: { farm: Farm; draft: Equipment; hours: { crop: number; custom: number }; onChange: (e: Equipment) => void; onSave: (e: Equipment) => void; onCancel: () => void }) {
  const { t } = useT();
  const [why, setWhy] = useState(false);
  const o = ownership(draft, farm);
  const total = hours.crop + hours.custom;
  const r: MachineRates = machineRates(draft, farm, total);
  const salvage = Math.min(draft.salvageValue, draft.pricePaid);
  const lossPerYear = draft.keepYears > 0 && salvage < draft.pricePaid ? (draft.pricePaid - salvage) / draft.keepYears : 0;
  const studyPct = draft.citations.repairsPctPerYear?.value ?? null;
  const studyHours = studyHoursFromCitation(draft);

  const incomplete = !!draft.missingFields?.length || isMissing(farm, 'interestRate');
  const numberProps = (field: 'pricePaid' | 'yearBought' | 'keepYears' | 'salvageValue' | 'fuelLubePerHour' | 'repairsPctPerYear', factor = 1) => ({
    value: factor === 1 ? draft[field] : Math.round(draft[field] * factor * 100) / 100,
    missing: isMissing(draft, field),
    placeholder: t('inputs.enterNumber'),
    onChange: (value: number) => onChange({ ...draft, ...inputPatch(draft, field, value / factor) }),
    onMissingChange: (missing: boolean) => {
      if (missing) onChange({ ...draft, ...inputPatch(draft, field, undefined) });
    },
  });
  const repairsPct = Math.round((draft.repairsPctPerYear || 0) * 10000) / 100;

  return (
    <Card className="p-5 flex flex-col gap-5">
      <div>
        <Field label={t('inputs.equipmentName')}>
          <Input value={draft.name} onChange={e => onChange({ ...draft, name: e.target.value })} autoFocus />
        </Field>
        <p className="mt-2 text-[14px] text-ink-2">{t('inputs.formIntro')}</p>
      </div>

      <Field label={t('equip.condition')}>
        <Choice<Condition> value={draft.condition} onChange={condition => onChange({ ...draft, condition })} options={[{ value: 'new', label: t('common.new') }, { value: 'used', label: t('common.used') }]} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t('equip.paid')} tag={<SourceTag citation={draft.citations.pricePaid} value={draft.pricePaid} missing={isMissing(draft, 'pricePaid')} onRestore={() => onChange({ ...draft, ...restoreSourceValue(draft, 'pricePaid', draft.citations.pricePaid) })} />}>
          <NumberInput {...numberProps('pricePaid')} prefix="$" />
        </Field>
        <Field label={t('equip.year')} tag={<SourceTag citation={undefined} value={draft.yearBought} missing={isMissing(draft, 'yearBought')} />}>
          <NumberInput {...numberProps('yearBought')} plain />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t('equip.keep')} tag={<SourceTag citation={draft.citations.keepYears} value={draft.keepYears} missing={isMissing(draft, 'keepYears')} onRestore={() => onChange({ ...draft, ...restoreSourceValue(draft, 'keepYears', draft.citations.keepYears) })} />} hint={!isMissing(draft, 'keepYears') && draft.keepYears <= 0 ? t('inputs.positive') : undefined}>
          <NumberInput {...numberProps('keepYears')} suffix={t('common.years')} />
        </Field>
        <Field label={t('equip.salvage')} tag={<SourceTag citation={draft.citations.salvageValue} value={draft.salvageValue} missing={isMissing(draft, 'salvageValue')} onRestore={() => onChange({ ...draft, ...restoreSourceValue(draft, 'salvageValue', draft.citations.salvageValue) })} />} >
          <NumberInput {...numberProps('salvageValue')} prefix="$" />
        </Field>
      </div>

      <p className="text-[14px] text-ink-2 rounded-[var(--radius-ctl)] bg-well px-4 py-3">
        {total > 0 ? t('equip.hoursDerived', { total: hrs(total), crop: hrs(hours.crop), custom: hrs(hours.custom) }) : t('equip.hoursNone')}
      </p>

      <Field label={t('equip.fuel')} tag={<SourceTag citation={draft.citations.fuelLubePerHour} value={draft.fuelLubePerHour} missing={isMissing(draft, 'fuelLubePerHour')} onRestore={() => onChange({ ...draft, ...restoreSourceValue(draft, 'fuelLubePerHour', draft.citations.fuelLubePerHour) })} />} hint={t('equip.fuel.hint')}>
        <NumberInput {...numberProps('fuelLubePerHour')} step={0.01} prefix="$" suffix={t('common.perHour')} />
      </Field>

      <Field
        label={t('equip.repairsPct')}
        tag={<SourceTag citation={draft.citations.repairsPctPerYear} value={draft.repairsPctPerYear} missing={isMissing(draft, 'repairsPctPerYear')} onRestore={() => onChange({ ...draft, ...restoreSourceValue(draft, 'repairsPctPerYear', draft.citations.repairsPctPerYear) })} />}
        hint={`${t('equip.repairsPct.hint')}${studyHours ? ` ${t('equip.repairsPct.studyHours', { hours: num(studyHours) })}` : ''}`}
      >
        <NumberInput {...numberProps('repairsPctPerYear', 100)} step={0.01} suffix={t('common.percent')} />
        <div className="mt-3 px-1">
          <ShadSlider aria-label={t('equip.repairsPct.aria')} min={0} max={15} step={0.25} value={[Math.min(15, Math.max(0, repairsPct))]} onValueChange={([v]) => onChange({ ...draft, ...inputPatch(draft, 'repairsPctPerYear', v / 100) })} />
          <div className="mt-1.5 flex justify-between text-[12px] text-ink-3 tnum">
            <span>0%</span>
            {studyPct !== null && <span className="text-ink-2">{t('equip.repairsPct.study', { pct: num(studyPct * 100, 2) })}</span>}
            <span>15%</span>
          </div>
        </div>
      </Field>

      <div className="rounded-[var(--radius-ctl)] bg-well px-4 py-3 flex flex-col gap-2">
        {incomplete && <p className="font-medium text-[14px]">{t('inputs.provisional')}</p>}
        <div className="text-[16px]">
          {t('equip.result.year', { year: money(o.totalPerYear), repairs: money(o.repairsPerYear) })}
          {total > 0 && <> {t('equip.result.hour', { hours: hrs(total), hour: cents(r.allInPerHour) })}</>}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[14px] text-ink-2">
          <span>{t('equip.worthEnd')}</span><span className="tnum text-ink text-right">{money(salvage)}</span>
          <span>{t('equip.losesPerYear')}</span><span className="tnum text-ink text-right">{money(lossPerYear)}</span>
          <span className="col-span-2 border-t border-line pt-1 mt-1 font-medium text-ink">{t('equip.breakdown.year')}</span>
          <span>{t('equip.breakdown.capitalRecovery')}</span><span className="tnum text-ink text-right">{money(o.capitalRecovery)}</span>
          <span>{t('equip.breakdown.interestOnSalvage')}</span><span className="tnum text-ink text-right">{money(o.interestOnSalvage)}</span>
          <span>{t('equip.breakdown.insurance')}</span><span className="tnum text-ink text-right">{money(o.insurance)}</span>
          <span>{t('equip.breakdown.taxes')}</span><span className="tnum text-ink text-right">{money(o.taxes)}</span>
          <span className="font-medium text-ink">{t('equip.breakdown.total')}</span><span className="tnum text-ink text-right font-medium">{money(o.totalPerYear)}</span>
          <span>{t('equip.breakdown.repairsYear')}</span><span className="tnum text-ink text-right">{money(o.repairsPerYear)}</span>
          {total > 0 ? (
            <>
              <span className="col-span-2 border-t border-line pt-1 mt-1 font-medium text-ink">{t('equip.breakdown.hourAt', { hours: hrs(total) })}</span>
              <span>{t('equip.ownPerHour')}</span><span className="tnum text-ink text-right">{cents(r.ownPerHour)}</span>
              <span>{t('equip.breakdown.fuelPerHour')}</span><span className="tnum text-ink text-right">{cents(r.fuelLubePerHour)}</span>
              <span>{t('equip.breakdown.repairsPerHour')}</span><span className="tnum text-ink text-right">{cents(r.repairsPerHour)}</span>
              <span className="font-medium text-ink">{t('equip.breakdown.allIn')}</span><span className="tnum text-ink text-right font-medium">{cents(r.allInPerHour)}</span>
            </>
          ) : (
            <span className="col-span-2 border-t border-line pt-1 mt-1">{t('equip.breakdown.needHours')}</span>
          )}
        </div>
        <button type="button" onClick={() => setWhy(w => !w)} className="self-start text-[14px] font-medium text-accent hover:underline" aria-expanded={why}>
          {t('equip.why')}
        </button>
        {why && <p className="text-[14px] text-ink-2 leading-snug">{t('equip.why.text')}</p>}
      </div>

      {incomplete && <p className="text-[14px] text-ink-2">{t('inputs.draftHint')}</p>}
      <div className="flex gap-3">
        <Button variant="primary" className="flex-1" onClick={() => onSave(draft)} disabled={!draft.name.trim() || (!isMissing(draft, 'keepYears') && draft.keepYears <= 0)}>{t('equip.save')}</Button>
        <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </Card>
  );
}
