import { useMemo, useState, type Dispatch } from 'react';
import type { Action } from '../lib/store';
import type { CropResult, FarmResult, Plan } from '../lib/types';
import { inputPatch, missingPlanInputs } from '../lib/inputs';
import { MissingInputs } from './MissingInputs';
import { ExportActions } from './ExportActions';
import { computePlan } from '../lib/engine';
import { Button, Select, money, num, cents } from '../ui';
import { Slider as ShadSlider } from '@/components/ui/slider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useT, useTypeName, useUnit } from '../i18n';
import type { Key } from '../i18n/en';

/** A cost shown per hour: real minus sign, two decimals. */
const negCents = (n: number) => (n > 0 ? `\u2212${cents(n)}` : cents(n));

const monthKey = (i: number) => `month.${i}` as Key;
const monthLongKey = (i: number) => `monthLong.${i}` as Key;

/** Crop name in the current language, looked up from the plan by crop id. */
function useCropName(plan: Plan) {
  const typeName = useTypeName();
  return (cropId: string, fallback: string) => {
    const c = plan.crops.find(x => x.id === cropId);
    return c ? typeName('crop', c.typeId, c.name) : fallback;
  };
}

function Heading({ title }: { title: string }) {
  return <h2 className="text-[20px] font-semibold leading-tight mb-4">{title}</h2>;
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'loss' }) {
  return (
    <div>
      <div className="text-[14px] text-ink-2">{label}</div>
      <div className={`text-[22px] font-semibold tnum ${tone === 'loss' ? 'text-loss' : tone === 'gain' ? 'text-gain' : ''}`}>{value}</div>
    </div>
  );
}

export function ResultsScreen({ plan, dispatch, result }: { plan: Plan; dispatch: Dispatch<Action>; result: FarmResult }) {
  const { t } = useT();
  if (plan.crops.length === 0) {
    return (
      <div className="max-w-[860px] mx-auto space-y-4">
        <p className="text-[20px]">{t('results.empty')}</p>
        <Button variant="primary" onClick={() => dispatch({ type: 'go', step: 'crops' })}>{t('crops.add')}</Button>
        <ExportActions plan={plan} result={result} />
      </div>
    );
  }

  return (
    <div className="max-w-[860px] mx-auto space-y-10">
      <TheAnswer result={result} provisional={missingPlanInputs(plan).length > 0} />
      <MissingInputs plan={plan} dispatch={dispatch} />
      <CashChart plan={plan} result={result} />
      <CropTable plan={plan} result={result} />
      <details className="border-t border-line pt-5">
        <summary className="cursor-pointer text-[20px] font-semibold">{t('results.whatIf')}</summary>
        <div className="pt-5"><Room plan={plan} dispatch={dispatch} result={result} /></div>
      </details>
      {result.machines.length > 0 && <details className="border-t border-line pt-5">
        <summary className="cursor-pointer text-[20px] font-semibold">{t('results.machines')}</summary>
        <div className="pt-5"><Machines plan={plan} result={result} /></div>
      </details>}
      <Button onClick={() => dispatch({ type: 'go', step: 'sources' })}>{t('app.sources')}</Button>
      <ExportActions plan={plan} result={result} />
    </div>
  );
}

/* ---------- 1. The answer ---------- */

function TheAnswer({ result, provisional }: { result: FarmResult; provisional: boolean }) {
  const { t } = useT();
  return (
    <section>
      <h1 className="text-[28px] md:text-[34px] font-bold tracking-tight">{t(provisional ? 'inputs.provisional' : 'summary.title')}</h1>
      <p className="mt-2 text-ink-2">{t('summary.description')}</p>
      <div className="mt-6 pt-5 border-t border-line grid gap-5 sm:grid-cols-3">
        <Fact label={t('results.sales')} value={money(result.revenue)} />
        <Fact label={t('results.allCosts')} value={money(-result.totalCost)} tone="loss" />
        <Fact label={t('summary.net')} value={money(result.net, { sign: true })} tone={result.net < 0 ? 'loss' : 'gain'} />
      </div>
    </section>
  );
}

/* ---------- 2. Which crops carry the farm ---------- */

