#!/usr/bin/env node
// MCP multiplexer stub (chrome-shared plugin).
//
// Lightweight per-session process that speaks MCP stdio with Claude Code
// and forwards tools/call requests to the mux daemon over a Unix socket.
//
// Handles initialize and tools/list locally (from cache), so the heavy
// chrome-devtools-mcp engine is never started just for capability discovery.
//
// Usage: node chrome-mux-stub.mjs <engine-entry-path> [engine args...]

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CACHE_DIR = path.join(process.env.HOME, '.cache', 'chrome-shared');
const SOCKET_PATH = path.join(CACHE_DIR, 'mux.sock');
const MANIFEST_PATH = path.join(CACHE_DIR, 'tools-manifest.json');
const MANIFEST_VERSION_PATH = path.join(CACHE_DIR, 'tools-manifest-version.txt');
const MUX_SERVER = new URL('./chrome-mux-server.mjs', import.meta.url).pathname;
const LOG_PATH = path.join(CACHE_DIR, 'mux.log');

// Engine entry path and args from CLI.
const engineEntry = process.argv[2];
const engineArgs = process.argv.slice(3);

if (!engineEntry) {
  process.stderr.write('Usage: chrome-mux-stub.mjs <engine-entry-path> [engine args...]\n');
  process.exit(1);
}

// Current engine version: the basename of the symlink target.
function currentEngineVersion() {
  try {
    return fs.readlinkSync(path.join(CACHE_DIR, 'engine', 'current'));
  } catch {
    return null;
  }
}

