#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
/**
 * crek-browsers — the browsers CREK may use, in the order it uses them, and whether they work.
 *
 *   node crek-browsers.mjs --config crek.config.json                    # the list and the mail setting
 *   node crek-browsers.mjs --config crek.config.json --check            # does each port answer?
 *   node crek-browsers.mjs --config crek.config.json --check --tab-test # + one background tab, closed
 *   node crek-browsers.mjs --config crek.config.json --check --name Brave
 *   node crek-browsers.mjs --config crek.config.json --start Brave      # run its start_command
 *
 * The list is `browser.browsers` in the config (crek.schema.json). Without it: chrome-shared alone,
 * plus the pre-1.12 `browser.cdp_fallback_port` as a second browser when that is set. A skill that
 * meets a CAPTCHA or an anti-bot check in one browser tries the next one in this order (the
 * ats-playbook, *Codes by e-mail, CAPTCHAs and the browser list*).
 *
 * --check reads /json/version on each browser's debugging port. chrome-shared starts its browser
 * on the first call of its tools, so a silent 9226 there is `idle`, not a failure. A browser of
 * type "mcp" is reached only through its MCP tools, which a script cannot call: `tools` — the skill
 * checks them. --tab-test also opens one about:blank tab in the background over the browser's own
 * endpoint and closes it at once; nothing else in the browser is touched, nothing is closed or
 * restarted. It also warns when a debugging port answers on a network address, not only on
 * localhost.
 *
 * --start runs a browser's start_command (through sh, detached) when its port is silent and waits
 * up to 20 s for it to answer. It never stops, kills or restarts anything.
 *
 * Mail access (`mail` in the config) is printed, never tested here: its tools are MCP tools.
 *
 * Exit: 0 — fine, or --check found at least one usable browser; 1 — --check found none / --start
 * failed; 2 — usage or config error. Requires Node >= 22.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { browserVersion, testBackgroundTab, sleep } from './crek-cdp.mjs';

export const BROWSER_TYPES = ['chrome-shared', 'cdp', 'mcp'];
export const MAIL_ACCESS = ['none', 'mcp'];
export const CHROME_SHARED_TOOLS = 'mcp__plugin_chrome-shared_browser__';
const chromeSharedPort = () => Number(process.env.CS_CHROME_PORT) || 9226;
const chromeSharedProxy = () => Number(process.env.CS_PROXY_PORT) || 9227;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const isPort = (p) => Number.isInteger(p) && p > 0 && p < 65536;

/**
 * The browsers in the order of use: [{name, type, cdp_port, tool_prefix, profile, user_profile,
 * start_command, may_start, enabled, notes, legacy?}] and where the list came from
 * ("config" | "default"). Entries keep what the config says; defaults fill in only the gaps.
 */
export function effectiveBrowsers(cfg) {
  const b = obj(cfg?.browser) ?? {};
  const fill = (x) => {
    const e = { enabled: true, user_profile: false, may_start: false, ...x };
    if (e.type === 'chrome-shared') {
      e.cdp_port ??= chromeSharedPort();
      e.proxy_port ??= chromeSharedProxy();
      e.tool_prefix ??= CHROME_SHARED_TOOLS;
    }
    return e;
  };
  if (Array.isArray(b.browsers) && b.browsers.length) {
    return { source: 'config', browsers: b.browsers.map((x) => fill(obj(x) ?? {})) };
  }
  const list = [fill({ name: 'chrome-shared', type: 'chrome-shared',
    profile: 'the shared automation profile of the chrome-shared plugin' })];
  if (b.cdp_fallback_port != null) {
    list.push(fill({ name: 'fallback', type: 'cdp', cdp_port: b.cdp_fallback_port, legacy: true,
      profile: 'a second browser of the user\'s (browser.cdp_fallback_port)' }));
  }
  return { source: 'default', browsers: list };
}

/** Mail access as the skills read it: {access, name, tool_prefix, search_tool, read_tool, read_verification_codes}. */
export function mailSettings(cfg) {
  const m = obj(cfg?.mail) ?? {};
  return { ...m, access: m.access ?? 'none', read_verification_codes: m.read_verification_codes === true };
}

