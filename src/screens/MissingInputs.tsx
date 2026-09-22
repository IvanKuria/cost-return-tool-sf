import type { Dispatch } from 'react';
import type { Action } from '../lib/store';
import type { Plan } from '../lib/types';
import { missingPlanInputs } from '../lib/inputs';
import { useT, useTypeName } from '../i18n';
import type { Key } from '../i18n/en';

const LABELS: Record<string, Key> = {
  area: 'crops.area', plantingsPerYear: 'crops.plantings', yieldPerAcre: 'crops.yield', price: 'crops.price', operatingCostPerAcre: 'crops.operating', ownLaborHoursPerAcre: 'crops.ownHours',
  pricePaid: 'equip.paid', keepYears: 'equip.keep', salvageValue: 'equip.salvage', fuelLubePerHour: 'equip.fuel', repairsPerHour: 'equip.repairs', hoursPerYear: 'equip.use', yearBought: 'equip.year',
  landRentPerAcre: 'farm.rent', ownLaborRate: 'farm.ownRate', hiredLaborRate: 'farm.hiredRate', interestRate: 'farm.interest', payrollOverhead: 'farm.payroll', bedLengthFt: 'farm.bedLength', bedWidthIn: 'farm.bedWidth',
};

export function MissingInputs({ plan, dispatch }: { plan: Plan; dispatch: Dispatch<Action> }) {
  const { t } = useT();
  const typeName = useTypeName();
  const missing = missingPlanInputs(plan);
  if (!missing.length) return null;
  const groups = [...new Set(missing.map(m => `${m.step}:${m.id ?? ''}`))].map(key => missing.filter(m => `${m.step}:${m.id ?? ''}` === key));
  return <aside className="border border-line-strong rounded-xl p-4 sm:p-5 bg-well space-y-3" aria-label={t('inputs.reviewMissing')}>
    <h2 className="font-semibold">{t('inputs.reviewMissing')}</h2>
    <p className="text-sm text-ink-2">{t('inputs.draftHint')}</p>
    <ul className="space-y-3">{groups.map(group => {
      const first = group[0];
      const crop = plan.crops.find(c => c.id === first.id);
      const name = first.step === 'farm' ? t('step.farm') : crop ? typeName('crop', crop.typeId, crop.name) : first.name;
      return <li key={`${first.step}:${first.id}`}><button type="button" className="text-left text-accent font-medium underline underline-offset-2 min-h-11" onClick={() => { dispatch({ type: 'go', step: first.step, editId: first.id }); window.scrollTo({ top: 0 }); }}>{name}</button><p className="text-sm text-ink-2">{group.map(m => t(LABELS[m.field] ?? 'inputs.enterNumber')).join(', ')}</p></li>;
    })}</ul>
  </aside>;
}
