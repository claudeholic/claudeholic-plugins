#!/usr/bin/env node
// MCP multiplexer daemon (chrome-shared plugin).
//
// Singleton process that listens on a Unix domain socket and proxies
// JSON-RPC requests from multiple stubs to ONE chrome-devtools-mcp
// engine child process (stdio). The engine is started LAZILY on the
// first tools/call — not at daemon startup.
//
// Usage: node chrome-mux-server.mjs <engine-entry-path> [engine args...]
// The engine entry path and all subsequent args are forwarded to the
// child process.
//
// Protocol on the socket: newline-delimited JSON-RPC (same as MCP stdio).

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CACHE_DIR = path.join(process.env.HOME, '.cache', 'chrome-shared');
const SOCKET_PATH = path.join(CACHE_DIR, 'mux.sock');

// Engine entry path and args from CLI.
const engineEntry = process.argv[2];
const engineArgs = process.argv.slice(3);

if (!engineEntry) {
  console.error('Usage: chrome-mux-server.mjs <engine-entry-path> [engine args...]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
const LOG_PATH = path.join(CACHE_DIR, 'mux.log');

function log(...args) {
  const ts = new Date().toISOString();
  const line = `${ts} [mux-server] ${args.join(' ')}\n`;
  fs.appendFileSync(LOG_PATH, line);
}

// ---------------------------------------------------------------------------
// Idle shutdown configuration
// ---------------------------------------------------------------------------
// The shared engine is put to sleep after CS_ENGINE_IDLE_MS with no tools/call
// from any stub, so its RSS periodically returns to baseline. The next
// tools/call restarts it lazily through the usual init path. A value of "0"
// disables idle shutdown entirely (the engine never sleeps).
//
// The threshold is resolved DYNAMICALLY on every idle tick (see resolveIdleMs),
// so editing ~/.claude/settings.json changes it within one check interval
// (<=60s) with no restart of anything. This matters because the mux is a
// system-wide singleton whose frozen startup env carries whatever value the
// stub that happened to wake it was born with — that value is non-deterministic
// and cannot otherwise be changed without restarting every live session.

const DEFAULT_IDLE_MS = 7_200_000; // 2h

// Validate a raw CS_ENGINE_IDLE_MS value. Returns a finite number >=0, or null
// when missing/blank/garbage. 0 is valid and means "idle shutdown disabled".
function validateIdleMs(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// Bootstrap value from the process env (frozen at mux startup). Used only as a
// fallback source when the settings file lacks the field, and to size the check
// interval below.
const ENV_IDLE_MS = validateIdleMs(process.env.CS_ENGINE_IDLE_MS);

// Source of the live threshold. We deliberately read ONLY the user-level
// ~/.claude/settings.json (its "env" object). Project/local/enterprise settings
// are ignored on purpose: the mux is a system-wide singleton shared across all
// projects, so a per-project idle threshold for a shared process is meaningless.
// If CLAUDE_CONFIG_DIR is set we honor it (that relocates the whole user-level
// config dir), but no other override hierarchy is consulted.
const SETTINGS_PATH = path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME, '.claude'),
  'settings.json',
);

// resolveIdleMs cache. We stat the file each call and re-parse only when its
// mtime changed; between changes we return the cached file-derived value.
let settingsMtimeMs = null;   // mtime at last successful parse
let settingsIdleMs = null;    // last CS_ENGINE_IDLE_MS from the file, or null

// Resolve the effective idle threshold in ms. Priority: file > env > default.
//   - File: ~/.claude/settings.json -> env.CS_ENGINE_IDLE_MS, used only when it
//     exists and validates (finite number >=0). Removed/invalid field -> null.
//   - Fallback to the bootstrap env value, then to the 2h default.
// CC writes settings.json non-atomically, so a partial read is possible; any
// stat/read/parse error is swallowed and the last known-good file value is kept
// (the threshold never moves on a bad tick, and the process never crashes).
function resolveIdleMs() {
  try {
    const st = fs.statSync(SETTINGS_PATH);
    if (settingsMtimeMs === null || st.mtimeMs !== settingsMtimeMs) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      settingsIdleMs = validateIdleMs(parsed?.env?.CS_ENGINE_IDLE_MS);
      settingsMtimeMs = st.mtimeMs; // commit mtime only after a successful parse
    }
  } catch {
    // File missing / unreadable / partial JSON — keep the previous value.
  }

  if (settingsIdleMs !== null) return settingsIdleMs;
  if (ENV_IDLE_MS !== null) return ENV_IDLE_MS;
  return DEFAULT_IDLE_MS;
}

