import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { FarmResult, OperationCategory, Plan } from '../lib/types';
import { buildRanging, buildTable1, buildTable5, buildTable6, type Table1 } from '../lib/exportData';
import { Select, money, num, cents } from '../ui';
import { useT, useTypeName, useUnit } from '../i18n';
import type { Key } from '../i18n/en';

/*
 * The tables the UC Davis cost studies print, built from the plan. Each one is a plain table so the
 * first column can stay put while the rest scrolls on a phone. Costs are negative and red everywhere.
 */

const GROUP_KEY: Record<OperationCategory, Key> = { cultural: 'uc.row.cultural', harvest: 'uc.row.harvest', assessment: 'uc.row.assessment', postharvest: 'uc.row.postharvest', other: 'uc.row.other' };
const negCents = (n: number) => (n > 0 ? `−${cents(n)}` : cents(n));

function useNames(plan: Plan) {
  const typeName = useTypeName();
  return useMemo(() => ({
    crop: (id: string, fallback: string) => { const c = plan.crops.find(x => x.id === id); return c ? typeName('crop', c.typeId, c.name) : fallback; },
    machine: (id: string, fallback: string) => { const e = plan.equipment.find(x => x.id === id); return e ? typeName('equipment', e.typeId, e.name) : fallback; },
  }), [plan, typeName]);
}

const th = 'px-2 py-1.5 text-right font-medium text-[12px] whitespace-nowrap';
const thFirst = 'sticky left-0 z-10 bg-ground text-left px-2 py-1.5 font-medium min-w-[150px] max-w-[220px] text-[13px]';
const td = 'px-2 py-1.5 text-right tnum whitespace-nowrap text-[13px]';
const tdFirst = 'sticky left-0 z-10 bg-ground text-left px-2 py-1.5 min-w-[150px] max-w-[220px] whitespace-normal leading-tight text-[13px]';
const costCls = (n: number) => (Math.abs(n) < 0.5 ? 'text-ink-3' : 'text-loss');
const netCls = (n: number) => (Math.abs(n) < 0.5 ? 'text-ink-3' : n < 0 ? 'text-loss' : 'text-gain');
const Cost = ({ n, strong }: { n: number; strong?: boolean }) => <td className={`${td} ${costCls(n)} ${strong ? 'font-semibold' : ''}`}>{money(-n)}</td>;
const Net = ({ n, strong }: { n: number; strong?: boolean }) => <td className={`${td} ${netCls(n)} ${strong ? 'font-semibold' : ''}`}>{money(n, { sign: true })}</td>;

function Frame({ title, caption, children }: { title?: string; caption: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      {title && <h3 className="text-[17px] font-semibold leading-tight">{title}</h3>}
      <p className="text-[13px] text-ink-2">{caption}</p>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full border-collapse">{children}</table>
      </div>
    </section>
  );
}

/* ---------- Table 1 ---------- */

