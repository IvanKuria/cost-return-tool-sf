// Parses pdftotext -layout output of UC Davis cost studies into cited values.
// Rule: a value is either backed by the exact line it came from, or it is null.
import fs from 'node:fs';
import path from 'node:path';
import { loadManifest, slugOf, TEXT_DIR, PARSED_DIR, type ManifestEntry } from './manifest';
import type {
  Assumptions, BusinessOverheadRow, Cited, CostsPerAcre, EquipmentRow, Establishment, EstablishmentSource, EstablishmentSummary, EstablishmentTable, EstablishmentTableRow, EstablishmentYear, HourlyEquipmentRow, Method, MonthlyCosts,
  OperationCategory, OperationRow, ParsedStudy, Quote, StudySource,
} from './types';

const PUBLISHER = 'UC Davis Department of Agricultural and Resource Economics / UC Cooperative Extension';

interface Line { text: string; page: number; index: number }

const NUM = String.raw`-?\(?\$?[\d,]+(?:\.\d+)?\)?`;
const toNum = (s: string | undefined): number | null => {
  if (s == null) return null;
  const t = s.replace(/[$,()\s]/g, '');
  if (t === '' || t === '-' || t === '—') return null;
  const n = Number(t);
  return Number.isFinite(n) ? (s.includes('(') ? -n : n) : null;
};
const zeroDash = (s: string | undefined): number | null => (s === '-' || s === '—' ? 0 : toNum(s));
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/\bper cent\b/gi, 'percent').trim();

function pagesToLines(text: string): Line[] {
  const out: Line[] = [];
  let index = 0;
  text.split('\f').forEach((pageText, i) => {
    for (const raw of pageText.split('\n')) out.push({ text: raw.replace(/\s+$/, ''), page: i + 1, index: index++ });
  });
  return out;
}

const cite = (l: Line, value: number, unit: string | null = null): Cited => ({ value, unit, page: l.page, quote: clean(l.text) });

type TableKind = 'establish' | 'costs' | 'returns' | 'monthly' | 'ranging' | 'equipment' | 'hourly' | 'operations' | 'other';
interface TableHeading { kind: TableKind; number: number; title: string; index: number; page: number }

function kindOf(title: string): TableKind {
  const t = title.toUpperCase();
  if (/HOURLY EQUIPMENT/.test(t)) return 'hourly';
  if (/OPERATIONS WITH EQUIPMENT/.test(t)) return 'operations';
  if (/WHOLE\s*FARM|EQUIPMENT\s*COSTS|EQUIPMENT.*(INVESTMENT|OVERHEAD)|INVESTMENT.*OVERHEAD/.test(t)) return 'equipment';
  if (/RANGING|RANGE ANALYSIS|AN[ÁA]LISIS DE RANGO/.test(t)) return 'ranging';
  if (/MATERIAL|INPUT COSTS|SUMMARY/.test(t)) return 'other';
  if (/MONTH?LY|MENSUAL/.test(t)) return 'monthly';      // 'MONTLY' is a typo in one study
  // "ESTABLISHMENT AND CULTURAL OPERATING COSTS PER ACRE" (cover crops) is the one-year operations table, not an establishment table
  if (/ESTABLISHMENT AND CULTURAL OPERATING COSTS/.test(t)) return 'costs';
  if (/ESTABLISH|DEVELOP/.test(t)) return 'establish';
  if (/COSTS?\s+AND\s+RETURNS|RETURNS\s+(AND|&)\s+COSTS/.test(t)) return 'returns';
  if (/COSTOS\s+Y\s+(RETORNOS|GANANCIAS)/.test(t)) return 'returns';
  if (/COSTS?\s+PER\s+ACRE|COSTS?\s+TO\s+(PRODUCE|GROW)|PRODUCTION COSTS|COSTOS\s+POR\s+ACRE/.test(t)) return 'costs';
  return 'other';
}

/** Body table headings (the table of contents repeats them, so a heading followed closely by another heading is TOC). */
function findTables(lines: Line[]): TableHeading[] {
  const re = /^\s*(?:TABL[EA]|TAHLE|CUADRO)\s*(\d+)(?:[-\s]?[A-Z])?\.?\s+(\S.*?)\s*$/i;
  const cands: { n: number; title: string; index: number; page: number }[] = [];
  for (const l of lines) {
    const m = l.text.match(re);
    if (!m) continue;
    if (/…|\.{4,}/.test(m[2])) continue;                 // dotted leaders
    if (/[A-Z)]\.\d{1,3}\s*$/.test(m[2])) continue;          // a TOC line whose leader is a single dot: "... OVERHEAD COSTS.18"
    if (/^[a-z]/.test(m[2])) continue;                    // a prose line that starts with "Table 1 represents ..."
    if (/^CONTINU(?:ED|ADO|ACI[ÓO]N)/i.test(m[2]) || /CONTINU(?:ED|ADO|ACI[ÓO]N)\)?\s*$/i.test(m[2])) continue;
    cands.push({ n: Number(m[1]), title: m[2].replace(/\s+\d{1,3}\s*$/, ''), index: l.index, page: l.page });
  }
  // TOC block: candidate whose neighbour candidate is within 3 lines
  const isToc = (i: number) => (i > 0 && cands[i].index - cands[i - 1].index <= 3) || (i + 1 < cands.length && cands[i + 1].index - cands[i].index <= 3);
  return cands.filter((_, i) => !isToc(i)).map(c => ({ kind: kindOf(c.title), number: c.n, title: clean(c.title), index: c.index, page: c.page }));
}

function spanOf(lines: Line[], tables: TableHeading[], t: TableHeading): [number, number] {
  const next = tables.find(x => x.index > t.index);
  return [t.index, next ? next.index : lines.length];
}

/** Find the first line matching `re`; returns the line and the match. */
function find(lines: Line[], re: RegExp, from = 0, to = lines.length): { line: Line; m: RegExpMatchArray } | null {
  for (let i = from; i < to; i++) {
    const m = lines[i].text.match(re);
    if (m) return { line: lines[i], m };
  }
  return null;
}
function findAll(lines: Line[], re: RegExp, from = 0, to = lines.length) {
  const out: { line: Line; m: RegExpMatchArray }[] = [];
  for (let i = from; i < to; i++) { const m = lines[i].text.match(re); if (m) out.push({ line: lines[i], m }); }
  return out;
}

/** Sentences of the prose part of the study (before the first table), joined across line breaks. */
function proseSentences(lines: Line[]): { text: string; page: number }[] {
  const tables = findTables(lines);
  const end = tables.length ? tables[0].index : lines.length;
  const out: { text: string; page: number }[] = [];
  let buf = ''; let page = 1;
  for (let i = 0; i < end; i++) {
    const t = lines[i].text.trim();
    if (!t) { if (buf) { out.push({ text: buf, page }); buf = ''; } continue; }
    if (!buf) page = lines[i].page;
    buf = buf ? buf + ' ' + t : t;
  }
  if (buf) out.push({ text: buf, page });
  // split paragraphs into sentences
  const sentences: { text: string; page: number }[] = [];
  for (const p of out) for (const s of p.text.split(/(?<=[.!?])\s+(?=[A-Z$(])/)) sentences.push({ text: clean(s), page: p.page });
  return sentences;
}

/** Sentences of the whole study, every page (the assumptions can run past the first table heading, and Spanish
 *  studies print them after the tables). Paragraphs are split at blank lines and at page breaks. */
function allSentences(lines: Line[]): { text: string; page: number }[] {
  const out: { text: string; page: number }[] = [];
  let buf = ''; let page = 1;
  const flush = () => { if (buf) for (const s of buf.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ$(])/)) out.push({ text: clean(s), page }); buf = ''; };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text.trim();
    if (!t || (i > 0 && lines[i - 1].page !== lines[i].page)) flush();
    if (!t) continue;
    if (!buf) page = lines[i].page;
    buf = buf ? buf + ' ' + t : t;
  }
  flush();
  return out;
}

