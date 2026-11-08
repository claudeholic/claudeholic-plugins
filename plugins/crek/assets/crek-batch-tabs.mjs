#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
/**
 * crek-batch-tabs — open a batch of postings for the user: one window, the table's order, [N] tabs.
 *
 *   node crek-batch-tabs.mjs open --rows batch.json [--replace 21,22,23]  # a new window
 *   node crek-batch-tabs.mjs open --rows more.json --append-to 33            # after tab [33]
 *   node crek-batch-tabs.mjs check --tabs 31,32,33                          # in table order
 *   node crek-batch-tabs.mjs close --tabs 21,22,23
 *
 * --rows is a JSON array in TABLE ORDER: [{"id":1188,"url":"https://..."}] (or "source_url", or
 * plain URL strings), "-" for stdin. `open` creates the batch in the browser chrome-shared keeps
 * running (CDP, port 9226), in the shared logged-in profile — the profile whose tabs carry the
 * `[N]` title prefix the user points at — and in ONE window of its own:
 *
 *   - the first row opens a new window (Target.createTarget with newWindow: true); every later row
 *     opens as a background tab of that window, so the tab strip runs in the table's order and the
 *     [N] numbers grow in the same order;
 *   - Chrome puts a new tab into the last active window of the profile, so after every tab the
 *     script asks which window it landed in (Browser.getWindowForTarget). A tab in the wrong window
 *     is closed again, the batch window is brought forward (Target.activateTarget on the batch's
 *     last tab) and the row is opened once more; when that fails too, every tab of this run is
 *     closed and the script exits 3 — the batch opens whole and in order, or not at all;
 *   - tabs open one after another, each loaded (document.readyState) before the next. After a
 *     board the user is signed in to (LinkedIn, Indeed, --paced-hosts) the script waits a random
 *     2–4 s (the pace for showing a batch; browsing and reading those boards keep the 3–6 s of
 *     ats-playbook, *Boards you are signed in to*). A tab is opened
 *     exactly as the browser tools open one; the page is not navigated, clicked or scripted, and no
 *     site API is called;
 *   - --append-to N adds rows at the end of the window that holds tab [N] (a replacement for a row
 *     that dropped out: it sorts after every row, so the order holds);
 *   - --replace closes the listed tabs once the new ones are all open (the previous batch, leftovers).
 *
 * `check` takes the batch's [N] numbers in table order and says whether they are one window, in
 * order, with no other tab in that window. `close` closes tabs by [N]; it never closes the
 * browser's last tab. Neither touches any tab not named.
 *
 * Output: one line per tab (or --json). Exit: 0 — done / check passed; 1 — no browser; 2 — usage;
 * 3 — the batch could not be kept in one window (nothing left open); 4 — check found problems.
 * Requires Node >= 22 (built-in WebSocket).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS, findPort, browserVersion, connect, navigableUrl, sleep } from './crek-cdp.mjs';

// ---------------------------------------------------------------- pure helpers (tested)

/** Boards the user is signed in to by default; more with --paced-hosts. */
export const SIGNED_IN_HOSTS = ['linkedin.com', 'indeed.com'];

