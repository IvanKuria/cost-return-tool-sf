import { restoreSourceValue, sourceUnitChanged } from '../lib/source';
import { useState, type Dispatch } from 'react';
import { uid, type Action } from '../lib/store';
import type { Crop, CustomHire, Equipment, Farm, FarmResult, Plan, SalesChannel } from '../lib/types';
import { newBlankCrop, newCropFromStudy, newBlankOperation, ownership, toAcres, usesOperations } from '../lib/engine';
import { operationsFromStudy, studyById } from '../data/studies';
import { CropOperations, operationsPerAcre } from './CropOperations';
import { inputPatch, isMissing, missingPlanInputs } from '../lib/inputs';
import { CropTiming } from './CropTiming';
import { CropStudyPicker } from './StudyPickers';
import { Button, Card, Choice, SourceTag, Field, Input, NumberInput, money, num, cents } from '../ui';
import { useT, useTypeName, useUnit } from '../i18n';
import type { Key } from '../i18n/en';

const UNIT_KEY: Record<Farm['areaUnit'], Key> = { acres: 'common.acres', beds: 'common.beds', rows100ft: 'common.rows100ft' };
const CHANNEL_SOLD: Record<SalesChannel, Key> = { market: 'channel.market.sold', csa: 'channel.csa.sold', wholesale: 'channel.wholesale.sold' };

type Panel = { mode: 'closed' } | { mode: 'pick' } | { mode: 'new'; draft: Crop } | { mode: 'edit'; draft: Crop };

