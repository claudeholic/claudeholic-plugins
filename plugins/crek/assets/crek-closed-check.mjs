#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
/**
 * crek-closed-check — is a posting still accepting applications?
 *
 *   node crek-closed-check.mjs --tabs 241,242,250        # tabs already open, by their [N] title prefix
 *   node crek-closed-check.mjs --urls postings.json      # [{"id":1188,"url":"https://..."}], or "-" for stdin
 *
 * Boards keep closed postings online: LinkedIn shows "No longer accepting applications" (PL
 * "Kandydaci nie są już akceptowani") on the same URL, nofluffjobs "Oferta pracy … wygasła",
 * theprotocol "Oferta wygasła" — and a posting that was open at scan time can close hours later.
 * Eyeballing every tab misses them; this script asks the browser that is already running
 * (chrome-shared, CDP) and returns one verdict per posting: closed, open or unknown.
 *
 * Every board, LinkedIn included, is judged by what its page says: the page text (innerText) is
 * matched against the board's known closed markers (RULES in crek-closed-rules.mjs; boards.json
 * `notes` lists them for humans), plus HTTP 404/410 on any board. No site API is called. The list
 * is a fast path, not the definition of "closed": a board without known markers yields `unknown`,
 * a LinkedIn page without a known phrase yields `unknown` too, and `open` on a marker-only board
 * says no KNOWN marker was found — the page may say it in other words, so whoever reads the result
 * still reads the page.
 *
 * --tabs only READS the tabs (their text): no navigation, no clicks, no reload — the text is the
 * page as it was loaded. --urls opens ONE tab of its own, navigates it through the list with a
 * pause between postings and closes it at the end. Only http(s) URLs are opened; anything else is
 * reported as `unknown`. LinkedIn URLs are never opened by this script (LinkedIn treats scripted
 * page loads as automation): they come back `unknown`, to be checked through the linkedin-mcp
 * tools or by opening the page in the browser and reading it.
 *
 * Output: one line per posting (or --json). Exit code 0 even when something is closed; 1 = no
 * browser, 2 = usage. Requires Node >= 22 (built-in WebSocket).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveLang, translator } from './crek-i18n.mjs';
import { judge, fmtTime } from './crek-closed-rules.mjs';
import {
  PORTS, findPort as findCdpPort, connect, listPages, openTab, closeTab, goto, sleep, isLinkedin,
} from './crek-cdp.mjs';

// ---------------------------------------------------------------- options

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error(`usage: node crek-closed-check.mjs (--tabs N[,N...] | --urls <file|->) [options]

  --tabs N,N,...      check tabs already open, by the [N] prefix of their title (read only)
  --urls <file|->     JSON array of {"id", "url"} (or "source_url", or plain URL strings);
                      checked in one tab of its own, closed at the end (LinkedIn URLs
                      are not opened: unknown, check them through linkedin-mcp or by hand)
  --delay <ms>        pause between postings in --urls mode (default 1500)
  --port <n>          Chrome debugging port (default: env CS_CHROME_PORT, 9226, 9227, 9222)
  --lang <code|name>  language of the human-readable output (default: env CREK_LANG, then
                      the config, then "pl"; a language without a dictionary -> "en")
  --config <path>     read presentation.language from crek.config.json
  --closed-only       print only closed postings
  --json              machine-readable output`);
  process.exit(2);
}

const args = process.argv.slice(2);
const opt = { delay: 1500 };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--tabs') opt.tabs = String(args[++i] ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  else if (a === '--urls') opt.urls = args[++i];
  else if (a === '--delay') opt.delay = Number(args[++i]);
  else if (a === '--port') opt.port = Number(args[++i]);
  else if (a === '--lang') opt.lang = args[++i];
  else if (a === '--config') opt.config = args[++i];
  else if (a === '--closed-only') opt.closedOnly = true;
  else if (a === '--json') opt.json = true;
  else if (a === '-h' || a === '--help') usage();
  else usage(`unknown option ${a}`);
}
if (!opt.tabs?.length === !opt.urls) usage('give exactly one of --tabs or --urls');
if (opt.tabs?.some((n) => !Number.isInteger(n))) usage('--tabs takes tab numbers, e.g. --tabs 241,242');
if (!Number.isFinite(opt.delay) || opt.delay < 0) usage('--delay takes milliseconds, e.g. --delay 1500');
if (opt.port !== undefined && !Number.isInteger(opt.port)) usage('--port takes a port number');
// Language: --lang, then env CREK_LANG, then presentation.language from the config.
opt.lang ??= process.env.CREK_LANG || undefined;
if (opt.config) {
  try { opt.lang ??= JSON.parse(readFileSync(resolve(opt.config), 'utf8')).presentation?.language; }
  catch (err) { usage(`cannot read ${opt.config}: ${err.message}`); }
}

const t = translator(resolveLang(opt.lang));

// ---------------------------------------------------------------- CDP (crek-cdp.mjs)

// What a page tells us about itself: final URL, HTTP status of the document, title, text.
const READ_PAGE = `(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  return { url: location.href, status: nav ? nav.responseStatus : null, title: document.title,
           text: document.body ? document.body.innerText : '' };
})()`;

const LINKEDIN_NOT_OPENED = 'LinkedIn is not opened by this script — check it with the linkedin-mcp tools, '
  + 'or open the page in the browser and read it';

// ---------------------------------------------------------------- main

const port = (await findCdpPort(opt.port))?.port;
if (!port) {
  console.error(`error: no Chrome debugging port responded (tried ${(opt.port ? [opt.port] : PORTS).join(', ')}). `
    + 'Is the chrome-shared plugin running?');
  process.exit(1);
}
const results = [];
const checkedAt = () => fmtTime(Date.now());

if (opt.tabs) {
  const targets = await listPages(port);
  for (const n of opt.tabs) {
    const target = targets.find((x) => x.title.startsWith(`[${n}] `));
    if (!target) { results.push({ tab: n, url: null, board: null, state: 'unknown', reason: 'no tab with this number', checked_at: checkedAt() }); continue; }
    let page;
    try {
      page = await connect(target.webSocketDebuggerUrl);
      const seen = await page.evaluate(READ_PAGE);
      results.push({ tab: n, url: seen.url, ...judge(seen), checked_at: checkedAt() });
    } catch (err) {
      results.push({ tab: n, url: target.url, board: null, state: 'unknown', reason: err.message, checked_at: checkedAt() });
    } finally {
      page?.close();
    }
  }
} else {
  let list;
  try {
    list = JSON.parse(readFileSync(opt.urls === '-' ? 0 : resolve(opt.urls), 'utf8'));
  } catch (err) { usage(`cannot read the URL list: ${err.message}`); }
  if (!Array.isArray(list)) list = [list];
  const items = list.map((x) => (typeof x === 'string' ? { url: x } : { id: x.id ?? null, url: x.url ?? x.source_url }))
    .filter((x) => x.url);
  // One tab of our own, opened only when there is something to open; results keep the input order.
  let created = null;
  let page;
  try {
    for (const item of items) {
      let row;
      if (isLinkedin(item.url)) {
        row = { board: 'linkedin', state: 'unknown', reason: LINKEDIN_NOT_OPENED };
      } else {
        try {
          if (!created) {
            created = await openTab(port);
            page = await connect(created.webSocketDebuggerUrl);
          }
          await goto(page, item.url);
          row = judge(await page.evaluate(READ_PAGE));
        } catch (err) {
          row = { board: null, state: 'unknown', reason: err.message };
        }
        await sleep(opt.delay);
      }
      results.push({ id: item.id, url: item.url, ...row, checked_at: checkedAt() });
    }
  } finally {
    page?.close();
    if (created) await closeTab(port, created.id);
  }
}

const shown = opt.closedOnly ? results.filter((r) => r.state === 'closed') : results;
if (opt.json) {
  console.log(JSON.stringify(shown, null, 1));
} else {
  for (const r of shown) {
    const who = [r.tab != null ? `[${r.tab}]` : null, r.id != null ? `#${r.id}` : null].filter(Boolean).join(' ') || '-';
    console.log(`${who} | ${t(`closed.state.${r.state}`)} | ${r.board ?? '-'} | ${r.reason} | ${r.url ?? '-'}`);
  }
  const count = (s) => results.filter((r) => r.state === s).length;
  console.log(t('closed.summary', { closed: count('closed'), open: count('open'), unknown: count('unknown'),
    total: results.length, checked: checkedAt() }));
}