// How often the idle check runs. Sized from the BOOTSTRAP value only — never
// recomputed dynamically. At hour-scale thresholds the 60s granularity is
// irrelevant, and a dynamic interval would be needless complexity. The only
// effect: a tiny bootstrap threshold (tests) ticks more often, which is fine.
const IDLE_CHECK_MS = (ENV_IDLE_MS !== null ? ENV_IDLE_MS : DEFAULT_IDLE_MS) > 0
  ? Math.max(1_000, Math.min(60_000, ENV_IDLE_MS !== null ? ENV_IDLE_MS : DEFAULT_IDLE_MS))
  : 60_000;

// Last effective threshold we logged, so we log only on an actual change.
let loggedIdleMs = null;

// Timestamp of the last actual tools/call from any stub. Only tools/call
// counts as activity — initialize / tools/list / notifications / ping must not
// keep an otherwise-idle engine alive forever.
let lastToolCallTs = Date.now();

// ---------------------------------------------------------------------------
// Engine child process (lazy, restartable)
// ---------------------------------------------------------------------------
let child = null;          // ChildProcess | null
let childReady = false;    // true once initialize handshake completes
let initPromise = null;    // pending initialize handshake

// Pending responses keyed by the rewritten (global) id.
const pending = new Map(); // globalId -> { stub, originalId }

let globalIdCounter = 0;
let stubIdCounter = 0;

function startEngine() {
  if (child) return;

  log('starting engine:', engineEntry, ...engineArgs);
  const proc = spawn('node', [engineEntry, ...engineArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
    },
  });
  child = proc;

  // Per-process buffer: a superseded engine that is still draining stdout must
  // never mix its bytes into the current engine's line buffer.
  let buf = '';

  proc.stdout.on('data', chunk => {
    if (child !== proc) return; // output from a superseded engine — ignore
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      handleEngineMessage(line);
    }
  });

  proc.stderr.on('data', chunk => {
    // Log engine stderr but never forward it.
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) log('engine stderr:', line.trim());
    }
  });

  proc.on('exit', (code, signal) => {
    log(`engine exited: code=${code} signal=${signal}`);
    // Only reset state / reject pending if this is still the live engine.
    // After an idle-shutdown the state was already cleared synchronously and a
    // newer engine may have been started; do not clobber it.
    if (child !== proc) return;
    child = null;
    childReady = false;
    initPromise = null;
    // Reject all pending requests from stubs.
    for (const [gid, { stub, originalId }] of pending) {
      sendToStub(stub, {
        jsonrpc: '2.0',
        id: originalId,
        error: { code: -32603, message: 'Engine process died' },
      });
    }
    pending.clear();
  });

  proc.on('error', err => {
    log('engine spawn error:', err.message);
    if (child !== proc) return;
    child = null;
    childReady = false;
    initPromise = null;
  });
}

