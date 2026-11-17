// The owner-run tools setup (scripts/owner/pingone-tools-setup.mjs). No network: the PingOne Management API is an in-process fake fetch, as in owner-setup.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as tools from './owner/pingone-tools-setup.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cal-tools-'));
const IDS = { env: '11111111-1111-1111-1111-111111111111', admin: '22222222-2222-2222-2222-222222222222' };
const AGENT_NAME = 'Appfire Agent Governance LAB Agent';
const SECRETS = ['admin-secret-xyz', 'admin-client', IDS.env, IDS.admin, 'app-agent-0123456789'];

// state: what the fake tenant already holds. Every call is recorded; a write is a call that is not a GET (or the admin token).
function fakePingOne({ agent = true, resource = null, scopes = [], attrs = [], groups = [], grants = [], twoAgents = false, resourceExtra = [] } = {}) {
  const calls = [];
  const state = {
    resources: resource ? [{ id: 'r-tools', ...resource }] : [], scopes: { 'r-tools': scopes.map((n, i) => ({ id: `s-${i}-${n}`, name: n })) }, attrs: { 'r-tools': attrs.map((a, i) => ({ id: `at${i}`, ...a })) },
    groups: groups.map((n, i) => ({ id: `g${i}`, name: n })), grants: { 'app-agent-0123456789': grants.map((g) => ({ ...g })) },
  };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push(`${method} ${decodeURIComponent(url)}`);
    if (url === `https://auth.pingone.com/${IDS.admin}/as/token`) return json(200, { access_token: 'admin-token' });
    const base = `https://api.pingone.com/v1/environments/${IDS.env}`;
    assert.ok(url.startsWith(base), `unexpected host or env: ${url}`);
    assert.equal(init.headers.authorization, 'Bearer admin-token');
    const p = decodeURIComponent(url.slice(base.length)); const body = init.body ? JSON.parse(init.body) : null;
    if (method === 'GET' && p === '') return json(200, { id: IDS.env });
    if (method === 'GET' && p === '/applications') return json(200, { _embedded: { applications: [...(agent ? [{ id: 'app-agent-0123456789', name: AGENT_NAME }] : []), ...(twoAgents ? [{ id: 'app-agent-2', name: AGENT_NAME }] : []), { id: 'app-user-1', name: 'Appfire Agent Governance LAB Sign-in' }] } });
    if (method === 'GET' && p === '/resources') return json(200, { _embedded: { resources: [{ id: 'r-oidc', name: 'openid', type: 'OPENID_CONNECT' }, ...state.resources, ...resourceExtra] } });
    if (method === 'POST' && p === '/resources') { const r = { id: 'r-tools', ...body }; state.resources.push(r); return json(201, r); }
    let m;
    if ((m = /^\/resources\/([^/]+)\/scopes$/.exec(p))) {
      if (method === 'GET') return json(200, { _embedded: { scopes: state.scopes[m[1]] || [] } });
      if (method === 'POST') { const sc = { id: `s-new-${body.name}`, ...body }; (state.scopes[m[1]] ||= []).push(sc); return json(201, sc); }
    }
    if ((m = /^\/resources\/([^/]+)\/attributes$/.exec(p))) {
      if (method === 'GET') return json(200, { _embedded: { attributes: state.attrs[m[1]] || [] } });
      if (method === 'POST') { (state.attrs[m[1]] ||= []).push({ id: 'at-new', ...body }); return json(201, body); }
    }
    if (method === 'GET' && p.startsWith('/groups?filter=')) return json(200, { _embedded: { groups: state.groups.filter((g) => p.includes(`"${g.name}"`)) } });
    if (method === 'POST' && p === '/groups') { state.groups.push({ id: 'g-new', ...body }); return json(201, body); }
    if ((m = /^\/applications\/([^/]+)\/grants$/.exec(p))) {
      if (method === 'GET') return json(200, { _embedded: { grants: state.grants[m[1]] || [] } });
      (state.grants[m[1]] ||= []).push({ id: 'g-grant', ...body }); return json(201, body);
    }
    if ((m = /^\/applications\/([^/]+)\/grants\/([^/]+)$/.exec(p)) && method === 'PUT') { const g = state.grants[m[1]].find((x) => x.id === m[2]); Object.assign(g, body); return json(200, g); }
    throw new Error(`fake PingOne has no route for ${method} ${p}`);
  };
  return { fetchImpl, calls, state };
}
const writesOf = (p1) => p1.calls.filter((c) => !c.startsWith('GET ') && !c.endsWith('/as/token'));
// the same writes without the host and environment, one "VERB /path" each
const shortWrites = (p1) => writesOf(p1).map((c) => c.replace(`https://api.pingone.com/v1/environments/${IDS.env}`, '').replace('/applications/app-agent-0123456789', '/applications/<agent>'));

