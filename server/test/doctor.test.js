import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allPassed, runChecks } from '../src/doctor.js';
import { fullSettingsFor } from './fakePingone.js';
import { createHealth } from '../src/health.js';

test('every doctor check passes on a clean default environment', async () => {
  const c = await runChecks({ env: { HOME: '/nonexistent' } });
  assert.ok(allPassed(c), JSON.stringify(c.filter((x) => x.level === 'fail')));
  for (const id of ['node', 'mode', 'bind', 'port-range', 'settings-file', 'mock-signin', 'web', 'manifest', 'steps', 'engine', 'verticals', 'story-hosts', 'story-keys', 'masking', 'mock-key', 'netguard', 'tenant']) assert.ok(c.some((x) => x.id === id), id);
  assert.match(c.find((x) => x.id === 'engine').detail, /all 87 run in mock/);
  assert.match(c.find((x) => x.id === 'engine').detail, /54 computed ones equals.*the other 33 are guided pages.*not checked/, 'the doctor line cannot be read as 87 verified');
});

test('a port outside 7814-7839 fails, and a wildcard bind needs the opt-in', async () => {
  for (const p of ['5010', '7799', '7840', '7300']) assert.equal((await runChecks({ env: { PORT: p } })).find((c) => c.id === 'port-range').level, 'fail', p);
  assert.equal((await runChecks({ env: { PORT: '7815' } })).find((c) => c.id === 'port-range').level, 'pass');
  assert.equal((await runChecks({ env: { PORT: '7815', CALAB_BIND: '0.0.0.0' } })).find((c) => c.id === 'bind').level, 'pass');
  assert.equal((await runChecks({ env: { PORT: '7815', CALAB_BIND: '' } })).find((c) => c.id === 'bind').level, 'pass');
});

test('the mode must be mock or live; mock-signin is information, not a failure', async () => {
  assert.equal((await runChecks({ env: { AAG_LAB_MODE: 'prod' } })).find((c) => c.id === 'mode').level, 'fail');
  assert.equal((await runChecks({ env: { AAG_LAB_MODE: 'live' } })).find((c) => c.id === 'mode').level, 'pass');
  const live = (await runChecks({ env: { AAG_LAB_MODE: 'live' } })).find((c) => c.id === 'mode');
  assert.match(live.detail, /does not check or switch on the live guard/); assert.doesNotMatch(live.detail, /can be selected only/);
  assert.equal((await runChecks({ env: {} })).find((c) => c.id === 'mock-signin').level, 'info');
  assert.equal((await runChecks({ env: { ALLOW_MOCK_SIGNIN: '1' } })).find((c) => c.id === 'mock-signin').level, 'pass');
});

