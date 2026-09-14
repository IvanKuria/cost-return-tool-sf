import { restoreSourceValue, sourceDisplayValue } from '../lib/source';
import { useState, type Dispatch } from 'react';
import { inputPatch, isMissing } from '../lib/inputs';
import type { Action } from '../lib/store';
import type { AreaUnit, Farm, FarmCitedField, FarmResult, Plan } from '../lib/types';
import { Card, Choice, Field, Input, NumberInput, Select, SourceTag } from '../ui';
import { useT } from '../i18n';

const COUNTIES = ['Santa Cruz', 'Monterey', 'San Benito', 'Santa Clara', 'San Mateo', 'Yolo', 'Sonoma', 'Fresno', 'Other'];

export function FarmScreen({ plan, dispatch }: { plan: Plan; dispatch: Dispatch<Action>; result?: FarmResult }) {
  const { t } = useT();
  const farm = plan.farm;
  const set = (patch: Partial<Farm>) => dispatch({ type: 'farm', patch });
  const [advanced, setAdvanced] = useState(() => !!farm.missingFields?.some(f => f === 'interestRate' || f === 'payrollOverhead'));
  const numberProps = (field: 'bedLengthFt' | 'bedWidthIn' | 'landRentPerAcre' | 'ownLaborRate' | 'hiredLaborRate' | 'otherOverheadPerYear' | 'interestRate' | 'payrollOverhead', factor = 1) => ({
    value: round(farm[field] * factor, 4), missing: isMissing(farm, field), placeholder: t('inputs.enterNumber'),
    onChange: (v: number) => set(inputPatch(farm, field, v / factor)), onMissingChange: () => set(inputPatch(farm, field, undefined)),
  });

  const sourceTag = (field: FarmCitedField) => <SourceTag citation={farm.citations[field]} value={sourceDisplayValue(farm, field) ?? 0} missing={isMissing(farm, field)} onRestore={() => set(restoreSourceValue(farm, field, farm.citations[field]))} />;

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

        {farm.areaUnit === 'beds' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('farm.bedLength')}>
              <NumberInput {...numberProps('bedLengthFt')} suffix={t('common.ft')} />
            </Field>
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

        <Field label={t('farm.otherCosts')} tag={sourceTag('otherOverheadPerYear')} hint={t('farm.otherCosts.hint')}>
          <NumberInput {...numberProps('otherOverheadPerYear')} prefix="$" suffix={t('common.perYear')} />
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
            <Field label={t('farm.payroll')} tag={sourceTag('payrollOverhead')} hint={t('farm.payroll.hint')}>
              <NumberInput {...numberProps('payrollOverhead', 100)} step={0.1} suffix={t('common.percent')} />
            </Field>
          </Card>
        )}
      </div>
    </div>
  );
}

function round(n: number, d: number) { const f = 10 ** d; return Math.round(n * f) / f; }