// ---------------------------------------------------------------------------
// Idle shutdown: put the shared engine to sleep after prolonged inactivity.
// ---------------------------------------------------------------------------
function idleTick() {
  // Resolve the threshold live every tick so edits to settings.json take effect
  // within one interval. This keeps the file read alive even while disabled, so
  // idle shutdown can be re-enabled from the file without any restart.
  const idleMs = resolveIdleMs();
  if (idleMs !== loggedIdleMs) {
    if (loggedIdleMs !== null) {
      log(`idle threshold changed: ${loggedIdleMs} -> ${idleMs} ms`);
    }
    loggedIdleMs = idleMs;
  }

  if (idleMs <= 0) return;       // disabled (dynamically)
  if (!child) return;            // engine already asleep
  // Safety: never kill the engine while any request is in flight to it
  // (this also covers an initialize handshake still in progress). Defer to a
  // later tick.
  if (pending.size > 0) return;

  const idle = Date.now() - lastToolCallTs;
  if (idle < idleMs) return;

  // This runs synchronously with no await, so no tools/call can interleave
  // between the pending check and the kill. Clear engine state immediately —
  // identical to the 'exit'/'error' handlers — so a concurrent tools/call on
  // the next tick takes the lazy-start path and spawns a fresh engine, while
  // the superseded process (guarded by `child !== proc`) tears down quietly.
  const proc = child;
  log(`engine idle-shutdown after ${Math.round(idle / 1000)}s idle`);
  child = null;
  childReady = false;
  initPromise = null;
  try { proc.kill('SIGTERM'); } catch (err) { log('idle-shutdown kill error:', err.message); }
}

// Send the initialize handshake to the engine and wait for the response.
function initializeEngine() {
  if (childReady) return Promise.resolve();
  if (initPromise) return initPromise;

  startEngine();

  initPromise = new Promise((resolve, reject) => {
    const initId = `__mux_init_${Date.now()}`;
    const timer = setTimeout(() => {
      pending.delete(initId);
      reject(new Error('Engine initialize timeout'));
    }, 30_000);

    pending.set(initId, {
      stub: null, // internal request
      originalId: initId,
      resolve: (msg) => {
        clearTimeout(timer);
        childReady = true;
        // Send initialized notification.
        writeToEngine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
        resolve();
      },
    });

    writeToEngine(JSON.stringify({
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'chrome-mux-server', version: '1' },
      },
    }));
  });

  initPromise.catch(err => {
    log('initialize failed:', err.message);
    initPromise = null;
  });

  return initPromise;
}

function writeToEngine(line) {
  if (!child || !child.stdin.writable) return false;
  child.stdin.write(line + '\n');
  return true;
}

function handleEngineMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log('unparseable engine message:', line.slice(0, 200));
    return;
  }

  // Notification (no id) — broadcast to all stubs.
  if (msg.id === undefined || msg.id === null) {
    broadcastToStubs(msg);
    return;
  }

  // Response — find the pending request.
  const entry = pending.get(msg.id);
  if (!entry) {
    log('orphan response from engine, id:', JSON.stringify(msg.id));
    return;
  }
  pending.delete(msg.id);

  // Internal init request.
  if (entry.stub === null && entry.resolve) {
    entry.resolve(msg);
    return;
  }

  // Rewrite id back to the stub's original.
  const response = { ...msg, id: entry.originalId };
  sendToStub(entry.stub, response);
}

// ---------------------------------------------------------------------------
// Stub connections
// ---------------------------------------------------------------------------
const stubs = new Set();

function sendToStub(stub, msg) {
  if (!stub || stub.destroyed) return;
  try {
    stub.write(JSON.stringify(msg) + '\n');
  } catch {
    // Stub disconnected.
  }
}

function broadcastToStubs(msg) {
  const line = JSON.stringify(msg) + '\n';
  for (const stub of stubs) {
    try {
      stub.write(line);
    } catch {
      // ignore
    }
  }
}

