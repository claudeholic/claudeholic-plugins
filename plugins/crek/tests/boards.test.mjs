// SPDX-License-Identifier: GPL-3.0-only
// boards.json `listing`: how each board orders and filters results, and the stop rule a scan uses
// there. The rule must follow from the facts recorded next to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`../assets/${f}`, import.meta.url)), 'utf8'));
const BOARDS = read('boards.json').boards;
const LISTING = read('crek.schema.json').$defs.listing;
const RULES = ['time_filter', 'date_order', 'date_order_unverified', 'low_quality'];

test('the schema and the config check know the same stop rules', () => {
  assert.deepEqual(LISTING.properties.stop_rule.enum, RULES);
  const check = readFileSync(fileURLToPath(new URL('../assets/crek-config-check.mjs', import.meta.url)), 'utf8');
  assert.match(check, new RegExp(`STOP_RULES = \\[${RULES.map((r) => `'${r}'`).join(', ')}\\]`));
});

test('every listing uses only schema fields and a known stop rule, and says where its facts come from', () => {
  const fields = Object.keys(LISTING.properties);
  for (const b of BOARDS.filter((x) => x.listing)) {
    const l = b.listing;
    assert.ok(RULES.includes(l.stop_rule), `${b.key}: ${l.stop_rule}`);
    for (const k of Object.keys(l)) assert.ok(fields.includes(k), `${b.key}: unknown listing field ${k}`);
    assert.ok(l.verified && typeof l.verified === 'string', `${b.key}: no verified note`);
  }
});

test('the stop rule follows from the facts: filter first, then strict date order, else low quality', () => {
  for (const b of BOARDS.filter((x) => x.listing)) {
    const l = b.listing;
    const hasFilter = Array.isArray(l.time_filter) && l.time_filter.length > 0;
    const expected = hasFilter ? 'time_filter'
      : l.strict_date_order === true ? 'date_order'
        : l.strict_date_order === null && l.date_sort ? 'date_order_unverified'
          : 'low_quality';
    assert.equal(l.stop_rule, expected, b.key);
    if (l.stop_rule === 'low_quality') assert.ok(l.low_quality_reason, `${b.key}: low_quality without a reason`);
  }
});

test('the researched boards carry a listing', () => {
  const keys = BOARDS.filter((x) => x.listing).map((x) => x.key);
  for (const k of ['justjoin', 'nofluffjobs', 'pracuj_pl', 'theprotocol', 'linkedin', 'indeed_pl', 'remoteok', 'himalayas']) {
    assert.ok(keys.includes(k), k);
  }
});
