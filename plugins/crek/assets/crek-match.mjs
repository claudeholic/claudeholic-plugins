#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
/**
 * crek-match — "have we seen this role before?" for a batch of freshly found postings.
 *
 *   echo '[{"title":"Platform Engineer (Kubernetes)","agency":"Initech"}]' \
 *     | node crek-match.mjs --config ../crek.config.json
 *
 * The same role reaches us through three agencies under three names, with three different
 * URLs — matching on links finds nothing. What does work is reading the handful of archive
 * entries that live in the same corner of the pipeline, which is what this script produces:
 * for every candidate, the closest entries as one line each, with id, status and date.
 *
 * It deliberately returns no verdict. Recognising "payment-gateway migration for a retail bank —
 * that is the Contoso client from an earlier entry" is the reader's job; the script only guarantees the
 * material always lands in front of them, including when nobody thought to go looking.
 *
 * Two kinds of hit are marked: `!!` — same canonical URL, posting reference number or ATS
 * application-form id (a duplicate); `!` — likely the same posting (same agency, same normalised title, overlapping
 * rate), or a shared URL that does not prove it (the same URL under two different companies, or
 * the same ATS form address without a shared posting id), or a nofluffjobs city page of what looks like the
 * same posting (same title-and-company slug, another city or region — NFJ gives every place of a
 * posting its own URL; the posting reference, kind "nofluffjobs", proves it). Everything else is unmarked material. Hits on an entry with status `skipped` (set aside
 * without review — no decision by the candidate) get `~~` / `~` instead, so a match against it is
 * never read as "duplicate" or "already declined": such a posting is presented as new. Hits on
 * an entry with status `closed` (the employer stopped taking applications) lead their reason with
 * "previously closed": the same posting found active again has reopened.
 *
 * Reference numbers and form ids (crek-refs.mjs) are read on both sides: from the candidate's
 * `ref` / `refs`, its URLs and its `text` (the posting body), and from every archive row's
 * description (its "REF:" line), notes, communication, apply_url and source_url — normalised, so
 * "JOB-7K2QX" in a LinkedIn body meets "Nr oferty JOB-7K2QX" in an application log. A short purely
 * numeric id (Traffit form 48213, a site id like 10042) counts as a duplicate only together with the same
 * company: such numbers repeat across ATS tenants.
 *
 * Token weights come from the pipeline itself rather than from any word list: a token's weight
 * is inverse to how many archived titles contain it, so "engineer" (half the rows) counts for
 * almost nothing while "zephyr" (a few rows) counts for a lot. Nothing to standardise, nothing
 * to maintain — the archive says what is rare in it.
 *
 * The pipeline is read through crek-db.mjs (sqlite, mysql or http-api — db.backend in the config),
 * fresh on every run: no cache, so a row recorded a minute ago is always seen. Used as a module,
 * matchCandidates() takes rows already loaded (crek-dedupe-check hands over its own), and the pure
 * helpers (sameTitle, likelySamePosting, ...) are exported for the tests.
 *
 * Requires Node >= 22 (>= 22.13 for the sqlite backend).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractRefs, explicitRefs, urlRefs, sameRef, isWeakRef, fmtRef, normRef, sameUrlPosting, atsOf,
  nfjPlaceVariant, POSTING_ID_KINDS,
} from './crek-refs.mjs';
import { resolveDb, openDb, DbError } from './crek-db.mjs';
import { resolveLang, translator } from './crek-i18n.mjs';

export const DEFAULT_TOP = 8;

// Messages follow presentation.language; main() sets it, module users may call setLanguage().
let t = translator(resolveLang(undefined));
export function setLanguage(value) { t = translator(resolveLang(value)); }

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error(`usage: node crek-match.mjs [options] < candidates.json

  --config <path>     crek.config.json: the pipeline (db) and presentation.language
  --lang <code|name>  output language ("pl", "en", "Polish", ...). Order: --lang, then
                      env CREK_LANG, then the config; default "pl", unknown -> "en"
  --api <url>         read an http-api directly instead of the config's db (token: env
                      CREK_TOKEN; basic auth: env CREK_AUTH)
  --auth <user:pass>  basic auth for --api on the command line — visible in ps; prefer CREK_AUTH
  --candidates <path> read candidates from a file instead of stdin
  --top <n>           entries listed per candidate (default ${DEFAULT_TOP})
  --json              machine-readable output

Candidates: a JSON array of objects. Only "title" is required.
  {"title": "...", "company": "...", "agency": "...", "tech": ["..."],
   "url": "...", "apply_url": "...", "ref": "JOB-7K2QX", "location": "...",
   "salary": {"min": 24000, "max": 32000, "unit": "month"}}
  Optional: "id" (the candidate's own pipeline row — never matched against itself),
  "refs": ["JOB-7K2QX", "traffit:48213", "nofluffjobs:QX7KD2PA"], "apply_urls": ["..."],
  "urls": ["..."] (other addresses of the same posting — on nofluffjobs the pages of its
  other cities), "text": "posting body" (reference numbers are extracted from it).`);
  process.exit(2);
}

// ---------------------------------------------------------------- text handling

// Fold Polish diacritics: the same posting is "Inżynier" on one board and "Inzynier" on another.
const FOLD = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

// Grammatical filler only. Everything domain-related ("engineer", "senior", "devops") is left
// in and weighted down by the archive itself — a stop list of job words would need maintaining
// and would differ per market.
const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'our', 'you', 'your',
  'oraz', 'dla', 'lub', 'przez', 'nasz', 'jako',
]);

function tokenize(text) {
  if (!text) return [];
  const folded = String(text).toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]);
  return [...new Set(
    folded.split(/[^a-z0-9+#.]+/).filter((t) => t.length >= 3 && !STOP.has(t)),
  )];
}

function techList(value) {
  if (!value) return [];
  let list = value;
  if (typeof value === 'string') {
    try { list = JSON.parse(value); } catch { list = value.split(/[,;|]/); }
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((t) => String(t).toLowerCase().trim()).filter(Boolean))];
}

// ---------------------------------------------------------------- "likely the same posting"

// One agency often posts the same role on several boards: different URL, no visible reference
// number, a title that differs only in a trailing tech list or a gender suffix. Same agency + same
// normalised title + overlapping rate is almost certainly the same posting, not just the same
// client — it is flagged `!` (not a duplicate: the user decides, but the suggestion is skip).

function fold(text) {
  return String(text ?? '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]);
}

/** Lowercase, folded, punctuation-free words. */
function words(text) {
  return fold(text).replace(/[^a-z0-9+#]+/g, ' ').trim();
}

// "(m/f/d)", "(k/m)", "(w/m/d)", "m/w/x", "(she/he/they)" — never "(AI/ML)".
const GENDER = '(?:m|f|k|d|w|x|div|all|he|she|they|him|her|them)';
const GENDER_RE = new RegExp(
  `\\(?\\s*\\b${GENDER}\\b\\s*(?:[/|,*]\\s*\\b${GENDER}\\b\\s*)+\\)?`, 'gi');
// Everything after the first " — ", " – ", " - " or "|" is usually a tech list or a location.
const SUFFIX_RE = /\s+[—–-]\s+|\s*\|\s*/;

/** Normalised forms of a title: {full, head} — head is the part before a trailing suffix. */
function titleForms(title) {
  const ungendered = fold(title).replace(GENDER_RE, ' ');
  const full = words(ungendered);
  const head = words(ungendered.split(SUFFIX_RE)[0]);
  return { full, head: head.split(' ').length >= 2 ? head : null };
}

function containsWords(longer, shorter) {
  return shorter.split(' ').length >= 2 && ` ${longer} `.includes(` ${shorter} `);
}

function sameTitle(a, b) {
  const fa = titleForms(a);
  const fb = titleForms(b);
  if (!fa.full || !fb.full) return false;
  if (fa.full === fb.full) return true;
  if (fa.head && fb.head && fa.head === fb.head) return true;
  if (fa.head && fa.head === fb.full) return true;
  if (fb.head && fb.head === fa.full) return true;
  return containsWords(fa.full, fb.full) || containsWords(fb.full, fa.full);
}

const LEGAL = new Set(['sp', 'z', 'o', 'oo', 's', 'a', 'sa', 'spa', 'sro', 'gmbh', 'ag', 'ltd',
  'limited', 'inc', 'llc', 'plc', 'bv', 'nv', 'co', 'corp', 'group', 'poland', 'polska']);
// Placeholder names that say nothing about who is hiring.
const PLACEHOLDER = new Set(['klient', 'client', 'nieujawniony', 'nieujawniona', 'undisclosed',
  'confidential', 'poufny', 'unknown', 'brak', 'none', 'n', 'a']);

/** Normalised company name: no parenthesised notes, no legal form; null for placeholders. */
function companyName(name) {
  const tokens = words(fold(name).replace(/\([^)]*\)/g, ' ')).split(' ')
    .filter((w) => w && !LEGAL.has(w));
  if (!tokens.length || tokens.every((w) => PLACEHOLDER.has(w))) return null;
  return tokens.join(' ');
}

function sameCompany(candidate, job) {
  const a = [candidate.agency, candidate.company].map(companyName).filter(Boolean);
  const b = [job.agency, job.hiring_company].map(companyName).filter(Boolean);
  return a.some((x) => b.some((y) => x === y
    || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)));
}