/** The long-term (capital recovery) interest rate as the study states it; never the operating loan rate. */
function capitalRecoveryRate(lines: Line[]): Cited | null {
  const N = String.raw`(\d+(?:\.\d+)?|\.\d+)`, P = String.raw`\s*(?:percent|%|por ciento)`;
  const res = [
    new RegExp(String.raw`(?:An|The) interest rate of ${N}${P},? (?:is )?used to calculate capital recovery`, 'i'),
    new RegExp(String.raw`interest rate of ${N}${P}.{0,40}capital recovery`, 'i'),
    new RegExp(String.raw`tasa de inter[ée]s de ${N}${P} se utiliza para calcular la recuperaci[óo]n de capital`, 'i'),
    new RegExp(String.raw`capital recover(?:y|ies)[^.]{0,40}?(?:are |is )?calculated (?:using|at) (?:the )?${N}${P}`, 'i'),
    new RegExp(String.raw`interest (?:rate )?(?:we )?used to calculate (?:ownership|capital recovery) costs? is ${N}${P}`, 'i'),
    new RegExp(String.raw`capital recovery factor calculated at ${N}${P} interest rate`, 'i'),
    new RegExp(String.raw`long[- ]?term interest rate (?:used )?(?:in this study )?is ${N}${P}`, 'i'),
    new RegExp(String.raw`interest (?:for|on) capital investments? (?:are|is) calculated at[^.]{0,160}?\(?${N}${P}`, 'i'),
    new RegExp(String.raw`\(Capital Recovery\) costs calculated at the ${N}${P} rate`, 'i'),
  ];
  const sets = [proseSentences(lines), allSentences(lines)];
  for (const re of res) for (const S of sets) {
    const h = sentenceMatch(S.filter(s => !/operating capital|nominal rate/i.test(s.text.slice(0, 80))), re);
    if (h) { const c = citeS(h, 1, '%'); if (c && c.value > 0 && c.value < 20) return c; }
  }
  // the rate in the next sentence: "Interest for capital investments are calculated at the long-run rate of return of
  // agricultural assets to current income. In this study, we used a ten year average (6.25%) of the most current years"
  const all = allSentences(lines);
  for (let k = 0; k + 1 < all.length; k++) {
    if (!/interest (?:for|on) capital investments? (?:are|is) calculated at the long[- ]run rate/i.test(all[k].text)) continue;
    const m = all[k + 1].text.match(new RegExp(String.raw`\(${N}${P}\)`, 'i'));
    const v = m ? toNum(m[1]) : null;
    if (v != null) return { value: v, unit: '%', page: all[k].page, quote: `${all[k].text} ${all[k + 1].text}` };
  }
  // the header block of the cost tables: "Long Term Interest Rate: 6.01%"
  const hit = find(lines, /Long[- ]Term Interest Rate:?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (hit) { const v = toNum(hit.m[1]); if (v != null) return { value: v, unit: '%', page: hit.line.page, quote: clean(hit.line.text) }; }
  return null;
}

function sentenceMatch(sentences: { text: string; page: number }[], re: RegExp): { s: { text: string; page: number }; m: RegExpMatchArray } | null {
  for (const s of sentences) { const m = s.text.match(re); if (m) return { s, m }; }
  return null;
}
const citeS = (hit: { s: { text: string; page: number }; m: RegExpMatchArray }, group: number, unit: string | null): Cited | null => {
  const v = toNum(hit.m[group]);
  return v == null ? null : { value: v, unit, page: hit.s.page, quote: hit.s.text };
};

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

// ---------------------------------------------------------------- source

function parseSource(e: ManifestEntry, lines: Line[], language: 'en' | 'es'): StudySource {
  // index row: "TitleTitle Region YEAR Description"
  let ctx = e.context;
  if (ctx.startsWith(e.title + e.title)) ctx = ctx.slice(e.title.length * 2);
  else if (ctx.startsWith(e.title)) ctx = ctx.slice(e.title.length);
  ctx = ctx.trim();
  const ym = ctx.match(/\b(19|20)\d{2}\b/);
  let year: number | null = ym ? Number(ym[0]) : (e.year ?? null);
  let region: string | null = null; let description: string | null = null;
  if (ym && ym.index != null) {
    region = clean(ctx.slice(0, ym.index)) || null;
    description = clean(ctx.slice(ym.index + 4)) || null;
  } else description = ctx || null;
  // title from the cover: first non-empty lines containing the crop and "COST"
  const cover = lines.slice(0, 40).map(l => clean(l.text)).filter(Boolean);
  const titleLine = cover.find(t => /SAMPLE COSTS|COSTS AND RETURNS|COST.*RETURN|PRODUCE/i.test(t) && t.length > 12);
  const title = titleLine ? (titleLine.length > 140 ? titleLine.slice(0, 140) : titleLine) : e.title;
  if (year == null) { const y2 = cover.join(' ').match(/\b(20[0-2]\d|19\d{2})\b/); if (y2) year = Number(y2[0]); }
  // counties: "Monterey, Santa Cruz, and San Benito Counties"
  const joined = lines.slice(0, 400).map(l => l.text).join(' ').replace(/\s+/g, ' ');
  const cm = joined.match(/([A-Z][A-Za-z.]+(?:\s[A-Z][A-Za-z.]+)*(?:,\s*[A-Z][A-Za-z.]+(?:\s[A-Z][A-Za-z.]+)*)*(?:,?\s*and\s+[A-Z][A-Za-z.]+(?:\s[A-Z][A-Za-z.]+)*)?)\s+Count(?:y|ies)/);
  const counties = cm ? clean(cm[1]).replace(/^(?:the|in|for|of)\s+/i, '') : null;
  return {
    id: slugOf(e), commodity: e.commodity, title, year, region, counties: counties && counties.length < 120 ? counties : null,
    description, language, url: e.url, indexPage: e.indexPage, publisher: PUBLISHER, fetchedAt: new Date().toISOString().slice(0, 10),
    archived: Boolean(e.archived), indexYear: e.year ?? (ym ? Number(ym[0]) : null),
    priceYear: parsePriceYear(lines, year),
  };
}

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const MONTH_RE = Object.keys(MONTHS).join('|');

/**
 * The year the study says its prices are for. Read from the prose only; the common forms are
 * "based on January 2024 figures", "based on 2019-2020 prices", "based on April 2017 prices",
 * "Total operating costs based on 2017 data", or "based on current figures" (then the study year).
 * Never guessed: no sentence, no priceYear.
 */
function parsePriceYear(lines: Line[], studyYear: number | null): StudySource['priceYear'] {
  const S = proseSentences(lines);
  const yr = String.raw`((?:19|20)\d{2})`;
  const tries: { re: RegExp; month?: number; year?: number }[] = [
    { re: new RegExp(String.raw`(?:costs?|figures|prices|precios|costos)[^.]{0,120}?(?:based on|basados? en|a partir de)\s+(?:the\s+)?(${MONTH_RE})\s+(?:of\s+)?${yr}\s*(?:figures|prices|data|costs|dollars|price levels)?`, 'i'), month: 1, year: 2 },
    { re: new RegExp(String.raw`(?:costs?|figures|prices|precios|costos)[^.]{0,120}?(?:based on|basados? en)\s+(?:the\s+)?${yr}(?:\s*[-/–]\s*${yr})?\s*(?:figures|prices|data|costs|dollars|price levels|season|crop year)`, 'i'), year: 1 },
    { re: new RegExp(String.raw`(?:prices|costs|figures)\s+(?:are|were)\s+(?:for|from|as of)\s+(?:the\s+)?(${MONTH_RE})?\s*${yr}`, 'i'), month: 1, year: 2 },
    { re: new RegExp(String.raw`total operating costs based on ${yr} data`, 'i'), year: 1 },
  ];
  for (const t of tries) {
    for (const sent of S) {
      const m = sent.text.match(t.re);
      if (!m) continue;
      const year = Number(m[t.year!]);
      if (!Number.isFinite(year) || year < 1990 || year > 2035) continue;
      const monthName = t.month != null ? m[t.month]?.toLowerCase() : undefined;
      // A range like 2019-2020 takes the later year: prices as of the study's release.
      const range = sent.text.match(new RegExp(String.raw`${year}\s*[-/–]\s*((?:19|20)\d{2})`));
      const value = range ? Math.max(year, Number(range[1])) : year;
      return { value, month: monthName ? MONTHS[monthName] ?? null : null, page: sent.page, quote: sent.text };
    }
  }
  const cur = S.find(sent => /(?:costs?|figures|prices|precios|costos)[^.]{0,120}?(?:based on|basados? en)\s+current\s+(?:figures|prices|costs|data)/i.test(sent.text) || /precios (?:actuales|corrientes)/i.test(sent.text));
  if (cur && studyYear) return { value: studyYear, month: null, page: cur.page, quote: `${cur.text} (Current at the time of the study, so the study year ${studyYear} is used.)` };
  return null;
}

// ---------------------------------------------------------------- gross returns block

type ReturnRow = { name: string; quantity: number; unit: string; price: number; value: number };
// "Ton", "Lb. N", "40 lb box", "*cartons", "crtn*", "bale equivalent"
const UNIT = String.raw`(?:\d+ )?\*?[A-Za-z][A-Za-z./*-]*(?: [A-Za-z][A-Za-z./*-]*){0,2}`;
// Headings are upper case in the tables; pdftotext sometimes drops the spaces ("GROSSRETURNS"). The rest of the line may hold a row.
const GROSS_HEAD = /^\s*GROSS\s*(?:RETURNS?|REVENUE|INCOME)\b\s*[:-]?\s*(.*)$/;
const GROSS_TOTAL = /^\s*TOTAL\s*(?:GROSS\s*)?(?:RETURNS?|REVENUE|INCOME)\b\s*:?\s*(.*)$/;
// Anything that starts the cost part of the table: OPERATING COSTS, an overhead or net-returns line, another TOTAL, or a "Fertilizer:" style section heading.
const RETURNS_END = /^\s*(?:OPERATING\s*COSTS?|CASH\s*OVERHEAD|NON-?CASH|NET\s*RETURNS?|TOTAL\b|[A-Za-z][A-Za-z0-9 ,&/()-]*:\s*$)/i;

/** "Name  qty  unit  price  value"; the name is optional when the line is the heading itself. */
function returnRow(text: string, defaultName: string | null): ReturnRow | null {
  const m = text.match(new RegExp(String.raw`^\s*(?:(\S.*?)\s{2,})?(${NUM})\s+(${UNIT})\s+(${NUM})\s+(${NUM})\s*$`));
  if (!m) return null;
  const name = m[1] ? clean(m[1]) : defaultName;
  if (!name || /^TOTAL\b/i.test(name)) return null;
  const q = toNum(m[2]), p = toNum(m[4]), v = toNum(m[5]);
  return q != null && p != null && v != null ? { name, quantity: q, unit: m[3], price: p, value: v } : null;
}

/**
 * The GROSS RETURNS heading of the costs-and-returns table. Tables titled "COSTS & RETURNS" or printed with a
 * "(continued)" heading count too; the last such table that has a heading wins. Null when the study has no such table;
 * head null when it has one without a heading.
 */
function grossReturnsBlock(lines: Line[]): { head: { line: Line; rest: string } | null; end: number; perAcre: boolean } | null {
  const tables = findTables(lines);
  const cands = tables.filter(t => t.kind === 'returns' || (/\bRETURNS\b/i.test(t.title) && /\bCOSTS?\b/i.test(t.title) && t.kind !== 'ranging' && t.kind !== 'monthly'));
  // Last resort, when no costs-and-returns table has the heading (missing or differently titled table headings, e.g.
  // "Table 2. COST PER ACRE" or "MATERIAL AND INPUT COSTS"): the whole text, keeping only a heading that OPERATING COSTS follows.
  const spans: { s: number; e: number; needOps: boolean }[] = cands.map(t => { const [s, e] = spanOf(lines, tables, t); return { s, e, needOps: false }; });
  spans.unshift({ s: 0, e: lines.length, needOps: true });
  const opsFollow = (i: number) => lines.slice(i + 1, i + 13).some(l => /^\s*OPERATING\s*COSTS?\b/i.test(l.text));
  for (let c = spans.length - 1; c >= 0; c--) {
    const { s, e, needOps } = spans[c];
    let alone: { line: Line; rest: string } | null = null;
    let inline: { line: Line; rest: string } | null = null;
    for (let i = s; i < e; i++) {
      const m = lines[i].text.match(GROSS_HEAD);
      if (!m || (needOps && !opsFollow(i))) continue;
      // A heading alone, or a heading with its one row; prose that starts with "Gross returns" is not upper case.
      // A bare heading wins: some studies repeat "GROSS RETURNS  1,139  ctn  12  13,905" below the rows as the total.
      if (!m[1].trim()) alone = { line: lines[i], rest: m[1] };
      else if (returnRow(m[1], 'x') && !(alone && i - alone.line.index < 10)) inline = { line: lines[i], rest: m[1] };
    }
    const head = alone && (!inline || alone.line.index > inline.line.index) ? alone : inline;
    if (head) {
      // Column header above the heading: "Value or Cost/Acre", or "Cost/1,000LF" (hedgerows), "Cost/Head" (livestock).
      const hdr = lines.slice(Math.max(s, head.line.index - 6), head.line.index).map(l => l.text).join(' ');
      const perAcre = /acre/i.test(hdr) || !/Cost\s*\/\s*(?!acre)\S/i.test(hdr);
      return { head, end: e, perAcre };
    }
  }
  return cands.length ? { head: null, end: lines.length, perAcre: true } : null;
}

// ---------------------------------------------------------------- assumptions

function parseAssumptions(lines: Line[], warn: (s: string) => void): Assumptions {
  const S = proseSentences(lines);
  const a: Assumptions = {
    acresFarmed: null, acresCrop: null, yieldPerAcre: null, yieldUnit: null, pricePerUnit: null, returns: [],
    interestRatePct: null, operatingInterestRatePct: null, laborMachineRate: null, laborNonMachineRate: null,
    laborOverheadPct: null, landRentPerAcre: null, cropsPerAcrePerYear: null, fuelPriceDiesel: null, fuelPriceGas: null,
    yieldStatement: null, priceStatement: null,
  };

  // capital recovery interest rate
  let h = sentenceMatch(S, /(?:An|The) interest rate of (\d+(?:\.\d+)?)\s*percent (?:is )?used to calculate capital recovery/i)
    || sentenceMatch(S, /interest rate of (\d+(?:\.\d+)?)\s*percent.{0,40}capital recovery/i);
  if (h) a.interestRatePct = citeS(h, 1, '%');
  if (!a.interestRatePct) a.interestRatePct = capitalRecoveryRate(lines);
  h = sentenceMatch(S, /(?:calculated monthly|interest on operating capital).{0,80}?nominal rate of (\d+(?:\.\d+)?)\s*percent/i)
    || sentenceMatch(S, /nominal rate of (\d+(?:\.\d+)?)\s*percent per year/i);
  if (h) a.operatingInterestRatePct = citeS(h, 1, '%');

  // labor rates
  h = sentenceMatch(S, /\$(\d+(?:\.\d+)?)\s*(?:per hour )?for machine operators?\s+and\s+\$(\d+(?:\.\d+)?)\s*(?:per hour )?for (?:general|non-machine|field|irrigators? and general)/i)
    || sentenceMatch(S, /hourly wages (?:for machine operators|for machine labor)?.{0,40}?\$(\d+(?:\.\d+)?)\s.{0,60}?\$(\d+(?:\.\d+)?)/i);
  if (h) { a.laborMachineRate = citeS(h, 1, '$/hr'); a.laborNonMachineRate = citeS(h, 2, '$/hr'); }
  h = sentenceMatch(S, /(?:includes|including|include)\s+(?:an? )?(?:overhead|payroll overhead) of (\d+(?:\.\d+)?)\s*(?:percent|%)/i)
    || sentenceMatch(S, /payroll taxes and benefits which are calculated at (\d+(?:\.\d+)?)\s*(?:percent|%)/i)
    || sentenceMatch(S, /(\d+(?:\.\d+)?)\s*(?:percent|%) (?:labor |payroll )?overhead/i)
    || sentenceMatch(S, /overhead of (\d+(?:\.\d+)?)\s*(?:percent|%)/i);
  if (h) a.laborOverheadPct = citeS(h, 1, '%');

  // land rent from prose, fallback to Table 1 cash overhead line later
  h = sentenceMatch(S, /land rent (?:is|was) (?:assumed to be|estimated at|set at)\s*\$(\d[\d,]*(?:\.\d+)?)\s*per acre/i)
    || sentenceMatch(S, /rent(?:al)? (?:of|at|is)\s*\$(\d[\d,]*(?:\.\d+)?)\s*per acre per year/i)
    || sentenceMatch(S, /\$(\d[\d,]*(?:\.\d+)?)\s*per acre (?:per year )?(?:for|is|as) (?:the )?land rent/i)
    || sentenceMatch(S, /land rents? (?:for|of|at|is|are)\s*\$(\d[\d,]*(?:\.\d+)?)\s*per acre/i)
    || sentenceMatch(S, /(?:annual )?rental (?:rate|price|cost) of \$(\d[\d,]*(?:\.\d+)?)\s*per acre/i)
    || sentenceMatch(S, /land (?:in this study )?is rented (?:by the grower )?for \$(\d[\d,]*(?:\.\d+)?)\s*per acre/i)
    || sentenceMatch(S, /cash rent for the land is \$(\d[\d,]*(?:\.\d+)?)\s*per acre/i);
  if (h) a.landRentPerAcre = citeS(h, 1, '$/acre/yr');

  // farm size
  h = sentenceMatch(S, /(?:farm|ranch|orchard|vineyard|operation) (?:consists of|is|has|totals?|comprises|covers)\s+(\d[\d,]*)\s+(?:contiguous |non-contiguous |total |irrigated )?acres/i)
    || sentenceMatch(S, /(\d[\d,]*)\s+(?:contiguous |non-contiguous |total )?acres? of (?:which|land|owned|rented|farm|cropland)/i)
    || sentenceMatch(S, /(\d[\d,]*)[- ]acre (?:farm|ranch|operation|orchard|vineyard)/i)
    || sentenceMatch(S, /farm operation of (\d[\d,]*)\s+(?:contiguous |non-contiguous |total )?acres/i)
    || sentenceMatch(S, /(?:farm|ranch|operation|grower) (?:owns|rents|leases|farms)\s+(\d[\d,]*)\s+acres/i);
  if (h) a.acresFarmed = citeS(h, 1, 'acres');
  h = sentenceMatch(S, /(\d[\d,]*(?:\.\d+)?)\s+acres (?:are|is|of which are)? ?(?:planted to|in|devoted to|used for|of)\s+(?!which)[a-z ,-]{2,40}?(?:in this study|for this study|and the remaining|\.)/i)
    || sentenceMatch(S, /(\d[\d,]*)\s+acres of (?:mature |bearing |producing )?[a-z ]{2,30}? ?(?:are|is) in (?:full )?production/i)
    || sentenceMatch(S, /(?:planted|established) on (\d[\d,]*)\s+acres/i);
  if (h) a.acresCrop = citeS(h, 1, 'acres');

  // crops per year on the same acre
  h = sentenceMatch(S, /(one|two|three|four|five|\d) crops (?:are|is|can be) (?:produced|grown|harvested) (?:each|per) year(?: per acre)?/i)
    || sentenceMatch(S, /(one|two|three|four|five|\d) crops per (?:acre per )?year/i);
  if (h) { const v = WORD_NUM[h.m[1].toLowerCase()] ?? toNum(h.m[1]); if (v != null) a.cropsPerAcrePerYear = { value: v, unit: 'crops/acre/yr', page: h.s.page, quote: h.s.text }; }

  // fuel
  h = sentenceMatch(S, /diesel.{0,60}?\$(\d+(?:\.\d+)?)\s*per gallon/i) || sentenceMatch(S, /\$(\d+(?:\.\d+)?)\s*per gallon for diesel/i);
  if (h) a.fuelPriceDiesel = citeS(h, 1, '$/gal');
  h = sentenceMatch(S, /gasoline.{0,60}?\$(\d+(?:\.\d+)?)\s*per gallon/i) || sentenceMatch(S, /\$(\d+(?:\.\d+)?)\s*per gallon for gasoline/i);
  if (h) a.fuelPriceGas = citeS(h, 1, '$/gal');

  // returns from the Table 2 GROSS RETURNS block
  const gb = grossReturnsBlock(lines);
  if (gb) {
    if (gb.head && !gb.perAcre) warn(`Table 2 gross returns are not per acre (${clean(lines[gb.head.line.index - 1]?.text ?? '')}); left null`);
    else if (gb.head) {
      const pushRow = (l: Line, r: ReturnRow) => a.returns.push({ ...r, page: l.page, quote: clean(l.text) });
      // "GROSS RETURNS   1,600  Box  19.00  30,400" or "GROSS RETURNS: Walnuts  5,000  Lb.  1.25  6,250" on one line
      const inline = returnRow(gb.head.rest, 'Gross returns');
      if (inline) pushRow(gb.head.line, inline);
      let total: { line: Line; rest: string } | null = null;
      // The block ends at its TOTAL line, or at OPERATING COSTS or any other heading (archived studies print no total).
      for (let i = gb.head.line.index + 1; i < Math.min(gb.end, gb.head.line.index + 15); i++) {
        const t = lines[i].text;
        if (!t.trim()) continue;
        // "TOTAL GROSS RETURNS ...", a repeated "GROSS RETURNS  1,139  ctn  12  13,905", or a bare "Total  13056  lb  0.504  6574"
        const tm = t.match(GROSS_TOTAL) || t.match(GROSS_HEAD) || t.match(/^\s*TOTAL\s*:?\s+(?=[-\d($])(.*)$/i);
        if (tm) { total = { line: lines[i], rest: tm[1] }; break; }
        if (RETURNS_END.test(t)) break;
        const r = returnRow(t, null);
        if (r) pushRow(lines[i], r);
      }
      if (total) {
        const withQty = total.rest.match(new RegExp(String.raw`^(${NUM})\s+(${UNIT})\s+(?:${NUM}\s+)?(${NUM})\s*$`));
        const nums = total.rest.match(new RegExp(NUM, 'g'));
        const val = withQty ? toNum(withQty[3]) : nums ? toNum(nums[nums.length - 1]) : null;
        if (withQty) {
          const q = toNum(withQty[1]);
          if (q != null && a.returns.length <= 1) { a.yieldPerAcre = cite(total.line, q, withQty[2]); a.yieldUnit = withQty[2]; }
        }
        if (val != null) (a as unknown as { _gross: Cited })._gross = cite(total.line, val, '$/acre');
      } else if (a.returns.length) {
        // No total line: the gross is the one return line, or the sum of the return lines, each quoted.
        const sum = a.returns.reduce((s, r) => s + r.value, 0);
        const quote = a.returns.length === 1 ? a.returns[0].quote : `${a.returns.map(r => r.quote).join(' + ')} (sum of the ${a.returns.length} return lines)`;
        (a as unknown as { _gross: Cited })._gross = { value: Math.round(sum * 100) / 100, unit: '$/acre', page: a.returns[0].page, quote };
      }
      if (a.returns.length === 1) {
        const r = a.returns[0];
        a.pricePerUnit = { value: r.price, unit: `$/${r.unit}`, page: r.page, quote: r.quote };
        if (!a.yieldPerAcre) { a.yieldPerAcre = { value: r.quantity, unit: r.unit, page: r.page, quote: r.quote }; a.yieldUnit = r.unit; }
      } else if (a.returns.length > 1) {
        warn(`Table 2 lists ${a.returns.length} return lines with different prices; pricePerUnit left null, see returns[]`);
        if (!a.yieldUnit) a.yieldUnit = a.returns[0].unit;
      }
    } else warn('Table 2 found but no GROSS RETURNS block');
  }
  // sentences that state yield and price, kept verbatim for the UI when no single number exists
  const ys = sentenceMatch(S, /\byields?\b[^.]{0,80}\d[\d,.]*\s*(?:tons?|lbs?|pounds|cartons?|trays?|boxes|cases|bins|bushels|cwt|sacks|bales|flats|bunches)[^.]{0,40}per acre/i);
  if (ys) a.yieldStatement = { page: ys.s.page, quote: ys.s.text };
  const ps = sentenceMatch(S, /\bprices?\b[^.]{0,80}\$\d[\d,.]*\s*(?:per|\/)\s*(?:ton|lb|pound|carton|tray|box|case|bin|bushel|cwt|sack|hundredweight|bale|flat|bunch)/i);
  if (ps) a.priceStatement = { page: ps.s.page, quote: ps.s.text };
  // prose fallback for price when Table 2 gave nothing
  if (!a.pricePerUnit) {
    h = sentenceMatch(S, /price (?:to growers )?of \$(\d[\d,]*(?:\.\d+)?)\s*per ([a-z]+) is (?:assumed|used)/i)
      || sentenceMatch(S, /(?:a|an) (?:average )?(?:selling |grower |return )?price of \$(\d[\d,]*(?:\.\d+)?)\s*per ([a-z]+)/i);
    if (h) { const v = toNum(h.m[1]); if (v != null) a.pricePerUnit = { value: v, unit: `$/${h.m[2]}`, page: h.s.page, quote: h.s.text }; }
  }
  return a;
}

// ---------------------------------------------------------------- Table 1 costs

function tableSpan(lines: Line[], kind: TableKind, which: 'first' | 'last' = 'last'): [number, number] | null {
  const tables = findTables(lines);
  const hits = tables.filter(t => t.kind === kind);
  if (!hits.length) return null;
  return spanOf(lines, tables, which === 'last' ? hits[hits.length - 1] : hits[0]);
}

function lastTotal(lines: Line[], re: RegExp, from: number, to: number, unit: string | null, accept: (l: Line) => boolean = () => true): Cited | null {
  // a matching label line with no number at its end ("TOTAL COSTS PER ACRE - HARVEST COSTS PER ACRE = ...") is prose, not the row
  const hits = findAll(lines, re, from, to).filter(h => new RegExp(String.raw`${NUM}\s*$`).test(h.line.text) && accept(h.line));
  if (!hits.length) return null;
  const h = hits[hits.length - 1];
  const nums = h.line.text.match(new RegExp(NUM, 'g'));
  if (!nums) return null;
  const v = toNum(nums[nums.length - 1]);
  return v == null ? null : cite(h.line, v, unit);
}

// Total-row labels. The text layer sometimes splits a word ("TOTAL OPERATI NG COSTS"), and studies print the per-acre row as
// "/ACRE", "/A", "/AC" or "PER ACRE" next to per-unit rows ("/CWT", "/TON", "/CRTN") that must never be read as per-acre.
const OPER = String.raw`OPERATI\s?NG`; // the label words may also run together: "TOTALOPERATINGCOSTS/ACRE"
// Spanish translations: "COSTOS TOTALES DE OPERACIÓN / ACRE", "GASTOS TOTALES GENERALES EN EFECTIVO / ACRE", "COSTOS TOTALES / ACRE".
// Other Spanish wordings: "COSTOS DE OPERACIÓN TOTALES", "COSTOS GENERALES TOTALES NO EFECTIVOS", and labels that wrap
// ("COSTOS TOTALES GENERALES EN" / "EFECTIVO / ACRE", "COSTOS TOTALES GENERALES NO" / "EFECTIVO") with the figures on the first line.
const TOTAL_RE = {
  operating: String.raw`(?:TOTAL\s*${OPER}\s*COSTS?|C?OSTOS\s+TOTALES\s+DE\s+OPERACI[ÓO]N|COSTOS\s+(?:DE\s+)?OPERACI[ÓO]N\s+TOTALES)`,
  cashOverhead: String.raw`(?:TOTAL\s*CASH\s*OVERHEAD(?:\s*COSTS?)?|(?:GASTOS|COSTOS)\s+TOTALES\s+(?:DE\s+GASTOS\s+)?GENERALES\s+EN(?:\s+EFECTIVO)?)`,
  nonCashOverhead: String.raw`(?:TOTAL\s*(?:NON-?\s?CASH\s*OVERHEAD|CAPITAL\s+RECOVERY)(?:\s*COSTS?)?|(?:GASTOS|COSTOS)\s+TOTALES\s+(?:DE\s+GASTOS\s+)?GENERALES\s+(?:SIN|NO)(?:\s+EFECTIVOS?)?|COSTOS\s+GENERALES\s+TOTALES\s+NO\s+EFECTIVOS?)`,
  total: String.raw`(?:TOTAL\s*(?:ALL\s+)?COSTS?|COSTOS\s+TOTALES)`,
};
const PER_ACRE = String.raw`(?:\s*\/\s*A(?:C(?:RE)?)?\.?(?![A-Za-z])|\s+P(?:ER|OR)\s+(?:PRODUCING\s+)?ACRE\b)`;
const perAcreRe = (label: string) => new RegExp(String.raw`^\s*${label}${PER_ACRE}`, 'i');
// no unit printed: the label is followed directly by the numbers
const bareRe = (label: string) => new RegExp(String.raw`^\s*${label}\s{2,}[-(\d$,.]`, 'i');

// A per-acre label that wraps after its slash: "COSTOS DE OPERACIÓN TOTALES /   6,837 ...   58,287" with "ACRE" alone on the next line.
const slashRe = (label: string) => new RegExp(String.raw`^\s*${label}\s*\/\s{2,}[-(\d$,.]`, 'i');
const acreNext = (lines: Line[]) => (l: Line) => /^\s*ACRES?\s*$/i.test(lines[l.index + 1]?.text ?? '');
/** Per-acre rows: printed with a per-acre suffix, or wrapped after the slash with ACRE on the next line. */
function perAcreHits(lines: Line[], label: string, from: number, to: number) {
  const wrapped = findAll(lines, slashRe(label), from, to).filter(h => acreNext(lines)(h.line));
  return [...findAll(lines, perAcreRe(label), from, to), ...wrapped].sort((a, b) => a.line.index - b.line.index);
}

/** Per-acre total candidates in order of preference: Table 1, then Table 2; within a table a row printed with a per-acre suffix, then a row with no unit. */
function acreTotals(lines: Line[], label: string, spans: ([number, number] | null)[], bare: boolean): Cited[] {
  const out: Cited[] = [];
  const tries: [RegExp, ((l: Line) => boolean) | undefined][] = [[perAcreRe(label), undefined], [slashRe(label), acreNext(lines)]];
  if (bare) tries.push([bareRe(label), undefined]);
  for (const sp of spans) for (const [re, accept] of tries) {
    if (!sp) continue;
    const v = lastTotal(lines, re, sp[0], sp[1], '$/acre', accept);
    if (v && !out.some(x => x.value === v.value)) out.push(v);
  }
  return out;
}

const INTEREST_RE = /^\s*(?:Interest on operating(?: capital)?|Inter[ée]s(?:es)? (?:sobre|en) (?:el )?capital)/i;

/** "Interest on operating capital at 8.5%   23.80": the last number that is not the rate. The value may sit on the next line
 *  when the label wraps ("Interest on Operating Capital 8@" / ".50%   65.05"). */
function interestRow(lines: Line[], from: number, to: number, dotLoss: boolean): Cited | null {
  const hits = findAll(lines, INTEREST_RE, from, to);
  const h = hits[hits.length - 1];
  if (!h) return null;
  const valueOf = (l: Line, rest: string): Cited | null => {
    // "Interest on Operating Capital @ 5.25%   37 95" in a table whose text layer drops decimal points
    const d = dotLoss ? rest.match(/\s{2,}(\d+) (\d{2})\s*$/) : null;
    if (d) return cite(l, Number(`${d[1]}.${d[2]}`), '$/acre');
    const m = rest.match(new RegExp(String.raw`\s{2,}(${NUM})\s*$`));
    if (!m || /[%@]\s*$/.test(rest)) return null;
    const v = toNum(m[1]);
    return v == null ? null : cite(l, v, '$/acre');
  };
  const own = valueOf(h.line, h.line.text.replace(INTEREST_RE, ''));
  if (own) return own;
  const next = lines[h.line.index + 1];
  if (next && /^\s*[\d.]*\s*%/.test(next.text)) {
    const v = valueOf(next, next.text.replace(/^\s*[\d.]*\s*%/, ''));
    if (v) return { ...v, quote: clean(`${h.line.text} ${next.text}`) };
  }
  return null;
}

/** The one-page Imperial County budgets (2000-2005): "IMPERIAL COUNTY ... PRODUCTION COSTS 2004-2005", one row per operation
 *  with a prevailing (custom) rate, materials, hand labor hours and dollars and a cost per acre, then land rent, a percentage cash
 *  overhead, for perennial stands an amortization of the stand establishment, harvest rows and TOTAL ALL COSTS. No operating
 *  total and no interest are printed, so operatingTotal stays null. The rows are kept only when, with the overhead lines,
 *  they add up to the printed TOTAL ALL COSTS. */
function parseOnePageBudget(lines: Line[], c: CostsPerAcre, warn: (s: string) => void): boolean {
  const titleAt = lines.findIndex(l => /IMPERIAL COUNTY .*PRODUCTION COSTS\s+\d{4}/i.test(l.text));
  if (titleAt < 0) return false;
  const h = lines.findIndex((l, i) => i > titleAt && i < titleAt + 15 && /\bHours\b/.test(l.text) && /\bDollars\b/.test(l.text));
  if (h < 0) return false;
  const end = lines.findIndex((l, i) => i > h && /^\s*TOTAL\s+(?:OF\s+)?ALL\s+COSTS\b/i.test(l.text));
  if (end < 0 || end - h > 120) return false;
  const wageHit = lines.slice(titleAt, h).map(l => l.text.match(/\$\s*(\d+\.\d{2})\s*(?:\/\s*hr|per\s*hour)/i)).find(Boolean);
  const wage = wageHit ? Number(wageHit[1]) : null;
  // materials, hours and dollars sit right of the "Type" column; the prevailing rate sits left of it
  const typeCol = [lines[h - 1], lines[h]].map(l => l.text.search(/\bType\b/)).find(x => x > 0) ?? 55;
  const totalAll = lastTotal(lines, /^\s*TOTAL\s+(?:OF\s+)?ALL\s+COSTS\b/i, end, end + 1, '$/acre');
  if (!totalAll) return false;
  const standEnd = lines.findIndex((l, i) => i > h && i < end && /TOTAL COST OF STAND ESTABLISHMENT/i.test(l.text));
  const ops: OperationRow[] = [];
  const co: CostsPerAcre['cashOverheadItems'] = [];
  let amort: Cited | null = null;
  let cat: OperationCategory = 'cultural', section = 'Cultural', pendingLabel = '', pendingQuote = '', bad = 0;
  const round2 = (x: number) => Math.round(x * 100) / 100;
  for (let i = h + 1; i < end; i++) {
    const l = lines[i];
    const toks = [...l.text.matchAll(/(?<=^|\s{2})(-?[\d,]*\.?\d+)(?=\s{2}|\s*$)/g)].map(m => ({ v: toNum(m[1])!, end: m.index! + m[1].length, start: m.index! }));
    // the operation name is the text up to the first wide gap, without a prevailing rate one space after it ("Stubble disc / ring roller 24.50")
    const first = l.text.trimStart().split(/\s{2,}/)[0];
    const rateHit = first.match(/\s(\d*\.\d+)$/);
    const label = (toks.length && toks[0].start <= l.text.length - l.text.trimStart().length ? '' : rateHit ? first.slice(0, rateHit.index) : first).trim();
    if (!toks.length) {
      if (!label) continue;
      if (/^[A-Z]{3,}/.test(label) && !/^[A-Z][a-z]/.test(label)) { // a heading: "GROWING PERIOD", "HARVEST (field pack)*"
        section = clean(label.replace(/[*:]+$/, '')); cat = /HARVEST/i.test(label) ? 'harvest' : 'cultural'; pendingLabel = ''; continue;
      }
      if (/[a-z]/.test(label)) { pendingLabel = label; pendingQuote = clean(l.text); }
      continue;
    }
    if (i <= standEnd) { pendingLabel = ''; continue; } // land preparation and stand establishment: the establishment cost
    if (!/[a-z]/.test(label) || /^TOTAL\b/i.test(label)) { pendingLabel = ''; continue; } // subtotals: "TOTAL ANNUAL COSTS", "GROWING PERIOD"
    const total = toks[toks.length - 1].v;
    if (/^Amortization/i.test(label)) { amort = cite(l, total, '$/acre'); pendingLabel = ''; continue; }
    if (/land rent|overhead/i.test(label)) { co.push({ description: clean(l.text.slice(0, toks[toks.length - 1].start).replace(/-{2,}/g, ' ')), value: total, page: l.page, quote: clean(l.text) }); pendingLabel = ''; continue; }
    const name = clean(`${pendingLabel} ${label}`);
    const quote = pendingLabel ? `${pendingQuote} ${clean(l.text)}` : clean(l.text);
    pendingLabel = '';
    const right = toks.slice(0, -1).filter(t => t.end > typeCol);
    const hasRate = Boolean(rateHit) || toks.slice(0, -1).some(t => t.end <= typeCol);
    let mat = 0, hours: number | null = null, dollars = 0;
    const isLabor = (hh: number, d: number) => wage != null && hh > 0 && Math.abs(hh * wage - d) <= 0.15 * d;
    if (right.length === 3) [mat, hours, dollars] = right.map(t => t.v);
    else if (right.length === 2 && isLabor(right[0].v, right[1].v)) [hours, dollars] = right.map(t => t.v);
    else if (right.length === 1) mat = right[0].v;
    else if (right.length) { bad++; continue; }
    let custom = round2(total - mat - dollars), labor = dollars;
    // hand labor and no prevailing rate on the row: what is left is hand labor ("Seedless transplants 600.00 12 9.95 719.40")
    if (!hasRate && hours != null && Math.abs(custom) > 0.05) { labor = round2(total - mat); custom = 0; }
    if (custom < -0.05) { bad++; continue; }
    ops.push({ name, category: cat, section, timeHrsPerAcre: null, labor, fuel: null, lubeRepairs: null, materials: mat, customRent: custom, totalCost: total, page: l.page, quote, laborHours: hours } as OperationRow);
  }
  for (const o of ops) delete (o as { laborHours?: unknown }).laborHours;
  const sum = ops.reduce((x, o) => x + (o.totalCost ?? 0), 0) + co.reduce((x, o) => x + o.value, 0) + (amort?.value ?? 0);
  if (bad || !ops.length || Math.abs(sum - totalAll.value) > Math.max(0.5, 0.01 * ops.length)) {
    warn(`one-page budget format: rows did not add up to TOTAL ALL COSTS ${totalAll.value} (rows ${round2(sum)}${bad ? `, ${bad} rows unreadable` : ''}); rows not read`);
    return false;
  }
  c.title = clean(lines[titleAt].text);
  c.operations = ops; c.cashOverheadItems = co; c.totalCost = totalAll;
  // The amortized stand establishment is the only non-cash overhead in this format.
  if (amort) c.nonCashOverheadTotal = amort;
  warn('one-page budget format (Imperial County): operations from the production costs table; no operating total or interest is printed, so operatingTotal is null; prevailing-rate machine work is stored as custom; land rent and the percentage cash overhead are cash overhead items' + (amort ? '; the amortization of stand establishment is the non-cash overhead' : ''));
  return true;
}

function parseCosts(lines: Line[], a: Assumptions, warn: (s: string) => void): CostsPerAcre {
  const c: CostsPerAcre = {
    title: null, operatingTotal: null, operatingInterest: null, cashOverheadTotal: null, nonCashOverheadTotal: null, totalCost: null,
    grossReturns: (a as unknown as { _gross?: Cited })._gross ?? null, netReturnsAboveOperating: null, netReturnsAboveTotal: null,
    cashOverheadItems: [], operations: [],
  };
  delete (a as unknown as { _gross?: Cited })._gross;
  const opAny = new RegExp(String.raw`^\s*${TOTAL_RE.operating}\b`, 'i');
  // production cost table: the last 'costs' table that actually has a TOTAL OPERATING COSTS row
  const all = findTables(lines);
  const costTables = all.filter(t => t.kind === 'costs');
  let t1: [number, number] | null = null;
  // A grower's harvest-only table ("GROWER COSTS PER ACRE to HARVEST ALFALFA HAY") is not the production table; it is used only when nothing else has totals.
  const harvestOnly = (t: TableHeading) => /\bTO\s+HARVEST\b/i.test(t.title) && !/PRODUCE|GROW\b/i.test(t.title);
  // Some studies print the same "COST PER ACRE TO PRODUCE" heading over Tables 1, 2 and 3; the operations table is the one
  // with an hours column ("(Hrs/A)").
  const hoursHeader = (sp: [number, number]) => Boolean(find(lines, /\(Hrs|Hrs\/A|\(Horas/i, sp[0], sp[1]));
  for (const pass of [0, 1, 2]) {
    for (let i = costTables.length - 1; i >= 0 && !t1; i--) {
      if (pass < 2 && harvestOnly(costTables[i])) continue;
      const span = spanOf(lines, all, costTables[i]);
      if (pass === 0 && !hoursHeader(span)) continue;
      if (find(lines, opAny, span[0], span[1])) { t1 = span; c.title = costTables[i].title; if (i !== costTables.length - 1) warn('a later costs table had no totals or is a harvest-only table; used an earlier one'); }
    }
    if (t1) break;
  }
  const t2 = tableSpan(lines, 'returns');
  if (!t1) { t1 = t2; const rt = all.filter(t => t.kind === 'returns').pop(); if (t1 && rt) c.title = rt.title; }
  if (!t1) {
    if (parseOnePageBudget(lines, c, warn)) return c;
    warn('no costs-per-acre table found'); return c;
  }
  if (costTables.length > 1) warn('several costs-per-acre tables (establishment and production); using the production one');
  const [s, e] = t1;
  // the operating total row of Table 1: "/ACRE", "/A", "PER ACRE", or no unit; never "/CWT" or "/TON"
  const opHits = perAcreHits(lines, TOTAL_RE.operating, s, e);
  if (!opHits.length && /\bACRE/i.test(c.title ?? '')) opHits.push(...findAll(lines, bareRe(TOTAL_RE.operating), s, e));
  if (opHits.length > 1) warn(`Table 1 has ${opHits.length} TOTAL OPERATING COSTS rows (multi-year table); using the last`);
  const spans: [number, number][] = t2 && t2[0] !== s ? [t1, t2] : [t1];
  // A row with no unit is per acre only when the table itself is per acre; livestock budgets print per-head and whole-herd
  // columns ("TOTAL OPERATING COSTS  $62,226  $622.26") under titles like "COSTS AND RETURNS FOR BEEF COW - CALF PRODUCTION".
  const bare = /\bACRE/i.test(c.title ?? '');
  const cand = {
    op: acreTotals(lines, TOTAL_RE.operating, spans, bare), co: acreTotals(lines, TOTAL_RE.cashOverhead, spans, bare),
    nc: acreTotals(lines, TOTAL_RE.nonCashOverhead, spans, bare), t: acreTotals(lines, TOTAL_RE.total, spans, bare),
  };
  [c.operatingTotal, c.cashOverheadTotal, c.nonCashOverheadTotal, c.totalCost] = [cand.op[0] ?? null, cand.co[0] ?? null, cand.nc[0] ?? null, cand.t[0] ?? null];
  // Tables 1 and 2 can disagree (a misaligned "TOTAL CASH OVERHEAD COSTS/ACRE 2" in Table 2, or Table 1 printing only the
  // investment column of the non-cash row). When the preferred rows do not add up to the printed total cost, take the first
  // printed combination that does.
  const adds = (op: Cited, co: Cited, nc: Cited, t: Cited) => Math.abs(op.value + co.value + nc.value - t.value) <= Math.max(2, 0.005 * t.value);
  if (c.operatingTotal && c.cashOverheadTotal && c.nonCashOverheadTotal && c.totalCost && !adds(c.operatingTotal, c.cashOverheadTotal, c.nonCashOverheadTotal, c.totalCost)) {
    search: for (const t of cand.t) for (const op of cand.op) for (const co of cand.co) for (const nc of cand.nc) {
      if (adds(op, co, nc, t)) {
        warn(`Tables 1 and 2 print different overhead totals; using the rows that add up to TOTAL COSTS/ACRE ${t.value}`);
        [c.operatingTotal, c.cashOverheadTotal, c.nonCashOverheadTotal, c.totalCost] = [op, co, nc, t];
        break search;
      }
    }
  }

  // cash overhead items between CASH OVERHEAD: and TOTAL CASH OVERHEAD
  const coStart = findAll(lines, /^\s*(?:CASH\s*OVERHEAD(?: COSTS)?|GASTOS\s+GENERALES\s+EN\s+EFECTIVO):?\s*$/i, s, e);
  const co = coStart[coStart.length - 1];
  if (co) {
    for (let i = co.line.index + 1; i < e; i++) {
      const t = lines[i].text;
      // any TOTAL line ends the items, including run-together text like "TOTALCASHOVERHEADCOSTS/ACRE"
      if (/^\s*(?:TOTAL|(?:COSTOS|GASTOS)\s+TOTALES)/i.test(t)) break;
      // labels may carry digits ("Crop Insurance (70% Coverage)", "Fuel Tanks (2)"); the value is the last number after a wide gap
      const m = t.match(new RegExp(String.raw`^\s*([A-Za-z].*?)\s{2,}(${NUM})\s*$`));
      if (m) { const v = toNum(m[2]); if (v != null) c.cashOverheadItems.push({ description: clean(m[1]), value: v, page: lines[i].page, quote: clean(t) }); }
    }
    if (!a.landRentPerAcre) {
      const lr = c.cashOverheadItems.find(x => /^land (rent|lease)/i.test(x.description));
      if (lr) a.landRentPerAcre = { value: lr.value, unit: '$/acre/yr', page: lr.page, quote: lr.quote };
    }
  }

  // operations rows: every row of the production cost table up to TOTAL OPERATING COSTS, across continuation pages
  // (the column header repeats on each page, so rows start after the previous TOTAL OPERATING row or the table heading).
  // Category comes from a "Cultural:" style header above, or from a "TOTAL CULTURAL COSTS" line below.
  // the row that closes the operations: the last TOTAL OPERATING row that prints the column totals (a summary block below the
  // table can repeat the total alone)
  const colTotals = (l: Line) => (l.text.match(new RegExp(NUM, 'g')) ?? []).length >= 4;
  let endAt = opHits.length - 1;
  for (let k = opHits.length - 1; k >= 0; k--) if (colTotals(opHits[k].line)) { endAt = k; break; }
  const opEnd = opHits[endAt];
  // A table with no hours column is not laid out by operation (a multi-year table with one column per year, as in the
  // Christmas tree study); its rows are not operations.
  const operationsLayout = Boolean(opEnd) && hoursHeader([s, opEnd.line.index]);
  if (opEnd && !operationsLayout) {
    warn('the production cost table has no hours column; its rows are not read as operations');
    // One column per year (and a per-tree column last): the last number on a total row is not the annual per-acre total.
    const byYear = (x: Cited | null) => x != null && (x.quote.match(new RegExp(NUM, 'g')) ?? []).length >= 5;
    if ([c.operatingTotal, c.cashOverheadTotal, c.nonCashOverheadTotal, c.totalCost].some(byYear)) {
      warn('the production cost table prints one column per year; its totals are not an annual per-acre figure and are left null');
      if (byYear(c.operatingTotal)) c.operatingTotal = null;
      if (byYear(c.cashOverheadTotal)) c.cashOverheadTotal = null;
      if (byYear(c.nonCashOverheadTotal)) c.nonCashOverheadTotal = null;
      if (byYear(c.totalCost)) c.totalCost = null;
    }
  }
  if (opEnd && operationsLayout) {
    const prevTotal = endAt > 0 ? opHits[endAt - 1].line.index : null;
    const from = prevTotal != null ? prevTotal + 1 : s;
    const catOf = (k: string): OperationCategory => {
      const x = k.toLowerCase();
      return x.startsWith('harvest') || x.startsWith('cosecha') ? 'harvest' : x.startsWith('assess') ? 'assessment' : /^pos(?:t|\s*cosecha)/.test(x) ? 'postharvest' : x === 'cultural' || x.startsWith('agron') ? 'cultural' : 'other';
    };
    // Some studies print a second hours column, field labor (Hrs/A), after the operation time: "Time (Hrs/A) Labor (Hrs/A) Labor Cost ...".
    let laborHoursColumn = false;
    // The header reads "(Hrs/A) (Hrs/A)" or, when the text layer loses one, "Time  Labor  Labor  Fuel, Lube ..." under
    // "Operation  Field", or "Machine  Labor  Labor".
    for (let i = from; i < opEnd.line.index; i++) if (/\(Hrs\/A\w*\)\s+\(Hrs\/A\w*\)|\b(?:Time|Machine)\s+Labor\s+Labor\b|\bOperation\s+Field\b/i.test(lines[i].text)) { laborHoursColumn = true; break; }
    // The text layer of some 2018-2019 studies drops the decimal point of the hours column: "Disc 2x   0 50   12   9 ...".
    // When several rows of the table show it, a first pair "0 50" followed by a column gap is read as 0.50.
    const dotLossRe = /^(\s*\S.*?\s{2,})(\d+) (\d{1,2})(?=\s{2,}\d)/;
    let dotLossRows = 0;
    for (let i = from; i < opEnd.line.index; i++) if (dotLossRe.test(lines[i].text)) dotLossRows++;
    const dotLoss = dotLossRows >= 3;
    if (dotLoss) warn('the text layer drops the decimal point of the Table 1 hours column ("0 50"); it is read as 0.50');
    c.operatingInterest = interestRow(lines, from, opEnd.line.index, dotLoss) ?? (t2 && t2[0] !== s ? interestRow(lines, t2[0], find(lines, opAny, t2[0], t2[1])?.line.index ?? t2[1], false) : null);
    let sixColumn = false, blankCells = false;
    type Layout = 'w8' | 'w7lh' | 'w7' | 'w6';
    let lastFull: { layout: Layout; ends: number[] } | null = null;
    let cat: OperationCategory | null = null;
    let section = 'Cultural';
    let pending: OperationRow[] = [];
    const textOnly = (x: string) => /[A-Za-z]/.test(x) && !new RegExp(String.raw`\s{2,}${NUM}\s*$`).test(x);
    // A row whose printed total disagrees with its own cells is a typo in one of them. When the section's printed subtotal
    // equals the sum with the cells' total in place of the row's printed total (and not with the printed totals), the cells win.
    const cellSum = (r: OperationRow) => (r.labor ?? 0) + (r.fuel ?? 0) + (r.lubeRepairs ?? 0) + (r.materials ?? 0) + (r.customRent ?? 0);
    const checkSubtotal = (rows: OperationRow[], l: Line) => {
      const nums = l.text.match(new RegExp(NUM, 'g'));
      const sub = nums ? toNum(nums[nums.length - 1]) : null;
      if (sub == null || !rows.length) return;
      const tol = Math.max(2, 0.002 * sub);
      const printed = rows.reduce((a, r) => a + (r.totalCost ?? 0), 0);
      if (Math.abs(printed - sub) <= tol) return;
      const bad = rows.filter(r => r.totalCost != null && Math.abs(cellSum(r) - r.totalCost) > 1.5);
      const fixed = printed + bad.reduce((a, r) => a + cellSum(r) - r.totalCost!, 0);
      if (!bad.length || Math.abs(fixed - sub) > tol) return;
      for (const r of bad) {
        warn(`Table 1 row "${r.name}" prints a total of ${r.totalCost} but its cells add to ${cellSum(r)}; the section subtotal ${sub} (page ${l.page}) matches the cells, so ${cellSum(r)} is used`);
        r.totalCost = cellSum(r);
      }
    };
    for (let i = from; i < opEnd.line.index; i++) {
      let t = lines[i].text.replace(/[!|]/g, ' ');
      if (dotLoss) t = t.replace(dotLossRe, '$1$2.$3');
      let quote = clean(lines[i].text);
      // A label that wraps prints its numbers on a line of their own: "Pest control - spinosad (Entrust), NR415 oil &" /
      // "0 0 0 0 111.61 87 199" / "helicopter rental". The row takes the label from the line above (and below, when it continues).
      if (/^[\s\d.,$()-]+$/.test(t) && (t.match(new RegExp(NUM, 'g')) ?? []).length >= 6) {
        let j = i - 1;
        while (j >= from && !lines[j].text.trim()) j--;
        const above = j >= from ? lines[j].text : '';
        if (!textOnly(above) || /^\s*TOTAL\b/i.test(above) || /:\s*$/.test(above)) continue;
        let label = clean(above);
        const below = lines[i + 1]?.text ?? '';
        if (i + 1 < opEnd.line.index && textOnly(below) && !/^\s*(TOTAL|Interest|C?OSTOS TOTALES)/i.test(below) && !/:\s*$/.test(below) && (/[&,\-/]$/.test(label) || /^\s*[a-z(]/.test(below))) {
          label = `${label} ${clean(below)}`; quote = `${clean(above)} ${quote} ${clean(below)}`; i++;
        } else quote = `${clean(above)} ${quote}`;
        t = `${label}   ${t.trim()}`;
      }
      const head = t.match(/^\s*([A-Z][A-Za-zÀ-ÿ ,&/()-]{1,40}?)\s*:\s*$/);
      if (head && !/OVERHEAD/i.test(head[1])) { cat = catOf(head[1]); section = clean(t).replace(/:\s*$/, ''); continue; }
      // a section total: "TOTAL CULTURAL COSTS", "COSTOS AGRONÓMICOS TOTALES", "COSTOS TOTALES DE LA COSECHA"
      const tot = t.match(/^\s*TOTAL\s*([A-Z][A-Z -]+?)\s*COSTS?\b/i) ?? t.match(/^\s*COSTOS\s+(?:TOTALES\s+DE\s+(?:LA\s+)?([A-ZÀ-Ü ]+?)|([A-ZÀ-Ü]+)\s+TOTALES)\s{2,}/i);
      if (tot) {
        const k = catOf(tot[1] ?? tot[2]);
        for (const r of pending) if (cat == null) r.category = k;
        checkSubtotal(pending, lines[i]);
        pending = []; continue;
      }
      if (/^\s*(TOTAL|C?OSTOS(?:\s+\S+)?\s+TOTALES|GASTOS\s+TOTALES)/i.test(t) || INTEREST_RE.test(t)) continue;
      // label, then numbers to the end of the line, with each number's end column
      let lm = t.match(new RegExp(String.raw`^\s*(\S.*?)\s{2,}((?:${NUM}\s*)+)$`));
      if (!lm) continue;
      // The hours figure can run into a long label: "Siembra (Incluye ... Replante) 50.00   805   0   0   3,202   0   4,007".
      const runOn = lm[1].match(/^(.*\S)\s(\d+\.\d{2})$/);
      if (runOn && lastFull && (lm[2].match(new RegExp(NUM, 'g')) ?? []).length === lastFull.ends.length - 1) {
        const at = t.lastIndexOf(runOn[2], t.length - lm[2].length);
        lm = Object.assign([t, runOn[1], t.slice(at)], { index: 0 }) as RegExpMatchArray;
      }
      // A label that wraps before its figures: "Disease/insect: Fire blight/codling moth (Agri-Mycin, Mycoshield," / "Intrepid)   0.31 ...".
      let wrapAbove = '';
      if (/^[a-z)]/.test(lm[1]) || /[,&/(-]\s*$/.test(lines[i - 1]?.text ?? '')) {
        const above = lines[i - 1]?.text ?? '';
        if (i - 1 >= from && textOnly(above) && /[,&/(-]\s*$/.test(above) && !/^\s*TOTAL\b|:\s*$/i.test(above)) wrapAbove = clean(above);
      }
      if (wrapAbove) quote = `${wrapAbove} ${quote}`;
      const off = t.length - lm[2].length;
      const toks = [...lm[2].matchAll(new RegExp(NUM, 'g'))].map(x => ({ raw: x[0], end: off + x.index! + x[0].length }));
      let vals: (string | null)[] | null = null;
      let layout: Layout | null = null;
      const full: Layout | null = toks.length === 8 && laborHoursColumn ? 'w8' : toks.length === 7 ? (laborHoursColumn ? 'w7lh' : 'w7') : toks.length === 6 ? 'w6' : null;
      if (full) { vals = toks.map(x => x.raw); layout = full; lastFull = { layout: full, ends: toks.map(x => x.end) }; }
      else if (lastFull && toks.length >= 2 && toks.length < lastFull.ends.length) {
        // A row with blank cells ("Harvest (mechanical)   0.00   600   600"): each number goes to the column whose right edge it
        // shares with the last complete row; blank cells stay null.
        const v: (string | null)[] = lastFull.ends.map(() => null);
        let prev = -1;
        for (const x of toks) {
          let best = -1;
          for (let k = prev + 1; k < lastFull.ends.length; k++) if (Math.abs(lastFull.ends[k] - x.end) <= 4 && (best < 0 || Math.abs(lastFull.ends[k] - x.end) < Math.abs(lastFull.ends[best] - x.end))) best = k;
          if (best < 0) { prev = -2; break; }
          v[best] = x.raw; prev = best;
        }
        if (prev !== -2 && v[v.length - 1] != null) { vals = v; layout = lastFull.layout; blankCells = true; }
      }
      if (!vals || !layout) continue;
      const n = (k: number) => (vals![k] == null ? null : zeroDash(vals![k]!));
      const base = { name: clean(`${wrapAbove} ${lm[1]}`), category: cat ?? 'cultural', section, page: lines[i].page, quote };
      let row: OperationRow;
      if (layout === 'w8') row = { ...base, timeHrsPerAcre: n(0), labor: n(2), fuel: n(3), lubeRepairs: n(4), materials: n(5), customRent: n(6), totalCost: n(7) };
      // time, field labor hours, labor cost, fuel lube & repairs, material, custom, total
      else if (layout === 'w7lh') { row = { ...base, timeHrsPerAcre: n(0), labor: n(2), fuel: n(3), lubeRepairs: null, materials: n(4), customRent: n(5), totalCost: n(6) }; sixColumn = true; }
      else if (layout === 'w7') row = { ...base, timeHrsPerAcre: n(0), labor: n(1), fuel: n(2), lubeRepairs: n(3), materials: n(4), customRent: n(5), totalCost: n(6) };
      else {
        // Studies through about 2015 print one "Fuel, Lube & Repairs" column: six numbers, not seven; combined fuel, lube and
        // repairs goes under fuel and lubeRepairs is null so nothing is double counted. With a field labor hours column, a row
        // with no field labor hours prints six numbers too.
        row = { ...base, timeHrsPerAcre: n(0), labor: n(1), fuel: n(2), lubeRepairs: null, materials: n(3), customRent: n(4), totalCost: n(5) };
        sixColumn = true;
      }
      // the label always has a letter; a bare number in the label slot is a wrapped TOTAL line's figures
      if (!/[A-Za-z]/.test(row.name)) continue;
      c.operations.push(row); pending.push(row);
    }
    if (sixColumn) warn('Table 1 prints one combined fuel, lube and repairs column; it is stored under fuel with lubeRepairs null');
    if (blankCells) warn('some Table 1 rows leave cells blank; their numbers are placed by column position and the blank cells are null');
    if (laborHoursColumn) warn('Table 1 prints a field labor hours column after the operation time; it is not stored');
  }

  // Table 2 returns
  if (t2) {
    const [s2, e2] = t2;
    if (!c.grossReturns && grossReturnsBlock(lines)?.perAcre !== false) c.grossReturns = lastTotal(lines, /^\s*TOTAL GROSS RETURNS\b/i, s2, e2, '$/acre');
    c.netReturnsAboveOperating = lastTotal(lines, /^\s*NET RETURNS? ABOVE OPERATING COSTS?\b/i, s2, e2, '$/acre');
    c.netReturnsAboveTotal = lastTotal(lines, /^\s*NET RETURNS? ABOVE TOTAL COSTS?\b/i, s2, e2, '$/acre');
  }
  return c;
}

// ---------------------------------------------------------------- Table 5 / 6 / business overhead

function parseEquipment(lines: Line[], warn: (s: string) => void): { equipment: EquipmentRow[]; investments: EquipmentRow[]; businessOverhead: BusinessOverheadRow[] } {
  const tables = findTables(lines).filter(t => t.kind === 'equipment');
  if (tables.length > 1) {
    // orchards print an establishment table and a production table; take the last one that has rows
    for (let i = tables.length - 1; i >= 0; i--) {
      const r = parseEquipmentSpan(lines, spanOf(lines, findTables(lines), tables[i]), () => {});
      if (r.equipment.length) { if (i !== tables.length - 1) warn('used an earlier equipment table; the last one had no parsable rows'); return r; }
    }
  }
  return parseEquipmentSpan(lines, tables.length ? spanOf(lines, findTables(lines), tables[tables.length - 1]) : null, warn);
}

function parseEquipmentSpan(lines: Line[], t5: [number, number] | null, warn: (s: string) => void): { equipment: EquipmentRow[]; investments: EquipmentRow[]; businessOverhead: BusinessOverheadRow[] } {
  const equipment: EquipmentRow[] = []; const investments: EquipmentRow[] = []; const businessOverhead: BusinessOverheadRow[] = [];
  const hdrs = findAll(lines, /ANNUAL\s*EQUIPMENT\s*COSTS/i, t5 ? t5[0] : 0, t5 ? t5[1] : lines.length).filter(h => !/…|\.{4,}/.test(h.line.text));
  const hdr = hdrs.length ? hdrs[hdrs.length - 1] : null;
  if (!t5 && !hdr) { warn('no whole-farm equipment table'); return { equipment, investments, businessOverhead }; }
  if (hdrs.length > 1) warn(`${hdrs.length} annual equipment blocks (establishment and production); using the last`);
  const start = hdr ? hdr.line.index : t5![0];
  const end = t5 ? t5[1] : Math.min(lines.length, start + 200);
  const invHdr = find(lines, /ANNUAL INVESTMENT COSTS/i, start, end);
  const bizHdr = find(lines, /ANNUAL BUSINESS OVERHEAD COSTS/i, start, end);
  const eqEnd = invHdr ? invHdr.line.index : bizHdr ? bizHdr.line.index : end;

  // A parsed row must make physical sense or it is dropped with a warning (livestock tables use other columns).
  const sane = (price: number, life: number, salvage: number, cr: number) => price >= 50 && life >= 1 && life <= 60 && salvage >= 0 && salvage <= price && cr >= 0 && cr <= price;
  const inv9 = new RegExp(String.raw`^\s*(\S.*?)\s{2,}(${NUM})\s+(\d+)\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s*$`);
  const inv8 = new RegExp(String.raw`^\s*(\S.*?)\s{2,}(${NUM})\s+(\d+)\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s*$`);
  let dropped = 0;

  // equipment: [yr] desc price life salvage CR ins taxes [total]
  const eqRe = new RegExp(String.raw`^\s*(?:(\d{2})\s+)?(\S.*?)\s{2,}(${NUM})\s+(\d+)\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})(?:\s+(${NUM}))?\s*$`);
  for (let i = start; i < eqEnd; i++) {
    const t = lines[i].text;
    if (/^\s*(TOTAL|\d+% of New Cost|\*)/i.test(t)) continue;
    // a nine-number row inside the equipment block is an investment row (price life salvage CR ins taxes repairs total)
    const m9 = t.match(inv9);
    if (m9 && !/^\d{2}\s/.test(t.trim())) {
      const price = toNum(m9[2]), life = toNum(m9[3]), salvage = toNum(m9[4]), cr = toNum(m9[5]), ins = toNum(m9[6]), tax = toNum(m9[7]), repairs = toNum(m9[8]), total = toNum(m9[9]);
      if ([price, life, salvage, cr, ins, tax].every(v => v != null) && sane(price!, life!, salvage!, cr!)) {
        investments.push({ description: clean(m9[1]), yearCode: null, price: price!, yearsLife: life!, salvageValue: salvage!, capitalRecovery: cr!, insurance: ins!, taxes: tax!, repairs, total, page: lines[i].page, line: clean(t) });
        continue;
      }
    }
    const m = t.match(eqRe);
    if (!m) continue;
    const price = toNum(m[3]), life = toNum(m[4]), salvage = toNum(m[5]), cr = toNum(m[6]), ins = toNum(m[7]), tax = toNum(m[8]), total = toNum(m[9]);
    if ([price, life, salvage, cr, ins, tax].some(v => v == null)) continue;
    if (!sane(price!, life!, salvage!, cr!)) { dropped++; continue; }
    if (total == null) warn(`equipment row without a Total column: ${clean(m[2])}`);
    equipment.push({ description: clean(m[2]), yearCode: m[1] ?? null, price: price!, yearsLife: life!, salvageValue: salvage!, capitalRecovery: cr!, insurance: ins!, taxes: tax!, repairs: null, total, page: lines[i].page, line: clean(t) });
  }
  // investments: desc price life salvage CR ins taxes repairs total  (some older studies omit repairs)
  if (invHdr) {
    const invEnd = bizHdr ? bizHdr.line.index : end;
    for (let i = invHdr.line.index; i < invEnd; i++) {
      const t = lines[i].text;
      if (/^\s*(TOTAL|INVESTMENT\s*$)/i.test(t)) continue;
      let m = t.match(inv9); let repairs: number | null = null; let total: number | null = null;
      let price: number | null, life: number | null, salvage: number | null, cr: number | null, ins: number | null, tax: number | null;
      if (m) { repairs = toNum(m[8]); total = toNum(m[9]); price = toNum(m[2]); life = toNum(m[3]); salvage = toNum(m[4]); cr = toNum(m[5]); ins = toNum(m[6]); tax = toNum(m[7]); }
      else {
        m = t.match(inv8);
        if (!m) continue;
        // Eight numbers is ambiguous: either the salvage cell is blank (price life CR ins taxes repairs total,
        // the usual case for an orchard establishment row) or the table has no repairs column
        // (price life salvage CR ins taxes total). The reading whose parts add up to the total wins.
        const n = [2, 3, 4, 5, 6, 7, 8].map(k => toNum(m![k]));
        const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, 0.01 * Math.abs(b));
        const blankSalvage = n.every(v => v != null) && close(n[2]! + n[3]! + n[4]! + n[5]!, n[6]!);
        const noRepairs = n.every(v => v != null) && close(n[3]! + n[4]! + n[5]!, n[6]!);
        if (blankSalvage && !noRepairs) { price = n[0]; life = n[1]; salvage = 0; cr = n[2]; ins = n[3]; tax = n[4]; repairs = n[5]; total = n[6]; }
        else { price = n[0]; life = n[1]; salvage = n[2]; cr = n[3]; ins = n[4]; tax = n[5]; total = n[6]; }
      }
      if ([price, life, salvage, cr, ins, tax, total].some(v => v == null)) continue;
      if (!sane(price!, life!, salvage!, cr!)) { dropped++; continue; }
      investments.push({ description: clean(m[1]), yearCode: null, price: price!, yearsLife: life!, salvageValue: salvage!, capitalRecovery: cr!, insurance: ins!, taxes: tax!, repairs, total, page: lines[i].page, line: clean(t) });
    }
  }
  if (bizHdr) {
    const bizRe = new RegExp(String.raw`^\s*(\S.*?)\s{2,}(${NUM})\s+([A-Za-z./]+)\s+(${NUM})\s+(${NUM})\s*$`);
    for (let i = bizHdr.line.index; i < end; i++) {
      const t = lines[i].text;
      if (/^\s*TOTAL/i.test(t)) continue;
      const m = t.match(bizRe);
      if (!m || /Description/i.test(m[1])) continue;
      const u = toNum(m[2]), p = toNum(m[4]), tot = toNum(m[5]);
      if (u == null || p == null || tot == null) continue;
      businessOverhead.push({ description: clean(m[1]), unitsPerFarm: u, unit: m[3], pricePerUnit: p, totalCost: tot, page: lines[i].page, line: clean(t) });
    }
  }
  if (dropped) warn(`${dropped} equipment or investment rows dropped because their columns did not make sense (salvage above price, life outside 1 to 60 years)`);
  if (!equipment.length) warn('equipment table present but no equipment rows parsed');
  return { equipment, investments, businessOverhead };
}

function parseHourly(lines: Line[], warn: (s: string) => void): HourlyEquipmentRow[] {
  const out: HourlyEquipmentRow[] = [];
  const t6 = tableSpan(lines, 'hourly');
  const hs = findAll(lines, /HOURLY\s*EQUIPMENT\s*COSTS/i, t6 ? t6[0] : 0).filter(h => !/…|\.{4,}/.test(h.line.text) && !/^\s*Table\s+\d+\..*\s\d{1,3}\s*$/.test(h.line.text));
  const hdr = t6 ? hs.find(h => h.line.index >= t6[0]) ?? hs[hs.length - 1] : hs[hs.length - 1];
  if (!hdr) return out;
  const start = hdr.line.index; const end = t6 ? t6[1] : Math.min(lines.length, start + 120);
  // [yr] desc hoursUsed [totalHours] CR ins taxes repairs fuel totalOper totalCost
  const re9 = new RegExp(String.raw`^\s*(?:\d{2}\s+)?(\S.*?)\s{2,}(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s*$`);
  const re8 = new RegExp(String.raw`^\s*(?:\d{2}\s+)?(\S.*?)\s{2,}(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s*$`);
  // does the header have a "Total Hours" column?
  const headerHasTotalHours = lines.slice(start, Math.min(end, start + 12)).some(l => /Total\s+Hours|Hours\s+Hours/i.test(l.text) || /^\s*Hours\s+Hours/i.test(l.text));
  for (let i = start; i < end; i++) {
    const t = lines[i].text;
    if (/^\s*(TOTAL|Yr\.?\s|Description)/i.test(t)) continue;
    let m = t.match(re9); let hasTotalHours = true;
    if (!m || !headerHasTotalHours) { const m8 = t.match(re8); if (m8 && !headerHasTotalHours) { m = m8; hasTotalHours = false; } }
    if (!m) continue;
    const v = m.slice(2).map(toNum);
    if (v.some(x => x == null)) continue;
    const nums = v as number[];
    const [hoursUsedOnCrop, totalHours, rest] = hasTotalHours ? [nums[0], nums[1], nums.slice(2)] : [nums[0], null, nums.slice(1)];
    const [capitalRecoveryPerHr, insurancePerHr, taxesPerHr, repairsPerHr, fuelPerHr, totalOperatingPerHr, totalCostPerHr] = rest;
    out.push({ description: clean(m[1]), hoursUsedOnCrop, totalHours, capitalRecoveryPerHr, insurancePerHr, taxesPerHr, repairsPerHr, fuelPerHr, totalOperatingPerHr, totalCostPerHr, page: lines[i].page, line: clean(t) });
  }
  if (!out.length) warn('Table 6 present but no hourly rows parsed');
  return out;
}


// ---------------------------------------------------------------- monthly cash costs

const MONTH_INDEX: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  ENE: 0, ABR: 3, AGO: 7, SET: 8, DIC: 11,
};
interface MonthColumn { month: number | 'total'; end: number; token: string }

/** Read a header line like "  SEP  OCT ... AUG  Total" into columns with their right-edge positions.
 *  Month words may carry a year ("18ENE", "JAN 16") or a label before them ("Operation", "Cultural:").
 *  The columns are the longest run of calendar-consecutive months on the line, plus a Total after it. Null if there is no such run. */
export function monthHeader(text: string): MonthColumn[] | null {
  const words: { month: number; end: number; token: string; start: number }[] = [];
  const re = /(?<![A-Za-z])(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|ENE|ABR|AGO|SET|DIC)[A-Za-z]*\.?/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = m[1].toUpperCase();
    // "May" inside prose would match; a header word is short
    if (m[0].length > 10) continue;
    words.push({ month: MONTH_INDEX[key], end: m.index + m[0].length, token: m[0], start: m.index });
  }
  if (words.length < 4) return null;
  // longest run of consecutive months
  let best: [number, number] = [0, 0];
  for (let i = 0; i < words.length; i++) {
    let j = i;
    while (j + 1 < words.length && words[j + 1].month === (words[j].month + 1) % 12) j++;
    if (j - i > best[1] - best[0]) best = [i, j];
  }
  const run = words.slice(best[0], best[1] + 1);
  if (run.length < 4) return null;
  // anything other than years, dots and a Total word between the run start and the end of the line means this is not a header
  const tail = text.slice(run[0].start);
  const stripped = tail.replace(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|ENE|ABR|AGO|SET|DIC)[A-Za-z]*\.?/gi, ' ').replace(/\bTOTAL\b/gi, ' ').replace(/\b\d{2}(\d{2})?\b/g, ' ').replace(/[.\s]/g, '');
  if (stripped.length) return null;
  const cols: MonthColumn[] = run.map(w => ({ month: w.month, end: w.end, token: w.token }));
  const tot = /\bTOTAL\b/i.exec(tail);
  if (tot) cols.push({ month: 'total', end: run[0].start + tot.index + tot[0].length, token: tot[0] });
  return cols;
}

/** Numbers on a row with their right-edge positions, skipping the label and percentages. */
export function rowNumbers(text: string, firstColEnd: number): { value: number; end: number }[] {
  const out: { value: number; end: number }[] = [];
  const re = /(?<![\w.])(\(?-?\$?[\d,]*\d(?:\.\d+)?\)?)(?![\w%])/g; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (end < firstColEnd - 10) continue;            // still inside the row label
    const v = toNum(m[1]);
    if (v != null) out.push({ value: v, end });
  }
  return out;
}

/** Assign each number on a row to the nearest column by right edge. Tolerance scales with the column spacing. */
export function mapRow(text: string, cols: MonthColumn[]): { months: number[]; total: number | null; assigned: number } {
  const months = Array.from({ length: 12 }, () => 0);
  let total: number | null = null; let assigned = 0;
  const gaps = cols.slice(1).map((c, i) => c.end - cols[i].end).sort((a, b) => a - b);
  const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 10;
  const tol = Math.max(8, gap * 0.6);
  const nums = rowNumbers(text, cols[0].end);
  // A dense row (one number per column, as the TOTAL rows always are) reads left to right; pdftotext's
  // column positions drift when the header is centered, so positions are only used for sparse rows.
  if (nums.length === cols.length) {
    cols.forEach((c, i) => { if (c.month === 'total') total = nums[i].value; else { months[c.month] += nums[i].value; assigned++; } });
    return { months, total, assigned };
  }
  for (const n of nums) {
    let best = cols[0]; let bestD = Infinity;
    for (const c of cols) { const d = Math.abs(c.end - n.end); if (d < bestD) { bestD = d; best = c; } }
    if (bestD > tol) continue;
    if (best.month === 'total') total = n.value; else { months[best.month] += n.value; assigned++; }
  }
  return { months, total, assigned };
}

// Row labels. Some older PDFs lose the spaces ("TOTALCASH COSTS/ACRE"), so spaces are optional.
const CASH_ROW = /^\s*(?:TOTAL\s*CASH\s*COSTS?(?:\s*\/\s*ACRE)?|TOTAL DE COSTOS EN EFECTIVO(?:\s*\/\s*ACRE)?|COSTOS TOTALES (?:EN|DE) EFECTIVO(?:\s*\/\s*ACRE)?)\s/i;
const OPER_ROW = /^\s*(?:TOTAL\s*OPERATING\s*COSTS?(?:\s*\/\s*ACRE)?|COSTOS TOTALES DE OPERACI[ÓO]N(?:\s*\/\s*ACRE)?)\s/i;
const OVH_ROW = /^\s*(?:TOTAL\s*CASH\s*OVERHEAD\s*COSTS?(?:\s*\/\s*ACRE)?|COSTOS TOTALES GENERALES EN\b|GASTOS TOTALES GENERALES EN EFECTIVO(?:\s*\/\s*ACRE)?)\s/i;
const HARV_ROW = /^\s*(?:TOTAL\s*HARVEST(?:ING)?\s*COSTS?|COSTOS TOTALES DE (?:LA )?COSECHA)\s/i;
const HARV_HEAD = /^\s*(?:Harvest|Cosecha)[^:]*:\s*$/i;
// The ranging analysis sometimes follows the monthly table without its own TABLE heading; stop there.
const RANGING_MARK = /^\s*(?:OPERATING COSTS\s*\/\s*ACRE\s*:|COSTS PER ACRE AT VARYING|YIELD\s*\(|RANGING ANALYSIS|AN[ÁA]LISIS DE RANGO)/i;

function parseMonthlySpan(lines: Line[], span: [number, number], title: TableHeading): { monthly: MonthlyCosts | null; reason: string | null } {
  const [s, e] = span;
  let cols: MonthColumn[] | null = null; let columns: string[] = [];
  const rows: { kind: 'cash' | 'oper' | 'ovh' | 'harv' | 'harvItem'; months: number[]; total: number | null; assigned: number }[] = [];
  let inHarvest = false;
  for (let i = s; i < e; i++) {
    const t = lines[i].text;
    if (cols && RANGING_MARK.test(t)) break;
    const h = monthHeader(t);
    if (h) { cols = h; if (!columns.length) columns = h.filter(c => c.month !== 'total').map(c => c.token); continue; }
    if (!cols) continue;
    if (HARV_HEAD.test(t)) { inHarvest = true; continue; }
    if (/^\s*[A-Za-z][^:\d]*:\s*$/.test(t)) { inHarvest = false; continue; } // another category header
    const kind = CASH_ROW.test(t) ? 'cash' : OPER_ROW.test(t) ? 'oper' : OVH_ROW.test(t) ? 'ovh' : HARV_ROW.test(t) ? 'harv'
      : inHarvest && !/^\s*(TOTAL|COSTOS TOTALES|GASTOS TOTALES)/i.test(t) ? 'harvItem' : null;
    if (kind === 'harv') inHarvest = false;
    if (!kind) { if (/^\s*(TOTAL|COSTOS TOTALES|GASTOS TOTALES)/i.test(t)) inHarvest = false; continue; }
    const r = mapRow(t, cols);
    if (kind !== 'harvItem' && r.assigned === 0) continue;
    rows.push({ kind, ...r });
  }
  if (!cols) return { monthly: null, reason: 'no month header line found' };
  if (!cols.some(c => c.month === 'total')) return { monthly: null, reason: 'month header has no Total column, so rows cannot be checked' };
  const last = (k: string) => [...rows].reverse().find(r => r.kind === k) ?? null;
  const cash = last('cash'); const oper = last('oper'); const ovh = last('ovh');
  const check = (months: number[], total: number | null, how: string): string | null => {
    if (total == null) return `${how} has no Total column value`;
    const sum = months.reduce((a, b) => a + b, 0);
    const tol = Math.max(3, Math.abs(total) * 0.02);
    return Math.abs(sum - total) > tol ? `${how}: months sum to ${Math.round(sum)} but the Total column says ${total}` : null;
  };
  let cashMonths: number[] | null = null; let totalCheck: number; let checkedRow: string;
  if (cash) {
    const bad = check(cash.months, cash.total, 'TOTAL CASH COSTS row');
    if (bad) return { monthly: null, reason: bad };
    cashMonths = cash.months; totalCheck = cash.total!; checkedRow = 'TOTAL CASH COSTS';
  } else if (oper && ovh) {
    const months = oper.months.map((v, i) => v + ovh.months[i]);
    const total = oper.total != null && ovh.total != null ? oper.total + ovh.total : null;
    const bad = check(months, total, 'TOTAL OPERATING COSTS + TOTAL CASH OVERHEAD rows');
    if (bad) return { monthly: null, reason: bad };
    cashMonths = months; totalCheck = total!; checkedRow = 'TOTAL OPERATING COSTS + TOTAL CASH OVERHEAD';
  } else if (oper) {
    // the table only spreads operating costs by month; cash overhead is not given monthly
    const bad = check(oper.months, oper.total, 'TOTAL OPERATING COSTS row');
    if (bad) return { monthly: null, reason: bad };
    totalCheck = oper.total!; checkedRow = 'TOTAL OPERATING COSTS (table has no cash overhead rows)';
  } else return { monthly: null, reason: 'no TOTAL CASH COSTS, TOTAL OPERATING COSTS or cash overhead rows found under the month header' };
  const harvRow = last('harv');
  const harvestMonths = Array.from({ length: 12 }, (_, i) => harvRow ? harvRow.months[i] !== 0 : rows.filter(r => r.kind === 'harvItem').some(r => r.months[i] !== 0));
  const seen = new Set<number>(); let spansTwoYears = false;
  for (const c of cols) if (c.month !== 'total') { if (seen.has(c.month)) spansTwoYears = true; seen.add(c.month); }
  const basisM = title.title.match(/PER\s+([\d,]+\s*LF|ACRE|HEAD|COW|TREE|VINE)/i);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    monthly: {
      basis: basisM ? clean(basisM[0]).toLowerCase().replace(/\s+/g, ' ') : 'per acre',
      cashCostsPerAcre: cashMonths ? cashMonths.map(r2) : null,
      operatingPerAcre: oper ? oper.months.map(r2) : null,
      harvestMonths, totalCheck, checkedRow, columns, spansTwoYears, page: title.page, quote: clean(title.title),
    },
    reason: null,
  };
}

function parseMonthly(lines: Line[], warn: (s: string) => void): MonthlyCosts | null {
  const all = findTables(lines);
  let cands = all.filter(t => t.kind === 'monthly');
  if (!cands.length) {
    const hdr = lines.find(l => monthHeader(l.text));
    if (!hdr) return null;
    cands = [{ kind: 'monthly', number: 0, title: 'monthly table without a heading', index: Math.max(0, hdr.index - 3), page: hdr.page }];
    warn('monthly table has no TABLE heading; parsed from the month header line');
  }
  // production year over establishment: drop ESTABLISH titles when a production title exists
  const prod = cands.filter(t => !/ESTABLISH|DEVELOP|ESTABLEC/i.test(t.title));
  const ordered = prod.length ? prod : cands;
  const reasons: string[] = [];
  for (let i = ordered.length - 1; i >= 0; i--) {
    const t = ordered[i];
    const span: [number, number] = all.length ? spanOf(lines, all, t) : [t.index, Math.min(lines.length, t.index + 150)];
    const r = parseMonthlySpan(lines, span, t);
    if (r.monthly) {
      if (i !== ordered.length - 1) warn('used an earlier monthly table; the last one did not reconcile');
      if (r.monthly.cashCostsPerAcre == null) warn('monthly table gives operating costs by month only; cash overhead is not spread by month in this study');
      if (r.monthly.basis !== 'per acre') warn(`monthly table is ${r.monthly.basis}, not per acre`);
      return r.monthly;
    }
    if (r.reason) reasons.push(`${t.title}: ${r.reason}`);
  }
  warn(`monthly table not used: ${reasons.join('; ') || 'no rows parsed'}`);
  return null;
}


// ---------------------------------------------------------------- establishment (perennials)

const ORDINAL: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const wordOrNum = (w: string | undefined): number | null => {
  if (!w) return null;
  const k = w.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^\d+$/.test(k)) return Number(k);
  if (k in WORD_NUM) return WORD_NUM[k];
  if (k in ORDINAL) return ORDINAL[k];
  const more: Record<string, number> = { seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  return k in more ? more[k] : null;
};
/** All numbers at the end of a table row, in order (dashes count as zero). */
function tailNumbers(text: string): number[] {
  const m = text.match(new RegExp(String.raw`((?:\s+(?:${NUM}|[-—]))+)\s*$`));
  if (!m) return [];
  return m[1].trim().split(/\s+/).map(zeroDash).filter((n): n is number => n != null);
}


/** An establishment label: "Establishment", "Establish Vineyard", "Established ...". */
const ESTABLISH_WORD = /\bestablish(?:ment|ed)?\b/i;
/** Acre counts in a row label ("Tilled 40 Acres", "40Ac", "(10 Ac)") blanked to spaces, so they are not read as values. */
/** The establishment row of the investment table ("Establishment Costs 160 Ac", "Establish Pasture: Tilled 40 Ac"); not a
 *  re-establishment, not the land ("Land - Established Apples (20Acres)"). */
const isEstablishRow = (d: string) => ESTABLISH_WORD.test(d) && !/re-?establish|\bland\b/i.test(d);
const stripAcres = (text: string) => text.replace(/\(?(?<![\d.,])\d[\d,]*\s*-?\s*ac(?:res?|\.)?(?![a-z])\)?/gi, m => ' '.repeat(m.length));

// ---------------------------------------------------------------- establishment table, row by row

const EST_FURNITURE = /Costs? (&|and) Returns? Study|^\s*UCCE, Sample Costs|\bPage\s+\d+\s*$|UC COOPERATIVE EXTENSION|UC DAVIS|^\s*TABLE \d+\.?\s*CONTINUED|^\s*Costs? per Acre\s*$|^\s*Cost Per Acre\s*$|^\s*\(?Continued\)?\s*$/i;

/** Character position where each year header token ends; numbers below are right-aligned to these.
 *  `extra` counts trailing non-year columns printed after the years (a TOTAL or $/Tree column); their ends are
 *  kept at the end of `ends` so their numbers do not land in a year column, and the table drops them. */
function yearColumns(text: string): { labels: string[]; ends: number[]; zoneStart: number; extra?: number } | null {
  const tokens = (rest: string, base: number, tokRe: RegExp, max = 10) => {
    const labels: string[] = []; const ends: number[] = [];
    let t: RegExpExecArray | null;
    while ((t = tokRe.exec(rest))) { labels.push(t[0].trim().replace(/^(\d+)(s|n|r|t) (t|d|h)$/i, '$1$2$3')); ends.push(base + t.index + t[0].length); }
    if (labels.length < 2 || labels.length > max) return null;
    return { labels, ends, zoneStart: base + rest.search(/\S/) - 9 };
  };
  const EST = String.raw`Est(?:ab)?\w*(?:\/(?:\d+(?:st|nd|rd|th)|(?:Year|Yr)[-.]?\s*\d+))?`;
  // "Year:  1st  2nd  3rd" (most studies)
  const m = text.match(/(?:\bYear|\bA[ñn]o):\s*(\S.*)$/i);
  if (m) {
    const r = tokens(m[1], text.length - m[1].length, new RegExp(String.raw`(?:${EST}|\d+(?:st|nd|rd|th)|Year\s*\d+|\b\d{1,2}\b)`, 'gi'));
    if (r && r.labels.length <= 8) return r;
  }
  // A header whose tail is nothing but year tokens, optionally after a label ("Operation", "OPERATING COSTS:", "Year")
  // and before a "Your Costs" column: "Estab/1st 2nd 3rd ... Your Costs", "Yr. 1 Yr.2 ...", "Year 1 Year2 ...", "Year 1st 2nd ...",
  // "Estab/Yr-1 Yr-2 ...". A last "Production" column (the first production year) counts as a year column;
  // trailing TOTAL and $/Tree columns are kept as extra columns.
  let body = text.replace(/\s+Your\s+Costs?\s*$/i, '');
  const extraM = body.match(/(?:\s+(?:TOTAL|\*?\$\/Tree))+\s*$/i);
  const extraText = extraM && extraM.index != null ? body.slice(extraM.index) : '';
  if (extraM && extraM.index != null) body = body.slice(0, extraM.index);
  // ordinals may come apart in the text layer ("1s t")
  const YT = String.raw`(?:${EST}|\d{1,2}(?:s ?t|n ?d|r ?d|t ?h)\b|(?:Year|Yr)[.-]?\s*\d{1,2})`;
  const tail = body.match(new RegExp(String.raw`((?:\s+|^)${YT}(?:\s+${YT})+(?:\s+Production)?)\s*$`, 'i'));
  if (!tail || tail.index == null) return null;
  const label = body.slice(0, tail.index).trim();
  if (label && !/^(Operations?:?|OPERATING COSTS:?|Years?:?|Cost per Acre.*)$/i.test(label)) return null;
  const r = tokens(tail[1], tail.index, new RegExp(String.raw`${YT}|Production`, 'gi'), 12);
  if (!r) return null;
  // the tokens must count up from the first year (Estab counts as year 1)
  const yearLabels = r.labels.filter(l => !/^Production$/i.test(l));
  const nums = yearLabels.map(l => /^Est/i.test(l) && !/\d/.test(l.replace(/^Est\w*/i, '')) ? 1 : Number(l.match(/\d+/g)!.pop()));
  if (!nums.every((n, i) => n === nums[0] + i) || nums[0] > 2) return null;
  if (extraText) {
    const ex = tokens(extraText, body.length, /TOTAL|\*?\$\/Tree/gi, 4) ?? (() => { const t = /TOTAL|\*?\$\/Tree/i.exec(extraText)!; return { labels: [t[0]], ends: [body.length + t.index + t[0].length], zoneStart: 0 }; })();
    return { labels: [...r.labels, ...ex.labels], ends: [...r.ends, ...ex.ends], zoneStart: r.zoneStart, extra: ex.labels.length };
  }
  return r;
}

/** The trailing run of numbers (or dashes) on a row, each at or past the numeric zone. Anything before them is the label. */
function numericTokens(text: string, zoneStart: number): { value: number | null; start: number; end: number; raw: string }[] {
  const re = new RegExp(String.raw`(${NUM}|[-—])(?=\s|$)`, 'g');
  const all: { value: number | null; start: number; end: number; raw: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > 0 && !/\s/.test(text[m.index - 1])) continue;
    all.push({ value: zeroDash(m[1]), start: m.index, end: m.index + m[1].length, raw: m[1] });
  }
  // keep only the trailing run: tokens after the last non-numeric word
  const out: typeof all = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const tok = all[i];
    const between = i + 1 < all.length ? text.slice(tok.end, all[i + 1].start) : text.slice(tok.end);
    if (between.trim() !== '') break;
    if (tok.start < zoneStart) break;
    out.unshift(tok);
  }
  // a short run glued to its label by single spaces ends a wrapped label ("30 irrigations yr. 2 -"); it holds no values
  const glued = (k: number) => k < out.length && out[k].start >= 2 && text[out[k].start - 1] === ' ' && text[out[k].start - 2] !== ' ';
  if (out.length && out.length <= 2 && out.every((_, k) => glued(k)) && /[A-Za-z]/.test(text.slice(0, out[0].start))) return [];
  return out;
}

