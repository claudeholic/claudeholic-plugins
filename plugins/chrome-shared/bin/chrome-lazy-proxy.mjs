#!/usr/bin/env node
// Lazy launcher for the shared Chrome (chrome-shared plugin).
// Listens on LISTEN (9227). On the first connection (= the first browser-tool
// call from any Claude session) it starts the shared Chrome with a CDP port
// (9226) and tunnels TCP traffic both ways.
// Singleton: when the port is taken it exits quietly — a proxy is already up.

import net from 'node:net';
import fs from 'node:fs';
import {spawn} from 'node:child_process';

const LISTEN = Number(process.env.CS_PROXY_PORT ?? 9227);
const CHROME = Number(process.env.CS_CHROME_PORT ?? 9226);
const PROFILE = process.env.CS_PROFILE ?? `${process.env.HOME}/.cache/chrome-devtools-mcp/chrome-shared-profile`;
// Tab-numbering extension ([N] in the title). Disable with CS_TAB_NUMBERS=0.
// Loaded over CDP (Extensions.loadUnpacked) right after a cold Chrome start:
// the --load-extension flag is ignored by branded Chrome 137+ (a lockdown that
// --disable-features=DisableLoad... no longer lifts).
// The load does not survive a browser restart, so we repeat it on every cold
// start; the ID of an unpacked extension derives from its path, so a repeated
// call merely reloads the same entry.
const TAB_NUMBERS_EXT = new URL('../extension/tab-numbers', import.meta.url).pathname;
const TAB_NUMBERS = process.env.CS_TAB_NUMBERS !== '0' && fs.existsSync(TAB_NUMBERS_EXT);

// One-shot CDP call on the browser endpoint (no dependencies — Node 22 ships
// global WebSocket and fetch). Gives up silently on any failure: tab numbering
// is a convenience and must never block the browser from starting.
async function loadTabNumbersExtension() {
  if (!TAB_NUMBERS) return;
  try {
    const info = await fetch(`http://127.0.0.1:${CHROME}/json/version`).then(r => r.json());
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const done = err => { try { ws.close(); } catch {} ; err ? reject(err) : resolve(); };
      const timer = setTimeout(() => done(new Error('timeout')), 10_000);
      ws.onerror = () => { clearTimeout(timer); done(new Error('ws error')); };
      ws.onopen = () => ws.send(JSON.stringify({
        id: 1,
        method: 'Extensions.loadUnpacked',
        // enableInIncognito: Claude session tabs are created in isolated
        // contexts (technically incognito) — without this they would stay
        // unnumbered.
        params: {path: TAB_NUMBERS_EXT, enableInIncognito: true},
      }));
      ws.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id !== 1) return;
        clearTimeout(timer);
        done(msg.error ? new Error(msg.error.message) : null);
      };
    });
    console.log(`[tab-numbers] extension loaded: ${TAB_NUMBERS_EXT}`);
  } catch (err) {
    console.log(`[tab-numbers] failed to load the extension: ${err.message}`);
  }
}

function chromeUp() {
  return new Promise(resolve => {
    const s = net.connect({port: CHROME, host: '127.0.0.1'});
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

async function launchChrome() {
  spawn('setsid', [
    'google-chrome-stable',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${CHROME}`,
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-startup-window',
  ], {detached: true, stdio: 'ignore'}).unref();
  for (let i = 0; i < 60; i++) {
    if (await chromeUp()) {
      // Cold start only — when Chrome was already running, its extension
      // (and the tab numbers already handed out) stay untouched.
      await loadTabNumbersExtension();
      return;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Chrome did not come up with CDP port ${CHROME}`);
}

let launching = null;
async function ensureChrome() {
  if (await chromeUp()) return;
  // one shared launch for concurrent connections
  launching ??= launchChrome().finally(() => { launching = null; });
  await launching;
}

const server = net.createServer(client => {
  client.on('error', () => client.destroy());
  // Chrome comes up only once the client SENDS data (puppeteer sends an HTTP
  // GET). Bare "is the port alive?" connections (e.g. the wrapper's probe) do
  // not wake it.
  client.once('data', async firstChunk => {
    client.pause();
    try {
      await ensureChrome();
    } catch {
      client.destroy();
      return;
    }
    const upstream = net.connect({port: CHROME, host: '127.0.0.1'});
    upstream.on('error', () => { upstream.destroy(); client.destroy(); });
    upstream.once('connect', () => {
      upstream.write(firstChunk);
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
    });
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') process.exit(0); // another proxy is already up
  throw err;
});

server.listen(LISTEN, '127.0.0.1');