/** True when the URL's host is one of `hosts` or a subdomain of one (indeed.* on any TLD too). */
export function isSignedInBoard(url, hosts = SIGNED_IN_HOSTS) {
  let host;
  try { host = new URL(String(url ?? '').trim()).hostname.toLowerCase(); } catch { return false; }
  if (/(^|\.)indeed\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)) return true;
  return hosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`));
}

/** Pause after a tab, in ms: 2000–4000 at random after a signed-in board, otherwise `quickMs`. */
export function pauseAfter(url, { random = Math.random, hosts = SIGNED_IN_HOSTS, quickMs = 500 } = {}) {
  return isSignedInBoard(url, hosts) ? 2000 + Math.round(random() * 2000) : quickMs;
}

/** The [N] the chrome-shared extension puts in front of a tab title; null when there is none. */
export function tabNumber(title) {
  const m = /^\[(\d+)\] /.exec(String(title ?? ''));
  return m ? Number(m[1]) : null;
}

/** The --rows input → [{id, url}] in the same order; throws on an empty list or a non-http(s) URL. */
export function parseRows(data) {
  const list = Array.isArray(data) ? data : [data];
  const rows = list.map((x, i) => {
    const raw = typeof x === 'string' ? x : x?.url ?? x?.source_url;
    if (!raw) throw new Error(`row ${i + 1}: no url`);
    return { id: typeof x === 'object' ? x.id ?? null : null, url: navigableUrl(raw) };
  });
  if (!rows.length) throw new Error('no rows to open');
  return rows;
}

/**
 * What is wrong with a batch as the user sees it. `batch` — the table's [N] numbers in table order;
 * `tabs` — every page of the browser as {tab, window_id, title, url}. Returns a list of problems
 * (empty = one window, [N] growing along the table, nothing else in that window) and that window.
 */
export function batchProblems(batch, tabs) {
  const problems = [];
  const found = batch.map((n) => tabs.find((x) => x.tab === n) ?? null);
  batch.forEach((n, i) => { if (!found[i]) problems.push(`no tab [${n}]`); });
  const present = found.filter(Boolean);
  const windows = [...new Set(present.map((x) => x.window_id))];
  if (windows.length > 1) {
    problems.push(`the batch is spread over ${windows.length} windows: ${windows.map((w) =>
      present.filter((x) => x.window_id === w).map((x) => `[${x.tab}]`).join(' ')).join(' | ')}`);
  }
  for (let i = 1; i < present.length; i++) {
    if (present[i].tab < present[i - 1].tab) {
      problems.push(`[${present[i].tab}] comes after [${present[i - 1].tab}] in the table but was opened before it — the tab strip is not in table order`);
    }
  }
  const windowId = windows.length === 1 ? windows[0] : null;
  if (windowId != null) {
    for (const x of tabs) {
      if (x.window_id === windowId && !batch.includes(x.tab)) {
        problems.push(`another tab in the batch window: ${x.tab != null ? `[${x.tab}]` : '(no number)'} ${String(x.title ?? '').slice(0, 60)} ${x.url ?? ''}`.trim());
      }
    }
  }
  return { problems, window_id: windowId };
}

// ---------------------------------------------------------------- opening (driver-based, tested)

/**
 * Open `rows` in one window, in order. `d` is the browser driver (cdpDriver below, a fake in the
 * tests): create, windowOf, activate, close, waitLoaded, tabNumberOf, sleep.
 * `appendTo` = {targetId, windowId}: add to that window instead of opening a new one.
 * Returns {window_id, tabs: [{pos, id, url, target_id, tab, loaded}], warnings}; throws (after
 * closing every tab it opened) when a tab cannot be kept in the batch window.
 */
export async function openBatch(d, rows, { appendTo = null, pause = (url) => pauseAfter(url), browserContextId, focus } = {}) {
  const opened = [];
  const warnings = [];
  let windowId = appendTo?.windowId ?? null;
  let last = appendTo?.targetId ?? null;
  let activated = false;
  const base = browserContextId ? { browserContextId } : {};
  try {
    for (const [i, row] of rows.entries()) {
      let id;
      if (windowId == null) {
        id = await d.create({ url: row.url, newWindow: true, ...base, ...(focus === false ? { focus: false } : {}) });
        windowId = await d.windowOf(id);
      } else {
        id = await d.create({ url: row.url, background: true, ...base });
        if ((await d.windowOf(id)) !== windowId) {
          await d.close(id);
          await d.activate(last);
          activated = true;
          id = await d.create({ url: row.url, background: true, ...base });
          if ((await d.windowOf(id)) !== windowId) {
            await d.close(id);
            throw new Error(`row ${i + 1} (${row.url}) kept opening outside the batch window — another window took the focus`);
          }
        }
      }
      const entry = { pos: i + 1, id: row.id, url: row.url, target_id: id, tab: null, loaded: false };
      opened.push(entry);
      last = id;
      entry.loaded = await d.waitLoaded(id);
      if (!entry.loaded) warnings.push(`row ${i + 1} did not finish loading: ${row.url}`);
      if (i < rows.length - 1) await d.sleep(pause(row.url));
    }
    for (const t of opened) {
      t.tab = await d.tabNumberOf(t.target_id);
      if (t.tab == null) warnings.push(`row ${t.pos} has no [N] in its title (yet): ${t.url}`);
    }
    if (activated && !appendTo && opened.length) await d.activate(opened[0].target_id);
  } catch (err) {
    for (const t of opened) await d.close(t.target_id).catch(() => {});
    err.closed = opened.length;
    throw err;
  }
  return { window_id: windowId, tabs: opened, warnings };
}

// ---------------------------------------------------------------- the real browser

/** A driver over the browser endpoint of a CDP port. */
export async function cdpDriver(port) {
  const { webSocketDebuggerUrl } = await browserVersion(port);
  if (!webSocketDebuggerUrl) throw new Error('no browser endpoint in /json/version');
  const b = await connect(webSocketDebuggerUrl);
  const d = {
    browser: b,
    async create(params) { return (await b.send('Target.createTarget', params)).targetId; },
    async windowOf(targetId) { return (await b.send('Browser.getWindowForTarget', { targetId })).windowId; },
    async activate(targetId) { if (targetId) await b.send('Target.activateTarget', { targetId }); },
    async close(targetId) { await b.send('Target.closeTarget', { targetId }); },
    async sleep(ms) { await sleep(ms); },
    async waitLoaded(targetId, timeoutMs = 30000) {
      let page;
      try {
        page = await connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`, { timeoutMs: 10000 });
        const until = Date.now() + timeoutMs;
        while (Date.now() < until) {
          if ((await page.evaluate('document.readyState').catch(() => '')) === 'complete') return true;
          await sleep(400);
        }
        return false;
      } catch { return false; } finally { page?.close(); }
    },
    async tabNumberOf(targetId, timeoutMs = 6000) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const info = (await b.send('Target.getTargetInfo', { targetId }).catch(() => null))?.targetInfo;
        const n = tabNumber(info?.title);
        if (n != null || Date.now() > until) return n;
        await sleep(300);
      }
    },
    /** Every page of the browser as {target_id, tab, window_id, title, url}. */
    async pages() {
      const { targetInfos } = await b.send('Target.getTargets');
      const out = [];
      for (const x of targetInfos.filter((t) => t.type === 'page')) {
        const w = await b.send('Browser.getWindowForTarget', { targetId: x.targetId }).catch(() => null);
        out.push({ target_id: x.targetId, tab: tabNumber(x.title), window_id: w?.windowId ?? null, title: x.title, url: x.url });
      }
      return out;
    },
    close_connection() { b.close(); },
  };
  return d;
}

