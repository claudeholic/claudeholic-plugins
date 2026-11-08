// SPDX-License-Identifier: GPL-3.0-only
// crek-scan-summary: the per-board table printed when a scan is over — viewed, passed the
// collection filter, admitted after analysis, rated 9+. Counts come from the collectors, the last
// two columns from the pipeline rows the scan admitted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boardList, parseCounts, summarize, renderSummary } from '../assets/crek-scan-summary.mjs';
import { translator } from '../assets/crek-i18n.mjs';
import { openDb } from '../assets/crek-db.mjs';

const SCRIPT = fileURLToPath(new URL('../assets/crek-scan-summary.mjs', import.meta.url));
const BOARDS = [
  { key: 'justjoin', name: 'justjoin.it' },
  { key: 'linkedin', name: 'LinkedIn' },
  { key: 'euremotejobs', name: 'EU Remote Jobs' },
  { key: 'nofluffjobs', name: 'nofluffjobs.com' },
];

test('board list: defaults, overrides, extras, disabled — and the old array form', () => {
  const cfg = { boards: { override: { justjoin: { name: 'justjoin.it (mine)' } }, extra: [{ key: 'acme', name: 'Acme Jobs' }], disabled: ['linkedin'] } };
  assert.deepEqual(boardList(cfg, BOARDS).map((b) => b.name), ['justjoin.it (mine)', 'EU Remote Jobs', 'nofluffjobs.com', 'Acme Jobs']);
  assert.deepEqual(boardList({ boards: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B', enabled: false }] }, BOARDS).map((b) => b.key), ['a']);
  assert.equal(boardList({}, BOARDS).length, 4);
});

test('counts: one flat list from a list, per-agent objects or both; whole numbers only', () => {
  const flat = parseCounts([
    { crek_scan_counts: [{ board: 'justjoin', viewed: 120, collected: 18 }] },
    [{ crek_scan_counts: [{ board: 'linkedin', viewed: 40, collected: 9 }] }],
    { board: ' nofluffjobs.com ', viewed: 0, collected: 0 },
  ]);
  assert.deepEqual(flat.map((c) => c.board), ['justjoin', 'linkedin', 'nofluffjobs.com']);
  assert.throws(() => parseCounts([{ board: 'x', viewed: -1, collected: 0 }]), /whole number/);
  assert.throws(() => parseCounts([{ board: 'x', viewed: 3 }]), /collected/);
  assert.throws(() => parseCounts([{ viewed: 3, collected: 1 }]), /without "board"/);
});

test('summary: per board by key or name, repeated boards summed, 9+ counted, best boards first', () => {
  const s = summarize({
    boards: BOARDS,
    counts: parseCounts([
      { board: 'justjoin', viewed: 100, collected: 12 },
      { board: 'LinkedIn', viewed: 30, collected: 6 },
      { board: 'linkedin', viewed: 10, collected: 2 }, // finished by the main session after a block
      { board: 'nofluffjobs', viewed: 50, collected: 0 },
    ]),
    admitted: [
      { id: 1, source: 'justjoin.it', match_score: 9 },
      { id: 2, source: 'justjoin.it', match_score: 7 },
      { id: 3, source: 'LinkedIn', match_score: 10 },
      { id: 4, source: 'LinkedIn', match_score: 9 },
      { id: 5, source: 'LinkedIn', match_score: 8 },
    ],
  });
  assert.deepEqual(s.rows.map((r) => [r.board, r.viewed, r.collected, r.admitted, r.top]), [
    ['LinkedIn', 40, 8, 3, 2],
    ['justjoin.it', 100, 12, 2, 1],
    ['nofluffjobs.com', 50, 0, 0, 0],
  ]);
  assert.deepEqual(s.total, { viewed: 190, collected: 20, admitted: 5, top: 3 });
  assert.deepEqual(s.warnings, []);
});

test('summary: a decorated or missing source and impossible counts are warned about, never dropped', () => {
  const s = summarize({
    boards: BOARDS,
    counts: parseCounts([{ board: 'EU Remote Jobs', viewed: 5, collected: 7 }, { board: 'Monster', viewed: 3, collected: 1 }]),
    admitted: [
      { id: 7, source: 'EU Remote Jobs (original: Acme careers)', match_score: 9 },
      { id: 8, source: '', match_score: 5 },
    ],
  });
  assert.ok(s.rows.some((r) => r.board === 'EU Remote Jobs (original: Acme careers)' && r.viewed === null && r.top === 1));
  assert.ok(s.warnings.some((w) => /#7: source "EU Remote Jobs \(original/.test(w)));
  assert.ok(s.warnings.some((w) => /#8: no source/.test(w)));
  assert.ok(s.warnings.some((w) => /"Monster": no such board/.test(w)));
  assert.ok(s.warnings.some((w) => /EU Remote Jobs: more passed the filter \(7\) than were viewed \(5\)/.test(w)));
});

test('render: headers and the total from i18n.json, EN and PL', () => {
  const s = summarize({ boards: BOARDS, counts: [{ board: 'justjoin', viewed: 10, collected: 3 }], admitted: [{ id: 1, source: 'justjoin.it', match_score: 9 }] });
  const en = renderSummary(s, translator('en'));
  assert.match(en, /^\*\*Scan summary\*\*/);
  assert.match(en, /\| Board \| Viewed \| Passed the filter \| Admitted after analysis \| Rated 9\+ \|/);
  assert.match(en, /\| justjoin\.it \| 10 \| 3 \| 1 \| 1 \|/);
  assert.match(en, /\| \*\*Total\*\* \| \*\*10\*\* \| \*\*3\*\* \| \*\*1\*\* \| \*\*1\*\* \|/);
  const pl = renderSummary(s, translator('pl'));
  assert.match(pl, /^\*\*Podsumowanie skanu\*\*/);
  assert.match(pl, /\| Portal \| Obejrzane \| Przeszły filtr \| Dopuszczone po analizie \| Ocena 9\+ \|/);
  assert.match(pl, /\*\*Razem\*\*/);
  const none = renderSummary(summarize({ boards: BOARDS, admitted: [{ id: 2, source: 'LinkedIn', match_score: 9 }] }), translator('en'));
  assert.match(none, /\| LinkedIn \| — \| — \| 1 \| 1 \|/);
});

// ---------------------------------------------------------------- the CLI against a SQLite pipeline

const [maj, min] = process.versions.node.split('.').map(Number);
const hasSqlite = maj > 22 || (maj === 22 && min >= 13);
let dir;
let ids = [];

before(async () => {
  if (!hasSqlite) return;
  dir = mkdtempSync(join(tmpdir(), 'crek-test-summary-'));
  const db = await openDb({ backend: 'sqlite', path_or_url: 'crek.db' }, { baseDir: dir, create: true });
  await db.init();
  ids = [
    await db.insertJob({ title: 'SRE', source: 'justjoin.it', match_score: 9, status: 'new' }),
    await db.insertJob({ title: 'DevOps', source: 'LinkedIn', match_score: 6, status: 'new' }),
  ];
  await db.close();
  writeFileSync(join(dir, 'crek.config.json'), JSON.stringify({ db: { backend: 'sqlite', path_or_url: 'crek.db' }, presentation: { language: 'en' } }));
  writeFileSync(join(dir, 'counts.json'), JSON.stringify([{ crek_scan_counts: [{ board: 'justjoin', viewed: 64, collected: 11 }, { board: 'linkedin', viewed: 25, collected: 4 }] }]));
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test('CLI: reads the admitted rows from the pipeline and prints the table', { skip: !hasSqlite && 'needs node:sqlite' }, () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--config', join(dir, 'crek.config.json'), '--counts', join(dir, 'counts.json'), '--ids', ids.join(',')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| justjoin\.it \| 64 \| 11 \| 1 \| 1 \|/);
  assert.match(r.stdout, /\| LinkedIn \| 25 \| 4 \| 1 \| 0 \|/);
  assert.match(r.stdout, /\| \*\*Total\*\* \| \*\*89\*\* \| \*\*15\*\* \| \*\*2\*\* \| \*\*1\*\* \|/);
  const j = spawnSync(process.execPath, [SCRIPT, '--config', join(dir, 'crek.config.json'), '--counts', '-', '--ids', `${ids[0]},99999`, '--json'],
    { encoding: 'utf8', input: JSON.stringify([{ board: 'justjoin', viewed: 1, collected: 1 }]) });
  assert.equal(j.status, 0, j.stderr);
  assert.match(j.stderr, /#99999: no such row/);
  assert.deepEqual(JSON.parse(j.stdout).total, { viewed: 1, collected: 1, admitted: 1, top: 1 });
  const bad = spawnSync(process.execPath, [SCRIPT, '--config', join(dir, 'crek.config.json')], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});
