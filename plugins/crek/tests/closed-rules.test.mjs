// SPDX-License-Identifier: GPL-3.0-only
// judge() of crek-closed-check on sample pages: what the built-in fast path recognises, and that it
// never claims `open` where it knows nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../assets/crek-closed-rules.mjs';

const page = (url, text = '', extra = {}) => ({ url, status: 200, title: 'Posting', text, ...extra });

test('known closed phrases per board', () => {
  const cases = [
    ['https://www.linkedin.com/jobs/view/4123456789/', 'Senior Engineer\nNo longer accepting applications\n'],
    ['https://www.linkedin.com/jobs/view/4123456789/', 'Kandydaci nie są już akceptowani'],
    ['https://justjoin.it/job-offer/acme-devops', 'Oferta archiwalna'],
    ['https://nofluffjobs.com/pl/job/devops-acme', 'Oferta pracy DevOps Engineer w Acme wygasła 12.10.2026'],
    ['https://theprotocol.it/szczegoly/praca/devops', 'Oferta wygasła'],
    ['https://bulldogjob.pl/companies/jobs/123', 'Job expired 30.10.2026'],
    ['https://www.pracuj.pl/praca/devops,oferta,1004000001', 'Pracodawca zakończył zbieranie zgłoszeń'],
  ];
  for (const [url, text] of cases) {
    const v = judge(page(url, text));
    assert.equal(v.state, 'closed', `${url}: ${text}`);
    assert.match(v.reason, /^"/);
  }
});

test('closed by HTTP status or a not-found URL, on any board', () => {
  assert.deepEqual(judge(page('https://careers.example.com/job/1', '', { status: 404 })).state, 'closed');
  assert.equal(judge(page('https://careers.example.com/job/1', '', { status: 410 })).reason, 'HTTP 410');
  assert.equal(judge(page('https://solid.jobs/offer-not-found/123')).state, 'closed');
  assert.equal(judge(page('https://boards.greenhouse.io/acme?error=true')).state, 'closed');
});

test('LinkedIn: judged by the page text only, unknown (never open) without a known phrase', () => {
  const url = 'https://www.linkedin.com/jobs/view/4123456789/';
  assert.equal(judge(page(url, 'Platform Engineer\nNorthwind\nNo longer accepting applications')).state, 'closed');
  const live = judge(page(url, 'Platform Engineer\nNorthwind\nEasy Apply\nAbout the job'));
  assert.equal(live.state, 'unknown', 'no phrase on a LinkedIn page is not proof that it is open');
  assert.match(live.reason, /read the page/);
  // A logged-out or half-loaded page says nothing either.
  assert.equal(judge(page(url, 'Sign in to view more jobs', { title: 'LinkedIn Login' })).state, 'unknown');
  // A closed phrase in other words is for the reader: still unknown, not open.
  assert.equal(judge(page(url, 'This job is no longer available')).state, 'unknown');
  assert.equal(judge(page(url, '', { status: 404 })).state, 'closed');
});

test('judge() takes the page alone: no second argument, no API state', () => {
  assert.equal(judge.length, 1);
});

test('nothing known → unknown, never open; open on a marker board says to read the page', () => {
  const unknownBoard = judge(page('https://careers.example.com/job/1', 'Ogłoszenie wygasło'));
  assert.equal(unknownBoard.state, 'unknown', 'a phrase the list does not know is for the reader to judge');
  assert.equal(judge(page('https://justjoin.it/job-offer/x', 'Apply now')).state, 'open');
  assert.match(judge(page('https://justjoin.it/job-offer/x', 'Apply now')).reason, /fast path, read the page/);
  assert.equal(judge(page('https://justjoin.it/job-offer/x', '', { title: 'Just a moment...' })).state, 'unknown');
  assert.equal(judge(page('https://www.pracuj.pl/praca/x', '', { status: 500 })).state, 'unknown');
  // Specific phrases only: a "Job expired?" feedback link on a live page is not a closed marker.
  assert.equal(judge(page('https://bulldogjob.pl/companies/jobs/123', 'Job expired? Let us know')).state, 'open');
});

test('no script calls a LinkedIn API (voyager, the session cookie, its CSRF header)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../assets/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(src, /voyager|JSESSIONID|csrf-token|li_at/i, f);
  }
});
