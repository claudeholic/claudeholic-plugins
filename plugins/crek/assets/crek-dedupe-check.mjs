#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
/**
 * crek-dedupe-check — before a batch is printed: is any of these postings one we already applied to?
 *
 *   node crek-dedupe-check.mjs --tabs 306,307,310 --config crek.config.json   # open tabs ([N] prefix)
 *   node crek-dedupe-check.mjs --tabs 306=1169 --config crek.config.json      # tab N is pipeline row 1169
 *   node crek-dedupe-check.mjs --ids 1169,1170 --config crek.config.json      # stored data only, no browser
 *
 * The same recruitment reaches the pipeline through several boards (one agency on pracuj.pl and
 * LinkedIn, another on justjoin and theprotocol, a third on justjoin and nofluffjobs). crek-match marks such a
 * pair `!` (same agency, same title) but cannot prove it; the user then asks to send a posting that
 * was sent a week ago. This script settles it before the table is printed, the same way every time:
 *
 * 1. For each posting it collects the reference numbers and ATS form ids (crek-refs.mjs) from the
 *    open tab — the page text (on LinkedIn the posting's own panel when the page has one) and the
 *    links behind "Apply" / "Aplikuj" buttons — plus what the pipeline row already stores about
 *    itself (description "REF:" line, source_url, apply_url). No site API is called: LinkedIn's
 *    external "Apply" is a button without a link, so for LinkedIn the apply target is whatever
 *    the row stores (a warning says so).
 * 2. It matches them against the archive with crek-match's matchCandidates(), in this process,
 *    on the rows it read once at the start (crek-db.mjs: sqlite, mysql or http-api). Nothing is
 *    cached between runs and nothing is written to disk.
 * 3. Verdict per posting:
 *    - `duplicate`  — a `!!` hit (same URL, same reference number, same application form) on an
 *                     entry that is not `skipped` / `closed`: record status=duplicate,
 *                     duplicate_of_id=<earlier> with the printed note; not a row of the batch.
 *    - `in_pipeline`— no hard hit, but a `!` hit (same company/agency + same normalised title) on an
 *                     entry applied to (applied / interview / offer, followed through duplicate_of_id):
 *                     not a row either — listed under the table in "Already in the pipeline" as
 *                     "likely the same posting".
 *    - `keep`       — everything else, including `!` hits on new / skipped / declined entries, and a
 *                     shared URL that proves nothing (two different companies, or a common ATS form
 *                     address without a shared posting id — noted, never `duplicate`) (the
 *                     row stays, with the template comment). A different reference number on the
 *                     applied entry does not make it `keep`: reposts get new numbers (site id 10001 →
 *                     10042 can be the same recruitment).
 *
 * --open-earlier: for an `in_pipeline` verdict where the earlier entry stores no reference number,
 * open its source_url in ONE tab of this script's own, read the refs there and compare — a shared
 * one turns it into `duplicate`. The tab is closed at the end. A LinkedIn source_url is not
 * opened (LinkedIn treats scripted page loads as automation): a warning says to compare by hand.
 *
 * Read only: no writes to the pipeline, and --tabs never navigates, clicks or reloads a tab.
 * Output: one line per posting (or --json) with the suggested note for the pipeline. Exit 0; 1 = no
 * browser / pipeline error; 2 = usage. Requires Node >= 22 (built-in WebSocket; >= 22.13 for sqlite).
 */
import { extractRefs, urlRefs, fmtRef, sameRef, canonicalUrl } from './crek-refs.mjs';
import { resolveDb, openDb, DbError } from './crek-db.mjs';
import { matchCandidates, resultsJson, setLanguage as setMatchLanguage } from './crek-match.mjs';
import { resolveLang, translator } from './crek-i18n.mjs';
import {
  PORTS, findPort as findCdpPort, connect, listPages, openTab, closeTab, goto, sleep, isLinkedin,
} from './crek-cdp.mjs';

