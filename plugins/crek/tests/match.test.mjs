// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameTitle, likelySamePosting, companyName, matchCandidates, resultsJson, setLanguage } from '../assets/crek-match.mjs';

setLanguage('en');

test('sameTitle ignores case, gender suffixes and a trailing tech list', () => {
  assert.ok(sameTitle('Senior DevOps Engineer (m/f/d)', 'senior devops engineer'));
  assert.ok(sameTitle('Senior DevOps Engineer — AWS, Kubernetes', 'Senior DevOps Engineer'));
  assert.ok(sameTitle('Senior DevOps Engineer | Remote', 'Senior DevOps Engineer (k/m)'));
  assert.ok(sameTitle('Inżynier DevOps', 'Inzynier DevOps'));
});

test('sameTitle: containment needs two words, different roles differ', () => {
  assert.ok(sameTitle('Lead Platform Engineer', 'Platform Engineer'));
  assert.ok(!sameTitle('Platform Engineer', 'Data Engineer'));
  assert.ok(!sameTitle('Engineer', 'Senior Engineer')); // one word is not enough
  assert.ok(!sameTitle('', 'Platform Engineer'));
});

test('companyName drops legal forms and placeholders', () => {
  assert.equal(companyName('Initech Sp. z o.o.'), 'initech');
  assert.equal(companyName('Klient nieujawniony'), null);
});

test('likelySamePosting: same agency + title, then the rate decides', () => {
  const job = { agency: 'Initech', title: 'Platform Engineer', salary_min_hour: 140, salary_max_hour: 170 };
  assert.equal(likelySamePosting({ agency: 'Initech S.A.', title: 'Platform Engineer (m/f)', salary: { min: 150, max: 180, unit: 'hour' } }, job), 'overlap');
  assert.equal(likelySamePosting({ agency: 'Initech', title: 'Platform Engineer' }, job), 'missing');
  assert.equal(likelySamePosting({ agency: 'Initech', title: 'Platform Engineer', salary: { min: 40000, max: 45000, unit: 'month' } }, job), null);
  assert.equal(likelySamePosting({ agency: 'Globex', title: 'Platform Engineer' }, job), null);
});

const JOBS = [
  { id: 1, title: 'Build and Release Engineer', agency: 'Northwind Consulting', status: 'applied',
    description: 'analysis\nREF: JOB-7K2QX', source_url: 'https://www.pracuj.pl/praca/x,oferta,1004000001', found_at: '2026-10-22 10:00:00' },
  { id: 2, title: 'Data Engineer', agency: 'Globex', status: 'skipped', source_url: 'https://justjoin.it/job-offer/globex-data', found_at: '2026-10-25 10:00:00' },
  { id: 3, title: 'Platform Engineer', agency: 'Initech', status: 'new', found_at: '2026-10-26 10:00:00' },
  { id: 4, title: 'Platform Engineer', agency: 'Initech', status: 'duplicate', duplicate_of_id: 3, found_at: '2026-10-27 10:00:00' },
];

test('matchCandidates: a shared reference number is a hard hit', () => {
  const m = matchCandidates([{ title: 'Release Engineer', agency: 'Northwind', ref: 'JOB-7K2QX' }], JOBS);
  const [first] = resultsJson(m)[0].matches;
  assert.equal(first.id, 1);
  assert.equal(first.exact, true);
  assert.deepEqual(first.shared_refs, ['JOB-7K2QX']);
});

test('matchCandidates: same URL on a skipped row is marked previously_skipped', () => {
  const [r] = resultsJson(matchCandidates([{ title: 'Data Engineer', url: 'https://justjoin.it/job-offer/globex-data?utm_source=x' }], JOBS));
  const hit = r.matches.find((x) => x.id === 2);
  assert.equal(hit.exact, true);
  assert.equal(hit.previously_skipped, true);
});

test('matchCandidates: a duplicate row points at its root; own row is skipped', () => {
  const [r] = resultsJson(matchCandidates([{ id: 3, title: 'Platform Engineer', agency: 'Initech' }], JOBS));
  assert.ok(!r.matches.some((x) => x.id === 3));
  const dup = r.matches.find((x) => x.id === 4);
  assert.equal(dup.root_id, 3);
  assert.equal(dup.likely_same_posting, true);
});

