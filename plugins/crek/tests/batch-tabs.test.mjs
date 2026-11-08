// SPDX-License-Identifier: GPL-3.0-only
// crek-batch-tabs: a batch opens in one window, in table order, with growing [N]; a tab that lands in
// another window is retried once and otherwise the whole run is undone. A fake browser stands in for
// Chrome: windows, the last active window (where Chrome puts a new tab) and the [N] counter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSignedInBoard, pauseAfter, tabNumber, parseRows, batchProblems, openBatch, closeTabs,
} from '../assets/crek-batch-tabs.mjs';

function fakeBrowser({ userWindow = 1, steal = new Set(), stealAlways = false } = {}) {
  let nextWin = userWindow + 1;
  let nextN = 900;
  let creates = 0;
  const tabs = [{ target_id: 'user-1', tab: 5, window_id: userWindow, title: '[5] the user', url: 'https://example.com/' }];
  const log = [];
  let lastActive = userWindow;
  const d = {
    log,
    tabs,
    async create({ url, newWindow, background }) {
      creates++;
      // `steal`: the user clicks into their own window just before this create (1-based count)
      if (stealAlways || steal.has(creates)) lastActive = userWindow;
      const window_id = newWindow ? nextWin++ : lastActive;
      if (newWindow) lastActive = window_id;
      const t = { target_id: `t${creates}`, tab: ++nextN, window_id, title: `[${nextN}] ${url}`, url };
      tabs.push(t);
      log.push(`create ${url}${newWindow ? ' new-window' : ''}${background ? ' bg' : ''} -> w${window_id}`);
      return t.target_id;
    },
    async windowOf(id) { return tabs.find((t) => t.target_id === id).window_id; },
    async activate(id) { lastActive = tabs.find((t) => t.target_id === id).window_id; log.push(`activate ${id}`); },
    async close(id) { tabs.splice(tabs.findIndex((t) => t.target_id === id), 1); log.push(`close ${id}`); },
    async waitLoaded() { return true; },
    async tabNumberOf(id) { return tabs.find((t) => t.target_id === id)?.tab ?? null; },
    async sleep(ms) { log.push(`sleep ${ms}`); },
    async pages() { return tabs.map((t) => ({ ...t })); },
  };
  return d;
}

const ROWS = [
  { id: 1, url: 'https://justjoin.it/job-offer/a' },
  { id: 2, url: 'https://www.linkedin.com/jobs/view/1/' },
  { id: 3, url: 'https://nofluffjobs.com/job/b' },
];

test('signed-in boards: LinkedIn and Indeed on any domain, plus --paced-hosts', () => {
  assert.equal(isSignedInBoard('https://www.linkedin.com/jobs/view/1/'), true);
  assert.equal(isSignedInBoard('https://pl.indeed.com/viewjob?jk=1'), true);
  assert.equal(isSignedInBoard('https://uk.indeed.co.uk/job'), true);
  assert.equal(isSignedInBoard('https://justjoin.it/job-offer/a'), false);
  assert.equal(isSignedInBoard('https://notlinkedin.com/x'), false);
  assert.equal(isSignedInBoard('https://jobs.example.org/x', ['linkedin.com', 'example.org']), true);
  assert.equal(isSignedInBoard('not a url'), false);
});

test('pauses: 2–4 s at random after a signed-in board, short otherwise', () => {
  assert.equal(pauseAfter('https://www.linkedin.com/jobs/view/1/', { random: () => 0 }), 2000);
  assert.equal(pauseAfter('https://www.linkedin.com/jobs/view/1/', { random: () => 1 }), 4000);
  assert.equal(pauseAfter('https://justjoin.it/x', { random: () => 1 }), 500);
});

test('tab numbers come from the [N] title prefix only', () => {
  assert.equal(tabNumber('[21] Senior DevOps — justjoin.it'), 21);
  assert.equal(tabNumber('CREK Anchor — do not close'), null);
  assert.equal(tabNumber('[x] y'), null);
  assert.equal(tabNumber(undefined), null);
});

test('rows: table order kept, id optional, only http(s), never empty', () => {
  assert.deepEqual(parseRows([{ id: 5, url: 'https://a.example/x' }, 'https://b.example/', { source_url: 'https://c.example/' }]),
    [{ id: 5, url: 'https://a.example/x' }, { id: null, url: 'https://b.example/' }, { id: null, url: 'https://c.example/' }]);
  assert.throws(() => parseRows([{ id: 1, url: 'javascript:alert(1)' }]), /refusing/);
  assert.throws(() => parseRows([{ id: 1 }]), /no url/);
  assert.throws(() => parseRows([]), /no rows/);
});

