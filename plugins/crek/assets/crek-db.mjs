#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
/**
 * crek-db — one way to read and write the job pipeline, whatever holds it.
 *
 *   node crek-db.mjs --config crek.config.json jobs:list --status new
 *   echo '{"title":"...","status":"new"}' | node crek-db.mjs --config crek.config.json jobs:add
 *   node crek-db.mjs --config crek.config.json jobs:append 1169 notes "02.11.2026: skipped without review"
 *
 * Three backends, chosen by db.backend in crek.config.json, with the same commands and the same
 * row shape (job columns + contact_ids "1,2" + contact_names "A||B", newest found_at first):
 *
 *   sqlite    db.path_or_url = a file path (relative paths are relative to crek.config.json).
 *             Node's built-in node:sqlite — Node >= 22.13, nothing to install.
 *   mysql     db.path_or_url = mysql://[user@]host[:port]/database[?ssl=required|socket=/path],
 *             db.auth = "user:password". Runs the system client (mariadb or mysql, or db.client);
 *             credentials go through a private temporary option file, never the command line.
 *   http-api  db.path_or_url = the URL of api.php (the bundled CREK web app, assets/crek-php),
 *             db.token = the API token (sent as X-Crek-Token; api.php >= crek 1.10 requires it),
 *             db.auth = "user:password" when the web server adds HTTP basic auth in front of it.
 *
 * The plugin installs no packages: the only programs used are Node itself and, for mysql, the
 * database client the system already has. Writes follow the http-api contract (schema.sql §API):
 * jobs:add drops empty strings, jobs:update turns them into NULL (except status, which always needs
 * a value), contact_ids replaces a job's links, status must be one of the ui.status.* keys of
 * assets/i18n.json, jobs:append is one atomic UPDATE. Types are checked here, the same for every
 * backend: whole numbers in JOB_INTEGER, YYYY-MM-DD dates in JOB_DATE (SQLite would store anything).
 *
 * Also a module: crek-match.mjs and crek-dedupe-check.mjs read the pipeline through openDb().
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { resolve, dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadI18n } from './crek-i18n.mjs';

export const JOB_FIELDS = ['title', 'agency', 'hiring_company', 'source', 'source_url', 'apply_url', 'location',
  'work_mode', 'salary_min_hour', 'salary_max_hour', 'salary_min_month', 'salary_max_month',
  'salary_currency', 'seniority', 'technologies', 'description', 'match_score', 'cv_dir', 'status',
  'applied_date', 'response_date', 'my_rate_min', 'my_rate_max', 'my_rate_unit',
  'my_rate_currency', 'duplicate_of_id', 'notes', 'communication', 'meetings'];
const JOB_READ_ONLY = ['id', 'found_at', 'updated_at', 'contact_names'];
const JOB_DATE = new Set(['applied_date', 'response_date']);
const JOB_INTEGER = new Set(['salary_min_hour', 'salary_max_hour', 'salary_min_month', 'salary_max_month',
  'match_score', 'my_rate_min', 'my_rate_max', 'duplicate_of_id']);
export const CONTACT_FIELDS = ['name', 'company_name', 'role', 'phone', 'email', 'linkedin_url', 'notes'];
const SEARCH_COLS = ['title', 'hiring_company', 'agency', 'technologies', 'description', 'notes', 'source_url', 'apply_url'];
export const APPEND_FIELDS = ['notes', 'communication', 'meetings', 'description'];
/** Columns a job row comes back with (jobs:list --fields picks from these). */
export const JOB_COLUMNS = ['id', ...JOB_FIELDS, 'found_at', 'updated_at', 'contact_ids', 'contact_names'];
export const BACKENDS = ['sqlite', 'mysql', 'http-api'];

/** The status vocabulary: the ui.status.* keys of assets/i18n.json — one list for the plugin,
 *  api.php and the web UI. Labels per language live next to them; the stored value is the key. */
export function jobStatuses() {
  const keys = Object.keys(loadI18n().en ?? {}).filter((k) => k.startsWith('ui.status.'));
  return keys.map((k) => k.slice('ui.status.'.length));
}

const SCHEMA_DIR = fileURLToPath(new URL('../skills/apply/references/', import.meta.url));

export class DbError extends Error {}

// ---------------------------------------------------------------- configuration

/** {db, baseDir} from crek.config.json, or from --api/--auth overrides (http-api), or CREK_API.
 *  With --api / CREK_API the token comes from env CREK_TOKEN (never from the command line). */
export function resolveDb({ config, api, auth } = {}) {
  const token = process.env.CREK_TOKEN || undefined;
  if (api) return { db: { backend: 'http-api', path_or_url: api, auth: auth ?? process.env.CREK_AUTH, token }, baseDir: process.cwd() };
  if (config) {
    const path = resolve(config);
    let cfg;
    try { cfg = JSON.parse(readFileSync(path, 'utf8')); } catch (err) { throw new DbError(`cannot read ${path}: ${err.message}`); }
    if (!cfg?.db || typeof cfg.db !== 'object') throw new DbError(`${path} has no db block`);
    return { db: { ...cfg.db, auth: auth ?? cfg.db.auth }, baseDir: dirname(path), language: cfg.presentation?.language };
  }
  if (process.env.CREK_API) return { db: { backend: 'http-api', path_or_url: process.env.CREK_API, auth: auth ?? process.env.CREK_AUTH, token }, baseDir: process.cwd() };
  throw new DbError('no database: pass --config crek.config.json (or --api <url> for an http-api)');
}

