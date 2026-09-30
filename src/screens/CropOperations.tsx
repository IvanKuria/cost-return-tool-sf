import { useState } from 'react';
import type { Crop, CropOperation, Equipment, Farm, MachineRates, OperationCategory } from '../lib/types';
import { hiredHourly, newBlankOperation, operationCost } from '../lib/engine';
import { Button, Field, Input, NumberInput, Select, SourceTag, cents, money, num } from '../ui';
import { useT, useTypeName } from '../i18n';
import type { Key } from '../i18n/en';

const RENT = '__rent__';
const HIRE = '__hire__';
const CATEGORIES: OperationCategory[] = ['cultural', 'harvest', 'assessment', 'postharvest', 'other'];
const CATEGORY_KEY: Record<OperationCategory, Key> = { cultural: 'ops.category.cultural', harvest: 'ops.category.harvest', assessment: 'ops.category.assessment', postharvest: 'ops.category.postharvest', other: 'ops.category.other' };

export type PartKey = 'materials' | 'handLabor' | 'operatorLabor' | 'machineRunning' | 'rent' | 'hiredMachine' | 'custom' | 'otherLabor';
export const PART_KEYS: PartKey[] = ['materials', 'handLabor', 'operatorLabor', 'machineRunning', 'rent', 'hiredMachine', 'custom', 'otherLabor'];

/** Per acre, one planting: the operations' cost parts added up. `rates` are the machines' run rates at their hours for the year. */
export function operationsPerAcre(crop: Crop, farm: Farm, equipment: Equipment[], rates?: Map<string, MachineRates>) {
  const parts: Record<PartKey, number> = { materials: 0, handLabor: 0, operatorLabor: 0, machineRunning: 0, rent: 0, hiredMachine: 0, custom: 0, otherLabor: 0 };
  for (const op of crop.operations) {
    if (!op.enabled) continue;
    const c = operationCost(op, farm, equipment, rates);
    for (const k of PART_KEYS) parts[k] += c.parts[k];
  }
  const total = PART_KEYS.reduce((s, k) => s + parts[k], 0);
  return { parts, total };
}

/** The Select value for a row: a machine id, or the rent or hire sentinel. */
const modeValue = (op: CropOperation) => {
  const mode = op.mode ?? (op.equipmentId ? 'own' : 'hire');
  return mode === 'own' && op.equipmentId ? op.equipmentId : mode === 'rent' ? RENT : HIRE;
};
const patchForValue = (v: string): Partial<CropOperation> =>
  v === RENT ? { mode: 'rent', equipmentId: null } : v === HIRE ? { mode: 'hire', equipmentId: null } : { mode: 'own', equipmentId: v };