test('a batch opens in one new window, in table order, the first tab in front and the rest in the background', async () => {
  const d = fakeBrowser();
  const r = await openBatch(d, ROWS, { pause: (url) => pauseAfter(url, { random: () => 0.5 }) });
  assert.deepEqual(r.tabs.map((t) => [t.pos, t.id, t.tab]), [[1, 1, 901], [2, 2, 902], [3, 3, 903]]);
  assert.notEqual(r.window_id, 1, 'not the user\'s window');
  assert.ok(d.tabs.filter((t) => t.tab > 900).every((t) => t.window_id === r.window_id));
  assert.deepEqual(d.log, [
    'create https://justjoin.it/job-offer/a new-window -> w2',
    'sleep 500',
    'create https://www.linkedin.com/jobs/view/1/ bg -> w2',
    'sleep 3000', // after LinkedIn: the 2–4 s pause of a batch being shown
    'create https://nofluffjobs.com/job/b bg -> w2',
  ]);
  assert.deepEqual(batchProblems(r.tabs.map((t) => t.tab), await d.pages()).problems, []);
});

test('a tab that lands in the user\'s window is closed, the batch window brought forward, the row opened again', async () => {
  const d = fakeBrowser({ steal: new Set([3]) });
  const r = await openBatch(d, ROWS, { pause: () => 0 });
  assert.deepEqual(r.tabs.map((t) => t.id), [1, 2, 3]);
  assert.ok(d.tabs.filter((t) => t.tab > 900).every((t) => t.window_id === r.window_id));
  assert.equal(d.tabs.filter((t) => t.window_id === 1).length, 1, 'nothing left in the user\'s window');
  assert.deepEqual(d.log.filter((l) => /^(close|activate)/.test(l)), ['close t3', 'activate t2', 'activate t1']);
  // [N] still grows along the table (903 was the stray, closed)
  assert.deepEqual(r.tabs.map((t) => t.tab), [901, 902, 904]);
});

test('when the batch window cannot be kept, every tab of the run is closed and the error says so', async () => {
  const d = fakeBrowser({ stealAlways: true });
  await assert.rejects(openBatch(d, ROWS, { pause: () => 0 }), (err) => {
    assert.match(err.message, /row 2 .* outside the batch window/);
    assert.equal(err.closed, 1);
    return true;
  });
  assert.deepEqual(d.tabs.map((t) => t.tab), [5], 'only the user\'s tab is left');
});

test('--append-to: a replacement goes to the end of the batch window', async () => {
  const d = fakeBrowser();
  const r = await openBatch(d, ROWS, { pause: () => 0 });
  const last = r.tabs.at(-1);
  await closeTabs(d, [902]); // row 2 turned out closed
  const a = await openBatch(d, [{ id: 4, url: 'https://theprotocol.it/x' }], {
    appendTo: { targetId: last.target_id, windowId: r.window_id }, pause: () => 0,
  });
  assert.equal(a.window_id, r.window_id);
  assert.deepEqual(batchProblems([901, 903, a.tabs[0].tab], await d.pages()).problems, []);
});

test('check: missing tabs, two windows, the wrong order and other tabs in the window are all named', () => {
  const tabs = [
    { tab: 26, window_id: 1, title: '[26] LinkedIn', url: 'https://www.linkedin.com/jobs/view/1/' },
    { tab: 27, window_id: 1, title: '[27] LinkedIn', url: 'https://www.linkedin.com/jobs/view/2/' },
    { tab: 31, window_id: 1, title: '[31] justjoin', url: 'https://justjoin.it/a' },
    { tab: 5, window_id: 1, title: '[5] the user', url: 'https://example.com/' },
    { tab: null, window_id: 5, title: 'CREK Anchor — do not close', url: 'file:///x/crek-anchor.html' },
    { tab: 40, window_id: 5, title: '[40] nfj', url: 'https://nofluffjobs.com/job/b' },
  ];
  // table order: the justjoin row scored higher than the LinkedIn ones, but was opened after them
  let r = batchProblems([31, 26, 27], tabs);
  assert.ok(r.problems.some((p) => /\[26\] comes after \[31\]/.test(p)), r.problems.join('\n'));
  assert.ok(r.problems.some((p) => /another tab in the batch window: \[5\]/.test(p)));
  r = batchProblems([26, 40, 999], tabs);
  assert.ok(r.problems.includes('no tab [999]'));
  assert.ok(r.problems.some((p) => /spread over 2 windows/.test(p)));
  assert.equal(r.window_id, null);
  r = batchProblems([5, 26, 27, 31], tabs);
  assert.deepEqual(r.problems, []);
});

test('close: by [N] only, never the browser\'s last tab', async () => {
  const d = fakeBrowser();
  let r = await closeTabs(d, [12345]);
  assert.deepEqual(r, { closed: [], missing: [12345], kept: [] });
  r = await closeTabs(d, [5]);
  assert.deepEqual(r, { closed: [], missing: [], kept: [5] });
  assert.equal(d.tabs.length, 1);
});