/** Open the pipeline described by a db block. All methods are async. */
export async function openDb(db, { baseDir = process.cwd(), create = false } = {}) {
  const backend = db?.backend;
  if (!backend) throw new DbError('db.backend is not set (sqlite, mysql or http-api)');
  if (!db.path_or_url) throw new DbError('db.path_or_url is not set');
  if (backend === 'sqlite') return sqliteBackend(resolve(baseDir, db.path_or_url), { create });
  if (backend === 'mysql') return mysqlBackend(db);
  if (backend === 'http-api') return httpBackend(db.path_or_url, db.auth, db.token);
  throw new DbError(`unknown db.backend "${backend}" — expected ${BACKENDS.join(', ')}`);
}

// ---------------------------------------------------------------- input normalisation (shared)

function checkFields(data, allowed, ignored = []) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new DbError('expected a JSON object');
  const unknown = Object.keys(data).filter((k) => !allowed.includes(k) && !ignored.includes(k));
  if (unknown.length) throw new DbError(`unknown field(s): ${unknown.join(', ')} — allowed: ${allowed.join(', ')}`);
}

/** status must be a known identifier (jobStatuses()); null / '' only where the caller drops them.
 *  jobs:update never clears it: "" / null there is an error, not NULL. */
function checkStatus(data) {
  if (!('status' in data) || data.status === undefined) return;
  const allowed = jobStatuses();
  if (!allowed.length) throw new DbError('cannot read the status list (ui.status.* in assets/i18n.json)');
  if (data.status === '' || data.status === null) {
    throw new DbError(`status cannot be cleared — give one of: ${allowed.join(', ')}`);
  }
  if (!allowed.includes(String(data.status))) {
    throw new DbError(`unknown status ${JSON.stringify(data.status)} — allowed: ${allowed.join(', ')}`);
  }
}

/** Whole numbers (a number or a string of digits) and real YYYY-MM-DD dates; '' and null pass
 *  (the caller drops them or writes NULL). Returns data with the numbers as numbers. */
function checkTypes(data) {
  const out = { ...data };
  for (const f of Object.keys(data)) {
    const v = data[f];
    if (v === '' || v === null || v === undefined) continue;
    if (JOB_INTEGER.has(f)) {
      const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : NaN);
      if (!Number.isSafeInteger(n)) throw new DbError(`${f} must be a whole number, got ${JSON.stringify(v)}`);
      out[f] = n;
    } else if (JOB_DATE.has(f)) {
      if (!isIsoDate(v)) throw new DbError(`${f} must be a date as YYYY-MM-DD, got ${JSON.stringify(v)}`);
    }
  }
  return out;
}

function isIsoDate(v) {
  const m = typeof v === 'string' && v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function jobValue(field, value) {
  if (value === undefined || value === null) return null;
  if (field === 'technologies' && typeof value !== 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

/** jobs:add — empty strings are absent (http-api contract). */
function insertColumns(input) {
  checkFields(input, [...JOB_FIELDS, 'contact_ids'], JOB_READ_ONLY);
  if (input.status !== null && input.status !== '') checkStatus(input);
  const data = checkTypes(input);
  const cols = [];
  const vals = [];
  for (const f of JOB_FIELDS) {
    if (data[f] === undefined || data[f] === null || data[f] === '') continue;
    cols.push(f);
    vals.push(jobValue(f, data[f]));
  }
  if (!cols.length) throw new DbError('nothing to insert: give at least one job field (title, source_url, ...)');
  return { cols, vals, contactIds: contactIdList(data.contact_ids) };
}

/** jobs:update — empty strings become NULL (http-api contract), except status (always a value). */
function updateColumns(input) {
  checkFields(input, [...JOB_FIELDS, 'contact_ids'], JOB_READ_ONLY);
  checkStatus(input);
  const data = checkTypes(input);
  const cols = [];
  const vals = [];
  for (const f of JOB_FIELDS) {
    if (!(f in data)) continue;
    cols.push(f);
    vals.push(data[f] === '' ? null : jobValue(f, data[f]));
  }
  return { cols, vals, contactIds: 'contact_ids' in data ? contactIdList(data.contact_ids) : null };
}

function contactIdList(value) {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(list.map((x) => Number(String(x).trim())).filter((n) => Number.isInteger(n) && n > 0))];
}

function contactRow(data, { partial = false } = {}) {
  checkFields(data, CONTACT_FIELDS, ['id', 'job_count']);
  if (!partial && (!data.name || !data.company_name)) throw new DbError('a contact needs name and company_name');
  const row = {};
  for (const f of CONTACT_FIELDS) if (f in data) row[f] = data[f] === '' ? null : data[f];
  return row;
}

/** contacts:upsert changes only the fields it is given: absent ones keep what an existing row has. */
function withStored(row, stored) {
  if (!stored) return row;
  const out = { ...row };
  for (const f of CONTACT_FIELDS) if (!(f in out)) out[f] = stored[f] ?? null;
  return out;
}

/** jobs:append arguments: a log field and a non-empty text. */
function appendArgs(field, text) {
  if (!APPEND_FIELDS.includes(field)) throw new DbError(`jobs:append works on ${APPEND_FIELDS.join(', ')}, not ${field}`);
  const t = String(text ?? '').trim();
  if (!t) throw new DbError('jobs:append needs the text to append');
  return t;
}

function positiveId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new DbError(`not a row id: ${id}`);
  return n;
}

// ---------------------------------------------------------------- sqlite (node:sqlite)

function nodeHasSqlite() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  return maj > 23 || (maj === 23 && min >= 4) || (maj === 22 && min >= 13);
}

