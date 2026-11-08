#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
/**
 * crek-config-check — check crek.config.json: hand-written checks of the fields that matter, following
 * the bundled schema (crek.schema.json documents every field; this is not a full schema validator).
 *
 *   node crek-config-check.mjs [path/to/crek.config.json] [--boards]
 *
 * --boards prints the effective board list as JSON instead of the check report: the plugin
 * defaults from boards.json with boards.override applied, plus boards.extra, minus
 * boards.disabled ({"boards": [...], "disabled": [...]}). job-scan reads it so that every scan
 * merges the list the same way.
 *
 * A config that is wrong in an interesting way is worse than one that is missing: a dropped
 * `min_rate` does not announce itself, it just quietly stops filtering, and the first sign is a
 * report full of postings nobody wants. So this runs at the start of a session and says plainly
 * what is broken, what is merely absent, and what looks stale.
 *
 * No dependencies — the checks are hand-written against the same schema file, because pulling a
 * JSON Schema validator into a plugin that otherwise needs nothing is a poor trade.
 *
 * Exit codes: 0 fine (warnings possible), 1 config errors, 2 usage error or no config file.
 * Fields added in later versions are optional: a config written for an older version gets notes
 * or warnings about them, never errors.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { browserProblems } from './crek-browsers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const boardsMode = args.includes('--boards');
const configPath = resolve(args.find((a) => !a.startsWith('--')) ?? 'crek.config.json');

if (!existsSync(configPath)) {
  console.error(`error: ${configPath} does not exist — offer the user the bootstrap interview `
    + '(skills/apply/references/bootstrap.md in the crek plugin) and create it; nothing else works without it');
  process.exit(2);
}

let cfg;
try {
  cfg = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (err) {
  console.error(`error: ${configPath} is not valid JSON — ${err.message}`);
  process.exit(1);
}
if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
  console.error(`error: ${configPath} must hold a JSON object`);
  process.exit(1);
}
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

const errors = [];
const warnings = [];
const notes = [];

// ---------------------------------------------------------------- version

if (cfg.version !== 2) {
  if (cfg.version === undefined && cfg.criteria && !cfg.criteria.blockers) {
    errors.push(
      'version 1 config (flat `criteria`, no `blockers`). Migrate it: contract/min_rate/work_mode/' +
      'reject_technologies move under criteria.blockers, ask_before_reject under criteria.soft, ' +
      'and cv.base becomes cv.master (the public CV, not a tailored variant).');
  } else {
    errors.push(`unknown config version ${JSON.stringify(cfg.version)} — expected 2`);
  }
}

// ---------------------------------------------------------------- required blocks

const need = (path, what) => {
  const value = path.split('.').reduce((o, k) => (o == null ? o : o[k]), cfg);
  if (value === undefined || value === null || value === '') errors.push(`missing ${path} — ${what}`);
  return value;
};

need('candidate.name', 'goes into every application form');
const email = need('candidate.email', 'employers reply there');
if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
  errors.push(`candidate.email "${email}" does not look like an e-mail address`);
}
const backend = need('db.backend', 'nowhere to record applications without it');
const location = need('db.path_or_url', 'nowhere to record applications without it');

// ---------------------------------------------------------------- database (crek-db.mjs)

const BACKENDS = ['sqlite', 'mysql', 'http-api'];
function onPath(name) {
  return String(process.env.PATH ?? '').split(':').some((d) => d && existsSync(join(d, name)));
}
if (backend && !BACKENDS.includes(backend)) {
  errors.push(`db.backend is "${backend}" — expected ${BACKENDS.join(', ')}`);
} else if (backend === 'sqlite' && location) {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (!(maj > 23 || (maj === 23 && min >= 4) || (maj === 22 && min >= 13))) {
    errors.push(`db.backend sqlite needs Node >= 22.13 (built-in node:sqlite); this is Node ${process.versions.node}`);
  }
  const file = resolve(dirname(configPath), location);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(location)) errors.push(`db.path_or_url for sqlite is a file path, not a URL: ${location}`);
  else if (!existsSync(file)) warnings.push(`the sqlite database ${file} does not exist yet — create it: node crek-db.mjs --config ${configPath} init`);
  else {
    // The whole job hunt, contacts' phone numbers included: owner only (crek-db init sets 0600).
    try {
      const mode = statSync(file).mode & 0o777;
      if (mode & 0o077) warnings.push(`the sqlite database ${file} is mode ${mode.toString(8)} — other users can read it; chmod 600 it`);
    } catch { /* stat failed; not worth failing the run over */ }
  }
} else if (backend === 'mysql' && location) {
  if (!/^(mysql|mariadb):\/\/[^/]+\/[^/?]+/i.test(location)) {
    errors.push(`db.path_or_url for mysql must look like mysql://user@host:3306/database — got "${location}"`);
  }
  const client = cfg.db?.client || process.env.CREK_MYSQL_CLIENT;
  if (client ? !(isAbsolute(client) ? existsSync(client) : onPath(client)) : !onPath('mariadb') && !onPath('mysql')) {
    errors.push(`db.backend mysql runs the MySQL / MariaDB command-line client, and ${client ? `"${client}"` : 'neither mariadb nor mysql'} was found — install it (e.g. apt install mariadb-client) or set db.client`);
  }
  if (!cfg.db?.auth && !/^[a-z]+:\/\/[^/@]*:[^/@]*@/i.test(location)) {
    warnings.push('db.auth is empty — the mysql backend takes "user:password" from it');
  }
} else if (backend === 'http-api' && location) {
  const token = cfg.db?.token;
  if (!/^https?:\/\//i.test(location)) errors.push(`db.path_or_url for http-api must be the http(s) URL of api.php — got "${location}"`);
  else if (/^http:\/\//i.test(location) && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/i.test(location) && (cfg.db?.auth || token)) {
    warnings.push('db.path_or_url is plain http to another machine — the API token and the basic-auth password cross the network unencrypted; use https');
  }
  // api.php from crek 1.10 refuses every request without its token (X-Crek-Token); an older
  // api.php does not check it, so a config without db.token keeps working there — a warning.
  if (token === undefined || token === '') {
    warnings.push('db.token is not set — the bundled api.php from crek 1.10 refuses requests without its API token '
      + '(X-Crek-Token); an older api.php still works without it. Set db.token to the $api_token of config.php on the server');
  } else if (typeof token !== 'string') {
    errors.push('db.token must be a string (the $api_token of config.php on the server)');
  } else if (token.length < 64) {
    warnings.push(`db.token has ${token.length} characters — api.php refuses tokens shorter than 64 (32 random bytes in hex: openssl rand -hex 32)`);
  }
}

const blockers = cfg.criteria?.blockers;
if (!blockers) {
  errors.push('missing criteria.blockers — without it nothing is filtered and every posting looks acceptable');
} else {
  if (!Array.isArray(blockers.contract_types) || !blockers.contract_types.length) {
    warnings.push('criteria.blockers.contract_types is empty — employment-only postings will not be filtered out');
  }
  if (!blockers.min_rate) {
    warnings.push('criteria.blockers.min_rate is not set — no floor on pay, everything passes');
  } else {
    const { amount, unit, currency } = blockers.min_rate;
    if (typeof amount !== 'number') errors.push('criteria.blockers.min_rate.amount must be a number');
    if (!['hour', 'day', 'month', 'year'].includes(unit)) {
      errors.push(`criteria.blockers.min_rate.unit is ${JSON.stringify(unit)} — expected hour, day, month or year`);
    }
    if (!currency) errors.push('criteria.blockers.min_rate.currency is missing — a bare number cannot be compared');
  }
  if (!Array.isArray(blockers.work_modes) || !blockers.work_modes.length) {
    warnings.push('criteria.blockers.work_modes is empty — on-site postings will not be filtered out');
  }
  for (const [i, ex] of (Array.isArray(blockers.work_mode_exceptions) ? blockers.work_mode_exceptions : []).entries()) {
    if (!obj(ex)) { errors.push(`criteria.blockers.work_mode_exceptions[${i}] must be an object`); continue; }
    if (!ex.mode) errors.push(`criteria.blockers.work_mode_exceptions[${i}] has no mode`);
    if (ex.min_rate && typeof ex.min_rate.amount !== 'number') {
      errors.push(`criteria.blockers.work_mode_exceptions[${i}].min_rate.amount must be a number`);
    }
  }
}

// ---------------------------------------------------------------- CV and inventory

const cv = obj(cfg.cv) ?? {};
if (!cv.master) {
  errors.push('missing cv.master — scoring compares postings against the master CV, so without it there is nothing to compare');
} else if (!existsSync(resolve(dirname(configPath), cv.master))) {
  errors.push(`cv.master points at ${cv.master}, which does not exist`);
} else {
  const masterPath = resolve(dirname(configPath), cv.master);
  const sha = createHash('sha256').update(readFileSync(masterPath)).digest('hex');
  if (cv.master_sha256 && cv.master_sha256 !== sha) {
    warnings.push(
      `the master CV changed since the inventory was built (${statSync(masterPath).mtime.toISOString().slice(0, 10)}) — ` +
      'run crek:profile to rebuild profile_inventory, otherwise scoring describes an old CV');
  }
  const inv = obj(cfg.profile_inventory);
  if (!inv) {
    warnings.push('no profile_inventory — run crek:profile, or match scores will be guesswork rather than coverage of the CV');
  } else {
    if (inv.source_sha256 && inv.source_sha256 !== sha) {
      warnings.push('profile_inventory was built from a different CV than cv.master — run crek:profile');
    }
    if (!cv.master_sha256 && !inv.source_sha256) {
      notes.push('neither cv.master_sha256 nor profile_inventory.source_sha256 is set — a changed CV will not be noticed; crek:profile writes both');
    }
    if (!Array.isArray(inv.skills) || inv.skills.length < 5) {
      warnings.push(`profile_inventory.skills has ${inv.skills?.length ?? 0} entries — that is too thin to score a posting against`);
    }
  }
}
if (!cv.dir) warnings.push('missing cv.dir — no home for per-application CV directories (optional, but every tailored CV needs one)');

// ---------------------------------------------------------------- boards

// The plugin ships the default list (boards.json); the config only adjusts it. The old form — a
// plain array that was the whole list — still works, but it freezes the list: boards added to the
// plugin later never reach that user. Hence the migration warning.
const BOARD_REGIONS = ['pl', 'global', 'freelance', 'ats-search'];
const BOARD_FIELDS = ['name', 'url', 'region', 'notes', 'listing'];
// How far a scan goes on a board (boards.json `listing.stop_rule`, job-scan *How far to go on each board*).
const STOP_RULES = ['time_filter', 'date_order', 'date_order_unverified', 'low_quality'];
function checkListing(at, listing) {
  if (listing === undefined) return;
  if (!obj(listing)) { errors.push(`${at}.listing must be an object`); return; }
  if (!STOP_RULES.includes(listing.stop_rule)) errors.push(`${at}.listing.stop_rule is ${JSON.stringify(listing.stop_rule)} — expected ${STOP_RULES.join(', ')}`);
}
let defaults = [];
let defaultsError = null;
try {
  defaults = JSON.parse(readFileSync(join(HERE, 'boards.json'), 'utf8')).boards ?? [];
} catch {
  defaultsError = 'bundled boards.json is missing or invalid — no default boards to scan';
  errors.push(defaultsError);
}
const defaultKeys = new Set(defaults.map((b) => b.key));

function effectiveBoards() {
  const b = cfg.boards;
  if (Array.isArray(b)) {
    return {
      boards: b.filter((x) => x.enabled !== false).map(({ enabled, group, ...x }) => x),
      disabled: b.filter((x) => x.enabled === false).map((x) => x.key ?? x.name),
      legacy: true,
    };
  }
  const extra = Array.isArray(b?.extra) ? b.extra : [];
  const disabled = new Set(Array.isArray(b?.disabled) ? b.disabled : []);
  const override = b?.override && typeof b.override === 'object' ? b.override : {};
  const all = [...defaults, ...extra].map((d) => ({ ...d, ...(override[d.key] ?? {}) }));
  return {
    boards: all.filter((x) => !disabled.has(x.key)),
    disabled: all.filter((x) => disabled.has(x.key)).map((x) => x.key),
    legacy: false,
  };
}

if (boardsMode) {
  // Only a broken boards.json stops this; problems elsewhere in the config are the check's business.
  if (defaultsError) {
    console.error(`error: ${defaultsError}`);
    process.exit(1);
  }
  const { boards, disabled, legacy } = effectiveBoards();
  // Wait for stdout to drain: process.exit() right after a large write to a pipe cuts it off.
  const out = `${JSON.stringify({ boards, disabled, ...(legacy ? { legacy_array_form: true } : {}) }, null, 2)}\n`;
  await new Promise((ok) => process.stdout.write(out, ok));
  process.exit(0);
}

if (cfg.boards === undefined) {
  notes.push(`no boards block — scans use the ${defaults.length} plugin default boards`);
} else if (Array.isArray(cfg.boards)) {
  warnings.push(
    'boards is the old array form (the whole list lives in the config, so boards added to the plugin never reach you). ' +
    'Migrate to {"extra": [...], "disabled": [...], "override": {...}} on top of the defaults in assets/boards.json: ' +
    'your boards the plugin does not ship go to extra (each with a key), enabled:false ones go to disabled, ' +
    'your own url/notes for a default board go to override.<key>');
  for (const [i, x] of cfg.boards.entries()) {
    if (!x?.name || !x?.url) errors.push(`boards[${i}] needs name and url`);
  }
} else if (typeof cfg.boards !== 'object' || cfg.boards === null) {
  errors.push('boards must be an object {extra, disabled, override} (or the legacy array)');
} else {
  const b = cfg.boards;
  for (const k of Object.keys(b)) {
    if (!['extra', 'disabled', 'override'].includes(k)) errors.push(`boards.${k} is not a known field — expected extra, disabled, override`);
  }
  const extraKeys = new Set();
  if (b.extra !== undefined && !Array.isArray(b.extra)) errors.push('boards.extra must be an array');
  for (const [i, x] of (Array.isArray(b.extra) ? b.extra : []).entries()) {
    if (!x?.key || !x?.name || !x?.url) errors.push(`boards.extra[${i}] needs key, name and url`);
    if (x?.key && !/^[a-z0-9_]+$/.test(x.key)) errors.push(`boards.extra[${i}].key "${x.key}" — use lowercase letters, digits and _`);
    if (x?.region && !BOARD_REGIONS.includes(x.region)) errors.push(`boards.extra[${i}].region "${x.region}" — expected ${BOARD_REGIONS.join(', ')}`);
    if (defaultKeys.has(x?.key)) warnings.push(`boards.extra[${i}] reuses the plugin key "${x.key}" — the board is then listed twice; use boards.override.${x.key} instead`);
    else if (extraKeys.has(x?.key)) errors.push(`boards.extra has key "${x.key}" twice`);
    if (x?.key) extraKeys.add(x.key);
    checkListing(`boards.extra[${i}]`, x?.listing);
  }
  if (b.disabled !== undefined && !Array.isArray(b.disabled)) errors.push('boards.disabled must be an array of keys');
  for (const k of Array.isArray(b.disabled) ? b.disabled : []) {
    if (!defaultKeys.has(k) && !extraKeys.has(k)) warnings.push(`boards.disabled has "${k}", which is neither a plugin board (assets/boards.json) nor in boards.extra — renamed or removed?`);
  }
  if (b.override !== undefined && (typeof b.override !== 'object' || b.override === null || Array.isArray(b.override))) {
    errors.push('boards.override must be an object: key -> partial board fields');
  }
  for (const [k, o] of Object.entries(b.override && typeof b.override === 'object' ? b.override : {})) {
    if (!defaultKeys.has(k) && !extraKeys.has(k)) warnings.push(`boards.override has "${k}", which is neither a plugin board (assets/boards.json) nor in boards.extra — the override does nothing`);
    for (const f of Object.keys(o ?? {})) {
      if (!BOARD_FIELDS.includes(f)) errors.push(`boards.override.${k}.${f} is not a board field — expected ${BOARD_FIELDS.join(', ')}`);
    }
    if (o?.region && !BOARD_REGIONS.includes(o.region)) errors.push(`boards.override.${k}.region "${o.region}" — expected ${BOARD_REGIONS.join(', ')}`);
    checkListing(`boards.override.${k}`, o?.listing);
  }
}
if (!Array.isArray(cfg.boards) && cfg.boards !== undefined) {
  const { boards, disabled } = effectiveBoards();
  notes.push(`boards: ${boards.length} to scan (${defaults.length} plugin defaults + ${cfg.boards?.extra?.length ?? 0} extra − ${disabled.length} disabled)`);
}

// ---------------------------------------------------------------- hygiene

// Always: every config holds personal data (name, phone, e-mail, the skill inventory), and many
// also passwords or the API token.
try {
  const mode = statSync(configPath).mode & 0o777;
  if (mode & 0o077) {
    const what = cfg.credentials || cfg.db?.auth || cfg.db?.token ? 'personal data and secrets' : 'personal data';
    warnings.push(`${configPath} holds ${what} but is mode ${mode.toString(8)} — chmod 600 it`);
  }
} catch { /* stat failed; not worth failing the run over */ }

// The config holds personal data and passwords, the database the whole job hunt: neither belongs
// in a repository. Checked only when the config sits inside a git work tree.
{
  const dir = dirname(configPath);
  const inside = spawnSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inside.status === 0 && inside.stdout.trim() === 'true') {
    const paths = [configPath];
    if (backend === 'sqlite' && location) paths.push(resolve(dir, location));
    if (cv.dir) paths.push(resolve(dir, cv.dir));
    const rel = paths.map((p) => relative(dir, p) || '.').filter((p) => !p.startsWith('..'));
    const tracked = spawnSync('git', ['-C', dir, 'ls-files', '--', ...rel], { encoding: 'utf8' });
    const hits = tracked.status === 0 ? tracked.stdout.split('\n').filter(Boolean) : [];
    if (hits.length) {
      warnings.push(`git tracks ${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ` and ${hits.length - 3} more` : ''} — `
        + 'personal data and passwords do not belong in a repository: git rm --cached them and add them to .gitignore');
    }
  }
}

