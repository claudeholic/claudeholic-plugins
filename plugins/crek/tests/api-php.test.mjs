// SPDX-License-Identifier: GPL-3.0-only
// The real assets/crek-php (api.php, index.php, crek-auth.php) under PHP's built-in server on a
// SQLite file, driven through crek-db.mjs and raw HTTP. Skipped when there is no PHP: set CREK_PHP
// to a php binary (or a wrapper, e.g. one running a php container with host networking and this
// test's temporary directory mounted at the same path), otherwise `php` from PATH is used.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { openDb } from '../assets/crek-db.mjs';

const PHP_DIR = fileURLToPath(new URL('../assets/crek-php/', import.meta.url));
const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));
const [maj, min] = process.versions.node.split('.').map(Number);
const hasSqlite = maj > 22 || (maj === 22 && min >= 13);

function findPhp() {
  if (process.env.CREK_PHP) return process.env.CREK_PHP;
  for (const d of String(process.env.PATH ?? '').split(delimiter)) if (d && existsSync(join(d, 'php'))) return join(d, 'php');
  return null;
}
const PHP = findPhp();
const skip = !PHP ? 'no php (set CREK_PHP)' : !hasSqlite ? 'needs node:sqlite' : false;

const TOKEN = 'a'.repeat(32) + 'b1c2d3e4'.repeat(4); // 64 characters
let dir;
let port;
let server;
let base;

function config(token, extra = '') {
  return `<?php
${token === undefined ? '' : `$api_token = ${JSON.stringify(token)};`}
${extra}
$db = new PDO('sqlite:${join(dir, 'crek.db')}', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$db->exec('PRAGMA foreign_keys = ON');
`;
}