function Table1View({ plan, table }: { plan: Plan; table: Table1 }) {
  const { t } = useT();
  const names = useNames(plan);
  const rowCls = 'border-b border-line';
  const label = (s: string, strong = false, indent = false) => <th scope="row" className={`${tdFirst} ${strong ? 'font-semibold' : 'font-normal'} ${indent ? 'pl-5' : ''}`}>{s}</th>;
  const blank = (n = 1) => Array.from({ length: n }, (_, i) => <td key={i} className={td} />);
  const extraKey: Record<Table1['extra'][number]['key'], Key> = { ownLabor: 'uc.row.ownLabor', hiredJobs: 'uc.row.hiredJobs', lump: 'uc.row.lump', repairPool: 'uc.row.repairPool', interest: 'uc.row.interest' };
  return (
    <Frame caption={`${t('uc.table1.caption')} ${t('uc.perAcreNote', { acres: num(table.acres, 2), plantings: num(table.plantings) })}`}>
      <thead>
        <tr className="text-ink-2 border-b border-line">
          <th className={thFirst}>{t('uc.col.operation')}</th>
          <th className={th}>{t('uc.col.time')}</th>
          <th className={th}>{t('uc.col.labor')}</th>
          <th className={th}>{t('uc.col.flr')}</th>
          <th className={th}>{t('uc.col.materials')}</th>
          <th className={th}>{t('uc.col.custom')}</th>
          <th className={`${th} font-semibold`}>{t('uc.col.total')}</th>
        </tr>
      </thead>
      <tbody>
        {table.groups.map(g => (
          <Fragment key={g.category}>
            <tr className={rowCls}>{label(t(GROUP_KEY[g.category]), true)}{blank(6)}</tr>
            {g.rows.map((r, i) => (
              <tr key={`${g.category}-${i}`} className={rowCls}>
                {label(r.name, false, true)}
                <td className={`${td} text-ink-2`}>{r.time > 0 ? num(r.time, 2) : ''}</td>
                <Cost n={r.labor} /><Cost n={r.flr} /><Cost n={r.materials} /><Cost n={r.custom} /><Cost n={r.total} strong />
              </tr>
            ))}
            <tr className={`${rowCls} bg-well`}>
              {label(t('uc.row.subtotal', { group: t(GROUP_KEY[g.category]).toLowerCase() }), true)}
              {blank(1)}
              <Cost n={g.subtotal.labor} strong /><Cost n={g.subtotal.flr} strong /><Cost n={g.subtotal.materials} strong /><Cost n={g.subtotal.custom} strong /><Cost n={g.subtotal.total} strong />
            </tr>
          </Fragment>
        ))}
        {table.extra.map(e => <tr key={e.key} className={rowCls}>{label(t(extraKey[e.key]))}{blank(5)}<Cost n={e.amount} /></tr>)}
        <tr className={`${rowCls} bg-well`}>{label(t('uc.row.totalOperating'), true)}{blank(5)}<Cost n={table.totalOperating} strong /></tr>
        {table.cashOverhead.length > 0 && <tr className={rowCls}>{label(t('uc.row.cashOverhead'), true)}{blank(6)}</tr>}
        {table.cashOverhead.map(o => <tr key={o.id} className={rowCls}>{label(o.id === 'land-rent' ? t('uc.t5.landRent') : (o.name.trim() || t('export.item')), false, true)}{blank(5)}<Cost n={o.amount} /></tr>)}
        <tr className={`${rowCls} bg-well`}>{label(t('uc.row.totalCashOverhead'), true)}{blank(5)}<Cost n={table.totalCashOverhead} strong /></tr>
        {(table.nonCash.length > 0 || table.establishment) && <tr className={rowCls}>{label(t('uc.row.nonCashOverhead'), true)}{blank(6)}</tr>}
        {table.nonCash.map(m => <tr key={m.equipmentId} className={rowCls}>{label(names.machine(m.equipmentId, m.name), false, true)}{blank(5)}<Cost n={m.amount} /></tr>)}
        {table.establishment && <tr className={rowCls}>{label(t('uc.row.establishment'), false, true)}{blank(5)}<Cost n={table.establishment.total} /></tr>}
        <tr className={`${rowCls} bg-well`}>{label(t('uc.row.totalNonCash'), true)}{blank(5)}<Cost n={table.totalNonCash} strong /></tr>
        <tr className={`${rowCls} border-t-2 border-t-line-strong`}>{label(t('uc.row.totalCosts'), true)}{blank(5)}<Cost n={table.totalCosts} strong /></tr>
        <tr className={rowCls}>{label(t('uc.row.grossReturns'), true)}{blank(5)}<td className={`${td} font-semibold`}>{money(table.grossReturns)}</td></tr>
        <tr className={rowCls}>{label(t('uc.row.netAboveOperating'), true)}{blank(5)}<Net n={table.netAboveOperating} strong /></tr>
        <tr className={rowCls}>{label(t('uc.row.netAboveTotal'), true)}{blank(5)}<Net n={table.netAboveTotal} strong /></tr>
      </tbody>
    </Frame>
  );
}

/* ---------- Table 4 ---------- */

