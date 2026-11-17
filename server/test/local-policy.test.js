// The lab's own policy over real HTTP (design B.6 and B.8): decision order, bands, receipts, group gate, edge rules, audit header, no leaks.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { TIER_GROUP, ACTOR } from './localFakeIdp.js';
import { SECRET, startRig } from './localHarness.js';
import { parseAuditTrail } from '../src/mcpClient.js';
import { argsDigest } from '../src/local/hitl.js';

let rig;
before(async () => { rig = await startRig(); });
after(async () => { await rig.close(); });

const bulk = (n, extra = {}) => ({ project: 'PLAT', issue_count: n, field: 'status', value: 'Done', ...extra });
const audit = (r) => JSON.parse(r.headers['x-gw-audit-trail']);

test('bands for bulk_update_issues: 199 permits, 200 holds, 499 holds, 500 steps up, 1999 steps up, 2000 refuses', async () => {
  const tok = rig.token({});
  const s = await rig.open(tok);
  const at = (n) => rig.call('bulk_update_issues', bulk(n), { tok, session: s });
  const p = await at(199);
  assert.equal(p.status, 200); assert.equal(audit(p).decision, 'PERMIT'); assert.equal(audit(p).rule, 'lab-no-restriction');
  for (const n of [200, 499]) {
    const r = await at(n);
    assert.equal(r.status, 428, String(n));
    assert.equal(r.json.error, 'approval_required'); assert.equal(r.json.reason, 'lab-band-hold'); assert.equal(r.json.by, 'tool server');
    assert.match(r.json.challengeId, /^[0-9a-f-]{36}$/); assert.equal(r.json.tool, 'bulk_update_issues'); assert.ok(Date.parse(r.json.expiresAt) > rig.clock.t);
    assert.equal(audit(r).decision, 'HITL_REQUIRED');
  }
  for (const n of [500, 1999]) {
    const r = await at(n);
    assert.equal(r.status, 428, String(n));
    assert.equal(r.json.error, 'step_up_required'); assert.equal(r.json.reason, 'lab-band-step-up'); assert.equal(r.json.challengeId, undefined, 'a step-up has no challenge');
    assert.equal(audit(r).decision, 'STEP_UP'); assert.equal(audit(r).rule, 'lab-band-step-up');
  }
  const d = await at(2000);
  assert.equal(d.status, 403); assert.equal(d.json.error, 'access_denied'); assert.equal(d.json.reason, 'lab-band-deny');
  assert.equal(audit(d).decision, 'DENY');
  assert.equal((await at(100000)).status, 403);
  assert.equal((await at(100001)).json.error.code, -32602);
});

test('the lab amounts for UC6, UC7, UC8 and the default fall in the right bands', async () => {
  const tok = rig.token({});
  const s = await rig.open(tok);
  const out = {};
  for (const n of [2500, 600, 300, 25]) out[n] = (await rig.call('bulk_update_issues', bulk(n), { tok, session: s })).status;
  assert.deepEqual(out, { 2500: 403, 600: 428, 300: 428, 25: 200 });
});

// The full hold, approve, retry with the receipt.
async function hold(tok, session, n = 300, extra = {}) {
  const args = bulk(n, extra);
  const first = await rig.call('bulk_update_issues', args, { tok, session });
  assert.equal(first.status, 428);
  return { args, id: first.json.challengeId, first };
}
const respond = (id, decision) => rig.hitl(`/${id}/respond`, { body: { decision, respondedBy: 'test phone' } });
const retry = (tok, session, args, id) => rig.call('bulk_update_issues', { ...args, _hitl_challenge_id: id }, { tok, session });

test('hold, approve, retry with the receipt permits; a second use is receipt_used; a receipt carries no audit header when refused', async () => {
  const tok = rig.token({});
  const s = await rig.open(tok);
  const { args, id } = await hold(tok, s);
  const pending = await retry(tok, s, args, id);
  assert.equal(pending.status, 403); assert.equal(pending.json.error, 'hitl_receipt_rejected'); assert.equal(pending.json.reason, 'receipt_pending');
  assert.equal(pending.headers['x-gw-audit-trail'], undefined, 'a receipt refusal carries no audit header');
  assert.equal((await respond(id, 'approved')).json.status, 'approved');
  const done = await retry(tok, s, args, id);
  assert.equal(done.status, 200); assert.equal(done.result.status, 'applied'); assert.equal(audit(done).decision, 'PERMIT');
  const again = await retry(tok, s, args, id);
  assert.equal(again.status, 403); assert.equal(again.json.reason, 'receipt_used');
});

