// SPDX-License-Identifier: GPL-3.0-only
/**
 * crek-refs — posting reference numbers and ATS application-form ids, found in free text and URLs.
 *
 * Shared by crek-match.mjs (archive rows) and crek-dedupe-check.mjs (open tabs). The same posting
 * reaches the pipeline through several boards under different URLs, but its reference number
 * ("Job no. JOB-7K2QX", "Reference number: dpt.DATA_26.10", Workday "R-12345") and the form its
 * "Apply" button leads to (Traffit form 48213, eRecruiter WebID, Greenhouse job 7712345004, …) stay
 * the same. Two postings that share one are the same recruitment — a hard duplicate.
 *
 * A ref is {kind, value, raw}:
 *   kind  — "ref" for a reference number read from text (label-based or a known format), or the
 *           ATS / site the id was read from ("traffit", "erecruiter", "greenhouse", "lever",
 *           "ashby", "smartrecruiters", "recruitify", "darize", "workday", "sii", "personio",
 *           "workable", "pracuj", …);
 *   value — normalised: lowercase, letters and digits only ("JOB-7K2QX" → "job7k2qx");
 *   raw   — as found, for the reason text.
 * Two refs are the same when the values are equal and the kinds are compatible: equal, or one of
 * them is "ref" (a Workday "R-12345" in the body is the same as the R12345 in the apply URL).
 *
 * Some kinds are the board's own number of the posting rather than a form id (POSTING_ID_KINDS):
 * pracuj.pl `,oferta,<id>`, Sii `id/<n>`, and nofluffjobs' posting reference — an 8-character code
 * such as "QX7KD2PA" that NFJ keeps for one posting across all its city pages. NFJ gives every
 * city or region of a posting an address of its own (`/pl/job/devops-engineer-contoso-warszawa`,
 * `…-contoso-remote`, `…-contoso-lower-silesian`), so the URL names a city page, not the posting;
 * the reference is on the page (its `og:image` is `…/thumbnail-image/posting/<ref>`) and in the
 * board's posting data. It may have no digit at all ("ZKWPTRMB"), unlike every other ref.
 *
 * Where the pipeline keeps them: a line in `description` starting with "REF:", entries separated
 * by ";", each "kind:value" or just the value, e.g.
 *   REF: JOB-7K2QX; greenhouse:7712345; traffit:48213
 * Every other text field (notes, communication, apply_url, source_url) is read with the same
 * extractors, so refs written into the communication log or present in a URL count too.
 */