function RangingView({ plan }: { plan: Plan }) {
  const { t } = useT();
  const typeName = useTypeName();
  const unitWord = useUnit();
  const [cropId, setCropId] = useState(plan.crops[0]?.id ?? '');
  const crop = plan.crops.find(c => c.id === cropId) ?? plan.crops[0];
  const ranging = useMemo(() => (crop ? buildRanging(plan, crop.id) : null), [plan, crop]);
  if (!crop || !ranging) return null;
  const name = typeName('crop', crop.typeId, crop.name);
  const unit = unitWord(crop.unit);
  const units = unitWord(crop.unit, true);
  return (
    <div className="space-y-3">
      <div className="max-w-[420px]">
        <Select value={crop.id} onChange={e => setCropId(e.target.value)} aria-label={t('results.crop')}>
          {plan.crops.map(c => <option key={c.id} value={c.id}>{typeName('crop', c.typeId, c.name)}</option>)}
        </Select>
      </div>
      <Frame title={t('uc.table4', { crop: name })} caption={t('uc.table4.caption')}>
        <thead>
          <tr className="text-ink-2 border-b border-line">
            <th className={thFirst}>{t('uc.ranging.yield', { unit: units })}</th>
            {ranging.prices.map((p, i) => <th key={i} className={th}>{cents(p)} / {unit}</th>)}
          </tr>
        </thead>
        <tbody>
          {ranging.yields.map((y, i) => (
            <tr key={i} className={`border-b border-line ${i === 2 ? 'bg-well font-semibold' : ''}`}>
              <th scope="row" className={`${tdFirst} font-medium`}>{num(y)} {units}</th>
              {ranging.net[i].map((n, j) => <Net key={j} n={n} strong={i === 2 && j === 2} />)}
            </tr>
          ))}
        </tbody>
      </Frame>
      <p className="text-[13px] text-ink-2">{t('uc.ranging.netPerAcre')}</p>
    </div>
  );
}

/* ---------- Table 5 ---------- */

function Table5View({ plan, result }: { plan: Plan; result: FarmResult }) {
  const { t } = useT();
  const names = useNames(plan);
  const table = useMemo(() => buildTable5(plan, result, t('uc.t5.landRent'), crop => t('uc.t5.planting', { crop: names.crop(plan.crops.find(c => c.name === crop)?.id ?? '', crop) })), [plan, result, t, names]);
  const rowCls = 'border-b border-line';
  return (
    <Frame title={t('uc.table5')} caption={t('uc.table5.caption')}>
      <thead>
        <tr className="text-ink-2 border-b border-line">
          <th className={thFirst}>{t('uc.t5.description')}</th>
          <th className={th}>{t('uc.t5.price')}</th>
          <th className={th}>{t('uc.t5.years')}</th>
          <th className={th}>{t('uc.t5.salvage')}</th>
          <th className={th}>{t('uc.t5.capitalRecovery')}</th>
          <th className={th}>{t('uc.t5.insurance')}</th>
          <th className={th}>{t('uc.t5.taxes')}</th>
          <th className={th}>{t('uc.t5.repairs')}</th>
          <th className={`${th} font-semibold`}>{t('uc.t5.total')}</th>
        </tr>
      </thead>
      <tbody>
        {table.machines.map(m => (
          <tr key={m.equipmentId} className={rowCls}>
            <th scope="row" className={`${tdFirst} font-medium`}>{names.machine(m.equipmentId, m.name)}</th>
            <td className={td}>{money(m.price)}</td>
            <td className={td}>{num(m.years)}</td>
            <td className={td}>{money(m.salvage)}</td>
            <Cost n={m.capitalRecovery} /><Cost n={m.insurance} /><Cost n={m.taxes} /><Cost n={m.repairs} /><Cost n={m.total} strong />
          </tr>
        ))}
        {table.investments.length > 0 && <tr className={rowCls}><th scope="row" className={`${tdFirst} font-semibold pt-3`}>{t('uc.t5.investments')}</th>{Array.from({ length: 8 }, (_, i) => <td key={i} className={td} />)}</tr>}
        {table.investments.map(m => (
          <tr key={m.equipmentId} className={rowCls}>
            <th scope="row" className={`${tdFirst} font-medium pl-5`}>{m.name}</th>
            <td className={td}>{money(m.price)}</td>
            <td className={td}>{num(m.years)}</td>
            <td className={td}>{money(m.salvage)}</td>
            <Cost n={m.capitalRecovery} /><Cost n={m.insurance} /><Cost n={m.taxes} /><Cost n={m.repairs} /><Cost n={m.total} strong />
          </tr>
        ))}
        <tr className={`${rowCls} bg-well font-semibold`}>
          <th scope="row" className={`${tdFirst} font-semibold`}>{t('uc.t5.equipmentTotal')}</th>
          <td className={td}>{money(table.totals.price)}</td>
          <td className={td} />
          <td className={td}>{money(table.totals.salvage)}</td>
          <Cost n={table.totals.capitalRecovery} strong /><Cost n={table.totals.insurance} strong /><Cost n={table.totals.taxes} strong /><Cost n={table.totals.repairs} strong /><Cost n={table.totals.total} strong />
        </tr>
        {table.overhead.length > 0 && <tr className={rowCls}><th scope="row" className={`${tdFirst} font-semibold pt-4`}>{t('uc.t5.overhead')}</th>{Array.from({ length: 8 }, (_, i) => <td key={i} className={td} />)}</tr>}
        {table.overhead.map(o => (
          <tr key={o.id} className={rowCls}>
            <th scope="row" className={`${tdFirst} font-normal pl-5`}>{o.name.trim() || t('export.item')}</th>
            {Array.from({ length: 7 }, (_, i) => <td key={i} className={td} />)}
            <Cost n={o.amount} />
          </tr>
        ))}
        {table.overhead.length > 0 && <tr className={`${rowCls} bg-well`}><th scope="row" className={`${tdFirst} font-semibold`}>{t('uc.t5.overheadTotal')}</th>{Array.from({ length: 7 }, (_, i) => <td key={i} className={td} />)}<Cost n={table.overheadTotal} strong /></tr>}
      </tbody>
    </Frame>
  );
}