/** {errors, warnings, notes} about `browser.browsers` and `mail` — used by crek-config-check. */
export function browserProblems(cfg) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const b = cfg?.browser;
  if (b !== undefined && !obj(b)) errors.push('browser must be an object');
  const list = obj(b)?.browsers;
  if (list !== undefined) {
    if (!Array.isArray(list)) errors.push('browser.browsers must be an array, in the order of use');
    else {
      const names = new Set();
      const ports = new Map();
      if (!list.length) warnings.push('browser.browsers is empty — CREK falls back to chrome-shared alone');
      list.forEach((x, i) => {
        const at = `browser.browsers[${i}]`;
        if (!obj(x)) { errors.push(`${at} must be an object`); return; }
        if (!x.name || typeof x.name !== 'string') errors.push(`${at} needs a name`);
        else if (names.has(x.name.toLowerCase())) errors.push(`${at}: the name "${x.name}" is used twice`);
        else names.add(x.name.toLowerCase());
        if (!BROWSER_TYPES.includes(x.type)) {
          errors.push(`${at}.type is ${JSON.stringify(x.type)} — expected ${BROWSER_TYPES.join(', ')}`);
          return;
        }
        if (x.cdp_port !== undefined && !isPort(x.cdp_port)) errors.push(`${at}.cdp_port must be a port number (1-65535)`);
        if (x.type === 'cdp' && x.cdp_port === undefined) errors.push(`${at} is a cdp browser without cdp_port`);
        if (x.type === 'mcp' && !x.tool_prefix) errors.push(`${at} is an mcp browser without tool_prefix (e.g. mcp__claude-in-chrome__)`);
        if (isPort(x.cdp_port)) {
          if (ports.has(x.cdp_port)) errors.push(`${at}: cdp_port ${x.cdp_port} is also ${ports.get(x.cdp_port)} — two entries cannot be one browser`);
          ports.set(x.cdp_port, x.name ?? at);
        }
        if (x.may_start && !x.start_command) warnings.push(`${at}.may_start is true but there is no start_command`);
        if (x.type === 'chrome-shared' && x.start_command) warnings.push(`${at}: chrome-shared starts its browser itself — start_command is ignored`);
      });
      if (list.filter((x) => obj(x)?.type === 'chrome-shared').length > 1) errors.push('browser.browsers lists chrome-shared more than once');
      if (list.length && list.every((x) => obj(x)?.enabled === false)) warnings.push('every entry in browser.browsers is disabled — no browser to work in');
      if (obj(b).cdp_fallback_port != null) {
        warnings.push('browser.cdp_fallback_port is ignored when browser.browsers is set — add that browser to the list (type cdp) and remove the old field');
      }
    }
  } else if (obj(b)?.cdp_fallback_port != null) {
    notes.push(`browser.cdp_fallback_port (${b.cdp_fallback_port}) is the pre-1.12 form — it still works as the second browser; `
      + 'the crek:browsers skill moves it into browser.browsers');
  } else {
    notes.push('browser.browsers is not set — CREK uses chrome-shared alone (the crek:browsers skill adds fallback browsers)');
  }

  const m = cfg?.mail;
  if (m === undefined) {
    notes.push('mail is not set — codes and links sent by e-mail are asked from you (the crek:browsers skill sets mail access up)');
  } else if (!obj(m)) errors.push('mail must be an object');
  else {
    if (m.access !== undefined && !MAIL_ACCESS.includes(m.access)) errors.push(`mail.access is ${JSON.stringify(m.access)} — expected ${MAIL_ACCESS.join(', ')}`);
    if (m.access === 'mcp' && !m.tool_prefix) errors.push('mail.access is mcp but mail.tool_prefix is empty — which tools read the mailbox?');
    if (m.read_verification_codes !== undefined && typeof m.read_verification_codes !== 'boolean') errors.push('mail.read_verification_codes must be true or false');
    if (m.read_verification_codes === true && m.access !== 'mcp') warnings.push('mail.read_verification_codes is true but there is no mail access (mail.access) — codes are asked from you');
  }
  return { errors, warnings, notes };
}