function handleStubMessage(stub, line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log('unparseable stub message:', line.slice(0, 200));
    return;
  }

  // Stubs handle initialize and tools/list locally; we should not
  // receive them, but if we do, respond with an error.
  if (msg.method === 'initialize') {
    sendToStub(stub, {
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32600, message: 'initialize should be handled by the stub' },
    });
    return;
  }

  // Only actual tool invocations count as activity for idle shutdown.
  // initialize / tools/list / notifications / ping must not keep the engine
  // alive, otherwise idle-but-open sessions would pin it forever.
  if (msg.method === 'tools/call') {
    lastToolCallTs = Date.now();
  }

  // Ensure engine is running and initialized.
  const forward = () => {
    const globalId = `s${stub._muxId}_${++globalIdCounter}`;
    pending.set(globalId, { stub, originalId: msg.id });
    const rewritten = { ...msg, id: globalId };
    if (!writeToEngine(JSON.stringify(rewritten))) {
      pending.delete(globalId);
      sendToStub(stub, {
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32603, message: 'Engine unavailable' },
      });
    }
  };

  if (childReady) {
    forward();
  } else {
    initializeEngine()
      .then(forward)
      .catch(err => {
        sendToStub(stub, {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32603, message: `Engine init failed: ${err.message}` },
        });
      });
  }
}

// ---------------------------------------------------------------------------
// Socket server
// ---------------------------------------------------------------------------

// Clean up stale socket from a crashed daemon.
function removeStaleSocket() {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Check if another daemon is alive on the socket.
function isSocketAlive() {
  return new Promise(resolve => {
    const client = net.connect({ path: SOCKET_PATH });
    const timer = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 1000);
    client.once('connect', () => {
      clearTimeout(timer);
      client.destroy();
      resolve(true);
    });
    client.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function main() {
  // Singleton check.
  if (fs.existsSync(SOCKET_PATH)) {
    if (await isSocketAlive()) {
      log('another mux daemon is already running, exiting');
      process.exit(0);
    }
    removeStaleSocket();
  }

  const server = net.createServer(socket => {
    socket._muxId = ++stubIdCounter;
    socket._muxBuf = '';
    stubs.add(socket);
    log(`stub ${socket._muxId} connected`);

    socket.on('data', chunk => {
      socket._muxBuf += chunk.toString();
      let nl;
      while ((nl = socket._muxBuf.indexOf('\n')) !== -1) {
        const line = socket._muxBuf.slice(0, nl).trim();
        socket._muxBuf = socket._muxBuf.slice(nl + 1);
        if (!line) continue;
        handleStubMessage(socket, line);
      }
    });

    socket.on('error', err => {
      log(`stub ${socket._muxId} error: ${err.message}`);
    });

    socket.on('close', () => {
      stubs.delete(socket);
      // Clean up any pending requests for this stub.
      for (const [gid, entry] of pending) {
        if (entry.stub === socket) {
          pending.delete(gid);
        }
      }
      log(`stub ${socket._muxId} disconnected`);
    });
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      log('socket in use, exiting');
      process.exit(0);
    }
    log('server error:', err.message);
    process.exit(1);
  });

  server.listen(SOCKET_PATH, () => {
    log(`listening on ${SOCKET_PATH}`);
    // Make socket accessible to the user only.
    try { fs.chmodSync(SOCKET_PATH, 0o600); } catch {}
  });

  // Idle-shutdown watchdog. The timer ALWAYS runs at a fixed interval,
  // regardless of the current threshold — even a startup value of 0 must keep
  // ticking so idleTick() can pick up a later file edit that re-enables
  // shutdown. idleTick() itself resolves the live threshold and does nothing
  // while it is <=0. unref() so it never keeps the process alive.
  const initialIdleMs = resolveIdleMs();
  loggedIdleMs = initialIdleMs;
  log(`idle-shutdown watchdog started: threshold ${initialIdleMs}ms (0=disabled), check interval ${IDLE_CHECK_MS}ms`);
  const idleTimer = setInterval(idleTick, IDLE_CHECK_MS);
  idleTimer.unref();

  // Cleanup on exit.
  function cleanup() {
    log('shutting down');
    try { fs.unlinkSync(SOCKET_PATH); } catch {}
    if (child) {
      child.kill('SIGTERM');
    }
    server.close();
    process.exit(0);
  }

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

main().catch(err => {
  log('fatal:', err.message);
  process.exit(1);
});