/* ---------- Table 6 ---------- */

function Table6View({ plan, result }: { plan: Plan; result: FarmResult }) {
  const { t } = useT();
  const names = useNames(plan);
  const rows = useMemo(() => buildTable6(plan, result), [plan, result]);
  const rowCls = 'border-b border-line';
  const PerHour = ({ n, strong }: { n: number; strong?: boolean }) => <td className={`${td} ${costCls(n)} ${strong ? 'font-semibold' : ''}`}>{negCents(n)}</td>;
  return (
    <Frame title={t('uc.table6')} caption={t('uc.table6.caption')}>
      <thead>
        <tr className="text-ink-2 border-b border-line">
          <th className={thFirst}>{t('uc.t6.machine')}</th>
          <th className={th}>{t('uc.t6.hours')}</th>
          <th className={th}>{t('uc.t6.capitalRecovery')}</th>
          <th className={th}>{t('uc.t6.insurance')}</th>
          <th className={th}>{t('uc.t6.taxes')}</th>
          <th className={th}>{t('uc.t6.repairs')}</th>
          <th className={th}>{t('uc.t6.fuelLube')}</th>
          <th className={th}>{t('uc.t6.totalOperating')}</th>
          <th className={`${th} font-semibold`}>{t('uc.t6.totalCost')}</th>
          <th className={`${th} text-left`}>{t('uc.t6.carriedBy')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(m => (
          <tr key={m.equipmentId} className={rowCls}>
            <th scope="row" className={`${tdFirst} font-medium`}>{names.machine(m.equipmentId, m.name)}</th>
            {m.hours > 0 ? (
              <>
                <td className={td}>{num(m.hours, m.hours < 10 ? 1 : 0)}<div className="text-[11px] text-ink-2">{t('uc.t6.hoursSplit', { crop: num(m.cropHours, m.cropHours < 10 ? 1 : 0), custom: num(m.customHours, m.customHours < 10 ? 1 : 0) })}</div></td>
                <PerHour n={m.capitalRecovery} /><PerHour n={m.insurance} /><PerHour n={m.taxes} /><PerHour n={m.repairs} /><PerHour n={m.fuelLube} /><PerHour n={m.totalOperating} /><PerHour n={m.totalCost} strong />
              </>
            ) : (
              <td colSpan={8} className={`${td} text-ink-2 text-left`}>{t('uc.t6.none')}</td>
            )}
            <td className="px-2 py-1.5 text-[12px] text-ink-2 whitespace-normal min-w-[160px] leading-tight">
              {[...m.carriedBy.map(b => `${names.crop(b.cropId, b.name)} ${Math.round(b.share * 100)}%`), ...(m.customShare > 0 ? [`${t('uc.t6.custom')} ${Math.round(m.customShare * 100)}%`] : [])].join(', ')}
            </td>
          </tr>
        ))}
      </tbody>
    </Frame>
  );
}

