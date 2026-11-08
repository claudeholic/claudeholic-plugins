// SPDX-License-Identifier: GPL-3.0-only
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../assets/crek-config-check.mjs', import.meta.url));
const SCHEMA = JSON.parse(readFileSync(fileURLToPath(new URL('../assets/crek.schema.json', import.meta.url)), 'utf8'));
let dir;

const BASE = {
  version: 2,
  candidate: { name: 'Jan Kowalski', email: 'jan@example.com' },
  criteria: { blockers: { contract_types: ['b2b'], min_rate: { amount: 150, unit: 'hour', currency: 'PLN' }, work_modes: ['remote'] } },
  cv: { master: 'cv.pdf', dir: 'CV' },
  db: { backend: 'http-api', path_or_url: 'https://crek.example.org/api.php' },
  presentation: { language: 'pl' },
  rate_policy: {},
};

function check(cfg) {
  const path = join(dir, 'crek.config.json');
  writeFileSync(path, JSON.stringify(cfg), { mode: 0o600 });
  const r = spawnSync(process.execPath, [SCRIPT, path], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout };
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'crek-test-config-'));
  writeFileSync(join(dir, 'cv.pdf'), '%PDF-1.4 test');
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('a config without the conduct block passes, with notes for both optional fields', () => {
  const { code, out } = check(BASE);
  assert.equal(code, 0, out);
  assert.match(out, /note\s+conduct\.ai_use_question is not set/);
  assert.match(out, /note\s+conduct\.account_creation is not set/);
});

test('conduct.account_creation: auto and ask are accepted, anything else is an error', () => {
  for (const v of ['auto', 'ask']) {
    const { code, out } = check({ ...BASE, conduct: { ai_use_question: 'ask', account_creation: v } });
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /account_creation/);
  }
  const { code, out } = check({ ...BASE, conduct: { account_creation: 'yes' } });
  assert.equal(code, 1);
  assert.match(out, /ERROR\s+conduct\.account_creation is "yes"/);
});

test('conduct.ai_use_question: an unknown value is an error', () => {
  const { code, out } = check({ ...BASE, conduct: { ai_use_question: 'lie' } });
  assert.equal(code, 1);
  assert.match(out, /ERROR\s+conduct\.ai_use_question/);
});

test('the schema documents both conduct fields with the same values as the check', () => {
  const c = SCHEMA.properties.conduct.properties;
  assert.deepEqual(c.account_creation.enum, ['auto', 'ask']);
  assert.deepEqual(c.ai_use_question.enum, ['truthful', 'user_answers', 'ask']);
  assert.equal(SCHEMA.properties.conduct.additionalProperties, false);
});

test('a missing config exits 2 and points at the bootstrap', () => {
  const r = spawnSync(process.execPath, [SCRIPT, join(dir, 'nope.json')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /bootstrap/);
});

function checkAt(cfg, { mode = 0o600, at = dir } = {}) {
  const path = join(at, 'crek.config.json');
  writeFileSync(path, JSON.stringify(cfg));
  chmodSync(path, mode);
  const r = spawnSync(process.execPath, [SCRIPT, path], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout };
}

test('db.backend: an unknown backend is an error; http-api needs an http(s) URL', () => {
  let r = check({ ...BASE, db: { backend: 'postgres', path_or_url: 'x' } });
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR\s+db\.backend is "postgres"/);
  r = check({ ...BASE, db: { backend: 'http-api', path_or_url: 'ftp://h/api.php', token: 'x'.repeat(64) } });
  assert.match(r.out, /ERROR\s+db\.path_or_url for http-api must be the http\(s\) URL/);
  r = check({ ...BASE, db: { backend: 'sqlite', path_or_url: 'sqlite://crek.db' } });
  assert.match(r.out, /ERROR\s+db\.path_or_url for sqlite is a file path/);
});

test('http-api: a missing db.token is a warning (old api.php still works), a short one too', () => {
  let r = check(BASE);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /WARNING\s+db\.token is not set/);
  r = check({ ...BASE, db: { ...BASE.db, token: 'short' } });
  assert.equal(r.code, 0);
  assert.match(r.out, /WARNING\s+db\.token has 5 characters/);
  r = check({ ...BASE, db: { ...BASE.db, token: 'f'.repeat(64) } });
  assert.doesNotMatch(r.out, /db\.token/);
  r = check({ ...BASE, db: { backend: 'http-api', path_or_url: 'http://crek.example.org/api.php', token: 'f'.repeat(64) } });
  assert.match(r.out, /WARNING\s+db\.path_or_url is plain http/);
});