test('the settings file: absent is fine, a world-readable one is flagged, its values are never printed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-env-'));
  const f = path.join(dir, '.env'); fs.writeFileSync(f, 'SECRET_THING=hunter2hunter2\n', { mode: 0o644 });
  try {
    const c = (await runChecks({ env: { AAG_ENV_FILE: f } })).find((x) => x.id === 'settings-file');
    assert.equal(c.level, 'info'); assert.ok(!JSON.stringify(c).includes('hunter2'));
    fs.chmodSync(f, 0o600);
    assert.equal((await runChecks({ env: { AAG_ENV_FILE: f } })).find((x) => x.id === 'settings-file').level, 'pass');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('owner 2026-11-09: the doctor says which file it reads (the app\'s own .env by default) and lists missing Live settings by name, never a value', async () => {
  const dflt = (await runChecks({ env: {} })).find((x) => x.id === 'settings-file');
  assert.match(dflt.detail, /reads \S+\/\.env \(this app's \.env beside docker-compose\.yml\)/); assert.doesNotMatch(dflt.detail, new RegExp('STANDALONE' + '_ENV'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-doc-env-'));
  const f = path.join(dir, '.env');
  try {
    const at = async () => (await runChecks({ env: { AAG_ENV_FILE: f } })).find((x) => x.id === 'settings-file');
    const none = await at(); assert.equal(none.level, 'info'); assert.ok(none.detail.includes(`reads ${f} (AAG_ENV_FILE): not there`)); assert.match(none.detail, /copy \.env\.example to \.env/);
    fs.writeFileSync(f, 'PINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_CLIENT_SECRET=hunter2hunter2\n', { mode: 0o600 });
    const partial = await at(); assert.equal(partial.level, 'pass'); assert.match(partial.detail, /full-Real settings missing: AAG_USER_CLIENT_ID, AAG_USER_CLIENT_SECRET, AAG_AGENT_CLIENT_ID, AAG_AGENT_CLIENT_SECRET, AAG_DEMO_USERNAME \(/); assert.doesNotMatch(partial.detail, /PINGONE_ENVIRONMENT_ID/, 'a set name is not listed');
    assert.ok(!/hunter2|11111111/.test(partial.detail), 'no value printed');
    fs.writeFileSync(f, 'PINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=hunter2hunter2\n', { mode: 0o600 });
    const full = await at(); assert.match(full.detail, /full-Real settings missing: AAG_USER_CLIENT_ID/, 'the old worker client is not the full-Real settings'); assert.ok(!/hunter2|11111111|cid\b/.test(full.detail));
    fs.writeFileSync(f, `${Object.entries(fullSettingsFor('https://gw.lab-test.net/mcp')).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
    const all = await at(); assert.match(all.detail, /the full-Real settings are all set/); assert.ok(!all.detail.includes(fullSettingsFor('').AAG_USER_CLIENT_SECRET));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('health: unknown until the first check, ready when the checks pass, broken when one fails, unknown when the checker throws', async () => {
  const mk = (runChecks) => createHealth({ runChecks, intervalMs: 3_600_000, now: () => new Date('2026-11-01T00:00:00Z') });
  const states = [];
  for (const checks of [async () => [{ level: 'pass' }], async () => [{ level: 'fail' }], async () => { throw new Error('x'); }]) {
    const h = mk(checks); await h.ready;
    const res = { set() {}, json(b) { states.push(b.state); } };
    h.router.stack[0].route.stack[0].handle({}, res); h.stop();
  }
  assert.deepEqual(states, ['ready', 'broken', 'unknown']);
});

test('step 2: the web check is information, not a failure, when the app is not built, and passes when index.html exists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-doc-'));
  try {
    const none = (await runChecks({ env: { WEB_DIST: dir } })).find((c) => c.id === 'web');
    assert.equal(none.level, 'info'); assert.match(none.detail, /npm run build/);
    fs.writeFileSync(path.join(dir, 'index.html'), '<title>x</title>');
    assert.equal((await runChecks({ env: { WEB_DIST: dir } })).find((c) => c.id === 'web').level, 'pass');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('step 3 (option a): the live check is a pass when Real is not configured or switched off, information when a guard refuses, and a pass naming the one host when it can; no value is printed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-live-'));
  const f = path.join(dir, '.env');
  const secret = ['hunter2', 'hunter2', 'x9'].join('');
  try {
    const live = async (env) => (await runChecks({ env: { AAG_ENV_FILE: f, ...env } })).find((x) => x.id === 'live');
    fs.writeFileSync(f, '', { mode: 0o600 });
    assert.equal((await live({})).level, 'pass'); assert.match((await live({})).detail, /Real is not configured \(full Real needs PINGONE_ENVIRONMENT_ID, AAG_USER_CLIENT_ID.*\): Mock only/);
    fs.writeFileSync(f, `PINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=${secret}\n`, { mode: 0o600 });
    const off = await live({ AAG_ALLOW_LIVE: '0' }); assert.equal(off.level, 'pass'); assert.match(off.detail, /switched off \(AAG_ALLOW_LIVE=0\)/);
    const refused = await live({ IDP: 'mock' }); assert.equal(refused.level, 'info'); assert.match(refused.detail, /Real \(identity provider only\) is configured but refused: Real is off: IDP pins this lab to its own sign-in/);
    assert.equal((await live({})).level, 'pass', 'complete settings and no opt-in: Real is on');
    const ok = await live({ AAG_ALLOW_LIVE: '1', IDP: 'pingone' });
    assert.equal(ok.level, 'pass'); assert.match(ok.detail, /only to https:\/\/auth\.pingone\.com;/);
    assert.match((await live({})).detail, /Real, identity provider only \(the old worker client.*\): two calls, only to https:\/\/auth\.pingone\.com;/);
    fs.writeFileSync(f, `${Object.entries(fullSettingsFor('https://gw.lab-test.net/mcp')).map(([k, v]) => `${k}=${v}`).join('\n')}\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=${secret}\n`, { mode: 0o600 });
    const fullOn = await live({}); assert.equal(fullOn.level, 'pass'); assert.match(fullOn.detail, /full Real is on: .*at https:\/\/auth\.pingone\.com, MCP to https:\/\/gw\.lab-test\.net/);
    assert.match(fullOn.detail, /two token exchanges \(agent scope: the default\)/, 'the doctor says the agent scope is the default');
    fs.writeFileSync(f, `${Object.entries(fullSettingsFor('https://gw.lab-test.net/mcp', { AAG_AGENT_SCOPE: 'custom:agent-xyz' })).map(([k, v]) => `${k}=${v}`).join('\n')}\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=${secret}\n`, { mode: 0o600 });
    const custom = await live({}); assert.match(custom.detail, /two token exchanges \(agent scope: set by AAG_AGENT_SCOPE\)/); assert.ok(!custom.detail.includes('custom:agent-xyz'), 'the doctor names the setting, never its value');
    fs.writeFileSync(f, `${Object.entries(fullSettingsFor('https://gw.lab-test.net/mcp')).map(([k, v]) => `${k}=${v}`).join('\n')}\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=${secret}\n`, { mode: 0o600 });
    fs.writeFileSync(f, 'AAG_USER_CLIENT_ID=u1\nPINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=x\n', { mode: 0o600 });
    const part = await live({}); assert.equal(part.level, 'info'); assert.match(part.detail, /full Real is not configured yet: missing AAG_USER_CLIENT_SECRET, .*the old PINGONE_CLIENT_\* path is ignored/);
    assert.ok(!JSON.stringify(await runChecks({ env: { AAG_ENV_FILE: f, AAG_ALLOW_LIVE: '1', IDP: 'pingone' } })).match(/hunter2|11111111-2222|cid/), 'no environment id, client or secret in any line');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('step 3: health says runtime offline by default and live when the lab says so', async () => {
  for (const [runtime, want] of [[undefined, 'offline'], [() => 'live', 'live']]) {
    const h = createHealth({ runChecks: async () => [{ level: 'pass' }], intervalMs: 3_600_000, ...(runtime ? { runtime } : {}) }); await h.ready;
    let body; h.router.stack[0].route.stack[0].handle({}, { set() {}, json(b) { body = b; } }); h.stop();
    assert.equal(body.schema, 'demo-health/1'); assert.equal(body.runtime, want);
  }
});

test('provider (owner 2026-11-16): the doctor passes with the setting named and fails on an invalid AAG_PROVIDER naming the setting only; the SE gateway is an info line, never a failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-doc-prov-'));
  const f = path.join(dir, '.env');
  try {
    const at = async (text, id) => { fs.writeFileSync(f, text, { mode: 0o600 }); return (await runChecks({ env: { AAG_ENV_FILE: f } })).find((x) => x.id === id); };
    const fullText = (extra, gw = null) => `${Object.entries(fullSettingsFor(gw, extra)).map(([k, v]) => `${k}=${v}`).join('\n')}\n`;
    const dflt = await at('', 'provider'); assert.equal(dflt.level, 'pass'); assert.match(dflt.detail, /^AAG_PROVIDER is auto: /);
    for (const v of ['se', 'local', 'LOCAL']) { const p = await at(`AAG_PROVIDER=${v}\n`, 'provider'); assert.equal(p.level, 'pass'); assert.match(p.detail, new RegExp(`^AAG_PROVIDER is ${v.toLowerCase()}: `)); }
    const bad = await at('AAG_PROVIDER=sideways-value\n', 'provider'); assert.equal(bad.level, 'fail'); assert.match(bad.detail, /AAG_PROVIDER \(auto, se or local\)/); assert.ok(!bad.detail.includes('sideways-value'), 'the value is never printed');
    const none = await at(fullText({}), 'gateway'); assert.equal(none.level, 'info'); assert.match(none.detail, /^SE gateway: not set \(banking, healthcare and retail stay on the lab's own steps\)$/);
    const set = await at(fullText({}, 'https://gw.lab-test.net/mcp'), 'gateway'); assert.equal(set.level, 'info'); assert.equal(set.detail, 'SE gateway: set');
    const live = await at(fullText({}), 'live'); assert.equal(live.level, 'pass'); assert.match(live.detail, /no SE gateway is set, so the software vertical uses the lab's own tool server on loopback; the netguard allows the PingOne host/);
    assert.ok(!(await runChecks({ env: { AAG_ENV_FILE: f } })).some((c) => c.level === 'fail'), 'a missing gateway is not a failure');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// PingOne Authorize (2026-11-17): names only, never a value. All three set pass and name the API host; none is information; some are information naming the missing NAMES.
test('authorize: the doctor passes with all three (naming the API host only), says information with none and names the missing names when partial; no value is ever printed; it is never a failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-doc-az-'));
  const f = path.join(dir, '.env');
  try {
    const at = async (extra) => { fs.writeFileSync(f, `${Object.entries(fullSettingsFor(null, extra)).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 }); const c = await runChecks({ env: { AAG_ENV_FILE: f } }); assert.ok(!c.some((x) => x.level === 'fail'), 'never a failure'); return { check: c.find((x) => x.id === 'authorize'), all: c }; };
    const secret = 'worker-secret-value-0123456789'; const id = 'e4e4e4e4-5656-4787-8989-b0b0b0b0b0b0'; const client = 'worker-client-id-abcdef';
    const none = (await at({})).check; assert.equal(none.level, 'info'); assert.match(none.detail, /not set \(AAG_AUTHORIZE_ENDPOINT_ID, AAG_AUTHORIZE_CLIENT_ID, AAG_AUTHORIZE_CLIENT_SECRET\); the lab's own fare rule answers and says so$/);
    const all = await at({ AAG_AUTHORIZE_ENDPOINT_ID: id, AAG_AUTHORIZE_CLIENT_ID: client, AAG_AUTHORIZE_CLIENT_SECRET: secret });
    assert.equal(all.check.level, 'pass'); assert.match(all.check.detail, /calls https:\/\/api\.pingone\.com \(one decision endpoint, a worker app's token from https:\/\/auth\.pingone\.com\) and the tool server never holds the secret$/);
    for (const v of [secret, id, client]) assert.ok(!JSON.stringify(all.all).includes(v), 'a value was printed');
    const part = await at({ AAG_AUTHORIZE_CLIENT_ID: client });
    assert.equal(part.check.level, 'info'); assert.match(part.check.detail, /but not AAG_AUTHORIZE_ENDPOINT_ID, AAG_AUTHORIZE_CLIENT_SECRET, so nothing is asked/); assert.ok(!JSON.stringify(part.all).includes(client));
    const bad = await at({ AAG_AUTHORIZE_ENDPOINT_ID: 'not-a-uuid', AAG_AUTHORIZE_CLIENT_ID: client, AAG_AUTHORIZE_CLIENT_SECRET: secret });
    assert.equal(bad.check.level, 'info'); assert.match(bad.check.detail, /no valid AAG_AUTHORIZE_ENDPOINT_ID \(a UUID\)/); assert.ok(!JSON.stringify(bad.all).includes('not-a-uuid') && !JSON.stringify(bad.all).includes(secret));
    const eu = await at({ PINGONE_REGION: 'eu', AAG_AUTHORIZE_ENDPOINT_ID: id, AAG_AUTHORIZE_CLIENT_ID: client, AAG_AUTHORIZE_CLIENT_SECRET: secret }); assert.match(eu.check.detail, /api\.pingone\.eu/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