/** Raw HTTP, so that Host, Origin and Content-Type can be anything. */
function http(method, path, { headers = {}, body } = {}) {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        ok({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', fail);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
const withToken = (h = {}) => ({ 'X-Crek-Token': TOKEN, ...h });

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'crek-test-php-'));
  for (const f of ['api.php', 'index.php', 'crek-auth.php']) copyFileSync(join(PHP_DIR, f), join(dir, f));
  writeFileSync(join(dir, 'crek.config.json'), JSON.stringify({ version: 2, db: { backend: 'sqlite', path_or_url: 'crek.db' } }));
  const init = spawnSync(process.execPath, [join(ASSETS, 'crek-db.mjs'), '--config', join(dir, 'crek.config.json'), 'init'], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  writeFileSync(join(dir, 'config.php'), config(TOKEN));
  port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  // opcache would serve config.php from cache for up to 2 s after a test rewrites it.
  server = spawn(PHP, ['-d', 'opcache.enable=0', '-S', `127.0.0.1:${port}`, '-t', dir], { cwd: dir, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { await http('GET', '/api.php?route=stats', { headers: withToken() }); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  base = `http://127.0.0.1:${port}/api.php`;
});
after(async () => {
  if (server) { server.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 500)); }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('api.php: no header, a wrong token and a good one', { skip }, async () => {
  const none = await http('GET', '/api.php?route=jobs');
  assert.equal(none.status, 401);
  assert.equal(none.json.auth, 'token');
  assert.match(none.json.error, /missing X-Crek-Token/);
  const t0 = Date.now();
  const wrong = await http('GET', '/api.php?route=jobs', { headers: { 'X-Crek-Token': `${TOKEN.slice(0, -1)}x` } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error, 'invalid token');
  const paused = Date.now() - t0;
  assert.ok(paused >= 150, 'a wrong token is answered after a pause');
  assert.ok(paused < 900, 'a short pause: php -S answers one request at a time');
  const basicOnly = await http('GET', '/api.php?route=jobs', { headers: { Authorization: `Basic ${Buffer.from('u:p').toString('base64')}` } });
  assert.equal(basicOnly.status, 401, 'basic auth never replaces the token');
  const good = await http('GET', '/api.php?route=jobs', { headers: withToken() });
  assert.equal(good.status, 200);
  assert.deepEqual(good.json, []);
});

test('index.php: no header, a wrong token and a good one', { skip }, async () => {
  for (const headers of [{}, { 'X-Crek-Token': 'nope' }]) {
    const r = await http('GET', '/index.php', { headers });
    assert.equal(r.status, 401);
    assert.match(r.headers['content-type'], /text\/plain/);
    assert.ok(r.text.length < 400, 'one line, no app');
    assert.doesNotMatch(r.text, /API_BASE|<script|kanban/i);
  }
  const ok = await http('GET', '/index.php', { headers: withToken() });
  assert.equal(ok.status, 200);
  assert.match(ok.text, /const API_BASE = 'api\.php\?route='/);
  assert.doesNotMatch(ok.text, new RegExp(TOKEN), 'the token is never written into the page');
});

test('no token configured: index.php and api.php refuse everything', { skip }, async () => {
  for (const token of [undefined, 'short-token']) {
    writeFileSync(join(dir, 'config.php'), config(token));
    try {
      const api = await http('GET', '/api.php?route=jobs', { headers: withToken() });
      assert.equal(api.status, 503);
      assert.match(api.json.error, /\$api_token/);
      const ui = await http('GET', '/index.php', { headers: withToken() });
      assert.equal(ui.status, 503);
      assert.match(ui.text, /\$api_token/);
      assert.doesNotMatch(ui.text, /API_BASE/);
    } finally {
      writeFileSync(join(dir, 'config.php'), config(TOKEN));
    }
  }
});

test('api.php through crek-db (db.token): CRUD, contacts, stats, append', { skip }, async () => {
  const db = await openDb({ backend: 'http-api', path_or_url: base, token: TOKEN });
  const id = await db.insertJob({ title: 'Platform Engineer', agency: 'Initech', status: 'new', technologies: ['Go'], notes: '' });
  assert.ok(id > 0);
  let job = await db.getJob(id);
  assert.equal(job.title, 'Platform Engineer');
  assert.equal(job.notes, null);
  assert.equal(await db.updateJob(id, { status: 'applied', salary_min_hour: 150 }), true);
  job = await db.getJob(id);
  assert.equal(job.status, 'applied');
  assert.equal(await db.getJob(99999), null);
  const c = await db.upsertContact({ name: 'Ann Lee', company_name: 'Initech', email: 'ann@example.com' });
  assert.equal(await db.linkContacts(id, [c]), true);
  assert.equal((await db.getJob(id)).contact_names, 'Ann Lee');
  assert.equal((await db.listJobs({ status: 'applied' })).length, 1);
  assert.equal((await db.listJobs({ search: 'initech' })).length, 1);
  assert.equal(Number((await db.stats()).total), 1);
  assert.equal(await db.appendJob(id, 'notes', '03.11.2026: first'), true);
  assert.equal(await db.appendJob(id, 'notes', '03.11.2026: second'), true);
  assert.equal((await db.getJob(id)).notes, '03.11.2026: first\n03.11.2026: second');
  assert.equal(await db.appendJob(99999, 'notes', 'x'), false);
  const other = await db.insertJob({ title: 'To delete' });
  assert.equal(await db.deleteJob(other), true);
  assert.equal(await db.deleteJob(other), false);
});

test('api.php: parallel appends through the CLI keep every line (append route)', { skip }, async () => {
  const cfg = join(dir, 'http.config.json');
  writeFileSync(cfg, JSON.stringify({ version: 2, db: { backend: 'http-api', path_or_url: base, token: TOKEN } }));
  const db = await openDb({ backend: 'http-api', path_or_url: base, token: TOKEN });
  const id = await db.insertJob({ title: 'Parallel', communication: 'start' });
  const runs = Array.from({ length: 8 }, (_, i) => new Promise((ok) => {
    const ch = spawn(process.execPath, [join(ASSETS, 'crek-db.mjs'), '--config', cfg, 'jobs:append', String(id), 'communication', `03.11.2026: entry ${i}`]);
    ch.on('close', ok);
  }));
  assert.deepEqual(await Promise.all(runs), Array(8).fill(0));
  const lines = (await db.getJob(id)).communication.split('\n');
  assert.equal(lines.length, 9);
  for (let i = 0; i < 8; i++) assert.ok(lines.includes(`03.11.2026: entry ${i}`));
});

test('api.php: unknown status → 400 with the allowed list (POST and PUT)', { skip }, async () => {
  const post = await http('POST', '/api.php?route=jobs', { headers: withToken({ 'Content-Type': 'application/json' }), body: { title: 'x', status: 'bogus' } });
  assert.equal(post.status, 400);
  assert.match(post.json.error, /unknown status "bogus" — allowed: new, applied, interview, offer, rejected, declined, skipped, closed, duplicate/);
  const put = await http('PUT', '/api.php?route=jobs/1', { headers: withToken({ 'Content-Type': 'application/json' }), body: { status: 'Applied' } });
  assert.equal(put.status, 400);
  const fine = await http('PUT', '/api.php?route=jobs/1', { headers: withToken({ 'Content-Type': 'application/json' }), body: { status: 'interview' } });
  assert.equal(fine.status, 200);
});

test('api.php: 415 for a non-JSON body, 403 for a foreign Origin or Host, 400 for a bad append', { skip }, async () => {
  const plain = await http('POST', '/api.php?route=jobs', { headers: withToken({ 'Content-Type': 'text/plain' }), body: '{"title":"x"}' });
  assert.equal(plain.status, 415);
  const origin = await http('GET', '/api.php?route=jobs', { headers: withToken({ Origin: 'https://evil.example' }) });
  assert.equal(origin.status, 403);
  const host = await http('GET', '/api.php?route=jobs', { headers: withToken({ Host: 'evil.example' }) });
  assert.equal(host.status, 403);
  const sameOrigin = await http('GET', '/api.php?route=stats', { headers: withToken({ Origin: `http://127.0.0.1:${port}` }) });
  assert.equal(sameOrigin.status, 200);
  const badField = await http('POST', '/api.php?route=jobs/1/append', { headers: withToken({ 'Content-Type': 'application/json' }), body: { field: 'title', text: 'x' } });
  assert.equal(badField.status, 400);
  const nothing = await http('GET', '/api.php?route=nope', { headers: withToken() });
  assert.equal(nothing.status, 404);
});

test('api.php: a broken database connection answers a generic error, no DSN', { skip }, async () => {
  writeFileSync(join(dir, 'config.php'), `<?php\n$api_token = ${JSON.stringify(TOKEN)};\n$db = new PDO('mysql:host=127.0.0.1;port=1;dbname=secretdb', 'secretuser', 'secretpass');\n`);
  try {
    const r = await http('GET', '/api.php?route=jobs', { headers: withToken() });
    assert.equal(r.status, 500);
    assert.equal(r.json.error, 'database unavailable (details in the server log)');
    assert.doesNotMatch(r.text, /secret/);
  } finally {
    writeFileSync(join(dir, 'config.php'), config(TOKEN));
  }
});

/** The page with a given config.php; the test's own config comes back afterwards. */
async function pageWith(extra) {
  writeFileSync(join(dir, 'config.php'), config(TOKEN, extra));
  try {
    return await http('GET', '/index.php', { headers: withToken() });
  } finally {
    writeFileSync(join(dir, 'config.php'), config(TOKEN));
  }
}
const i18n = JSON.parse(readFileSync(join(ASSETS, 'i18n.json'), 'utf8'));
const statusKeys = (d) => Object.keys(d.en).filter((k) => k.startsWith('ui.status.')).map((k) => k.slice('ui.status.'.length));

test('index.php: language and theme default from config.php ($ui_lang, $ui_theme)', { skip }, async () => {
  const plain = await pageWith('');
  assert.equal(plain.status, 200);
  assert.match(plain.text, /<html lang="pl" data-theme="dark">/, 'no setting: Polish, dark');
  assert.ok(plain.text.includes(`data-i18n="ui.add_job">${i18n.pl['ui.add_job']}<`));
  const en = await pageWith(`$ui_lang = 'en'; $ui_theme = 'light';`);
  assert.equal(en.status, 200);
  assert.match(en.text, /<html lang="en" data-theme="light">/);
  assert.ok(en.text.includes(`data-i18n="ui.add_job">${i18n.en['ui.add_job']}<`));
  assert.match(en.text, /const UI_DEFAULT_LANG = "en";/);
  assert.match(en.text, /const UI_DEFAULT_THEME = "light";/);
  assert.match(en.text, /<option value="light" selected>/);
  const odd = await pageWith(`$ui_lang = 'xx'; $ui_theme = 'neon';`);
  assert.match(odd.text, /<html lang="en" data-theme="dark">/, 'unknown language → en, unknown theme → dark');
  // Every dictionary reaches the page, so the switch works without a reload.
  const all = JSON.parse(en.text.split('const I18N_ALL = ')[1].split(';\n')[0]);
  assert.deepEqual(Object.keys(all).sort(), Object.keys(i18n).sort());
  assert.equal(all.pl['ui.theme.light'], i18n.pl['ui.theme.light']);
  assert.ok(Object.keys(all.en).every((k) => k.startsWith('ui.')), 'only the ui.* part');
  // The switches remember the choice in the browser.
  assert.match(en.text, /localStorage\.getItem\('crek\.ui\.theme'\)/);
  assert.match(en.text, /uiStore\.set\('crek\.ui\.lang'/);
  assert.match(en.text, /<select id="uiLang"[^>]*>[^]*?<option value="en" selected>EN<\/option>/);
});

test('index.php: the status lists come from the dictionary (ui.status.*), not from the code', { skip }, async () => {
  const page = await pageWith(`$ui_lang = 'en';`);
  const filter = page.text.split('<select id="filterStatus">')[1].split('</select>')[0];
  const values = [...filter.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ['all', ...statusKeys(i18n)]);
  for (const k of statusKeys(i18n)) assert.ok(filter.includes(`>${i18n.en[`ui.status.${k}`]}</option>`));
  const src = readFileSync(join(PHP_DIR, 'index.php'), 'utf8');
  assert.doesNotMatch(src, /\['new', 'applied', 'interview'/, 'no hard-coded status list in PHP');
  assert.doesNotMatch(src, /\{key:'new'/, 'no hard-coded status list in JS');
});

test('a status added to the dictionary appears in the UI and is accepted by api.php', { skip }, async () => {
  const original = readFileSync(join(dir, 'index.php'), 'utf8');
  const patched = original
    .replace('"ui.status.duplicate": "Duplicate",', '"ui.status.duplicate": "Duplicate",\n    "ui.status.on_hold": "On hold",')
    .replace('"ui.status.duplicate": "Duplikat",', '"ui.status.duplicate": "Duplikat",\n    "ui.status.on_hold": "Wstrzymane",');
  assert.notEqual(patched, original);
  writeFileSync(join(dir, 'index.php'), patched);
  try {
    const page = await pageWith('');
    assert.match(page.text, /<option value="on_hold" data-i18n="ui\.status\.on_hold">Wstrzymane<\/option>|<option value="on_hold">Wstrzymane<\/option>/);
    const post = await http('POST', '/api.php?route=jobs', { headers: withToken({ 'Content-Type': 'application/json' }), body: { title: 'On hold', status: 'on_hold' } });
    assert.equal(post.status, 200, post.text);
  } finally {
    writeFileSync(join(dir, 'index.php'), original);
  }
});

test('api.php: whole numbers, YYYY-MM-DD dates, a status never cleared (as crek-db.mjs)', { skip }, async () => {
  const h = withToken({ 'Content-Type': 'application/json' });
  const post = await http('POST', '/api.php?route=jobs', { headers: h, body: { title: 'Typed', match_score: '7', applied_date: '2026-11-03' } });
  assert.equal(post.status, 200, post.text);
  const id = post.json.id;
  for (const [body, re] of [
    [{ match_score: 'abc' }, /match_score must be a whole number, got "abc"/],
    [{ salary_min_hour: 12.5 }, /salary_min_hour must be a whole number/],
    [{ applied_date: 'yesterday' }, /applied_date must be a date as YYYY-MM-DD/],
    [{ response_date: '2026-02-30' }, /response_date must be a date/],
    [{ status: '' }, /status cannot be cleared — give one of: new, applied/],
  ]) {
    const r = await http('PUT', `/api.php?route=jobs/${id}`, { headers: h, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.json.error, re);
  }
  const bad = await http('POST', '/api.php?route=jobs', { headers: h, body: { title: 'x', my_rate_min: '150 PLN' } });
  assert.equal(bad.status, 400);
  const clear = await http('PUT', `/api.php?route=jobs/${id}`, { headers: h, body: { match_score: '', response_date: '2026-11-04' } });
  assert.equal(clear.status, 200, clear.text);
});
