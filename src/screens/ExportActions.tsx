import { useState } from 'react';
import type { FarmResult, Plan } from '../lib/types';
import { useT } from '../i18n';
import { Button } from '../ui';
import { createExportSnapshot, exportFilename } from '../lib/exportData';

export function ExportActions({ plan, result }: { plan: Plan; result: FarmResult }) {
  const { t, lang } = useT();
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const [status, setStatus] = useState<'error' | 'done' | null>(null);
  const save = async (kind: 'pdf' | 'xlsx') => {
    if (busy) return;
    setBusy(kind); setStatus(null);
    // Capture before loading libraries so a download always describes the click-time plan.
    try {
      const snapshot = createExportSnapshot(plan, result, lang);
      const { buildPdf, buildWorkbook, downloadExport } = await import('../lib/exportFiles');
      const bytes = await (kind === 'pdf' ? buildPdf(snapshot) : buildWorkbook(snapshot));
      downloadExport(bytes, exportFilename(snapshot.title, kind, new Date(snapshot.created)), kind);
      setStatus('done');
    } catch { setStatus('error'); }
    finally { setBusy(null); }
  };
  return <section aria-labelledby="export-heading">
    <h2 id="export-heading" className="text-[20px] font-semibold mb-3">{t('export.title')}</h2>
    <p className="text-sm text-ink-2 mb-4">{t('export.snapshot')}</p>
    <div className="flex flex-wrap gap-3" aria-busy={busy !== null}>
      <Button variant="secondary" disabled={busy !== null} onClick={() => void save('pdf')}>{busy === 'pdf' ? t('export.busy') : t('export.pdf')}</Button>
      <Button variant="secondary" disabled={busy !== null} onClick={() => void save('xlsx')}>{busy === 'xlsx' ? t('export.busy') : t('export.xlsx')}</Button>
    </div>
    <p className="mt-3 text-sm text-ink-2">{t('export.local')}</p>
    {status && <p role={status === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${status === 'error' ? 'text-loss' : 'text-ink-2'}`}>{t(status === 'error' ? 'export.error' : 'export.done')}</p>}
  </section>;
}
