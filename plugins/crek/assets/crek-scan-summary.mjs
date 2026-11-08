#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
/**
 * crek-scan-summary — the table printed when a scan is over: per board, how many postings were
 * viewed, how many passed the collection filter, how many were admitted after the analysis and how
 * many of those scored 9 or more.
 *
 *   node crek-scan-summary.mjs --config crek.config.json --counts counts.json --ids 1201,1202,1207
 *
 * --counts (a file or "-" for stdin) is what the scan's collectors reported for their boards
 * (job-scan, *Counts for the scan summary*): a JSON array of {"board", "viewed", "collected"} — or
 * objects {"crek_scan_counts": [...]}, one per agent, or an array of those. `board` is the board's
 * `key` or `name` from the effective board list (boards.json with the config's overrides and
 * extras). A board reported twice (an agent stopped, the main session finished it) is summed.
 *
 * --ids are the pipeline rows the scan admitted: every posting recorded as `new` in step 7 and every
 * row brought back to `new`. Their `source` (the board's name) and `match_score` are read from the
 * pipeline through crek-db.mjs, so the last two columns count what the database holds, not what
 * anyone remembers. A source that is no board of the list gets a row of its own and a warning —
 * the fix is to record `source` as the board's `name`, nothing added.
 *
 * Output: the table in presentation.language (headers from i18n.json), or --json. Warnings go to
 * stderr. Exit 0; 1 — database error; 2 — usage. Read only.
 */
import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLang, translator } from './crek-i18n.mjs';
import { resolveDb, openDb, DbError } from './crek-db.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- pure helpers (tested)

/** The effective board list for a config — the same rule as crek-config-check.mjs --boards. */
export function boardList(cfg, defaults) {
  const b = cfg?.boards;
  if (Array.isArray(b)) return b.filter((x) => x.enabled !== false);
  const extra = Array.isArray(b?.extra) ? b.extra : [];
  const disabled = new Set(Array.isArray(b?.disabled) ? b.disabled : []);
  const override = b?.override && typeof b.override === 'object' ? b.override : {};
  return [...defaults, ...extra].map((d) => ({ ...d, ...(override[d.key] ?? {}) })).filter((x) => !disabled.has(x.key));
}

/** The counts input, flattened to [{board, viewed, collected}]; throws on a malformed entry. */
export function parseCounts(data) {
  const flat = [];
  const walk = (x) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x && typeof x === 'object' && Array.isArray(x.crek_scan_counts)) { x.crek_scan_counts.forEach(walk); return; }
    if (!x || typeof x !== 'object' || !String(x.board ?? '').trim()) throw new Error(`a count without "board": ${JSON.stringify(x)}`);
    for (const f of ['viewed', 'collected']) {
      if (!Number.isInteger(x[f]) || x[f] < 0) throw new Error(`${x.board}: "${f}" must be a whole number >= 0`);
    }
    flat.push({ board: String(x.board).trim(), viewed: x.viewed, collected: x.collected });
  };
  walk(data);
  return flat;
}

/**
 * Rows of the summary. `counts` from parseCounts, `admitted` = [{id, source, match_score}],
 * `boards` = the effective board list. Returns {rows, total, warnings}; a row is
 * {key, board, viewed, collected, admitted, top} with null where nothing was reported.
 */
export function summarize({ counts = [], admitted = [], boards = [], top = 9 }) {
  const warnings = [];
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const byLabel = new Map();
  for (const b of boards) {
    byLabel.set(norm(b.key), b);
    byLabel.set(norm(b.name), b);
  }
  const rows = new Map();
  const row = (label) => {
    const b = byLabel.get(norm(label));
    const key = b ? `board:${b.key ?? b.name}` : `raw:${norm(label)}`;
    if (!rows.has(key)) rows.set(key, { key: b?.key ?? null, board: b?.name ?? String(label).trim(), viewed: null, collected: null, admitted: 0, top: 0, known: !!b });
    return rows.get(key);
  };
  for (const c of counts) {
    const r = row(c.board);
    if (!r.known) warnings.push(`counts for "${c.board}": no such board in the board list (use its key or name)`);
    r.viewed = (r.viewed ?? 0) + c.viewed;
    r.collected = (r.collected ?? 0) + c.collected;
  }
  for (const a of admitted) {
    if (!String(a.source ?? '').trim()) { warnings.push(`#${a.id}: no source — record the board's name`); }
    const r = row(a.source || '?');
    if (!r.known && a.source) warnings.push(`#${a.id}: source "${a.source}" is not a board name — record source as the board's name, nothing added`);
    r.admitted++;
    if (Number(a.match_score) >= top) r.top++;
  }
  for (const r of rows.values()) {
    if (r.viewed != null && r.collected > r.viewed) warnings.push(`${r.board}: more passed the filter (${r.collected}) than were viewed (${r.viewed})`);
    if (r.collected != null && r.admitted > r.collected) warnings.push(`${r.board}: more admitted (${r.admitted}) than passed the filter (${r.collected})`);
    if (r.known && r.viewed == null && r.admitted) warnings.push(`${r.board}: postings admitted, but no counts reported for the board`);
  }
  const list = [...rows.values()].sort((a, b) => b.top - a.top || b.admitted - a.admitted
    || (b.viewed ?? -1) - (a.viewed ?? -1) || a.board.localeCompare(b.board));
  const sum = (f) => list.reduce((s, r) => s + (r[f] ?? 0), 0);
  const total = { viewed: sum('viewed'), collected: sum('collected'), admitted: sum('admitted'), top: sum('top') };
  // dedupe warnings, keep order
  return { rows: list.map(({ known, ...r }) => r), total, warnings: [...new Set(warnings)] };
}