export function CropOperations({ crop, farm, equipment, rates, seasons, onChange }: { crop: Crop; farm: Farm; equipment: Equipment[]; rates: Map<string, MachineRates>; seasons: number; onChange: (patch: Partial<Crop>) => void }) {
  const { t } = useT();
  const typeName = useTypeName();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [assigning, setAssigning] = useState(false);
  const rate = hiredHourly(farm);
  const ops = crop.operations;
  const update = (id: string, patch: Partial<CropOperation>) => onChange({ operations: ops.map(o => o.id === id ? { ...o, ...patch } : o) });
  const remove = (id: string) => onChange({ operations: ops.filter(o => o.id !== id) });
  const add = () => { const o = newBlankOperation(); onChange({ operations: [...ops, o] }); setOpen(s => ({ ...s, [o.id]: true })); };
  const machineName = (e: Equipment) => typeName('equipment', e.typeId, e.name);
  const nameOf = (op: CropOperation) => op.name.trim() || t('ops.name');
  const { parts, total } = operationsPerAcre(crop, farm, equipment, rates);
  const machineOps = ops.filter(o => o.machineHoursPerAcre > 0);
  const disabled = ops.filter(o => !o.enabled).length;

  const groups = CATEGORIES.map(cat => ({ cat, rows: ops.filter(o => o.category === cat) })).filter(g => g.rows.length > 0);

  const whoSelect = (op: CropOperation, ariaLabel?: string) => (
    <Select value={modeValue(op)} onChange={e => update(op.id, patchForValue(e.target.value))} aria-label={ariaLabel}>
      {equipment.map(e => <option key={e.id} value={e.id}>{machineName(e)}</option>)}
      <option value={RENT}>{t('ops.mode.rent')}</option>
      <option value={HIRE}>{t('ops.mode.hire')}</option>
    </Select>
  );

  const whoLabel = (op: CropOperation, machine: Equipment | null) => {
    const mode = op.mode ?? (op.equipmentId ? 'own' : 'hire');
    return mode === 'own' && machine ? machineName(machine) : mode === 'rent' ? t('ops.rented') : t('ops.hired');
  };

  return (
    <div className="border-t border-line pt-5 flex flex-col gap-4">
      <div>
        <div className="font-semibold text-[17px]">{t('ops.title')}</div>
        <div className="text-[14px] text-ink-2">{t('ops.intro')}</div>
        <div className="text-[13px] text-ink-3 mt-1">{t('ops.count', { count: String(ops.length) })}{disabled > 0 ? `, ${t('ops.disabledCount', { count: String(disabled) })}` : ''}</div>
      </div>

      {equipment.length === 0 && machineOps.length > 0 && (
        <p className="text-[14px] text-ink-2 rounded-[var(--radius-ctl)] bg-well px-4 py-3">{t('ops.noMachines')}</p>
      )}

      {machineOps.length > 0 && (
        <div>
          <Button variant="secondary" className="h-10 px-4 text-[15px]" onClick={() => setAssigning(a => !a)} aria-expanded={assigning}>{assigning ? t('ops.assign.done') : t('ops.assign')}</Button>
          {assigning && (
            <div className="mt-3 rounded-[var(--radius-ctl)] border border-line divide-y divide-line">
              <p className="px-4 py-2.5 text-[14px] text-ink-2">{t('ops.assign.intro')}</p>
              {machineOps.map(op => (
                <div key={op.id} className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-2 items-center px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[15px] truncate">{nameOf(op)}</div>
                    <div className="text-[13px] text-ink-2 tnum">{t('ops.hoursShort', { hours: num(op.machineHoursPerAcre, 2) })} {t('common.perAcre')}</div>
                  </div>
                  {whoSelect(op, `${t('ops.who')}: ${nameOf(op)}`)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {groups.map(g => (
          <div key={g.cat}>
            <div className="text-[13px] font-medium text-ink-2 mb-1.5">{t(CATEGORY_KEY[g.cat])}</div>
            <div className="flex flex-col divide-y divide-line border border-line rounded-[var(--radius-ctl)] overflow-hidden">
              {g.rows.map(op => {
                const cost = operationCost(op, farm, equipment, rates);
                const isOpen = !!open[op.id];
                const mode = op.mode ?? (op.equipmentId ? 'own' : 'hire');
                const machine = mode === 'own' && op.equipmentId ? equipment.find(e => e.id === op.equipmentId) ?? null : null;
                const isMachineRow = op.machineHoursPerAcre > 0;
                const who = isMachineRow ? whoLabel(op, machine) : null;
                const machineRate = machine ? rates.get(machine.id) : undefined;
                const capacity = op.machineHoursPerAcre > 0 ? 1 / op.machineHoursPerAcre : 0;
                return (
                  <div key={op.id} className={op.enabled ? '' : 'opacity-60'}>
                    <div className="flex items-center gap-3 px-3 py-2">
                      <input type="checkbox" className="size-5 accent-[var(--color-accent)] shrink-0" checked={op.enabled} onChange={e => update(op.id, { enabled: e.target.checked })} aria-label={t('ops.on', { name: nameOf(op) })} />
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(s => ({ ...s, [op.id]: !isOpen }))} aria-expanded={isOpen} aria-label={t('ops.expand', { name: nameOf(op) })}>
                        <div className="text-[15px] truncate">{nameOf(op)}</div>
                        {who && <div className="text-[12.5px] text-ink-2 truncate">{who}, {t('ops.hoursShort', { hours: num(op.machineHoursPerAcre, 2) })}</div>}
                      </button>
                      <div className="tnum text-[14px] text-loss whitespace-nowrap">{money(-cost.perAcre)}</div>
                    </div>
                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 bg-well flex flex-col gap-3">
                        {op.source === 'custom' && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Field label={t('ops.name')}><Input value={op.name} onChange={e => update(op.id, { name: e.target.value })} /></Field>
                            <Field label={t('ops.category')}>
                              <Select value={op.category} onChange={e => update(op.id, { category: e.target.value as OperationCategory })}>
                                {CATEGORIES.map(c => <option key={c} value={c}>{t(CATEGORY_KEY[c])}</option>)}
                              </Select>
                            </Field>
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Field label={t('ops.machineHours')} hint={isMachineRow && op.source === 'study' ? t('ops.capacity', { acres: num(capacity, 2) }) : t('ops.machineHours.hint')}>
                            <NumberInput value={op.machineHoursPerAcre} onChange={v => update(op.id, { machineHoursPerAcre: v })} step={0.01} suffix={t('common.perAcre')} />
                          </Field>
                          <Field label={t('ops.acresPerHour')} hint={t('ops.acresPerHour.hint')}>
                            <NumberInput value={capacity > 0 ? Math.round(capacity * 100) / 100 : 0} onChange={v => update(op.id, { machineHoursPerAcre: v > 0 ? Math.round((1 / v) * 10000) / 10000 : 0 })} step={0.01} suffix={t('common.perHour')} />
                          </Field>
                        </div>
                        {isMachineRow && (
                          <Field label={t('ops.who')}>{whoSelect(op)}</Field>
                        )}
                        {isMachineRow && mode === 'hire' && (
                          <Field label={t('ops.hiredMachine')} hint={t('ops.hiredMachine.hint')}>
                            <NumberInput value={op.hiredMachinePerAcre} onChange={v => update(op.id, { hiredMachinePerAcre: v })} prefix="$" suffix={t('common.perAcre')} />
                          </Field>
                        )}
                        {isMachineRow && mode === 'rent' && (
                          <Field label={t('ops.rent')} hint={t('ops.rent.hint')}>
                            <NumberInput value={op.rentPerHour} onChange={v => update(op.id, { rentPerHour: v })} step={0.01} prefix="$" suffix={t('common.perHour')} />
                          </Field>
                        )}
                        {isMachineRow && mode !== 'hire' && (
                          <Field label={t('ops.operatorHours')} hint={`${t('ops.operatorHours.hint', { rate: cents(rate) })}${machine && machineRate ? ` ${t('ops.runRate.hours', { name: machineName(machine), rate: cents(machineRate.runPerHour), hours: num(machineRate.hoursPerYear) })}` : ''}`}>
                            <NumberInput value={op.operatorHoursPerAcre} onChange={v => update(op.id, { operatorHoursPerAcre: v })} step={0.01} suffix={t('common.perAcre')} />
                          </Field>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Field label={t('ops.handHours')} hint={t('ops.handHours.hint', { rate: cents(rate) })}>
                            <NumberInput value={op.handHoursPerAcre} onChange={v => update(op.id, { handHoursPerAcre: v })} step={0.01} suffix={t('common.perAcre')} />
                          </Field>
                          {op.otherLaborPerAcre > 0 && (
                            <Field label={t('ops.otherLabor')} hint={t('ops.otherLabor.hint')}>
                              <NumberInput value={op.otherLaborPerAcre} onChange={v => update(op.id, { otherLaborPerAcre: v })} prefix="$" suffix={t('common.perAcre')} />
                            </Field>
                          )}
                          <Field label={t('ops.materials')}>
                            <NumberInput value={op.materialsPerAcre} onChange={v => update(op.id, { materialsPerAcre: v })} prefix="$" suffix={t('common.perAcre')} />
                          </Field>
                          <Field label={t('ops.custom')}>
                            <NumberInput value={op.customPerAcre} onChange={v => update(op.id, { customPerAcre: v })} prefix="$" suffix={t('common.perAcre')} />
                          </Field>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          {op.citation && <SourceTag citation={op.citation} value={op.citation.value ?? 0} />}
                          <Button variant="danger" className="h-9 px-3 text-[14px] ml-auto" onClick={() => remove(op.id)}>{t('ops.remove')}</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <Button variant="secondary" className="self-start h-10 px-4 text-[15px]" onClick={add}>{t('ops.add')}</Button>

      <div className="rounded-[var(--radius-ctl)] bg-well px-4 py-3">
        <div className="flex justify-between text-[13px] text-ink-2 mb-1">
          <span className="font-medium text-ink">{t('ops.summary')}</span>
          <span className="flex gap-6"><span className="w-[92px] text-right">{t('ops.perAcre')}</span><span className="w-[92px] text-right hidden sm:inline">{t('ops.forYear')}</span></span>
        </div>
        {PART_KEYS.filter(k => parts[k] > 0).map(k => (
          <div key={k} className="flex justify-between text-[14px] py-0.5">
            <span className="text-ink-2">{t(`ops.part.${k}` as Key)}</span>
            <span className="flex gap-6"><span className="w-[92px] text-right tnum text-loss">{money(-parts[k])}</span><span className="w-[92px] text-right tnum text-loss hidden sm:inline">{money(-parts[k] * seasons)}</span></span>
          </div>
        ))}
        <div className="flex justify-between text-[15px] font-semibold pt-1.5 mt-1 border-t border-line">
          <span>{t('ops.total')}</span>
          <span className="flex gap-6"><span className="w-[92px] text-right tnum text-loss">{money(-total)}</span><span className="w-[92px] text-right tnum text-loss hidden sm:inline">{money(-total * seasons)}</span></span>
        </div>
      </div>
    </div>
  );
}