test('receipts are bound: another sub, other arguments, another tool, denied, expired, unknown', async () => {
  const tok = rig.token({});
  const s = await rig.open(tok);
  // another sub
  let h = await hold(tok, s);
  await respond(h.id, 'approved');
  const other = rig.token({ sub: 'someone-else' });
  const so = await rig.open(other);
  assert.equal((await retry(other, so, h.args, h.id)).json.reason, 'receipt_binding_mismatch');
  // other arguments (301 is still in the hold band)
  assert.equal((await retry(tok, s, bulk(301), h.id)).json.reason, 'receipt_binding_mismatch');
  assert.equal((await retry(tok, s, { ...h.args, value: 'Other' }, h.id)).json.reason, 'receipt_binding_mismatch');
  assert.equal((await retry(tok, s, h.args, h.id)).status, 200, 'the right caller with the right arguments still works: a refused try spent nothing');
  // another tool
  const made = await rig.hitl('', { body: { sub: 'user-lab-1', tool: 'get_my_issues', argsDigest: argsDigest(bulk(300)), amount: 300 } });
  assert.equal(made.status, 201);
  await respond(made.json.id, 'approved');
  assert.equal((await retry(tok, s, bulk(300), made.json.id)).json.reason, 'receipt_binding_mismatch');
  // denied
  h = await hold(tok, s);
  await respond(h.id, 'denied');
  assert.equal((await retry(tok, s, h.args, h.id)).json.reason, 'receipt_denied');
  // expired (5 minutes pass; the token itself is good for 15)
  h = await hold(tok, s);
  await respond(h.id, 'approved');
  rig.clock.t += 301_000;
  assert.equal((await retry(tok, s, h.args, h.id)).json.reason, 'receipt_expired');
  // unknown
  assert.equal((await retry(tok, s, h.args, '6f1c9a52-0b7e-4d0e-9f1e-7c3f5a2d8b10')).json.reason, 'receipt_unknown');
});

test('a receipt on a call below the hold band is ignored and not consumed', async () => {
  const tok = rig.token({});
  const s = await rig.open(tok);
  const { args, id } = await hold(tok, s);
  await respond(id, 'approved');
  const small = await retry(tok, s, bulk(199), id);
  assert.equal(small.status, 200, 'ignored');
  assert.equal((await retry(tok, s, args, id)).status, 200, 'and still good for the held call');
});

test('a receipt on a step-up or a deny band call changes nothing', async () => {
  const tok = rig.token({});
  const s = await rig.open(tok);
  const { id } = await hold(tok, s);
  await respond(id, 'approved');
  assert.equal((await retry(tok, s, bulk(600), id)).json.error, 'step_up_required');
  assert.equal((await retry(tok, s, bulk(2600), id)).json.error, 'access_denied');
});

test('the receipt key order does not matter: the digest is over the arguments as received, key-sorted', async () => {
  const tok = rig.token({});
  const s = await rig.open(tok);
  const first = await rig.call('bulk_update_issues', { issue_count: 300, project: 'PLAT' }, { tok, session: s });
  await respond(first.json.challengeId, 'approved');
  const done = await retry(tok, s, { project: 'PLAT', issue_count: 300 }, first.json.challengeId);
  assert.equal(done.status, 200);
  // defaults are NOT filled before the digest: {…} without field and {…, field:'status'} are different calls
  const a = await rig.call('bulk_update_issues', { project: 'PLAT', issue_count: 300 }, { tok, session: s });
  await respond(a.json.challengeId, 'approved');
  assert.equal((await retry(tok, s, { project: 'PLAT', issue_count: 300, field: 'status' }, a.json.challengeId)).json.reason, 'receipt_binding_mismatch');
});

test('scope: a token without the scope gets 403 insufficient_scope with WWW-Authenticate scope', async () => {
  const tok = rig.token({ scope: 'issues:read' });
  const r = await rig.call('bulk_update_issues', bulk(5), { tok, session: await rig.open(tok) });
  assert.equal(r.status, 403); assert.equal(r.json.error, 'insufficient_scope'); assert.equal(r.json.reason, 'lab-scope');
  assert.equal(r.headers['www-authenticate'], 'Bearer realm="appfire-tools-local", error="insufficient_scope", scope="issues:write"');
  assert.equal(audit(r).decision, 'DENY'); assert.equal(audit(r).rule, 'lab-scope');
  // the scope comes before argument validation
  const bad = await rig.call('bulk_update_issues', { nope: 1 }, { tok, session: await rig.open(tok) });
  assert.equal(bad.status, 403);
});

