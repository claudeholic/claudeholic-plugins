// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRefs, urlRefs, explicitRefs, sameRef, isWeakRef, fmtRef, normRef, canonicalUrl, sameUrlPosting, atsOf } from '../assets/crek-refs.mjs';

const kinds = (refs) => refs.map(fmtRef).sort();

test('normRef keeps letters and digits only, lowercased', () => {
  assert.equal(normRef('JOB-7K2QX'), 'job7k2qx');
  assert.equal(normRef(' R-12345 '), 'r12345');
});

test('extractRefs reads the REF: line, labels, known formats and URLs', () => {
  const text = [
    'Senior Platform Engineer',
    'Job no. JOB-7K2QX',
    'Nr ref.: ABC/2026/17',
    'Apply: https://acme.traffit.com/public/form/a/0123456789abcdef0123',
    'Workday requisition R-123456',
    'REF: JOB-7K2QX; greenhouse:7712345; traffit:48213',
  ].join('\n');
  const got = kinds(extractRefs(text));
  for (const want of ['JOB-7K2QX', 'ABC/2026/17', 'traffit:0123456789abcdef0123', 'R-123456', 'greenhouse:7712345', 'traffit:48213']) {
    assert.ok(got.includes(want), `${want} missing from ${got.join(', ')}`);
  }
});

test('extractRefs ignores values without a digit and dedupes', () => {
  assert.deepEqual(extractRefs('Reference: none\nReference: none'), []);
  assert.equal(extractRefs('JOB-7K2QX and again JOB-7K2QX').length, 1);
});

test('urlRefs knows the ATS id formats', () => {
  const cases = {
    'https://job-boards.greenhouse.io/acme/jobs/7712345': 'greenhouse:7712345',
    'https://acme.com/careers?gh_jid=7712345': 'greenhouse:7712345',
    'https://jobs.lever.co/acme/0b1c2d3e-1111-2222-3333-444455556666': 'lever:0b1c2d3e-1111-2222-3333-444455556666',
    'https://www.pracuj.pl/praca/devops-engineer-warszawa,oferta,1004123456': 'pracuj:1004123456',
    'https://form.erecruiter.pl/Form.aspx?WebID=0123456789abcdef0123': 'erecruiter:0123456789abcdef0123',
    'https://acme.jobs.personio.de/job/1234567': 'personio:1234567',
  };
  for (const [url, ref] of Object.entries(cases)) assert.deepEqual(urlRefs(url).map(fmtRef), [ref], url);
});

test('LinkedIn safety/go links are unwrapped', () => {
  const wrapped = 'https://www.linkedin.com/safety/go/?url=' + encodeURIComponent('https://job-boards.greenhouse.io/acme/jobs/7712345');
  assert.deepEqual(urlRefs(wrapped).map(fmtRef), ['greenhouse:7712345']);
});

test('explicitRefs accepts plain values, kind:value and URLs', () => {
  assert.deepEqual(kinds(explicitRefs(['JOB-7K2QX', 'traffit:48213', 'https://job-boards.greenhouse.io/a/jobs/7712345'])),
    ['JOB-7K2QX', 'greenhouse:7712345', 'traffit:48213']);
});

test('sameRef: equal values, compatible kinds', () => {
  const [bare] = explicitRefs('R-12345');
  const [wd] = explicitRefs('workday:R12345');
  const [gh] = explicitRefs('greenhouse:7712345');
  const [ghBare] = explicitRefs('7712345');
  const [lever] = explicitRefs('lever:7712345');
  assert.ok(sameRef(bare, wd)); // a Workday "R-12345" in the body is the R12345 in the apply URL
  assert.ok(sameRef(ghBare, gh)); // a bare reference number matches any kind
  assert.ok(!sameRef(gh, lever)); // an ATS id only matches the same ATS
  assert.ok(!sameRef(bare, gh));
});

test('isWeakRef: short numeric ids are weak', () => {
  assert.ok(isWeakRef(explicitRefs('traffit:48213')[0]));
  assert.ok(!isWeakRef(explicitRefs('greenhouse:7712345')[0]));
  assert.ok(!isWeakRef(explicitRefs('JOB-7K2QX')[0]));
});