/** Place row numbers into year columns by their right edge; when the count matches the columns, in order. */
function placeValues(tokens: { value: number | null; end: number }[], ends: number[]): (number | null)[] {
  const values: (number | null)[] = ends.map(() => null);
  if (tokens.length === 0) return values;
  if (tokens.length === ends.length) { tokens.forEach((t, i) => { values[i] = t.value; }); return values; }
  for (const t of tokens) {
    let best = 0, bestD = Infinity;
    ends.forEach((e, i) => { const d = Math.abs(e - t.end); if (d < bestD) { bestD = d; best = i; } });
    if (values[best] == null) values[best] = t.value;
    else { const alt = ends.findIndex((e, i) => values[i] == null && Math.abs(e - t.end) <= bestD + 6); if (alt >= 0) values[alt] = t.value; }
  }
  return values;
}

/** A continuation page printed without a year header: its own column positions, from the rows that fill every column. */
function pageColumns(lines: Line[], from: number, to: number, cols: { labels: string[]; ends: number[]; zoneStart: number }): { labels: string[]; ends: number[]; zoneStart: number } {
  const n = cols.labels.length; const page = lines[from].page;
  const full: { start: number; end: number }[][] = [];
  for (let i = from; i < to && lines[i].page === page; i++) {
    const toks = numericTokens(lines[i].text.replace(/[!|]/g, ' '), 0);
    if (toks.length === n && /[A-Za-z]/.test(lines[i].text)) full.push(toks);
  }
  if (full.length < 2) return cols;
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const ends = cols.ends.map((_, c) => median(full.map(t => t[c].end)));
  return { labels: cols.labels, ends, zoneStart: Math.min(...full.map(t => t[0].start)) - 2 };
}

