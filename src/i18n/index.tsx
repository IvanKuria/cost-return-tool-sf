import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { en, type Key } from './en';
import { es } from './es';
import { cropNames } from './names';

export type Lang = 'en' | 'es';
const DICT: Record<Lang, Record<Key, string>> = { en, es };
const STORAGE = 'farm-cost-planner.lang';

type Vars = Record<string, string | number>;

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Vars) => string;
}

const Ctx = createContext<I18n | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved === 'en' || saved === 'es') return saved;
  } catch { /* ignore */ }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function fill(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE, l); } catch { /* ignore */ }
    document.documentElement.lang = l;
  }, []);
  const t = useCallback((key: Key, vars?: Vars) => fill(DICT[lang][key] ?? en[key], vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useT must be used inside I18nProvider');
  return v;
}

/**
 * Name of a crop (by commodity id) or a machine in the current language. Crops have Spanish
 * names; machines keep the description printed in the study, since that is what the citation shows.
 */
export function useTypeName() {
  const { lang } = useT();
  return useCallback((kind: 'crop' | 'equipment', typeId: string, englishName: string) => {
    if (lang === 'en' || kind === 'equipment') return englishName;
    return cropNames[typeId] ?? englishName;
  }, [lang]);
}

/** Unit word (tray, carton, ton...) in the current language, singular or plural. */
export function useUnit() {
  const { t } = useT();
  return useCallback((unit: string, plural = false) => {
    const key = (plural ? unitPluralKey(unit) : `unit.${unit}`) as Key;
    return key in en ? t(key) : plural ? englishPlural(unit) : unit;
  }, [t]);
}

function unitPluralKey(unit: string) {
  if (unit === 'lb' || unit === 'lbs') return 'unit.lbs';
  if (unit === 'bunch') return 'unit.bunches';
  if (unit === 'box') return 'unit.boxes';
  return `unit.${unit}s`;
}

function englishPlural(unit: string) {
  if (unit === 'lb' || unit === 'lbs') return 'lb';
  if (unit.endsWith('s')) return unit;
  if (unit.endsWith('h') || unit.endsWith('x')) return unit + 'es';
  return unit + 's';
}