/** node:sqlite prints an ExperimentalWarning on load; the skills read stderr, so drop that one. */
function quietSqliteWarning() {
  const listeners = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    if (w?.name === 'ExperimentalWarning' && /sqlite/i.test(String(w.message))) return;
    for (const l of listeners) l(w);
  });
}

async function sqliteBackend(file, { create }) {
  if (!nodeHasSqlite()) {
    throw new DbError(`the sqlite backend needs Node >= 22.13 (built-in node:sqlite); this is Node ${process.versions.node}`);
  }
  if (!create && !existsSync(file)) throw new DbError(`${file} does not exist — create it with: node crek-db.mjs --config crek.config.json init`);
  quietSqliteWarning();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  try { db.exec('PRAGMA journal_mode = WAL'); } catch { /* read-only medium: keep the default journal */ }
  const all = (sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
  const get = (sql, ...p) => { const r = db.prepare(sql).get(...p); return r ? { ...r } : null; };
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (err) { db.exec('ROLLBACK'); throw err; }
  };
  const link = (jobId, ids) => {
    const st = db.prepare('INSERT OR IGNORE INTO job_contacts (job_id, contact_id) VALUES (?, ?)');
    for (const c of ids) st.run(jobId, c);
  };
  const JOBS_SELECT = `SELECT j.*, GROUP_CONCAT(c.id) AS contact_ids, GROUP_CONCAT(c.name, '||') AS contact_names
    FROM jobs j LEFT JOIN job_contacts jc ON j.id = jc.job_id LEFT JOIN contacts c ON jc.contact_id = c.id`;

  return {
    kind: 'sqlite',
    where: file,
    async init() {
      db.exec(readFileSync(join(SCHEMA_DIR, 'schema.sqlite.sql'), 'utf8'));
      // The file holds the whole job hunt, contacts' phone numbers included: owner only.
      try { chmodSync(file, 0o600); } catch { /* a filesystem without modes; crek-config-check warns */ }
      return { ok: true, file };
    },
    async listJobs({ status, search } = {}) {
      const where = [];
      const params = [];
      if (status && status !== 'all') { where.push('j.status = ?'); params.push(status); }
      if (search) {
        where.push(`(${SEARCH_COLS.map((c) => `j.${c} LIKE ?`).join(' OR ')})`);
        params.push(...SEARCH_COLS.map(() => `%${search}%`));
      }
      return all(`${JOBS_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} GROUP BY j.id ORDER BY j.found_at DESC`, ...params);
    },
    async getJob(id) {
      return get(`${JOBS_SELECT} WHERE j.id = ? GROUP BY j.id`, positiveId(id));
    },
    async insertJob(data) {
      const { cols, vals, contactIds } = insertColumns(data);
      return tx(() => {
        const r = run(`INSERT INTO jobs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...vals);
        const id = Number(r.lastInsertRowid);
        link(id, contactIds);
        return id;
      });
    },
    async updateJob(id, data) {
      const jobId = positiveId(id);
      const { cols, vals, contactIds } = updateColumns(data);
      return tx(() => {
        if (!get('SELECT id FROM jobs WHERE id = ?', jobId)) return false;
        if (cols.length) run(`UPDATE jobs SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...vals, jobId);
        if (contactIds) { run('DELETE FROM job_contacts WHERE job_id = ?', jobId); link(jobId, contactIds); }
        return true;
      });
    },
    async appendJob(id, field, text) {
      const t = appendArgs(field, text);
      // One statement: two writers appending at once both keep their line.
      return run(`UPDATE jobs SET ${field} = CASE WHEN ${field} IS NULL OR ${field} = '' THEN ?
        ELSE rtrim(${field}, char(32, 9, 10, 13)) || char(10) || ? END WHERE id = ?`, t, t, positiveId(id)).changes > 0;
    },
    async deleteJob(id) {
      return run('DELETE FROM jobs WHERE id = ?', positiveId(id)).changes > 0;
    },
    async listContacts() {
      return all(`SELECT c.*, COUNT(jc.job_id) AS job_count FROM contacts c
        LEFT JOIN job_contacts jc ON c.id = jc.contact_id GROUP BY c.id ORDER BY c.name`);
    },
    async upsertContact(data) {
      let row = contactRow(data);
      row = withStored(row, get('SELECT * FROM contacts WHERE name = ? AND company_name = ?', row.name, row.company_name));
      const vals = CONTACT_FIELDS.map((f) => row[f] ?? null);
      run(`INSERT INTO contacts (${CONTACT_FIELDS.join(', ')}) VALUES (${CONTACT_FIELDS.map(() => '?').join(', ')})
        ON CONFLICT(name, company_name) DO UPDATE SET role = excluded.role, phone = excluded.phone,
        email = excluded.email, linkedin_url = excluded.linkedin_url, notes = excluded.notes`, ...vals);
      return get('SELECT id FROM contacts WHERE name = ? AND company_name = ?', row.name, row.company_name).id;
    },
    async updateContact(id, data) {
      const row = contactRow(data, { partial: true });
      const cols = Object.keys(row);
      const cid = positiveId(id);
      if (!get('SELECT id FROM contacts WHERE id = ?', cid)) return false;
      if (cols.length) run(`UPDATE contacts SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => row[c]), cid);
      return true;
    },
    async deleteContact(id) {
      return run('DELETE FROM contacts WHERE id = ?', positiveId(id)).changes > 0;
    },
    async linkContacts(jobId, ids) {
      const jid = positiveId(jobId);
      if (!get('SELECT id FROM jobs WHERE id = ?', jid)) return false;
      tx(() => link(jid, contactIdList(ids)));
      return true;
    },
    async stats() {
      return {
        total: get('SELECT COUNT(*) AS n FROM jobs').n,
        by_status: all('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status'),
        by_source: all('SELECT source, COUNT(*) AS count FROM jobs GROUP BY source ORDER BY count DESC'),
        avg_match: get('SELECT ROUND(AVG(CASE WHEN match_score > 10 THEN match_score / 10.0 ELSE match_score END), 1) AS a FROM jobs WHERE match_score IS NOT NULL').a,
        contacts_count: get('SELECT COUNT(*) AS n FROM contacts').n,
      };
    },
    async close() { db.close(); },
  };
}

// ---------------------------------------------------------------- mysql (system client)

/** mysql://[user[:password]@]host[:port]/database[?ssl=required&socket=/path] */
export function parseMysqlUrl(url, auth) {
  let u;
  try { u = new URL(url); } catch { throw new DbError(`db.path_or_url for mysql must look like mysql://user@host:3306/database — got "${url}"`); }
  if (!/^(mysql|mariadb):$/.test(u.protocol)) throw new DbError(`db.path_or_url for mysql must start with mysql:// — got "${u.protocol}"`);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new DbError('db.path_or_url for mysql must name the database: mysql://user@host/database');
  let user = decodeURIComponent(u.username || '');
  let password = decodeURIComponent(u.password || '');
  if (auth) {
    const i = String(auth).indexOf(':');
    const au = i < 0 ? String(auth) : String(auth).slice(0, i);
    if (au) user = au;
    if (i >= 0) password = String(auth).slice(i + 1);
  }
  return {
    host: u.hostname || 'localhost', port: u.port || null, database, user, password,
    ssl: u.searchParams.get('ssl'), socket: u.searchParams.get('socket'),
  };
}

function findClient(configured) {
  const wanted = configured || process.env.CREK_MYSQL_CLIENT;
  if (wanted) return wanted;
  for (const name of ['mariadb', 'mysql']) {
    for (const dir of String(process.env.PATH ?? '').split(delimiter)) {
      if (dir && existsSync(join(dir, name))) return join(dir, name);
    }
  }
  throw new DbError('the mysql backend needs the MySQL or MariaDB command-line client (mysql / mariadb) — install it (e.g. apt install mariadb-client) or set db.client');
}

/** SQL literal. Strings travel as hex, so nothing inside them can break out of the literal. */
export function sqlLiteral(value) {
  if (value === undefined || value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DbError(`not a finite number: ${value}`);
    return String(value);
  }
  if (typeof value === 'bigint') return String(value);
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (s === '') return "''";
  return `CONVERT(X'${Buffer.from(s, 'utf8').toString('hex')}' USING utf8mb4)`;
}

function mysqlBackend(db) {
  const conn = parseMysqlUrl(db.path_or_url, db.auth);
  const client = findClient(db.client);
  let flavour = null;

  function sslArgs() {
    if (!conn.ssl || /^(0|false|off|disabled?)$/i.test(conn.ssl)) return [];
    if (flavour === null) {
      const v = spawnSync(client, ['--version'], { encoding: 'utf8' });
      flavour = /mariadb/i.test(`${v.stdout}${v.stderr}`) ? 'mariadb' : 'mysql';
    }
    return flavour === 'mariadb' ? ['--ssl'] : ['--ssl-mode=REQUIRED'];
  }

  /** Run SQL through the client; returns stdout lines. Credentials go in a 0600 file in a 0700 dir. */
  function exec(sql) {
    const dir = mkdtempSync(join(tmpdir(), 'crek-db-'));
    const opts = join(dir, 'client.cnf');
    try {
      // Values are quoted: an unquoted "#" starts a comment anywhere on an option-file line.
      const q = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      if ([conn.user, conn.password, conn.host, conn.socket].some((v) => /[\n\r]/.test(String(v ?? '')))) {
        throw new DbError('mysql credentials must not contain line breaks');
      }
      const lines = ['[client]', `user=${q(conn.user)}`, `password=${q(conn.password)}`, 'default-character-set=utf8mb4'];
      if (conn.socket) lines.push(`socket=${q(conn.socket)}`);
      else lines.push(`host=${q(conn.host)}`, ...(conn.port ? [`port=${Number(conn.port)}`] : []));
      writeFileSync(opts, `${lines.join('\n')}\n`, { mode: 0o600 });
      const r = spawnSync(client, [`--defaults-extra-file=${opts}`, '--batch', '--raw', '--skip-column-names',
        ...sslArgs(), conn.database], { input: `SET SESSION group_concat_max_len = 1048576;\n${sql}\n`, encoding: 'utf8', maxBuffer: 512 << 20, timeout: 120000 });
      if (r.error) throw new DbError(`cannot run ${client}: ${r.error.message}`);
      if (r.status !== 0) throw new DbError(`${client} failed: ${String(r.stderr).trim().split('\n').slice(-3).join(' ')}`);
      return String(r.stdout).split('\n').filter((l) => l !== '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const jsonRows = (sql) => exec(sql).filter((l) => l !== 'NULL').map((l) => JSON.parse(l));
  const scalar = (sql) => { const out = exec(sql); return out.length ? out[out.length - 1] : null; };

  const DT = (c) => `DATE_FORMAT(${c}, '%Y-%m-%d %H:%i:%s')`;
  const D = (c) => `DATE_FORMAT(${c}, '%Y-%m-%d')`;
  const jobJson = ['id', ...JOB_FIELDS, 'found_at', 'updated_at'].map((f) => {
    let expr = `j.${f}`;
    if (f === 'technologies') expr = `CAST(j.${f} AS CHAR)`;
    else if (JOB_DATE.has(f)) expr = D(`j.${f}`);
    else if (f === 'found_at' || f === 'updated_at') expr = DT(`j.${f}`);
    return `'${f}', ${expr}`;
  }).join(', ');
  const JOBS_SELECT = `SELECT JSON_OBJECT(${jobJson}, 'contact_ids', GROUP_CONCAT(c.id), 'contact_names', GROUP_CONCAT(c.name SEPARATOR '||'))
    FROM jobs j LEFT JOIN job_contacts jc ON j.id = jc.job_id LEFT JOIN contacts c ON jc.contact_id = c.id`;
  const linkSql = (jobExpr, ids) => ids.map((c) => `INSERT IGNORE INTO job_contacts (job_id, contact_id) VALUES (${jobExpr}, ${sqlLiteral(c)});`).join('\n');

  return {
    kind: 'mysql',
    where: `${conn.user ? `${conn.user}@` : ''}${conn.socket ?? conn.host}${conn.port ? `:${conn.port}` : ''}/${conn.database}`,
    async init() {
      exec(readFileSync(join(SCHEMA_DIR, 'schema.sql'), 'utf8'));
      return { ok: true };
    },
    async listJobs({ status, search } = {}) {
      const where = [];
      if (status && status !== 'all') where.push(`j.status = ${sqlLiteral(status)}`);
      if (search) where.push(`(${SEARCH_COLS.map((c) => `j.${c} LIKE ${sqlLiteral(`%${search}%`)}`).join(' OR ')})`);
      return jsonRows(`${JOBS_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} GROUP BY j.id ORDER BY j.found_at DESC;`);
    },
    async getJob(id) {
      return jsonRows(`${JOBS_SELECT} WHERE j.id = ${positiveId(id)} GROUP BY j.id;`)[0] ?? null;
    },
    async insertJob(data) {
      const { cols, vals, contactIds } = insertColumns(data);
      return Number(scalar(`START TRANSACTION;
INSERT INTO jobs (${cols.join(', ')}) VALUES (${vals.map(sqlLiteral).join(', ')});
SET @crek_id = LAST_INSERT_ID();
${linkSql('@crek_id', contactIds)}
COMMIT;
SELECT @crek_id;`));
    },
    async updateJob(id, data) {
      const jobId = positiveId(id);
      const { cols, vals, contactIds } = updateColumns(data);
      const found = Number(scalar(`SELECT COUNT(*) FROM jobs WHERE id = ${jobId};`));
      if (!found) return false;
      const parts = ['START TRANSACTION;'];
      if (cols.length) parts.push(`UPDATE jobs SET ${cols.map((c, i) => `${c} = ${sqlLiteral(vals[i])}`).join(', ')} WHERE id = ${jobId};`);
      if (contactIds) parts.push(`DELETE FROM job_contacts WHERE job_id = ${jobId};`, linkSql(String(jobId), contactIds));
      parts.push('COMMIT;');
      exec(parts.join('\n'));
      return true;
    },
    async appendJob(id, field, text) {
      const t = sqlLiteral(appendArgs(field, text));
      // One statement: two writers appending at once both keep their line.
      return Number(scalar(`UPDATE jobs SET ${field} = IF(${field} IS NULL OR ${field} = '', ${t},
  CONCAT(RTRIM(TRIM(TRAILING ${sqlLiteral('\n')} FROM RTRIM(${field}))), ${sqlLiteral('\n')}, ${t})) WHERE id = ${positiveId(id)};
SELECT ROW_COUNT();`)) > 0;
    },
    async deleteJob(id) {
      return Number(scalar(`DELETE FROM jobs WHERE id = ${positiveId(id)}; SELECT ROW_COUNT();`)) > 0;
    },
    async listContacts() {
      const cols = ['id', ...CONTACT_FIELDS].map((f) => `'${f}', c.${f}`).join(', ');
      return jsonRows(`SELECT JSON_OBJECT(${cols}, 'job_count', COUNT(jc.job_id)) FROM contacts c
        LEFT JOIN job_contacts jc ON c.id = jc.contact_id GROUP BY c.id ORDER BY c.name;`);
    },
    async upsertContact(data) {
      let row = contactRow(data);
      const cols = ['id', ...CONTACT_FIELDS].map((f) => `'${f}', ${f}`).join(', ');
      row = withStored(row, jsonRows(`SELECT JSON_OBJECT(${cols}) FROM contacts WHERE name = ${sqlLiteral(row.name)} AND company_name = ${sqlLiteral(row.company_name)};`)[0]);
      return Number(scalar(`INSERT INTO contacts (${CONTACT_FIELDS.join(', ')}) VALUES (${CONTACT_FIELDS.map((f) => sqlLiteral(row[f])).join(', ')})
ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), role = VALUES(role), phone = VALUES(phone), email = VALUES(email), linkedin_url = VALUES(linkedin_url), notes = VALUES(notes);
SELECT LAST_INSERT_ID();`));
    },
    async updateContact(id, data) {
      const row = contactRow(data, { partial: true });
      const cid = positiveId(id);
      const cols = Object.keys(row);
      const found = Number(scalar(`SELECT COUNT(*) FROM contacts WHERE id = ${cid};`));
      if (!found) return false;
      if (cols.length) exec(`UPDATE contacts SET ${cols.map((c) => `${c} = ${sqlLiteral(row[c])}`).join(', ')} WHERE id = ${cid};`);
      return true;
    },
    async deleteContact(id) {
      return Number(scalar(`DELETE FROM contacts WHERE id = ${positiveId(id)}; SELECT ROW_COUNT();`)) > 0;
    },
    async linkContacts(jobId, ids) {
      const jid = positiveId(jobId);
      if (!Number(scalar(`SELECT COUNT(*) FROM jobs WHERE id = ${jid};`))) return false;
      const list = contactIdList(ids);
      if (list.length) exec(linkSql(String(jid), list));
      return true;
    },
    async stats() {
      const [r] = jsonRows(`SELECT JSON_OBJECT(
  'total', (SELECT COUNT(*) FROM jobs),
  'by_status', (SELECT JSON_ARRAYAGG(JSON_OBJECT('status', status, 'count', n)) FROM (SELECT status, COUNT(*) AS n FROM jobs GROUP BY status) s),
  'by_source', (SELECT JSON_ARRAYAGG(JSON_OBJECT('source', source, 'count', n)) FROM (SELECT source, COUNT(*) AS n FROM jobs GROUP BY source ORDER BY n DESC) s),
  'avg_match', (SELECT ROUND(AVG(CASE WHEN match_score > 10 THEN match_score / 10.0 ELSE match_score END), 1) FROM jobs WHERE match_score IS NOT NULL),
  'contacts_count', (SELECT COUNT(*) FROM contacts));`);
      return { ...r, by_status: r?.by_status ?? [], by_source: r?.by_source ?? [] };
    },
    async close() {},
  };
}

// ---------------------------------------------------------------- http-api (the bundled api.php)

function httpBackend(base, auth, token) {
  const headers = {};
  if (auth) headers.Authorization = `Basic ${Buffer.from(String(auth)).toString('base64')}`;
  // Its own header: Authorization belongs to the web server's basic auth, when there is one.
  if (token) headers['X-Crek-Token'] = String(token);
  let shown;
  try { const u = new URL(base); u.username = ''; u.password = ''; shown = `${u.origin}${u.pathname}`; } catch { throw new DbError(`db.path_or_url for http-api must be the URL of api.php — got "${base}"`); }

  async function call(method, route, { body, params } = {}) {
    const u = new URL(base);
    u.searchParams.set('route', route);
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    const init = { method, headers: { ...headers, Accept: 'application/json' }, signal: AbortSignal.timeout(120000) };
    if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    let res;
    try { res = await fetch(u, init); } catch (err) { throw new DbError(`pipeline unreachable (${shown}): ${err.cause?.message ?? err.message}`); }
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch {
      throw new DbError(`pipeline returned HTTP ${res.status} with ${res.headers.get('content-type') ?? 'no content type'}, not JSON (${shown}, route ${route})`);
    }
    return { status: res.status, ok: res.ok, json };
  }
  function failure(r, method, route) {
    const hint = r.status === 401 && !token ? ' — set db.token in crek.config.json (api.php >= crek 1.10 requires it)' : '';
    return new DbError(`pipeline returned HTTP ${r.status} for ${method} ${route}${r.json?.error ? `: ${r.json.error}` : ''}${hint}`);
  }
  async function must(method, route, opts) {
    const r = await call(method, route, opts);
    if (!r.ok) throw failure(r, method, route);
    return r.json;
  }
  const rows = (body) => (Array.isArray(body) ? body : (body?.data ?? body?.jobs ?? []));

  const self = {
    kind: 'http-api',
    where: shown,
    async init() { throw new DbError('http-api: the tables live on the server — create them there from schema.sql (MySQL) or schema.sqlite.sql'); },
    async listJobs({ status, search } = {}) {
      return rows(await must('GET', 'jobs', { params: { status: status && status !== 'all' ? status : undefined, search } }));
    },
    async getJob(id) {
      const jid = positiveId(id);
      const r = await call('GET', `jobs/${jid}`);
      if (r.ok && r.json && !Array.isArray(r.json)) return r.json;
      if (r.status === 404 && r.json?.error === 'no such job') return null;
      if (r.status !== 404) throw failure(r, 'GET', `jobs/${jid}`);
      // api.php before crek 1.9 has no single-job route: find the row in the full list.
      return (await self.listJobs()).find((j) => Number(j.id) === jid) ?? null;
    },
    async insertJob(data) {
      const { cols, vals, contactIds } = insertColumns(data);
      const body = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
      if (contactIds.length) body.contact_ids = contactIds;
      return Number((await must('POST', 'jobs', { body })).id);
    },
    async updateJob(id, data) {
      const jid = positiveId(id);
      const { cols, vals, contactIds } = updateColumns(data);
      const body = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
      if (contactIds) {
        body.contact_ids = contactIds;
        // api.php before crek 1.9 fails on a PUT that carries contact_ids alone (empty SET).
        if (!cols.length) {
          const job = await self.getJob(jid);
          if (!job) return false;
          body.status = job.status;
        }
      }
      if (!Object.keys(body).length) return Boolean(await self.getJob(jid));
      const r = await call('PUT', `jobs/${jid}`, { body });
      if (r.status === 404) return false;
      if (!r.ok) throw failure(r, 'PUT', `jobs/${jid}`);
      return true;
    },
    async appendJob(id, field, text) {
      const jid = positiveId(id);
      const t = appendArgs(field, text);
      const r = await call('POST', `jobs/${jid}/append`, { body: { field, text: t } });
      if (r.ok) return true;
      if (r.status === 404 && r.json?.error === 'no such job') return false;
      if (r.status !== 404) throw failure(r, 'POST', `jobs/${jid}/append`);
      // api.php before crek 1.10 has no append route ("Not found"): read, join, write back.
      // Not atomic — two writers at the same moment can lose a line; a current api.php cannot.
      const job = await self.getJob(jid);
      if (!job) return false;
      const before = job[field] ? String(job[field]).replace(/\s+$/, '') : '';
      return self.updateJob(jid, { [field]: before ? `${before}\n${t}` : t });
    },
    async deleteJob(id) {
      const r = await call('DELETE', `jobs/${positiveId(id)}`);
      if (r.status === 404) return false;
      if (!r.ok) throw failure(r, 'DELETE', `jobs/${positiveId(id)}`);
      return true;
    },
    async listContacts() { return rows(await must('GET', 'contacts')); },
    async upsertContact(data) {
      let row = contactRow(data);
      const same = (a, b) => String(a ?? '') === String(b ?? '');
      row = withStored(row, (await self.listContacts()).find((c) => same(c.name, row.name) && same(c.company_name, row.company_name)));
      return Number((await must('POST', 'contacts', { body: row })).id);
    },
    async updateContact(id, data) {
      const cid = positiveId(id);
      const row = contactRow(data, { partial: true });
      // PUT contacts/{id} replaces the whole row: merge with what is stored first.
      const current = (await self.listContacts()).find((c) => Number(c.id) === cid);
      if (!current) return false;
      const merged = Object.fromEntries(CONTACT_FIELDS.map((f) => [f, f in row ? row[f] : current[f] ?? null]));
      const r = await call('PUT', `contacts/${cid}`, { body: merged });
      if (r.status === 404) return false;
      if (!r.ok) throw failure(r, 'PUT', `contacts/${cid}`);
      return true;
    },
    async deleteContact(id) {
      const r = await call('DELETE', `contacts/${positiveId(id)}`);
      if (r.status === 404) return false;
      if (!r.ok) throw failure(r, 'DELETE', 'contacts');
      return true;
    },
    async linkContacts(jobId, ids) {
      const job = await self.getJob(jobId);
      if (!job) return false;
      const all = [...new Set([...contactIdList(job.contact_ids), ...contactIdList(ids)])];
      return self.updateJob(jobId, { contact_ids: all });
    },
    async stats() { return must('GET', 'stats'); },
    async close() {},
  };
  return self;
}

// ---------------------------------------------------------------- command line

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error(`usage: node crek-db.mjs [--config crek.config.json] <command> [args]

  info                               backend, location and row counts (a connectivity check)
  init                               create the tables (sqlite: also the file); safe to repeat
  jobs:list [--status S] [--search TEXT] [--since YYYY-MM-DD] [--fields a,b] [--limit N]
  jobs:get ID
  jobs:add [JSON|-]                  new row; prints {"id": N}. Empty strings are skipped
  jobs:update ID [JSON|-]            changes only the given fields; "" sets NULL (not for status,
                                     which always needs a value); contact_ids replaces the job's
                                     contact links
  jobs:append ID FIELD [--] TEXT     appends TEXT as a new line to notes | communication |
                                     meetings | description (write the date into TEXT); after
                                     "--" every word is TEXT, even one starting with "-"
  jobs:delete ID
  jobs:latest [--source A,B]         newest found_at (optionally among these sources)
  contacts:list
  contacts:upsert [JSON|-]           insert, or update the row with the same (name, company_name);
                                     fields not given keep their stored value; prints {"id": N}
  contacts:update ID [JSON|-]        changes only the given fields
  contacts:delete ID
  contacts:link JOB_ID CONTACT_ID[,CONTACT_ID...]   adds links, keeps existing ones
  stats

  --config <path>   crek.config.json (default: ./crek.config.json)
  --api <url>       use an http-api directly instead of the config; the token comes from env
                    CREK_TOKEN, basic auth from env CREK_AUTH ("user:pass")
  --auth <user:pass>  basic auth on the command line — visible to other users in ps; prefer CREK_AUTH
  statuses: ${jobStatuses().join(', ')}
  whole numbers: ${[...JOB_INTEGER].join(', ')}; dates (YYYY-MM-DD): ${[...JOB_DATE].join(', ')}
JSON comes from the argument or, with "-" or no argument, from stdin. Output is JSON.
Errors: one line on stderr starting with "error:" (CREK_DEBUG=1 adds the stack trace).`);
  process.exit(2);
}

function readJsonArg(arg) {
  const text = arg === undefined || arg === '-' ? readFileSync(0, 'utf8') : arg;
  try { return JSON.parse(text); } catch (err) { throw new DbError(`not valid JSON: ${err.message}`); }
}

async function main(argv) {
  const opt = { pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { opt.pos.push(...argv.slice(i + 1)); break; } // the rest is positional (jobs:append TEXT)
    if (a === '--config') opt.config = argv[++i];
    else if (a === '--api') opt.api = argv[++i];
    else if (a === '--auth') opt.auth = argv[++i];
    else if (a === '--status') opt.status = argv[++i];
    else if (a === '--search') opt.search = argv[++i];
    else if (a === '--since') opt.since = argv[++i];
    else if (a === '--fields') opt.fields = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--limit') opt.limit = Number(argv[++i]);
    else if (a === '--source') opt.source = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('--')) usage(`unknown option ${a}`);
    else opt.pos.push(a);
  }
  const [cmd, ...rest] = opt.pos;
  if (!cmd) usage('no command');
  if (opt.limit !== undefined && (!Number.isInteger(opt.limit) || opt.limit < 1)) usage('--limit takes a positive whole number');
  const badFields = (opt.fields ?? []).filter((f) => !JOB_COLUMNS.includes(f));
  if (badFields.length) usage(`unknown field(s) in --fields: ${badFields.join(', ')} — columns: ${JOB_COLUMNS.join(', ')}`);
  if (!opt.api && !opt.config && existsSync('crek.config.json')) opt.config = 'crek.config.json';
  const { db, baseDir } = resolveDb(opt);
  const pipe = await openDb(db, { baseDir, create: cmd === 'init' });
  const out = (v) => console.log(JSON.stringify(v, null, 1));
  const need = (v, what) => { if (v === undefined) usage(`${cmd} needs ${what}`); return v; };
  try {
    switch (cmd) {
      case 'info': {
        const s = await pipe.stats();
        out({ backend: pipe.kind, where: pipe.where, jobs: Number(s.total), contacts: Number(s.contacts_count) });
        break;
      }
      case 'init': out(await pipe.init()); break;
      case 'jobs:list': {
        let list = await pipe.listJobs({ status: opt.status, search: opt.search });
        if (opt.since) list = list.filter((j) => String(j.found_at ?? '') >= opt.since);
        if (opt.limit) list = list.slice(0, opt.limit);
        if (opt.fields?.length) list = list.map((j) => Object.fromEntries(opt.fields.map((f) => [f, j[f] ?? null])));
        out(list);
        break;
      }
      case 'jobs:get': {
        const job = await pipe.getJob(need(rest[0], 'an id'));
        if (!job) throw new DbError(`no job ${rest[0]}`);
        out(job);
        break;
      }
      case 'jobs:add': out({ id: await pipe.insertJob(readJsonArg(rest[0])) }); break;
      case 'jobs:update':
        if (!await pipe.updateJob(need(rest[0], 'an id'), readJsonArg(rest[1]))) throw new DbError(`no job ${rest[0]}`);
        out({ ok: true });
        break;
      case 'jobs:append': {
        const [id, field, ...words] = rest;
        need(id, 'an id'); need(field, `a field (${APPEND_FIELDS.join(', ')})`);
        if (!APPEND_FIELDS.includes(field)) usage(`jobs:append works on ${APPEND_FIELDS.join(', ')}, not ${field}`);
        const text = words.join(' ').trim();
        if (!text) usage('jobs:append needs the text to append');
        if (!await pipe.appendJob(id, field, text)) throw new DbError(`no job ${id}`);
        out({ ok: true });
        break;
      }
      case 'jobs:delete':
        if (!await pipe.deleteJob(need(rest[0], 'an id'))) throw new DbError(`no job ${rest[0]}`);
        out({ ok: true });
        break;
      case 'jobs:latest': {
        const wanted = opt.source?.map((s) => s.toLowerCase());
        const list = (await pipe.listJobs()).filter((j) => !wanted || wanted.includes(String(j.source ?? '').toLowerCase()));
        const latest = list.reduce((m, j) => (String(j.found_at ?? '') > m ? String(j.found_at) : m), '');
        out({ found_at: latest || null, rows: list.length });
        break;
      }
      case 'contacts:list': out(await pipe.listContacts()); break;
      case 'contacts:upsert': out({ id: await pipe.upsertContact(readJsonArg(rest[0])) }); break;
      case 'contacts:update':
        if (!await pipe.updateContact(need(rest[0], 'an id'), readJsonArg(rest[1]))) throw new DbError(`no contact ${rest[0]}`);
        out({ ok: true });
        break;
      case 'contacts:delete':
        if (!await pipe.deleteContact(need(rest[0], 'an id'))) throw new DbError(`no contact ${rest[0]}`);
        out({ ok: true });
        break;
      case 'contacts:link':
        if (!await pipe.linkContacts(need(rest[0], 'a job id'), need(rest[1], 'contact ids'))) throw new DbError(`no job ${rest[0]}`);
        out({ ok: true });
        break;
      case 'stats': out(await pipe.stats()); break;
      default: usage(`unknown command ${cmd}`);
    }
  } finally {
    await pipe.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    // One line for the skills to read; a driver error (FOREIGN KEY constraint failed, ...) included.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`error: ${String(msg).split('\n')[0]}`);
    if (process.env.CREK_DEBUG === '1' && err?.stack) console.error(err.stack);
    process.exit(1);
  });
}