function CropTable({ plan, result }: { plan: Plan; result: FarmResult }) {
  const { t } = useT();
  const cropName = useCropName(plan);
  const [breakdown, setBreakdown] = useState(false);
  const rows = [...result.crops].sort((a, b) => b.net - a.net);
  const paperLoser = rows.find(c => c.net < 0 && c.contribution > 0);
  const realLoser = rows.find(c => c.contribution < 0);
  const totals = {
    operating: rows.reduce((s, c) => s + c.operating, 0),
    overhead: rows.reduce((s, c) => s + c.overheadShare, 0),
    equipment: rows.reduce((s, c) => s + c.equipmentShare, 0),
  };
  const netCls = (n: number) => (n < 0 ? 'text-loss' : n > 0 ? 'text-gain' : '');
  const right = 'text-right tnum whitespace-nowrap';
  const cost = `${right} py-2.5 text-loss`;

  return (
    <section>
      <Heading title={t('results.carry')} />
      <button type="button" onClick={() => setBreakdown(b => !b)} aria-pressed={breakdown} className="mb-3 text-[15px] font-medium text-accent hover:underline">
        {breakdown ? t('results.table.hideBreakdown') : t('results.table.showBreakdown')}
      </button>
      <div className="sm:hidden divide-y divide-line border-t border-line">
        {[...rows, null].map(c => {
          const isTotal = c === null;
          const name = isTotal ? t('results.table.wholeFarm') : cropName(c.cropId, c.name);
          const acres = isTotal ? result.totalAcres : c.acres;
          const revenue = isTotal ? result.revenue : c.revenue;
          const totalCost = isTotal ? result.totalCost : c.totalCost;
          const net = isTotal ? result.net : c.net;
          return (
            <div key={isTotal ? 'total' : c.cropId} className={`py-3 ${isTotal ? 'font-semibold' : ''}`}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{name}</div>
                  <div className="text-[13px] text-ink-2 font-normal tnum">{num(acres, 2)} {acres === 1 ? t('common.acre') : t('common.acres')}</div>
                </div>
                <div className={`text-[18px] font-semibold tnum whitespace-nowrap ${netCls(net)}`}>{money(net, { sign: true })}</div>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-x-4 text-[14px] font-normal">
                <div className="flex justify-between"><span className="text-ink-2">{t('results.table.sales')}</span><span className="tnum">{money(revenue)}</span></div>
                <div className="flex justify-between"><span className="text-ink-2">{t('results.table.costs')}</span><span className="tnum text-loss">{money(-totalCost)}</span></div>
                {breakdown && !isTotal && (
                  <>
                    <div className="flex justify-between col-span-2 pl-3 text-[13px]"><span className="text-ink-2">{t('results.col.operating')}</span><span className="tnum text-loss">{money(-c.operating)}</span></div>
                    <div className="flex justify-between col-span-2 pl-3 text-[13px]"><span className="text-ink-2">{t('results.col.overhead')}</span><span className="tnum text-loss">{money(-c.overheadShare)}</span></div>
                    <div className="flex justify-between col-span-2 pl-3 text-[13px]"><span className="text-ink-2">{t('results.col.equipment')}</span><span className="tnum text-loss">{money(-c.equipmentShare)}</span></div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hidden sm:block overflow-x-auto -mx-4 px-4">
        <Table className="text-[15px]">
          <TableHeader>
            <TableRow className="text-ink-2">
              <TableHead className="pl-0">{t('results.table.crop')}</TableHead>
              <TableHead className={right}>{t('results.table.sales')}</TableHead>
              {breakdown ? (
                <>
                  <TableHead className={right}>{t('results.col.operating')}</TableHead>
                  <TableHead className={right}>{t('results.col.overhead')}</TableHead>
                  <TableHead className={right}>{t('results.col.equipment')}</TableHead>
                </>
              ) : (
                <TableHead className={right}>{t('results.table.costs')}</TableHead>
              )}
              <TableHead className={right}>{t('results.table.left')}</TableHead>
              <TableHead className={`${right} pr-0`}>{t('results.table.perAcre')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(c => (
              <TableRow key={c.cropId} className="align-top">
                <TableCell className="pl-0 py-2.5">
                  <div className="font-medium">{cropName(c.cropId, c.name)}</div>
                  <div className="text-[13px] text-ink-2 tnum">{num(c.acres, 2)} {c.acres === 1 ? t('common.acre') : t('common.acres')}</div>
                </TableCell>
                <TableCell className={`${right} py-2.5`}>{money(c.revenue)}</TableCell>
                {breakdown ? (
                  <>
                    <TableCell className={cost}>{money(-c.operating)}</TableCell>
                    <TableCell className={cost}>{money(-c.overheadShare)}</TableCell>
                    <TableCell className={cost}>{money(-c.equipmentShare)}</TableCell>
                  </>
                ) : (
                  <TableCell className={cost}>{money(-c.totalCost)}</TableCell>
                )}
                <TableCell className={`${right} py-2.5 font-semibold ${netCls(c.net)}`}>{money(c.net, { sign: true })}</TableCell>
                <TableCell className={`${right} py-2.5 pr-0 ${netCls(c.net)}`}>{c.acres > 0 ? money(c.net / c.acres, { sign: true }) : ''}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold border-t-2 border-line-strong">
              <TableCell className="pl-0 py-2.5">
                <div>{t('results.table.wholeFarm')}</div>
                <div className="text-[13px] text-ink-2 tnum font-normal">{num(result.totalAcres, 2)} {t('common.acres')}</div>
              </TableCell>
              <TableCell className={`${right} py-2.5`}>{money(result.revenue)}</TableCell>
              {breakdown ? (
                <>
                  <TableCell className={cost}>{money(-totals.operating)}</TableCell>
                  <TableCell className={cost}>{money(-totals.overhead)}</TableCell>
                  <TableCell className={cost}>{money(-totals.equipment)}</TableCell>
                </>
              ) : (
                <TableCell className={cost}>{money(-result.totalCost)}</TableCell>
              )}
              <TableCell className={`${right} py-2.5 ${netCls(result.net)}`}>{money(result.net, { sign: true })}</TableCell>
              <TableCell className={`${right} py-2.5 pr-0 ${netCls(result.net)}`}>{result.totalAcres > 0 ? money(result.net / result.totalAcres, { sign: true }) : ''}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {paperLoser && (
        <div className="mt-4 border-l-4 border-accent bg-accent-soft rounded-r-[10px] px-4 py-3 text-[15px] leading-relaxed">
          <span className="font-semibold">{t('results.paperLoser', { crop: cropName(paperLoser.cropId, paperLoser.name) })}</span>{' '}
          {t('results.paperLoser.text', { amount: money(paperLoser.contribution) })}
        </div>
      )}
      {realLoser && (
        <div className="mt-4 border-l-4 border-loss bg-loss-soft rounded-r-[10px] px-4 py-3 text-[15px] leading-relaxed">
          <span className="font-semibold">{t('results.realLoser', { crop: cropName(realLoser.cropId, realLoser.name) })}</span>{' '}
          {t('results.realLoser.text', { amount: money(-realLoser.contribution) })}
        </div>
      )}
    </section>
  );
}

/* ---------- 3. What if ---------- */

function Room({ plan, dispatch, result }: { plan: Plan; dispatch: Dispatch<Action>; result: FarmResult }) {
  const { t } = useT();
  const typeName = useTypeName();
  const unitWord = useUnit();
  const [cropId, setCropId] = useState(plan.crops[0].id);
  const crop = plan.crops.find(c => c.id === cropId) ?? plan.crops[0];
  const name = typeName('crop', crop.typeId, crop.name);
  const [yieldPct, setYieldPct] = useState(100);
  const [pricePct, setPricePct] = useState(100);

  const yieldPerAcre = crop.yieldPerAcre * (yieldPct / 100);
  const price = crop.price * (pricePct / 100);

  const trial = useMemo(() => {
    const changed: Plan = { ...plan, crops: plan.crops.map(c => c.id === crop.id ? { ...c, yieldPerAcre, price } : c) };
    return computePlan(changed);
  }, [plan, crop.id, yieldPerAcre, price]);
  const trialCrop: CropResult | undefined = trial.crops.find(c => c.cropId === crop.id);
  const baseCrop = result.crops.find(c => c.cropId === crop.id);

  const pick = (id: string) => { setCropId(id); setYieldPct(100); setPricePct(100); };
  const keep = () => {
    dispatch({ type: 'crop.update', id: crop.id, patch: { ...inputPatch({ ...crop, ...inputPatch(crop, 'yieldPerAcre', yieldPerAcre) }, 'price', price), yieldPerAcre, price } });
    setYieldPct(100); setPricePct(100);
  };
  const changed = yieldPct !== 100 || pricePct !== 100;
  const unit = unitWord(crop.unit);
  const units = unitWord(crop.unit, true);

  return (
    <section>
      <div className="max-w-[560px] space-y-5">
        <Select value={crop.id} onChange={e => pick(e.target.value)} aria-label={t('results.crop')}>
          {plan.crops.map(c => <option key={c.id} value={c.id}>{typeName('crop', c.typeId, c.name)}</option>)}
        </Select>

        <Slider
          label={t('results.yieldPerAcre')}
          shown={`${num(yieldPerAcre)} ${units}`}
          min={50} max={150} value={yieldPct} onChange={setYieldPct}
          lo={`${num(crop.yieldPerAcre * 0.5)}`} hi={`${num(crop.yieldPerAcre * 1.5)}`}
        />
        <Slider
          label={t('results.pricePer', { unit })}
          shown={cents(price)}
          min={60} max={140} value={pricePct} onChange={setPricePct}
          lo={cents(crop.price * 0.6)} hi={cents(crop.price * 1.4)}
        />

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-4 border-t border-line">
          <Fact label={t('results.cropSales', { crop: name })} value={money(trialCrop?.revenue ?? 0)} />
          <Fact label={t('results.cropNet', { crop: name })} value={money(trialCrop?.net ?? 0, { sign: true })} tone={(trialCrop?.net ?? 0) < 0 ? 'loss' : undefined} />
          <Fact label={t('results.farmNet')} value={money(trial.net)} tone={trial.net < 0 ? 'loss' : undefined} />
          <Fact label={t('results.breakEven', { unit })} value={cents(trialCrop?.breakEvenPrice ?? 0)} />
        </div>
        {baseCrop && changed && (
          <p className="text-[14px] text-ink-2">
            {t('results.netMoves', { crop: name, from: money(baseCrop.net, { sign: true }), to: money(trialCrop?.net ?? 0, { sign: true }) })}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={keep} disabled={!changed}>{t('results.keep')}</Button>
          {changed && <Button variant="ghost" onClick={() => { setYieldPct(100); setPricePct(100); }}>{t('results.reset')}</Button>}
        </div>
      </div>
    </section>
  );
}

function Slider({ label, shown, min, max, value, onChange, lo, hi }: { label: string; shown: string; min: number; max: number; value: number; onChange: (n: number) => void; lo: string; hi: string }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-3">
        <span className="font-medium text-[15px]">{label}</span>
        <span className="tnum font-semibold">{shown}</span>
      </div>
      <ShadSlider
        aria-label={label}
        min={min} max={max} step={1} value={[value]}
        onValueChange={(v) => onChange(v[0] ?? value)}
        className="py-2 [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-thumb]]:size-6 [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:border-accent"
      />
      <div className="flex justify-between text-[12px] text-ink-3 tnum mt-1"><span>{lo}</span><span>{hi}</span></div>
    </div>
  );
}

/* ---------- 4. Cash through the year ---------- */

function niceStep(maxAbs: number) {
  const raw = maxAbs / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const m = raw / pow;
  const f = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return f * pow;
}

function CashChart({ plan, result }: { plan: Plan; result: FarmResult }) {
  const { t } = useT();
  const cropName = useCropName(plan);
  const [mode, setMode] = useState<'monthly' | 'cumulative'>('monthly');
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const monthly = result.monthlyCash.length === 12 ? result.monthlyCash : Array<number>(12).fill(0);
  let balance = 0;
  const cumulative = monthly.map(value => (balance += value));
  const data = mode === 'monthly' ? monthly : cumulative;
  const maxAbs = Math.max(1, ...data.map(Math.abs));
  const step = niceStep(maxAbs);
  const top = Math.ceil(maxAbs / step) * step;
  const y = (value: number) => 100 - value / top * 90;
  const included = result.crops.filter(c => c.hasMonths).map(c => cropName(c.cropId, c.name));
  const excluded = result.crops.filter(c => !c.hasMonths).map(c => cropName(c.cropId, c.name));
  const compact = (value: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);

  return (
    <section aria-labelledby="cash-heading">
      <h2 id="cash-heading" className="text-[20px] font-semibold mb-2">{t('results.cash')}</h2>
      <p className="text-[14px] text-ink-2 mb-2">{included.length ? t('chart.included', { crops: included.join(', ') }) : t('results.cash.none')}</p>
      {excluded.length > 0 && <p className="text-[14px] text-ink-2 mb-3">{t('chart.excluded', { crops: excluded.join(', ') })}</p>}
      {included.length > 0 && <>
        <div className="flex flex-wrap gap-2 mt-4 mb-3" role="group" aria-label={t('chart.view')}>
          {(['monthly', 'cumulative'] as const).map(view => <button key={view} type="button" aria-pressed={mode === view} onClick={() => setMode(view)} className={`rounded-lg border px-3 py-2 text-[14px] font-medium ${mode === view ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2'}`}>{t(view === 'monthly' ? 'chart.monthly' : 'chart.cumulative')}</button>)}
        </div>
        <p className="text-[14px] text-ink-2 mb-4">{t(mode === 'monthly' ? 'chart.monthlyHelp' : 'chart.cumulativeHelp')}</p>
        <div className="flex gap-1">
          <div className="relative w-12 shrink-0 h-[200px] text-[11px] text-ink-2 tnum" aria-hidden="true">
            <span className="absolute top-0 right-0">{compact(top)}</span>
            <span className="absolute top-1/2 -translate-y-1/2 right-0">$0</span>
            <span className="absolute bottom-0 right-0">{compact(-top)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <svg viewBox="0 0 1200 200" preserveAspectRatio="none" className="w-full h-[200px] block" role="img" aria-label={t(mode === 'monthly' ? 'chart.monthly' : 'chart.cumulative')}>
              <title>{selectedMonth === null ? t('chart.chooseMonth') : t('chart.selected', { month: t(monthLongKey(selectedMonth)), amount: money(data[selectedMonth]) })}</title>
              {[10, 100, 190].map(pos => <line key={pos} x1="0" x2="1200" y1={pos} y2={pos} stroke="var(--color-line)" />)}
              {selectedMonth !== null && <rect x={selectedMonth * 100} y="0" width="100" height="200" fill="var(--color-accent-soft)" />}
              <line x1="0" x2="1200" y1="100" y2="100" stroke="var(--color-ink-3)" />
              {mode === 'monthly' ? data.map((value, i) => <rect key={i} x={i * 100 + 20} y={Math.min(100, y(value))} width="60" height={Math.max(1, Math.abs(y(value) - 100))} fill={value < 0 ? 'var(--color-loss)' : 'var(--color-gain)'} rx="3" />) : <>
                <polyline points={`0,100 ${data.map((value, i) => `${i * 100 + 50},${y(value)}`).join(' ')}`} fill="none" stroke="var(--color-accent)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                {data.map((value, i) => <line key={i} x1={i * 100 + 50} x2={i * 100 + 50} y1={y(value) - 3} y2={y(value) + 3} stroke="var(--color-accent)" strokeWidth="5" vectorEffect="non-scaling-stroke" />)}
              </>}
            </svg>
            <div className="grid grid-cols-12 mt-2 text-center text-[11px] sm:text-[12px] text-ink-2" aria-hidden="true">
              {data.map((_, i) => <span key={i} className={selectedMonth === i ? 'font-bold text-accent' : ''}>{t(monthKey(i))}</span>)}
            </div>
          </div>
        </div>
        <div className="mt-5 rounded-xl border border-line bg-ground p-3 sm:p-4 grid gap-3 sm:grid-cols-[240px_1fr] sm:items-end">
          <div className="space-y-1.5"><label htmlFor="cash-month" className="text-sm font-medium">{t('chart.inspectMonth')}</label>
            <select id="cash-month" value={selectedMonth ?? ''} onChange={e => setSelectedMonth(e.target.value === '' ? null : Number(e.target.value))} className="block w-full h-12 rounded-lg border border-line-strong bg-ground px-3 text-base text-ink">
              <option value="">{t('chart.selectMonth')}</option>
              {data.map((_, i) => <option key={i} value={i}>{t(monthLongKey(i))}</option>)}
            </select>
          </div>
          <p className="font-semibold tnum sm:pb-3" aria-live="polite">{selectedMonth === null ? t('chart.chooseMonth') : t('chart.selected', { month: t(monthLongKey(selectedMonth)), amount: money(data[selectedMonth], { sign: true }) })}</p>
        </div>
        <p className="mt-2 text-[14px] text-ink-2">{t('chart.lowest', { month: t(monthLongKey(result.lowestCashPoint.month)), amount: money(result.lowestCashPoint.cumulative) })}</p>
      </>}
      <p className="mt-4 text-[13px] text-ink-2 leading-relaxed">{t('chart.assumptions')}</p>
    </section>
  );
}

/* ---------- 5. What your machines cost per hour ---------- */

function Machines({ plan, result }: { plan: Plan; result: FarmResult }) {
  const { t } = useT();
  const typeName = useTypeName();
  const cropName = useCropName(plan);
  if (result.machines.length === 0) return null;
  const rows = [...result.machines].sort((a, b) => b.ownPerYear - a.ownPerYear);
  const machineName = (id: string, fallback: string) => {
    const e = plan.equipment.find(x => x.id === id);
    return e ? typeName('equipment', e.typeId, e.name) : fallback;
  };
  return (
    <section>
      <div className="sm:hidden divide-y divide-line border-t border-line">
        {rows.map(m => {
          const top = [...m.byCrop].filter(b => b.hours > 0).sort((a, b) => b.hours - a.hours).slice(0, 2);
          return (
            <div key={m.equipmentId} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-medium min-w-0 truncate">{machineName(m.equipmentId, m.name)}</div>
                {m.hoursPerYear > 0
                  ? <div className="text-[17px] font-semibold tnum text-loss whitespace-nowrap">{negCents(m.allInPerHour)} <span className="text-[13px] font-normal text-ink-2">{t('results.perHourShort')}</span></div>
                  : <div className="text-[13px] text-ink-2">{t('results.notTracked')}</div>}
              </div>
              <div className="text-[13px] text-ink-2 mt-0.5">
                <span className="text-loss tnum">{t('results.aYearToOwn', { amount: money(-m.ownPerYear) })}</span>
                {m.hoursPerYear > 0 && <span>, {num(m.hoursPerYear)} {t('results.hoursAYear').toLowerCase()}</span>}
              </div>
              <div className="text-[13px] text-ink-2">{top.length === 0 ? t('results.sharedByAcres') : top.map(b => `${cropName(b.cropId, b.name)} ${Math.round(b.share * 100)}%`).join(', ')}</div>
            </div>
          );
        })}
      </div>
      <div className="hidden sm:block overflow-x-auto -mx-4 px-4">
        <Table className="text-[15px]">
          <TableHeader>
            <TableRow className="text-ink-2">
              <TableHead className="pl-0">{t('results.machine')}</TableHead>
              <TableHead className="text-right">{t('results.hoursAYear')}</TableHead>
              <TableHead className="text-right">{t('results.owning')}</TableHead>
              <TableHead className="text-right">{t('results.running')}</TableHead>
              <TableHead className="text-right">{t('results.allIn')}</TableHead>
              <TableHead>{t('results.mostlyUsedOn')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(m => {
              const top = [...m.byCrop].filter(b => b.hours > 0).sort((a, b) => b.hours - a.hours).slice(0, 2);
              const unclaimed = m.hoursPerYear - m.hoursAssigned;
              return (
                <TableRow key={m.equipmentId} className="align-top">
                  <TableCell className="pl-0 py-2.5">
                    <div className="font-medium">{machineName(m.equipmentId, m.name)}</div>
                    <div className="text-[13px] text-loss tnum">{t('results.aYearToOwn', { amount: money(-m.ownPerYear) })}</div>
                  </TableCell>
                  {m.hoursPerYear > 0 ? (
                    <>
                      <TableCell className="py-2.5 text-right tnum">
                        {num(m.hoursPerYear)}
                        {unclaimed > 0.5 && <div className="text-[12px] text-ink-2">{t('results.notOnCrop', { hours: num(unclaimed) })}</div>}
                      </TableCell>
                      <TableCell className="py-2.5 text-right tnum text-loss">{negCents(m.ownPerHour)}</TableCell>
                      <TableCell className="py-2.5 text-right tnum text-loss">{negCents(m.runPerHour)}</TableCell>
                      <TableCell className="py-2.5 text-right tnum font-semibold text-loss">{negCents(m.allInPerHour)}</TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={4} className="py-2.5 text-ink-2 text-right">{t('results.notTracked')}</TableCell>
                  )}
                  <TableCell className="py-2.5 text-ink-2 whitespace-normal min-w-[180px]">
                    {top.length === 0 ? t('results.sharedByAcres') : top.map(b => `${cropName(b.cropId, b.name)} ${Math.round(b.share * 100)}%`).join(', ')}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
