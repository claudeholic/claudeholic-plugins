// SPDX-License-Identifier: GPL-3.0-only
/**
 * crek-closed-rules — the closed-posting verdict of crek-closed-check, without the browser part
 * (so it can be tested on sample page texts).
 *
 * The phrases below are a fast path for boards whose wording is known. They do not define
 * "closed": a page that says it differently ("Ogłoszenie wygasło", "This job is no longer
 * available", no Apply button) is closed too, and recognising that is the reader's job — the
 * skills tell Claude to read the page whenever this script does not report `closed`. Claude does
 * not add phrases here or anywhere else; changes to this list are made by the plugin's developers.
 */

// ---------------------------------------------------------------- closed markers per board
// Every phrase below was seen on a real closed posting (checked 30.10.2026) unless noted.
// Phrases are specific on purpose: a loose "expired" matches live pages (Himalayas shows a
// "Job expired?" feedback link on open postings).
export const RULES = [
  // LinkedIn is judged by its page text only (no API). Without a known phrase the verdict is
  // `unknown`, never `open`: the text of a LinkedIn tab mixes the posting with feeds and side
  // panels, and a logged-out or half-loaded page says nothing about the posting.
  { board: 'linkedin', host: /(^|\.)linkedin\.com$/, openVerdict: false,
    text: [/No longer accepting applications/i, /Kandydaci nie są już akceptowani/i] },
  { board: 'justjoin', host: /(^|\.)justjoin\.it$/,
    text: [/Sorry, we cannot display this page/i, /Oferta archiwalna/i, /Archived offer/i] },
  { board: 'rocketjobs', host: /(^|\.)rocketjobs\.pl$/,
    text: [/Oferta archiwalna/i, /Archived offer/i, /Sorry, we cannot display this page/i] },
  { board: 'nofluffjobs', host: /(^|\.)nofluffjobs\.com$/,
    text: [/Oferta pracy\s[^\n]{1,200}?\swygasła/i, /Job offer\s[^\n]{1,200}?\s(has )?expired/i] },
  { board: 'theprotocol', host: /(^|\.)theprotocol\.it$/, text: [/Oferta wygasła/i, /Offer expired/i] },
  { board: 'bulldogjob', host: /(^|\.)bulldogjob\.(pl|com)$/,
    text: [/Job expired\s+\d{1,2}\.\d{1,2}\.\d{4}/i, /Oferta wygasła/i] },
  { board: 'pracuj_pl', host: /(^|\.)pracuj\.pl$/,
    text: [/Pracodawca zakończył zbieranie zgłoszeń/i, /offer expired \d/i, /oferta wygasła/i] },
  { board: 'solid_jobs', host: /(^|\.)solid\.jobs$/, url: /\/offer-not-found\//,
    text: [/rekrutacja już się zakończyła/i] },
  // Greenhouse sends a closed job to the board root with ?error=true (well known, not re-verified).
  { board: 'greenhouse', host: /(^|\.)greenhouse\.io$/, url: /[?&]error=true/,
    text: [/no longer open/i, /job you are looking for is no longer/i] },
];

export const fmtTime = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Verdict for one posting from what its page says: {url, status, title, text}. */
export function judge(page) {
  let host = '';
  try { host = new URL(page.url).hostname; } catch { /* keep empty */ }
  const rule = RULES.find((r) => r.host.test(host));
  const board = rule?.board ?? (host || null);

  if (page.status === 404 || page.status === 410) {
    return { board, state: 'closed', reason: `HTTP ${page.status}` };
  }
  if (rule?.url?.test(page.url)) return { board, state: 'closed', reason: `URL ${page.url}` };
  const text = page.text ?? '';
  for (const re of rule?.text ?? []) {
    const m = text.match(re);
    if (m) return { board, state: 'closed', reason: `"${m[0].replace(/\s+/g, ' ').slice(0, 120)}"` };
  }
  if (/just a moment|attention required|verify you are human/i.test(page.title ?? '')) {
    return { board, state: 'unknown', reason: 'bot check page — reload and check again' };
  }
  if (!rule) return { board, state: 'unknown', reason: 'no known closed markers for this board — look at the page' };
  if (page.status && page.status >= 400) return { board, state: 'unknown', reason: `HTTP ${page.status}` };
  if (rule.openVerdict === false) {
    return { board, state: 'unknown', reason: 'no known closed phrase in the page text — read the page (fast path only)' };
  }
  return { board, state: 'open', reason: 'no known closed marker — the list is a fast path, read the page' };
}
