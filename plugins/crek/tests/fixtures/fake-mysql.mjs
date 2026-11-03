#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// A stand-in for the mysql / mariadb client, for tests: records how it was called and answers
// with canned rows. Never connects anywhere.
import { readFileSync, statSync, appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('mariadb from 11.4.0-MariaDB (fake)'); process.exit(0); }
const optFile = args.find((a) => a.startsWith('--defaults-extra-file='))?.split('=')[1];
const sql = readFileSync(0, 'utf8');
const record = {
  args, sql, first_arg_is_defaults: String(args[0]).startsWith('--defaults-extra-file='),
  options: optFile ? readFileSync(optFile, 'utf8') : null,
  mode: optFile ? (statSync(optFile).mode & 0o777).toString(8) : null, optFile,
};
if (process.env.FAKE_MYSQL_LOG) appendFileSync(process.env.FAKE_MYSQL_LOG, `${JSON.stringify(record)}\n`);
if (process.env.FAKE_MYSQL_FAIL) { console.error('ERROR 1064 (42000): fake syntax error'); process.exit(1); }
const out = [];
if (/FROM jobs j/.test(sql)) {
  out.push(JSON.stringify({ id: 1, title: 'Platform Engineer', agency: 'Initech', status: 'applied', technologies: '["Go"]', found_at: '2026-10-30 10:00:00', contact_ids: '3', contact_names: 'Ann Lee' }));
  out.push(JSON.stringify({ id: 2, title: 'Zażółć gęślą jaźń\nline two', agency: null, status: 'new', technologies: null, found_at: '2026-10-29 09:00:00', contact_ids: null, contact_names: null }));
} else if (/SELECT COUNT\(\*\) FROM (jobs|contacts) WHERE id/.test(sql)) out.push('1');
else if (/SELECT @crek_id/.test(sql)) out.push('42');
else if (/SELECT LAST_INSERT_ID\(\)/.test(sql)) out.push('7');
else if (/ROW_COUNT\(\)/.test(sql)) out.push('1');
else if (/SELECT JSON_OBJECT\(\s*'total'/.test(sql)) out.push(JSON.stringify({ total: 2, by_status: null, by_source: [{ source: 'x', count: 2 }], avg_match: 7.5, contacts_count: 1 }));
else if (/FROM contacts WHERE name/.test(sql)) out.push(JSON.stringify({ id: 7, name: 'Ann Lee', company_name: 'Initech', role: null, phone: '123', email: 'a@x', linkedin_url: null, notes: null }));
process.stdout.write(out.length ? `${out.join('\n')}\n` : '');