test('canonicalUrl strips tracking but keeps posting ids in the query', () => {
  assert.equal(canonicalUrl('https://JustJoin.it/job-offer/acme-devops/?utm_source=x#top'), 'justjoin.it/job-offer/acme-devops');
  assert.equal(canonicalUrl('https://pl.indeed.com/viewjob?jk=abc123&from=serp'), 'pl.indeed.com/viewjob?jk=abc123');
  assert.notEqual(canonicalUrl('https://pl.indeed.com/viewjob?jk=abc123'), canonicalUrl('https://pl.indeed.com/viewjob?jk=def456'));
  assert.equal(canonicalUrl(''), null);
});

// Fictional ids only.
const ER = 'https://system.erecruiter.pl/FormTemplates/RecruitmentForm.aspx';
const WEB_A = '0a1b2c3d4e5f60718293a4b5c6d7e8f9';
const WEB_B = 'f9e8d7c6b5a4039281706f5e4d3c2b1a';

test('canonicalUrl keeps every non-tracking parameter, sorted', () => {
  assert.notEqual(canonicalUrl(`${ER}?WebID=${WEB_A}`), canonicalUrl(`${ER}?WebID=${WEB_B}`));
  assert.equal(canonicalUrl(`${ER}?WebID=${WEB_A}&utm_source=justjoin`), canonicalUrl(`${ER}?webid=${WEB_A}`));
  assert.notEqual(canonicalUrl('https://job-boards.greenhouse.io/embed/job_app?for=acme&token=7700001'),
    canonicalUrl('https://job-boards.greenhouse.io/embed/job_app?for=acme&token=7700002'));
  assert.equal(canonicalUrl('https://acme.example/careers?b=2&a=1'), canonicalUrl('https://acme.example/careers?a=1&b=2'));
  assert.equal(canonicalUrl('https://acme.traffit.com/public/an/0123456789abcdef0123?source=justjoin'),
    'acme.traffit.com/public/an/0123456789abcdef0123');
  assert.equal(canonicalUrl('https://acme.example/jobs?gh_jid=7712345&gh_src=abc&fbclid=x&lever-source[]=y'), 'acme.example/jobs?gh_jid=7712345');
});

test('canonicalUrl: LinkedIn and Indeed reduce to the posting id', () => {
  const view = canonicalUrl('https://www.linkedin.com/jobs/view/4100000001/?trk=public_jobs&refId=abc%3D%3D&trackingId=xyz');
  assert.equal(view, 'linkedin.com/jobs/view/4100000001');
  assert.equal(canonicalUrl('https://pl.linkedin.com/jobs/view/platform-engineer-at-acme-4100000001?position=3&pageNum=0'), view);
  assert.equal(canonicalUrl('https://www.linkedin.com/jobs/search/?currentJobId=4100000001&keywords=devops&geoId=100000001'), view);
  assert.equal(canonicalUrl('https://pl.indeed.com/viewjob?jk=abc123&from=serp&tk=1x&vjs=3'), canonicalUrl('https://pl.indeed.com/viewjob?jk=abc123'));
  assert.equal(canonicalUrl('https://pl.indeed.com/jobs?q=devops&vjk=abc123'), 'pl.indeed.com/viewjob?jk=abc123');
});

test('sameUrlPosting: on a known ATS the posting id decides', () => {
  assert.equal(sameUrlPosting(`${ER}?WebID=${WEB_A}`, `${ER}?WebID=${WEB_B}`), null);
  assert.equal(sameUrlPosting(`${ER}?WebID=${WEB_A}&utm_medium=x`, `${ER}?WebID=${WEB_A}`), 'same');
  assert.equal(sameUrlPosting(ER, `${ER}?utm_source=x`), 'form'); // a bare form address names no posting
  assert.equal(sameUrlPosting('https://justjoin.it/job-offer/acme-devops?utm_source=a', 'https://justjoin.it/job-offer/acme-devops'), 'same');
  assert.equal(atsOf(ER), 'erecruiter');
  assert.equal(atsOf('https://justjoin.it/job-offer/acme-devops'), null);
});