/** Both sides name who is hiring (agency or company, placeholders aside) and the names differ. */
function otherCompany(candidate, job) {
  const a = [candidate.agency, candidate.company].map(companyName).filter(Boolean);
  const b = [job.agency, job.hiring_company].map(companyName).filter(Boolean);
  return a.length > 0 && b.length > 0 && !sameCompany(candidate, job);
}

/** Company and agency names of both sides in nofluffjobs slug form, longest first: every leading
 *  part of the name, so "Tailspin Group Sp. z o.o." gives "tailspin-group-sp-z-o-o", …, "tailspin-group", "tailspin"
 *  (NFJ keeps some legal words in the slug and drops others). */
function companySlugs(candidate, job) {
  const out = new Set();
  for (const name of [candidate.agency, candidate.company, job.agency, job.hiring_company]) {
    if (!companyName(name)) continue; // placeholders ("klient nieujawniony") name nobody
    const tokens = words(fold(name).replace(/\([^)]*\)/g, ' ')).split(' ').filter(Boolean);
    for (let k = tokens.length; k >= 1; k--) {
      if (tokens.slice(0, k).some((w) => !LEGAL.has(w))) out.add(tokens.slice(0, k).join('-'));
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Addresses of the candidate's posting: its URL, every alternative address, the apply target. */
function candidateUrls(candidate) {
  return [candidate.url, ...(Array.isArray(candidate.urls) ? candidate.urls : []), candidate.apply_url].filter(Boolean);
}

function companyLabel(...names) {
  return names.map((n) => String(n ?? '').trim()).filter(Boolean).join(' / ') || '-';
}

/** A rate range in per-hour terms, so a monthly and an hourly posting can be compared. */
const PER_HOUR = { hour: 1, day: 1 / 8, month: 1 / 168, year: 1 / (12 * 168) };

function hourly(range) {
  if (!range) return null;
  const k = PER_HOUR[String(range.unit ?? 'hour').toLowerCase()] ?? 1;
  const min = range.min ?? range.max;
  const max = range.max ?? range.min;
  return min == null ? null : { min: min * k, max: max * k };
}

/** "overlap" | "missing" (one side has no rate) | null (rates differ: not the same posting). */
function likelySamePosting(candidate, job) {
  if (!sameCompany(candidate, job) || !sameTitle(candidate.title, job.title)) return null;
  const a = hourly(candidate.salary);
  const b = hourly(jobSalary(job));
  if (!a || !b) return 'missing';
  return a.min <= b.max + 0.5 && b.min <= a.max + 0.5 ? 'overlap' : null;
}

/** Inverse document frequency over the archive — a token common here is worth little. */
function buildIdf(documents) {
  const df = new Map();
  for (const tokens of documents) {
    for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = documents.length || 1;
  return (token) => Math.log((n + 1) / ((df.get(token) ?? 0) + 1));
}

// ---------------------------------------------------------------- scoring

function salaryOverlap(a, b) {
  if (!a || !b) return false;
  const [aMin, aMax] = [a.min ?? a.max, a.max ?? a.min];
  const [bMin, bMax] = [b.min ?? b.max, b.max ?? b.min];
  if (aMin == null || bMin == null) return false;
  return aMin <= bMax && bMin <= aMax;
}

function jobSalary(job) {
  if (job.salary_min_hour || job.salary_max_hour) {
    return { min: job.salary_min_hour, max: job.salary_max_hour, unit: 'hour' };
  }
  if (job.salary_min_month || job.salary_max_month) {
    return { min: job.salary_min_month, max: job.salary_max_month, unit: 'month' };
  }
  return null;
}

// ---------------------------------------------------------------- reference numbers

/** Every ref a candidate carries: given explicitly, in its URLs, in its body text. */
function candidateRefs(candidate) {
  const out = [];
  const seen = new Set();
  explicitRefs(candidate.ref, out, seen);
  explicitRefs(candidate.refs, out, seen);
  for (const u of [...candidateUrls(candidate), ...(candidate.apply_urls ?? [])]) urlRefs(u, out, seen);
  extractRefs(candidate.text, out, seen);
  return out;
}

const JOB_TEXT_FIELDS = ['title', 'source_url', 'apply_url', 'description', 'notes', 'communication'];
const jobRefCache = new WeakMap();
const jobTokenCache = new WeakMap();

function jobRefs(job) {
  if (!jobRefCache.has(job)) {
    jobRefCache.set(job, extractRefs(JOB_TEXT_FIELDS.map((f) => job[f]).filter(Boolean).join('\n')));
  }
  return jobRefCache.get(job);
}

/** Normalised whitespace-separated tokens of the row's text: a ref written without a label. */
function jobTokens(job) {
  if (!jobTokenCache.has(job)) {
    const text = JOB_TEXT_FIELDS.map((f) => job[f]).filter(Boolean).join(' ');
    jobTokenCache.set(job, new Set(text.split(/[\s,;()[\]"'<>]+/).map(normRef).filter((x) => x.length >= 5)));
  }
  return jobTokenCache.get(job);
}

function compare(candidate, job, idfTitle, idfTech) {
  const reasons = [];
  let score = 0;
  let exact = false;

  // Hard identifiers first — when they hit, nothing else matters.
  // The same URL is a duplicate only when it names the posting: on a known ATS the posting id
  // decides (one eRecruiter form address serves every tenant), and a link shared by two different
  // companies is a suspicion, never proof.
  let urlSuspect = false;
  let urlReason = null;
  const candUrls = candidateUrls(candidate);
  const jobUrls = [job.source_url, job.apply_url].filter(Boolean);
  const urlHits = candUrls.flatMap((a) => jobUrls.map((b) => ({ a, b, how: sameUrlPosting(a, b) })))
    .filter((x) => x.how);
  const sameUrl = urlHits.find((x) => x.how === 'same');
  if (sameUrl && otherCompany(candidate, job)) {
    urlSuspect = true; score += 3;
    urlReason = t('match.same_url_other_company', { ours: companyLabel(candidate.agency, candidate.company),
      theirs: companyLabel(job.agency, job.hiring_company) });
    reasons.push(urlReason);
  } else if (sameUrl) {
    score += 100; exact = true; reasons.push(t('match.same_url'));
  } else if (urlHits.length) {
    urlSuspect = true; score += 3;
    urlReason = t('match.same_url_no_id', { ats: atsOf(urlHits[0].a) ?? atsOf(urlHits[0].b) ?? 'ATS' });
    reasons.push(urlReason);
  }
  // Reference numbers and ATS form ids, on both sides. A weak (short numeric) one needs the same
  // company as well; without it, it is only named.
  const cRefs = candidate._refs ?? [];
  const jRefs = cRefs.length ? jobRefs(job) : [];
  const sharedRefs = cRefs.filter((c) => jRefs.some((j) => sameRef(c, j))
    || (c.kind === 'ref' && !isWeakRef(c) && jobTokens(job).has(c.value)));
  const company = sharedRefs.length ? sameCompany(candidate, job) : false;
  for (const ref of sharedRefs) {
    const key = ref.kind === 'ref' ? 'match.ref' : POSTING_ID_KINDS.has(ref.kind) ? 'match.posting_id' : 'match.same_form';
    if (!isWeakRef(ref) || company) {
      if (!exact) score += 100;
      exact = true;
      reasons.push(t(key, { ref: fmtRef(ref) }));
    } else {
      score += 2;
      reasons.push(t('match.ref_weak', { ref: fmtRef(ref) }));
    }
  }

  // Title tokens, weighted by how rare they are in the archive.
  const candTitle = tokenize(candidate.title);
  const jobTitle = tokenize(job.title);
  const sharedTitle = candTitle.filter((t) => jobTitle.includes(t));
  for (const t of sharedTitle) score += 3 * idfTitle(t);

  // Technology tags: boards keep these in a closed vocabulary, so they travel between postings.
  const candTech = techList(candidate.tech ?? candidate.technologies);
  const jobTech = techList(job.technologies);
  const sharedTech = candTech.filter((t) => jobTech.includes(t));
  for (const t of sharedTech) score += 2 * idfTech(t);

  // Rate and location come from the client, not from the agency that reposted the role.
  if (salaryOverlap(candidate.salary, jobSalary(job))) { score += 1.5; reasons.push(t('match.salary_overlap')); }
  const candLoc = tokenize(candidate.location);
  const jobLoc = tokenize(job.location);
  if (candLoc.length && candLoc.some((t) => jobLoc.includes(t))) { score += 1; reasons.push(t('match.same_location')); }

  // Same company under two names is common enough to be worth its own signal.
  const candCompanies = tokenize(`${candidate.company ?? ''} ${candidate.agency ?? ''}`);
  const jobCompanies = tokenize(`${job.hiring_company ?? ''} ${job.agency ?? ''}`);
  const sharedCompany = candCompanies.filter((t) => jobCompanies.includes(t));
  if (sharedCompany.length) { score += 2; reasons.push(t('match.company', { names: sharedCompany.join(', ') })); }

  const likely = exact ? null : likelySamePosting(candidate, job);
  if (likely) {
    reasons.unshift(t(likely === 'overlap' ? 'match.likely_same_posting' : 'match.likely_same_posting_no_rate'));
  }

  // nofluffjobs: another city page of what looks like the same posting (no reference to prove it).
  let otherPlace = null;
  if (!exact) {
    const slugs = companySlugs(candidate, job);
    for (const a of candUrls) {
      for (const b of jobUrls) otherPlace ??= nfjPlaceVariant(a, b, slugs);
    }
    if (otherPlace) { score += 3; reasons.unshift(t('match.nfj_other_place', otherPlace)); }
  }

  // A skipped entry was set aside without review: whatever matched, it carries no decision.
  const skipped = String(job.status ?? '').trim().toLowerCase() === 'skipped';
  if (skipped) reasons.unshift(t('match.previously_skipped'));
  // A closed entry was stopped by the employer: the same posting active again has reopened.
  const closed = String(job.status ?? '').trim().toLowerCase() === 'closed';
  if (closed) reasons.unshift(t('match.previously_closed'));
  // A duplicate row points at the entry that holds the decision.
  if (job.duplicate_of_id) reasons.push(t('match.duplicate_of', { id: job.duplicate_of_id }));

  return { score, exact, likely, otherPlace, urlSuspect: exact ? false : urlSuspect,
    urlReason: exact ? null : urlReason, skipped, closed, sharedTitle, sharedTech, sharedRefs, reasons };
}

// ---------------------------------------------------------------- reporting

function fmtDate(job) {
  const raw = job.found_at ?? job.updated_at ?? '';
  return String(raw).slice(0, 10) || '?';
}

function fmtLine(job, cmp) {
  const who = [job.agency, job.hiring_company].filter(Boolean).join(' / ') || '-';
  const shared = [...cmp.sharedTitle, ...cmp.sharedTech];
  const why = [
    ...cmp.reasons,
    shared.length ? t('match.shared', { tokens: shared.join(', ') }) : null,
  ].filter(Boolean).join('; ');
  return `#${job.id} | ${job.title ?? '-'} | ${who} | ${job.status ?? '-'} | ${fmtDate(job)} | ${why}`;
}

/** `!!` duplicate, `!` likely the same posting (or another NFJ city page of it) or a suspicious
 *  shared URL; `~~` / `~` the same against a skipped entry. */
function marker(cmp) {
  if (cmp.exact) return cmp.skipped ? '~~ ' : '!! ';
  if (cmp.likely || cmp.otherPlace || cmp.urlSuspect) return cmp.skipped ? '~  ' : '!  ';
  return '   ';
}

// ---------------------------------------------------------------- matching

/**
 * For each candidate, the closest archive rows: [{candidate, scored: [{job, cmp}]}] in input order,
 * plus rootOf() to follow duplicate_of_id. `jobs` are pipeline rows as crek-db returns them.
 */
export function matchCandidates(candidates, jobs, { top = DEFAULT_TOP } = {}) {
  const byId = new Map(jobs.map((j) => [String(j.id), j]));
  for (const c of candidates) c._refs = candidateRefs(c);
  const rootOf = (job) => {
    let cur = job;
    for (let i = 0; i < 10 && cur?.duplicate_of_id && byId.has(String(cur.duplicate_of_id)); i++) cur = byId.get(String(cur.duplicate_of_id));
    return cur ?? job;
  };
  const idfTitle = buildIdf(jobs.map((j) => tokenize(j.title)));
  const idfTech = buildIdf(jobs.map((j) => techList(j.technologies)));
  const results = candidates.map((candidate) => {
    const scored = jobs
      .filter((job) => candidate.id == null || String(job.id) !== String(candidate.id))
      .map((job) => ({ job, cmp: compare(candidate, job, idfTitle, idfTech) }))
      .filter(({ cmp }) => cmp.score > 0.5 || cmp.likely || cmp.otherPlace || cmp.urlSuspect);
    const tier = ({ cmp }) => (cmp.exact ? 2 : cmp.likely || cmp.otherPlace || cmp.urlSuspect ? 1 : 0);
    scored.sort((a, b) => tier(b) - tier(a) || b.cmp.score - a.cmp.score);
    const hits = scored.filter((x) => tier(x) > 0).length;
    return { candidate, scored: scored.slice(0, Math.max(top, hits)) };
  });
  return { results, rootOf };
}

/** The --json shape: one object per candidate. */
export function resultsJson({ results, rootOf }) {
  return results.map(({ candidate, scored }) => ({
    candidate: candidate.title,
    candidate_id: candidate.id ?? null,
    candidate_refs: candidate._refs.map(fmtRef),
    matches: scored.map(({ job, cmp }) => ({
      id: job.id, title: job.title, agency: job.agency, hiring_company: job.hiring_company,
      status: job.status, date: fmtDate(job), applied_date: job.applied_date ?? null,
      duplicate_of_id: job.duplicate_of_id ?? null, root_id: rootOf(job).id, root_status: rootOf(job).status,
      shared_refs: cmp.sharedRefs.map(fmtRef), score: Number(cmp.score.toFixed(2)),
      exact: cmp.exact, likely_same_posting: Boolean(cmp.likely), url_suspect: cmp.urlSuspect, url_reason: cmp.urlReason,
      other_place: cmp.otherPlace ? `${cmp.otherPlace.a} / ${cmp.otherPlace.b}` : null,
      previously_skipped: cmp.skipped,
      previously_closed: cmp.closed,
      likely_same_posting_rate: cmp.likely ?? null, shared: [...cmp.sharedTitle, ...cmp.sharedTech], reasons: cmp.reasons,
    })),
  }));
}

export { sameTitle, likelySamePosting, titleForms, companyName, sameCompany, otherCompany, tokenize, hourly };

// ---------------------------------------------------------------- main

async function main(args) {
  const opt = { top: DEFAULT_TOP };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--config') opt.config = args[++i];
    else if (a === '--api') opt.api = args[++i];
    else if (a === '--lang') opt.lang = args[++i];
    else if (a === '--auth') opt.auth = args[++i];
    else if (a === '--candidates') opt.candidates = args[++i];
    else if (a === '--top') opt.top = Number(args[++i]);
    else if (a === '--json') opt.json = true;
    else if (a === '--refresh') { /* pre-1.9 option: there is no cache any more */ }
    else if (a === '--cache') { i++; /* pre-1.9 option: there is no cache any more */ }
    else if (a === '-h' || a === '--help') usage();
    else usage(`unknown option ${a}`);
  }
  if (!Number.isInteger(opt.top) || opt.top < 1) usage('--top takes a positive whole number');

  let where;
  try { where = resolveDb(opt); } catch (err) { usage(err.message); }
  // Language: --lang, then env CREK_LANG, then presentation.language from the config.
  setLanguage(opt.lang ?? (process.env.CREK_LANG || undefined) ?? where.language);

  let raw;
  try {
    raw = opt.candidates ? readFileSync(resolve(opt.candidates), 'utf8') : readFileSync(0, 'utf8');
  } catch (err) { usage(`cannot read the candidates: ${err.message}`); }
  let candidates;
  try {
    candidates = JSON.parse(raw);
  } catch (err) {
    usage(`candidates are not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(candidates)) candidates = [candidates];
  if (!candidates.length) usage('no candidates given');
  if (candidates.some((c) => !c || typeof c !== 'object' || !c.title)) usage('every candidate needs a "title"');

  const pipe = await openDb(where.db, { baseDir: where.baseDir });
  let jobs;
  try { jobs = await pipe.listJobs(); } finally { await pipe.close(); }
  const matched = matchCandidates(candidates, jobs, { top: opt.top });

  if (opt.json) {
    console.log(JSON.stringify(resultsJson(matched), null, 1));
    return;
  }
  const { results } = matched;
  console.log(t('match.header', { entries: jobs.length, candidates: candidates.length }));
  for (const { candidate, scored } of results) {
    console.log(`\n== ${candidate.title}${candidate.agency ? ` @ ${candidate.agency}` : ''}`
      + (candidate._refs.length ? `  [${candidate._refs.map(fmtRef).join('; ')}]` : ''));
    if (!scored.length) {
      console.log(`   ${t('match.nothing_similar')}`);
      continue;
    }
    for (const { job, cmp } of scored) {
      console.log(`   ${marker(cmp)}${fmtLine(job, cmp)}`);
    }
  }
  const hits = results.flatMap(({ scored }) => scored.map(({ cmp }) => cmp))
    .filter((cmp) => cmp.exact || cmp.likely || cmp.otherPlace || cmp.urlSuspect);
  if (hits.some((cmp) => !cmp.skipped)) console.log(`\n${t('match.legend')}`);
  if (hits.some((cmp) => cmp.skipped)) console.log(`\n${t('match.legend_skipped')}`);
  console.log(`\n${t('match.closing')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`error: ${err instanceof DbError ? err.message : err.stack ?? err}`);
    process.exit(1);
  });
}