const APPLIED = new Set(['applied', 'interview', 'offer']);
const NO_DECISION = new Set(['skipped', 'closed']);

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error(`usage: node crek-dedupe-check.mjs (--tabs N[=id],... | --ids id,...) [options]

  --tabs N[=id],...   postings open in tabs, by the [N] prefix of their title; "=id" names the
                      pipeline row (otherwise found by the tab URL)
  --ids id,...        pipeline rows, from stored data only (no browser)
  --open-earlier      read refs of an applied earlier entry from its own page when it stores none
  --config <path>     crek.config.json (db, presentation.language)
  --api <url>         use an http-api instead of the config (token: env CREK_TOKEN, basic auth:
                      env CREK_AUTH; --auth <user:pass> works too but is visible in ps)
  --lang <code|name>  language of the verdicts and the summary (default: env CREK_LANG, then
                      the config); the match reasons in the notes are always English
  --port <n>          Chrome debugging port (default: env CS_CHROME_PORT, 9226, 9227, 9222)
  --json              machine-readable output`);
  process.exit(2);
}

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--tabs') opt.tabs = String(args[++i] ?? '').split(/[\s,]+/).filter(Boolean);
  else if (a === '--ids') opt.ids = String(args[++i] ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  else if (a === '--open-earlier') opt.openEarlier = true;
  else if (a === '--config') opt.config = args[++i];
  else if (a === '--api') opt.api = args[++i];
  else if (a === '--auth') opt.auth = args[++i];
  else if (a === '--lang') opt.lang = args[++i];
  else if (a === '--refresh') { /* pre-1.9 option: there is no cache any more */ }
  else if (a === '--cache') { i++; /* pre-1.9 option: there is no cache any more */ }
  else if (a === '--port') opt.port = Number(args[++i]);
  else if (a === '--json') opt.json = true;
  else if (a === '-h' || a === '--help') usage();
  else usage(`unknown option ${a}`);
}
if (!opt.tabs?.length === !opt.ids?.length) usage('give exactly one of --tabs or --ids');
const tabSpecs = (opt.tabs ?? []).map((s) => {
  const m = s.match(/^(\d+)(?:=(\d+))?$/);
  if (!m) usage(`--tabs takes N or N=id, got "${s}"`);
  return { tab: Number(m[1]), id: m[2] ? Number(m[2]) : null };
});
if (opt.ids?.some((n) => !Number.isInteger(n))) usage('--ids takes pipeline row ids, e.g. --ids 1169,1170');
if (opt.port !== undefined && !Number.isInteger(opt.port)) usage('--port takes a port number');
let where;
try { where = resolveDb(opt); } catch (err) { usage(err.message); }
// Language: --lang, then env CREK_LANG, then presentation.language from the config.
const t = translator(resolveLang(opt.lang ?? (process.env.CREK_LANG || undefined) ?? where.language));
// The match reasons quoted in the notes ("same URL", "ref JOB-7K2QX", ...) are recorded in English
// whatever the presentation language: they are evidence kept in the pipeline, read back by later
// runs, not wording for the user. The verdicts and the summary follow the user's language.
setMatchLanguage('en');

// ---------------------------------------------------------------- the pipeline (read only, once)

let jobs;
try {
  const pipe = await openDb(where.db, { baseDir: where.baseDir });
  try { jobs = await pipe.listJobs(); } finally { await pipe.close(); }
} catch (err) {
  console.error(`error: ${err instanceof DbError ? err.message : err.message ?? err}`);
  process.exit(1);
}
const byId = new Map(jobs.map((j) => [String(j.id), j]));
const rowById = (id) => byId.get(String(id));
const byUrl = new Map();
for (const j of jobs) {
  for (const u of [j.source_url, j.apply_url]) {
    const c = canonicalUrl(u);
    if (c && !byUrl.has(c)) byUrl.set(c, j);
  }
}

function rootOf(job) {
  let cur = job;
  for (let i = 0; i < 10 && cur?.duplicate_of_id && rowById(cur.duplicate_of_id); i++) cur = rowById(cur.duplicate_of_id);
  return cur ?? job;
}

/** What a row says about its own posting: the "REF:" line and its URLs (not notes, which also
 *  name other entries' numbers, e.g. "same as #123 … id/10001"). */
function ownRefs(job) {
  const out = [];
  const keys = new Set();
  const lines = String(job.description ?? '').split('\n').filter((l) => /^\s*REF:/i.test(l)).join('\n');
  extractRefs(lines, out, keys);
  for (const u of [job.source_url, job.apply_url]) urlRefs(u, out, keys);
  return out;
}

