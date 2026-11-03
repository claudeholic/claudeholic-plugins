// SPDX-License-Identifier: GPL-3.0-only
// crek-dedupe-check --ids on a SQLite pipeline: verdicts from stored data, and the note it
// suggests (date DD.MM.YYYY, match reasons always in English, the rest in the user's language).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from '../assets/crek-db.mjs';

const [maj, min] = process.versions.node.split('.').map(Number);
const skip = !(maj > 22 || (maj === 22 && min >= 13)) && 'needs node:sqlite';
const SCRIPT = fileURLToPath(new URL('../assets/crek-dedupe-check.mjs', import.meta.url));
let dir;
const ids = {};

function run(lang, ...args) {
  const cfg = join(dir, `crek.${lang}.json`);
  writeFileSync(cfg, JSON.stringify({ version: 2, db: { backend: 'sqlite', path_or_url: 'crek.db' }, presentation: { language: lang } }));
  return spawnSync(process.execPath, [SCRIPT, '--config', cfg, ...args], { encoding: 'utf8' });
}

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'crek-test-dedupe-'));
  const db = await openDb({ backend: 'sqlite', path_or_url: 'crek.db' }, { baseDir: dir, create: true });
  await db.init();
  ids.applied = await db.insertJob({ title: 'Platform Engineer', agency: 'Contoso', status: 'applied', applied_date: '2026-10-20',
    source_url: 'https://jobs.example.com/offer/1001', salary_min_hour: 150, salary_max_hour: 180 });
  ids.sameUrl = await db.insertJob({ title: 'Platform Engineer', agency: 'Contoso', status: 'new',
    source_url: 'https://jobs.example.com/offer/1001?utm_source=newsletter' });
  ids.likely = await db.insertJob({ title: 'Platform Engineer (m/f/d)', agency: 'Contoso', status: 'new',
    source_url: 'https://other-board.example.org/p/77', salary_min_hour: 160, salary_max_hour: 190 });
  ids.other = await db.insertJob({ title: 'Accountant', agency: 'Woodgrove Bank', status: 'new',
    source_url: 'https://bank.example.net/careers/9' });
  await db.close();
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test('dedupe --ids: duplicate, in_pipeline and keep from stored data', { skip }, () => {
  const r = run('pl', '--ids', [ids.sameUrl, ids.likely, ids.other, 99999].join(','), '--json');
  assert.equal(r.status, 0, r.stderr);
  const out = Object.fromEntries(JSON.parse(r.stdout).map((x) => [x.id, x]));
  assert.equal(out[ids.sameUrl].verdict, 'duplicate');
  assert.equal(out[ids.sameUrl].earlier_id, ids.applied);
  assert.equal(out[ids.likely].verdict, 'in_pipeline');
  assert.equal(out[ids.likely].earlier_id, ids.applied);
  assert.equal(out[ids.other].verdict, 'keep');
  assert.equal(out[99999].verdict, 'unknown');
  // A failure is a warning, never a note: the note is what gets appended to the row.
  assert.equal(out[99999].note, '');
  assert.equal(out[99999].warning, 'no such pipeline row');
});

test('dedupe text output: a failure goes to the warning column, not into a dated note', { skip }, () => {
  const r = run('pl', '--ids', '99999');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /#99999 \| nie wiadomo \| numery: - \| ! no such pipeline row/);
  assert.doesNotMatch(r.stdout, /\d\d\.\d\d\.\d{4}: no such pipeline row/);
});

test('dedupe language: --lang, then env CREK_LANG, then the config', { skip }, () => {
  const env = { ...process.env, CREK_LANG: 'en' };
  const cfg = join(dir, 'crek.pl.json');
  const viaEnv = spawnSync(process.execPath, [SCRIPT, '--config', cfg, '--ids', String(ids.other)], { encoding: 'utf8', env });
  assert.match(viaEnv.stdout, /\| keep/);
  const viaFlag = spawnSync(process.execPath, [SCRIPT, '--config', cfg, '--ids', String(ids.other), '--lang', 'pl'], { encoding: 'utf8', env });
  assert.match(viaFlag.stdout, /\| zostaje/);
});

test('dedupe notes: DD.MM.YYYY date, English match reasons, template in the user language', { skip }, () => {
  const pl = JSON.parse(run('pl', '--ids', String(ids.sameUrl), '--json').stdout)[0];
  assert.match(pl.note, /^\d\d\.\d\d\.\d{4}: twardy duplikat #\d+ Contoso \(applied 20\.10\) — wspólne: same URL \(sprawdzone /);
  assert.doesNotMatch(pl.note, /ten sam URL/);
  assert.equal(pl.evidence, 'same URL');
  const en = JSON.parse(run('en', '--ids', String(ids.sameUrl), '--json').stdout)[0];
  assert.match(en.note, /^\d\d\.\d\d\.\d{4}: hard duplicate of #\d+ Contoso \(applied 20\.10\) — shared: same URL \(checked /);
});

test('dedupe text output: verdicts and the summary follow the user language', { skip }, () => {
  const r = run('pl', '--ids', `${ids.sameUrl},${ids.other}`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /#\d+ \| duplikat → #\d+ Contoso \(applied\)/);
  assert.match(r.stdout, /# crek-dedupe-check .*duplikaty: 1, .*do pokazania: 1, nieustalone: 0 \(z 2\)/);
});
