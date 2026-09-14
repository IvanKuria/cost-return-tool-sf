import fs from 'node:fs';
import path from 'node:path';

export interface ManifestEntry { commodity: string; title: string; context: string; url: string; indexPage: string }

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const DIR = path.join(ROOT, 'data/studies');
export const PDF_DIR = path.join(DIR, 'pdf');
export const TEXT_DIR = path.join(DIR, 'text');
export const PARSED_DIR = path.join(DIR, 'parsed');

/** The index page repeats a PDF link several times per row; one entry per PDF URL. */
export function loadManifest(): ManifestEntry[] {
  const raw: ManifestEntry[] = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest-current.json'), 'utf8'));
  const seen = new Set<string>();
  return raw.filter(e => (seen.has(e.url) ? false : (seen.add(e.url), true)));
}

/** Stable slug per study: commodity + pdf basename, so two studies of one crop never collide. */
export function slugOf(e: ManifestEntry): string {
  const base = decodeURIComponent(e.url.split('/').pop() || '').replace(/\.pdf$/i, '');
  return `${e.commodity}__${base}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
