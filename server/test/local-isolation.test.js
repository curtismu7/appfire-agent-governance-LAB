// Static pins for server/src/local/ (design A.1): the child imports nothing from the lab, reads no environment, writes nothing, logs nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BANDS, BLOCKED_TERMS, SCANNER_REPOS, SCOPES, TOOL_META } from '../src/local/registry.js';
import * as registry from '../src/local/registry.js';

const dir = new URL('../src/local/', import.meta.url);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
const code = (f) => fs.readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('the directory holds exactly the files the design names, and nothing else', () => {
  assert.deepEqual(fs.readdirSync(dir).sort(), ['data.js', 'guard.js', 'hitl.js', 'jwks.js', 'main.js', 'mcp.js', 'policy.js', 'registry.js', 'server.js', 'tools.js', 'util.js', 'verify.js']);
  assert.equal(files.length, 12);
});

test('every import is a node: module or a sibling file; never a file of the lab', () => {
  for (const f of files) {
    for (const m of code(f).matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+'([^']+)'/g)) {
      const spec = m[1];
      assert.ok(/^node:[a-z/]+$/.test(spec) || /^\.\/[a-z]+\.js$/.test(spec), `${f}: import ${spec}`);
      assert.ok(!spec.startsWith('..'), `${f}: no import out of the directory`);
    }
    assert.ok(!/\brequire\(|import\(/.test(code(f)), `${f}: no require and no dynamic import`);
  }
});

test('no environment is read, nothing is logged, and the only stderr writes are fixed lines in main.js', () => {
  for (const f of files) {
    const c = code(f);
    assert.ok(!/process\.env/.test(c), `${f}: no process.env`);
    assert.ok(!/\bconsole\./.test(c), `${f}: no console`);
    const writes = [...c.matchAll(/process\.stderr\.write\(([^)]*)\)/g)];
    if (f !== 'main.js') assert.equal(writes.length, 0, `${f}: no stderr write`);
    for (const w of writes) assert.match(w[1], /^'appfire-tools-local: [A-Za-z ]+\\n'$/, `${f}: a fixed line only`);
  }
});

test('no eval, Function, vm, worker, child process, cluster, file access, regular expression built from input, or secret name', () => {
  for (const f of files) {
    const c = code(f);
    assert.ok(!/\beval\(|new Function\(|\bvm\./.test(c), `${f}: no eval, Function or vm`);
    assert.ok(!/worker_threads|child_process|node:cluster/.test(c), `${f}: no worker or child process`);
    assert.ok(!/node:fs|writeFile|appendFile|createWriteStream|mkdirSync|rmSync|unlinkSync|readFile/.test(c), `${f}: no file access`);
    assert.ok(!/new RegExp\(/.test(c), `${f}: no regular expression built from input`);
    assert.ok(!/CLIENT_SECRET|clientSecret/.test(fs.readFileSync(new URL(f, dir), 'utf8')), `${f}: the client secret is never named`);
    assert.ok(!/generateKeyPair/.test(c), `${f}: no key generation`);
  }
});

test('main.js installs the guard before anything else can open a socket', () => {
  const main = code('main.js');
  const guardAt = main.indexOf('installGuard({');
  assert.ok(guardAt > 0);
  for (const later of ['startLocalServer({', "process.on('message'", 'validateInit(']) assert.ok(main.indexOf(later) > guardAt, `${later} comes after the guard`);
  assert.match(main, /process\.on\('uncaughtException'/); assert.match(main, /process\.on\('unhandledRejection'/);
});

test('registry.js exports exactly the names in the design and TOOL_META has the sixteen tools (ten software, six airline)', () => {
  assert.deepEqual(Object.keys(registry).sort(), ['AUTHORIZE_CODES', 'AUTHORIZE_REASONS', 'BANDS', 'BLOCKED_TERMS', 'DEFAULT_AIRLINE_TIER_GROUP', 'FARE', 'SCANNER_REPOS', 'SCOPES', 'TOOL_META']);
  assert.equal(Object.keys(TOOL_META).length, 16);
  assert.deepEqual(Object.keys(TOOL_META), ['get_my_issues', 'bulk_update_issues', 'get_project_security_settings', 'get_release_summary', 'list_marketplace_apps', 'get_deployment_status', 'request_admin_access', 'scan_repository', 'brave_news_search', 'code_search',
    'get_airline_bookings', 'get_flight_status', 'book_airline_flight', 'sensitive_passenger_record', 'list_airports', 'request_change_fee_waiver']);
  assert.deepEqual(SCOPES, ['issues:read', 'issues:write', 'security:read', 'release:read', 'deploy:read', 'admin:request', 'trips:read', 'flights:read', 'flights:book', 'travellers:read', 'fees:request']);
  assert.deepEqual(registry.FARE, { limit: 400, hold: 1500, from: 'business', to: 'economy' }); assert.ok(Object.isFrozen(registry.FARE));
  assert.equal(registry.DEFAULT_AIRLINE_TIER_GROUP, 'Airline_OrbitTier');
  assert.deepEqual(BANDS, [{ min: 2000, decision: 'DENY', rule: 'lab-band-deny' }, { min: 500, decision: 'STEP_UP', rule: 'lab-band-step-up' }, { min: 200, decision: 'HITL_REQUIRED', rule: 'lab-band-hold' }]);
  assert.deepEqual(SCANNER_REPOS, ['platform', 'billing', 'mobile']);
  assert.deepEqual(BLOCKED_TERMS, ['bitcoin', 'crypto']);
  for (const [name, meta] of Object.entries(TOOL_META)) {
    assert.deepEqual(Object.keys(meta), ['scope', 'role', 'public', 'group', 'pack'], name);
    assert.equal(meta.pack, ['get_airline_bookings', 'get_flight_status', 'book_airline_flight', 'sensitive_passenger_record', 'list_airports', 'request_change_fee_waiver'].includes(name) ? 'airline' : 'software', name);
    assert.ok(meta.scope === null || SCOPES.includes(meta.scope), name);
    assert.equal(meta.public, meta.scope === null, `${name}: public means no scope`);
  }
  assert.deepEqual(Object.entries(TOOL_META).filter(([, m]) => m.public).map(([n]) => n), ['list_marketplace_apps', 'list_airports']);
  assert.deepEqual(Object.entries(TOOL_META).filter(([, m]) => m.group).map(([n]) => n), ['get_project_security_settings', 'sensitive_passenger_record']);
});

test('the test keys: the private members are chunked, no compact token and no key generation sits in the repository', () => {
  const keys = fs.readFileSync(new URL('./localKeys.js', import.meta.url), 'utf8');
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(keys), 'no compact token');
  assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(keys), 'no PEM');
  for (const member of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
    const m = new RegExp(`\\n  ${member}: \\[\\n((?:    '[A-Za-z0-9_-]+',\\n)+)  \\]\\.join\\(''\\),`, 'g');
    const found = [...keys.matchAll(m)];
    assert.equal(found.length, 3, `${member}: three RSA keys`);
    for (const f of found) assert.ok(f[1].split('\n').filter(Boolean).length >= 8, `${member}: at least 8 chunks`);
  }
  for (const f of ['localKeys.js', 'localFakeIdp.js', 'localHarness.js']) {
    const c = fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
    assert.ok(!/generateKeyPair/.test(c), `${f}: no generateKeyPair`);
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(c), `${f}: no compact token`);
  }
  assert.ok(!/export const [A-Za-z_]*(key|secret|token|password)/i.test(keys.replace(/RSA_[A-Z]+_JWK|EC_A_JWK/g, '')), 'no exported name carries key, secret, token or password');
});