/* ---------- Custom work ---------- */

function CustomWorkView({ plan, result }: { plan: Plan; result: FarmResult }) {
  const { t } = useT();
  const names = useNames(plan);
  const cw = result.customWork;
  if (cw.jobs.length === 0) return null;
  const rowCls = 'border-b border-line';
  return (
    <Frame title={t('uc.customWork')} caption={t('uc.customWork.caption')}>
      <thead>
        <tr className="text-ink-2 border-b border-line">
          <th className={thFirst}>{t('uc.cw.job')}</th>
          <th className={`${th} text-left`}>{t('uc.cw.machine')}</th>
          <th className={th}>{t('uc.cw.hours')}</th>
          <th className={th}>{t('uc.cw.paid')}</th>
          <th className={th}>{t('uc.cw.cost')}<div className="text-[11px] font-normal">{t('uc.cw.costNote')}</div></th>
          <th className={`${th} font-semibold`}>{t('uc.cw.net')}</th>
        </tr>
      </thead>
      <tbody>
        {cw.jobs.map(j => (
          <tr key={j.id} className={rowCls}>
            <th scope="row" className={`${tdFirst} font-medium`}>{j.name.trim() || t('export.item')}</th>
            <td className="px-2 py-1.5 text-[13px] text-ink-2 whitespace-nowrap">{names.machine(j.equipmentId, j.machineName)}</td>
            <td className={td}>{num(j.hours)}</td>
            <td className={td}>{money(j.income)}</td>
            <Cost n={j.cost} /><Net n={j.net} strong />
          </tr>
        ))}
        <tr className={`${rowCls} bg-well font-semibold`}>
          <th scope="row" className={`${tdFirst} font-semibold`}>{t('uc.cw.total')}</th>
          <td /><td className={td}>{num(cw.jobs.reduce((s, j) => s + j.hours, 0))}</td>
          <td className={td}>{money(cw.income)}</td>
          <Cost n={cw.cost} strong /><Net n={cw.net} strong />
        </tr>
      </tbody>
    </Frame>
  );
}

/* ---------- Section ---------- */

export function UcTables({ plan, result }: { plan: Plan; result: FarmResult }) {
  const { t } = useT();
  const typeName = useTypeName();
  const [openCrop, setOpenCrop] = useState<Record<string, boolean>>(() => (plan.crops[0] ? { [plan.crops[0].id]: true } : {}));
  const tables = useMemo(() => plan.crops.map(c => ({ crop: c, table: buildTable1(plan, result, c.id) })).filter((x): x is { crop: typeof x.crop; table: Table1 } => x.table !== null), [plan, result]);
  return (
    <section className="space-y-8" aria-labelledby="uc-tables-heading">
      <div>
        <h2 id="uc-tables-heading" className="text-[20px] font-semibold leading-tight">{t('uc.tables')}</h2>
        <p className="mt-1 text-[14px] text-ink-2">{t('uc.tables.intro')}</p>
      </div>
      {tables.map(({ crop, table }) => (
        <details key={crop.id} open={!!openCrop[crop.id]} onToggle={e => setOpenCrop(o => ({ ...o, [crop.id]: (e.target as HTMLDetailsElement).open }))} className="border-t border-line pt-3">
          <summary className="cursor-pointer text-[16px] font-semibold">{t('uc.table1', { crop: typeName('crop', crop.typeId, crop.name) })}</summary>
          <div className="pt-3"><Table1View plan={plan} table={table} /></div>
        </details>
      ))}
      <div className="border-t border-line pt-3">
        <h3 className="text-[17px] font-semibold leading-tight">{t('uc.table3')}</h3>
        <p className="text-[13px] text-ink-2 mt-1">{t('uc.table3.caption')}</p>
      </div>
      <div className="border-t border-line pt-3"><RangingView plan={plan} /></div>
      {plan.equipment.length > 0 && <div className="border-t border-line pt-3"><Table5View plan={plan} result={result} /></div>}
      {result.machines.length > 0 && <div className="border-t border-line pt-3"><Table6View plan={plan} result={result} /></div>}
      {result.customWork.jobs.length > 0 && <div className="border-t border-line pt-3"><CustomWorkView plan={plan} result={result} /></div>}
    </section>
  );
}
