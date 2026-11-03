// SPDX-License-Identifier: GPL-3.0-only
// The http-api backend against a local stand-in server that behaves like api.php before crek 1.9
// (no GET jobs/{id}, a PUT carrying only contact_ids fails) — the server most installs still run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from '../assets/crek-db.mjs';

const AUTH = 'crek:pa:ss';
const state = { jobs: [], contacts: [], links: [], seq: 0, cseq: 0, requests: [] };
let server;
let base;

function rowOf(j) {
  const ids = state.links.filter((l) => l.job === j.id).map((l) => l.contact);
  const names = ids.map((id) => state.contacts.find((c) => c.id === id)?.name);
  return { ...j, contact_ids: ids.length ? ids.join(',') : null, contact_names: names.length ? names.join('||') : null };
}

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const route = u.searchParams.get('route');
      state.requests.push({ method: req.method, route, auth: req.headers.authorization, token: req.headers['x-crek-token'], ctype: req.headers['content-type'], origin: req.headers.origin });
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers.authorization !== `Basic ${Buffer.from(AUTH).toString('base64')}`) return send(401, { error: 'auth' });
      const data = body ? JSON.parse(body) : null;
      let m;
      if (route === 'jobs' && req.method === 'GET') {
        let list = state.jobs.map(rowOf);
        if (u.searchParams.get('status')) list = list.filter((j) => j.status === u.searchParams.get('status'));
        return send(200, list);
      }
      if (route === 'jobs' && req.method === 'POST') {
        const j = { id: ++state.seq, status: 'new', found_at: `2026-11-0${state.seq} 10:00:00` };
        for (const [k, v] of Object.entries(data)) if (k !== 'contact_ids' && v !== '') j[k] = v;
        state.jobs.push(j);
        for (const c of data.contact_ids ?? []) state.links.push({ job: j.id, contact: c });
        return send(200, { id: String(j.id) }); // old PDO servers answer the id as a string
      }
      if ((m = route.match(/^jobs\/(\d+)$/)) && req.method === 'PUT') {
        const j = state.jobs.find((x) => x.id === Number(m[1]));
        const sets = Object.keys(data).filter((k) => k !== 'contact_ids');
        if (!sets.length) return send(500, { error: 'SQLSTATE[42000]: empty SET' });
        if (j) for (const k of sets) j[k] = data[k] === '' ? null : data[k];
        if ('contact_ids' in data) {
          state.links = state.links.filter((l) => l.job !== Number(m[1]));
          for (const c of data.contact_ids) state.links.push({ job: Number(m[1]), contact: c });
        }
        return send(200, { ok: true });
      }
      if (route === 'contacts' && req.method === 'GET') return send(200, state.contacts.map((c) => ({ ...c, job_count: 0 })));
      if (route === 'contacts' && req.method === 'POST') {
        let c = state.contacts.find((x) => x.name === data.name && x.company_name === data.company_name);
        if (!c) { c = { id: ++state.cseq, name: data.name, company_name: data.company_name }; state.contacts.push(c); }
        for (const f of ['role', 'phone', 'email', 'linkedin_url', 'notes']) c[f] = data[f] ?? null; // ON DUPLICATE KEY UPDATE
        return send(200, { id: c.id });
      }
      if (route === 'stats') return send(200, { total: state.jobs.length, by_status: [], by_source: [], avg_match: null, contacts_count: state.contacts.length });
      return send(404, { error: 'Not found' });
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}/crek/api.php?route=`;
});
after(() => server.close());

test('http: basic auth on every call, JSON content type on writes, no Origin', async () => {
  const db = await openDb({ backend: 'http-api', path_or_url: base, auth: AUTH });
  const id = await db.insertJob({ title: 'Platform Engineer', notes: '', technologies: ['Go'], source_url: 'https://example.com/jobs/1' });
  assert.equal(id, 1);
  const post = state.requests.find((r) => r.method === 'POST');
  assert.equal(post.ctype, 'application/json');
  assert.equal(post.origin, undefined);
  assert.ok(state.requests.every((r) => r.auth?.startsWith('Basic ')));
  assert.equal(state.jobs[0].technologies, '["Go"]');
  assert.equal('notes' in state.jobs[0], false);
});

test('http: getJob falls back to the list on servers without GET jobs/{id}', async () => {
  const db = await openDb({ backend: 'http-api', path_or_url: base, auth: AUTH });
  assert.equal((await db.getJob(1)).title, 'Platform Engineer');
  assert.equal(await db.getJob(99), null);
});

test('http: linking contacts works on old servers (PUT never carries contact_ids alone)', async () => {
  const db = await openDb({ backend: 'http-api', path_or_url: base, auth: AUTH });
  const c1 = await db.upsertContact({ name: 'Ann Lee', company_name: 'Initech', email: 'ann@example.com' });
  const c2 = await db.upsertContact({ name: 'Bob Roe', company_name: 'Initech' });
  assert.equal(await db.linkContacts(1, [c1]), true);
  assert.equal(await db.linkContacts(1, [c2]), true);
  assert.deepEqual((await db.getJob(1)).contact_ids.split(','), ['1', '2']);
  assert.equal(await db.updateJob(1, { contact_ids: [c2] }), true);
  assert.equal((await db.getJob(1)).contact_ids, '2');
});

test('http: contact upsert keeps fields it is not given, even on an overwriting server', async () => {
  const db = await openDb({ backend: 'http-api', path_or_url: base, auth: AUTH });
  await db.upsertContact({ name: 'Ann Lee', company_name: 'Initech', role: 'recruiter' });
  const ann = (await db.listContacts()).find((c) => c.name === 'Ann Lee');
  assert.equal(ann.email, 'ann@example.com');
  assert.equal(ann.role, 'recruiter');
});

test('http: errors are readable', async () => {
  const bad = await openDb({ backend: 'http-api', path_or_url: base, auth: 'wrong:creds' });
  await assert.rejects(bad.listJobs(), /HTTP 401/);
  const down = await openDb({ backend: 'http-api', path_or_url: 'http://127.0.0.1:9/api.php', auth: AUTH });
  await assert.rejects(down.listJobs(), /unreachable/);
});

test('http: crek-match reads the API through --config', async () => {
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'crek-test-http-'));
  try {
    const cfg = join(dir, 'crek.config.json');
    writeFileSync(cfg, JSON.stringify({ version: 2, db: { backend: 'http-api', path_or_url: base, auth: AUTH }, presentation: { language: 'en' } }));
    const script = fileURLToPath(new URL('../assets/crek-match.mjs', import.meta.url));
    const child = spawn(process.execPath, [script, '--config', cfg, '--json'], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end(JSON.stringify([{ title: 'Platform Engineer', url: 'https://example.com/jobs/1?utm_source=x' }]));
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    const code = await new Promise((ok) => child.on('close', ok));
    assert.equal(code, 0, err);
    const [r] = JSON.parse(out);
    assert.equal(r.candidate, 'Platform Engineer');
    assert.ok(r.matches.some((x) => x.id === 1 && x.exact));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('http: append falls back to read-and-write on servers without the append route', async () => {
  const db = await openDb({ backend: 'http-api', path_or_url: base, auth: AUTH });
  const id = await db.insertJob({ title: 'Old server append', notes: 'first  ' });
  const n = state.requests.length;
  assert.equal(await db.appendJob(id, 'notes', '03.11.2026: second'), true);
  const sent = state.requests.slice(n).map((r) => `${r.method} ${r.route}`);
  assert.equal(sent[0], `POST jobs/${id}/append`, 'the atomic route is tried first');
  assert.ok(sent.includes(`PUT jobs/${id}`), 'then the old way');
  assert.equal(state.jobs.find((j) => j.id === id).notes, 'first\n03.11.2026: second');
  assert.equal(await db.appendJob(9999, 'notes', 'x'), false);
});

test('http: db.token goes in X-Crek-Token next to basic auth; without it nothing is sent', async () => {
  const token = 'f'.repeat(64);
  const db = await openDb({ backend: 'http-api', path_or_url: base, auth: AUTH, token });
  const n = state.requests.length;
  await db.listJobs();
  const [r] = state.requests.slice(n);
  assert.equal(r.token, token);
  assert.ok(r.auth.startsWith('Basic '));
  const plain = await openDb({ backend: 'http-api', path_or_url: base, auth: AUTH });
  await plain.listJobs();
  assert.equal(state.requests.at(-1).token, undefined);
});
