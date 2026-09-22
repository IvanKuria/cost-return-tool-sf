import { useState } from 'react';
import type { Crop, CropOperation, Equipment, Farm, OperationCategory } from '../lib/types';
import { hiredHourly, newBlankOperation, operationCost, runPerHour } from '../lib/engine';
import { Button, Field, Input, NumberInput, Select, SourceTag, cents, money, num } from '../ui';
import { useT, useTypeName } from '../i18n';
import type { Key } from '../i18n/en';

const HIRED = '__hired__';
const CATEGORIES: OperationCategory[] = ['cultural', 'harvest', 'assessment', 'postharvest', 'other'];
const CATEGORY_KEY: Record<OperationCategory, Key> = { cultural: 'ops.category.cultural', harvest: 'ops.category.harvest', assessment: 'ops.category.assessment', postharvest: 'ops.category.postharvest', other: 'ops.category.other' };

export type PartKey = 'materials' | 'handLabor' | 'operatorLabor' | 'machineRunning' | 'hiredMachine' | 'custom' | 'otherLabor';
export const PART_KEYS: PartKey[] = ['materials', 'handLabor', 'operatorLabor', 'machineRunning', 'hiredMachine', 'custom', 'otherLabor'];

/** Per acre, one planting: the operations' cost parts added up. */
export function operationsPerAcre(crop: Crop, farm: Farm, equipment: Equipment[]) {
  const parts: Record<PartKey, number> = { materials: 0, handLabor: 0, operatorLabor: 0, machineRunning: 0, hiredMachine: 0, custom: 0, otherLabor: 0 };
  for (const op of crop.operations) {
    if (!op.enabled) continue;
    const c = operationCost(op, farm, equipment);
    for (const k of PART_KEYS) parts[k] += c.parts[k];
  }
  const total = PART_KEYS.reduce((s, k) => s + parts[k], 0);
  return { parts, total };
}

export function CropOperations({ crop, farm, equipment, seasons, onChange }: { crop: Crop; farm: Farm; equipment: Equipment[]; seasons: number; onChange: (patch: Partial<Crop>) => void }) {
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
  const { parts, total } = operationsPerAcre(crop, farm, equipment);
  const machineOps = ops.filter(o => o.machineHoursPerAcre > 0);
  const disabled = ops.filter(o => !o.enabled).length;

  const groups = CATEGORIES.map(cat => ({ cat, rows: ops.filter(o => o.category === cat) })).filter(g => g.rows.length > 0);

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

      {equipment.length > 0 && machineOps.length > 0 && (
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
                  <Select value={op.equipmentId ?? HIRED} onChange={e => update(op.id, { equipmentId: e.target.value === HIRED ? null : e.target.value })} aria-label={`${t('ops.who')}: ${nameOf(op)}`}>
                    <option value={HIRED}>{t('ops.hired')}</option>
                    {equipment.map(e => <option key={e.id} value={e.id}>{machineName(e)}</option>)}
                  </Select>
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
                const cost = operationCost(op, farm, equipment);
                const isOpen = !!open[op.id];
                const machine = op.equipmentId ? equipment.find(e => e.id === op.equipmentId) ?? null : null;
                const who = op.machineHoursPerAcre > 0 ? (machine ? machineName(machine) : t('ops.hired')) : null;
                return (
                  <div key={op.id} className={op.enabled ? '' : 'opacity-60'}>
                    <div className="flex items-center gap-3 px-3 py-2">
                      <input type="checkbox" className="size-5 accent-[var(--color-accent)] shrink-0" checked={op.enabled} onChange={e => update(op.id, { enabled: e.target.checked })} aria-label={t('ops.on', { name: nameOf(op) })} />
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(s => ({ ...s, [op.id]: !isOpen }))} aria-expanded={isOpen} aria-label={t('ops.expand', { name: nameOf(op) })}>
                        <div className="text-[15px] truncate">{nameOf(op)}</div>
                        {who && <div className="text-[12.5px] text-ink-2 truncate">{who}{op.machineHoursPerAcre > 0 ? `, ${t('ops.hoursShort', { hours: num(op.machineHoursPerAcre, 2) })}` : ''}</div>}
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
                          <Field label={t('ops.machineHours')}>
                            <NumberInput value={op.machineHoursPerAcre} onChange={v => update(op.id, { machineHoursPerAcre: v })} step={0.01} suffix={t('common.perAcre')} />
                          </Field>
                          {op.machineHoursPerAcre > 0 && (
                            <Field label={t('ops.who')}>
                              <Select value={op.equipmentId ?? HIRED} onChange={e => update(op.id, { equipmentId: e.target.value === HIRED ? null : e.target.value })}>
                                <option value={HIRED}>{t('ops.hired')}</option>
                                {equipment.map(e => <option key={e.id} value={e.id}>{machineName(e)}</option>)}
                              </Select>
                            </Field>
                          )}
                        </div>
                        {op.machineHoursPerAcre > 0 && !machine && (
                          <Field label={t('ops.hiredMachine')} hint={t('ops.hiredMachine.hint')}>
                            <NumberInput value={op.hiredMachinePerAcre} onChange={v => update(op.id, { hiredMachinePerAcre: v })} prefix="$" suffix={t('common.perAcre')} />
                          </Field>
                        )}
                        {op.machineHoursPerAcre > 0 && machine && (
                          <Field label={t('ops.operatorHours')} hint={`${t('ops.operatorHours.hint', { rate: cents(rate) })} ${t('ops.runRate', { name: machineName(machine), rate: cents(runPerHour(machine)) })}`}>
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
