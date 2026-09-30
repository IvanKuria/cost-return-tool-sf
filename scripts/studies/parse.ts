// Parses pdftotext -layout output of UC Davis cost studies into cited values.
// Rule: a value is either backed by the exact line it came from, or it is null.
import fs from 'node:fs';
import path from 'node:path';
import { loadManifest, slugOf, TEXT_DIR, PARSED_DIR, type ManifestEntry } from './manifest';
import type {
  Assumptions, BusinessOverheadRow, Cited, CostsPerAcre, EquipmentRow, Establishment, EstablishmentTable, EstablishmentTableRow, EstablishmentYear, HourlyEquipmentRow, Method, MonthlyCosts,
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
  if (/RANGING/.test(t)) return 'ranging';
  if (/MATERIAL|INPUT COSTS|SUMMARY/.test(t)) return 'other';
  if (/MONTHLY|MENSUAL/.test(t)) return 'monthly';
  if (/ESTABLISH|DEVELOP/.test(t)) return 'establish';
  if (/COSTS?\s+AND\s+RETURNS|RETURNS\s+(AND|&)\s+COSTS/.test(t)) return 'returns';
  if (/COSTS?\s+PER\s+ACRE|COSTS?\s+TO\s+(PRODUCE|GROW)|PRODUCTION COSTS/.test(t)) return 'costs';
  return 'other';
}

