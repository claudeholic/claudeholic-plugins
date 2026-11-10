// SPDX-License-Identifier: GPL-3.0-only
// crek-agents: the agent type and model of each CREK agent role, the project copies of the agent
// definitions for a model that is not an alias, and the plugin's agent files themselves.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  agentPlan, agentProblems, syncAgents, renderAgent, familyAlias, ROLES, MODEL_ALIASES, DEFAULT_MODEL,
  MARKER, PLUGIN_ROOT,
} from '../assets/crek-agents.mjs';

const SCRIPT = fileURLToPath(new URL('../assets/crek-agents.mjs', import.meta.url));
const CHECK = fileURLToPath(new URL('../assets/crek-config-check.mjs', import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'assets', 'crek.schema.json'), 'utf8'));
let dir;
let n = 0;
const project = () => { const d = join(dir, `p${n++}`); mkdirSync(d); return d; };

before(() => { dir = mkdtempSync(join(tmpdir(), 'crek-test-agents-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

/** Frontmatter as {key: raw value}, and the body. */
function parse(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, 'frontmatter between --- lines');
  const front = {};
  for (const line of m[1].split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    assert.ok(kv, `frontmatter line "${line}" is key: value`);
    front[kv[1]] = kv[2];
  }
  return { front, body: m[2] };
}

test('the plugin ships one agent file per role, with a valid frontmatter and an alias model', () => {
  const files = readdirSync(join(PLUGIN_ROOT, 'agents')).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(files, Object.values(ROLES).map((r) => r.file).sort());
  for (const [role, r] of Object.entries(ROLES)) {
    const { front, body } = parse(readFileSync(join(PLUGIN_ROOT, 'agents', r.file), 'utf8'));
    assert.equal(front.name, r.name, `${r.file}: name`);
    assert.doesNotMatch(front.name, /:/, 'a name never holds ":" (reserved for the plugin prefix)');
    assert.ok(JSON.parse(front.description).length > 40, `${r.file}: description`);
    assert.equal(front.model, DEFAULT_MODEL, `${r.file}: the default model`);
    assert.equal(front.disallowedTools, 'Agent', `${r.file}: agents start no agents of their own`);
    for (const ignored of ['hooks', 'mcpServers', 'permissionMode', 'initialPrompt']) {
      assert.equal(front[ignored], undefined, `${r.file}: ${ignored} is ignored in plugin agents`);
    }
    assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}/, `${role}: the body names the plugin root`);
  }
});

test('the skills name no model: the model comes from the config', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.md') ? [join(d, e.name)] : []));
  for (const f of walk(join(PLUGIN_ROOT, 'skills'))) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /\b(sonnet|opus|haiku|fable)\b|claude-[a-z]+-\d/i, f);
  }
  const scan = readFileSync(join(PLUGIN_ROOT, 'skills', 'job-scan', 'SKILL.md'), 'utf8');
  assert.match(scan, /crek-agents\.mjs" --config crek\.config\.json --sync/);
  for (const role of Object.keys(ROLES)) assert.match(scan, new RegExp(`role \`${role}\``));
});

test('no agents block: every role on the plugin agent type with the default alias', () => {
  const plan = agentPlan({});
  for (const [role, r] of Object.entries(ROLES)) {
    assert.deepEqual(plan[role], { subagent_type: `crek:${r.name}`, model: DEFAULT_MODEL, configured: DEFAULT_MODEL, from: 'default' });
  }
  assert.equal(DEFAULT_MODEL, 'sonnet');
  const { errors, notes } = agentProblems({});
  assert.deepEqual(errors, []);
  assert.match(notes.join('\n'), /agents is not set/);
});

test('agents.model for every role, agents.roles for one', () => {
  const plan = agentPlan({ agents: { model: 'opus', roles: { assessor: 'haiku' } } });
  assert.equal(plan.collector.model, 'opus');
  assert.equal(plan.collector.from, 'agents.model');
  assert.equal(plan.login_board.subagent_type, 'crek:login-board');
  assert.equal(plan.assessor.model, 'haiku');
  assert.equal(plan.assessor.from, 'agents.roles.assessor');
});

