// SPDX-License-Identifier: GPL-3.0-only
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb, DbError, jobStatuses } from '../assets/crek-db.mjs';
import { loadI18n } from '../assets/crek-i18n.mjs';

const [maj, min] = process.versions.node.split('.').map(Number);
const hasSqlite = maj > 22 || (maj === 22 && min >= 13);
const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));
let dir;
let db;

before(async () => {
  if (!hasSqlite) return;
  dir = mkdtempSync(join(tmpdir(), 'crek-test-sqlite-'));
  db = await openDb({ backend: 'sqlite', path_or_url: 'crek.db' }, { baseDir: dir, create: true });
  await db.init();
  await db.init(); // idempotent
});
after(async () => { await db?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

test('sqlite: a missing file is an error unless creating', { skip: !hasSqlite }, async () => {
  await assert.rejects(openDb({ backend: 'sqlite', path_or_url: 'nope.db' }, { baseDir: dir }), DbError);
});

test('sqlite: add skips empty strings, update turns them into NULL', { skip: !hasSqlite }, async () => {
  const id = await db.insertJob({ title: 'Platform Engineer', agency: 'Initech', notes: '', technologies: ['Go', 'K8s'], salary_min_hour: 150 });
  let job = await db.getJob(id);
  assert.equal(job.notes, null);
  assert.equal(job.technologies, '["Go","K8s"]');
  assert.equal(job.status, 'new');
  assert.match(job.found_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  assert.equal(await db.updateJob(id, { salary_min_hour: '', status: 'applied' }), true);
  job = await db.getJob(id);
  assert.equal(job.salary_min_hour, null);
  assert.equal(job.status, 'applied');
  assert.equal(await db.updateJob(9999, { status: 'declined' }), false);
});

test('sqlite: unknown fields and invalid technologies are refused', { skip: !hasSqlite }, async () => {
  await assert.rejects(db.insertJob({ title: 'x', bogus: 1 }), /unknown field/);
  await assert.rejects(db.insertJob({ title: 'x', technologies: 'not json' }), /CHECK constraint/);
  await assert.rejects(db.insertJob({}), /nothing to insert/);
});

test('sqlite: updated_at follows every update (trigger)', { skip: !hasSqlite }, async () => {
  const id = await db.insertJob({ title: 'Trigger test' });
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(join(dir, 'crek.db'));
  raw.prepare("UPDATE jobs SET updated_at = '2000-01-01 00:00:00' WHERE id = ?").run(id);
  raw.close();
  await db.updateJob(id, { notes: 'x' });
  assert.notEqual((await db.getJob(id)).updated_at, '2000-01-01 00:00:00');
});

test('sqlite: contacts upsert keeps fields it is not given; links add up', { skip: !hasSqlite }, async () => {
  const c1 = await db.upsertContact({ name: "O'Brien", company_name: 'Initech', email: 'ob@example.com' });
  const again = await db.upsertContact({ name: "O'Brien", company_name: 'Initech', role: 'recruiter' });
  assert.equal(again, c1);
  const c = (await db.listContacts()).find((x) => x.id === c1);
  assert.equal(c.email, 'ob@example.com');
  assert.equal(c.role, 'recruiter');
  const c2 = await db.upsertContact({ name: 'Ann Lee', company_name: 'Initech' });
  const job = await db.insertJob({ title: 'Linked', contact_ids: [c1] });
  await db.linkContacts(job, [c2]);
  const row = await db.getJob(job);
  assert.deepEqual(row.contact_ids.split(',').map(Number).sort(), [c1, c2].sort());
  assert.match(row.contact_names, /O'Brien/);
  await db.updateJob(job, { contact_ids: [c2] });
  assert.equal((await db.getJob(job)).contact_ids, String(c2));
});

test('sqlite: list filters, search and stats', { skip: !hasSqlite }, async () => {
  const all = await db.listJobs();
  assert.ok(all.length >= 3);
  assert.ok(all.every((j, i) => i === 0 || all[i - 1].found_at >= j.found_at));
  assert.ok((await db.listJobs({ status: 'applied' })).every((j) => j.status === 'applied'));
  assert.equal((await db.listJobs({ search: 'initech' })).length >= 1, true);
  const s = await db.stats();
  assert.equal(s.total, all.length);
  assert.ok(Array.isArray(s.by_status));
});

test('sqlite: the CLI speaks the same commands', { skip: !hasSqlite }, () => {
  const cfg = join(dir, 'crek.config.json');
  writeFileSync(cfg, JSON.stringify({ version: 2, db: { backend: 'sqlite', path_or_url: 'crek.db' } }));
  const run = (...args) => spawnSync(process.execPath, [join(ASSETS, 'crek-db.mjs'), '--config', cfg, ...args], { encoding: 'utf8' });
  const add = run('jobs:add', JSON.stringify({ title: 'CLI job', status: 'new' }));
  assert.equal(add.status, 0, add.stderr);
  const { id } = JSON.parse(add.stdout);
  assert.equal(run('jobs:append', String(id), 'notes', '01.11.2026: first').status, 0);
  assert.equal(run('jobs:append', String(id), 'notes', '02.11.2026: second').status, 0);
  const job = JSON.parse(run('jobs:get', String(id)).stdout);
  assert.equal(job.notes, '01.11.2026: first\n02.11.2026: second');
  const bad = run('jobs:append', String(id), 'title', 'x');
  assert.equal(bad.status, 2);
  assert.equal(bad.stderr.includes('ExperimentalWarning'), false);
  const latest = JSON.parse(run('jobs:latest').stdout);
  assert.match(latest.found_at, /^\d{4}-/);
  assert.ok(existsSync(join(dir, 'crek.db')));
});

test('sqlite CLI: jobs:append takes "--" as the end of options', { skip: !hasSqlite }, () => {
  const cfg = join(dir, 'crek.config.json');
  writeFileSync(cfg, JSON.stringify({ version: 2, db: { backend: 'sqlite', path_or_url: 'crek.db' } }));
  const run = (...args) => spawnSync(process.execPath, [join(ASSETS, 'crek-db.mjs'), '--config', cfg, ...args], { encoding: 'utf8' });
  const { id } = JSON.parse(run('jobs:add', JSON.stringify({ title: 'Dash job' })).stdout);
  assert.equal(run('jobs:append', String(id), 'notes', '--', '-- quoted', '--help').status, 0);
  assert.equal(run('jobs:append', String(id), 'notes', '-x').status, 0, 'a single dash is text even without --');
  assert.equal(JSON.parse(run('jobs:get', String(id)).stdout).notes, '-- quoted --help\n-x');
  assert.equal(run('jobs:append', String(id), 'notes', '--note').status, 2, 'without --, a --word is an option');
});

test('types: whole numbers and YYYY-MM-DD dates on every backend; status is never cleared', { skip: !hasSqlite }, async () => {
  const id = await db.insertJob({ title: 'Typed', match_score: '7', salary_min_hour: 150 });
  assert.equal((await db.getJob(id)).match_score, 7, 'a string of digits is stored as a number');
  await assert.rejects(db.updateJob(id, { match_score: 'abc' }), /match_score must be a whole number, got "abc"/);
  await assert.rejects(db.updateJob(id, { salary_max_month: 12.5 }), /salary_max_month must be a whole number/);
  await assert.rejects(db.updateJob(id, { duplicate_of_id: 'x1' }), /duplicate_of_id must be a whole number/);
  await assert.rejects(db.updateJob(id, { applied_date: 'yesterday' }), /applied_date must be a date as YYYY-MM-DD/);
  await assert.rejects(db.updateJob(id, { response_date: '2026-02-30' }), /response_date must be a date/);
  await assert.rejects(db.insertJob({ title: 'x', my_rate_min: '150 PLN' }), /my_rate_min must be a whole number/);
  await assert.rejects(db.updateJob(id, { status: '' }), /status cannot be cleared/);
  await assert.rejects(db.updateJob(id, { status: null }), /status cannot be cleared/);
  assert.equal(await db.updateJob(id, { applied_date: '2026-11-03', match_score: '', my_rate_max: '180' }), true);
  const job = await db.getJob(id);
  assert.equal(job.applied_date, '2026-11-03');
  assert.equal(job.match_score, null, '"" still clears a number');
  assert.equal(job.my_rate_max, 180);
});

test('sqlite: init leaves the database file readable by its owner only', { skip: !hasSqlite }, () => {
  assert.equal(statSync(join(dir, 'crek.db')).mode & 0o777, 0o600);
});

test('status vocabulary is the ui.status.* keys of i18n.json', () => {
  const keys = Object.keys(loadI18n().en).filter((k) => k.startsWith('ui.status.')).map((k) => k.slice(10));
  assert.deepEqual(jobStatuses(), keys);
  assert.ok(keys.includes('new') && keys.includes('skipped') && keys.includes('closed'));
});

test('sqlite: an unknown status is refused with the allowed list', { skip: !hasSqlite }, async () => {
  await assert.rejects(db.insertJob({ title: 'x', status: 'bogus_status' }), /unknown status "bogus_status" — allowed: new, applied/);
  const id = await db.insertJob({ title: 'Status test', status: 'new' });
  await assert.rejects(db.updateJob(id, { status: 'Applied' }), /unknown status/);
  await assert.rejects(db.updateJob(id, { status: '' }), /status cannot be cleared — give one of: new, applied/);
  assert.equal(await db.updateJob(id, { status: 'skipped' }), true);
  assert.equal((await db.insertJob({ title: 'empty status means the default', status: '' })) > 0, true);
});

test('sqlite: appendJob is atomic — parallel appends keep every line', { skip: !hasSqlite }, async () => {
  const cfg = join(dir, 'crek.config.json');
  writeFileSync(cfg, JSON.stringify({ version: 2, db: { backend: 'sqlite', path_or_url: 'crek.db' } }));
  const id = await db.insertJob({ title: 'Parallel', communication: 'start  \n' });
  const runs = Array.from({ length: 8 }, (_, i) => new Promise((ok) => {
    const c = spawn(process.execPath, [join(ASSETS, 'crek-db.mjs'), '--config', cfg, 'jobs:append', String(id), 'communication', `03.11.2026: entry ${i}`]);
    c.on('close', ok);
  }));
  assert.deepEqual(await Promise.all(runs), Array(8).fill(0));
  const lines = (await db.getJob(id)).communication.split('\n');
  assert.equal(lines[0], 'start');
  assert.equal(lines.length, 9);
  for (let i = 0; i < 8; i++) assert.ok(lines.includes(`03.11.2026: entry ${i}`));
  assert.equal(await db.appendJob(99999, 'notes', 'x'), false);
  await assert.rejects(db.appendJob(id, 'title', 'x'), /jobs:append works on/);
});

test('sqlite CLI: --fields with an unknown column and driver errors are one-line errors', { skip: !hasSqlite }, () => {
  const cfg = join(dir, 'crek.config.json');
  writeFileSync(cfg, JSON.stringify({ version: 2, db: { backend: 'sqlite', path_or_url: 'crek.db' } }));
  const run = (args, env = {}) => spawnSync(process.execPath, [join(ASSETS, 'crek-db.mjs'), '--config', cfg, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  const f = run(['jobs:list', '--fields', 'id,title,nonexistent']);
  assert.equal(f.status, 2);
  assert.match(f.stderr, /unknown field\(s\) in --fields: nonexistent/);
  assert.equal(run(['jobs:list', '--fields', 'id,title,contact_names', '--limit', '1']).status, 0);
  const id = JSON.parse(run(['jobs:add', '{"title":"FK"}']).stdout).id;
  const fk = run(['jobs:update', String(id), '{"duplicate_of_id": 999999}']);
  assert.equal(fk.status, 1);
  assert.equal(fk.stderr.trim().split('\n').length, 1, fk.stderr);
  assert.match(fk.stderr, /^error: .*FOREIGN KEY/);
  const dbg = run(['jobs:update', String(id), '{"duplicate_of_id": 999999}'], { CREK_DEBUG: '1' });
  assert.ok(dbg.stderr.trim().split('\n').length > 1);
});