function labFiles({ envText } = {}) {
  const dir = tmp(); const envFile = path.join(dir, '.env'); const credFile = path.join(dir, 'provisioning.json');
  fs.writeFileSync(envFile, envText ?? `PINGONE_ENVIRONMENT_ID=${IDS.env}\nPINGONE_REGION=com\nAAG_AGENT_CLIENT_ID=app-agent-0123456789\nAAG_AGENT_CLIENT_SECRET=agent-secret-never-printed\n`, { mode: 0o600 });
  fs.writeFileSync(credFile, `PINGONE_REGION=com\nPINGONE_ADMIN_ENV_ID=${IDS.admin}\nPINGONE_ADMIN_CLIENT_ID=admin-client\nPINGONE_ADMIN_CLIENT_SECRET=admin-secret-xyz\n`, { mode: 0o600 });
  return { dir, envFile, credFile };
}
const capture = () => { const out = []; return { out, log: (l) => out.push(String(l)) }; };
const assertNoSecretOrId = (text) => { for (const s of [...SECRETS, 'agent-secret-never-printed']) assert.ok(!text.includes(s), `printed: ${s.slice(0, 6)}...`); };
const scopesGranted = (p1) => (p1.state.grants['app-agent-0123456789'] || []).filter((g) => g.resource.id === 'r-tools').flatMap((g) => g.scopes.map((s) => s.id)).sort();
const TOOLS_RES = { name: 'Appfire Work Suite Tools', type: 'CUSTOM', audience: 'appfire-work-tools' };
const ALL = tools.TOOLS_SCOPES.map((s) => s.name);
const attrsOk = [{ name: 'act', value: tools.ACT_EXPRESSION }, { name: 'groups', value: tools.GROUPS_EXPRESSION }];

