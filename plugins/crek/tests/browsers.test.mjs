// SPDX-License-Identifier: GPL-3.0-only
// crek-browsers: the browser list in the order of use, its checks and the mail setting. The live
// check runs against a fake /json/version on a local port; no real browser is touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  effectiveBrowsers, browserProblems, mailSettings, checkBrowser, BROWSER_TYPES, MAIL_ACCESS,
} from '../assets/crek-browsers.mjs';

const SCHEMA = JSON.parse(readFileSync(fileURLToPath(new URL('../assets/crek.schema.json', import.meta.url)), 'utf8'));
let server;
let port;
let freePort;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/json/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ Browser: 'Chrome/150.0.0.0', 'Protocol-Version': '1.3' }));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  // a port nothing listens on: open one and close it again
  const probe = createServer();
  await new Promise((ok) => probe.listen(0, '127.0.0.1', ok));
  freePort = probe.address().port;
  await new Promise((ok) => probe.close(ok));
});
after(() => server?.close());

test('no browser.browsers: chrome-shared alone, the old cdp_fallback_port as the second', () => {
  let { source, browsers } = effectiveBrowsers({});
  assert.equal(source, 'default');
  assert.deepEqual(browsers.map((b) => [b.name, b.type]), [['chrome-shared', 'chrome-shared']]);
  assert.equal(browsers[0].tool_prefix, 'mcp__plugin_chrome-shared_browser__');
  ({ browsers } = effectiveBrowsers({ browser: { cdp_fallback_port: 9333 } }));
  assert.deepEqual(browsers.map((b) => [b.type, b.cdp_port, b.legacy ?? false]), [['chrome-shared', browsers[0].cdp_port, false], ['cdp', 9333, true]]);
});

test('browser.browsers keeps the configured order and fills only the gaps', () => {
  const { source, browsers } = effectiveBrowsers({ browser: { browsers: [
    { name: 'Chromium (jobs)', type: 'cdp', cdp_port: 9333, user_profile: true },
    { name: 'chrome-shared', type: 'chrome-shared', cdp_port: 9555 },
  ] } });
  assert.equal(source, 'config');
  assert.deepEqual(browsers.map((b) => b.name), ['Chromium (jobs)', 'chrome-shared']);
  assert.equal(browsers[0].user_profile, true);
  assert.equal(browsers[0].may_start, false);
  assert.equal(browsers[1].cdp_port, 9555);
  assert.equal(browsers[1].enabled, true);
});

test('browserProblems: types, ports, names, prefixes', () => {
  const p = browserProblems({ browser: { browsers: [
    { name: 'a', type: 'cdp' },
    { name: 'A', type: 'cdp', cdp_port: 9333 },
    { name: 'b', type: 'mcp' },
    { name: 'c', type: 'firefox' },
    { name: 'd', type: 'cdp', cdp_port: 70000 },
    { name: 'e', type: 'cdp', cdp_port: 9333, may_start: true },
  ] } });
  const all = p.errors.join('\n');
  assert.match(all, /browsers\[0\] is a cdp browser without cdp_port/);
  assert.match(all, /the name "A" is used twice/);
  assert.match(all, /mcp browser without tool_prefix/);
  assert.match(all, /type is "firefox"/);
  assert.match(all, /cdp_port must be a port number/);
  assert.match(all, /cdp_port 9333 is also A/);
  assert.match(p.warnings.join('\n'), /may_start is true but there is no start_command/);
  assert.deepEqual(browserProblems({ browser: { browsers: [{ name: 'chrome-shared', type: 'chrome-shared' }] }, mail: { access: 'none' } }).errors, []);
});

test('browserProblems: the old field next to the list is a warning; alone a note', () => {
  const both = browserProblems({ browser: { cdp_fallback_port: 9333, browsers: [{ name: 'chrome-shared', type: 'chrome-shared' }] } });
  assert.match(both.warnings.join('\n'), /cdp_fallback_port is ignored/);
  assert.match(browserProblems({ browser: { cdp_fallback_port: 9333 } }).notes.join('\n'), /pre-1\.12 form/);
  assert.match(browserProblems({}).notes.join('\n'), /browser\.browsers is not set/);
});

test('mail: access, tool prefix and the permission', () => {
  assert.deepEqual(mailSettings({}), { access: 'none', read_verification_codes: false });
  assert.equal(mailSettings({ mail: { access: 'mcp', tool_prefix: 'mcp__x__', read_verification_codes: true } }).read_verification_codes, true);
  let p = browserProblems({ mail: { access: 'imap' } });
  assert.match(p.errors.join('\n'), /mail\.access is "imap"/);
  p = browserProblems({ mail: { access: 'mcp' } });
  assert.match(p.errors.join('\n'), /mail\.tool_prefix is empty/);
  p = browserProblems({ mail: { access: 'none', read_verification_codes: true } });
  assert.match(p.warnings.join('\n'), /read_verification_codes is true but there is no mail access/);
  p = browserProblems({ mail: { access: 'mcp', tool_prefix: 'mcp__x__', read_verification_codes: 'yes' } });
  assert.match(p.errors.join('\n'), /must be true or false/);
  assert.match(browserProblems({}).notes.join('\n'), /mail is not set/);
});

test('checkBrowser: a port that answers is ok, a silent one down — chrome-shared idle', async () => {
  const ok = await checkBrowser({ name: 'x', type: 'cdp', cdp_port: port, enabled: true });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.browser, 'Chrome/150.0.0.0');
  assert.equal(ok.exposed, undefined); // the fake listens on 127.0.0.1 only
  const down = await checkBrowser({ name: 'y', type: 'cdp', cdp_port: freePort, enabled: true, start_command: 'true' });
  assert.equal(down.status, 'down');
  assert.match(down.detail, /start_command/);
  const idle = await checkBrowser({ name: 'chrome-shared', type: 'chrome-shared', cdp_port: freePort, proxy_port: 9227, enabled: true });
  assert.equal(idle.status, 'idle');
  assert.equal((await checkBrowser({ name: 'z', type: 'mcp', tool_prefix: 'mcp__x__' })).status, 'tools');
  assert.equal((await checkBrowser({ name: 'w', type: 'cdp', cdp_port: port, enabled: false })).status, 'disabled');
});

test('the schema documents the same browser types and mail access values as the script', () => {
  const b = SCHEMA.properties.browser.properties.browsers.items;
  assert.deepEqual(b.properties.type.enum, BROWSER_TYPES);
  assert.equal(b.additionalProperties, false);
  assert.deepEqual(SCHEMA.properties.mail.properties.access.enum, MAIL_ACCESS);
  assert.equal(SCHEMA.properties.mail.properties.read_verification_codes.type, 'boolean');
});