/** Lowercase, letters and digits only. */
export function normRef(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Kinds that are a board's own number of the posting, not an application-form id. */
export const POSTING_ID_KINDS = new Set(['nofluffjobs', 'pracuj', 'sii']);

/**
 * The nofluffjobs posting reference: exactly 8 letters and digits ("QX7KD2PA"). It may have no digit
 * ("ZKWPTRMB"), but then only as NFJ writes it, in capitals — otherwise any 8-letter word would do
 * ("nofluffjobs:platform", the start of an `api/joboffers/platform-engineer-…` slug).
 */
export function isNfjRef(raw) {
  const s = String(raw ?? '');
  return /^[A-Z0-9]{8}$/.test(s) || (/^[A-Za-z0-9]{8}$/.test(s) && /\d/.test(s));
}

// Kinds with a format of their own: it decides instead of the general rule (every other ref needs a
// digit, or "Reference: none" would count).
const KIND_FORMATS = { nofluffjobs: isNfjRef };

/** Short purely numeric ids (Traffit form 48213, a site id like 10042, darize 4321) collide across tenants. */
export function isWeakRef(ref) {
  return /^\d+$/.test(ref.value) ? ref.value.length < 6 : ref.value.length < 5;
}

export function sameRef(a, b) {
  return a.value === b.value && (a.kind === b.kind || a.kind === 'ref' || b.kind === 'ref');
}

// ---------------------------------------------------------------- ids in URLs (apply targets)

// Each: kind, regex over a URL (or any text containing one); group 1 is the id.
const URL_RULES = [
  ['traffit', /traffit\.com\/public\/(?:form\/a|an|job_posts?\/[^/\s]*)\/([0-9a-f]{16,})/gi],
  ['traffit', /traffit\.com\/public\/form\/thankyou\/(\d+)/gi],
  ['erecruiter', /erecruiter\.pl\/[^\s"']*?[?&](?:WebID|oid)=([0-9a-f]{16,}|\d{4,})/gi],
  ['greenhouse', /greenhouse\.io\/(?:[^/\s]+\/jobs|embed\/job_app\?[^\s"']*?token=)\/?(\d{5,})/gi],
  ['greenhouse', /[?&]gh_jid=(\d{5,})/gi],
  ['lever', /lever\.co\/[^/\s]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi],
  ['ashby', /ashbyhq\.com\/[^/\s]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi],
  ['smartrecruiters', /smartrecruiters\.com\/[^\s"']*?\/(?:publication\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{9,})/gi],
  ['recruitify', /recruitify\.ai\/job\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi],
  ['darize', /darize\.com\/assignments\/(\d+)/gi],
  ['workday', /myworkdayjobs\.com\/[^\s"']*?_((?:JR|R)-?\d{4,}|\d{3,})(?=[/?#"'\s]|$)/gi],
  ['sii', /sii\.pl\/(?:[a-z]{2}\/)?(?:oferty-pracy|job-ads)\/id\/(\d+)/gi],
  ['personio', /jobs\.personio\.(?:de|com)\/job\/(\d+)/gi],
  ['workable', /workable\.com\/[^/\s]+\/j\/([0-9A-F]{8,})/gi],
  ['pracuj', /pracuj\.pl\/(?:[^\s"']*?,oferta,|aplikowanie\/formularz\/)(\d{7,})/gi],
  ['hrappka', /hrappka\.pl\/oferta\/[^/\s]+\/(\d+)/gi],
  ['deel', /jobs\.deel\.com\/[^/\s]+\/job-details\/([0-9a-f-]{36})/gi],
  // nofluffjobs: the posting reference, on the page's og:image and in its own data links.
  // The reference is the whole path segment: a slug that merely starts with 8 letters is not one.
  ['nofluffjobs', /nofluffjobs\.com\/(?:[a-z]{2}\/)?(?:thumbnail-image\/posting|api\/joboffers)\/([a-z0-9]{8})(?![a-z0-9_-])/gi],
];

// "greenhouse:7712345", "nofluffjobs:QX7KD2PA" written anywhere in a text — the REF: line format,
// also used by the dated duplicate notes ("hard duplicate of #812 — shared: greenhouse:7712345").
const KIND_TOKEN_RE = new RegExp(
  String.raw`(?<![a-z0-9_])(${[...new Set(URL_RULES.map(([k]) => k))].join('|')}):([A-Za-z0-9][A-Za-z0-9._\-]{2,63})`, 'gi');

// ---------------------------------------------------------------- reference numbers in text

// Label + value. The value must contain a digit; trailing punctuation is dropped.
const LABEL = String.raw`(?:job\s*(?:no|nr|number|id|ref(?:erence)?(?:\s*(?:no|number|code))?)|`
  + String.raw`req(?:uisition)?\s*(?:id|no|number)|job\s*requisition\s*id|requisition\s*(?:id|no|number)|`
  + String.raw`reference\s*(?:no|number|code|id)?|ref\s*(?:no|nr|number)?|`
  + String.raw`nr\s*(?:ref(?:erencyjny)?|oferty|ogłoszenia|ogloszenia|rekrutacji)|`
  + String.raw`numer\s*(?:referencyjny|oferty|ogłoszenia|ogloszenia|rekrutacji)|`
  + String.raw`kod\s*(?:oferty|ogłoszenia|ogloszenia|referencyjny)|`
  + String.raw`id\s*(?:oferty|ogłoszenia|ogloszenia|stanowiska|rekrutacji)|`
  + String.raw`posting\s*id|vacancy\s*(?:id|no)|offer\s*id|form\s*id|webid)`;
const LABEL_RE = new RegExp(String.raw`(?<![a-z])${LABEL}\b\.?\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9._\-/]{1,40})`, 'gi');
// Traffit postings show a bare "ID: 123" next to the title.
const BARE_ID_RE = /(?<![a-z])ID\s*:\s*(\d{2,})(?!\d)/g;
// Formats recognisable without a label (case-sensitive on purpose).
const FORMAT_RULES = [
  /\bJOB-[A-Z0-9]{4,10}\b/g, // "Job no. JOB-7K2QX" (Sii and others)
  /\b(?:JR|R)-\d{4,8}\b/g, // Workday requisitions
];

const LINE_RE = /^[ \t]*REF:[ \t]*(.+)$/gim;

function cleanValue(v) {
  return String(v).replace(/[._\-/]+$/, '');
}

function push(out, seen, kind, raw) {
  const value = normRef(raw);
  if (!value || value.length < 3) return;
  const format = Object.hasOwn(KIND_FORMATS, kind) ? KIND_FORMATS[kind] : null;
  if (format ? !format(String(raw).trim()) : !/\d/.test(value)) return;
  const key = `${kind}|${value}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ kind, value, raw: String(raw) });
}

/** LinkedIn wraps external links in /safety/go/?url=…; read the target too. */
function unwrap(text) {
  return String(text).replace(/linkedin\.com\/safety\/go\/?\?url=([^&\s"']+)/gi, (m, u) => {
    try { return `${m} ${decodeURIComponent(u)}`; } catch { return m; }
  });
}

/** ATS / site ids from URLs anywhere in the text. */
export function urlRefs(text, out = [], seen = new Set()) {
  if (!text) return out;
  const s = unwrap(text);
  for (const [kind, re] of URL_RULES) {
    for (const m of s.matchAll(re)) push(out, seen, kind, m[1]);
  }
  return out;
}

/** Every ref in a piece of text: the REF: line, URL ids, labelled and known-format numbers. */
export function extractRefs(text, out = [], seen = new Set()) {
  if (!text) return out;
  const s = String(text);
  for (const m of s.matchAll(LINE_RE)) {
    for (const part of m[1].split(/[;,]/)) {
      const p = part.trim();
      if (!p) continue;
      const k = p.match(/^([a-z][a-z0-9_]*)\s*:\s*(.+)$/i);
      if (k && !/^(?:job|ref|nr|id)$/i.test(k[1])) push(out, seen, k[1].toLowerCase(), k[2]);
      else push(out, seen, 'ref', p);
    }
  }
  urlRefs(s, out, seen);
  for (const m of s.matchAll(KIND_TOKEN_RE)) push(out, seen, m[1].toLowerCase(), cleanValue(m[2]));
  for (const m of s.matchAll(LABEL_RE)) push(out, seen, 'ref', cleanValue(m[1]));
  for (const m of s.matchAll(BARE_ID_RE)) push(out, seen, 'ref', m[1]);
  for (const re of FORMAT_RULES) for (const m of s.matchAll(re)) push(out, seen, 'ref', m[0]);
  return out;
}

/** Refs given explicitly ("JOB-7K2QX", "traffit:48213", or an array of those). */
export function explicitRefs(value, out = [], seen = new Set()) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  for (const item of list) {
    if (item && typeof item === 'object') { push(out, seen, String(item.kind ?? 'ref'), item.raw ?? item.value); continue; }
    const p = String(item).trim();
    if (!p) continue;
    const k = p.match(/^([a-z][a-z0-9_]*)\s*:\s*(.+)$/i);
    if (k && !/^(?:https?|job|ref|nr|id)$/i.test(k[1])) push(out, seen, k[1].toLowerCase(), k[2]);
    else if (/^https?:/i.test(p)) urlRefs(p, out, seen);
    else push(out, seen, 'ref', p);
  }
  return out;
}

/** "JOB-7K2QX", "traffit:48213" — how a ref is named in reasons and REF: lines. */
export function fmtRef(ref) {
  return ref.kind === 'ref' ? ref.raw : `${ref.kind}:${ref.raw}`;
}

// ---------------------------------------------------------------- URLs

/**
 * Query parameters that only track a visit or the way to the posting — never which posting it is.
 * Everything else in the query stays: eRecruiter tells postings apart by `WebID` (or `oid`), an
 * embedded Greenhouse form by `token`, Indeed by `jk`, company career pages by `gh_jid`, `id`, …
 * so the old approach (keep a short list of id parameters, drop the rest) made every eRecruiter
 * posting the same URL. Matched lowercase; TRACKING_PREFIXES drop whole families.
 */
export const TRACKING_PARAMS = [
  // ad / analytics click ids
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid',
  'li_fat_id', 'igshid', 'srsltid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '_ga', '_gl',
  // where the visitor came from
  'ref', 'refid', 'ref_id', 'ref_src', 'referer', 'referrer', 'source', 'src', 'source_id', 'sourceid',
  'from', 'origin', 'campaign', 'gh_src', 'trid',
  // LinkedIn tracking (on any host: LinkedIn appends them to outbound links too)
  'trk', 'trkinfo', 'trackingid', 'tracking_id', 'lipi', 'lici', 'ebp', 'recommendedflavor',
  'originalsubdomain', 'original_referer', 'alternatechannel',
  // display only
  'lang', 'language', 'locale', 'hl', 'autoopenapplication',
];
export const TRACKING_PREFIXES = ['utm_', 'mtm_', 'pk_', 'hsa_', 'lever-'];

function isTracking(key) {
  const k = key.toLowerCase();
  return TRACKING_PARAMS.includes(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p));
}

// ---------------------------------------------------------------- the posting a board URL names

/**
 * Boards whose URL itself names the posting (or, on nofluffjobs, one city page of it). Each entry:
 * portal, host, id(URL) → the posting id or null, canonical(id, host) → the comparable address.
 * Every other part of the URL (slug words, search parameters, tracking) is noise for these boards.
 *   LinkedIn  /jobs/view/<slug>-<id>, ?currentJobId=<id> on search pages → linkedin.com/jobs/view/<id>
 *   Indeed    ?jk=<id> / ?vjk=<id>                                       → <host>/viewjob?jk=<id>
 *   NFJ       /pl/job/<slug>, /job/<slug>, /en/job/<slug>                → nofluffjobs.com/job/<slug>
 * The NFJ slug is one city's page: the posting behind several of them is told by its reference
 * (kind "nofluffjobs", above) or by nfjPlaceVariant() below.
 */
export const PORTAL_POSTINGS = [
  {
    portal: 'linkedin',
    host: /(^|\.)linkedin\.com$/,
    id: (u) => {
      const m = u.pathname.match(/^\/jobs\/(?:view|collections\/[^?]*)\/?(?:[^/?]*-)?(\d{6,})/);
      const id = m?.[1] ?? u.searchParams.get('currentJobId');
      return id && /^\d{6,}$/.test(id) ? id : null;
    },
    canonical: (id) => `linkedin.com/jobs/view/${id}`,
  },
  {
    portal: 'indeed',
    host: /(^|\.)indeed\.[a-z.]+$/,
    id: (u) => (u.searchParams.get('jk') || u.searchParams.get('vjk') || '').toLowerCase() || null,
    canonical: (id, host) => `${host}/viewjob?jk=${id}`,
  },
  {
    portal: 'nofluffjobs',
    host: /(^|\.)nofluffjobs\.com$/,
    id: (u) => u.pathname.match(/^\/(?:[a-z]{2}\/)?job\/([a-z0-9][a-z0-9-]*[a-z0-9])\/?$/i)?.[1].toLowerCase() ?? null,
    canonical: (id) => `nofluffjobs.com/job/${id}`,
  },
];

/** {portal, id, canonical} when the URL is a posting address of a board in PORTAL_POSTINGS, else null. */
export function postingKey(url) {
  if (!url) return null;
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  const host = u.host.toLowerCase();
  for (const p of PORTAL_POSTINGS) {
    if (!p.host.test(host)) continue;
    const id = p.id(u);
    if (id) return { portal: p.portal, id, canonical: p.canonical(id, host) };
  }
  return null;
}

/**
 * Comparable form of a URL: lowercase host and path, no fragment, no trailing slash, no tracking
 * parameters; the remaining parameters sorted, so their order does not matter. Boards with the
 * posting in the address itself (PORTAL_POSTINGS: LinkedIn, Indeed, nofluffjobs) are reduced to
 * that id. Only for comparing — the URL stored in the pipeline stays as it was.
 */
export function canonicalUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url).trim());
    const host = u.host.toLowerCase();
    const key = postingKey(u.href);
    if (key) return key.canonical;
    const params = [];
    for (const [k, v] of u.searchParams) {
      if (v && !isTracking(k)) params.push(`${k.toLowerCase()}=${v}`);
    }
    const base = (host + u.pathname).replace(/\/+$/, '').toLowerCase();
    return params.length ? `${base}?${[...new Set(params)].sort().join('&')}` : base;
  } catch {
    return String(url).trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '') || null;
  }
}

// nofluffjobs city / region parts of a slug, used only when the company is not found in it.
const NFJ_PLACES = [
  'remote', 'warszawa', 'warsaw', 'krakow', 'wroclaw', 'gdansk', 'gdynia', 'sopot', 'trojmiasto',
  'poznan', 'lodz', 'katowice', 'gliwice', 'szczecin', 'bydgoszcz', 'torun', 'lublin', 'bialystok',
  'rzeszow', 'kielce', 'olsztyn', 'opole', 'czestochowa', 'radom', 'zielona-gora', 'bielsko-biala',
  'lower-silesian', 'kuyavian-pomeranian', 'lubusz', 'lesser-poland', 'masovian', 'subcarpathian',
  'podlaskie', 'pomeranian', 'west-pomeranian', 'silesian', 'holy-cross', 'warmian-masurian',
  'greater-poland',
].sort((a, b) => b.length - a.length);

/** {stem, place} of an NFJ slug: the title-and-company part and the city / region part (a trailing
 *  "-7" counter dropped). The company slug anchors the cut; without it, a known place name. */
function nfjParts(slug, companySlugs) {
  const s = slug.replace(/-\d{1,3}$/, '');
  for (const co of companySlugs) {
    if (s.endsWith(`-${co}`)) return { stem: s, place: '' }; // a posting without a place in its slug
    const i = s.lastIndexOf(`-${co}-`);
    if (i > 0) return { stem: s.slice(0, i + co.length + 1), place: s.slice(i + co.length + 2) };
  }
  const place = NFJ_PLACES.find((p) => s.endsWith(`-${p}`));
  return place ? { stem: s.slice(0, -(place.length + 1)), place } : null;
}

/**
 * Are two nofluffjobs addresses city pages of one posting? NFJ builds the slug from title, company
 * and place ("devops-engineer-contoso-warszawa", "devops-engineer-contoso-remote-3"), so the same
 * title-and-company part with another place is very likely the same posting. Very likely, not
 * proven: an agency can run several postings under one title (that is what the counter is for) —
 * the reference decides. Returns {a, b} (the two places) or null. `companySlugs`: the company and
 * agency names of both sides in slug form ("tailspin-group"), longest first.
 */
export function nfjPlaceVariant(urlA, urlB, companySlugs = []) {
  const ka = postingKey(urlA);
  const kb = postingKey(urlB);
  if (ka?.portal !== 'nofluffjobs' || kb?.portal !== 'nofluffjobs' || ka.id === kb.id) return null;
  const pa = nfjParts(ka.id, companySlugs);
  const pb = nfjParts(kb.id, companySlugs);
  if (!pa || !pb || !pa.stem || pa.stem !== pb.stem || pa.place === pb.place) return null;
  return { a: pa.place || '-', b: pb.place || '-' };
}

// Hosts of applicant tracking systems whose address alone does not name the posting: one form
// page serves every posting of every tenant, told apart by an id (WebID, token, a path segment).
const ATS_HOSTS = [
  ['erecruiter', /(^|\.)erecruiter\.pl$/],
  ['greenhouse', /(^|\.)greenhouse\.io$/],
  ['traffit', /(^|\.)traffit\.com$/],
  ['lever', /(^|\.)lever\.co$/],
  ['ashby', /(^|\.)ashbyhq\.com$/],
  ['smartrecruiters', /(^|\.)smartrecruiters\.com$/],
  ['recruitify', /(^|\.)recruitify\.ai$/],
  ['darize', /(^|\.)darize\.com$/],
  ['workday', /(^|\.)myworkdayjobs\.com$/],
  ['personio', /(^|\.)personio\.(?:de|com)$/],
  ['workable', /(^|\.)workable\.com$/],
  ['hrappka', /(^|\.)hrappka\.pl$/],
  ['deel', /(^|\.)jobs\.deel\.com$/],
];

/** The ATS a URL belongs to ("erecruiter", …), or null. */
export function atsOf(url) {
  let host;
  try { host = new URL(String(url).trim()).host.toLowerCase(); } catch { return null; }
  return ATS_HOSTS.find(([, re]) => re.test(host))?.[0] ?? null;
}

/**
 * Do two URLs name the same posting?
 *   'same' — the same canonical URL, and where an ATS id can be read from it, the same id;
 *   'form' — the same canonical URL of a known ATS (or one carrying an ATS id), but no posting id
 *            shared: a common form address, not proof of the same posting;
 *   null   — different.
 * For a known ATS the posting id decides, not the shared address of its form.
 */
export function sameUrlPosting(a, b) {
  const ca = canonicalUrl(a);
  if (!ca || ca !== canonicalUrl(b)) return null;
  const ra = urlRefs(a);
  const rb = urlRefs(b);
  if (!ra.length && !rb.length && !atsOf(a) && !atsOf(b)) return 'same';
  return ra.some((x) => rb.some((y) => sameRef(x, y))) ? 'same' : 'form';
}
