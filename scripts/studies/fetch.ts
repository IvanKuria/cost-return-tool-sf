// Downloads every study PDF and extracts its text with pdftotext -layout.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { loadManifest, slugOf, PDF_DIR, TEXT_DIR } from './manifest';

const PDFTOTEXT = '/opt/homebrew/bin/pdftotext';
const CONCURRENCY = 8;

fs.mkdirSync(PDF_DIR, { recursive: true });
fs.mkdirSync(TEXT_DIR, { recursive: true });

async function download(url: string, dest: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync('curl', ['-sSL', '--fail', '--retry', '1', '-o', dest, url], { encoding: 'utf8' });
    if (r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 1000) return;
    if (attempt === 3) throw new Error(`download failed after 3 tries: ${url}\n${r.stderr}`);
  }
}

async function main() {
  const entries = loadManifest();
  let done = 0; const failed: string[] = [];
  const queue = [...entries];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const e = queue.shift()!;
      const slug = slugOf(e);
      const pdf = path.join(PDF_DIR, `${slug}.pdf`);
      const txt = path.join(TEXT_DIR, `${slug}.txt`);
      try {
        if (!fs.existsSync(pdf)) await download(e.url, pdf);
        if (!fs.existsSync(txt)) execFileSync(PDFTOTEXT, ['-layout', pdf, txt]);
        done++;
      } catch (err) {
        failed.push(`${slug}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  });
  await Promise.all(workers);
  console.log(`fetched ${done}/${entries.length}`);
  if (failed.length) { console.log('failed:'); failed.forEach(f => console.log('  ' + f)); }
}
main();
