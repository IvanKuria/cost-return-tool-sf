import fs from 'node:fs';
import path from 'node:path';

export interface ManifestEntry { commodity: string; title: string; context: string; url: string; indexPage: string; year?: number | null; archived?: boolean }

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const DIR = path.join(ROOT, 'data/studies');
export const PDF_DIR = path.join(DIR, 'pdf');
export const TEXT_DIR = path.join(DIR, 'text');
export const PARSED_DIR = path.join(DIR, 'parsed');

/** Current and archived index pages; the index repeats a PDF link several times per row, so one entry per PDF URL, current first. */
export function loadManifest(): ManifestEntry[] {
  const read = (name: string, archived: boolean): ManifestEntry[] => {
    const file = path.join(DIR, name);
    if (!fs.existsSync(file)) return [];
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as ManifestEntry[]).map(e => ({ ...e, archived: e.archived ?? archived }));
  };
  const raw = [...read('manifest-current.json', false), ...read('manifest-archived.json', true)];
  const seen = new Set<string>();
  return raw.filter(e => (seen.has(e.url) ? false : (seen.add(e.url), true)));
}

/** Stable slug per study: commodity + pdf basename, so two studies of one crop never collide. */
export function slugOf(e: ManifestEntry): string {
  const base = decodeURIComponent(e.url.split('/').pop() || '').replace(/\.pdf$/i, '');
  return `${e.commodity}__${base}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