function rowKind(label: string, section: string): EstablishmentTableRow['kind'] {
  const L = label.toUpperCase();
  if (/^INTEREST ON OPERATING/.test(L)) return 'interest';
  if (/^(?:LESS )?(INCOME|RETURNS?|REVENUE)(?:\/ACRE| FROM PRODUCTION| PER ACRE| FROM SALE)/.test(L)) return 'income';
  if (/ACCUMULATED|^CUMULATIVE|ACUMULAD/.test(L)) return 'accumulated';
  // Spanish studies
  if (/^INGRESOS?\b/.test(L)) return 'income';
  if (/^COSTOS? (?:TOTAL(?:ES)? )?NETOS?\b|^COSTO TOTAL NETO/.test(L)) return 'net';
  if (/^(?:COSTOS? TOTAL(?:ES)?\b|TOTAL DE COSTOS|COSTO\/ACRE TOTAL|COSTO TOTAL GENERAL)/.test(L)) return 'total';
  if (/^(TOTAL )?NET\b|^(NET )?PROFIT/.test(L)) return 'net';
  // the text layer of some studies splits words ("TOTAL OPERATING COS TS /ACRE"), so totals are also matched without spaces
  const D = L.replace(/\s+/g, '');
  if (/^TOTAL(?:ALL)?(OPERATING|CASHOVERHEAD|CASHCOSTS?|NON-?CASH|INTERESTONINVESTMENT|COSTS?\/ACRE|COSTS?PERACRE|COSTS?FORTHEYEAR)/.test(D) || /^TOTALALLCOSTS?(?![A-Z])/.test(D)) return 'total';
  if (/^TOTAL .*(COSTS?|EXPENSES?)\b/.test(L) || /^TOTAL.*(COSTS?|EXPENSES?)$/.test(D)) return 'subtotal';
  if (/^INTERESTONOPERATING/.test(D)) return 'interest';
  if (/^ACCUMULATED|^CUMULATIVE/.test(D)) return 'accumulated';
  if (/OVERHEAD/i.test(section.replace(/\s+/g, ''))) return 'overheadItem';
  return 'operation';
}

