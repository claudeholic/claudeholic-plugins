// SPDX-License-Identifier: GPL-3.0-only
// The mysql backend against a stand-in client (fixtures/fake-mysql.mjs): what is sent, how, and how
// the answer is read. No server is involved; a live MySQL / MariaDB is not part of these tests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb, sqlLiteral, parseMysqlUrl, DbError } from '../assets/crek-db.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-mysql.mjs', import.meta.url));
let dir;
let log;
let db;
const calls = () => readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'crek-test-mysql-'));
  log = join(dir, 'calls.jsonl');
  writeFileSync(log, '');
  process.env.FAKE_MYSQL_LOG = log;
  db = await openDb({ backend: 'mysql', path_or_url: 'mysql://crek@db.example:3307/crek_test?ssl=required', auth: 'crek:s3cr3t p@ss#"x\\y', client: FAKE });
});
after(() => { delete process.env.FAKE_MYSQL_LOG; rmSync(dir, { recursive: true, force: true }); });

test('parseMysqlUrl: host, port, database, user, password from auth', () => {
  const c = parseMysqlUrl('mysql://u1@h:3307/d?socket=/run/m.sock', 'u2:pw:with:colons');
  assert.deepEqual({ ...c }, { host: 'h', port: '3307', database: 'd', user: 'u2', password: 'pw:with:colons', ssl: null, socket: '/run/m.sock' });
  assert.throws(() => parseMysqlUrl('http://h/d'), DbError);
  assert.throws(() => parseMysqlUrl('mysql://h/'), DbError);
});

test('sqlLiteral: strings travel as hex, numbers as numbers', () => {
  assert.equal(sqlLiteral(null), 'NULL');
  assert.equal(sqlLiteral(12), '12');
  assert.equal(sqlLiteral(''), "''");
  assert.equal(sqlLiteral("x'); DROP TABLE jobs;--"), `CONVERT(X'${Buffer.from("x'); DROP TABLE jobs;--").toString('hex')}' USING utf8mb4)`);
  assert.throws(() => sqlLiteral(Infinity), DbError);
});

test('mysql: credentials go through a 0600 option file that is removed afterwards', async () => {
  await db.listJobs();
  const [c] = calls().slice(-1);
  assert.equal(c.first_arg_is_defaults, true);
  assert.equal(c.mode, '600');
  assert.match(c.options, /^password="s3cr3t p@ss#\\"x\\\\y"$/m, 'quoted: # is a comment in option files');
  assert.match(c.options, /^host="db\.example"$/m);
  assert.match(c.options, /^port=3307$/m);
  assert.ok(!c.args.some((a) => a.includes('s3cr3t')), 'password must not be on the command line');
  assert.ok(c.args.includes('--ssl'), 'ssl=required -> --ssl for a MariaDB client');
  assert.equal(c.args.at(-1), 'crek_test');
  assert.equal(existsSync(c.optFile), false);
});

test('mysql: rows come back as JSON objects, UTF-8 and newlines intact', async () => {
  const rows = await db.listJobs({ status: 'new', search: "it's" });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].title, 'Zażółć gęślą jaźń\nline two');
  assert.equal(rows[0].contact_ids, '3');
  const { sql } = calls().slice(-1)[0];
  assert.ok(!sql.includes("it's"), 'user text must not appear raw in the SQL');
  assert.ok(sql.includes(Buffer.from("%it's%").toString('hex')));
  assert.match(sql, /CAST\(j\.technologies AS CHAR\)/);
  assert.match(sql, /DATE_FORMAT\(j\.found_at, '%Y-%m-%d %H:%i:%s'\)/);
});

test('mysql: insert, update, delete, contacts, stats', async () => {
  assert.equal(await db.insertJob({ title: 'Robert"); DROP TABLE jobs;--', contact_ids: [3, '4'] }), 42);
  let { sql } = calls().slice(-1)[0];
  assert.ok(!sql.includes('DROP TABLE'));
  assert.match(sql, /INSERT IGNORE INTO job_contacts \(job_id, contact_id\) VALUES \(@crek_id, 4\)/);
  assert.equal(await db.updateJob(1, { status: 'applied', notes: '' }), true);
  ({ sql } = calls().slice(-1)[0]);
  assert.match(sql, /notes = NULL/);
  assert.equal(await db.deleteJob(1), true);
  assert.equal(await db.upsertContact({ name: 'Ann Lee', company_name: 'Initech', role: 'hr' }), 7);
  ({ sql } = calls().slice(-1)[0]);
  assert.ok(sql.includes(sqlLiteral('a@x')), 'stored email is kept when not given');
  const s = await db.stats();
  assert.equal(s.total, 2);
  assert.deepEqual(s.by_status, []);
});

test('mysql: append is one UPDATE (no read first); an unknown status never reaches the client', async () => {
  const before = calls().length;
  assert.equal(await db.appendJob(5, 'communication', "03.11.2026: it's sent"), true);
  const sent = calls().slice(before);
  assert.equal(sent.length, 1, 'one client call, no SELECT before the UPDATE');
  assert.match(sent[0].sql, /UPDATE jobs SET communication = IF\(communication IS NULL OR communication = '', CONVERT\(X'/);
  assert.match(sent[0].sql, /CONCAT\(RTRIM\(TRIM\(TRAILING CONVERT\(X'0a' USING utf8mb4\) FROM RTRIM\(communication\)\)\)/);
  assert.ok(!sent[0].sql.includes("it's"), 'the text travels as hex');
  await assert.rejects(db.appendJob(5, 'title', 'x'), /jobs:append works on/);
  const n = calls().length;
  await assert.rejects(db.updateJob(1, { status: 'sent' }), /unknown status "sent" — allowed: new, applied/);
  await assert.rejects(db.insertJob({ title: 'x', status: 'sent' }), /unknown status/);
  await assert.rejects(db.updateJob(1, { match_score: 'abc' }), /match_score must be a whole number/);
  await assert.rejects(db.insertJob({ title: 'x', applied_date: '03.11.2026' }), /applied_date must be a date as YYYY-MM-DD/);
  assert.equal(calls().length, n, 'refused before the client runs');
});

test('mysql: a client error becomes a readable DbError', async () => {
  process.env.FAKE_MYSQL_FAIL = '1';
  try { await assert.rejects(db.listJobs(), /fake syntax error/); } finally { delete process.env.FAKE_MYSQL_FAIL; }
});

test('mysql: a missing client is reported plainly', async () => {
  await assert.rejects(async () => {
    const x = await openDb({ backend: 'mysql', path_or_url: 'mysql://h/d', client: join(dir, 'no-such-client') });
    await x.listJobs();
  }, /cannot run/);
});
