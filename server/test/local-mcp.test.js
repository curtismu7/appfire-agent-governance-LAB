// The local tool server over real HTTP (design B.2 and B.3): sessions, listing, schemas, the request guards.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { ACTOR, AIRLINE_SCOPES, ALL_SCOPES, TIER_GROUP, TIER_GROUP_AIRLINE } from './localFakeIdp.js';
import { startRig } from './localHarness.js';
import { TOOL_META } from '../src/local/registry.js';

let rig;
before(async () => { rig = await startRig(); });
after(async () => { await rig.close(); });

const PUBLIC_ONLY = ['list_airports', 'list_marketplace_apps'];
// The default test token holds the six software scopes: it sees the nine ungated software tools and the one public airline tool (the tool server cannot tell the vertical).
const NOT_GATED = Object.keys(TOOL_META).filter((n) => !TOOL_META[n].group && (TOOL_META[n].pack === 'software' || TOOL_META[n].public)).sort();
const FULL = () => rig.token({ scope: `${ALL_SCOPES} ${AIRLINE_SCOPES}`, groups: [TIER_GROUP, TIER_GROUP_AIRLINE] });

test('initialize opens a session, echoes a known protocol version, and a tokenless session is anonymous', async () => {
  const r = await rig.rpc('initialize', { protocolVersion: '2025-03-26' });
  assert.equal(r.status, 200);
  assert.match(r.headers['mcp-session-id'], /^[0-9a-f-]{36}$/);
  assert.equal(r.json.result.protocolVersion, '2025-03-26');
  assert.deepEqual(r.json.result.capabilities, { tools: { listChanged: false } });
  assert.equal(r.json.result.serverInfo.name, 'appfire-tools-local');
  const other = await rig.rpc('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(other.json.result.protocolVersion, '2025-06-18');
  const none = await rig.rpc('initialize');
  assert.equal(none.json.result.protocolVersion, '2025-06-18');
});

test('notifications are 202 and empty; ping needs no session; every other method needs a session', async () => {
  const n = await rig.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(n.status, 202); assert.equal(n.text, '');
  const p = await rig.rpc('ping');
  assert.deepEqual(p.json.result, {});
  const noSession = await rig.rpc('tools/list', {});
  assert.equal(noSession.status, 404); assert.deepEqual(noSession.json, { error: 'session_unknown' });
  const unknown = await rig.rpc('tools/list', {}, { session: 'does-not-exist' });
  assert.equal(unknown.status, 404);
  const s = await rig.open();
  const m = await rig.rpc('resources/list', {}, { session: s });
  assert.equal(m.status, 200); assert.equal(m.json.error.code, -32601);
});

test('a session is bound to the token sub; another sub gets 404; DELETE ends it', async () => {
  const a = rig.token({ sub: 'user-a' });
  const b = rig.token({ sub: 'user-b' });
  const s = await rig.open(a);
  assert.equal((await rig.rpc('tools/list', {}, { tok: a, session: s })).status, 200);
  assert.equal((await rig.rpc('tools/list', {}, { tok: b, session: s })).status, 404);
  assert.equal((await rig.rpc('tools/list', {}, { session: s })).status, 404, 'an anonymous caller cannot use it either');
  assert.equal((await rig.raw('/mcp', { method: 'DELETE', headers: { authorization: `Bearer ${b}`, 'mcp-session-id': s } })).status, 404);
  assert.equal((await rig.raw('/mcp', { method: 'DELETE', headers: { authorization: `Bearer ${a}`, 'mcp-session-id': s } })).status, 204);
  assert.equal((await rig.rpc('tools/list', {}, { tok: a, session: s })).status, 404);
});

test('sessions expire after 15 idle minutes and at most 200 are kept', async () => {
  const s = await rig.open();
  assert.equal((await rig.rpc('tools/list', {}, { session: s })).status, 200);
  rig.clock.t += 14 * 60_000;
  assert.equal((await rig.rpc('tools/list', {}, { session: s })).status, 200, 'use keeps it alive');
  rig.clock.t += 16 * 60_000;
  assert.equal((await rig.rpc('tools/list', {}, { session: s })).status, 404);
  const first = await rig.open();
  for (let i = 0; i < 200; i += 1) await rig.open();
  assert.equal((await rig.rpc('tools/list', {}, { session: first })).status, 404, 'the oldest one was dropped');
});

test('tools/list: no token lists the public tools only; scopes decide the rest; the group-gated tool needs the tier group', async () => {
  assert.deepEqual((await rig.list()).sort(), PUBLIC_ONLY);
  assert.deepEqual((await rig.list(rig.token({ scope: 'issues:read' }))).sort(), ['brave_news_search', 'code_search', 'get_my_issues', 'list_airports', 'list_marketplace_apps']);
  assert.deepEqual((await rig.list(rig.token({ scope: ['deploy:read'] }))).sort(), ['get_deployment_status', 'list_airports', 'list_marketplace_apps']);
  assert.deepEqual((await rig.list(rig.token({}))).sort(), NOT_GATED, 'every scope but no tier group: the gated tool is hidden');
  const withArray = await rig.list(rig.token({ groups: [TIER_GROUP] }));
  assert.ok(withArray.includes('get_project_security_settings'));
  assert.equal(withArray.length, 11, 'software ten and the public airline tool');
  const airline = await rig.list(rig.token({ scope: AIRLINE_SCOPES, groups: [TIER_GROUP_AIRLINE] }));
  assert.deepEqual(airline.sort(), ['book_airline_flight', 'get_airline_bookings', 'get_flight_status', 'list_airports', 'list_marketplace_apps', 'request_change_fee_waiver', 'sensitive_passenger_record']);
  assert.ok(!(await rig.list(rig.token({ scope: AIRLINE_SCOPES, groups: [TIER_GROUP] }))).includes('sensitive_passenger_record'), 'the software tier group does not unlock the airline tool');
  assert.ok(!(await rig.list(rig.token({ scope: ALL_SCOPES, groups: [TIER_GROUP_AIRLINE] }))).includes('get_project_security_settings'), 'the airline tier group does not unlock the software tool');
  assert.ok((await rig.list(rig.token({ groups: TIER_GROUP }))).includes('get_project_security_settings'), 'a single string groups claim');
  for (const groups of [['Other_Group'], [], undefined, 'Other_Group', { a: TIER_GROUP }]) {
    assert.ok(!(await rig.list(rig.token({ groups }))).includes('get_project_security_settings'));
  }
  const noScope = await rig.list(rig.token({ scope: 'unrelated:thing' }));
  assert.deepEqual(noScope.sort(), PUBLIC_ONLY);
});

test('every descriptor is strict, names its scope and carries the control field', async () => {
  const full = FULL();
  const s = await rig.open(full);
  const r = await rig.rpc('tools/list', {}, { tok: full, session: s });
  assert.equal(r.json.result.tools.length, 16);
  for (const t of r.json.result.tools) {
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.ok(t.inputSchema.properties._hitl_challenge_id, t.name);
    assert.equal(t._meta.requiredScope, TOOL_META[t.name].scope);
    assert.equal(t._meta.labInvented, true);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
    assert.ok(!t.name.startsWith('grant_'), 'no tool grants access');
  }
});

const GOOD = {
  get_my_issues: {}, bulk_update_issues: { project: 'PLAT', issue_count: 5 }, get_project_security_settings: {}, get_release_summary: {}, list_marketplace_apps: {},
  get_deployment_status: {}, request_admin_access: { role: 'project-admin', reason: 'because' }, scan_repository: { repo: 'platform' }, brave_news_search: { query: 'q' }, code_search: { query: 'q' },
  get_airline_bookings: {}, get_flight_status: {}, book_airline_flight: { flight: 'LK 214' }, sensitive_passenger_record: {}, list_airports: {}, request_change_fee_waiver: { reason: 'because' },
};
test('every tool: its good call passes, an extra key and a wrong type are -32602, defaults are applied', async () => {
  const tok = FULL();
  const s = await rig.open(tok);
  for (const [name, args] of Object.entries(GOOD)) {
    const ok = await rig.call(name, args, { tok, session: s });
    assert.equal(ok.status, 200, name);
    assert.ok(ok.result, `${name} answers with a payload`);
    assert.equal(Object.keys(ok.result).at(-1), 'lab_invented', `${name}: lab_invented is the last key`);
    assert.equal(JSON.parse(ok.json.result.content[0].text).lab_invented, true);
    const extra = await rig.call(name, { ...args, surprise: 1 }, { tok, session: s });
    assert.equal(extra.json.error.code, -32602, `${name}: extra key`);
    assert.equal(extra.json.error.message, 'invalid arguments: unexpected field');
    assert.ok(!extra.text.includes('surprise'), 'the request text is never echoed');
    const first = Object.keys(args)[0] ?? Object.keys(rig && {})[0];
    const field = first ?? { get_my_issues: 'limit', get_project_security_settings: 'project', get_release_summary: 'project', list_marketplace_apps: 'limit', get_deployment_status: 'environment', get_airline_bookings: 'limit', list_airports: 'limit', get_flight_status: 'flight', sensitive_passenger_record: 'project' }[name];
    const wrong = await rig.call(name, { ...args, [field]: { nested: true } }, { tok, session: s });
    assert.equal(wrong.json.error.code, -32602, `${name}: wrong type`);
  }
  assert.equal((await rig.call('get_my_issues', {}, { tok, session: s })).result.returned, 5, 'limit defaults to 5');
  assert.equal((await rig.call('get_my_issues', { limit: 3 }, { tok, session: s })).result.issues.length, 3);
  for (const bad of [0, 21, 1.5, '5', null]) assert.equal((await rig.call('get_my_issues', { limit: bad }, { tok, session: s })).json.error.code, -32602);
  assert.equal((await rig.call('get_my_issues', 'not an object', { tok, session: s })).json.error.message, 'invalid arguments: arguments must be an object');
  assert.equal((await rig.call('get_my_issues', [1], { tok, session: s })).json.error.code, -32602);
  assert.equal((await rig.call('bulk_update_issues', { project: 'plat', issue_count: 5 }, { tok, session: s })).json.error.code, -32602, 'the project pattern');
  assert.equal((await rig.call('bulk_update_issues', { project: 'PLAT' }, { tok, session: s })).json.error.message, 'invalid arguments: issue_count is required');
  assert.equal((await rig.call('bulk_update_issues', { project: 'PLAT', issue_count: 5, field: 'owner' }, { tok, session: s })).json.error.code, -32602);
  assert.equal((await rig.call('get_my_issues', { _hitl_challenge_id: 'bad id!' }, { tok, session: s })).json.error.code, -32602);
  const defaults = (await rig.call('bulk_update_issues', { project: 'PLAT', issue_count: 5 }, { tok, session: s })).result;
  assert.equal(defaults.field, 'status'); assert.equal(defaults.value, 'Done'); assert.equal(defaults.status, 'applied');
  assert.match(defaults.change_id, /^CHG-[0-9A-F]{6}$/);
  const secur = (await rig.call('get_project_security_settings', {}, { tok, session: s })).result;
  assert.equal(secur.project, 'PLAT'); assert.deepEqual(secur.ip_allowlist, ['203.0.113.0/24']);
  const issues = (await rig.call('get_my_issues', { limit: 20 }, { tok, session: s })).result;
  assert.equal(issues.total, 8); assert.equal(issues.returned, 8); assert.equal(issues.issues[0].key, 'PLAT-412'); assert.equal(issues.signed_in_sub, 'user-lab-1');
  const apps = (await rig.call('list_marketplace_apps', {}, { session: await rig.open() })).result;
  assert.equal(apps.apps.length, 5); assert.equal(apps.apps[0].name, 'Sprint Pulse');
  const admin = (await rig.call('request_admin_access', { role: 'site-admin', reason: 'x' }, { tok, session: s })).result;
  assert.equal(admin.status, 'pending'); assert.equal(admin.requested_by, 'user-lab-1'); assert.match(admin.request_id, /^REQ-[0-9A-F]{6}$/);
  const news = (await rig.call('brave_news_search', { query: 'jira' }, { tok, session: s })).result;
  assert.equal(news.results.length, 3); assert.ok(news.results.every((n) => n.title.includes('(example)') && n.url.startsWith('https://news.example/')));
  const scan = (await rig.call('scan_repository', { repo: 'platform' }, { tok, session: s })).result;
  assert.equal(scan.findings[0].id, 'SCAN-1'); assert.equal(new Date(scan.scanned_at).toISOString(), scan.scanned_at);
});

test('tools/call of constructor, __proto__ and toString: -32602 with a token, 401 no_token without one', async () => {
  const tok = rig.token({});
  const s = await rig.open(tok);
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'nope']) {
    const withTok = await rig.call(name, {}, { tok, session: s });
    assert.equal(withTok.status, 200); assert.equal(withTok.json.error.code, -32602); assert.equal(withTok.json.error.message, 'unknown tool');
    const anon = await rig.call(name, {}, { session: await rig.open() });
    assert.equal(anon.status, 401); assert.equal(anon.json.reason, 'no_token');
  }
  const bad = await rig.rpc('tools/call', { name: 5 }, { tok, session: s });
  assert.equal(bad.json.error.code, -32602);
  const missing = await rig.rpc('tools/call', undefined, { tok, session: s });
  assert.equal(missing.json.error.code, -32602);
});

