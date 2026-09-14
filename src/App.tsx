import { STEPS, usePlanStore, DEFAULT_FARM, type Step } from './lib/store';
import { computePlan } from './lib/engine';
import { missingPlanInputs } from './lib/inputs';
import { money } from './ui';
import { Button as ShadButton } from '@/components/ui/button';
import { FarmScreen } from './screens/FarmScreen';
import { CropsScreen } from './screens/CropsScreen';
import { EquipmentScreen } from './screens/EquipmentScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { SourcesScreen } from './screens/SourcesScreen';
import { SAMPLE_PLAN } from './data/sample';
import { useT, type Lang } from './i18n';
import type { Key } from './i18n/en';

const STEP_KEY: Record<Step, Key> = { farm: 'step.farm', crops: 'step.crops', equipment: 'step.equipment', results: 'step.results', sources: 'app.sources' };

export default function App() {
  const { t, lang, setLang } = useT();
  const [state, dispatch] = usePlanStore({ step: window.location.hash === '#results' ? 'results' : 'farm', plan: SAMPLE_PLAN ?? { farm: DEFAULT_FARM, crops: [], equipment: [] } });
  const result = computePlan(state.plan);
  const incomplete = missingPlanInputs(state.plan).length > 0;
  const idx = STEPS.findIndex(s => s.id === state.step);
  const go = (step: Step) => { window.history.replaceState(null, '', `#${step}`); dispatch({ type: 'go', step }); window.scrollTo({ top: 0 }); };
  const label = (step: Step) => t(STEP_KEY[step]);

  const screen = {
    farm: <FarmScreen plan={state.plan} dispatch={dispatch} />,
    crops: <CropsScreen key={state.editId ?? 'crops'} editId={state.editId} plan={state.plan} dispatch={dispatch} result={result} />,
    equipment: <EquipmentScreen key={state.editId ?? 'equipment'} editId={state.editId} plan={state.plan} dispatch={dispatch} result={result} />,
    sources: <SourcesScreen plan={state.plan} dispatch={dispatch} />,
    results: <ResultsScreen plan={state.plan} dispatch={dispatch} result={result} />,
  }[state.step];

  const langButton = (l: Lang, key: Key) => (
    <ShadButton
      key={l}
      type="button"
      variant="ghost"
      aria-pressed={lang === l}
      onClick={() => setLang(l)}
      className={`h-11 md:h-8 px-2 md:px-2.5 rounded-full text-[13px] font-medium ${lang === l ? 'bg-well text-ink' : 'text-ink-2'}`}
    >
      {t(key)}
    </ShadButton>
  );

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 bg-ground border-b border-line">
        <div className="mx-auto max-w-[1040px] px-4 h-14 flex items-center gap-3 md:gap-4">
          <div className="font-bold text-[15px] md:text-[16px] tracking-tight leading-tight whitespace-nowrap min-w-0 truncate flex-1 md:flex-none">{t('app.title')}</div>
          <nav className="hidden md:flex items-center gap-0.5 ml-2 lg:ml-6" aria-label={t('app.steps')}>
            {STEPS.map((s, i) => (
              <button key={s.id} onClick={() => go(s.id)}
                className={`h-9 px-2.5 lg:px-3 rounded-full text-[13px] lg:text-[14px] font-medium whitespace-nowrap transition-colors ${state.step === s.id ? 'bg-ink text-white' : i < idx ? 'text-ink hover:bg-well' : 'text-ink-2 hover:bg-well'}`}>
                {i + 1}. {label(s.id)}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1 md:gap-4 flex-none">
            <div className="flex items-center" role="group" aria-label={t('app.language')}>
              {langButton('en', 'app.lang.en')}
              {langButton('es', 'app.lang.es')}
            </div>
            <div className="text-right leading-tight">
              <div className="hidden sm:block text-[11px] md:text-[12px] text-ink-2 whitespace-nowrap">{t(incomplete ? 'inputs.provisional' : 'app.netSoFar')}</div>
              <div aria-label={incomplete ? t('inputs.provisional') : undefined} className={`text-[16px] md:text-[17px] font-semibold tnum ${result.net < 0 ? 'text-loss' : 'text-ink'}`}>{money(result.net)}</div>
            </div>
          </div>
        </div>
        <nav className="md:hidden flex border-t border-line" aria-label={t('app.steps')}>
          {STEPS.map((s, i) => (
            <button key={s.id} onClick={() => go(s.id)} className={`flex-1 h-10 px-1 text-[12px] font-medium border-b-2 whitespace-nowrap ${state.step === s.id ? 'border-accent text-ink' : 'border-transparent text-ink-2'}`}>{i + 1}. {label(s.id)}</button>
          ))}
        </nav>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-[1040px] px-4 pt-3 text-right"><button className="text-accent underline text-sm" onClick={() => go('sources')}>{t('app.sources')}</button></div>
        <div className="mx-auto max-w-[1040px] px-4 py-8 pb-32">{screen}</div>
      </main>

      {idx >= 0 && state.step !== 'results' && (
        <footer className="fixed bottom-0 inset-x-0 z-20 bg-ground/95 backdrop-blur border-t border-line">
          <div className="mx-auto max-w-[1040px] px-4 h-[72px] flex items-center gap-3">
            {idx > 0 && <button onClick={() => go(STEPS[idx - 1].id)} className="h-12 px-4 rounded-[var(--radius-ctl)] text-ink-2 font-medium hover:bg-well">{t('app.back')}</button>}
            <button onClick={() => go(STEPS[idx + 1].id)} className="ml-auto h-12 px-6 rounded-[var(--radius-ctl)] bg-accent text-white font-semibold hover:bg-accent-deep">
              {idx === STEPS.length - 2 ? t('app.seeResults') : t('app.next', { step: label(STEPS[idx + 1].id) })}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