/** Everything a row stores, the application log included — for the earlier, applied entry. */
function allRefs(job) {
  return extractRefs(['source_url', 'apply_url', 'description', 'notes', 'communication']
    .map((f) => job[f]).filter(Boolean).join('\n'));
}

function salaryOf(job) {
  if (job.salary_min_hour || job.salary_max_hour) return { min: job.salary_min_hour, max: job.salary_max_hour, unit: 'hour' };
  if (job.salary_min_month || job.salary_max_month) return { min: job.salary_min_month, max: job.salary_max_month, unit: 'month' };
  return undefined;
}

// ---------------------------------------------------------------- CDP (crek-cdp.mjs)

async function findPort() {
  return (await findCdpPort(opt.port))?.port ?? null;
}

// The page as loaded: URL, title, text, and where its "Apply" buttons lead. On LinkedIn the text is
// the posting's own panel when one of the known containers is there (the whole page also carries
// feeds and other postings); `panel` says whether one was found.
const READ_PAGE = `(() => {
  const APPLY = /apply|aplikuj|złóż|zloz|application|bewerb|candidat/i;
  let panel = null;
  if (/(^|\\.)linkedin\\.com$/i.test(location.hostname)) {
    for (const sel of ['#job-details', '.jobs-description__content', '.jobs-description', '.jobs-details', '.job-view-layout']) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) { panel = el.innerText; break; }
    }
  }
  const links = [];
  for (const el of document.querySelectorAll('a[href], button, [role=button]')) {
    const label = [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' ');
    if (!APPLY.test(label)) continue;
    const href = el.href || el.getAttribute('data-href') || el.closest('a[href]')?.href || '';
    if (href) links.push(href);
  }
  // nofluffjobs keeps its posting reference out of the text: the og:image URL carries it.
  const meta = [...document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')]
    .map((m) => m.getAttribute('content')).filter(Boolean);
  return { url: location.href, title: document.title, text: panel ?? (document.body ? document.body.innerText : ''),
           panel: panel !== null, links, meta };
})()`;

/** Evidence from one page: refs and apply targets. */
function evidence(seen) {
  const applyUrls = [...new Set((seen.links ?? []).filter(Boolean))];
  const out = [];
  const keys = new Set();
  extractRefs(seen.text ?? '', out, keys);
  for (const u of [seen.url, ...applyUrls, ...(seen.meta ?? [])]) urlRefs(u, out, keys);
  return { refs: out, applyUrls };
}

/** What the script could not read on a LinkedIn tab, for the warning column. */
function linkedinWarning(seen, ev) {
  if (!isLinkedin(seen.url)) return undefined;
  const parts = [];
  if (!seen.panel) parts.push('LinkedIn: posting panel not found, refs read from the whole page');
  if (!ev.applyUrls.length) parts.push('LinkedIn: the Apply target is not read by the script — open "Apply" in the browser if it matters');
  return parts.join('; ') || undefined;
}

/** "[306] Build and Release Engineer (f/m/x) | Northwind Consulting | LinkedIn" → title, company. */
function fromTitle(title) {
  const parts = String(title ?? '').replace(/^\[\d+\]\s*/, '').split(/\s+\|\s+/);
  if (parts.length >= 3 && /linkedin/i.test(parts.at(-1))) return { title: parts[0], agency: parts[1] };
  return { title: parts[0] || '?', agency: undefined };
}

// ---------------------------------------------------------------- collect the postings

const items = [];
let port = null;

if (opt.ids) {
  for (const id of opt.ids) {
    const row = rowById(id);
    if (!row) { items.push({ id, error: 'no such pipeline row' }); continue; }
    items.push({ id, row, refs: [], applyUrls: [], url: row.source_url });
  }
} else {
  port = await findPort();
  if (!port) {
    console.error(`error: no Chrome debugging port responded (tried ${(opt.port ? [opt.port] : PORTS).join(', ')}). `
      + 'Is the chrome-shared plugin running? Without a browser use --ids.');
    process.exit(1);
  }
  const targets = await listPages(port);
  for (const spec of tabSpecs) {
    const target = targets.find((x) => x.title.startsWith(`[${spec.tab}] `));
    if (!target) { items.push({ tab: spec.tab, error: 'no tab with this number' }); continue; }
    let page;
    try {
      page = await connect(target.webSocketDebuggerUrl);
      const seen = await page.evaluate(READ_PAGE);
      const ev = evidence(seen);
      const row = spec.id != null ? rowById(spec.id) : byUrl.get(canonicalUrl(seen.url));
      items.push({ tab: spec.tab, id: row?.id ?? spec.id ?? null, row, url: seen.url, pageTitle: seen.title, ...ev,
        warn: linkedinWarning(seen, ev) });
    } catch (err) {
      items.push({ tab: spec.tab, error: err.message });
    } finally {
      page?.close();
    }
  }
}