test('group gate (UC9 and UC21): array, single string, missing, wrong group; the list hides it, the call still refuses', async () => {
  const gated = (tok) => rig.call('get_project_security_settings', { project: 'PLAT' }, { tok, session: undefined });
  for (const groups of [[TIER_GROUP], TIER_GROUP, ['x', TIER_GROUP]]) {
    const r = await gated(rig.token({ groups }));
    assert.equal(r.status, 200, JSON.stringify(groups)); assert.equal(audit(r).decision, 'PERMIT'); assert.equal(r.result.project, 'PLAT');
  }
  for (const groups of [undefined, [], ['Other'], 'Other', [TIER_GROUP.toLowerCase()], { x: TIER_GROUP }, 7]) {
    const r = await gated(rig.token({ groups }));
    assert.equal(r.status, 403, JSON.stringify(groups)); assert.equal(r.json.error, 'group_required'); assert.equal(r.json.reason, 'lab-group-gate');
    assert.equal(r.json.required_group, TIER_GROUP);
    assert.equal(audit(r).decision, 'DENY'); assert.equal(audit(r).rule, 'lab-group-gate');
  }
  const noScope = await gated(rig.token({ groups: [TIER_GROUP], scope: 'issues:read' }));
  assert.equal(noScope.json.error, 'insufficient_scope', 'the scope check comes first');
});

test('repo allow-list (case-insensitive) and blocked terms (case-insensitive, never echoed)', async () => {
  const tok = rig.token({});
  const s = await rig.open(tok);
  for (const repo of ['platform', 'Billing', 'MOBILE']) assert.equal((await rig.call('scan_repository', { repo }, { tok, session: s })).status, 200, repo);
  const bad = await rig.call('scan_repository', { repo: 'payroll' }, { tok, session: s });
  assert.equal(bad.status, 403); assert.equal(bad.json.error, 'repo_not_allowed'); assert.equal(bad.json.reason, 'lab-repo-allowlist');
  assert.equal(bad.json.message, 'the code scanner is configured for the platform, billing and mobile repositories only');
  assert.ok(!bad.text.includes('payroll'));
  assert.equal(audit(bad).rule, 'lab-repo-allowlist');
  for (const query of ['crypto-mining script in our build', 'BitCoin miner', 'a CRYPTO thing']) {
    const r = await rig.call('brave_news_search', { query }, { tok, session: s });
    assert.equal(r.status, 403, query); assert.equal(r.json.error, 'blocked_term'); assert.equal(r.json.reason, 'lab-blocked-term');
    assert.ok(!r.text.toLowerCase().includes('bitcoin') && !r.text.toLowerCase().includes('crypto'), 'the term is never echoed');
  }
  assert.equal((await rig.call('brave_news_search', { query: 'Jira workflow automation best practices' }, { tok, session: s })).status, 200);
  assert.equal((await rig.call('code_search', { query: 'status' }, { tok, session: s })).status, 200);
});

test('the B.8 use cases, one tool call each', async () => {
  const tok = rig.token({ groups: [TIER_GROUP] });
  const s = await rig.open(tok);
  const expect = [
    ['get_my_issues', { limit: 5 }, 200], ['get_deployment_status', { environment: 'production' }, 200],
    ['request_admin_access', { role: 'project-admin', project: 'PLAT', reason: 'Lab request: approve the release' }, 200],
    ['get_project_security_settings', { project: 'PLAT' }, 200], ['scan_repository', { repo: 'platform' }, 200], ['scan_repository', { repo: 'payroll' }, 403],
    ['brave_news_search', { query: 'Jira workflow automation best practices' }, 200], ['brave_news_search', { query: 'crypto-mining script in our build' }, 403], ['code_search', { query: 'status' }, 200],
    ['get_release_summary', {}, 200],
  ];
  for (const [name, args, status] of expect) assert.equal((await rig.call(name, args, { tok, session: s })).status, status, name);
  // UC24: the public call with no token, then the protected probe with no token
  const anon = await rig.open();
  assert.equal((await rig.call('list_marketplace_apps', { limit: 5 }, { session: anon })).status, 200);
  const probe = await rig.call('get_my_issues', { limit: 1 }, { session: anon });
  assert.equal(probe.status, 401); assert.equal(probe.json.reason, 'no_token');
});