// Fictional ids and companies only.
const FORM = 'https://system.erecruiter.pl/FormTemplates/RecruitmentForm.aspx';
const URL_JOBS = [
  { id: 10, title: 'Site Reliability Engineer', agency: 'Contoso', status: 'applied',
    source_url: 'https://justjoin.it/job-offer/contoso-sre', apply_url: `${FORM}?WebID=0a1b2c3d4e5f60718293a4b5c6d7e8f9`, found_at: '2026-10-01 10:00:00' },
  { id: 11, title: 'Cloud Engineer', agency: 'Fabrikam', status: 'applied',
    source_url: 'https://justjoin.it/job-offer/fabrikam-cloud', apply_url: `${FORM}?WebID=11112222333344445555666677778888`, found_at: '2026-10-02 10:00:00' },
  { id: 12, title: 'Platform Engineer', agency: 'Tailspin', status: 'applied',
    source_url: 'https://job-boards.greenhouse.io/embed/job_app?for=tailspin&token=7700001', found_at: '2026-10-03 10:00:00' },
  { id: 13, title: 'DevOps Engineer', agency: 'Wingtip', status: 'applied',
    source_url: 'https://www.linkedin.com/jobs/view/4100000001/?trk=public_jobs', found_at: '2026-10-04 10:00:00' },
  { id: 14, title: 'Data Engineer', agency: 'Litware', status: 'applied', source_url: FORM, found_at: '2026-10-05 10:00:00' },
  { id: 15, title: 'Backend Engineer', agency: 'Proseware', status: 'applied',
    source_url: 'https://careers.example.org/apply', found_at: '2026-10-06 10:00:00' },
];
const hitsFor = (cand) => resultsJson(matchCandidates([cand], URL_JOBS))[0].matches;

test('eRecruiter: a different WebID (another company) is not a duplicate', () => {
  const hits = hitsFor({ title: 'DevOps Engineer', agency: 'Adatum', apply_url: `${FORM}?WebID=99990000aaaabbbbccccddddeeeeffff` });
  assert.ok(!hits.some((x) => x.exact), JSON.stringify(hits.filter((x) => x.exact).map((x) => x.id)));
  assert.ok(!hits.some((x) => x.url_suspect && x.id !== 14));
});

test('eRecruiter: the same WebID is a duplicate', () => {
  const hits = hitsFor({ title: 'SRE', url: `${FORM}?utm_source=jj&WebID=0a1b2c3d4e5f60718293a4b5c6d7e8f9` });
  const hit = hits.find((x) => x.id === 10);
  assert.equal(hit.exact, true);
  assert.ok(!hits.some((x) => x.exact && x.id !== 10));
});

test('Greenhouse embed: a different token is not a duplicate', () => {
  const hits = hitsFor({ title: 'Platform Engineer', agency: 'Tailspin', url: 'https://job-boards.greenhouse.io/embed/job_app?for=tailspin&token=7700002' });
  assert.ok(!hits.some((x) => x.exact));
});

test('the same link with different utm / trk parameters is a duplicate', () => {
  const hits = hitsFor({ title: 'DevOps Engineer', url: 'https://pl.linkedin.com/jobs/view/devops-engineer-at-wingtip-4100000001?refId=abc&trackingId=xyz&utm_campaign=z' });
  assert.equal(hits.find((x) => x.id === 13).exact, true);
  const jj = hitsFor({ title: 'Cloud Engineer', url: 'https://justjoin.it/job-offer/fabrikam-cloud?utm_source=newsletter&utm_medium=email' });
  assert.equal(jj.find((x) => x.id === 11).exact, true);
});

test('the same form, different companies, no posting id: at most a suspicion', () => {
  const hits = hitsFor({ title: 'Analytics Engineer', agency: 'Northwind', url: FORM });
  const hit = hits.find((x) => x.id === 14);
  assert.equal(hit.exact, false);
  assert.equal(hit.url_suspect, true);
  // the same, without a company on the candidate: the missing posting id alone keeps it a suspicion
  const bare = hitsFor({ title: 'Analytics Engineer', url: `${FORM}?utm_source=x` }).find((x) => x.id === 14);
  assert.equal(bare.exact, false);
  assert.equal(bare.url_suspect, true);
});

