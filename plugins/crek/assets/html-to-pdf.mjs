#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
/**
 * html-to-pdf — render a local HTML file to PDF using the Chrome that is already running.
 *
 *   node html-to-pdf.mjs <input.html> [output.pdf] [--port N]
 *
 * Why not `google-chrome --headless --print-to-pdf`: that spawns a second browser and depends
 * on the binary being installed under one particular name (google-chrome, chromium,
 * brave-browser, ... — it varies by distribution). The chrome-shared plugin, which this plugin
 * depends on, already keeps a browser running with its debugging port open. We ask that one.
 *
 * The page's own CSS decides paper size and margins (`preferCSSPageSize`), so the @page rule in
 * build_cv.py stays the single source of truth. Backgrounds are printed — without that the
 * header colour and zebra rows would come out white.
 *
 * The tab-number prefix chrome-shared puts in the title ("[60] Name - CV") is removed from the PDF's
 * Title metadata with pdftk; without pdftk the file is fine but its Title keeps the prefix (a
 * warning says so).
 *
 * Requires Node >= 22 (built-in WebSocket).
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { PORTS, findPort, openTab, closeTab, connect } from './crek-cdp.mjs';
import { pathToFileURL } from 'node:url';

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node html-to-pdf.mjs <input.html> [output.pdf] [--port N]');
  process.exit(2);
}

const args = process.argv.slice(2);
let port = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') { port = Number(args[++i]); continue; }
  positional.push(args[i]);
}
if (positional.length < 1) usage('missing input file');
if (port !== null && !Number.isInteger(port)) usage('--port takes a port number');

const input = resolve(positional[0]);
// Default output: the input with .html / .htm replaced by .pdf, or ".pdf" appended to any other
// name — never the input itself.
const output = resolve(positional[1] ?? (/\.html?$/i.test(input) ? input.replace(/\.html?$/i, '.pdf') : `${input}.pdf`));
if (output === input) usage('the output would overwrite the input — give another output name');
try { readFileSync(input); } catch { usage(`cannot read ${input}`); }

const found = await findPort(port);
if (!found) {
  console.error(
    'error: no Chrome debugging port responded' +
    (port ? ` on ${port}` : ` (tried ${PORTS.join(', ')})`) + '.\n' +
    'Is the chrome-shared plugin running? Start it by opening any page through it, or pass --port.');
  process.exit(1);
}

/** Strip the [N] tab prefix from the PDF Title with pdftk. Returns a warning, or null. */
function fixTitle(file) {
  let meta;
  try {
    meta = execFileSync('pdftk', [file, 'dump_data'], { encoding: 'latin1', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return err.code === 'ENOENT'
      ? 'pdftk is not installed — the PDF is fine, but its Title metadata may keep the "[N] " tab prefix (install pdftk, or check with pdfinfo)'
      : `pdftk could not read the PDF (${err.message.split('\n')[0]}) — its Title metadata may keep the "[N] " tab prefix`;
  }
  const fixed = meta.replace(/(InfoKey: Title\nInfoValue: )\[\d+\]\s*/, '$1');
  if (fixed === meta) return null;
  const tmpMeta = `${file}.meta`;
  const tmpPdf = `${file}.tmp`;
  try {
    writeFileSync(tmpMeta, fixed, 'latin1');
    execFileSync('pdftk', [file, 'update_info', tmpMeta, 'output', tmpPdf], { stdio: 'ignore' });
    renameSync(tmpPdf, file);
    return null;
  } catch (err) {
    return `pdftk could not rewrite the Title (${err.message.split('\n')[0]}) — it keeps the "[N] " tab prefix`;
  } finally {
    try { unlinkSync(tmpMeta); } catch { /* gone */ }
    try { unlinkSync(tmpPdf); } catch { /* gone */ }
  }
}

// Open the file in a fresh tab; everything after this point runs inside try/finally, so the tab is
// closed whatever fails (the WebSocket connection included).
let target;
try {
  // A real file URL: "#", "?" or "%" in a directory name must not cut the path short.
  target = await openTab(found.port, pathToFileURL(input).href);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}

let page;
try {
  page = await connect(target.webSocketDebuggerUrl);
  const loaded = new Promise((ok) => page.on('Page.loadEventFired', ok));
  await page.send('Page.enable');
  // The tab was created with the URL already set, so the load event may have fired before we
  // attached. Reload to get a deterministic signal.
  await page.send('Page.reload', { ignoreCache: true });
  await Promise.race([
    loaded,
    new Promise((_, fail) => setTimeout(() => fail(new Error('page did not load in 20s')), 20000)),
  ]);

  // chrome-shared numbers its tabs by rewriting the page title ("[60] Name - CV"), and Chrome copies
  // document.title into the PDF Title field. Its MutationObserver restores the prefix asynchronously,
  // while printToPDF reads the title synchronously — so queue both commands back to back, without
  // awaiting the round-trip in between, and the print usually lands on the clean title.
  const titleFix = page.send('Runtime.evaluate', {
    expression: "document.title = document.title.replace(/^\\[\\d+\\]\\s/, '')",
  });
  const printing = page.send('Page.printToPDF', {
    printBackground: true,        // header colour, zebra rows
    displayHeaderFooter: false,   // no URL/date furniture — same as --no-pdf-header-footer
    preferCSSPageSize: true,      // the @page rule in the CV decides size and margins
    transferMode: 'ReturnAsBase64',
  }, 120000);
  await titleFix;
  const { data } = await printing;
  writeFileSync(output, Buffer.from(data, 'base64'));

  // When the prefix still made it into the Title, fix the metadata on the finished file.
  const warning = fixTitle(output);
  if (warning) console.error(`warning: ${warning}`);

  const kb = Math.round(Buffer.from(data, 'base64').length / 1024);
  console.log(`OK: ${basename(output)} (${kb} KB) via ${found.browser} on port ${found.port}`);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  page?.close();
  await closeTab(found.port, target.id);
}