function log(...args) {
  const ts = new Date().toISOString();
  const line = `${ts} [mux-stub:${process.pid}] ${args.join(' ')}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch {}
}

// ---------------------------------------------------------------------------
// Local responses: initialize and tools/list
// ---------------------------------------------------------------------------

function makeInitializeResponse(id) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: 'chrome_devtools', version: '1.0.0' },
    },
  };
}

// Try loading cached tools manifest (if version matches).
function loadCachedManifest() {
  try {
    const ver = currentEngineVersion();
    if (!ver) return null;
    const cachedVer = fs.readFileSync(MANIFEST_VERSION_PATH, 'utf8').trim();
    if (cachedVer !== ver) return null;
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveCachedManifest(result) {
  try {
    const ver = currentEngineVersion();
    if (!ver) return;
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(result));
    fs.writeFileSync(MANIFEST_VERSION_PATH, ver);
  } catch (err) {
    log('failed to save manifest cache:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Daemon connection
// ---------------------------------------------------------------------------

// Persistent socket to the daemon for tools/call and other forwarded methods.
let daemonSocket = null;
let daemonBuf = '';
const daemonPending = new Map(); // id -> { resolve, reject, timer }

function isDaemonAlive() {
  return daemonSocket && !daemonSocket.destroyed;
}

function connectToDaemon() {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ path: SOCKET_PATH });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('daemon connect timeout'));
    }, 5000);

    sock.once('connect', () => {
      clearTimeout(timer);
      daemonSocket = sock;
      daemonBuf = '';

      sock.on('data', chunk => {
        daemonBuf += chunk.toString();
        let nl;
        while ((nl = daemonBuf.indexOf('\n')) !== -1) {
          const line = daemonBuf.slice(0, nl).trim();
          daemonBuf = daemonBuf.slice(nl + 1);
          if (!line) continue;
          handleDaemonMessage(line);
        }
      });

      sock.on('error', err => {
        log('daemon socket error:', err.message);
        cleanupDaemonSocket();
      });

      sock.on('close', () => {
        cleanupDaemonSocket();
      });

      resolve(sock);
    });

    sock.once('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function cleanupDaemonSocket() {
  if (daemonSocket) {
    daemonSocket.destroy();
    daemonSocket = null;
  }
  // Reject all pending.
  for (const [id, entry] of daemonPending) {
    clearTimeout(entry.timer);
    entry.reject(new Error('daemon connection lost'));
  }
  daemonPending.clear();
}

function handleDaemonMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  // Notification (no id) — forward to stdout.
  if (msg.id === undefined || msg.id === null) {
    writeStdout(msg);
    return;
  }

  // Response to a pending request.
  const entry = daemonPending.get(msg.id);
  if (entry) {
    daemonPending.delete(msg.id);
    clearTimeout(entry.timer);
    entry.resolve(msg);
  }
}

// Start the daemon if it's not running.
function startDaemon() {
  log('starting mux daemon');
  const child = spawn('node', [MUX_SERVER, engineEntry, ...engineArgs], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
    },
  });
  child.unref();
}

// Ensure we have a live connection to the daemon.
// If the socket doesn't exist, start the daemon and retry.
async function ensureDaemon() {
  if (isDaemonAlive()) return;

  // First attempt.
  try {
    await connectToDaemon();
    return;
  } catch {
    // Socket missing or daemon dead — start it.
  }

  startDaemon();

  // Wait for the socket to appear and become connectable.
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (fs.existsSync(SOCKET_PATH)) {
      try {
        await connectToDaemon();
        return;
      } catch {
        // not yet ready
      }
    }
  }

  throw new Error('failed to connect to mux daemon after starting it');
}

// Send a request to the daemon and return the response.
async function requestDaemon(msg) {
  await ensureDaemon();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      daemonPending.delete(msg.id);
      reject(new Error('daemon request timeout'));
    }, 120_000);

    daemonPending.set(msg.id, { resolve, reject, timer });
    daemonSocket.write(JSON.stringify(msg) + '\n');
  });
}

// ---------------------------------------------------------------------------
// Tools/list: cached or fetched from daemon
// ---------------------------------------------------------------------------

async function handleToolsList(msg) {
  // Try cache first.
  const cached = loadCachedManifest();
  if (cached) {
    writeStdout({ jsonrpc: '2.0', id: msg.id, result: cached });
    return;
  }

  // Fetch from daemon.
  try {
    const response = await requestDaemon({
      jsonrpc: '2.0',
      id: msg.id,
      method: 'tools/list',
      params: msg.params || {},
    });

    // Cache the result.
    if (response.result) {
      saveCachedManifest(response.result);
    }

    writeStdout(response);
  } catch (err) {
    writeStdout({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32603, message: `tools/list failed: ${err.message}` },
    });
  }
}

// ---------------------------------------------------------------------------
// Stdin/stdout (MCP stdio transport)
// ---------------------------------------------------------------------------

function writeStdout(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

let stdinBuf = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  stdinBuf += chunk;
  let nl;
  while ((nl = stdinBuf.indexOf('\n')) !== -1) {
    const line = stdinBuf.slice(0, nl).trim();
    stdinBuf = stdinBuf.slice(nl + 1);
    if (!line) continue;
    handleStdinMessage(line);
  }
});

process.stdin.on('end', () => {
  // Claude Code closed the session.
  cleanupDaemonSocket();
  process.exit(0);
});

function handleStdinMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log('unparseable stdin:', line.slice(0, 200));
    return;
  }

  switch (msg.method) {
    case 'initialize':
      writeStdout(makeInitializeResponse(msg.id));
      return;

    case 'notifications/initialized':
      // Acknowledge silently — nothing to do.
      return;

    case 'tools/list':
      handleToolsList(msg).catch(err => {
        log('tools/list error:', err.message);
      });
      return;

    default:
      // Everything else (tools/call, etc.) — forward to daemon.
      handleForward(msg).catch(err => {
        log('forward error:', err.message);
      });
      return;
  }
}

async function handleForward(msg) {
  try {
    const response = await requestDaemon(msg);
    writeStdout(response);
  } catch (err) {
    if (msg.id !== undefined && msg.id !== null) {
      writeStdout({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32603, message: `Request failed: ${err.message}` },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

process.on('SIGTERM', () => {
  cleanupDaemonSocket();
  process.exit(0);
});

process.on('SIGINT', () => {
  cleanupDaemonSocket();
  process.exit(0);
});

log('stub started, engine:', engineEntry);