test('criteria.blockers and cv.master: missing is an error', () => {
  const { criteria, ...noCriteria } = BASE;
  let r = check(noCriteria);
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR\s+missing criteria\.blockers/);
  r = check({ ...BASE, cv: { dir: 'CV' } });
  assert.match(r.out, /ERROR\s+missing cv\.master/);
  r = check({ ...BASE, cv: { master: 'nope.pdf', dir: 'CV' } });
  assert.match(r.out, /ERROR\s+cv\.master points at nope\.pdf, which does not exist/);
});

test('permissions: a config readable by others is always a warning (personal data), secrets or not', () => {
  const r = checkAt({ ...BASE, db: { ...BASE.db, token: 'f'.repeat(64) } }, { mode: 0o644 });
  assert.match(r.out, /WARNING\s+.*crek\.config\.json holds personal data and secrets but is mode 644 — chmod 600 it/);
  assert.doesNotMatch(checkAt({ ...BASE, db: { ...BASE.db, token: 'f'.repeat(64) } }).out, /holds personal data/);
  const plain = checkAt({ ...BASE }, { mode: 0o644 });
  assert.match(plain.out, /WARNING\s+.*crek\.config\.json holds personal data but is mode 644 — chmod 600 it/);
});

test('sqlite: a database file readable by others is a warning', () => {
  const sub = mkdtempSync(join(dir, 'sqlite-'));
  writeFileSync(join(sub, 'cv.pdf'), '%PDF-1.4 test');
  writeFileSync(join(sub, 'crek.db'), '');
  const cfg = { ...BASE, db: { backend: 'sqlite', path_or_url: 'crek.db' } };
  chmodSync(join(sub, 'crek.db'), 0o644);
  assert.match(checkAt(cfg, { at: sub }).out, /WARNING\s+the sqlite database .*crek\.db is mode 644 — other users can read it/);
  chmodSync(join(sub, 'crek.db'), 0o600);
  assert.doesNotMatch(checkAt(cfg, { at: sub }).out, /other users can read it/);
});

test('git: a tracked config is a warning', { skip: spawnSync('git', ['--version']).status !== 0 && 'no git' }, () => {
  const repo = mkdtempSync(join(dir, 'repo-'));
  writeFileSync(join(repo, 'cv.pdf'), '%PDF-1.4 test');
  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q');
  let r = checkAt(BASE, { at: repo });
  assert.doesNotMatch(r.out, /git tracks/);
  git('add', 'crek.config.json');
  r = checkAt(BASE, { at: repo });
  assert.match(r.out, /WARNING\s+git tracks crek\.config\.json — personal data and passwords do not belong in a repository/);
});

test('browser.browsers and mail: optional notes when missing, errors when wrong', () => {
  let r = check(BASE);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /note\s+browser\.browsers is not set/);
  assert.match(r.out, /note\s+mail is not set/);
  r = check({ ...BASE,
    browser: { browsers: [{ name: 'chrome-shared', type: 'chrome-shared' }, { name: 'Chromium', type: 'cdp', cdp_port: 9333 }] },
    mail: { access: 'mcp', tool_prefix: 'mcp__mail__', read_verification_codes: true } });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /browser\.browsers|mail /);
  r = check({ ...BASE, browser: { browsers: [{ name: 'Chromium', type: 'cdp' }] }, mail: { access: 'imap' } });
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR\s+browser\.browsers\[0\] is a cdp browser without cdp_port/);
  assert.match(r.out, /ERROR\s+mail\.access is "imap"/);
});

test('boards: a listing with an unknown stop rule is an error, a known one passes', () => {
  let r = check({ ...BASE, boards: { override: { justjoin: { listing: { stop_rule: 'time_filter' } } } } });
  assert.equal(r.code, 0, r.out);
  r = check({ ...BASE, boards: { extra: [{ key: 'acme_jobs', name: 'Acme Jobs', url: 'https://jobs.example.org', listing: { stop_rule: 'whenever' } }] } });
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR\s+boards\.extra\[0\]\.listing\.stop_rule is "whenever"/);
});
