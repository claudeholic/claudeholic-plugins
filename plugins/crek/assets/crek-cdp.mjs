// SPDX-License-Identifier: GPL-3.0-only
/**
 * crek-cdp — the minimal Chrome DevTools Protocol client shared by crek-closed-check,
 * crek-dedupe-check and html-to-pdf. Talks to the browser chrome-shared keeps running
 * (debugging port 9226 since chrome-shared 1.3.2; 9227 is its proxy, 9222 the classic default).
 *
 * Every command has a timeout, so a tab that hangs (a modal dialog, a dead renderer) fails one
 * posting instead of freezing the whole run. Navigation accepts http(s) URLs only: the URLs come
 * from job postings and pipeline rows, i.e. from third parties.
 *
 * Requires Node >= 22 (built-in WebSocket).
 */

export const PORTS = [process.env.CS_CHROME_PORT, 9226, 9227, 9222].filter(Boolean).map(Number);
export const COMMAND_TIMEOUT_MS = 30000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The first debugging port that answers, with the browser's name; null when none does. */
export async function findPort(port) {
  for (const p of port ? [port] : PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return { port: p, browser: (await r.json()).Browser ?? '?' };
    } catch { /* try the next one */ }
  }
  return null;
}

/** Throws unless the URL is http(s): javascript:, file:, data: and the like are never navigated to. */
export function navigableUrl(url) {
  let u;
  try { u = new URL(String(url ?? '').trim()); } catch { throw new Error(`not a URL: ${String(url).slice(0, 80)}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`refusing to open a ${u.protocol} URL`);
  return u.href;
}

/** Page targets (tabs) of the browser. */
export async function listPages(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  return (await r.json()).filter((x) => x.type === 'page');
}

/** A fresh tab (about:blank unless a URL is given). Chrome requires PUT on /json/new. */
export async function openTab(port, url = 'about:blank') {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT', signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`could not open a tab (HTTP ${r.status})`);
  return r.json();
}

export async function closeTab(port, id) {
  await fetch(`http://127.0.0.1:${port}/json/close/${id}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
}

/**
 * Connect to one target. Returns {send, evaluate, on, close}; send() rejects on a protocol error
 * or after `timeoutMs`.
 */
export async function connect(wsUrl, { timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.fail(new Error(m.error.message ?? 'CDP error'));
      else p.ok(m.result ?? {});
    } else if (m.method && listeners.has(m.method)) {
      for (const fn of listeners.get(m.method)) fn(m.params ?? {});
    }
  };
  ws.onclose = () => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.fail(new Error('connection closed')); }
    pending.clear();
  };
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`cannot connect to ${wsUrl}: timeout`)), timeoutMs);
    ws.onopen = () => { clearTimeout(timer); ok(); };
    ws.onerror = () => { clearTimeout(timer); fail(new Error(`cannot connect to ${wsUrl}`)); };
  });
  const send = (method, params = {}, ms = timeoutMs) => new Promise((ok, fail) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      fail(new Error(`${method} timed out after ${ms} ms`));
    }, ms);
    pending.set(id, { ok, fail, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? 'evaluation failed');
    }
    return r.result?.value;
  };
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };
  return { send, evaluate, on, close: () => { try { ws.close(); } catch { /* already closed */ } } };
}

/** Navigate an attached tab to an http(s) URL and wait for the page to settle. */
export async function goto(page, url) {
  await page.send('Page.navigate', { url: navigableUrl(url) });
  await sleep(1000);
  for (let i = 0; i < 40; i++) {
    if ((await page.evaluate('document.readyState').catch(() => '')) === 'complete') break;
    await sleep(500);
  }
  await sleep(2000); // client-rendered boards fill the body after load
}

/** True for any linkedin.com URL. LinkedIn pages are read as text only — no LinkedIn API is called. */
export function isLinkedin(url) {
  try { return /(^|\.)linkedin\.com$/i.test(new URL(String(url ?? '').trim()).hostname); } catch { return false; }
}