/** Close the tabs [N] of `numbers`; never the browser's last page. Returns {closed, missing, kept}. */
export async function closeTabs(d, numbers) {
  const pages = await d.pages();
  const closed = [];
  const missing = [];
  const kept = [];
  let left = pages.length;
  for (const n of numbers) {
    const p = pages.find((x) => x.tab === n);
    if (!p) { missing.push(n); continue; }
    if (left <= 1) { kept.push(n); continue; }
    await d.close(p.target_id);
    closed.push(n);
    left--;
  }
  return { closed, missing, kept };
}

// ---------------------------------------------------------------- CLI

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error(`usage: node crek-batch-tabs.mjs open --rows <file|-> [--append-to N] [--replace N,N,...] [options]
       node crek-batch-tabs.mjs check --tabs N,N,... [options]
       node crek-batch-tabs.mjs close --tabs N,N,... [options]

  --rows <file|->       JSON array in table order: {"id", "url"} (or "source_url"), or URL strings
  --append-to N         open the rows at the end of the window that holds tab [N]
  --replace N,N,...     after the rows are open, close these tabs (the previous batch, leftovers)
  --tabs N,N,...        tab numbers ([N] title prefix); for check: in table order
  --paced-hosts h,h     more boards the user is signed in to (2–4 s pause after each), besides
                        ${SIGNED_IN_HOSTS.join(', ')} and indeed.* on any domain
  --port <n>            Chrome debugging port (default: env CS_CHROME_PORT, 9226, 9227, 9222)
  --json                machine-readable output`);
  process.exit(2);
}

const nums = (s) => String(s ?? '').split(/[\s,]+/).filter(Boolean).map(Number);