/** An establishment table title; the text layer sometimes splits words ("ES TABLIS H"). */
const isEstablishTitle = (title: string) => /ESTABLISH|DEVELOP|ESTABLEC/i.test(title.replace(/\s+/g, ''));

function parseEstablishmentTable(lines: Line[], all: TableHeading[], warn: (s: string) => void): EstablishmentTable | null {
  const estTables = all.filter(t => isEstablishTitle(t.title));
  if (!estTables.length) return null;
  // A table printed over several pages may repeat its heading ("..., Cont.", or the same title again);
  // those repeats are part of the same table, not a new one.
  const norm = (x: string) => x.replace(/[\W_]+$/, '').toUpperCase();
  const isContinuation = (t: TableHeading, x: TableHeading) => x.number === t.number && (norm(x.title).startsWith(norm(t.title)) || norm(t.title).startsWith(norm(x.title)) || /\bcont(?:\.|inued|d\.?)?\W*$/i.test(x.title));
  const firsts = estTables.filter((t, i) => !estTables.slice(0, i).some(x => isContinuation(x, t)));
  const tables: EstablishmentTable[] = [];
  for (const t of firsts) {
    const next = all.find(x => x.index > t.index && !isContinuation(t, x));
    const [a, b] = [t.index, next ? next.index : lines.length];
    let cols: ReturnType<typeof yearColumns> = null;
    let labels: string[] | null = null; // the column labels as the first page prints them
    const rows: EstablishmentTableRow[] = [];
    let yieldRow: EstablishmentTable['yieldRow'] = null;
    let section = '';
    let carry: EstablishmentTableRow | null = null; // a heading line that carried numbers belonging to the next label
    let page = -1;
    let awaitingHeader = true; // every page opens with furniture (title, region, 'Costs per Acre') until its Year: header
    let sinceHeader = 0;       // body rows since the last header; the yield line only ever sits right under a header
    let wrapped: EstablishmentTableRow | null = null;              // a row whose numbers came on a line of their own
    let orphan: { values: (number | null)[]; raw: string } | null = null; // numbers printed above the label they belong to
    let pageHasHeader = false; // continuation pages without a year header keep the previous page's columns
    let extra = 0;             // trailing TOTAL / $/Tree columns after the years, dropped from the table
    for (let i = a + 1; i < b; i++) {
      const raw = lines[i].text;
      if (lines[i].page !== page) {
        page = lines[i].page; awaitingHeader = true;
        let j = i; while (j < b && lines[j].page === page && !yearColumns(lines[j].text)) j++;
        pageHasHeader = j < b && lines[j].page === page;
      }
      if (!raw.trim()) continue;
      // a continuation heading with no year header under it: the page keeps the columns of the page before
      if (/^\s*(?:TABL[EA]|TAHLE)\s*\d+/i.test(raw) || /^\s*(?:\S.*)?\bcont(?:\.|inued|d\.)\W*$/i.test(raw)) { if (cols && !pageHasHeader) { awaitingHeader = false; sinceHeader = 0; cols = pageColumns(lines, i, b, cols); } continue; }
      if (EST_FURNITURE.test(raw)) continue;
      const yc = yearColumns(raw);
      if (yc) {
        if (!cols || yc.labels.length >= cols.labels.length) { if (!labels || yc.labels.length !== labels.length) { labels = yc.labels; extra = yc.extra ?? 0; } cols = yc; }
        awaitingHeader = false; sinceHeader = 0; continue;
      }
      if (!cols || awaitingHeader) continue;
      const text = raw.replace(/[!|]/g, ' ');
      const toks = numericTokens(text, cols.zoneStart);
      const labelEnd = toks.length ? toks[0].start : text.length;
      const label = clean(text.slice(0, labelEnd));
      if (!label && !toks.length) continue;
      // page furniture above the first row of a continuation page printed without a usable year header:
      // the region subtitle ("SIERRA NEVADA FOOTHILLS-2015"), a "YOUR / COSTS" column title, a year header split over two lines
      if (sinceHeader === 0 && !toks.length && (/^(YOUR|COSTS?|YOUR COSTS?|Years?)$/i.test(label) || (label.match(/\b(?:Yr|Year)[-.]?\s*\d|\b\d{1,2}(?:st|nd|rd|th)\b|\bEstab/gi) ?? []).length >= 2 || (/^[A-Z][A-Z\s,&().'-]+-\s*\d{4}$/.test(label) && !/:/.test(label)))) continue;
      const prev = rows.length ? rows[rows.length - 1] : null;
      const prevOpen = !!prev && prev.kind !== 'heading' && prev.values.every(v => v == null);
      // A label wrapped over two or three lines prints its numbers on a line of their own, or on the line of
      // its second half: "Weed control - weed whipping (4x/yrs.1 - 5; 3x/yr.6;" / "  28  28 ..." / "2x/yr.7)".
      if (!label) {
        if (!toks.length) continue;
        // a lone number is a page number, unless the label above is visibly unfinished
        const unfinished = !!prev && ((prev.label.match(/\(/g) ?? []).length > (prev.label.match(/\)/g) ?? []).length || /[&,;\-–+]$/.test(prev.label));
        if (toks.length < 2 && !unfinished) continue;
        if (prevOpen) { prev!.values = placeValues(toks, cols.ends); prev!.quote = clean(`${prev!.quote} ${raw}`); wrapped = prev; }
        else orphan = { values: placeValues(toks, cols.ends), raw };
        continue;
      }
      const unbalanced = (x: string) => (x.match(/\(/g) ?? []).length > (x.match(/\)/g) ?? []).length;
      const looksContinued = /^[a-z0-9)(]/.test(label) || (!!prev && unbalanced(prev.label)) || (!!prev && /[&,;\-–]$/.test(prev.label));
      if (prev && prev.kind !== 'heading' && looksContinued && !/:\s*$/.test(label)) {
        if (!toks.length && wrapped === prev) { prev.label = clean(`${prev.label} ${label}`); prev.quote = clean(`${prev.quote} ${raw}`); prev.kind = rowKind(prev.label, section); wrapped = null; continue; }
        if (toks.length && prevOpen) { prev.label = clean(`${prev.label} ${label}`); prev.quote = clean(`${prev.quote} ${raw}`); prev.values = placeValues(toks, cols.ends); prev.kind = rowKind(prev.label, section); continue; }
      }
      wrapped = null;
      // yield or price line under the header (repeats on continuation pages)
      if (sinceHeader === 0 && /(yield|price|\$|per acre|tons? per|lbs? per|pounds per)/i.test(label) && /(per acre|per ton|tons?\b|lbs?\b|pounds|cartons?|boxes|trays?|bins?)/i.test(label) && !/^(total|net|income|accumulated)/i.test(label)) {
        if (toks.length && !yieldRow) yieldRow = { label: label.replace(/^Operation:?\s*/i, ''), values: placeValues(toks, cols.ends), quote: clean(raw) };
        continue;
      }
      if (/^Operation:?$/i.test(label)) continue;
      if (sinceHeader === 0 && !toks.length && /^Costs? .*a ?c ?r ?e/i.test(label) && label.length < 30) continue; // "Cost per acre ($)" under the header
      sinceHeader++;
      // also a numbered heading without a colon: "II. CASH OVERHEAD COSTS", "III. NON-CASH OVERHEAD COSTS (Depreciation & Interest)"
      const roman = !toks.length && /^(?:I|II|III|IV|V)\.\s+[A-Z][A-Z\s()&,-]*COSTS?\b/.test(label);
      const isHeading = (/:\s*$/.test(label) && (!toks.length || /costs?:$/i.test(label))) || (!toks.length && /^[A-Za-z][^:()]{1,60}:\s*\([^)]*\)$/.test(label)) || roman;
      if (isHeading) {
        orphan = null; wrapped = null;
        section = label.replace(/^(?:I|II|III|IV|V)\.\s+/, '').replace(/:\s*(?:\([^)]*\))?\s*$/, '');
        const heading: EstablishmentTableRow = { label: section, kind: 'heading', section, values: cols.labels.map(() => null), page: lines[i].page, quote: clean(raw) };
        rows.push(heading);
        carry = toks.length ? { ...heading, values: placeValues(toks, cols.ends) } : null;
        continue;
      }
      let values = placeValues(toks, cols.ends);
      let quote = clean(raw);
      if (!toks.length && carry) { values = carry.values; carry = null; }
      else carry = null;
      if (!toks.length && orphan) { values = orphan.values; quote = clean(`${orphan.raw} ${raw}`); }
      orphan = null;
      const kind = rowKind(label, section);
      rows.push({ label, kind, section, values, page: lines[i].page, quote });
    }
    // text after the table on its last page (a chart's labels) leaves rows with no values at the end
    while (rows.length && rows[rows.length - 1].values.every(v => v == null)) rows.pop();
    if (!cols || rows.filter(r => r.kind !== 'heading').length < 5) continue;
    const years = labels ?? cols.labels;
    if (extra) {
      const n = years.length - extra;
      for (const r of rows) r.values = r.values.slice(0, n);
      if (yieldRow) yieldRow.values = yieldRow.values.slice(0, n);
      tables.push({ title: t.title, years: years.slice(0, n), rows, yieldRow });
    } else tables.push({ title: t.title, years, rows, yieldRow });
  }
  if (!tables.length) return null;
  // One table per region in some studies (San Diego and Riverside); the production tables are read from the last
  // one, so the establishment table is the last one too. Otherwise the fullest table.
  const distinct = new Set(tables.map(t => t.title)).size > 1 && tables.every(t => /\bin\s+[A-Z][\w\s,&]*Count(?:y|ies)/.test(t.title));
  let best: EstablishmentTable | null = null;
  if (distinct) { best = tables[tables.length - 1]; warn(`${tables.length} establishment tables, one per region; using the last (${best.title})`); }
  else for (const t of tables) if (!best || t.rows.length > best.rows.length) best = t;
  if (!best) return null;
  // Reconcile: each subtotal equals the sum of the operation rows above it in its section, per column.
  for (let i = 0; i < best.rows.length; i++) {
    const r = best.rows[i];
    if (r.kind !== 'subtotal') continue;
    const ops: EstablishmentTableRow[] = [];
    for (let j = i - 1; j >= 0 && !['heading', 'subtotal', 'total'].includes(best.rows[j].kind); j--) if (best.rows[j].kind === 'operation' || best.rows[j].kind === 'overheadItem') ops.push(best.rows[j]);
    r.values.forEach((v, c) => {
      if (v == null) return;
      const sum = ops.reduce((s, o) => s + (o.values[c] ?? 0), 0);
      if (Math.abs(sum - v) > Math.max(2, 0.02 * Math.abs(v))) warn(`establishment table: ${r.label} column ${best!.years[c]} prints ${v} but its rows sum to ${sum}`);
    });
  }
  return best;
}

/** A one-year establishment table (hay, pasture, mint and wild rice stands, a laser-leveled rice field): laid out like a
 *  production costs table, one row per operation, read from its Total Cost column (the last number on each row; the
 *  Your Cost column is blank). The table has a single column. */
function parseOneYearEstablishment(lines: Line[], all: TableHeading[]): EstablishmentTable | null {
  const cands = all.filter(t => isEstablishTitle(t.title) && /COSTS?\b.*\bESTABLISH/i.test(t.title) && !/RE-?ESTABLISH|MATERIAL|INPUT|EQUIPMENT|MONTHLY|HOURLY|RANGING|SUMMARY/i.test(t.title));
  // the costs table, unless the costs and returns table to establish holds the accumulated net cash cost the study
  // amortizes ("TOTAL ACCUMULATED NET CASH COST (ESTABLISHMENT COSTS): 217", wild rice)
  let costsOnly: EstablishmentTable | null = null;
  for (const t of cands) {
    const withReturns = /RETURNS/i.test(t.title);
    if (!withReturns && costsOnly) continue;
    const [a, b] = spanOf(lines, all, t);
    // the column header: a line naming the Total column (or the Cost/Acre column of a costs and returns table), with no numbers on it
    let i = a + 1;
    while (i < b && !((/\bTotal\b/i.test(lines[i].text) || (withReturns && /Cost\/Acre/i.test(lines[i].text))) && /\bCosts?\b|\bYour\b/i.test(lines[i].text) && !/\d/.test(lines[i].text.replace(/\(Hrs\/A\)/i, '')))) i++;
    if (i >= b) continue;
    const rows: EstablishmentTableRow[] = [];
    let section = ''; let pending: { label: string; raw: string } | null = null;
    let gross = false; // the gross returns block on top of a costs and returns table: only its total is kept
    for (i = i + 1; i < b; i++) {
      const raw = lines[i].text;
      if (!raw.trim() || EST_FURNITURE.test(raw)) continue;
      if (yearColumns(raw)) break; // a year-by-year table follows; not a one-year table
      if (/^\s*GROSS RETURNS\s*$/i.test(raw)) { gross = true; continue; }
      if (gross) {
        if (/^\s*OPERATING COSTS\b/i.test(raw)) gross = false;
        else { const h = raw.match(/^\s*(TOTAL GROSS RETURNS\b.*?)\s+([\d,]+)\s*$/i); if (h) rows.push({ label: clean(h[1]), kind: 'income', section: 'GROSS RETURNS', values: [toNum(h[2])], page: lines[i].page, quote: clean(raw) }); }
        continue;
      }
      const toks = numericTokens(raw, 0);
      const label = clean(raw.slice(0, toks.length ? toks[0].start : raw.length));
      if (!toks.length) {
        if (/^[A-Za-z][A-Za-z\s&/()-]*:/.test(label)) {
          section = label.replace(/:.*$/, '');
          rows.push({ label: section, kind: 'heading', section, values: [null], page: lines[i].page, quote: clean(raw) });
          pending = null;
        } else pending = { label, raw };
        continue;
      }
      let lab = label; let quote = clean(raw);
      // a label wrapped over two lines ("Interest on Operating Capital at" / "5.75%   3")
      if (pending && (!lab || /^[a-z0-9(%]/.test(lab))) { lab = clean(`${pending.label} ${lab}`); quote = clean(`${pending.raw} ${raw}`); }
      pending = null;
      if (!lab) continue;
      lab = lab.replace(/\s*:\s*$/, ''); // "TOTAL ACCUMULATED NET CASH COST (ESTABLISHMENT COSTS):"
      rows.push({ label: lab, kind: rowKind(lab, section), section, values: [toks[toks.length - 1].value], page: lines[i].page, quote });
      if (/^TOTAL COSTS?\s*\/\s*ACRE$/i.test(lab)) break;
    }
    while (rows.length && rows[rows.length - 1].values.every(v => v == null)) rows.pop();
    if (rows.filter(r => r.kind !== 'heading').length < 5) continue;
    if (!rows.some(r => /^TOTAL (?:CASH|OPERATING) COSTS?/i.test(r.label))) continue;
    const table: EstablishmentTable = { title: t.title, years: [withReturns ? 'Cost/Acre' : 'Total Cost'], rows, yieldRow: null };
    if (withReturns) { if (rows.some(r => r.kind === 'accumulated')) return table; }
    else costsOnly = table;
  }
  return costsOnly;
}

function parseEstablishment(lines: Line[], investments: EquipmentRow[], warn: (s: string) => void): Establishment | null {
  const S = proseSentences(lines);
  const all = findTables(lines);
  const estTables = all.filter(t => isEstablishTitle(t.title));
  const hasProse = S.some(x => /establishment costs?|costs? (?:to|of) establish/i.test(x.text));
  if (!estTables.length && !hasProse) return null;

  // Prose: the "Establishment Cost." paragraph, read as a window of sentences.
  // The paragraph can share its heading with an earlier section ("Orchard Establishment." in the cultural
  // practices), so take the first candidate window that actually holds the amortization or the dollar figure.
  const table = parseEstablishmentTable(lines, all, warn) ?? parseOneYearEstablishment(lines, all);
  const regional = !!table && all.filter(t => isEstablishTitle(t.title) && t.title !== table.title).some(t => /\bin\s+[A-Z][\w\s,&]*Count(?:y|ies)/.test(t.title) && /\bin\s+[A-Z][\w\s,&]*Count(?:y|ies)/.test(table.title) && !/\bcont\W*$/i.test(t.title));
  const tableAccumulated = table ? table.rows.filter(r => r.kind === 'accumulated').flatMap(r => r.values).filter((v): v is number => v != null) : [];
  const starts = S.map((x, i) => (/^(?:amortized |orchard |vineyard |grove |tree |stand )?establishment(?: costs?)?[.:]/i.test(x.text) || /^Establishment Cost/i.test(x.text) || /establishment cost is the sum/i.test(x.text) ? i : -1)).filter(i => i >= 0);
  const pickWindow = starts.map(i => S.slice(i, i + 10)).find(w => w.some(x => /amortiz/i.test(x.text) || /\$\s?[\d,]+\s*(?:per (?:planted |producing |bearing )?acre|\/\s?acre)/i.test(x.text)));
  const win = pickWindow ?? S.filter(x => /establishment/i.test(x.text));
  const q = (hit: { s: { text: string; page: number }; m: RegExpMatchArray } | null, group = 1) => {
    const v = hit ? wordOrNum(hit.m[group]) : null;
    return hit && v != null ? { value: v, page: hit.s.page, quote: hit.s.text } : null;
  };
  // "$15,037/acre", "$6,000 per planted acre"; not the land value of an established orchard ("land value ... is estimated at $30,000 per acre")
  const acc = sentenceMatch(win.filter(x => !/land value|valued at|estimated worth|is worth/i.test(x.text) && !(/\bland\b/i.test(x.text) && !/establish/i.test(x.text))), /\$\s?([\d,]+)\s*(?:per (?:planted |producing |bearing )?acre|\/\s?acre)/i);
  const accumulatedNetCost = acc ? (() => {
    // A sentence can state one figure per region ("$35,111 per acre ... and $35,176 per acre in San Luis Obispo
    // County"); take the one the establishment table prints, else the first.
    const all$ = [...acc.s.text.matchAll(/\$\s?([\d,]+)\s*(?:per (?:planted |producing |bearing )?acre|\/\s?acre)/gi)].map(m => toNum(m[1])).filter((v): v is number => v != null);
    const v = all$.find(x => tableAccumulated.some(t => Math.abs(t - x) <= 1)) ?? toNum(acc.m[1]);
    return v == null ? null : { value: v, page: acc.s.page, quote: acc.s.text };
  })() : null;
  const amort = sentenceMatch(win, /amortiz/i);
  const productionYears = q(sentenceMatch(win, /amortiz[^.]*?remaining\s+(\w+)\s+years?/i))
    || q(sentenceMatch(win, /amortiz[^.]*?over the\s+(\w+)[- ]years?/i))
    || q(sentenceMatch(win, /amortiz[^.]*?over the remaining\s+(\w+)/i))
    // "Establishment cost is depreciated beginning in the sixth year over the remaining 95 years of production",
    // "The establishment cost is spread over the remaining 27 years of the 30 years the vineyard is in production"
    || q(sentenceMatch(win, /establishment costs?[^.]*?(?:depreciated|spread)[^.]*?over the remaining\s+(\w+)\s+years?/i))
    // "This value is amortized approximately over 40 years", "The establishment cost is amortized over 26 years",
    // "amortizing the net establishment costs ... over a 27 years productive life"
    || q(sentenceMatch([...win, ...S.filter(x => /establishment/i.test(x.text))], /amortiz(?:[^.]|\.\d)*?over (?:approximately |about |an? )?(\d+)[- ]years?(?! (?:old|of age))/i))
    // under a neighbouring heading ("Land. ... The cost is amortized over the remaining 23 years of orchard production")
    || q(sentenceMatch(S, /amortiz[^.]*?over the remaining\s+(\w+)\s+years? of (?:orchard |vineyard |grove |stand )?production/i))
    // the production table's row: "Amortized establishment (30 years) ac 1,152"
    || (() => { const h = find(lines, /^\s*Amortized (?:tree )?establishment\s*\((\d+) years?\)/i); const v = h ? toNum(h.m[1]) : null; return h && v != null ? { value: v, page: h.line.page, quote: clean(h.line.text) } : null; })();
  const plantingLife = q(sentenceMatch(S, /of the\s+(\d+)\s+years? the (?:vineyard|orchard|stand|planting) is in production/i))
    || q(sentenceMatch(S, /(?:projected|assumed|estimated)?\s*(\d+)[- ]year (?:life|stand life|vineyard|orchard)/i))
    || q(sentenceMatch(S, /(?:economic )?life of the (?:orchard|vineyard|stand|planting|grove)[^.]*?(\d+)\s+years/i))
    || q(sentenceMatch(S, /(?:orchard|vineyard|stand|planting|grove)[^.]{0,60}?(?:economic )?life[^.]{0,40}?(\d+)\s+years/i));
  const amortizedFromYear = q(sentenceMatch(win, /amortiz[^.]*?beginning in the\s+(\w+)\s+year/i));

  // Table: total cash costs, returns, net and accumulated rows by establishment year.
  let years: EstablishmentYear[] = [];
  let removalCost: Establishment['removalCost'] = null;
  let annualFromTable: Establishment['annualCharge'] = null;
  for (const t of estTables) {
    const [a, b] = spanOf(lines, all, t);
    const rowsIn = (re: RegExp) => findAll(lines, re, a, b);
    const total = rowsIn(/^\s*TOTAL CASH COSTS?\s*\/\s*ACRE\b/i)[0] ?? null;
    const returns = rowsIn(/^\s*(?:INCOME|REVENUE|RETURNS?)\s*\/\s*ACRE FROM PRODUCTION\b/i)[0] ?? null;
    const net = rowsIn(/^\s*NET CASH COSTS?\s*\/\s*ACRE FOR THE YEAR\b/i)[0] ?? null;
    const accRow = rowsIn(/^\s*(?:TOTAL\s+)?ACCUMULATED NET CASH COSTS?\s*\/\s*ACRE\b/i)[0] ?? null;
    const header = rowsIn(/\bYear:?\s+(?:Est(?:ab)?\S*|1st|Year\s*1|\d)/i)[0] ?? null;
    if (!total && !net) continue;
    const tn = total ? tailNumbers(total.line.text) : [];
    const nn = net ? tailNumbers(net.line.text) : [];
    const an = accRow ? tailNumbers(accRow.line.text) : [];
    const rn = returns ? tailNumbers(returns.line.text) : [];
    const cols = Math.max(tn.length, nn.length, an.length);
    if (cols === 0) continue;
    const labels: string[] = header ? (header.line.text.match(/Year:?\s*(.*)$/i)?.[1] ?? '').trim().split(/\s{2,}|\s+(?=\d)/).filter(Boolean) : [];
    // Rows with fewer numbers are right-aligned to the last columns (returns start when harvest starts).
    const at = (arr: number[], i: number) => (arr.length ? (i - (cols - arr.length) >= 0 ? arr[i - (cols - arr.length)] ?? null : null) : null);
    for (let i = 0; i < cols; i++) {
      const totalCost = at(tn, i), ret = at(rn, i), netCost = at(nn, i), accumulated = at(an, i);
      years.push({ year: i + 1, label: labels[i] ?? String(i + 1), totalCost, returns: ret, netCost: netCost ?? (totalCost != null ? totalCost - (ret ?? 0) : null), accumulated, page: (accRow ?? net ?? total)!.line.page, quote: clean((accRow ?? net ?? total)!.line.text) });
    }
    // Reconcile the running sum of net costs with the printed accumulated row.
    if (an.length && nn.length === cols) {
      let run = 0;
      for (let i = 0; i < cols; i++) { run += nn[i]; const printed = an[i]; if (printed != null && Math.abs(run - printed) > 0.02 * Math.max(1, Math.abs(printed))) { warn(`establishment year ${i + 1}: running net ${run} differs from printed accumulated ${printed}`); break; } }
    }
    // Removal of the previous planting is a pre-plant cost in the first establishment year.
    const rem = rowsIn(/^\s*(?:\S.*?)?(?:orchard|vineyard|tree|vine|tunnel\/trellis|stand|field)?\s*(?:removal|remove\b|tear[- ]?out|pull (?:out )?(?:vines|trees))/i).find(h => tailNumbers(h.line.text).length);
    if (rem && !removalCost) { const v = tailNumbers(rem.line.text)[0]; removalCost = { value: v, page: rem.line.page, quote: clean(rem.line.text), note: 'Removal of the previous planting, charged as a pre-plant cost in the first establishment year. The studies do not charge an end-of-life removal and set the establishment asset salvage value to zero.' }; }
    const estLine = rowsIn(/^\s*(?:orchard|vineyard|grove|stand)?\s*establishment( costs?)?\s+[\d,]/i)[0];
    if (estLine && !annualFromTable) { const v = tailNumbers(estLine.line.text); if (v.length) annualFromTable = { value: v[v.length - 1], page: estLine.line.page, quote: clean(estLine.line.text) }; }
  }

  // Production year: the establishment line in the non-cash overhead block gives per producing acre and the annual charge.
  let annualCharge: Establishment['annualCharge'] = null;
  const prodTables = all.filter(t => !isEstablishTitle(t.title) && (t.kind === 'costs' || t.kind === 'returns' || t.kind === 'other'));
  // one production table per region: the costs are read from the last one, so is the establishment line
  for (const t of regional ? [...prodTables].reverse() : prodTables) {
    const [a, b] = spanOf(lines, all, t);
    // also "Establish Vineyard 37,991 2,526 2,526", "Establish Pasture: Tilled 40 Acres 783 57 57" (acre counts blanked)
    let hit: { line: Line; text: string } | null = null;
    for (let i = a; i < b && !hit; i++) {
      const text = stripAcres(lines[i].text);
      const m = text.match(/^\s*((?:amortized\s+)?(?:orchard|vineyard|grove|field|stand)?\s*establish(?:ment|ed)?(?: costs?)?(?:[\s:,-]+\(?[A-Za-z]+\)?){0,3}?)\s+[\d,]{3,}(?:\.\d+)?(?:\s+[\d,]+(?:\.\d+)?)+\s*$/i);
      if (m && !/interest|removal|year|yr\b|\bland\b/i.test(m[1])) hit = { line: lines[i], text };
    }
    if (hit) { const v = tailNumbers(hit.text); if (v.length >= 2 && (!regional || v.length <= 3)) {
      // "Orchard Establishment 8,560 825 765": per producing acre, annual capital recovery, and the per acre cost the
      // table sums into its total; they agree except where the study prints a stale per producing acre pair
      annualCharge = { value: v.length === 3 ? v[2] : v[1], page: hit.line.page, quote: clean(hit.line.text) }; if (accumulatedNetCost && Math.abs(v[0] - accumulatedNetCost.value) > 0.02 * accumulatedNetCost.value) {
      // say which printed table cell the production table's figure is, when it is one
      const cell = table?.rows.filter(r => r.kind === 'accumulated').flatMap(r => r.values.map((x, c) => ({ r, x, c }))).find(o => o.x != null && Math.abs(o.x - v[0]) <= 1);
      warn(`establishment cost: the yearly charge is amortized from ${v[0]}` + (cell ? ` (the establishment table's ${cell.r.label}, ${table!.years[cell.c]} column)` : '') + `; the text's ${accumulatedNetCost.value} is a different measure of the establishment period`);
    } break; } }
  }
  if (!annualCharge && annualFromTable) annualCharge = annualFromTable;

  // When the row-by-row table parsed, read the year summary from it: its values sit in their printed columns,
  // so a blank cell in the middle of a row (no net cost in a profitable year) does not shift the others.
  if (table) {
    // labels compared without spaces: some text layers split words ("TOTAL CAS H COS TS")
    const row = (re: RegExp, kind?: EstablishmentTableRow['kind']) => table.rows.find(r => re.test(r.label.replace(/\s+/g, '')) && (!kind || r.kind === kind)) ?? null;
    const total = row(/^TOTAL(?:ALL)?CASHCOSTS?(?![A-Z])/i), ret = row(/^(?:INCOME|REVENUE|RETURNS?)/i, 'income');
    const net = row(/^NETCASHCO/i), accRow = row(/^(?:TOTAL)?ACCUMULATEDNETCASHCOSTS?(?![A-Z])/i);
    const src = accRow ?? net ?? total;
    if (src && (total || accRow)) {
      years = table.years.map((label, i) => {
        const totalCost = total?.values[i] ?? null, r = ret?.values[i] ?? null, n = net?.values[i] ?? null;
        return { year: i + 1, label, totalCost, returns: r, netCost: n ?? (totalCost != null ? totalCost - (r ?? 0) : null), accumulated: accRow?.values[i] ?? null, page: src.page, quote: src.quote };
      });
    }
  }

  // The establishment row of the investment table, whole farm figures.
  const inv = investments.find(r => /establishment/i.test(r.description) || isEstablishRow(r.description));
  const asset = inv ? { price: inv.price, yearsLife: inv.yearsLife, salvageValue: inv.salvageValue, capitalRecovery: inv.capitalRecovery, page: inv.page, line: inv.line } : null;

  if (accumulatedNetCost && years.length) {
    // the prose figure may be the accumulated net cash cost or the total accumulated net cost (with non-cash overhead)
    const accRows = table ? table.rows.filter(r => r.kind === 'accumulated') : [];
    const printed = accRows.length ? accRows.flatMap(r => r.values).filter((v): v is number => v != null) : years.map(y => y.accumulated).filter((v): v is number => v != null);
    if (printed.length && !printed.some(v => Math.abs(v - accumulatedNetCost.value) <= 0.02 * accumulatedNetCost.value)) warn(`establishment cost: the text's ${accumulatedNetCost.value} is not one of the accumulated row's columns [${printed.join(', ')}]; it measures the establishment period differently`);
  }
  if (!accumulatedNetCost && !years.length && !annualCharge && !table) return null;
  return {
    table, years, accumulatedNetCost, annualCharge,
    productionYears: productionYears ?? (asset ? { value: asset.yearsLife, page: asset.page, quote: `${asset.line} (years of life of the establishment row in the investment table)` } : null),
    plantingLife, amortizedFromYear, removalCost, asset, method: amort ? { page: amort.s.page, quote: amort.s.text } : null,
  };
}

// ---------------------------------------------------------------- establishment summary

const fmtNum = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
const near = (a: number, b: number) => Math.abs(a - b) <= 1; // the studies print whole dollars; a cell and its prose figure differ by rounding at most
const short = (s: string, n = 180) => (s.length > n ? s.slice(0, n - 3).trimEnd() + '...' : s);

/** The establishment line of the production costs table's non-cash overhead: "Orchard Establishment 7,939 765 765",
 *  "Establishment SV 9,500 457 457", "Peach Establishment 4,679 482 482". The first number is per producing acre, the
 *  second the annual capital recovery. */
function productionEstablishmentLines(lines: Line[], all: TableHeading[]): { perAcre: number; annual: number; line: Line }[] {
  const out: { perAcre: number; annual: number; line: Line }[] = [];
  for (const t of all.filter(x => !isEstablishTitle(x.title) && (x.kind === 'costs' || x.kind === 'returns' || x.kind === 'other'))) {
    const [a, b] = spanOf(lines, all, t);
    for (let i = a + 1; i < b; i++) {
      const text = stripAcres(lines[i].text); // "Establish Pasture: Tilled 40 Acres 783 57 57"
      const toks = numericTokens(text, 0);
      if (toks.length < 2 || toks.length > 3) continue;
      const label = text.slice(0, toks[0].start);
      if (!ESTABLISH_WORD.test(label) || /re-?establish|interest|removal|year|yr\b|\bestablishment fee|\bland\b/i.test(label)) continue;
      const v = toks.map(x => x.value);
      if (v.some(x => x == null)) continue;
      const [perAcre, annual] = v as number[];
      if (!(perAcre > annual && annual > 0)) continue;
      if (v.length === 3 && v[2] !== annual) continue;
      out.push({ perAcre, annual, line: lines[i] });
    }
  }
  return out;
}

function summarizeEstablishment(lines: Line[], est: Establishment | null, investments: EquipmentRow[], warn: (s: string) => void): EstablishmentSummary {
  const S = proseSentences(lines);
  const all = findTables(lines);
  const table = est?.table && est.table.years.length && est.table.rows.length ? est.table : null;

  // -- candidates for the per-acre establishment total
  type Cand = { value: number; page: number; quote: string; source: EstablishmentSource };
  const prodHits = productionEstablishmentLines(lines, all);
  const prodHit = (est?.annualCharge ? prodHits.find(h => near(h.annual, est.annualCharge!.value)) : null) ?? prodHits[0] ?? null;
  // the desert studies print the stand establishment as a block of its own: "TOTAL COST OF STAND ESTABLISHMENT 311.18"
  const desertTotal = find(lines, /^\s*TOTAL COST OF (?:STAND )?ESTABLISHMENT\s+([\d,]+(?:\.\d+)?)\s*$/i);
  const production: Cand | null = prodHit ? { value: prodHit.perAcre, page: prodHit.line.page, quote: clean(prodHit.line.text), source: 'production' }
    : desertTotal ? { value: toNum(desertTotal.m[1])!, page: desertTotal.line.page, quote: clean(desertTotal.line.text), source: 'production' } : null;

  // the whole farm establishment row divided by the acres, only when the study prints both
  const inv = investments.find(r => isEstablishRow(r.description));
  let investment: Cand | null = null;
  if (inv && inv.price > 0) {
    const inDesc = inv.description.match(/\(?\s*(\d[\d,]*)\s*-?\s*acres?\b/i);
    const priceTxt = fmtNum(inv.price);
    const sent = S.find(x => x.text.includes(priceTxt) && /(\d[\d,]*)[\s-]+acres?\b/i.test(x.text.slice(x.text.indexOf(priceTxt))));
    const acresFromSent = sent ? sent.text.slice(sent.text.indexOf(priceTxt)).match(/(\d[\d,]*)[\s-]+acres?\b/i) : null;
    const acres = inDesc ? toNum(inDesc[1]) : acresFromSent ? toNum(acresFromSent[1]) : null;
    if (acres && acres > 0) investment = { value: Math.round((inv.price / acres) * 100) / 100, page: inv.page, quote: inDesc ? inv.line : `${inv.line} | ${sent!.text}`, source: 'investment' };
  }

  // Spanish studies: "... representa el costo del establecimiento, que es de $ 16,622 por acre"
  // (the Spanish text runs past the first table heading, so every page is searched)
  let es: { value: number; page: number; quote: string } | null = null;
  if (!est?.accumulatedNetCost) {
    const pages = new Map<number, string[]>();
    for (const l of lines) if (l.text.trim()) (pages.get(l.page) ?? pages.set(l.page, []).get(l.page)!).push(l.text.trim());
    for (const [page, ls] of pages) {
      // the figure can sit in the next sentence: "... representa el costo de establecimiento. Para este estudio, el costo es de $ 11,219 por acre"
      const ss = clean(ls.join(' ')).split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ])/);
      const re = /costo (?:de|del) establecimiento[^$]{0,80}?\$\s?([\d,]+)\s*por acre/i;
      const sentence = ss.map((x, k) => (re.test(x) ? x : /costo (?:de|del) establecimiento/i.test(x) && k + 1 < ss.length && re.test(`${x} ${ss[k + 1]}`) ? `${x} ${ss[k + 1]}` : null)).find(Boolean) ?? null;
      const v = sentence ? toNum(sentence.match(re)![1]) : null;
      if (sentence && v) { es = { value: v, page, quote: sentence }; break; }
    }
  }
  const prose: Cand | null = est?.accumulatedNetCost ? { ...est.accumulatedNetCost, source: 'prose' } : es ? { ...es, source: 'prose' } : null;

  // the table: the accumulated net cost at the last establishment year, which is the column the study amortizes
  let tableCand: Cand | null = null; let tableReason: string | null = null;
  if (table) {
    if (/1,?000\s*LF|LINEAR F/i.test(table.title)) tableReason = 'The establishment table is per 1,000 linear feet of hedgerow, not per acre';
    else {
      const accRows = table.rows.filter(r => r.kind === 'accumulated').sort((a, b) => Number(/NET\s*CASH/i.test(b.label)) - Number(/NET\s*CASH/i.test(a.label)));
      const oneYear = table.years.length === 1;
      const rowsToTry = oneYear ? [...accRows, ...table.rows.filter(r => /^TOTAL CASH COSTS?\b/i.test(r.label))] : accRows;
      const refs = [production, prose, investment].filter((c): c is Cand => !!c);
      let pick: { row: EstablishmentTableRow; c: number } | null = null;
      for (const ref of refs) {
        for (const row of rowsToTry) { const c = row.values.findIndex(v => v != null && near(v, ref.value)); if (c >= 0) { pick = { row, c }; break; } }
        if (pick) break;
      }
      if (!pick && rowsToTry.length) {
        const row = rowsToTry[0];
        // a one-year table's total cash cost is gross of the establishment year's returns; when the study prints the
        // amortized figure elsewhere and it is not this cell, the table is not where the total comes from
        if (oneYear) { if (row.values[0] != null && !refs.length) pick = { row, c: 0 }; else if (!refs.length) tableReason = 'The one-year establishment table prints no total cash cost'; }
        else {
          // "The Total Accumulated Net Cash Cost in the fifth year represents the establishment cost"
          const nth = sentenceMatch(S, /accumulated net (?:cash )?costs?(?:\s*\/\s*acre)? (?:in|at the end of|through) the (\w+) year/i);
          const n = nth ? wordOrNum(nth.m[1]) : null;
          const yearNum = (l: string) => (/^Est/i.test(l) && !/\d/.test(l.replace(/^Est\w*/i, '')) ? 1 : Number((l.match(/\d+/g) ?? ['NaN']).pop()));
          const byLabel = n != null ? table.years.findIndex(l => yearNum(l) === n) : -1;
          if (byLabel >= 0 && row.values[byLabel] != null) pick = { row, c: byLabel };
          else {
            const prodCol = table.years.findIndex(l => /^Production$/i.test(l));
            const vals = row.values.slice(0, prodCol >= 0 ? prodCol : undefined);
            const nonNull = vals.map((v, i) => ({ v, i })).filter(x => x.v != null) as { v: number; i: number }[];
            const rising = nonNull.every((x, k) => k === 0 || x.v >= nonNull[k - 1].v);
            if (nonNull.length && rising) { pick = { row, c: nonNull[nonNull.length - 1].i }; warn(`establishment total: no printed figure names the amortized column; took the last column (${table.years[pick.c]}) of ${row.label}`); }
            else tableReason = 'The accumulated net cost row of the establishment table does not rise year over year (it restarts or turns to net returns), and the study names no single establishment total';
          }
        }
      }
      if (pick) tableCand = { value: pick.row.values[pick.c]!, page: pick.row.page, quote: pick.row.quote, source: 'table' };
      else if (!tableReason) tableReason = 'The establishment table prints no accumulated net cost row';
    }
  }

  const ordered = [tableCand, production, investment, prose].filter((c): c is Cand => !!c && c.value > 0);
  const total = ordered[0] ?? null;
  if (total) for (const c of ordered.slice(1)) if (!near(c.value, total.value)) warn(`establishment total: using the ${total.source} figure ${total.value} (${short(total.quote, 80)}); the ${c.source} prints ${c.value} (${short(c.quote, 80)}), which measures the establishment period differently`);

  // -- the annual charge in the production years
  let annualCharge: EstablishmentSummary['annualCharge'] = est?.annualCharge ? { value: est.annualCharge.value, page: est.annualCharge.page, quote: est.annualCharge.quote } : null;
  if (!annualCharge && prodHit) annualCharge = { value: prodHit.annual, page: prodHit.line.page, quote: clean(prodHit.line.text) };
  if (!annualCharge) {
    // the costs and returns table prints only the annual charge: "Vineyard Establishment   2,124"
    for (const t of all.filter(x => !isEstablishTitle(x.title) && (x.kind === 'costs' || x.kind === 'returns'))) {
      const [a, b] = spanOf(lines, all, t);
      for (let i = a + 1; i < b && !annualCharge; i++) {
        const toks = numericTokens(lines[i].text, 0);
        const label = lines[i].text.slice(0, toks[0]?.start ?? 0);
        if (toks.length === 1 && toks[0].value != null && toks[0].value > 0 && /^\s*(?:\w+\s+){0,3}establish(?:ment|ed)?(?: costs?)?\s*(?:\([^)]*\))?\s*$/i.test(stripAcres(label)) && !/re-?establish|interest|fee/i.test(label)) annualCharge = { value: toks[0].value, page: lines[i].page, quote: clean(lines[i].text) };
      }
      if (annualCharge) break;
    }
  }
  if (!annualCharge) {
    const am = find(lines, /^\s*Amortization\b.*\bestablishment\s+([\d,]+(?:\.\d+)?)\s*$/i) ?? find(lines, /^\s*Amortized (?:tree |orchard |vineyard |stand )?establishment\b(?:\s+\S+)*?\s+([\d,]+(?:\.\d+)?)\s*$/i);
    const v = am ? toNum(am.m[1]) : null;
    if (am && v != null && v > 0) annualCharge = { value: v, page: am.line.page, quote: clean(am.line.text) };
  }

  // -- perennial: an establishment table or heading, an amortized establishment cost, an establishment row in the
  // investments, or the study saying it leaves establishment out (an established orchard, a separate establishment study)
  const excluded = sentenceMatch(S, /(?:does not (?:take into account|include)|not (?:presented|included))[^.]*establishment|no (?:other )?establishment costs? (?:is |are )?included|establishment costs? (?:is|are) (?:not (?:presented|included|shown)|assumed to be included in the land value)/i);
  const separate = sentenceMatch(S, /(?:refer to|see)\s*\(?\s*["“]?(?:the )?Sample Costs? to Establish/i);
  const perennial = !!(table || est?.method || est?.asset || inv || production || prose || annualCharge || excluded || separate);

  let status: EstablishmentSummary['status'] = table ? 'table' : total ? 'total' : 'none';
  let reason: string | null = null;
  if (!perennial) { status = 'none'; reason = 'Annual crop, no establishment period'; }
  else if (status === 'table' && !total) reason = tableReason;
  else if (status === 'total') {
    reason = 'No year-by-year establishment table in the study; ' + (total!.source === 'production' ? "the total is the establishment line of the production costs table's non-cash overhead"
      : total!.source === 'investment' ? 'the total is the establishment row of the whole farm investment table divided by the acres it covers'
        : 'the total is the per acre establishment cost stated in the text');
  } else if (status === 'none') {
    reason = excluded ? `The study does not cost establishment: "${short(excluded.s.text)}"`
      : separate ? `Establishment is costed in a separate UC study: "${short(separate.s.text)}"`
        : 'The study prints no establishment table and no per acre establishment cost';
  }
  return { perennial, status, total: perennial ? total : null, annualCharge: perennial ? annualCharge : null, reason, noYearlyCharge: false, basisYear: null, capitalRecovery: null, investmentCharges: null };
}

// ---------------------------------------------------------------- establishment charge inputs

/** Capital recovery factor: the annual payment whose present value at `ratePct` over `years` is 1. */
export const crf = (ratePct: number, years: number): number => {
  const r = ratePct / 100;
  return r === 0 ? 1 / years : (r * (1 + r) ** years) / ((1 + r) ** years - 1);
};
const reproducesCharge = (computed: number, printed: number) => Math.abs(computed - printed) <= Math.max(3, 0.02 * printed);
const yearNumOf = (l: string) => (/^Est/i.test(l) && !/\d/.test(l.replace(/^Est\w*/i, '')) ? 1 : Number((l.match(/\d+/g) ?? ['NaN']).pop()));

/** Fills basisYear, capitalRecovery and investmentCharges: what a repricer needs to recompute the yearly
 *  establishment charge the way the study does. Every input is a cited figure; nothing is estimated. */
function establishmentChargeInputs(lines: Line[], sum: EstablishmentSummary, est: Establishment | null, a: Assumptions, method: Method, investments: EquipmentRow[], warn: (s: string) => void): void {
  const total = sum.total;
  const S = allSentences(lines);

  // -- basisYear: the column of the establishment table whose accumulated net cash cost the study amortizes
  const table = sum.status === 'table' && est?.table && est.table.years.length ? est.table : null;
  if (table && total) {
    const flat = (r: EstablishmentTableRow) => r.label.replace(/\s+/g, ''); // "ACCUMULATED NET CAS H COS TS"
    const oneYear = table.years.length === 1;
    const accRows = table.rows.filter(r => r.kind === 'accumulated').sort((x, y) => Number(/NETCASH/i.test(flat(y))) - Number(/NETCASH/i.test(flat(x))));
    // then a single year's net cash cost ("NET CASH COSTS/ACRE FOR THE YEAR 15,791", Year 1), and in a one-column table
    // its cash or operating cost total ("TOTAL OPERATING COSTS/ACRE 843")
    const rows = [...accRows, ...table.rows.filter(r => r.kind === 'net' && /^NETCASHCO|^COSTOSNETOSDEEFECTIVO/i.test(flat(r))),
      ...(oneYear ? table.rows.filter(r => /^TOTAL(?:CASH|OPERATING)COSTS?(?![A-Z])/i.test(flat(r))) : [])];
    const matches = (c: number) => rows.some(r => r.values[c] != null && near(r.values[c]!, total.value));
    // "The Total Accumulated Net Cash Cost on Table 1, in the third year represents the establishment cost",
    // "The Total Accumulated Net Cash Cost in the first year as shown in Table 2 represents ..."
    const nth = sentenceMatch(S, /accumulated net (?:cash )?costs?(?:\s*\/\s*acre)?(?:\s+(?:on|in|from|shown in) Table \d+,?)?\s+(?:in|at the end of|through|for|of) (?:the )?(\w+) year/i)
      ?? sentenceMatch(S.filter(x => /establishment/i.test(x.text)), /net cash costs?(?:\s*(?:\/|per)\s*acre)?(?:\s+(?:on|in|from|shown in) Table \d+,?)?\s+(?:in|at the end of|through|of) (?:the )?(\w+) year/i);
    const n = nth ? wordOrNum(nth.m[1]) ?? (Number(nth.m[1].replace(/\D/g, '')) || null) : null;
    const byProse = n != null ? table.years.findIndex(l => yearNumOf(l) === n) : -1;
    let index = byProse >= 0 && matches(byProse) ? byProse : -1;
    if (index < 0) for (const r of rows) { const c = r.values.findIndex(v => v != null && near(v, total.value)); if (c >= 0) { index = c; break; } }
    if (index < 0 && byProse >= 0) { index = byProse; warn(`establishment basis year: the text names column ${table.years[byProse]}, whose accumulated cost is not the total ${total.value}`); }
    if (index < 0 && oneYear) index = 0; // the only column
    if (index >= 0) {
      const row = rows.find(r => r.values[index] != null && near(r.values[index]!, total.value)) ?? null;
      let lessReturns: { value: number; page: number; quote: string } | null = null;
      // a one-column table of costs only, amortized net of the year's returns: "The Net Cash Cost Per Acre in the first
      // year shown in Table 2 represents the establishment cost" (3,132 cash costs - 1,500 gross returns = 1,633 printed);
      // the returns are read from the costs and returns table to establish, and must close the gap within $1
      const cash = oneYear && !row ? table.rows.find(r => /^TOTALCASHCOSTS?(?![A-Z])/i.test(flat(r)) && r.values[0] != null) : undefined;
      if (cash) {
        const all = findTables(lines);
        for (const t of all.filter(x => isEstablishTitle(x.title) && /RETURNS/i.test(x.title))) {
          const [a0, b0] = spanOf(lines, all, t);
          const h = find(lines, /^\s*TOTAL GROSS RETURNS\b/i, a0, b0);
          const v = h ? tailNumbers(h.line.text) : [];
          if (h && v.length && near(cash.values[0]! - v[v.length - 1], total.value)) { lessReturns = { value: v[v.length - 1], page: h.line.page, quote: clean(h.line.text) }; break; }
        }
      }
      sum.basisYear = { index, label: table.years[index], row: row?.label ?? (lessReturns ? cash!.label : null), lessReturns };
      if (!row && !lessReturns) warn(`establishment basis year: no row of column ${table.years[index]} equals the total ${total.value}`);
    } else if (total.source === 'table') warn(`establishment basis year: no column of the accumulated row equals the total ${total.value}`);
  }

  // -- capitalRecovery: total x CRF(long-term rate, remaining production years)
  const rate = a.interestRatePct;
  const yp = est?.productionYears ?? null;
  // the desert stand studies charge a flat share of the stand cost each year: "Amortization 20 % of total cost of stand
  // establishment 62.24" is straight line over 100 / 20 = 5 years at no interest (CRF(0, n) = 1 / n)
  const flatAm = find(lines, /^\s*Amortization\s+(\d+(?:\.\d+)?)\s*%\s+of total cost of stand establishment\s+([\d,]+(?:\.\d+)?)\s*$/i);
  const flatPct = flatAm ? toNum(flatAm.m[1]) : null;
  if (flatAm && flatPct && flatPct > 0 && flatPct <= 100 && total) {
    const q = clean(flatAm.line.text), n = 100 / flatPct;
    const computed = total.value * crf(0, n), printed = sum.annualCharge?.value ?? null;
    sum.capitalRecovery = {
      ratePct: { value: 0, page: flatAm.line.page, quote: `${q} (a flat ${flatPct}% of the stand cost each year, no interest)` },
      years: { value: n, page: flatAm.line.page, quote: `${q} (100 / ${flatPct}% = ${fmtNum(n)} years)` },
      computed, reproduces: printed != null && reproducesCharge(computed, printed),
    };
  } else if (rate && yp && total && yp.value > 0) {
    // the quotes repeat establishment.productionYears and assumptions.interestRatePct, which keep the full sentence; kept short for the bundle size
    let years = { value: yp.value, page: yp.page, quote: short(yp.quote, 120) };
    let computed = total.value * crf(rate.value, years.value);
    const printed = sum.annualCharge?.value ?? null;
    // The text and the investment table can disagree on the years ("amortized over the 4-year stand life" against a
    // 6-year stand and a 6-year establishment row). When only the investment row's years reproduce the printed
    // charge, the study computed its charge with those; cite that row.
    const asset = est?.asset;
    if (printed != null && !reproducesCharge(computed, printed) && asset && asset.yearsLife > 0 && asset.yearsLife !== years.value && reproducesCharge(total.value * crf(rate.value, asset.yearsLife), printed)) {
      warn(`establishment years: the text says ${years.value} ("${short(yp.quote, 100)}") but the printed charge ${printed} uses the investment row's ${asset.yearsLife} years`);
      years = { value: asset.yearsLife, page: asset.page, quote: `${asset.line} (years of life of the establishment row in the investment table; the text says: "${short(yp.quote, 90)}")` };
      computed = total.value * crf(rate.value, years.value);
    }
    // The capital recovery table's own header can state a different rate than the text ("CAPITAL RECOVERY COSTS
    // (4.75% Interest Rate)" against "The interest rate of 5.75% is used to calculate capital recovery"); when only the
    // header's rate reproduces the printed charge, the study computed its charge with it; cite the header.
    let ratePct = { value: rate.value, page: rate.page, quote: short(rate.quote, 120) };
    const hdr = find(lines, /CAPITAL RECOVERY COSTS?\s*\((\d+(?:\.\d+)?)\s*%\s*Interest Rate\)/i);
    const hv = hdr ? toNum(hdr.m[1]) : null;
    if (printed != null && !reproducesCharge(computed, printed) && hdr && hv != null && hv !== rate.value && reproducesCharge(total.value * crf(hv, years.value), printed)) {
      warn(`capital recovery rate: the text says ${rate.value}% but the printed establishment charge ${printed} uses the capital recovery table's ${hv}%`);
      ratePct = { value: hv, page: hdr.line.page, quote: `${clean(hdr.line.text)} (header of the capital recovery table; the text says: "${short(rate.quote, 90)}")` };
      computed = total.value * crf(hv, years.value);
    }
    // The land row of the investment table charges interest on its salvage value, which is its price, so capital
    // recovery / salvage value is the rate the tables use ("Land 6,000,000 40 6,000,000 285,000": 4.75% where the text
    // says 5.75%); when only that rate reproduces the printed charge, cite the land row.
    const land = investments.find(r => /^land\b/i.test(r.description) && r.price > 0 && r.salvageValue === r.price && r.capitalRecovery > 0);
    const lv = land ? Math.round((land.capitalRecovery / land.salvageValue) * 10000) / 100 : null;
    if (printed != null && !reproducesCharge(computed, printed) && land && lv != null && lv !== ratePct.value && Math.abs((land.salvageValue * lv) / 100 - land.capitalRecovery) <= 1 && reproducesCharge(total.value * crf(lv, years.value), printed)) {
      warn(`capital recovery rate: the text says ${rate.value}% but the printed establishment charge ${printed} uses the land row's ${lv}%`);
      ratePct = { value: lv, page: land.page, quote: `${land.line} (capital recovery / salvage value of the land row = ${lv}%; the text says: "${short(rate.quote, 90)}")` };
      computed = total.value * crf(lv, years.value);
    }
    sum.capitalRecovery = {
      ratePct, years, computed,
      reproduces: printed != null && reproducesCharge(computed, printed),
    };
  }

  // -- investmentCharges: insurance and taxes of the establishment row of the investment table, per acre
  // the row from the parsed investment table, else the row as printed when that table was not read:
  // "Establishment Costs 160 Ac 131,360 4 0 36,830 55 657 0 37,542" (price, years, salvage, capital recovery,
  // insurance, taxes, repairs, total; the total checks the four charges)
  const inv = investments.find(r => isEstablishRow(r.description)) ?? (() => {
    for (const l of lines) {
      const m = l.text.match(/^\s*((?:\w+\s+)?establishment(?:\s+costs?)?(?:\s+\d[\d,]*\s*ac\.?)?)\s+((?:[\d,]+(?:\.\d+)?\s+){7}[\d,]+(?:\.\d+)?)\s*$/i);
      if (!m || /re-?establish/i.test(m[1])) continue;
      const v = m[2].trim().split(/\s+/).map(toNum);
      if (v.some(x => x == null)) continue;
      const [price, yearsLife, salvageValue, capitalRecovery, insurance, taxes, repairs, tot] = v as number[];
      if (!(yearsLife > 0 && yearsLife < 100 && Math.abs(capitalRecovery + insurance + taxes + repairs - tot) <= 2)) continue;
      return { description: m[1].trim(), yearCode: null, price, yearsLife, salvageValue, capitalRecovery, insurance, taxes, repairs, total: tot, page: l.page, line: clean(l.text) } as EquipmentRow;
    }
    return undefined;
  })();
  if (inv && inv.price > 0) {
    const ok = (acres: number) => acres > 0 && (!total || Math.abs(inv.price / acres - total.value) <= 0.02 * total.value);
    type AcreCand = { acres: number; page: number; quote: string };
    const cands: AcreCand[] = [];
    const inDesc = inv.description.match(/(\d[\d,]*)\s*-?\s*ac(?:res?|\.)?(?![a-z])/i);
    if (inDesc) cands.push({ acres: toNum(inDesc[1])!, page: inv.page, quote: inv.line });
    // "$825,800 for the 40-acre vineyard"
    const priceTxt = fmtNum(inv.price);
    for (const x of S) {
      const at = x.text.indexOf(priceTxt);
      if (at < 0) continue;
      const m = x.text.slice(at).match(/(\d[\d,]*)[\s-]+acres?\b/i);
      if (m) cands.push({ acres: toNum(m[1])!, page: x.page, quote: x.text });
    }
    if (a.acresCrop) cands.push({ acres: a.acresCrop.value, page: a.acresCrop.page, quote: a.acresCrop.quote });
    if (a.acresFarmed) cands.push({ acres: a.acresFarmed.value, page: a.acresFarmed.page, quote: a.acresFarmed.quote });
    // any acreage the text states that turns the row into the per acre total ("20 acres of avocados")
    if (total) for (const x of proseSentences(lines)) for (const m of x.text.matchAll(/(\d[\d,]*(?:\.\d+)?)[\s-]+acres?\b/gi)) cands.push({ acres: toNum(m[1])!, page: x.page, quote: x.text });
    const pick = cands.find(c => c.acres != null && ok(c.acres)) ?? (!total ? cands[0] : undefined);
    if (pick) {
      const r2 = (v: number) => Math.round(v * 100) / 100;
      sum.investmentCharges = {
        insurance: r2(inv.insurance / pick.acres), taxes: r2(inv.taxes / pick.acres), acres: pick.acres,
        insuranceRatePct: method.insuranceRatePct?.value ?? null, taxRatePct: method.propertyTaxRatePct?.value ?? null,
        page: inv.page,
        // the investment row, then where the acres it is divided by are printed
        quote: pick.quote === inv.line ? inv.line : `${inv.line} / ${pick.acres} acres (p. ${pick.page}: "${short(pick.quote, 90)}")`,
      };
    } else warn(`establishment investment row ${inv.price}: no acreage in the study turns it into the per acre total ${total?.value}`);
  }

  // -- no yearly establishment charge: the study says why, or prints neither a charge line nor an establishment row
  const addReason = (x: string) => { sum.reason = sum.reason ? `${sum.reason}. ${x}` : x; };
  if (sum.perennial && sum.status !== 'none' && !sum.annualCharge) {
    // "It is the crop land value plus the Establishment Cost for the first two years ... ($17,000 + $6,000 = $23,000)"
    const inLand = sentenceMatch(S, /(?:land value|valued|worth)[^.]{0,120}\b(?:plus|includ\w*)\b[^.]{0,40}establishment/i);
    // "The establishment cost is recovered in the first production year."
    const once = sentenceMatch(S, /establishment cost is recovered in the (?:first|\w+) production year|costo (?:del? )?establecimiento se recupera en el primer año de producción/i);
    const why = inLand ? `the establishment cost is included in the land value (p. ${inLand.s.page}: "${short(inLand.s.text)}")`
      : once ? `the establishment cost is recovered in the first production year (p. ${once.s.page}: "${short(once.s.text)}")`
        : !inv && !est?.asset ? 'its production costs table has no establishment line and its investment table no establishment row' : null;
    if (why) { sum.noYearlyCharge = true; sum.capitalRecovery = null; addReason(`The study charges no yearly establishment cost: ${why}`); }
  }
  // a printed charge with no stated capital recovery rate to recompute it
  if (sum.annualCharge && total && !sum.capitalRecovery && !rate) addReason(`The study prints a yearly establishment charge of ${fmtNum(sum.annualCharge.value)} but states no capital recovery interest rate, so the charge cannot be recomputed`);
}

// ---------------------------------------------------------------- method

function parseMethod(lines: Line[]): Method {
  const S = proseSentences(lines);
  const q = (hit: { s: { text: string; page: number } } | null): Quote | null => (hit ? { page: hit.s.page, quote: hit.s.text } : null);
  const cr = sentenceMatch(S, /Purchase Price\s*[–-]\s*Salvage Value.{0,40}Capital Recovery Factor.{0,40}Salvage Value\s*[xX×]\s*Interest Rate/i)
    || sentenceMatch(S, /capital recovery.{0,200}Capital Recovery Factor/i);
  const sal = sentenceMatch(S, /Salvage value is an estimate of the remaining value[^.]*\./i) || sentenceMatch(S, /Salvage Value\.\s*[^.]*\./i);
  // prose before the first table first, then every page ("1%" as often as "1 percent"; ".710 percent")
  const A = allSentences(lines);
  const either = (re: RegExp) => sentenceMatch(S, re) || sentenceMatch(A, re);
  const PCT = String.raw`(\d+(?:\.\d+)?|\.\d+)\s*(?:percent|%|por ciento)`;
  // not the labor overhead sentence ("Management salaries include annual bonuses, and insurance, payroll taxes and
  // benefits which are calculated at 40.5 percent")
  const notLabor = (re: RegExp) => { const f = (X: { text: string; page: number }[]) => sentenceMatch(X.filter(x => !/payroll|salar|benefits|workers/i.test(x.text)), re); return f(S) || f(A); };
  const insHit = notLabor(new RegExp(String.raw`(?:property )?insurance.{0,80}?${PCT} (?:per \$1,000 )?of the average value`, 'i'))
    || notLabor(new RegExp(String.raw`insurance.{0,60}?(?:charged|calculated) at ${PCT}`, 'i'))
    // "Property Insurance. This provides coverage for property loss and is charged at 0.886 percent of the average value"
    // ("Coverage for property loss is charged at 0.886 percent", "is charged 0.843 percent", "at 0. 846 percent")
    || notLabor(new RegExp(String.raw`coverage for property loss (?:and )?is charged (?:at )?(\d+\.\s?\d+|\d+|\.\d+)\s*(?:percent|%)`, 'i'));
  // "$8.86 per $1,000 asset value for property insurance", "property insurance is calculated at $8.17 per $1,000"
  const perK = notLabor(/\$\s?(\d+(?:\.\d+)?) per \$1,000 (?:of )?(?:asset )?valu\w* for property insurance/i)
    || notLabor(/property insurance[^.]{0,40}?\$\s?(\d+(?:\.\d+)?) per \$1,000(?! of crop)/i);
  const insCited = insHit ? (() => { const v = toNum(insHit.m[1].replace(/\s+/g, '')); return v == null ? null : { value: v, unit: '%', page: insHit.s.page, quote: insHit.s.text }; })() : null;
  // "charged at 8.86 percent per $1,000 of the average value" means $8.86 per $1,000, 0.886 percent (the investment
  // tables charge 0.886 percent); "0.710 percent per $1,000" is already the percent. A dollars per $1,000 figure is
  // a tenth of the percent.
  const insuranceRatePct: Cited | null = insCited
    ? (/percent per \$1,000/i.test(insHit!.m[0] + insHit!.s.text.slice(insHit!.s.text.indexOf(insHit!.m[0]) + insHit!.m[0].length, insHit!.s.text.indexOf(insHit!.m[0]) + insHit!.m[0].length + 20)) && insCited.value >= 2
      ? { ...insCited, value: Math.round(insCited.value * 100) / 1000 } : insCited)
    : perK ? (() => { const c = citeS(perK, 1, '%'); return c ? { ...c, value: Math.round(c.value * 100) / 1000 } : null; })() : null;
  const tax = either(new RegExp(String.raw`(?:property )?tax(?:es)?.{0,120}?${PCT} of the average value`, 'i'))
    || either(new RegExp(String.raw`(?:county|property) taxes (?:are )?(?:calculated )?(?:at|as) ${PCT}`, 'i'))
    || either(new RegExp(String.raw`base property tax rate of ${PCT}`, 'i'))
    || either(/base property tax rate of (one) percent/i);
  // Operator labor versus machine time: "Labor for operations involving machinery are 20 percent higher than the
  // operation time ..." in most studies. The tractor-versus-implement time sentence ("Tractor time is 10 percent
  // higher than implement time") is a different quantity and is deliberately not matched.
  const mlf = sentenceMatch(S, /(?:labor|labour|mano de obra)[^.]{0,120}?(?:machin|equip|maquinaria)[^.]{0,120}?(\d+(?:\.\d+)?)\s*(?:percent|%|por ciento)[^.]{0,40}?(?:higher|more|greater|mayor|más)/i)
    || sentenceMatch(S, /(?:machin|maquinaria)[^.]{0,120}?(?:labor|labour|mano de obra)[^.]{0,120}?(\d+(?:\.\d+)?)\s*(?:percent|%|por ciento)[^.]{0,40}?(?:higher|more|greater|mayor|más)/i);
  const mlfCited = mlf ? citeS(mlf, 1, '%') : null;
  const machineLaborFactor: Cited | null = mlfCited && mlfCited.value >= 0 && mlfCited.value <= 100
    ? { ...mlfCited, value: Math.round((1 + mlfCited.value / 100) * 1000) / 1000, unit: 'x' } : null;
  return {
    capitalRecoveryFormula: q(cr), salvageMethod: q(sal),
    insuranceRatePct, propertyTaxRatePct: tax ? (/^one$/i.test(tax.m[1]) ? { value: 1, unit: '%', page: tax.s.page, quote: tax.s.text } : citeS(tax, 1, '%')) : null,
    machineLaborFactor,
  };
}

export const proseSentencesForDebug = (text: string) => proseSentences(pagesToLines(text));

// ---------------------------------------------------------------- driver

/** Join words the text layer split after a letter: "HA RVEST", "ES TABLIS H", "COS TS", "CA SH", "Interes t", "A nalysis". */
export const unsplitWords = (t: string) => t
  .replace(/([A-Za-z][sSA]) (?=[A-Za-z]{1,2}\b)/g, '$1')
  .replace(/\b(?!(?:A|I|OF|TO|IN|AT|BY|ON|OR|AN|AS|IS|IT|NO|BE)\b)([A-Z]{1,2}) (?=[A-Z]{3,})/g, '$1')
  .replace(/\b(?!I\b)([A-Z]) (?=[a-z]{3,})/g, '$1');

export function parseStudy(e: ManifestEntry, text: string): ParsedStudy {
  const warnings: string[] = [];
  const warn = (s: string) => warnings.push(s);
  const lines = pagesToLines(text);
  const language: 'en' | 'es' = /costos|muestra|cosecha/i.test(lines.slice(0, 30).map(l => l.text).join(' ')) ? 'es' : 'en';
  if (language === 'es') warn('Spanish-language study; prose regexes are English only');
  const source = parseSource(e, lines, language);
  const assumptions = parseAssumptions(lines, warn);
  const gross = (assumptions as unknown as { _gross?: Cited })._gross;
  let costsPerAcre = parseCosts(lines, assumptions, warn);
  // Some text layers split words after certain letters ("TOTAL OPERATING COS TS /ACRE", "CA SH OVERHEA D:", "Interes t on
  // operating capital"). When no cost table is found, the cost tables are read again from lines with those splits joined.
  if (!costsPerAcre.title && /\bCOS TS\b/.test(text)) {
    const retry: string[] = [];
    const joined = lines.map(l => ({ ...l, text: unsplitWords(l.text) }));
    if (gross) (assumptions as unknown as { _gross?: Cited })._gross = gross;
    const c2 = parseCosts(joined, assumptions, s => retry.push(s));
    if (c2.title) {
      // quotes stay verbatim: each joined line's quote is put back to the line as printed
      const original = new Map(lines.map((l, k) => [clean(joined[k].text), clean(l.text)]));
      const restore = (o: unknown): void => {
        if (!o || typeof o !== 'object') return;
        const r = o as Record<string, unknown>;
        if (typeof r.quote === 'string') r.quote = original.get(r.quote) ?? r.quote;
        Object.values(r).forEach(restore);
      };
      restore(c2);
      costsPerAcre = c2;
      warnings.splice(warnings.indexOf('no costs-per-acre table found'), 1);
      warnings.push('the text layer splits words in the cost tables ("COS TS", "CA SH"); the tables are read with those splits joined', ...retry);
    }
  }
  const { equipment, investments, businessOverhead } = parseEquipment(lines, warn);
  const hourlyEquipment = parseHourly(lines, warn);
  const method = parseMethod(lines);
  const monthly = parseMonthly(lines, warn);
  const establishment = parseEstablishment(lines, investments, warn);
  const establishmentSummary = summarizeEstablishment(lines, establishment, investments, warn);
  establishmentChargeInputs(lines, establishmentSummary, establishment, assumptions, method, investments, warn);

  const fields: Record<string, unknown> = {
    year: source.year, region: source.region, counties: source.counties,
    yieldPerAcre: assumptions.yieldPerAcre, pricePerUnit: assumptions.pricePerUnit, interestRatePct: assumptions.interestRatePct,
    laborMachineRate: assumptions.laborMachineRate, laborNonMachineRate: assumptions.laborNonMachineRate, laborOverheadPct: assumptions.laborOverheadPct,
    landRentPerAcre: assumptions.landRentPerAcre, acresFarmed: assumptions.acresFarmed,
    operatingTotal: costsPerAcre.operatingTotal, cashOverheadTotal: costsPerAcre.cashOverheadTotal, nonCashOverheadTotal: costsPerAcre.nonCashOverheadTotal,
    totalCost: costsPerAcre.totalCost, grossReturns: costsPerAcre.grossReturns,
    operations: costsPerAcre.operations.length || null, equipment: equipment.length || null, investments: investments.length || null,
    hourlyEquipment: hourlyEquipment.length || null, businessOverhead: businessOverhead.length || null,
    capitalRecoveryFormula: method.capitalRecoveryFormula, insuranceRatePct: method.insuranceRatePct, propertyTaxRatePct: method.propertyTaxRatePct,
    machineLaborFactor: method.machineLaborFactor,
    monthly,
    establishment: establishment ?? null, establishmentAccumulated: establishment?.accumulatedNetCost ?? null, establishmentAnnual: establishment?.annualCharge ?? null,
  };
  const fieldsFound = Object.keys(fields).filter(k => fields[k] != null);
  const fieldsMissing = Object.keys(fields).filter(k => fields[k] == null);
  return { source, assumptions, costsPerAcre, equipment, investments, hourlyEquipment, businessOverhead, method, monthly, establishment, establishmentSummary, parse: { fieldsFound, fieldsMissing, warnings } };
}

function main() {
  fs.mkdirSync(PARSED_DIR, { recursive: true });
  const entries = loadManifest();
  let ok = 0; const rows: string[] = [];
  for (const e of entries) {
    const slug = slugOf(e);
    const txt = path.join(TEXT_DIR, `${slug}.txt`);
    if (!fs.existsSync(txt)) { rows.push(`${slug}: no text`); continue; }
    try {
      const parsed = parseStudy(e, fs.readFileSync(txt, 'utf8'));
      fs.writeFileSync(path.join(PARSED_DIR, `${slug}.json`), JSON.stringify(parsed, null, 1));
      ok++;
      rows.push(`${slug}: found ${parsed.parse.fieldsFound.length}/${parsed.parse.fieldsFound.length + parsed.parse.fieldsMissing.length}, missing [${parsed.parse.fieldsMissing.join(' ')}]`);
    } catch (err) {
      rows.push(`${slug}: ERROR ${(err as Error).message}`);
    }
  }
  rows.forEach(r => console.log(r));
  console.log(`parsed ${ok}/${entries.length}`);
}

if (process.argv[1] && /parse\.ts$/.test(process.argv[1])) main();