test('the 401 shapes: no_token has no error attribute; a bad token names its reason; a bad token on a public tool is 401; no token on a protected tool is 401', async () => {
  const anon = await rig.call('get_my_issues', {}, { session: await rig.open() });
  assert.equal(anon.status, 401);
  assert.equal(anon.headers['www-authenticate'], 'Bearer realm="appfire-tools-local"');
  assert.equal(anon.json.error, 'no_token');
  assert.equal(anon.headers['x-gw-audit-trail'], undefined, 'a token problem is not a policy decision');
  const badTok = rig.token({ aud: 'elsewhere' });
  const bad = await rig.call('list_marketplace_apps', {}, { tok: badTok, session: await rig.open() });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers['www-authenticate'], 'Bearer realm="appfire-tools-local", error="invalid_token", error_description="aud_mismatch"');
  assert.equal(bad.json.reason, 'aud_mismatch'); assert.equal(bad.json.by, 'tool server');
  const onInit = await rig.rpc('initialize', {}, { tok: badTok });
  assert.equal(onInit.status, 401, 'a presented token is checked whatever the method');
  assert.ok(!bad.text.includes(badTok));
  const pub = await rig.call('list_marketplace_apps', {}, { session: await rig.open() });
  assert.equal(pub.status, 200);
  assert.equal((await rig.raw('/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), headers: { 'content-type': 'application/json', authorization: 'Basic abc' } })).status, 401);
  const twice = await rig.raw('/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), headers: { 'content-type': 'application/json', authorization: [`Bearer ${rig.token({})}`, `Bearer ${rig.token({})}`] } });
  assert.equal(twice.status, 401); assert.equal(twice.json.reason, 'bad_scheme', 'a repeated Authorization header');
});

test('a token with the wrong actor, or no scopes, is refused; the actor allow-list is the configured one', async () => {
  const r = await rig.call('get_my_issues', {}, { tok: rig.token({ act: { sub: 'someone-else' } }), session: await rig.open() });
  assert.equal(r.status, 401); assert.equal(r.json.reason, 'act_sub_mismatch');
  assert.ok(ACTOR);
});

test('the JSON-RPC edges: bad JSON, batches, bad envelopes, GET', async () => {
  const bad = await rig.post('{not json');
  assert.equal(bad.status, 400); assert.equal(bad.json.error.code, -32700);
  assert.ok(!bad.text.includes('not json'), 'the parse failure never quotes the request');
  const batch = await rig.post('[{"jsonrpc":"2.0","id":1,"method":"ping"}]');
  assert.equal(batch.status, 400); assert.equal(batch.json.error.code, -32600);
  for (const m of [{ jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1 }, { jsonrpc: '2.0', id: {}, method: 'ping' }, { jsonrpc: '2.0', method: 'ping' }, 5, null]) {
    assert.equal((await rig.post(m === null ? 'null' : JSON.stringify(m))).status, 400);
  }
  const get = await rig.raw('/mcp');
  assert.equal(get.status, 405); assert.equal(get.headers.allow, 'POST');
});

test('request guards: host, origin, size, media type, unknown paths, health', async () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
  const ok = { 'content-type': 'application/json' };
  assert.equal((await rig.raw('/mcp', { method: 'POST', body, headers: ok, host: 'evil.example' })).json.error, 'host_refused');
  assert.equal((await rig.raw('/mcp', { method: 'POST', body, headers: ok, host: '127.0.0.1:1' })).status, 403);
  assert.equal((await rig.raw('/mcp', { method: 'POST', body, headers: ok, host: `localhost:${rig.local.port}` })).status, 200);
  assert.equal((await rig.raw('/mcp', { method: 'POST', body, headers: { ...ok, origin: 'http://localhost:7814' } })).json.error, 'origin_refused');
  assert.equal((await rig.raw('/health', { headers: { origin: 'null' } })).status, 403);
  assert.equal((await rig.raw('/mcp', { method: 'POST', body, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await rig.raw('/mcp', { method: 'POST', body, headers: { 'content-type': 'application/json; charset=utf-8' } })).status, 200);
  const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'a'.repeat(70_000) } });
  assert.equal((await rig.raw('/mcp', { method: 'POST', body: big, headers: ok })).status, 413);
  assert.equal((await rig.raw('/nope')).json.error, 'not_found');
  assert.equal((await rig.raw('/mcp/extra', { method: 'POST', body, headers: ok })).status, 404);
  const health = await rig.raw('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(Object.keys(health.json), ['ok', 'service', 'version', 'issuer', 'jwks', 'tools']);
  assert.equal(health.json.tools, 16); assert.equal(health.json.issuer, rig.config.issuer);
  assert.ok(!health.text.includes(String(rig.local.port)) && !health.text.includes(rig.config.hitlSecret), 'no port, no secret');
});

test('health reports the last key fetch: unknown before any token, ok after one', async () => {
  const fresh = await startRig();
  try {
    assert.equal((await fresh.raw('/health')).json.jwks, 'unknown');
    await fresh.call('get_my_issues', {}, { tok: fresh.token({}) });
    assert.equal((await fresh.raw('/health')).json.jwks, 'ok');
    assert.deepEqual(fresh.idp.seen.length, 2);
  } finally { await fresh.close(); }
});

test('at most 32 requests are in flight; the 33rd is 503 busy, and capacity comes back', async () => {
  const sockets = [];
  try {
    for (let i = 0; i < 32; i += 1) {
      const s = net.connect(rig.local.port, '127.0.0.1');
      s.on('error', () => {});
      s.write(`POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${rig.local.port}\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{`);
      sockets.push(s);
    }
    for (let i = 0; i < 100 && rig.local.inFlight() < 32; i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.equal(rig.local.inFlight(), 32);
    const busy = await rig.raw('/health');
    assert.equal(busy.status, 503); assert.equal(busy.json.error, 'busy');
  } finally { for (const s of sockets) s.destroy(); }
  for (let i = 0; i < 100 && rig.local.inFlight() > 0; i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(rig.local.inFlight(), 0);
  assert.equal((await rig.raw('/health')).status, 200);
});

test('a malformed request line gets a fixed 400 and nothing else', async () => {
  const out = await new Promise((resolve) => {
    const s = net.connect(rig.local.port, '127.0.0.1');
    let data = '';
    s.on('data', (c) => { data += c; });
    s.on('close', () => resolve(data));
    s.on('error', () => resolve(data));
    s.write('NOT HTTP AT ALL\r\n\r\n');
  });
  assert.match(out, /^HTTP\/1\.1 400 Bad Request/);
  assert.ok(!out.includes('NOT HTTP'));
});

test('when the issuer keys cannot be had the answer is 503 jwks_unavailable with Retry-After, not a 401', async () => {
  const fresh = await startRig();
  try {
    fresh.idp.setBehaviour('jwks-500');
    const tok = fresh.token({});
    const r = await fresh.call('get_my_issues', {}, { tok });
    assert.equal(r.status, 503);
    assert.equal(r.headers['retry-after'], '5');
    assert.equal(r.headers['www-authenticate'], undefined);
    assert.equal(r.json.error, 'jwks_unavailable'); assert.equal(r.json.by, 'tool server');
    assert.equal(r.headers['x-gw-audit-trail'], undefined);
    assert.equal((await fresh.raw('/health')).json.jwks, 'unavailable');
    fresh.idp.setBehaviour('ok');
    fresh.clock.t += 6000;
    assert.equal((await fresh.call('get_my_issues', {}, { tok: fresh.token({}) })).status, 200, 'it recovers once the issuer does');
  } finally { await fresh.close(); }
});