/** Body table headings (the table of contents repeats them, so a heading followed closely by another heading is TOC). */
function findTables(lines: Line[]): TableHeading[] {
  const re = /^\s*TABL[EA]\s*(\d+)(?:[-\s]?[A-Z])?\.?\s+(\S.*?)\s*$/i;
  const cands: { n: number; title: string; index: number; page: number }[] = [];
  for (const l of lines) {
    const m = l.text.match(re);
    if (!m) continue;
    if (/…|\.{4,}/.test(m[2])) continue;                 // dotted leaders
    if (/^CONTINUED/i.test(m[2]) || /CONTINUED\)?\s*$/i.test(m[2])) continue;
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

  // returns from Table 2 GROSS RETURNS block
  const tables = findTables(lines);
  const rt = tables.filter(t => t.kind === 'returns').pop();
  if (rt) {
    const [t2, end] = spanOf(lines, tables, rt);
    const grossStarts = findAll(lines, /^\s*GROSS RETURNS\s*:?\s*$/i, t2, end);
    const gs = grossStarts[grossStarts.length - 1];
    if (gs) {
      const start = gs.line.index + 1;
      for (let i = start; i < Math.min(end, start + 25); i++) {
        const t = lines[i].text;
        const tot = t.match(new RegExp(String.raw`^\s*TOTAL GROSS RETURNS\s+(${NUM})\s+([A-Za-z./]+)\s+(?:${NUM}\s+)?(${NUM})\s*$`, 'i'))
          || t.match(new RegExp(String.raw`^\s*TOTAL GROSS RETURNS\s+(${NUM})\s*$`, 'i'));
        if (tot) {
          const val = toNum(tot[3] ?? tot[1]);
          if (tot[2]) {
            const q = toNum(tot[1]);
            if (q != null && a.returns.length <= 1) { a.yieldPerAcre = cite(lines[i], q, tot[2]); a.yieldUnit = tot[2]; }
          }
          if (val != null) (a as unknown as { _gross: Cited })._gross = cite(lines[i], val, '$/acre');
          break;
        }
        const row = t.match(new RegExp(String.raw`^\s*(\S.*?)\s{2,}(${NUM})\s+([A-Za-z./]+)\s+(${NUM})\s+(${NUM})\s*$`));
        if (row && !/TOTAL/i.test(row[1])) {
          const q = toNum(row[2]), p = toNum(row[4]), v = toNum(row[5]);
          if (q != null && p != null && v != null) a.returns.push({ name: clean(row[1]), quantity: q, unit: row[3], price: p, value: v, page: lines[i].page, quote: clean(t) });
        }
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

function lastTotal(lines: Line[], re: RegExp, from: number, to: number, unit: string | null): Cited | null {
  const hits = findAll(lines, re, from, to);
  if (!hits.length) return null;
  const h = hits[hits.length - 1];
  const nums = h.line.text.match(new RegExp(NUM, 'g'));
  if (!nums) return null;
  const v = toNum(nums[nums.length - 1]);
  return v == null ? null : cite(h.line, v, unit);
}

function parseCosts(lines: Line[], a: Assumptions, warn: (s: string) => void): CostsPerAcre {
  const c: CostsPerAcre = {
    title: null, operatingTotal: null, cashOverheadTotal: null, nonCashOverheadTotal: null, totalCost: null,
    grossReturns: (a as unknown as { _gross?: Cited })._gross ?? null, netReturnsAboveOperating: null, netReturnsAboveTotal: null,
    cashOverheadItems: [], operations: [],
  };
  delete (a as unknown as { _gross?: Cited })._gross;
  // production cost table: the last 'costs' table that actually has a TOTAL OPERATING COSTS row
  const all = findTables(lines);
  const costTables = all.filter(t => t.kind === 'costs');
  let t1: [number, number] | null = null;
  for (let i = costTables.length - 1; i >= 0; i--) {
    const span = spanOf(lines, all, costTables[i]);
    if (find(lines, /^\s*TOTAL OPERATING COSTS/i, span[0], span[1])) { t1 = span; c.title = costTables[i].title; if (i !== costTables.length - 1) warn('a later costs table had no totals; used an earlier one'); break; }
  }
  if (!t1) { t1 = tableSpan(lines, 'returns'); const rt = all.filter(t => t.kind === 'returns').pop(); if (t1 && rt) c.title = rt.title; }
  if (!t1) { warn('no costs-per-acre table found'); return c; }
  if (costTables.length > 1) warn('several costs-per-acre tables (establishment and production); using the production one');
  const [s, e] = t1;
  const opHits = findAll(lines, /^\s*TOTAL OPERATING COSTS\s*\/\s*ACRE\b/i, s, e);
  if (opHits.length > 1) warn(`Table 1 has ${opHits.length} TOTAL OPERATING COSTS rows (multi-year table); using the last`);
  c.operatingTotal = lastTotal(lines, /^\s*TOTAL OPERATING COSTS\s*\/\s*ACRE\b/i, s, e, '$/acre');
  c.cashOverheadTotal = lastTotal(lines, /^\s*TOTAL CASH OVERHEAD COSTS?(?:\s*\/\s*ACRE)?\b/i, s, e, '$/acre');
  c.nonCashOverheadTotal = lastTotal(lines, /^\s*TOTAL NON-?CASH OVERHEAD COSTS?(?:\s*\/\s*ACRE)?\b/i, s, e, '$/acre');
  c.totalCost = lastTotal(lines, /^\s*TOTAL COSTS?\s*\/\s*ACRE\b/i, s, e, '$/acre');

  // cash overhead items between CASH OVERHEAD: and TOTAL CASH OVERHEAD
  const coStart = findAll(lines, /^\s*CASH OVERHEAD(?: COSTS)?:?\s*$/i, s, e);
  const co = coStart[coStart.length - 1];
  if (co) {
    for (let i = co.line.index + 1; i < e; i++) {
      const t = lines[i].text;
      if (/^\s*TOTAL CASH OVERHEAD/i.test(t)) break;
      const m = t.match(new RegExp(String.raw`^\s*([A-Za-z][^\d]*?)\s{2,}(${NUM})\s*$`));
      if (m) { const v = toNum(m[2]); if (v != null) c.cashOverheadItems.push({ description: clean(m[1]), value: v, page: lines[i].page, quote: clean(t) }); }
    }
    if (!a.landRentPerAcre) {
      const lr = c.cashOverheadItems.find(x => /^land (rent|lease)/i.test(x.description));
      if (lr) a.landRentPerAcre = { value: lr.value, unit: '$/acre/yr', page: lr.page, quote: lr.quote };
    }
  }

  // operations rows: every row of the production cost table up to TOTAL OPERATING COSTS.
  // Category comes from a "Cultural:" style header above, or from a "TOTAL CULTURAL COSTS" line below.
  const opEnd = opHits[opHits.length - 1];
  if (opEnd) {
    const catOf = (k: string): OperationCategory => {
      const x = k.toLowerCase();
      return x.startsWith('harvest') ? 'harvest' : x.startsWith('assess') ? 'assessment' : x.startsWith('post') ? 'postharvest' : x === 'cultural' ? 'cultural' : 'other';
    };
    const rowRe = new RegExp(String.raw`^\s*(\S.*?)\s{2,}(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s*$`);
    // Studies through about 2015 print one "Fuel, Lube & Repairs" column: six numbers, not seven.
    const rowRe6 = new RegExp(String.raw`^\s*(\S.*?)\s{2,}(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s*$`);
    let sixColumn = false;
    // start after the last column-header line ("Operation ... Cost") before opEnd, else at the table start
    let from = s;
    for (let i = opEnd.line.index - 1; i > s; i--) if (/^\s*Operation\s+\(?Hrs/i.test(lines[i].text) || /^\s*Operation\s{2,}/i.test(lines[i].text)) { from = i + 1; break; }
    let cat: OperationCategory | null = null;
    let section = 'Cultural';
    let pending: OperationRow[] = [];
    for (let i = from; i < opEnd.line.index; i++) {
      const t = lines[i].text.replace(/[!|]/g, ' ');
      const head = t.match(/^\s*(Cultural|Harvest|Assessment|Post-?harvest|Pre-?plant|Plant|Pest Management|Irrigation|Fertilization|Weed Control|Other|Establishment)[^:]*:\s*$/i);
      if (head) { cat = catOf(head[1]); section = clean(t).replace(/:\s*$/, ''); continue; }
      const tot = t.match(/^\s*TOTAL\s+([A-Z][A-Z -]+?)\s+COSTS?\b/i);
      if (tot) { const k = catOf(tot[1]); for (const r of pending) if (cat == null) r.category = k; pending = []; continue; }
      if (/^\s*(TOTAL|Interest on operating)/i.test(t)) continue;
      const m = t.match(rowRe);
      let row: OperationRow | null = null;
      if (m) {
        row = {
          name: clean(m[1]), category: cat ?? 'cultural', section, timeHrsPerAcre: toNum(m[2]), labor: zeroDash(m[3]), fuel: zeroDash(m[4]), lubeRepairs: zeroDash(m[5]),
          materials: zeroDash(m[6]), customRent: zeroDash(m[7]), totalCost: toNum(m[8]), page: lines[i].page, quote: clean(lines[i].text),
        };
      } else {
        const m6 = t.match(rowRe6);
        if (!m6) continue;
        // combined fuel, lube and repairs goes under fuel; lubeRepairs is null so nothing is double counted
        row = {
          name: clean(m6[1]), category: cat ?? 'cultural', section, timeHrsPerAcre: toNum(m6[2]), labor: zeroDash(m6[3]), fuel: zeroDash(m6[4]), lubeRepairs: null,
          materials: zeroDash(m6[5]), customRent: zeroDash(m6[6]), totalCost: toNum(m6[7]), page: lines[i].page, quote: clean(lines[i].text),
        };
        sixColumn = true;
      }
      c.operations.push(row); pending.push(row);
    }
    if (sixColumn) warn('Table 1 prints one combined fuel, lube and repairs column; it is stored under fuel with lubeRepairs null');
  }

  // Table 2 returns
  const t2 = tableSpan(lines, 'returns');
  if (t2) {
    const [s2, e2] = t2;
    if (!c.grossReturns) c.grossReturns = lastTotal(lines, /^\s*TOTAL GROSS RETURNS\b/i, s2, e2, '$/acre');
    c.netReturnsAboveOperating = lastTotal(lines, /^\s*NET RETURNS? ABOVE OPERATING COSTS?\b/i, s2, e2, '$/acre');
    c.netReturnsAboveTotal = lastTotal(lines, /^\s*NET RETURNS? ABOVE TOTAL COSTS?\b/i, s2, e2, '$/acre');
    if (!c.operatingTotal) c.operatingTotal = lastTotal(lines, /^\s*TOTAL OPERATING COSTS\s*\/\s*ACRE\b/i, s2, e2, '$/acre');
    if (!c.cashOverheadTotal) c.cashOverheadTotal = lastTotal(lines, /^\s*TOTAL CASH OVERHEAD COSTS?(?:\s*\/\s*ACRE)?\b/i, s2, e2, '$/acre');
    if (!c.nonCashOverheadTotal) c.nonCashOverheadTotal = lastTotal(lines, /^\s*TOTAL NON-?CASH OVERHEAD COSTS?(?:\s*\/\s*ACRE)?\b/i, s2, e2, '$/acre');
    if (!c.totalCost) c.totalCost = lastTotal(lines, /^\s*TOTAL COSTS?\s*\/\s*ACRE\b/i, s2, e2, '$/acre');
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


// ---------------------------------------------------------------- establishment table, row by row

const EST_FURNITURE = /Costs? (&|and) Returns Study|UC COOPERATIVE EXTENSION|UC DAVIS|^\s*TABLE \d+\.?\s*CONTINUED|^\s*Costs? per Acre\s*$|^\s*Cost Per Acre\s*$|^\s*\(?Continued\)?\s*$/i;

/** Character position where each year header token ends; numbers below are right-aligned to these. */
function yearColumns(text: string): { labels: string[]; ends: number[]; zoneStart: number } | null {
  const m = text.match(/\bYear:\s*(\S.*)$/i);
  if (!m) return null;
  const rest = m[1];
  const base = text.length - rest.length;
  const labels: string[] = []; const ends: number[] = [];
  const tokRe = /(?:Est(?:ab)?\w*(?:\/\d+(?:st|nd|rd|th))?|\d+(?:st|nd|rd|th)|Year\s*\d+|\b\d{1,2}\b)/gi;
  let t: RegExpExecArray | null;
  while ((t = tokRe.exec(rest))) { labels.push(t[0].trim()); ends.push(base + t.index + t[0].length); }
  if (labels.length < 2 || labels.length > 8) return null;
  const firstStart = base + rest.search(/\S/);
  return { labels, ends, zoneStart: firstStart - 9 };
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

function rowKind(label: string, section: string): EstablishmentTableRow['kind'] {
  const L = label.toUpperCase();
  if (/^INTEREST ON OPERATING/.test(L)) return 'interest';
  if (/^(INCOME|RETURNS?|REVENUE)(?:\/ACRE| FROM PRODUCTION| PER ACRE)/.test(L)) return 'income';
  if (/ACCUMULATED/.test(L)) return 'accumulated';
  if (/^(TOTAL )?NET\b|^(NET )?PROFIT/.test(L)) return 'net';
  if (/^TOTAL (OPERATING|CASH OVERHEAD|CASH COSTS?|NON-?CASH|INTEREST ON INVESTMENT|COSTS?\/ACRE|COSTS? PER ACRE)/.test(L)) return 'total';
  if (/^TOTAL .*(COSTS?|EXPENSES?)\b/.test(L)) return 'subtotal';
  if (/OVERHEAD/i.test(section)) return 'overheadItem';
  return 'operation';
}

function parseEstablishmentTable(lines: Line[], all: TableHeading[], warn: (s: string) => void): EstablishmentTable | null {
  const estTables = all.filter(t => /ESTABLISH|DEVELOP|ESTABLEC/i.test(t.title));
  if (!estTables.length) return null;
  let best: EstablishmentTable | null = null;
  for (const t of estTables) {
    const [a, b] = spanOf(lines, all, t);
    let cols: ReturnType<typeof yearColumns> = null;
    const rows: EstablishmentTableRow[] = [];
    let yieldRow: EstablishmentTable['yieldRow'] = null;
    let section = '';
    let carry: EstablishmentTableRow | null = null; // a heading line that carried numbers belonging to the next label
    let page = -1;
    let awaitingHeader = true; // every page opens with furniture (title, region, 'Costs per Acre') until its Year: header
    let sinceHeader = 0;       // body rows since the last header; the yield line only ever sits right under a header
    for (let i = a + 1; i < b; i++) {
      const raw = lines[i].text;
      if (lines[i].page !== page) { page = lines[i].page; awaitingHeader = true; }
      if (!raw.trim()) continue;
      if (EST_FURNITURE.test(raw)) continue;
      const yc = yearColumns(raw);
      if (yc) { if (!cols || yc.labels.length === cols.labels.length || yc.labels.length > cols.labels.length) cols = yc; awaitingHeader = false; sinceHeader = 0; continue; }
      if (!cols || awaitingHeader) continue;
      const text = raw.replace(/[!|]/g, ' ');
      const toks = numericTokens(text, cols.zoneStart);
      const labelEnd = toks.length ? toks[0].start : text.length;
      const label = clean(text.slice(0, labelEnd));
      if (!label && !toks.length) continue;
      if (!label) continue;
      // yield or price line under the header (repeats on continuation pages)
      if (sinceHeader === 0 && /(yield|price|\$|per acre|tons? per|lbs? per|pounds per)/i.test(label) && /(per acre|per ton|tons?\b|lbs?\b|pounds|cartons?|boxes|trays?|bins?)/i.test(label) && !/^(total|net|income|accumulated)/i.test(label)) {
        if (toks.length && !yieldRow) yieldRow = { label: label.replace(/^Operation:?\s*/i, ''), values: placeValues(toks, cols.ends), quote: clean(raw) };
        continue;
      }
      if (/^Operation:?$/i.test(label)) continue;
      sinceHeader++;
      const isHeading = /:\s*$/.test(label) && (!toks.length || /costs?:$/i.test(label));
      if (isHeading) {
        section = label.replace(/:\s*$/, '');
        const heading: EstablishmentTableRow = { label: section, kind: 'heading', section, values: cols.labels.map(() => null), page: lines[i].page, quote: clean(raw) };
        rows.push(heading);
        carry = toks.length ? { ...heading, values: placeValues(toks, cols.ends) } : null;
        continue;
      }
      let values = placeValues(toks, cols.ends);
      if (!toks.length && carry) { values = carry.values; carry = null; }
      else carry = null;
      const kind = rowKind(label, section);
      rows.push({ label, kind, section, values, page: lines[i].page, quote: clean(raw) });
    }
    if (!cols || rows.filter(r => r.kind !== 'heading').length < 5) continue;
    const table: EstablishmentTable = { title: t.title, years: cols.labels, rows, yieldRow };
    if (!best || rows.length > best.rows.length) best = table;
  }
  if (!best) return null;
  // Reconcile: each subtotal equals the sum of the operation rows above it in its section, per column.
  for (let i = 0; i < best.rows.length; i++) {
    const r = best.rows[i];
    if (r.kind !== 'subtotal') continue;
    const ops: EstablishmentTableRow[] = [];
    for (let j = i - 1; j >= 0 && best.rows[j].kind !== 'heading'; j--) if (best.rows[j].kind === 'operation' || best.rows[j].kind === 'overheadItem') ops.push(best.rows[j]);
    r.values.forEach((v, c) => {
      if (v == null) return;
      const sum = ops.reduce((s, o) => s + (o.values[c] ?? 0), 0);
      if (Math.abs(sum - v) > Math.max(2, 0.02 * Math.abs(v))) warn(`establishment table: ${r.label} column ${best!.years[c]} prints ${v} but its rows sum to ${sum}`);
    });
  }
  return best;
}

function parseEstablishment(lines: Line[], investments: EquipmentRow[], warn: (s: string) => void): Establishment | null {
  const S = proseSentences(lines);
  const all = findTables(lines);
  const estTables = all.filter(t => /ESTABLISH|DEVELOP|ESTABLEC/i.test(t.title));
  const hasProse = S.some(x => /establishment cost/i.test(x.text));
  if (!estTables.length && !hasProse) return null;

  // Prose: the "Establishment Cost." paragraph, read as a window of sentences.
  // The paragraph can share its heading with an earlier section ("Orchard Establishment." in the cultural
  // practices), so take the first candidate window that actually holds the amortization or the dollar figure.
  const starts = S.map((x, i) => (/^(?:orchard |vineyard |grove )?establishment(?: costs?)?[.:]/i.test(x.text) || /^Establishment Cost/i.test(x.text) || /establishment cost is the sum/i.test(x.text) ? i : -1)).filter(i => i >= 0);
  const pickWindow = starts.map(i => S.slice(i, i + 10)).find(w => w.some(x => /amortiz/i.test(x.text) || /\$\s?[\d,]+\s*per acre/i.test(x.text)));
  const win = pickWindow ?? S.filter(x => /establishment/i.test(x.text));
  const q = (hit: { s: { text: string; page: number }; m: RegExpMatchArray } | null, group = 1) => {
    const v = hit ? wordOrNum(hit.m[group]) : null;
    return hit && v != null ? { value: v, page: hit.s.page, quote: hit.s.text } : null;
  };
  const acc = sentenceMatch(win, /\$\s?([\d,]+)\s*per acre/i);
  const accumulatedNetCost = acc ? (() => { const v = toNum(acc.m[1]); return v == null ? null : { value: v, page: acc.s.page, quote: acc.s.text }; })() : null;
  const amort = sentenceMatch(win, /amortiz/i);
  const productionYears = q(sentenceMatch(win, /amortiz[^.]*?remaining\s+(\w+)\s+years?/i))
    || q(sentenceMatch(win, /amortiz[^.]*?over the\s+(\w+)[- ]years?/i))
    || q(sentenceMatch(win, /amortiz[^.]*?over the remaining\s+(\w+)/i));
  const plantingLife = q(sentenceMatch(S, /of the\s+(\d+)\s+years? the (?:vineyard|orchard|stand|planting) is in production/i))
    || q(sentenceMatch(S, /(?:projected|assumed|estimated)?\s*(\d+)[- ]year (?:life|stand life|vineyard|orchard)/i))
    || q(sentenceMatch(S, /(?:economic )?life of the (?:orchard|vineyard|stand|planting|grove)[^.]*?(\d+)\s+years/i))
    || q(sentenceMatch(S, /(?:orchard|vineyard|stand|planting|grove)[^.]{0,60}?(?:economic )?life[^.]{0,40}?(\d+)\s+years/i));
  const amortizedFromYear = q(sentenceMatch(win, /amortiz[^.]*?beginning in the\s+(\w+)\s+year/i));

  // Table: total cash costs, returns, net and accumulated rows by establishment year.
  const years: EstablishmentYear[] = [];
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
  const prodTables = all.filter(t => !/ESTABLISH|DEVELOP|ESTABLEC/i.test(t.title) && (t.kind === 'costs' || t.kind === 'returns' || t.kind === 'other'));
  for (const t of prodTables) {
    const [a, b] = spanOf(lines, all, t);
    const hit = find(lines, /^\s*(?:orchard|vineyard|grove|field|stand)?\s*establishment( costs?)?\s+[\d,]{3,}(?:\s+[\d,]+)+\s*$/i, a, b);
    if (hit) { const v = tailNumbers(hit.line.text); if (v.length >= 2) { annualCharge = { value: v[1], page: hit.line.page, quote: clean(hit.line.text) }; if (accumulatedNetCost && Math.abs(v[0] - accumulatedNetCost.value) > 0.02 * accumulatedNetCost.value) warn(`establishment per producing acre ${v[0]} differs from prose ${accumulatedNetCost.value}`); break; } }
  }
  if (!annualCharge && annualFromTable) annualCharge = annualFromTable;

  // The establishment row of the investment table, whole farm figures.
  const inv = investments.find(r => /establishment/i.test(r.description));
  const asset = inv ? { price: inv.price, yearsLife: inv.yearsLife, salvageValue: inv.salvageValue, capitalRecovery: inv.capitalRecovery, page: inv.page, line: inv.line } : null;

  if (accumulatedNetCost && years.length) {
    const printed = years.map(y => y.accumulated).filter((v): v is number => v != null);
    if (printed.length && !printed.some(v => Math.abs(v - accumulatedNetCost.value) <= 0.02 * accumulatedNetCost.value)) warn(`prose establishment cost ${accumulatedNetCost.value} matches no column of the accumulated row [${printed.join(', ')}]`);
  }
  const table = parseEstablishmentTable(lines, all, warn);
  if (!accumulatedNetCost && !years.length && !annualCharge && !table) return null;
  return {
    table, years, accumulatedNetCost, annualCharge,
    productionYears: productionYears ?? (asset ? { value: asset.yearsLife, page: asset.page, quote: `${asset.line} (years of life of the establishment row in the investment table)` } : null),
    plantingLife, amortizedFromYear, removalCost, asset, method: amort ? { page: amort.s.page, quote: amort.s.text } : null,
  };
}

// ---------------------------------------------------------------- method

function parseMethod(lines: Line[]): Method {
  const S = proseSentences(lines);
  const q = (hit: { s: { text: string; page: number } } | null): Quote | null => (hit ? { page: hit.s.page, quote: hit.s.text } : null);
  const cr = sentenceMatch(S, /Purchase Price\s*[–-]\s*Salvage Value.{0,40}Capital Recovery Factor.{0,40}Salvage Value\s*[xX×]\s*Interest Rate/i)
    || sentenceMatch(S, /capital recovery.{0,200}Capital Recovery Factor/i);
  const sal = sentenceMatch(S, /Salvage value is an estimate of the remaining value[^.]*\./i) || sentenceMatch(S, /Salvage Value\.\s*[^.]*\./i);
  const ins = sentenceMatch(S, /(?:property )?insurance.{0,80}?(\d+(?:\.\d+)?)\s*percent of the average value/i)
    || sentenceMatch(S, /insurance.{0,60}?charged at (\d+(?:\.\d+)?)\s*percent/i);
  const tax = sentenceMatch(S, /(?:property )?tax(?:es)?.{0,120}?(\d+(?:\.\d+)?)\s*percent of the average value/i)
    || sentenceMatch(S, /base property tax rate of (\d+(?:\.\d+)?)\s*percent/i);
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
    insuranceRatePct: ins ? citeS(ins, 1, '%') : null, propertyTaxRatePct: tax ? citeS(tax, 1, '%') : null,
    machineLaborFactor,
  };
}

export const proseSentencesForDebug = (text: string) => proseSentences(pagesToLines(text));

// ---------------------------------------------------------------- driver

export function parseStudy(e: ManifestEntry, text: string): ParsedStudy {
  const warnings: string[] = [];
  const warn = (s: string) => warnings.push(s);
  const lines = pagesToLines(text);
  const language: 'en' | 'es' = /costos|muestra|cosecha/i.test(lines.slice(0, 30).map(l => l.text).join(' ')) ? 'es' : 'en';
  if (language === 'es') warn('Spanish-language study; prose regexes are English only');
  const source = parseSource(e, lines, language);
  const assumptions = parseAssumptions(lines, warn);
  const costsPerAcre = parseCosts(lines, assumptions, warn);
  const { equipment, investments, businessOverhead } = parseEquipment(lines, warn);
  const hourlyEquipment = parseHourly(lines, warn);
  const method = parseMethod(lines);
  const monthly = parseMonthly(lines, warn);
  const establishment = parseEstablishment(lines, investments, warn);

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
  return { source, assumptions, costsPerAcre, equipment, investments, hourlyEquipment, businessOverhead, method, monthly, establishment, parse: { fieldsFound, fieldsMissing, warnings } };
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
