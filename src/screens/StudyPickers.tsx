import { useState } from 'react';
import { commoditiesWithData, equipmentCatalog, studyById, type CatalogEntry, type CatalogRow, type CommodityEntry } from '../data/studies';
import type { ParsedStudy } from '../data/studySchema';
import { countyMentioned, EQUIPMENT_CATEGORIES, equipmentCategory, equipmentDisplayName, filterStudies, productionMethod, UNKNOWN, type EquipmentCategory, type StudyFilters } from '../data/studyPicker';
import { useT, useTypeName } from '../i18n';
import { Button, Card, Field, Input, money } from '../ui';

const selectClass = 'w-full min-w-0 rounded-[var(--radius-ctl)] border border-line bg-white px-3 py-2.5 text-[15px]';

function StudyMetadata({ study }: { study?: ParsedStudy }) {
  const { t } = useT();
  return <dl className="mt-2 space-y-1 text-sm text-ink-2">
    <div><dt className="inline font-medium">{t('picker.year')}: </dt><dd className="inline">{study?.source.year ?? t('picker.unknown')}</dd></div>
    <div><dt className="inline font-medium">{t('picker.region')}: </dt><dd className="inline">{study?.source.region?.trim() || t('picker.unknown')}</dd></div>
    <div><dt className="inline font-medium">{t('picker.method')}: </dt><dd className="inline">{t(`picker.method.${study ? productionMethod(study) : 'unknown'}`)}</dd></div>
  </dl>;
}