test('the same URL under two different companies is a suspicion, not a duplicate', () => {
  const hits = hitsFor({ title: 'Backend Engineer', agency: 'Adatum', url: 'https://careers.example.org/apply?utm_source=x' });
  const hit = hits.find((x) => x.id === 15);
  assert.equal(hit.exact, false);
  assert.equal(hit.url_suspect, true);
  assert.match(hit.url_reason, /different company/);
  // same company (or none named on one side): the same URL stays a duplicate
  assert.equal(hitsFor({ title: 'Backend Engineer', agency: 'Proseware Sp. z o.o.', url: 'https://careers.example.org/apply' })
    .find((x) => x.id === 15).exact, true);
  assert.equal(hitsFor({ title: 'Backend Engineer', url: 'https://careers.example.org/apply' }).find((x) => x.id === 15).exact, true);
});

// nofluffjobs gives every city or region of one posting a URL of its own. Fictional slugs, companies
// and references only.
const NFJ = 'https://nofluffjobs.com/pl/job/';
const NFJ_JOBS = [
  { id: 20, title: 'Mid/Senior DevOps', agency: 'Contoso', status: 'applied',
    source_url: `${NFJ}mid-senior-devops-contoso-remote`, found_at: '2026-10-10 10:00:00' },
  { id: 21, title: 'DevOps Engineer', agency: 'Tailspin Group', status: 'declined',
    source_url: `${NFJ}devops-engineer-tailspin-group-gdansk-9`, description: 'analysis\nREF: nofluffjobs:ZKWPTRMB',
    found_at: '2026-10-11 10:00:00' },
  { id: 22, title: 'DevOps Engineer', agency: 'Tailspin Group', status: 'new',
    source_url: `${NFJ}devops-engineer-tailspin-group-remote-3`, description: 'REF: nofluffjobs:QX7KD2PA',
    found_at: '2026-10-12 10:00:00' },
];
const nfjHits = (cand) => resultsJson(matchCandidates([cand], NFJ_JOBS))[0].matches;

test('nofluffjobs: another city page of the same posting is flagged, not a duplicate', () => {
  const hit = nfjHits({ title: 'Mid/Senior DevOps', agency: 'Contoso', url: `${NFJ}mid-senior-devops-contoso-warszawa` })
    .find((x) => x.id === 20);
  assert.equal(hit.exact, false);
  assert.equal(hit.other_place, 'warszawa / remote');
  assert.match(hit.reasons[0], /nofluffjobs page of another city/);
});

test('nofluffjobs: the posting reference (kind nofluffjobs, no digit needed) is a hard hit', () => {
  const hits = nfjHits({ title: 'DevOps Engineer', agency: 'Tailspin Group', url: `${NFJ}devops-engineer-tailspin-group-gdynia-7`,
    ref: 'nofluffjobs:ZKWPTRMB' });
  const hit = hits.find((x) => x.id === 21);
  assert.equal(hit.exact, true);
  assert.deepEqual(hit.shared_refs, ['nofluffjobs:ZKWPTRMB']);
  assert.match(hit.reasons.join('; '), /same posting number nofluffjobs:ZKWPTRMB/);
  // the other Tailspin posting with the same title has another reference: not a duplicate
  assert.equal(hits.find((x) => x.id === 22).exact, false);
});

test('nofluffjobs: the reference read from the og:image URL in the body counts too', () => {
  const hit = nfjHits({ title: 'DevOps Engineer', agency: 'Tailspin Group', url: `${NFJ}devops-engineer-tailspin-group-krakow`,
    text: 'og:image https://nofluffjobs.com/pl/thumbnail-image/posting/QX7KD2PA' }).find((x) => x.id === 22);
  assert.equal(hit.exact, true);
});

test('urls: the other addresses of a posting (its other NFJ city pages) are compared like url', () => {
  const hit = nfjHits({ title: 'Mid/Senior DevOps', agency: 'Contoso', url: `${NFJ}mid-senior-devops-contoso-warszawa`,
    urls: [`${NFJ}mid-senior-devops-contoso-lower-silesian`, `https://nofluffjobs.com/job/mid-senior-devops-contoso-remote`] })
    .find((x) => x.id === 20);
  assert.equal(hit.exact, true);
  assert.equal(hit.other_place, null);
});

test('nofluffjobs: the same title at another company is not another city page', () => {
  const hits = nfjHits({ title: 'Mid/Senior DevOps', agency: 'Fabrikam', url: `${NFJ}mid-senior-devops-fabrikam-warszawa` });
  assert.ok(!hits.some((x) => x.other_place || x.exact));
});