test('a full model ID or inherit: the project agent type, no model parameter, a fallback', () => {
  const plan = agentPlan({ agents: { model: 'claude-sonnet-5', roles: { login_board: 'inherit' } } });
  assert.deepEqual(plan.collector, {
    subagent_type: 'crek-collector', model: null, configured: 'claude-sonnet-5', from: 'agents.model',
    file: join('.claude', 'agents', 'crek-collector.md'),
    fallback: { subagent_type: 'crek:collector', model: 'sonnet' },
  });
  assert.equal(plan.login_board.subagent_type, 'crek-login-board');
  assert.deepEqual(plan.login_board.fallback, { subagent_type: 'crek:login-board', model: null });
  assert.equal(familyAlias('us.anthropic.claude-opus-5-v1:0'), 'opus');
  assert.equal(familyAlias('inherit'), null);
});

test('agentProblems: types, values, roles and fields', () => {
  const err = (agents) => agentProblems({ agents }).errors.join('\n');
  assert.match(err('sonnet'), /agents must be an object/);
  assert.match(err({ model: 5 }), /agents\.model must be a non-empty string/);
  assert.match(err({ model: '' }), /agents\.model must be a non-empty string/);
  assert.match(err({ model: 'sonnet 5' }), /agents\.model is "sonnet 5"/);
  assert.match(err({ model: 'x\nmodel: opus' }), /agents\.model is/);
  assert.match(err({ roles: { scanner: 'sonnet' } }), /agents\.roles\.scanner is not a CREK agent role/);
  assert.match(err({ roles: [] }), /agents\.roles must be an object/);
  assert.match(err({ modell: 'sonnet' }), /agents\.modell is not a known field/);
  for (const ok of ['sonnet', 'opus', 'inherit', 'claude-sonnet-5', 'sonnet[1m]', 'us.anthropic.claude-sonnet-5-v1:0']) {
    assert.equal(err({ model: ok }), '', ok);
  }
  assert.match(agentProblems({ agents: { model: 'gpt-9' } }).warnings.join('\n'), /check that Claude Code knows this model/);
  assert.match(agentProblems({ agents: { model: 'claude-sonnet-5' } }).notes.join('\n'), /project agent definition/);
});

test('the schema documents agents with the same rule for a model value', () => {
  const a = SCHEMA.properties.agents;
  assert.ok(a, 'agents in the schema');
  assert.equal(a.additionalProperties, false);
  assert.deepEqual(Object.keys(a.properties.roles.properties).sort(), Object.keys(ROLES).sort());
  const re = new RegExp(SCHEMA.$defs.agent_model.pattern);
  for (const v of ['sonnet', 'claude-sonnet-5', 'sonnet[1m]', 'inherit', 'us.anthropic.claude-sonnet-5-v1:0']) {
    assert.ok(re.test(v), v);
    assert.equal(agentProblems({ agents: { model: v } }).errors.length, 0, v);
  }
  for (const v of ['sonnet 5', '-x', 'a\nb']) {
    assert.ok(!re.test(v), v);
    assert.ok(agentProblems({ agents: { model: v } }).errors.length > 0, v);
  }
  for (const alias of MODEL_ALIASES) assert.match(SCHEMA.$defs.agent_model.description, new RegExp(alias));
});