// ---------------------------------------------------------------- match against the archive

const live = items.filter((x) => !x.error);
const candidates = live.map((x) => {
  const guess = fromTitle(x.pageTitle);
  const row = x.row;
  return {
    id: x.id ?? undefined,
    title: row?.title ?? guess.title,
    agency: row?.agency ?? guess.agency,
    company: row?.hiring_company ?? undefined,
    url: x.url ?? row?.source_url,
    apply_url: row?.apply_url ?? undefined,
    apply_urls: x.applyUrls,
    tech: row?.technologies ?? undefined,
    salary: row ? salaryOf(row) : undefined,
    refs: [...x.refs, ...(row ? ownRefs(row) : [])].map(fmtRef),
  };
});

let matched = [];
if (candidates.length) {
  // The rows read at the start, handed over in memory: no second download, no file, no credentials
  // on a command line.
  matched = resultsJson(matchCandidates(candidates, jobs, { top: 40 }));
}

// ---------------------------------------------------------------- verdicts

const fmtDay = (d) => (d ? `${String(d).slice(8, 10)}.${String(d).slice(5, 7)}` : '?');
const now = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const checked = `${p2(now.getDate())}.${p2(now.getMonth() + 1)} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
const today = `${p2(now.getDate())}.${p2(now.getMonth() + 1)}.${now.getFullYear()}`; // notes: DD.MM.YYYY
const who = (j) => j.agency || j.hiring_company || '-';
const rank = (s) => ({ offer: 5, interview: 4, applied: 3, rejected: 2, declined: 1 }[s] ?? 0);

function verdictFor(item, m) {
  const cRefs = m.candidate_refs;
  const hits = m.matches.map((x) => ({ ...x, root: rowById(x.root_id) ?? rowById(x.id) }));
  // A shared URL under two different companies, or a shared ATS form address without a shared
  // posting id, is never a duplicate (crek-match marks it url_suspect, not exact).
  const hard = hits.filter((x) => x.exact && !x.url_suspect
    && !NO_DECISION.has(String(x.status)) && !NO_DECISION.has(String(x.root?.status)));
  if (hard.length) {
    hard.sort((a, b) => rank(b.root.status) - rank(a.root.status) || a.root.id - b.root.id);
    const e = hard[0];
    const why = e.shared_refs.length ? e.shared_refs.join(', ') : e.reasons.find((r) => r) ?? '';
    return { verdict: 'duplicate', earlier: e.root, evidence: why,
      note: t('dedupe.note.duplicate', { id: e.root.id, agency: who(e.root), status: e.root.status,
        date: fmtDay(e.root.applied_date ?? e.root.found_at), evidence: why, checked }) };
  }
  const likely = hits.filter((x) => x.likely_same_posting && !x.previously_skipped && APPLIED.has(String(x.root?.status)));
  if (likely.length) {
    likely.sort((a, b) => rank(b.root.status) - rank(a.root.status) || a.root.id - b.root.id);
    const e = likely[0];
    return { verdict: 'in_pipeline', earlier: e.root, evidence: '',
      needsEarlier: cRefs.length > 0 && !allRefs(e.root).length,
      note: t('dedupe.note.in_pipeline', { id: e.root.id, agency: who(e.root), status: e.root.status,
        date: fmtDay(e.root.applied_date ?? e.root.found_at), checked }) };
  }
  const suspect = hits.find((x) => x.url_suspect && !x.previously_skipped);
  if (suspect) {
    return { verdict: 'keep', earlier: suspect.root, evidence: '',
      note: t('dedupe.note.url_suspect', { id: suspect.id, agency: who(suspect), reason: suspect.url_reason ?? '', checked }) };
  }
  const other = hits.find((x) => (x.exact || x.likely_same_posting));
  return { verdict: 'keep', earlier: other?.root ?? null, evidence: '', note: '' };
}

// A failure (no such row, no tab) is reported in `warn`, never in `note`: the note is what gets
// appended to the pipeline row.
const results = items.map((item) => {
  if (item.error) return { ...item, verdict: 'unknown', note: '', warn: item.error };
  const m = matched[live.indexOf(item)]; // crek-match answers in input order
  return { ...item, refs: m?.candidate_refs ?? [], ...(m ? verdictFor(item, m) : { verdict: 'unknown', note: '', warn: 'no match output' }) };
});

// --open-earlier: read the refs of an applied earlier entry from its own page.
let pendingEarlier = results.filter((r) => r.verdict === 'in_pipeline' && r.needsEarlier && r.earlier?.source_url);
if (opt.openEarlier) {
  for (const r of pendingEarlier.filter((x) => isLinkedin(x.earlier.source_url))) {
    r.warn = `--open-earlier: #${r.earlier.id} is on LinkedIn, not opened by the script — compare its refs by hand`
      + ' (linkedin-mcp or the page in the browser)';
  }
  pendingEarlier = pendingEarlier.filter((x) => !isLinkedin(x.earlier.source_url));
}
if (opt.openEarlier && pendingEarlier.length) {
  port ??= await findPort();
  if (!port) {
    for (const r of pendingEarlier) r.warn = 'no browser for --open-earlier';
  } else {
    const created = await openTab(port);
    let page;
    try {
      page = await connect(created.webSocketDebuggerUrl);
      for (const r of pendingEarlier) {
        try {
          const url = r.earlier.source_url;
          await goto(page, url);
          const ev = evidence(await page.evaluate(READ_PAGE));
          const cand = r.refs.map((x) => extractRefs(`REF: ${x}`)[0]).filter(Boolean);
          const shared = cand.filter((c) => ev.refs.some((e) => sameRef(c, e)));
          const vars = { id: r.earlier.id, agency: who(r.earlier), status: r.earlier.status,
            date: fmtDay(r.earlier.applied_date ?? r.earlier.found_at), checked };
          if (shared.length) {
            Object.assign(r, { verdict: 'duplicate', evidence: shared.map(fmtRef).join(', '),
              note: t('dedupe.note.duplicate', { ...vars, evidence: `${shared.map(fmtRef).join(', ')} (${url})` }) });
          }
        } catch (err) {
          r.warn = `--open-earlier: ${err.message}`;
        }
        await sleep(1500);
      }
    } finally {
      page?.close();
      await closeTab(port, created.id);
    }
  }
}