test('the fixed facts: one resource, its audience, six scopes, two attributes, the tier group, and the defaults the .env may carry', () => {
  assert.equal(tools.TOOLS_RESOURCE_NAME, 'Appfire Work Suite Tools'); assert.equal(tools.TOOLS_AUDIENCE, 'appfire-work-tools'); assert.equal(tools.TIER_GROUP, 'Software_EnterpriseTier');
  assert.deepEqual(ALL, ['issues:read', 'issues:write', 'security:read', 'release:read', 'deploy:read', 'admin:request']);
  assert.deepEqual(tools.TOOLS_ATTRIBUTES.map((a) => a.name), ['act', 'groups']);
  assert.equal(tools.ACT_EXPRESSION, '${#root.context.requestData.subjectToken.act}');
  assert.deepEqual(tools.ENV_HINTS, [['AAG_PROVIDER', 'auto'], ['AAG_TOOLS_AUDIENCE', 'appfire-work-tools'], ['AAG_TOOLS_TIER_GROUP', 'Software_EnterpriseTier']]);
  // PingOne refuses a description with any of $ + < = > ^ ` | ~
  for (const d of [tools.TOOLS_RESOURCE.description, tools.TIER_GROUP_SPEC.description, ...tools.TOOLS_SCOPES.map((s) => s.description)]) assert.ok(!/[$+<=>^`|~]/.test(d), d);
});

test('arguments: dry run is the default; --apply and --env-file parse; bad combinations are refused', () => {
  const d = tools.parseArgs([]); assert.equal(d.apply, false); assert.equal(d.envFile, path.join(root, '.env'));
  assert.equal(tools.parseArgs(['--apply', '--env-file', '/x/.env']).apply, true); assert.equal(tools.parseArgs(['--env-file', '/x/.env']).envFile, '/x/.env');
  assert.throws(() => tools.parseArgs(['--apply', '--dry-run']), /pick one/); assert.throws(() => tools.parseArgs(['--env-file']), /needs a value/);
  assert.throws(() => tools.parseArgs(['--env-file', '--apply']), /needs a value/); assert.throws(() => tools.parseArgs(['--force']), /unknown argument/);
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/owner/pingone-tools-setup.mjs'), '--force'], { encoding: 'utf8', env: { ...process.env, STANDALONE_CRED_FILE: '/nonexistent' } });
  assert.equal(r.status, 2); assert.match(r.stderr, /refusing: unknown argument/);
});

test('dry run on an empty tenant: only reads, says what it would create, and prints no secret or id', async () => {
  const { envFile, credFile } = labFiles(); const p1 = fakePingOne(); const { out, log } = capture();
  const r = await tools.run(tools.parseArgs(['--env-file', envFile]), { fetchImpl: p1.fetchImpl, log, credFile });
  assert.equal(r.applied, false); assert.deepEqual(writesOf(p1), []);
  assert.ok(p1.calls.every((c) => c.startsWith('GET ') || c.endsWith('/as/token')));
  const text = out.join('\n');
  assert.match(text, /DRY RUN/); assert.match(text, /resource "Appfire Work Suite Tools" \(audience appfire-work-tools\): would create/);
  for (const n of ALL) assert.match(text, new RegExp(`scope ${n}: would create`));
  assert.match(text, /attribute act: would create/); assert.match(text, /attribute groups: would create/); assert.match(text, /group Software_EnterpriseTier: would create/);
  assert.match(text, /would grant issues:read issues:write security:read release:read deploy:read admin:request/);
  assert.match(text, /AAG_PROVIDER=auto/); assert.match(text, /Dry run done/);
  assertNoSecretOrId(text);
});

test('--apply on an empty tenant creates the resource, the six scopes, both attributes, the group and the agent grant, in that order, and nothing else', async () => {
  const { envFile, credFile } = labFiles(); const p1 = fakePingOne(); const { out, log } = capture();
  const r = await tools.run(tools.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log, credFile });
  assert.equal(r.applied, true); assert.deepEqual(r.decisions, []);
  const w = shortWrites(p1);
  assert.deepEqual(w, ['POST /resources', ...ALL.map(() => 'POST /resources/r-tools/scopes'), 'POST /resources/r-tools/attributes', 'POST /resources/r-tools/attributes', 'POST /groups', 'POST /applications/<agent>/grants']);
  const res = p1.state.resources[0];
  assert.deepEqual({ name: res.name, type: res.type, audience: res.audience }, TOOLS_RES);
  assert.deepEqual(p1.state.scopes['r-tools'].map((s) => s.name), ALL);
  assert.deepEqual(p1.state.attrs['r-tools'].map((a) => [a.name, a.value, a.type]), [['act', tools.ACT_EXPRESSION, 'CUSTOM'], ['groups', tools.GROUPS_EXPRESSION, 'CUSTOM']]);
  assert.deepEqual(p1.state.groups.map((g) => g.name), ['Software_EnterpriseTier']);
  assert.deepEqual(scopesGranted(p1), ALL.map((n) => `s-new-${n}`).sort(), 'the agent app holds all six scopes');
  const text = out.join('\n');
  assert.match(text, /OWNER STEP: add the users who should get the premium tier to the group Software_EnterpriseTier/); assert.match(text, /UNVERIFIED: that the groups claim appears in an EXCHANGED token/);
  assertNoSecretOrId(text);
});

test('idempotent: a second --apply on a finished tenant changes nothing; every object is reported present', async () => {
  const { envFile, credFile } = labFiles();
  const p1 = fakePingOne({ resource: TOOLS_RES, scopes: ALL, attrs: attrsOk, groups: ['Software_EnterpriseTier'] });
  p1.state.grants['app-agent-0123456789'] = [{ id: 'g-grant', resource: { id: 'r-tools' }, scopes: ALL.map((n) => ({ id: `s-${ALL.indexOf(n)}-${n}` })) }];
  const { out, log } = capture();
  const r = await tools.run(tools.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log, credFile });
  assert.equal(r.applied, true); assert.deepEqual(r.decisions, []); assert.deepEqual(writesOf(p1), [], 'no POST, PUT or DELETE');
  const text = out.join('\n');
  assert.match(text, /resource "Appfire Work Suite Tools" \(audience appfire-work-tools\): found, reused/); assert.match(text, /scope issues:read: present/);
  assert.match(text, /attribute act: present, as expected/); assert.match(text, /attribute groups: present, as expected/); assert.match(text, /group Software_EnterpriseTier: found, reused/); assert.match(text, /already granted/);
});

test('partial tenant: only the missing parts are created; the existing resource, scopes, attributes and group are reused as they are', async () => {
  const { envFile, credFile } = labFiles();
  const p1 = fakePingOne({ resource: TOOLS_RES, scopes: ['issues:read', 'issues:write', 'security:read'], attrs: [{ name: 'act', value: tools.ACT_EXPRESSION }] });
  const { log } = capture();
  await tools.run(tools.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log, credFile });
  const w = shortWrites(p1);
  assert.deepEqual(w, ['POST /resources/r-tools/scopes', 'POST /resources/r-tools/scopes', 'POST /resources/r-tools/scopes', 'POST /resources/r-tools/attributes', 'POST /groups', 'POST /applications/<agent>/grants']);
  assert.equal(p1.state.scopes['r-tools'].length, 6); assert.deepEqual(p1.state.attrs['r-tools'].map((a) => a.name), ['act', 'groups']);
  assert.ok(!w.includes('POST /resources'), 'the resource is not created again');
});

test('an attribute that exists with another value is reported as DRIFT and never replaced; a stale grant is topped up, not replaced', async () => {
  const { envFile, credFile } = labFiles();
  const p1 = fakePingOne({ resource: TOOLS_RES, scopes: ALL, attrs: [{ name: 'act', value: tools.ACT_EXPRESSION }, { name: 'groups', value: "${user.somethingElse}" }], groups: ['Software_EnterpriseTier'] });
  p1.state.grants['app-agent-0123456789'] = [{ id: 'g-grant', resource: { id: 'r-tools' }, scopes: [{ id: 's-0-issues:read' }] }];
  const { out, log } = capture();
  const r = await tools.run(tools.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log, credFile });
  const text = out.join('\n');
  assert.match(text, /attribute groups: present but DIFFERENT/); assert.match(text, /never replaces an attribute/);
  assert.equal(r.decisions.length, 1); assert.match(r.decisions[0], /groups attribute of the tools resource differs/);
  assert.deepEqual(p1.state.attrs['r-tools'].find((a) => a.name === 'groups').value, '${user.somethingElse}', 'the existing value is untouched');
  assert.deepEqual(writesOf(p1).map((c) => c.split(' ')[0]), ['PUT'], 'only the grant is topped up');
  assert.equal(scopesGranted(p1).length, 6);
});

test('refusals before anything is written: no agent app, two agent apps, two resources with the audience, the name on another audience', async () => {
  const { envFile, credFile } = labFiles({ envText: `PINGONE_ENVIRONMENT_ID=${IDS.env}\nPINGONE_REGION=com\n` });
  const none = fakePingOne({ agent: false });
  await assert.rejects(tools.run(tools.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: none.fetchImpl, log: () => {}, credFile }), /was not found\. Run node scripts\/owner\/pingone-real-setup\.mjs --apply first/);
  assert.deepEqual(writesOf(none), []);
  const two = fakePingOne({ twoAgents: true });
  await assert.rejects(tools.run(tools.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: two.fetchImpl, log: () => {}, credFile }), /2 apps are named/);
  assert.deepEqual(writesOf(two), []);
  const dup = fakePingOne({ resource: TOOLS_RES, resourceExtra: [{ id: 'r-dup', name: 'Another', type: 'CUSTOM', audience: 'appfire-work-tools' }] });
  await assert.rejects(tools.run(tools.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: dup.fetchImpl, log: () => {}, credFile }), /2 resources have the audience appfire-work-tools/);
  assert.deepEqual(writesOf(dup), []);
  const named = fakePingOne({ resource: { name: 'Appfire Work Suite Tools', type: 'CUSTOM', audience: 'something-else' } });
  await assert.rejects(tools.run(tools.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: named.fetchImpl, log: () => {}, credFile }), /exists with another audience \(something-else\)/);
  assert.deepEqual(writesOf(named), []);
  const odd = fakePingOne({ resource: { name: 'Appfire Work Suite Tools', type: 'CUSTOM', audience: 'appfire-work-tools' } });
  odd.state.resources[0].id = 'x/../r-oidc';
  await assert.rejects(tools.run(tools.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: odd.fetchImpl, log: () => {}, credFile }), /not a plain id/);
  assert.deepEqual(writesOf(odd), []);
});

test('the agent app is found by AAG_AGENT_CLIENT_ID in the lab .env first, then by name; the .env is never written', async () => {
  const { envFile, credFile } = labFiles(); const before = fs.readFileSync(envFile, 'utf8');
  const p1 = fakePingOne({ twoAgents: true }); // two apps carry the name, but the .env names one by id
  await tools.run(tools.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: p1.fetchImpl, log: () => {}, credFile });
  assert.ok(p1.calls.some((c) => c.startsWith('POST ') && c.includes('/applications/app-agent-0123456789/grants')));
  assert.equal(fs.readFileSync(envFile, 'utf8'), before, 'the lab .env is untouched');
  assert.deepEqual(fs.readdirSync(path.dirname(envFile)).sort(), ['.env', 'provisioning.json']);
});

test('the script has no delete, never PUTs anything but the grant (through the shared helper) and posts only to the fixed collections', () => {
  const src = fs.readFileSync(path.join(root, 'scripts/owner/pingone-tools-setup.mjs'), 'utf8');
  assert.ok(!/'DELETE'|'PATCH'/.test(src));
  const writes = [...src.matchAll(/p1\.call\('(POST|PUT)', `?'?([^`',]*)/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(writes, ['POST /resources', 'POST /resources/${res.id}/scopes', 'POST /resources/${res.id}/attributes', 'POST /groups']);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(src), 'no hardcoded id');
  assert.ok(!/console\.log\([^)]*(secret|password)/i.test(src));
});