async function main(argv) {
  const [cmd, ...args] = argv;
  if (cmd === '-h' || cmd === '--help') usage();
  if (!['open', 'check', 'close'].includes(cmd)) usage(cmd ? `unknown command ${cmd}` : 'give a command: open, check or close');
  const opt = { hosts: [...SIGNED_IN_HOSTS] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--rows') opt.rows = args[++i];
    else if (a === '--append-to') opt.appendTo = Number(args[++i]);
    else if (a === '--replace') opt.replace = nums(args[++i]);
    else if (a === '--tabs') opt.tabs = nums(args[++i]);
    else if (a === '--paced-hosts') opt.hosts.push(...String(args[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--port') opt.port = Number(args[++i]);
    else if (a === '--json') opt.json = true;
    else if (a === '-h' || a === '--help') usage();
    else usage(`unknown option ${a}`);
  }
  const intList = (l) => l.every((n) => Number.isInteger(n));
  if (cmd === 'open' && !opt.rows) usage('open needs --rows');
  if (cmd !== 'open' && !opt.tabs?.length) usage(`${cmd} needs --tabs`);
  if (opt.tabs && !intList(opt.tabs)) usage('--tabs takes tab numbers, e.g. --tabs 241,242');
  if (opt.replace && !intList(opt.replace)) usage('--replace takes tab numbers');
  if (opt.appendTo !== undefined && !Number.isInteger(opt.appendTo)) usage('--append-to takes a tab number');
  if (opt.port !== undefined && !Number.isInteger(opt.port)) usage('--port takes a port number');

  let rows;
  if (cmd === 'open') {
    try { rows = parseRows(JSON.parse(readFileSync(opt.rows === '-' ? 0 : resolve(opt.rows), 'utf8'))); }
    catch (err) { usage(`cannot read the rows: ${err.message}`); }
  }

  const port = (await findPort(opt.port))?.port;
  if (!port) {
    console.error(`error: no Chrome debugging port responded (tried ${(opt.port ? [opt.port] : PORTS).join(', ')}). `
      + 'Is the chrome-shared plugin running?');
    return 1;
  }
  const d = await cdpDriver(port);
  try {
    if (cmd === 'close') {
      const r = await closeTabs(d, opt.tabs);
      if (opt.json) console.log(JSON.stringify(r, null, 1));
      else {
        console.log(`closed: ${r.closed.map((n) => `[${n}]`).join(' ') || '-'}`);
        if (r.missing.length) console.log(`not open: ${r.missing.map((n) => `[${n}]`).join(' ')}`);
        if (r.kept.length) console.log(`kept (the browser's last tab): ${r.kept.map((n) => `[${n}]`).join(' ')}`);
      }
      return 0;
    }
    if (cmd === 'check') {
      const r = batchProblems(opt.tabs, await d.pages());
      if (opt.json) console.log(JSON.stringify(r, null, 1));
      else console.log(r.problems.length ? r.problems.map((p) => `! ${p}`).join('\n') : `ok: ${opt.tabs.length} tabs, one window, in table order`);
      return r.problems.length ? 4 : 0;
    }
    // open
    let appendTo = null;
    if (opt.appendTo !== undefined) {
      const p = (await d.pages()).find((x) => x.tab === opt.appendTo);
      if (!p) { console.error(`error: no tab [${opt.appendTo}] to append to`); return 2; }
      appendTo = { targetId: p.target_id, windowId: p.window_id };
    }
    let r;
    try {
      r = await openBatch(d, rows, { appendTo, pause: (url) => pauseAfter(url, { hosts: opt.hosts }) });
    } catch (err) {
      console.error(`error: ${err.message}; closed the ${err.closed ?? 0} tab(s) this run had opened — open the batch again`);
      return 3;
    }
    const replaced = opt.replace?.length
      ? await closeTabs(d, opt.replace.filter((n) => !r.tabs.some((t) => t.tab === n)))
      : null;
    const ordered = r.tabs.map((t) => t.tab).filter((n) => n != null);
    const check = appendTo ? { problems: [] } : batchProblems(ordered, await d.pages());
    const out = { ...r, replaced, problems: check.problems };
    if (opt.json) console.log(JSON.stringify(out, null, 1));
    else {
      for (const t of r.tabs) console.log(`${t.pos} | ${t.tab != null ? `[${t.tab}]` : '-'} | ${t.id != null ? `#${t.id}` : '-'} | ${t.url}`);
      for (const w of r.warnings) console.log(`warning: ${w}`);
      if (replaced) console.log(`closed: ${replaced.closed.map((n) => `[${n}]`).join(' ') || '-'}${replaced.missing.length ? `; not open: ${replaced.missing.map((n) => `[${n}]`).join(' ')}` : ''}`);
      for (const p of check.problems) console.log(`! ${p}`);
    }
    return check.problems.length ? 4 : 0;
  } finally {
    d.close_connection();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
