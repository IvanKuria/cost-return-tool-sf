import { useState } from 'react';
import type { FarmResult, Plan } from '../lib/types';
import { useT } from '../i18n';
import { Button } from '../ui';
import { createExportSnapshot, exportFilename } from '../lib/exportData';

type Kind = 'pdf' | 'xlsx' | 'csv';

export function ExportActions({ plan, result }: { plan: Plan; result: FarmResult }) {
  const { t, lang } = useT();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [status, setStatus] = useState<'error' | 'done' | null>(null);
  const save = async (kind: Kind) => {
    if (busy) return;
    setBusy(kind); setStatus(null);
    // Capture before loading libraries so a download always describes the click-time plan.
    try {
      const snapshot = createExportSnapshot(plan, result, lang);
      const { buildPdf, buildWorkbook, buildCashFlowCsv, downloadExport } = await import('../lib/exportFiles');
      const bytes = kind === 'pdf' ? await buildPdf(snapshot) : kind === 'xlsx' ? await buildWorkbook(snapshot) : buildCashFlowCsv(snapshot);
      downloadExport(bytes, exportFilename(snapshot.title, kind, new Date(snapshot.created)), kind);
      setStatus('done');
    } catch { setStatus('error'); }
    finally { setBusy(null); }
  };
  const label = (kind: Kind, key: 'export.pdf' | 'export.xlsx' | 'export.csv') => busy === kind ? t('export.busy') : t(key);
  return <section aria-labelledby="export-heading">
    <h2 id="export-heading" className="text-[20px] font-semibold mb-3">{t('export.title')}</h2>
    <p className="text-sm text-ink-2 mb-4">{t('export.snapshot')}</p>
    <div className="flex flex-wrap gap-3" aria-busy={busy !== null}>
      <Button variant="secondary" disabled={busy !== null} onClick={() => void save('pdf')}>{label('pdf', 'export.pdf')}</Button>
      <Button variant="secondary" disabled={busy !== null} onClick={() => void save('xlsx')}>{label('xlsx', 'export.xlsx')}</Button>
      <Button variant="secondary" disabled={busy !== null} onClick={() => void save('csv')}>{label('csv', 'export.csv')}</Button>
    </div>
    <p className="mt-3 text-sm text-ink-2">{t('export.local')}</p>
    {status && <p role={status === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${status === 'error' ? 'text-loss' : 'text-ink-2'}`}>{t(status === 'error' ? 'export.error' : 'export.done')}</p>}
  </section>;
}