test('a PingOne error names the call and the reason with ids hidden and no secret', async () => {
  const { envFile, credFile } = labFiles();
  const p1 = fakePingOne();
  const bad = async (url, init = {}) => {
    if ((init.method || 'GET') === 'POST' && String(url).endsWith('/resources')) return { ok: false, status: 400, json: async () => ({}), text: async () => JSON.stringify({ code: 'INVALID_DATA', details: [{ code: 'INVALID_VALUE', target: 'audience', message: `bad ${IDS.env}` }] }) };
    return p1.fetchImpl(url, init);
  };
  await assert.rejects(tools.run(tools.parseArgs(['--apply', '--env-file', envFile]), { fetchImpl: bad, log: () => {}, credFile }), (e) => {
    assert.match(e.message, /POST \/resources -> HTTP 400 INVALID_DATA INVALID_VALUE \(audience\) bad <id>/); assertNoSecretOrId(e.message); return true;
  });
});

test('the README and the owner steps name the tools setup', () => {
  const r = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(r, /node scripts\/owner\/pingone-tools-setup\.mjs --apply/);
  const o = fs.readFileSync(path.join(root, 'docs/owner-steps.md'), 'utf8');
  assert.match(o, /node scripts\/owner\/pingone-tools-setup\.mjs/);
});