test('renderAgent: the plugin definition with the model, a local name, the marker and the root filled in', () => {
  const text = renderAgent('collector', 'claude-sonnet-5');
  const { front, body } = parse(text);
  assert.ok(text.includes(MARKER));
  assert.equal(front.name, 'crek-collector');
  assert.equal(JSON.parse(front.model), 'claude-sonnet-5');
  assert.equal(front.disallowedTools, 'Agent');
  assert.doesNotMatch(body, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.ok(body.includes(PLUGIN_ROOT));
});

test('syncAgents: writes what the plan needs, says when a restart is needed, removes what it no longer needs', () => {
  const p = project();
  const cfg = { agents: { model: 'claude-sonnet-5', roles: { assessor: 'sonnet' } } };
  const dry = syncAgents(cfg, { projectDir: p, write: false });
  assert.equal(dry.plan.collector.file_status, 'missing');
  assert.equal(existsSync(join(p, '.claude')), false, 'a dry run writes nothing');

  const first = syncAgents(cfg, { projectDir: p });
  assert.deepEqual(first.written.sort(), [join('.claude', 'agents', 'crek-collector.md'), join('.claude', 'agents', 'crek-login-board.md')]);
  assert.equal(first.restart_needed, true, 'a new .claude/agents/ is not watched by a running session');
  assert.equal(existsSync(join(p, '.claude', 'agents', 'crek-assessor.md')), false);

  const again = syncAgents(cfg, { projectDir: p });
  assert.deepEqual(again.written, []);
  assert.equal(again.restart_needed, false);
  assert.equal(again.plan.collector.file_status, 'ok');

  const changed = syncAgents({ agents: { model: 'claude-opus-5-5', roles: { assessor: 'sonnet' } } }, { projectDir: p });
  assert.equal(changed.plan.collector.file_status, 'written');
  assert.match(readFileSync(join(p, '.claude', 'agents', 'crek-collector.md'), 'utf8'), /^model: "claude-opus-5-5"$/m);

  writeFileSync(join(p, '.claude', 'agents', 'my-own.md'), '---\nname: my-own\ndescription: x\n---\nmine\n');
  const back = syncAgents({ agents: { model: 'sonnet' } }, { projectDir: p });
  assert.deepEqual(back.removed.sort(), [join('.claude', 'agents', 'crek-collector.md'), join('.claude', 'agents', 'crek-login-board.md')]);
  assert.deepEqual(readdirSync(join(p, '.claude', 'agents')), ['my-own.md'], 'files CREK did not write stay');
});

test('syncAgents: a file of the same name that CREK did not write is never overwritten', () => {
  const p = project();
  mkdirSync(join(p, '.claude', 'agents'), { recursive: true });
  const own = '---\nname: crek-collector\ndescription: the user\'s own\nmodel: opus\n---\nmine\n';
  writeFileSync(join(p, '.claude', 'agents', 'crek-collector.md'), own);
  const r = syncAgents({ agents: { model: 'claude-sonnet-5' } }, { projectDir: p });
  assert.equal(r.plan.collector.file_status, 'foreign');
  assert.equal(r.plan.collector.subagent_type, 'crek:collector');
  assert.equal(r.plan.collector.model, 'sonnet');
  assert.equal(readFileSync(join(p, '.claude', 'agents', 'crek-collector.md'), 'utf8'), own);
  assert.equal(r.plan.login_board.file_status, 'written');
});

test('CLI: JSON plan, --sync next to the config, exit 1 on a broken agents block', () => {
  const p = project();
  const config = join(p, 'crek.config.json');
  writeFileSync(config, JSON.stringify({ agents: { model: 'claude-sonnet-5' } }));
  const dry = spawnSync(process.execPath, [SCRIPT, '--config', config], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).agents.collector.file_status, 'missing');
  const run = spawnSync(process.execPath, [SCRIPT, '--config', config, '--sync'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.restart_needed, true);
  assert.equal(out.agents.assessor.subagent_type, 'crek-assessor');
  assert.ok(existsSync(join(p, '.claude', 'agents', 'crek-assessor.md')));

  writeFileSync(config, JSON.stringify({ agents: { model: 'sonnet five' } }));
  const bad = spawnSync(process.execPath, [SCRIPT, '--config', config, '--sync'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /agents\.model is "sonnet five"/);
  assert.equal(bad.stdout, '');
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8' }).status, 2);
});

test('crek-config-check reports the agents block', () => {
  const p = project();
  writeFileSync(join(p, 'cv.pdf'), '%PDF-1.4 test');
  const base = {
    version: 2,
    candidate: { name: 'Jan Kowalski', email: 'jan@example.com' },
    criteria: { blockers: { contract_types: ['b2b'], min_rate: { amount: 150, unit: 'hour', currency: 'PLN' }, work_modes: ['remote'] } },
    cv: { master: 'cv.pdf', dir: 'CV' },
    db: { backend: 'http-api', path_or_url: 'https://crek.example.org/api.php' },
    presentation: { language: 'pl' },
    rate_policy: {},
  };
  const run = (cfg) => {
    const path = join(p, 'crek.config.json');
    writeFileSync(path, JSON.stringify(cfg), { mode: 0o600 });
    return spawnSync(process.execPath, [CHECK, path], { encoding: 'utf8' });
  };
  assert.match(run(base).stdout, /note\s+agents is not set/);
  const bad = run({ ...base, agents: { roles: { scanner: 'sonnet' } } });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /ERROR\s+agents\.roles\.scanner/);
  const ok = run({ ...base, agents: { model: 'claude-sonnet-5' } });
  assert.doesNotMatch(ok.stdout, /ERROR.*agents/);
});
