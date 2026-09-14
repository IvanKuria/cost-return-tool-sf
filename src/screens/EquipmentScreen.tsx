import { restoreSourceValue } from '../lib/source';
import { useState, type Dispatch } from 'react';
import type { Action } from '../lib/store';
import type { Condition, Equipment, Farm, FarmResult, Plan } from '../lib/types';
import { newBlankEquipment, newEquipmentFromCatalog, ownership } from '../lib/engine';
import { EquipmentStudyPicker } from './StudyPickers';
import { Button, Card, Choice, SourceTag, Field, Input, NumberInput, money, num, cents } from '../ui';
import { inputPatch, isMissing } from '../lib/inputs';
import { useT, useTypeName } from '../i18n';

type Panel = { mode: 'closed' } | { mode: 'pick' } | { mode: 'new'; draft: Equipment } | { mode: 'edit'; draft: Equipment };

export function EquipmentScreen({ plan, dispatch, result, editId }: { plan: Plan; dispatch: Dispatch<Action>; result?: FarmResult; editId?: string }) {
  const { t } = useT();
  const typeName = useTypeName();
  const [panel, setPanel] = useState<Panel>(() => {
    const item = plan.equipment.find(e => e.id === editId);
    return item ? { mode: 'edit', draft: { ...item } } : { mode: 'closed' };
  });
  const farm = plan.farm;

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
      <p className="mt-1 text-ink-2">{t('equip.intro')}</p>

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
          <EquipmentForm farm={farm} draft={panel.draft} onChange={draft => setPanel({ mode: 'new', draft })} onSave={save} onCancel={() => setPanel({ mode: 'closed' })} />
        )}

        {plan.equipment.length === 0 && panel.mode === 'closed' && (
          <p className="text-center text-ink-2 py-8">{t('equip.none')}</p>
        )}

        {plan.equipment.map(e => {
          if (panel.mode === 'edit' && panel.draft.id === e.id) {
            return (
              <EquipmentForm key={e.id} farm={farm} draft={panel.draft} onChange={draft => setPanel({ mode: 'edit', draft })} onSave={save} onCancel={() => setPanel({ mode: 'closed' })} />
            );
          }
          const o = ownership(e, farm.interestRate);
          const incomplete = !!e.missingFields?.length || isMissing(farm, 'interestRate');
          const m = result?.machines.find(x => x.equipmentId === e.id);
          const users = m ? m.byCrop.filter(b => b.hours > 0).map(b => cropName(b.cropId, b.name)) : [];
          return (
            <Card key={e.id} className="p-4 flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1 basis-48">
                <div className="font-semibold text-[17px] truncate">{typeName('equipment', e.typeId, e.name)}</div>
                <div className="text-[14px] text-ink-2">
                  {incomplete ? t('inputs.incomplete') : t('equip.rowSummary', {
                    condition: (e.condition === 'new' ? t('common.new') : t('common.used')).toLowerCase(),
                    year: e.yearBought, price: money(e.pricePaid), hours: num(e.hoursPerYear), perHour: cents(o.allInPerHour),
                  })}
                </div>
                <div className="text-[13px] text-ink-2">
                  {users.length > 0 ? t('equip.usedOn', { crops: users.join(', ') }) : t('equip.noCropHours')}
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


function EquipmentForm({ farm, draft, onChange, onSave, onCancel }: { farm: Farm; draft: Equipment; onChange: (e: Equipment) => void; onSave: (e: Equipment) => void; onCancel: () => void }) {
  const { t } = useT();
  const [why, setWhy] = useState(false);
  const o = ownership(draft, farm.interestRate);
  const salvage = Math.min(draft.salvageValue, draft.pricePaid);
  const lossPerYear = draft.keepYears > 0 && salvage < draft.pricePaid ? (draft.pricePaid - salvage) / draft.keepYears : 0;

  const incomplete = !!draft.missingFields?.length || isMissing(farm, 'interestRate');
  const numberProps = (field: 'pricePaid' | 'yearBought' | 'keepYears' | 'hoursPerYear' | 'salvageValue' | 'operatingCostPerHour') => ({
    value: draft[field],
    missing: isMissing(draft, field),
    placeholder: t('inputs.enterNumber'),
    onChange: (value: number) => onChange({ ...draft, ...inputPatch(draft, field, value) }),
    onMissingChange: (missing: boolean) => {
      if (missing) onChange({ ...draft, ...inputPatch(draft, field, undefined) });
    },
  });

  // The result sentence has two bold numbers inside it, so split the translated string around markers.
  const [resultBefore, resultRest] = t('equip.result', { year: '\u0000', hour: '\u0001' }).split('\u0000');
  const [resultMid, resultAfter] = (resultRest ?? '').split('\u0001');

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
        <Field label={t('equip.use')} tag={<SourceTag citation={undefined} value={draft.hoursPerYear} missing={isMissing(draft, 'hoursPerYear')} />}>
          <NumberInput {...numberProps('hoursPerYear')} suffix={t('common.hoursAYear')} />
        </Field>
      </div>

      <Field label={t('equip.salvage')} tag={<SourceTag citation={draft.citations.salvageValue} value={draft.salvageValue} missing={isMissing(draft, 'salvageValue')} onRestore={() => onChange({ ...draft, ...restoreSourceValue(draft, 'salvageValue', draft.citations.salvageValue) })} />} >
        <NumberInput {...numberProps('salvageValue')} prefix="$" />
      </Field>

      <Field label={t('equip.run')} tag={<SourceTag citation={draft.citations.operatingCostPerHour} value={draft.operatingCostPerHour} missing={isMissing(draft, 'operatingCostPerHour')} onRestore={() => onChange({ ...draft, ...restoreSourceValue(draft, 'operatingCostPerHour', draft.citations.operatingCostPerHour) })} />} hint={t('equip.run.hint')}>
        <NumberInput {...numberProps('operatingCostPerHour')} step={0.01} prefix="$" suffix={t('common.perHour')} />
      </Field>

      <div className="rounded-[var(--radius-ctl)] bg-well px-4 py-3 flex flex-col gap-2">
        {incomplete && <p className="font-medium text-[14px]">{t('inputs.provisional')}</p>}
        <div className="text-[16px]">
          {resultBefore}<span className="font-semibold tnum">{money(o.totalPerYear)}</span>{resultMid}<span className="font-semibold tnum">{cents(o.allInPerHour)}</span>{resultAfter}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[14px] text-ink-2">
          <span>{t('equip.worthEnd')}</span><span className="tnum text-ink text-right">{money(salvage)}</span>
          <span>{t('equip.losesPerYear')}</span><span className="tnum text-ink text-right">{money(lossPerYear)}</span>
          <span>{t('equip.ownPerHour')}</span><span className="tnum text-ink text-right">{cents(o.ownPerHour)}</span>
          <span>{t('equip.runPerHour')}</span><span className="tnum text-ink text-right">{cents(o.runPerHour)}</span>
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