/** The Markdown table, headers and the total from i18n.json. */
export function renderSummary({ rows, total }, t, top = 9) {
  const cell = (v) => (v == null ? '—' : String(v));
  const head = [t('report.col.board'), t('report.col.viewed'), t('report.col.collected'),
    t('report.col.admitted'), t('report.col.top', { top })];
  const lines = [`**${t('report.section.scan_summary')}**`, '', `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) lines.push(`| ${[r.board, cell(r.viewed), cell(r.collected), r.admitted, r.top].join(' | ')} |`);
  lines.push(`| **${t('report.value.total')}** | **${total.viewed}** | **${total.collected}** | **${total.admitted}** | **${total.top}** |`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- CLI

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error(`usage: node crek-scan-summary.mjs --config crek.config.json --counts <file|-> [--ids N,N,...] [options]

  --counts <file|->   the collectors' counts: [{"board", "viewed", "collected"}] or {"crek_scan_counts": [...]}
  --ids N,N,...       pipeline rows the scan admitted (recorded as new, or brought back to new)
  --top <score>       the score counted in the last column (default 9)
  --lang <code|name>  output language (default: env CREK_LANG, then the config, then "pl")
  --json              machine-readable output`);
  process.exit(2);
}

async function main(argv) {
  const opt = { top: 9, ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') opt.config = argv[++i];
    else if (a === '--counts') opt.counts = argv[++i];
    else if (a === '--ids') opt.ids = String(argv[++i] ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
    else if (a === '--top') opt.top = Number(argv[++i]);
    else if (a === '--lang') opt.lang = argv[++i];
    else if (a === '--json') opt.json = true;
    else if (a === '-h' || a === '--help') usage();
    else usage(`unknown option ${a}`);
  }
  if (!opt.config) usage('--config is required (the board list and the database)');
  if (!opt.counts) usage('--counts is required');
  if (!opt.ids.every((n) => Number.isInteger(n) && n > 0)) usage('--ids takes row ids, e.g. --ids 1201,1202');
  if (!Number.isFinite(opt.top)) usage('--top takes a score, e.g. --top 9');

  let cfg;
  try { cfg = JSON.parse(readFileSync(resolve(opt.config), 'utf8')); } catch (err) { usage(`cannot read ${opt.config}: ${err.message}`); }
  let counts;
  try { counts = parseCounts(JSON.parse(readFileSync(opt.counts === '-' ? 0 : resolve(opt.counts), 'utf8'))); }
  catch (err) { usage(`cannot read the counts: ${err.message}`); }
  const defaults = JSON.parse(readFileSync(join(HERE, 'boards.json'), 'utf8')).boards ?? [];
  const boards = boardList(cfg, defaults);

  let admitted = [];
  if (opt.ids.length) {
    const where = resolveDb({ config: opt.config });
    const pipe = await openDb(where.db, { baseDir: where.baseDir });
    try {
      for (const id of opt.ids) {
        const job = await pipe.getJob(id);
        if (!job) { console.error(`warning: #${id}: no such row`); continue; }
        admitted.push({ id, source: job.source, match_score: job.match_score });
      }
    } finally { await pipe.close(); }
  }
  const s = summarize({ counts, admitted, boards, top: opt.top });
  for (const w of s.warnings) console.error(`warning: ${w}`);
  if (opt.json) console.log(JSON.stringify({ rows: s.rows, total: s.total, warnings: s.warnings }, null, 1));
  else console.log(renderSummary(s, translator(resolveLang(opt.lang ?? process.env.CREK_LANG ?? cfg.presentation?.language)), opt.top));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    console.error(`error: ${err instanceof DbError ? err.message : err.stack ?? err}`);
    process.exit(1);
  });
}