// What to do when a form asks point-blank whether AI was used. Optional (added in 1.9): without it
// the skills ask the user every time.
const AI_POLICIES = ['truthful', 'user_answers', 'ask'];
const aiPolicy = obj(cfg.conduct)?.ai_use_question;
if (cfg.conduct !== undefined && !obj(cfg.conduct)) errors.push('conduct must be an object');
else if (aiPolicy === undefined) {
  notes.push('conduct.ai_use_question is not set — when a form asks directly whether AI was used, Claude will ask you each time (set it to truthful, user_answers or ask)');
} else if (!AI_POLICIES.includes(aiPolicy)) {
  errors.push(`conduct.ai_use_question is "${aiPolicy}" — expected ${AI_POLICIES.join(', ')}`);
}
// Whether Claude may create portal accounts on its own. Optional (added in 1.9.1): without it the
// skills ask before creating one. Password resets are always asked about, whatever this says.
const ACCOUNT_POLICIES = ['auto', 'ask'];
const accountPolicy = obj(cfg.conduct)?.account_creation;
if (obj(cfg.conduct) || cfg.conduct === undefined) {
  if (accountPolicy === undefined) {
    notes.push('conduct.account_creation is not set — Claude will ask before creating an account on a job portal (set it to auto or ask)');
  } else if (!ACCOUNT_POLICIES.includes(accountPolicy)) {
    errors.push(`conduct.account_creation is "${accountPolicy}" — expected ${ACCOUNT_POLICIES.join(', ')}`);
  }
}