export function CropsScreen({ plan, dispatch, result, editId }: { plan: Plan; dispatch: Dispatch<Action>; result?: FarmResult; editId?: string }) {
  const { t } = useT();
  const typeName = useTypeName();
  const [panel, setPanel] = useState<Panel>(() => { const crop = plan.crops.find(c => c.id === editId); return crop ? { mode: 'edit', draft: { ...crop } } : { mode: 'closed' }; });
  const farm = plan.farm;

  const save = (draft: Crop) => {
    if (panel.mode === 'edit') dispatch({ type: 'crop.update', id: draft.id, patch: draft });
    else dispatch({ type: 'crop.add', crop: draft });
    setPanel({ mode: 'closed' });
  };

  return (
    <div className="max-w-[680px] mx-auto">
      <h1 className="text-[28px] font-bold tracking-tight">{t('crops.title')}</h1>
      <p className="mt-1 text-ink-2">{t('crops.intro')}</p>

      <div className="mt-6 flex flex-col gap-3">
        {panel.mode === 'closed' && (
          <div className="flex flex-col gap-2"><Button variant="primary" className="w-full" onClick={() => setPanel({ mode: 'new', draft: newBlankCrop() })}>{t('inputs.ownCrop')}</Button><Button className="w-full h-auto min-h-12 whitespace-normal" onClick={() => setPanel({ mode: 'pick' })}>{t('inputs.useStudy')}</Button></div>
        )}
        {panel.mode === 'pick' && (
          <CropStudyPicker
            county={farm.county}
            onPick={ty => setPanel({ mode: 'new', draft: newCropFromStudy(ty, 1) })}
            onCancel={() => setPanel({ mode: 'closed' })}
          />
        )}
        {panel.mode === 'new' && (
          <CropForm farm={farm} equipment={plan.equipment} draft={panel.draft} onChange={draft => setPanel({ mode: 'new', draft })} onSave={save} onCancel={() => setPanel({ mode: 'closed' })} />
        )}

        {plan.crops.length === 0 && panel.mode === 'closed' && (
          <p className="text-center text-ink-2 py-8">{t('crops.none')}</p>
        )}

        {plan.crops.map(c => {
          if (panel.mode === 'edit' && panel.draft.id === c.id) {
            return (
              <CropForm key={c.id} farm={farm} equipment={plan.equipment} draft={panel.draft} onChange={draft => setPanel({ mode: 'edit', draft })} onSave={save} onCancel={() => setPanel({ mode: 'closed' })} />
            );
          }
          const r = result?.crops.find(x => x.cropId === c.id);
          const sales = r ? r.revenue : expectedSales(c, farm);
          const unitWord = c.area === 1 && farm.areaUnit === 'acres' ? t('common.acre') : t(UNIT_KEY[farm.areaUnit]);
          return (
            <Card key={c.id} className="p-4 flex flex-wrap sm:flex-nowrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[17px] truncate">{typeName('crop', c.typeId, c.name)}</div>
                <div className="text-[14px] text-ink-2">
                  {t('crops.rowSummary', {
                    area: num(c.area, 2), unit: unitWord, plantings: c.plantingsPerYear,
                    plantingWord: c.plantingsPerYear === 1 ? t('common.planting') : t('common.plantings'),
                    channel: t(CHANNEL_SOLD[c.channel]),
                  })}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold tnum text-[17px]">{c.missingFields?.length ? t('inputs.incomplete') : money(sales)}</div>
                <div className="text-[13px] text-ink-2">{t('crops.inSales')}</div>
              </div>
              <div className="flex flex-col gap-1">
                <Button variant="ghost" className="h-9 px-3 text-[14px]" onClick={() => setPanel({ mode: 'edit', draft: { ...c, citations: { ...c.citations } } })}>{t('common.edit')}</Button>
                <Button variant="danger" className="h-9 px-3 text-[14px]" onClick={() => dispatch({ type: 'crop.remove', id: c.id })}>{t('common.remove')}</Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function expectedSales(c: Crop, farm: Farm) {
  return toAcres(c.area, farm) * c.plantingsPerYear * c.yieldPerAcre * c.price;
}


function CropForm({ farm, equipment, draft, onChange, onSave, onCancel }: { farm: Farm; equipment: Equipment[]; draft: Crop; onChange: (c: Crop) => void; onSave: (c: Crop) => void; onCancel: () => void }) {
  const { t } = useT();
  const typeName = useTypeName();
  const unitWord = useUnit();

  const unit = t(UNIT_KEY[farm.areaUnit]);
  const set = (patch: Partial<Crop>) => onChange({ ...draft, ...patch });
  const setNumber = (key: 'area' | 'plantingsPerYear' | 'yieldPerAcre' | 'price' | 'operatingCostPerAcre' | 'ownLaborHoursPerAcre', value: number | undefined) => set(inputPatch(draft, key, value));
  const incomplete = missingPlanInputs({ farm, crops: [draft], equipment: [] }).length > 0;
  const sales = expectedSales(draft, farm);

  const hoursFor = (equipmentId: string) => draft.machineHours.find(m => m.equipmentId === equipmentId)?.hoursPerAcre ?? 0;
  const setHours = (equipmentId: string, hoursPerAcre: number) => {
    const rest = draft.machineHours.filter(m => m.equipmentId !== equipmentId);
    set({ machineHours: hoursPerAcre > 0 ? [...rest, { equipmentId, hoursPerAcre }] : rest });
  };
  const setHire = (id: string, patch: Partial<CustomHire>) => set({ customHire: draft.customHire.map(h => h.id === id ? { ...h, ...patch } : h) });
  const removeHire = (id: string) => set({ customHire: draft.customHire.filter(h => h.id !== id) });
  const addHire = () => set({ customHire: [...draft.customHire, { id: uid(), name: '', costPerAcre: 0 }] });

  const fromOps = usesOperations(draft);
  const opsCost = fromOps ? operationsPerAcre(draft, farm, equipment) : null;
  // Per acre, one planting: what the machines and hired work add on top of materials and labor.
  const machinePerAcre = fromOps
    ? opsCost!.parts.machineRunning + opsCost!.parts.operatorLabor + opsCost!.parts.hiredMachine
    : equipment.reduce((sum, e) => sum + hoursFor(e.id) * ownership(e, farm).allInPerHour, 0);
  const hirePerAcre = draft.customHire.reduce((sum, h) => sum + h.costPerAcre, 0);
  // Yearly growing costs for the timing grid: the same pieces the engine adds up, without overhead shares.
  const seasons = toAcres(draft.area, farm) * draft.plantingsPerYear;
  const growPerAcre = fromOps ? opsCost!.total : draft.operatingCostPerAcre + machinePerAcre;
  const yearlyCosts = seasons * (growPerAcre + draft.ownLaborHoursPerAcre * farm.ownLaborRate + hirePerAcre);
  const study = studyById(draft.studyId);
  const [advanced, setAdvanced] = useState(false);

  return (
    <Card className="p-5 flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[19px]">{typeName('crop', draft.typeId, draft.name)}</div>
          <div className="text-[14px] text-ink-2">{t('inputs.formIntro')}</div>
        </div>
      </div>

      <Field label={t('inputs.cropName')}><Input value={draft.name} onChange={e => set({ name: e.target.value, typeId: 'custom' })} /></Field>
      <Field label={t('inputs.unit')} hint={t('inputs.unitHint')}><Input value={draft.unit} onChange={e => set({ unit: e.target.value })} /></Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t('crops.area')} tag={<SourceTag citation={undefined} value={draft.area} missing={isMissing(draft, 'area')} />} hint={!isMissing(draft, 'area') && draft.area <= 0 ? t('inputs.positive') : undefined}>
          <NumberInput value={draft.area} onChange={v => setNumber('area', v)} missing={isMissing(draft, 'area')} onMissingChange={() => setNumber('area', undefined)} placeholder={t('inputs.enterNumber')} step={0.1} suffix={unit} />
        </Field>
        <Field label={t('crops.plantings')} tag={<SourceTag citation={draft.citations.plantingsPerYear} value={draft.plantingsPerYear} missing={isMissing(draft, 'plantingsPerYear')} onRestore={sourceUnitChanged(draft, 'plantingsPerYear') ? undefined : () => set(restoreSourceValue(draft, 'plantingsPerYear', draft.citations.plantingsPerYear))} restoreHint={sourceUnitChanged(draft, 'plantingsPerYear') ? t('source.restoreUnitHint') : undefined} />} hint={!isMissing(draft, 'plantingsPerYear') && draft.plantingsPerYear <= 0 ? t('inputs.positive') : undefined}>
          <NumberInput value={draft.plantingsPerYear} onChange={v => setNumber('plantingsPerYear', v)} missing={isMissing(draft, 'plantingsPerYear')} onMissingChange={() => setNumber('plantingsPerYear', undefined)} placeholder={t('inputs.enterNumber')} />
        </Field>
      </div>

      <Field label={t('crops.yield')} tag={<SourceTag citation={draft.citations.yieldPerAcre} value={draft.yieldPerAcre} missing={isMissing(draft, 'yieldPerAcre')} onRestore={sourceUnitChanged(draft, 'yieldPerAcre') ? undefined : () => set(restoreSourceValue(draft, 'yieldPerAcre', draft.citations.yieldPerAcre))} restoreHint={sourceUnitChanged(draft, 'yieldPerAcre') ? t('source.restoreUnitHint') : undefined} />} hint={isMissing(draft, 'yieldPerAcre') ? t('inputs.missingHint') : t('crops.yield.hint')}>
        <NumberInput value={draft.yieldPerAcre} onChange={v => setNumber('yieldPerAcre', v)} missing={isMissing(draft, 'yieldPerAcre')} onMissingChange={() => setNumber('yieldPerAcre', undefined)} placeholder={t('inputs.enterNumber')} suffix={t('common.unitsPerAcre', { units: unitWord(draft.unit, true) })} />
      </Field>

      <Field label={t('crops.price')} tag={<SourceTag citation={draft.citations.price} value={draft.price} missing={isMissing(draft, 'price')} onRestore={sourceUnitChanged(draft, 'price') ? undefined : () => set(restoreSourceValue(draft, 'price', draft.citations.price))} restoreHint={sourceUnitChanged(draft, 'price') ? t('source.restoreUnitHint') : undefined} />} hint={isMissing(draft, 'price') ? t('inputs.missingHint') : t('crops.price.hint')}>
        <NumberInput value={draft.price} onChange={v => setNumber('price', v)} missing={isMissing(draft, 'price')} onMissingChange={() => setNumber('price', undefined)} placeholder={t('inputs.enterNumber')} step={0.01} prefix="$" suffix={t('common.perUnit', { unit: unitWord(draft.unit) })} />
      </Field>

      {!fromOps && <Field label={t('crops.operating')} tag={<SourceTag citation={draft.citations.operatingCostPerAcre} value={draft.operatingCostPerAcre} missing={isMissing(draft, 'operatingCostPerAcre')} onRestore={sourceUnitChanged(draft, 'operatingCostPerAcre') ? undefined : () => set(restoreSourceValue(draft, 'operatingCostPerAcre', draft.citations.operatingCostPerAcre))} restoreHint={sourceUnitChanged(draft, 'operatingCostPerAcre') ? t('source.restoreUnitHint') : undefined} />} hint={isMissing(draft, 'operatingCostPerAcre') ? t('inputs.missingHint') : t('crops.operating.hint')}>
        <NumberInput value={draft.operatingCostPerAcre} missing={isMissing(draft, 'operatingCostPerAcre')} onChange={v => setNumber('operatingCostPerAcre', v)} onMissingChange={() => setNumber('operatingCostPerAcre', undefined)} placeholder={t('inputs.enterNumber')} prefix="$" suffix={t('common.perAcre')} />
      </Field>}
      <Field label={t('crops.ownHours')} tag={<SourceTag citation={undefined} value={draft.ownLaborHoursPerAcre} missing={isMissing(draft, 'ownLaborHoursPerAcre')} />} hint={t('crops.ownHours.hint', { rate: money(farm.ownLaborRate) })}>
        <NumberInput value={draft.ownLaborHoursPerAcre} onChange={v => setNumber('ownLaborHoursPerAcre', v)} missing={isMissing(draft, 'ownLaborHoursPerAcre')} onMissingChange={() => setNumber('ownLaborHoursPerAcre', undefined)} suffix={t('common.hoursPerAcre')} />
      </Field>
      <Field label={t('crops.channel')}>
        <Choice<SalesChannel>
          value={draft.channel}
          onChange={channel => set({ channel })}
          options={[{ value: 'market', label: t('channel.market') }, { value: 'csa', label: t('channel.csa') }, { value: 'wholesale', label: t('channel.wholesale') }]}
        />
      </Field>

      {fromOps ? (
        <>
          <CropOperations crop={draft} farm={farm} equipment={equipment} seasons={seasons} onChange={set} />
          <div>
            <button type="button" onClick={() => setAdvanced(a => !a)} className="text-[15px] font-medium text-accent hover:underline" aria-expanded={advanced}>{advanced ? t('common.hideAdvanced') : t('common.advanced')}</button>
            {advanced && (
              <div className="mt-2 flex justify-between gap-3 text-[14px] rounded-[var(--radius-ctl)] bg-well px-4 py-3">
                <span className="text-ink-2">{t('ops.derivedOperating')}</span>
                <span className="tnum text-loss whitespace-nowrap">{money(-opsCost!.total)} {t('common.perAcre')}</span>
              </div>
            )}
          </div>
        </>
      ) : (
      <div className="border-t border-line pt-5 flex flex-col gap-4">
        <div>
          <div className="font-semibold text-[17px]">{t('crops.machines')}</div>
          <div className="text-[14px] text-ink-2">{t('crops.machines.hint')}</div>
        </div>
        {equipment.length === 0 ? (
          <p className="text-[14px] text-ink-2 rounded-[var(--radius-ctl)] bg-well px-4 py-3">{t('crops.machines.none')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-line border border-line rounded-[var(--radius-ctl)] overflow-hidden">
            {equipment.map(e => {
              const o = ownership(e, farm);
              const name = typeName('equipment', e.typeId, e.name);
              return (
                <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[15px] truncate">{name}</div>
                    <div className="text-[13px] text-ink-2 tnum">{e.hoursPerYear > 0 ? t('crops.machines.perHourSplit', { run: cents(o.runPerHour), all: cents(o.allInPerHour) }) : t('crops.machines.notTracked')}</div>
                  </div>
                  {e.hoursPerYear > 0 && <NumberInput className="w-[170px]" value={hoursFor(e.id)} onChange={v => setHours(e.id, v)} step={0.1} suffix={t('common.hrsPerAcre')} aria-label={t('crops.machines.aria', { name })} />}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {study && study.costsPerAcre.operations.length > 0 && <Button variant="secondary" className="h-10 px-4 text-[15px]" onClick={() => set({ operations: operationsFromStudy(study) })}>{t('ops.addStudy')}</Button>}
          <Button variant="secondary" className="h-10 px-4 text-[15px]" onClick={() => set({ operations: [newBlankOperation()] })}>{t('ops.add')}</Button>
        </div>
      </div>
      )}
      <div className="border-t border-line pt-5 flex flex-col gap-4">
        <div>
          <div className="font-semibold text-[17px]">{t('crops.hire')}</div>
          <div className="text-[14px] text-ink-2">{t('crops.hire.hint')}</div>
        </div>
        {draft.customHire.length > 0 && (
          <div className="flex flex-col gap-2">
            {draft.customHire.map(h => (
              <div key={h.id} className="grid grid-cols-1 sm:grid-cols-[1fr_170px_auto] gap-2">
                <Input className="min-w-0" value={h.name} onChange={e => setHire(h.id, { name: e.target.value })} placeholder={t('crops.hire.job')} aria-label={t('crops.hire.jobAria')} />
                <NumberInput className="w-full" value={h.costPerAcre} onChange={v => setHire(h.id, { costPerAcre: v })} prefix="$" suffix={t('common.perAcre')} aria-label={t('crops.hire.costAria')} />
                <Button variant="ghost" className="h-12 px-3 text-[14px]" onClick={() => removeHire(h.id)} aria-label={t('crops.hire.removeAria')}>{t('common.remove')}</Button>
              </div>
            ))}
          </div>
        )}
        <Button variant="secondary" className="self-start h-10 px-4 text-[15px]" onClick={addHire}>{t('crops.hire.add')}</Button>
      </div>

      <CropTiming crop={draft} onChange={set} yearlyCosts={yearlyCosts} yearlySales={sales} />

      <div className="rounded-[var(--radius-ctl)] bg-well px-4 py-3 flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-ink-2">{t(incomplete ? 'inputs.provisional' : 'crops.expectedSales')}</span>
          <span className="font-semibold tnum text-[19px] ml-auto">{money(sales)}</span>
          <span className="text-ink-2">{t('common.aYear')}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-2 text-[14px]">
          <span className="text-ink-2">{t('crops.machineAndHire')}</span>
          <span className="tnum ml-auto">{money(machinePerAcre + hirePerAcre)}</span>
          <span className="text-ink-2">{t('common.perAcreOnePlanting')}</span>
        </div>
      </div>

      {incomplete && <p className="text-sm text-ink-2">{t('inputs.draftHint')}</p>}
      <div className="flex gap-3">
        <Button variant="primary" className="flex-1" onClick={() => onSave(draft)} disabled={!draft.name.trim() || !draft.unit.trim()}>{t('crops.save')}</Button>
        <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </Card>
  );
}