export function CropStudyPicker({ county, onPick, onCancel }: { county: string; onPick: (study: ParsedStudy) => void; onCancel: () => void }) {
  const { t } = useT();
  const typeName = useTypeName();
  const [query, setQuery] = useState('');
  const [commodity, setCommodity] = useState<CommodityEntry | null>(null);
  const [filters, setFilters] = useState<StudyFilters>({ sort: 'newest' });
  const crops = commoditiesWithData().filter(c => `${c.name} ${typeName('crop', c.id, c.name)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const studies = filterStudies(commodity?.studies ?? [], { ...filters, county });
  const regions = [...new Set(commodity?.studies.map(s => s.source.region?.trim() || UNKNOWN))].sort();
  const years = [...new Set(commodity?.studies.map(s => String(s.source.year ?? UNKNOWN)))].sort((a, b) => (Number(b) || 0) - (Number(a) || 0));
  const methods = [...new Set(commodity?.studies.map(productionMethod))].sort();
  return <Card className="p-4 space-y-4 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t(commodity ? 'crops.whichStudy' : 'crops.which')}</h2><Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button></div>
    <p className="text-sm text-ink-2">{t('picker.optional')}</p>
    {!commodity ? <>
      <Field label={t('picker.cropSearch')}><Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('crops.search')} autoFocus /></Field>
      <p className="text-sm text-ink-2" role="status">{t('picker.cropCount', { n: crops.length })}</p>
      <div className="max-h-[400px] overflow-y-auto divide-y divide-line">{crops.map(c => <button key={c.id} onClick={() => { setCommodity(c); setFilters({ sort: 'newest' }); }} className="flex w-full justify-between gap-3 text-left p-3 hover:bg-well"><span>{typeName('crop', c.id, c.name)}</span><span className="text-sm text-ink-2 shrink-0">{t('crops.studyCount', { n: c.studies.length })}</span></button>)}</div>
      {!crops.length && <div className="space-y-2"><p>{t('picker.empty')}</p><Button onClick={() => setQuery('')}>{t('picker.reset')}</Button></div>}
    </> : <>
      <Button onClick={() => setCommodity(null)}>{t('picker.changeCrop')}</Button>
      <h3 className="font-semibold">{typeName('crop', commodity.id, commodity.name)}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('picker.region')}><select className={selectClass} value={filters.region ?? ''} onChange={e => setFilters({ ...filters, region: e.target.value })}><option value="">{t('picker.allRegions')}</option>{regions.map(r => <option key={r} value={r}>{r === UNKNOWN ? t('picker.unknown') : r}</option>)}</select></Field>
        <Field label={t('picker.year')}><select className={selectClass} value={filters.year ?? ''} onChange={e => setFilters({ ...filters, year: e.target.value })}><option value="">{t('picker.allYears')}</option>{years.map(y => <option key={y} value={y}>{y === UNKNOWN ? t('picker.unknown') : y}</option>)}</select></Field>
        <Field label={t('picker.method')}><select className={selectClass} value={filters.method ?? ''} onChange={e => setFilters({ ...filters, method: e.target.value })}><option value="">{t('picker.allMethods')}</option>{methods.map(m => <option key={m} value={m}>{t(`picker.method.${m}`)}</option>)}</select></Field>
        <Field label={t('picker.sort')}><select className={selectClass} value={filters.sort} onChange={e => setFilters({ ...filters, sort: e.target.value as StudyFilters['sort'] })}><option value="newest">{t('picker.newest')}</option>{county.trim() && <option value="county">{t('picker.countyFirst', { county })}</option>}</select></Field>
      </div>
      {filters.sort === 'county' && <p className="text-sm text-ink-2">{t('picker.countyHint')}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-ink-2" role="status">{t('crops.studyCount', { n: studies.length })}</p><Button variant="ghost" onClick={() => setFilters({ sort: 'newest' })}>{t('picker.reset')}</Button></div>
      <div className="max-h-[520px] overflow-y-auto divide-y divide-line">{studies.map(s => <button key={s.source.id} onClick={() => onPick(s)} className="block w-full text-left p-3 hover:bg-well break-words"><span className="block font-medium">{s.source.description || s.source.title}</span><StudyMetadata study={s} />{filters.sort === 'county' && countyMentioned(s, county) && <span className="block mt-2 text-sm text-accent">{t('picker.countyMention', { county })}</span>}<span className="block mt-2 font-medium text-accent text-sm">{t('picker.chooseStudy')}</span></button>)}</div>
      {!studies.length && <p>{t('picker.empty')}</p>}
    </>}
  </Card>;
}

export function EquipmentStudyPicker({ onPick, onCancel }: { county?: string; onPick: (entry: CatalogEntry, pick?: CatalogRow) => void; onCancel: () => void }) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<EquipmentCategory | ''>('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const catalog = equipmentCatalog();
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const entries = catalog.filter(e => {
    const group = equipmentCategory(e.name);
    const searchable = `${e.name} ${equipmentDisplayName(e.name)} ${t(`picker.category.${group}`)}`.toLowerCase();
    return (!category || category === group) && terms.every(term => searchable.includes(term));
  });
  const reset = () => { setQuery(''); setCategory(''); setExpanded(null); };
  return <Card className="p-4 space-y-4 min-w-0">
    <div className="flex flex-wrap justify-between items-center gap-2"><h2 className="font-semibold">{t('equip.what')}</h2><Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button></div>
    <p className="text-sm text-ink-2">{t('picker.optional')}</p>
    <Field label={t('picker.equipmentSearch')}><Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('equip.search')} autoFocus /></Field>
    <Field label={t('picker.category')} hint={t('picker.categoryHint')}><select className={selectClass} value={category} onChange={e => setCategory(e.target.value as EquipmentCategory | '')}><option value="">{t('picker.allCategories')}</option>{EQUIPMENT_CATEGORIES.map(c => <option key={c} value={c}>{t(`picker.category.${c}`)} ({catalog.filter(e => equipmentCategory(e.name) === c).length})</option>)}</select></Field>
    <div className="flex flex-wrap justify-between items-center gap-2"><p className="text-sm text-ink-2" role="status">{t('picker.equipmentCount', { n: entries.length })}</p><Button variant="ghost" onClick={reset}>{t('picker.reset')}</Button></div>
    <div className="max-h-[520px] overflow-y-auto divide-y divide-line">{entries.map(entry => <div key={entry.key} className="py-2">
      <button className="block w-full p-3 text-left hover:bg-well break-words" aria-expanded={expanded === entry.key} onClick={() => setExpanded(expanded === entry.key ? null : entry.key)}><span className="block font-medium">{equipmentDisplayName(entry.name)}</span><span className="block text-sm text-ink-2 mt-1">{t(`picker.category.${equipmentCategory(entry.name)}`)}</span><span className="block mt-1 text-sm text-accent">{t(expanded === entry.key ? 'picker.hideRows' : 'picker.showRows', { n: entry.count })}</span></button>
      {expanded === entry.key && <div className="ml-2 border-l-2 border-line pl-3 space-y-3">{entry.rows.map((row, i) => {
        const study = studyById(row.studyId);
        return <div key={`${row.studyId}-${row.kind}-${i}`} className="py-3 break-words"><p className="font-medium text-sm">{study?.source.description || study?.source.title || t('picker.unknown')}</p><StudyMetadata study={study} /><p className="mt-2 text-sm">{t('picker.studyPrice', { price: money(row.row.price) })}</p><p className="mt-1 text-xs text-ink-2">{row.row.description}</p><Button className="mt-2 h-auto min-h-10 whitespace-normal" onClick={() => onPick(entry, row)}>{t('picker.chooseStudy')}</Button></div>;
      })}</div>}
    </div>)}</div>
    {!entries.length && <p>{t('picker.empty')}</p>}
  </Card>;
}