// presentation.language picks the fixed wording (table headers, standard values, script output) from
// i18n.json: a code or a name listed there; no value means Polish (the plugin default), anything
// else falls back to English. Same rule as in reporting.md and crek-i18n.mjs.
const language = String(cfg.presentation?.language ?? '').trim();
if (!language) {
  notes.push('presentation.language is not set — reports and fixed labels default to Polish (set "en" for English)');
} else {
  let i18n = null;
  try { i18n = JSON.parse(readFileSync(join(HERE, 'i18n.json'), 'utf8')); } catch { /* reported below */ }
  if (!i18n) {
    warnings.push('bundled i18n.json is missing or invalid — fixed labels cannot be localised');
  } else {
    const v = language.toLowerCase();
    const known = i18n[v] || i18n[v.split(/[-_]/)[0]]
      || Object.values(i18n).some((d) => (d.language_names ?? []).some((n) => n.toLowerCase() === v));
    if (!known) {
      notes.push(`presentation.language "${language}" has no dictionary in i18n.json (${Object.keys(i18n).join(', ')}) — fixed labels fall back to English`);
    }
  }
}
// Browsers in the order of use and mail access (added in 1.12): optional, checked in crek-browsers.mjs.
{
  const p = browserProblems(cfg);
  errors.push(...p.errors);
  warnings.push(...p.warnings);
  notes.push(...p.notes);
}
if (!cfg.rate_policy) {
  notes.push('no rate_policy — forms asking for expected pay will need a decision every time');
}

// ---------------------------------------------------------------- report

const schemaPath = join(HERE, 'crek.schema.json');
console.log(`crek-config-check — ${configPath}`);
console.log(`schema: ${existsSync(schemaPath) ? schemaPath : '(bundled schema not found)'}\n`);

for (const e of errors) console.log(`  ERROR    ${e}`);
for (const w of warnings) console.log(`  WARNING  ${w}`);
for (const n of notes) console.log(`  note     ${n}`);

if (!errors.length && !warnings.length && !notes.length) console.log('  OK — nothing to report');

console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
process.exitCode = errors.length ? 1 : 0;