test('the audit header: shape, rule ids, trace from traceparent, and parseAuditTrail reads it', async () => {
  const tok = rig.token({});
  const s = await rig.open(tok);
  const trace = '0af7651916cd43dd8448eb211c80319c';
  const traceparent = `00-${trace}-b7ad6b7169203331-01`;
  const r = await rig.call('get_my_issues', {}, { tok, session: s, headers: { traceparent } });
  const raw = r.headers['x-gw-audit-trail'];
  assert.ok(raw.length <= 2000);
  assert.deepEqual(JSON.parse(raw), { decision: 'PERMIT', source: 'lab-policy', rule: 'lab-no-restriction', tool: 'get_my_issues', trace });
  assert.equal(parseAuditTrail(raw).decision, 'PERMIT');
  const noTrace = await rig.call('get_my_issues', {}, { tok, session: s, headers: { traceparent: 'garbage' } });
  assert.equal(audit(noTrace).trace, null);
  const rules = new Set();
  const calls = [['bulk_update_issues', bulk(2500)], ['bulk_update_issues', bulk(600)], ['bulk_update_issues', bulk(300)], ['scan_repository', { repo: 'x' }], ['brave_news_search', { query: 'bitcoin' }], ['get_project_security_settings', {}]];
  for (const [n, a] of calls) {
    const x = await rig.call(n, a, { tok, session: s });
    const p = parseAuditTrail(x.headers['x-gw-audit-trail']);
    assert.match(p.decision, /^[A-Za-z_ -]{1,40}$/);
    assert.equal(p.parsed.source, 'lab-policy');
    rules.add(p.parsed.rule);
  }
  assert.deepEqual([...rules].sort(), ['lab-band-deny', 'lab-band-hold', 'lab-band-step-up', 'lab-blocked-term', 'lab-group-gate', 'lab-repo-allowlist']);
  // no audit header on an RPC-level error or on a 401
  assert.equal((await rig.call('get_my_issues', { limit: 0 }, { tok, session: s })).headers['x-gw-audit-trail'], undefined);
  assert.equal((await rig.call('get_my_issues', {}, { session: await rig.open() })).headers['x-gw-audit-trail'], undefined);
});

test('no refusal carries a token, the approval secret, a claim value or the actor id; no tool grants access', async () => {
  const tok = rig.token({ sub: 'distinctive-sub-value-7' });
  const s = await rig.open(tok);
  const names = await rig.list(tok);
  assert.ok(names.every((n) => !n.startsWith('grant_')));
  const refusals = [
    await rig.call('bulk_update_issues', bulk(2500), { tok, session: s }), await rig.call('bulk_update_issues', bulk(600), { tok, session: s }),
    await rig.call('bulk_update_issues', bulk(300), { tok, session: s }), await rig.call('get_project_security_settings', {}, { tok, session: s }),
    await rig.call('scan_repository', { repo: 'x' }, { tok, session: s }), await rig.call('get_my_issues', {}, { session: await rig.open() }),
    await rig.call('get_my_issues', {}, { tok: rig.token({ aud: 'no' }), session: await rig.open() }),
  ];
  for (const r of refusals) {
    const blob = `${r.text} ${JSON.stringify(r.headers)}`;
    for (const secret of [tok, SECRET, 'distinctive-sub-value-7', ACTOR, tok.split('.')[1]]) assert.ok(!blob.includes(secret), 'no secret in a refusal');
  }
});

test('every string the server produced is free of the page-banned words', async () => {
  const banned = /mock|simulat|offline|\bengine\b|scripted/i;
  const tok = rig.token({ groups: [TIER_GROUP] });
  const s = await rig.open(tok);
  await rig.rpc('tools/list', {}, { tok, session: s });
  await rig.call('bulk_update_issues', bulk(300), { tok, session: s });
  await rig.call('get_my_issues', {}, { session: await rig.open() });
  await rig.raw('/health');
  assert.ok(rig.seen.length > 40);
  for (const r of rig.seen) assert.ok(!banned.test(`${r.text} ${JSON.stringify(r.headers)}`), `banned word in: ${r.text.slice(0, 120)}`);
});
