import { restoreSourceValue, sourceDisplayValue } from '../lib/source';
import { useState, type Dispatch } from 'react';
import { inputPatch, isMissing } from '../lib/inputs';
import { uid, type Action } from '../lib/store';
import type { AllocationBasis, AreaUnit, EquipmentBasis, Farm, FarmCitedField, FarmResult, OverheadItem, Plan } from '../lib/types';
import { METHOD } from '../lib/engine';
import { Button, Card, Choice, Field, Input, NumberInput, Select, SourceTag, money } from '../ui';
import { useT } from '../i18n';

const COUNTIES = ['Santa Cruz', 'Monterey', 'San Benito', 'Santa Clara', 'San Mateo', 'Yolo', 'Sonoma', 'Fresno', 'Other'];

export function FarmScreen({ plan, dispatch }: { plan: Plan; dispatch: Dispatch<Action>; result?: FarmResult }) {
  const { t } = useT();
  const farm = plan.farm;
  const set = (patch: Partial<Farm>) => dispatch({ type: 'farm', patch });
  const [advanced, setAdvanced] = useState(() => !!farm.missingFields?.some(f => f === 'interestRate' || f === 'payrollOverhead'));
  const numberProps = (field: 'bedLengthFt' | 'bedWidthIn' | 'landRentPerAcre' | 'ownLaborRate' | 'hiredLaborRate' | 'interestRate' | 'operatingInterestRate' | 'payrollOverhead' | 'insuranceRate' | 'propertyTaxRate', factor = 1) => ({
    value: round(farm[field] * factor, 4), missing: isMissing(farm, field), placeholder: t('inputs.enterNumber'),
    onChange: (v: number) => set(inputPatch(farm, field, v / factor)), onMissingChange: () => set(inputPatch(farm, field, undefined)),
  });

  const sourceTag = (field: FarmCitedField) => <SourceTag citation={farm.citations[field]} value={sourceDisplayValue(farm, field) ?? 0} missing={isMissing(farm, field)} onRestore={() => set(restoreSourceValue(farm, field, farm.citations[field]))} />;

  // Insurance and property tax rates come from the study method; the tag opens the study's own wording.
  const rateTag = (field: 'insuranceRate' | 'propertyTaxRate') => {
    const item = METHOD.find(m => m.key === (field === 'insuranceRate' ? 'insurance' : 'propertyTax'));
    if (!item) return undefined;
    const studyValue = field === 'insuranceRate' ? 0.843 : 1;
    const citation = { ...item.citation, value: studyValue };
    return <SourceTag citation={citation} value={round(farm[field] * 100, 4)} onRestore={() => set({ [field]: studyValue / 100 })} />;
  };

  const items = farm.overheadItems ?? [];
  const setItem = (id: string, patch: Partial<OverheadItem>) => set({ overheadItems: items.map(o => o.id === id ? { ...o, ...patch } : o) });
  const addItem = () => set({ overheadItems: [...items, { id: uid(), name: '', amountPerYear: 0, basis: farm.overheadBasis }] });
  const removeItem = (id: string) => set({ overheadItems: items.filter(o => o.id !== id) });
  const overheadTotal = items.reduce((sum, o) => sum + (Number.isFinite(o.amountPerYear) ? o.amountPerYear : 0), 0);

  return (
    <div className="max-w-[680px] mx-auto">
      <h1 className="text-[28px] font-bold tracking-tight">{t('farm.title')}</h1>
      <p className="mt-1 text-ink-2">{t('farm.intro')}</p>

      <Card className="mt-6 p-5 flex flex-col gap-5">
        <Field label={t('farm.name')}>
          <Input value={farm.name} onChange={e => set({ name: e.target.value })} placeholder={t('farm.name.placeholder')} />
        </Field>

        <Field label={t('farm.county')}>
          <Select value={farm.county} onChange={e => set({ county: e.target.value })}>
            {COUNTIES.map(c => <option key={c} value={c}>{c === 'Other' ? t('common.other') : c}</option>)}
          </Select>
        </Field>

        <Field label={t('farm.landUnit')}>
          <Choice<AreaUnit>
            value={farm.areaUnit}
            onChange={areaUnit => set({ areaUnit })}
            options={[
              { value: 'acres', label: t('farm.landUnit.acres') },
              { value: 'beds', label: t('farm.landUnit.beds') },
              { value: 'rows100ft', label: t('farm.landUnit.rows') },
            ]}
          />
        </Field>

        {farm.areaUnit !== 'acres' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {farm.areaUnit === 'beds' && <Field label={t('farm.bedLength')}>
              <NumberInput {...numberProps('bedLengthFt')} suffix={t('common.ft')} />
            </Field>}
            <Field label={t('farm.bedWidth')}>
              <NumberInput {...numberProps('bedWidthIn')} suffix={t('common.in')} />
            </Field>
          </div>
        )}
      </Card>

      <Card className="mt-4 p-5 flex flex-col gap-5">
        <Field label={t('farm.rent')} tag={sourceTag('landRentPerAcre')} hint={t('farm.rent.hint')}>
          <NumberInput {...numberProps('landRentPerAcre')} prefix="$" suffix={t('common.perAcrePerYear')} />
        </Field>

        <Field label={t('farm.ownRate')} tag={sourceTag('ownLaborRate')}>
          <NumberInput {...numberProps('ownLaborRate')} prefix="$" suffix={t('common.perHour')} />
        </Field>

        <Field label={t('farm.hiredRate')} tag={sourceTag('hiredLaborRate')} hint={t('farm.hiredRate.hint')}>
          <NumberInput {...numberProps('hiredLaborRate')} prefix="$" suffix={t('common.perHour')} />
        </Field>

      </Card>

      <Card className="mt-4 p-5 flex flex-col gap-4">
        <div>
          <div className="font-semibold text-[17px]">{t('farm.otherCosts')}</div>
          <div className="text-[14px] text-ink-2">{t('farm.overhead.hint')}</div>
        </div>
        {items.map(o => (
          <div key={o.id} className="grid grid-cols-1 sm:grid-cols-[1fr_210px_auto] gap-2 items-start">
            <div className="min-w-0">
              <Input className="min-w-0" value={o.name} onChange={e => setItem(o.id, { name: e.target.value })} placeholder={t('farm.overhead.namePlaceholder')} aria-label={t('farm.overhead.nameAria')} />
              {o.citation && <div className="mt-1"><SourceTag citation={o.citation} value={o.amountPerYear} onRestore={o.citation.value != null ? () => setItem(o.id, { amountPerYear: o.citation!.value as number }) : undefined} /></div>}
            </div>
            <NumberInput className="w-full" value={o.amountPerYear} onChange={v => setItem(o.id, { amountPerYear: v })} prefix="$" suffix={t('common.perYear')} aria-label={t('farm.overhead.amountAria')} />
            <div className="flex items-center gap-2">
              <Select className="w-[150px]" value={o.basis} onChange={e => setItem(o.id, { basis: e.target.value as AllocationBasis })} aria-label={t('farm.overhead.basisAria')}>
                <option value="acres">{t('farm.basis.acres')}</option>
                <option value="revenue">{t('farm.basis.revenue')}</option>
              </Select>
              <Button variant="ghost" className="h-12 px-3 text-[14px]" onClick={() => removeItem(o.id)} aria-label={t('farm.overhead.removeAria')}>{t('common.remove')}</Button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" className="h-10 px-4 text-[15px]" onClick={addItem}>{t('farm.overhead.add')}</Button>
          {items.length > 0 && <span className="ml-auto text-[15px]"><span className="text-ink-2">{t('farm.overhead.total')}</span> <span className="font-semibold tnum">{money(overheadTotal)}</span> <span className="text-ink-2">{t('common.perYear')}</span></span>}
        </div>
      </Card>

      <Card className="mt-4 p-5 flex flex-col gap-5">
        <div>
          <div className="font-semibold text-[17px]">{t('farm.split.title')}</div>
          <div className="text-[14px] text-ink-2">{t('farm.split.hint')}</div>
        </div>
        <Field label={t('farm.split.equipment')} hint={t(farm.equipmentBasis === 'hours' ? 'farm.split.hours.hint' : farm.equipmentBasis === 'acres' ? 'farm.split.acres.hint' : 'farm.split.revenue.hint')}>
          <Choice<EquipmentBasis> value={farm.equipmentBasis} onChange={equipmentBasis => set({ equipmentBasis })}
            options={[{ value: 'hours', label: t('farm.basis.hours') }, { value: 'acres', label: t('farm.basis.acres') }, { value: 'revenue', label: t('farm.basis.revenue') }]} />
        </Field>
        <Field label={t('farm.split.overhead')} hint={t(farm.overheadBasis === 'acres' ? 'farm.split.acres.hint' : 'farm.split.revenue.hint')}>
          <Choice<AllocationBasis> value={farm.overheadBasis} onChange={overheadBasis => set({ overheadBasis })}
            options={[{ value: 'acres', label: t('farm.basis.acres') }, { value: 'revenue', label: t('farm.basis.revenue') }]} />
        </Field>
      </Card>

      <div className="mt-4">
        <button type="button" onClick={() => setAdvanced(a => !a)} className="text-[15px] font-medium text-accent hover:underline" aria-expanded={advanced}>
          {advanced ? t('common.hideAdvanced') : t('common.advanced')}
        </button>
        {advanced && (
          <Card className="mt-3 p-5 flex flex-col gap-5">
            <Field label={t('farm.interest')} tag={sourceTag('interestRate')} hint={t('farm.interest.hint')}>
              <NumberInput {...numberProps('interestRate', 100)} step={0.01} suffix={t('common.percent')} />
            </Field>
            <Field label={t('farm.operatingInterest')} tag={sourceTag('operatingInterestRate')} hint={t('farm.operatingInterest.hint')}>
              <NumberInput {...numberProps('operatingInterestRate', 100)} step={0.01} suffix={t('common.percent')} />
            </Field>
            <Field label={t('farm.payroll')} tag={sourceTag('payrollOverhead')} hint={t('farm.payroll.hint')}>
              <NumberInput {...numberProps('payrollOverhead', 100)} step={0.1} suffix={t('common.percent')} />
            </Field>
            <Field label={t('farm.insuranceRate')} tag={rateTag('insuranceRate')} hint={t('farm.insuranceRate.hint')}>
              <NumberInput {...numberProps('insuranceRate', 100)} step={0.001} suffix={t('common.percent')} />
            </Field>
            <Field label={t('farm.propertyTaxRate')} tag={rateTag('propertyTaxRate')} hint={t('farm.propertyTaxRate.hint')}>
              <NumberInput {...numberProps('propertyTaxRate', 100)} step={0.01} suffix={t('common.percent')} />
            </Field>
          </Card>
        )}
      </div>
    </div>
  );
}

function round(n: number, d: number) { const f = 10 ** d; return Math.round(n * f) / f; }