// ---------------------------------------------------------------- checks

/** Non-loopback IPv4 addresses of this machine (to see whether a debugging port is exposed). */
function lanAddresses() {
  return Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
}

/** One browser: {name, status: ok|idle|down|tools|disabled, browser?, detail, tab?, exposed?}. */
export async function checkBrowser(e, { tabTest = false } = {}) {
  const out = { name: e.name, type: e.type };
  if (e.enabled === false) return { ...out, status: 'disabled', detail: 'enabled: false' };
  if (e.type === 'mcp' && !isPort(e.cdp_port)) {
    return { ...out, status: 'tools', detail: `reached through its MCP tools (${e.tool_prefix}*) — check them in the session` };
  }
  if (!isPort(e.cdp_port)) return { ...out, status: 'down', detail: 'no debugging port configured' };
  let v;
  try {
    v = await browserVersion(e.cdp_port);
  } catch (err) {
    if (e.type === 'chrome-shared') {
      return { ...out, status: 'idle', port: e.cdp_port,
        detail: `nothing on ${e.cdp_port} — chrome-shared starts its browser on the first call of its tools (lazy proxy ${e.proxy_port}); call one (list_pages) and check again` };
    }
    return { ...out, status: 'down', port: e.cdp_port,
      detail: `nothing answers on 127.0.0.1:${e.cdp_port} (${err.name === 'TimeoutError' ? 'timeout' : err.cause?.code ?? err.message})`
        + (e.start_command ? ' — it can be started with its start_command' : ' — the user starts it') };
  }
  const res = { ...out, status: 'ok', port: e.cdp_port, browser: v.Browser ?? '?', detail: `${v.Browser ?? '?'} on 127.0.0.1:${e.cdp_port}` };
  for (const ip of lanAddresses()) {
    try { await browserVersion(e.cdp_port, { host: ip, timeoutMs: 800 }); res.exposed = ip; break; } catch { /* good: not reachable */ }
  }
  if (tabTest) {
    try { await testBackgroundTab(e.cdp_port); res.tab = 'ok'; } catch (err) { res.tab = `failed: ${err.message}`; res.status = 'down'; }
  }
  return res;
}

/** Run start_command detached, then wait for the port. Never touches a running browser. */
export async function startBrowser(e, { waitMs = 20000 } = {}) {
  if (!isPort(e.cdp_port)) throw new Error(`${e.name} has no debugging port`);
  try { await browserVersion(e.cdp_port); return { started: false, detail: 'already answering — nothing started' }; } catch { /* silent: start it */ }
  if (!e.start_command) throw new Error(`${e.name} has no start_command — the user starts it`);
  const child = spawn('sh', ['-c', e.start_command], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  for (let waited = 0; waited < waitMs; waited += 1000) {
    await sleep(1000);
    try { const v = await browserVersion(e.cdp_port); return { started: true, detail: `${v.Browser ?? '?'} answers on ${e.cdp_port}` }; } catch { /* not yet */ }
  }
  throw new Error(`started "${e.start_command}", but nothing answers on ${e.cdp_port} after ${waitMs / 1000} s — `
    + 'if this browser was already running without the debugging port, the command only opened a window in it: '
    + 'ask the user to close that browser and start it again (CREK never closes it)');
}

// ---------------------------------------------------------------- main

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error(`usage: node crek-browsers.mjs --config <crek.config.json> [--json]
       [--check [--tab-test]] [--name <browser>] [--start <browser>]`);
  process.exit(2);
}

function describe(e) {
  const how = e.type === 'mcp' ? `MCP tools ${e.tool_prefix}*`
    : e.type === 'chrome-shared' ? `MCP tools ${e.tool_prefix}*, CDP ${e.cdp_port} (proxy ${e.proxy_port})`
      : `CDP 127.0.0.1:${e.cdp_port}`;
  return [
    `${e.enabled === false ? '(disabled) ' : ''}${e.name} [${e.type}] — ${how}`,
    e.profile || e.user_profile ? `profile: ${e.profile ?? ''}${e.user_profile ? ' (the user\'s own profile: own tab only, never close or restart)' : ''}` : null,
    e.start_command ? `start: ${e.start_command}${e.may_start ? ' (CREK may start it)' : ' (ask before starting)'}` : null,
    e.legacy ? 'from browser.cdp_fallback_port (pre-1.12 form)' : null,
    e.notes ? `notes: ${e.notes}` : null,
  ].filter(Boolean);
}