// ---------------------------------------------------------------- output

if (opt.json) {
  console.log(JSON.stringify(results.map((r) => ({
    tab: r.tab ?? null, id: r.id ?? null, url: r.url ?? null, verdict: r.verdict, refs: r.refs ?? [],
    apply_urls: r.applyUrls ?? [], earlier_id: r.earlier?.id ?? null, earlier_status: r.earlier?.status ?? null,
    evidence: r.evidence ?? '', note: r.note ? `${today}: ${r.note}` : '', warning: r.warn ?? null,
  })), null, 1));
} else {
  for (const r of results) {
    const label = [r.tab != null ? `[${r.tab}]` : null, r.id != null ? `#${r.id}` : null].filter(Boolean).join(' ') || '-';
    const earlier = r.earlier ? ` → #${r.earlier.id} ${who(r.earlier)} (${r.earlier.status})` : '';
    console.log(`${label} | ${t(`dedupe.verdict.${r.verdict}`)}${earlier} | ${t('dedupe.refs')}: ${(r.refs ?? []).join('; ') || '-'}`
      + (r.note ? ` | ${today}: ${r.note}` : '') + (r.warn ? ` | ! ${r.warn}` : ''));
  }
  const count = (v) => results.filter((r) => r.verdict === v).length;
  console.log(t('dedupe.summary', { duplicate: count('duplicate'), in_pipeline: count('in_pipeline'),
    keep: count('keep'), unknown: count('unknown'), total: results.length, checked }));
}