async function main(args) {
  const opt = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--config') opt.config = args[++i];
    else if (a === '--json') opt.json = true;
    else if (a === '--check') opt.check = true;
    else if (a === '--tab-test') opt.tabTest = true;
    else if (a === '--name') opt.name = args[++i];
    else if (a === '--start') opt.start = args[++i];
    else if (a === '-h' || a === '--help') usage();
    else usage(`unknown option ${a}`);
  }
  const path = resolve(opt.config ?? 'crek.config.json');
  if (!existsSync(path)) usage(`${path} does not exist`);
  let cfg;
  try { cfg = JSON.parse(readFileSync(path, 'utf8')); } catch (err) { usage(`${path} is not valid JSON: ${err.message}`); }
  const problems = browserProblems(cfg);
  if (problems.errors.length) {
    for (const e of problems.errors) console.error(`error: ${e}`);
    process.exit(2);
  }
  const { source, browsers } = effectiveBrowsers(cfg);
  const pick = (name) => browsers.find((b) => String(b.name).toLowerCase() === String(name).toLowerCase());
  const mail = mailSettings(cfg);

  if (opt.start) {
    const e = pick(opt.start);
    if (!e) usage(`no browser named "${opt.start}" (${browsers.map((b) => b.name).join(', ')})`);
    try {
      const r = await startBrowser(e);
      console.log(opt.json ? JSON.stringify({ name: e.name, ...r }) : `${e.name}: ${r.detail}`);
    } catch (err) {
      console.log(opt.json ? JSON.stringify({ name: e.name, started: false, error: err.message }) : `${e.name}: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  const selected = opt.name ? [pick(opt.name)].filter(Boolean) : browsers;
  if (opt.name && !selected.length) usage(`no browser named "${opt.name}" (${browsers.map((b) => b.name).join(', ')})`);

  if (!opt.check) {
    if (opt.json) { console.log(JSON.stringify({ source, browsers: selected, mail }, null, 2)); return; }
    console.log(`Browsers, in the order of use (${source === 'config' ? 'browser.browsers' : 'default — browser.browsers not set'}):`);
    selected.forEach((e, i) => describe(e).forEach((line, j) => console.log(`${j ? '     ' : ` ${i + 1}. `}${line}`)));
    console.log(`\nMail: ${mail.access === 'mcp' ? `${mail.name ?? 'MCP'} — tools ${mail.tool_prefix}*` : 'no access'}; `
      + `read verification codes and links on its own: ${mail.read_verification_codes && mail.access === 'mcp' ? 'yes' : 'no (ask the user)'}`);
    return;
  }

  const results = [];
  for (const e of selected) results.push(await checkBrowser(e, { tabTest: opt.tabTest }));
  const usable = results.filter((r) => r.status === 'ok' || r.status === 'idle' || r.status === 'tools');
  if (opt.json) console.log(JSON.stringify({ results, mail }, null, 2));
  else {
    for (const r of results) {
      console.log(`${r.status.toUpperCase().padEnd(8)} ${r.name} [${r.type}] — ${r.detail}${r.tab ? `; background tab: ${r.tab}` : ''}`);
      if (r.exposed) console.log(`WARNING  ${r.name}: the debugging port also answers on ${r.exposed}:${r.port} — anyone on the network can drive this browser; start it with --remote-debugging-address=127.0.0.1`);
    }
    if (mail.access === 'mcp') console.log(`MAIL     ${mail.name ?? 'MCP'} — tools ${mail.tool_prefix}*: not testable from a script, check the tools in the session`);
  }
  process.exitCode = usable.length ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => { console.error(`error: ${err.stack ?? err}`); process.exit(1); });
}
