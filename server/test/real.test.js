// Full Real (owner, 2026-11-10) against FAKES only: the fake PingOne (pi.flow, flows API, resume, code, client credentials, the two token exchanges that
// mint and carry act) and the fake Agent Gateway (MCP). Nothing here reaches a real PingOne or SE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReal, realConfig, assertAuthUrl, scrubError, REDIRECT_URI, PASSWORD_SHOWN } from '../src/real.js';
import { createLive, liveConfig } from '../src/live.js';
import { gatewayHeaders, TRUSTED_HEADERS, SENT_HEADERS, assertNoTrusted, parseAuditTrail, parseRpc, gatewayUrlProblem } from '../src/mcpClient.js';
import { realGate, SE_MCP_TOOLS, toolArgs } from '../src/realGate.js';
import { MANIFEST, findUseCase } from '../src/manifest.js';
import { loadCast } from '../src/cast.js';
import { installNetguard } from '../src/netguard.js';
import { fullWanted, missingFull, FULL_KEYS } from '../src/settings.js';
import { get, post, run, W, withServer } from './helpers.js';
import { AGENT_AUDIENCE, AGENT_CLIENT_ID, AGENT_CLIENT_SECRET, AGENT_SCOPE, AUDIENCE, CLIENT_SECRET, DEMO_PASSWORD, DEMO_USERNAME, ENV_ID, SCOPE, USER_CLIENT_SECRET, fullSettingsFor, settingsFor, startFakePingOne } from './fakePingone.js';
import { AUDIT_TRAIL, startFakeGateway } from './fakeGateway.js';
import { findWords } from './wordScan.js';
import { A2A_GATEWAY_AUD, A2A_INTERMEDIATE_AUD, A2A_INTERMEDIATE_SCOPE, A2A_SCOPE, SPECIALIST_ID, SPECIALIST_SECRET, a2aSettings } from './fakePingone.js';

const ENV = { ALLOW_MOCK_SIGNIN: '1' };
const TP = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
// Starts both fakes and a lab with full Real; fn(url, { p1, gw, real }). setup(p1): change the fake PingOne before the lab runs (its resources, grants).
async function withFull(fn, { signin = 'ok', exchange = 'ok', gateway = 'ok', env = ENV, agentScope, settings = {}, setup } = {}) {
  const p1 = await startFakePingOne(agentScope ? { agentScope } : {});
  p1.state.full = { signin, exchange };
  if (setup) setup(p1);
  const gw = await startFakeGateway({ behaviour: gateway, isDelegated: (t) => p1.issued.delegated.has(t) });
  const real = createReal({ config: realConfig(fullSettingsFor(gw.url, settings), { AAG_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true });
  try { await withServer((url) => fn(url, { p1, gw, real }), { env, real }); } finally { await p1.close(); await gw.close(); }
}
const toReal = (url, h = {}) => post(url, '/api/mode', { source: 'real' }, h);
const signIn = async (url, password = DEMO_PASSWORD, h = {}) => { const r = await post(url, '/api/signin', { password }, h); return { status: r.status, text: await r.clone().text(), body: await r.json() }; };
const SECRETS = [DEMO_PASSWORD, USER_CLIENT_SECRET, AGENT_CLIENT_SECRET, CLIENT_SECRET];
const noSecret = (text, what) => { for (const s of SECRETS) assert.ok(!text.includes(s), `${what} carries a secret or the password`); };
const TX = 'urn:ietf:params:oauth:grant-type:token-exchange';
const claimsOf = (raw) => JSON.parse(Buffer.from(raw.split('.')[1], 'base64url').toString('utf8'));
// What the lab sent to the fake PingOne's token endpoint, in order: the form and the Authorization header.
const tokenCalls = (p1) => p1.seen.filter((c) => c.method === 'POST' && c.url.endsWith('/as/token')).map((c) => ({ form: Object.fromEntries(new URLSearchParams(c.body)), auth: c.headers.authorization }));
// No secret and no password in the words and hops of a run. Tokens are NOT hidden (owner 2026-11-14: this is a demo, tokens are shown raw in the hops and the token list).
const noSecretsInRun = (x, what) => {
  const text = JSON.stringify({ hops: x.hops, reply: x.reply, narration: x.narration });
  for (const sec of SECRETS) assert.ok(!text.includes(sec), `${what}: a secret is in the hops or the reply`);
};
const BASIC_AGENT = `Basic ${Buffer.from(`${AGENT_CLIENT_ID}:${AGENT_CLIENT_SECRET}`).toString('base64')}`;

test('the full chain: pi.flow sign-in, agent token, TWO token exchanges (act = agent, then for the gateway), gateway initialize + tools/list + tools/call, a real reply; every hop REAL', async () => {
  await withFull(async (url, { p1, gw }) => {
    assert.equal((await toReal(url)).status, 200);
    const pre = await (await get(url, '/api/signin')).json();
    assert.deepEqual([pre.available, pre.signedIn, pre.username, pre.method, pre.redirect], [true, false, DEMO_USERNAME, 'pi.flow', false]);
    const s = await signIn(url);
    assert.equal(s.status, 200); assert.equal(s.body.signedIn, true); assert.equal(s.body.user.name, DEMO_USERNAME);
    const auth = p1.seen.find((x) => x.url.includes('/as/authorize'));
    const q = new URL(auth.url, 'http://x').searchParams;
    assert.equal(q.get('response_mode'), 'pi.flow'); assert.equal(q.get('code_challenge_method'), 'S256'); assert.equal(q.get('redirect_uri'), REDIRECT_URI);
    assert.equal(q.get('scope'), 'openid profile email agent:invoke', 'the OIDC scopes plus the agent scope (PingOne refuses two resources in one authorize, so the gateway scope arrives on the exchange-2 token)'); assert.equal(REDIRECT_URI, 'http://127.0.0.1:7813/callback', 'one of the URIs the owner setup script registers');
    const r = await run(url, 'UC1', { vertical: 'banking' }, { traceparent: TP });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const x = r.body.run;
    assert.equal(x.kind, 'real'); assert.equal(x.outcome, 'REAL_PERMIT'); assert.equal(x.reply.who, 'Agent'); assert.match(x.reply.text, /balance 1200\.5/);
    assert.deepEqual(x.hops.map((h) => h.kind), ['sign-in', 'actor-token', 'token-exchange', 'token-exchange', 'gateway-check', 'authorize-decision', 'tool-dispatched', 'api-call', 'agent-reply']);
    assert.deepEqual(x.hops.slice(2, 4).map((h) => h.title), ['Exchange 1: act = agent', 'Exchange 2: for the gateway'], 'the two exchanges are told apart');
    assert.match(x.hops[2].label, /^Token exchange 1: act = agent/); assert.match(x.hops[3].label, /^Token exchange 2: for the gateway/);
    assert.ok(x.hops.every((h) => h.source === 'real' && h.mock === false && !/\[REAL\]|mock/i.test(h.label)), 'every hop ran for real (in the data); no label says so');
    assert.deepEqual([x.hops[2].response.body.act_claim, x.hops[3].response.body.act_claim], [{ sub: AGENT_CLIENT_ID }, { sub: AGENT_CLIENT_ID }], 'both exchange hops show the act they got');
    assert.deepEqual(findWords(x, 'real run'), [], 'a Real run says nothing about mock, simulation, offline or an engine (the page does not either)');
    assert.equal(x.traceparent.split('-')[1], TP.split('-')[1]);
    // The Tokens tab: the user, the agent (actor), exchange 1 and the delegated (exchange 2) token, each raw with its decoded claims.
    assert.equal(x.tokens.length, 4); assert.ok(x.tokens.every((t) => t.real && t.raw.split('.').length === 3), 'all four are shown raw');
    const [userTok, agentTok, ex1Tok, delegated] = x.tokens;
    assert.match(userTok.label, /^user access token/); assert.match(agentTok.label, /^agent token/); assert.match(ex1Tok.label, /^exchange 1 token.*act = agent/); assert.match(delegated.label, /^delegated token.*exchange 2/);
    assert.deepEqual(agentTok.claims.scope, AGENT_SCOPE);
    assert.deepEqual(ex1Tok.claims.act, { sub: AGENT_CLIENT_ID }); assert.equal(ex1Tok.claims.aud, AGENT_AUDIENCE); assert.equal(ex1Tok.claims.scope, AGENT_SCOPE); assert.equal(ex1Tok.claims.sub, userTok.claims.sub, 'exchange 1 keeps the user as the subject');
    assert.deepEqual(delegated.claims.act, { sub: AGENT_CLIENT_ID }, 'act carried over to exchange 2'); assert.equal(delegated.claims.aud, 'fake-gateway-audience'); assert.equal(delegated.claims.scope, SCOPE); assert.equal(delegated.claims.sub, userTok.claims.sub);
    assert.deepEqual([ex1Tok.expectAct, delegated.expectAct], [true, true], 'the page shows act next to the exchange tokens');
    // What the lab sent to PingOne: the code, the actor token, exchange 1, exchange 2 (in that order).
    const calls = tokenCalls(p1);
    assert.deepEqual(calls.map((c) => c.form.grant_type), ['authorization_code', 'client_credentials', TX, TX]);
    assert.equal(calls[1].form.scope, AGENT_SCOPE, 'the actor token asks for the agent scope'); assert.equal(calls[1].auth, BASIC_AGENT);
    const [e1, e2] = [calls[2], calls[3]];
    assert.deepEqual(e1.form, { grant_type: TX, subject_token: userTok.raw, subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', actor_token: agentTok.raw, actor_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: AGENT_SCOPE }, 'exchange 1: the user as subject, the agent as actor, the agent scope, no audience');
    assert.deepEqual(e2.form, { grant_type: TX, subject_token: ex1Tok.raw, subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', scope: SCOPE }, 'exchange 2: the exchange-1 token as subject, NO actor token, NO audience, the gateway scope');
    assert.deepEqual([e1.auth, e2.auth], [BASIC_AGENT, BASIC_AGENT], 'both exchanges authenticate as the agent app');
    // The old single exchange is gone: no call asks for the gateway scope with an actor, and none sends an audience.
    assert.equal(calls.filter((c) => c.form.grant_type === TX).length, 2);
    assert.ok(!calls.some((c) => c.form.actor_token && c.form.scope === SCOPE), 'no exchange has the actor and the gateway scope together');
    assert.ok(calls.every((c) => c.form.audience === undefined && c.form.resource === undefined), 'no audience or resource parameter is sent');
    const methods = gw.seen.map((c) => c.rpc.method);
    assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'tools/call']);
    assert.deepEqual(gw.seen.slice(3).map((c) => c.rpc.params.name), ['get_my_accounts', 'get_account_balance']);
    assert.equal(gw.seen[4].rpc.params.arguments.account_id, 'acct-fake-1');
    for (const c of gw.seen) {
      assert.equal(c.headers['x-token-validation'], 'jwks'); assert.equal(c.headers['x-active-vertical'], 'banking'); assert.match(c.headers.traceparent, /^00-0af7651916cd43dd8448eb211c80319c-/);
      assert.ok(p1.issued.delegated.has(c.headers.authorization.slice(7)), 'the bearer is the delegated token');
      assert.equal(c.headers.authorization, `Bearer ${delegated.raw}`, 'the bearer is the exchange-2 token, not the user, agent or exchange-1 token');
    }
    assert.ok(gw.seen.slice(1).every((c) => c.headers['mcp-session-id'] === 'fake-mcp-session-0001'), 'Mcp-Session-Id after initialize');
    noSecret(JSON.stringify(r.body) + s.text, 'the run or the sign-in answer');
    assert.ok(!JSON.stringify(r.body).includes('fake-refresh-never-shown'), 'the refresh token is dropped');
    // A token is raw in the token list only: no hop (request, response or note) carries one of the four.
    for (const t of x.tokens) assert.ok(JSON.stringify(x.hops).includes(t.raw), `a hop carries the raw ${t.label} (tokens are not redacted)`);
  });
});

test('no trusted-caller header is ever sent, and the client refuses to build one', async () => {
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    await run(url, 'UC1', { vertical: 'banking' }, { 'x-demo-force-actor': 'rogue', 'x-internal-gateway-secret': 'x', 'x-act-client-id': 'y', 'x-may-act-sub': 'z', 'x-authz-simulated': '1' });
    assert.ok(gw.seen.length >= 3);
    for (const c of gw.seen) {
      for (const h of TRUSTED_HEADERS) assert.equal(c.headers[h], undefined, `${h} reached the gateway`);
      for (const h of Object.keys(c.headers)) assert.ok([...SENT_HEADERS, 'host', 'connection', 'content-length', 'accept-encoding', 'accept-language', 'sec-fetch-mode', 'user-agent'].includes(h), `unexpected header ${h}`);
    }
  });
  assert.deepEqual(TRUSTED_HEADERS, ['x-internal-gateway-secret', 'x-authz-simulated', 'x-act-client-id', 'x-may-act-sub', 'x-demo-force-actor']);
  for (const h of TRUSTED_HEADERS) assert.throws(() => assertNoTrusted({ [h.toUpperCase()]: 'x' }), /trusted-caller/);
  assert.throws(() => assertNoTrusted({ 'x-other': '1' }), /Only the listed/);
  assert.deepEqual(Object.keys(gatewayHeaders({ token: 't', traceparent: TP, vertical: 'banking' })).sort(), ['accept', 'authorization', 'content-type', 'traceparent', 'x-active-vertical', 'x-token-validation']);
});

test('error mapping: 403 DENY with the audit trail, 401 token problem with WWW-Authenticate, 428 held (approval simulated), 503 SE down, tool error, tool not listed; never retried', async () => {
  const cases = [
    ['deny', 'REAL_DENY', 'Authorize', /denied this request \(HTTP 403.*decision DENY/],
    ['token', 'REAL_TOKEN_PROBLEM', 'Gateway', /HTTP 401.*invalid_token/],
    ['hold', 'REAL_HOLD', 'Authorize', null],
    ['down', 'REAL_UNREACHABLE', 'Gateway', /answered HTTP 503 and did not complete the call/],
    ['tool-error', 'REAL_TOOL_ERROR', 'Agent', /answered with an error: fake: the account was not found/],
    ['no-tool', 'REAL_NOT_LISTED', 'Gateway', /does not list the tool get_account_balance/],
  ];
  for (const [behaviour, outcome, who, text] of cases) {
    await withFull(async (url, { gw }) => {
      await toReal(url); await signIn(url);
      const r = await run(url, 'UC1', { vertical: 'banking' });
      assert.equal(r.status, 200, behaviour); const x = r.body.run;
      assert.equal(x.outcome, outcome, behaviour); assert.equal(x.reply.who, who, behaviour);
      if (text) assert.match(x.reply.text, text, behaviour);
      assert.equal(x.hops.length, 9, `${behaviour}: always the nine hops`);
      assert.deepEqual(findWords(x, behaviour), [], `${behaviour}: an honest refusal in plain words, with no advice to switch to the lab's own steps`);
      assert.ok(x.hops.every((h) => (h.source === 'real') === (h.verdict !== 'skip')), `${behaviour}: a hop that did not run says NOT RUN, never REAL`);
      assert.ok(x.hops.every((h) => (h.source === 'not-run' ? /\[NOT RUN\]$/ : /^(?!.*(\[REAL\]|\[NOT RUN\]|mock))/i).test(h.label)), `${behaviour}: only a hop that did not run is marked`);
      if (behaviour === 'deny') {
        const d = x.hops.find((h) => h.kind === 'authorize-decision');
        assert.equal(d.decision.outcome, 'DENY'); assert.deepEqual(d.response['x-gw-audit-trail'], JSON.parse(AUDIT_TRAIL));
      }
      if (behaviour === 'token') assert.match(x.hops.find((h) => h.kind === 'gateway-check').note, /WWW-Authenticate: Bearer error="invalid_token"/);
      if (behaviour === 'hold') { assert.equal(x.reply.approval.head, 'Held for approval'); assert.match(x.reply.approval.body, /Approve \(or deny\) on the phone/); assert.doesNotMatch(JSON.stringify(x.reply), /mock/i); assert.equal(x.hops.find((h) => h.kind === 'tool-held').verdict, 'held'); }
      const calls = gw.seen.filter((c) => c.rpc.method === 'initialize').length;
      assert.equal(calls, 1, `${behaviour}: initialize once, no retry loop`);
    }, { gateway: behaviour });
  }
});

test('a gateway that does not answer at all (connect error) is SE down, with one attempt', async () => {
  const p1 = await startFakePingOne();
  const real = createReal({ config: realConfig(fullSettingsFor('http://127.0.0.1:9/mcp'), { AAG_LIVE_TEST_BASE: p1.base }), wanted: true });
  try {
    await withServer(async (url) => {
      await toReal(url); await signIn(url);
      const r = await run(url, 'UC1', { vertical: 'banking' });
      assert.equal(r.body.run.outcome, 'REAL_UNREACHABLE'); assert.match(r.body.run.reply.text, /No decision.*could not be reached: the connection failed before any response/); assert.doesNotMatch(r.body.run.reply.text, /switch to mock/i, 'an honest refusal, no advice to switch');
    }, { env: ENV, real });
  } finally { await p1.close(); }
});

test('PingOne refusals: wrong password 401, an MFA step 409, refused exchange, no act claim noted; the password never appears', async () => {
  await withFull(async (url) => {
    await toReal(url);
    const s = await signIn(url, 'not-the-password-123');
    assert.equal(s.status, 401); assert.equal(s.body.error, 'signin_rejected'); assert.match(s.body.message, /did not accept the username or password/);
    assert.ok(!s.text.includes('not-the-password-123'), 'a wrong password is not echoed');
    assert.equal((await run(url, 'UC1', { vertical: 'banking' })).status, 401, 'still not signed in');
  });
  await withFull(async (url) => {
    await toReal(url);
    const s = await signIn(url); assert.equal(s.status, 409); assert.equal(s.body.error, 'signin_step_unsupported');
  }, { signin: 'mfa' });
  await withFull(async (url) => {
    await toReal(url); assert.equal((await signIn(url)).status, 200, 'resume path');
    const r = await run(url, 'UC1', { vertical: 'banking' }); assert.equal(r.body.run.outcome, 'REAL_PERMIT');
  }, { signin: 'resume' });
  // A refused exchange 1: PingOne says so, exchange 2 is NOT RUN, the gateway is never called.
  await withFull(async (url, { gw, p1 }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_REFUSED'); assert.equal(x.reply.who, 'PingOne'); assert.match(x.reply.text, /refused token exchange 1 \(HTTP 400: invalid_request\)/); assert.equal(gw.seen.length, 0);
    assert.deepEqual(x.hops.slice(2, 4).map((h) => [h.source, h.verdict]), [['real', 'deny'], ['not-run', 'skip']]); assert.match(x.hops[3].label, /^Token exchange 2: for the gateway \[NOT RUN\]$/);
    noSecretsInRun(x, 'refused exchange 1');
    assert.equal(tokenCalls(p1).filter((c) => c.form.grant_type === TX).length, 1, 'exchange 2 was not attempted');
  }, { exchange: 'refuse' });
  // A refused exchange 2: the exchange-1 token is still shown, the gateway is never called.
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_REFUSED'); assert.match(x.reply.text, /refused token exchange 2 \(HTTP 400: invalid_request\)/); assert.equal(gw.seen.length, 0);
    assert.deepEqual(x.hops.slice(2, 4).map((h) => [h.source, h.verdict]), [['real', 'ok'], ['real', 'deny']]); assert.equal(x.tokens.length, 3, 'user, agent and exchange-1 tokens');
    noSecretsInRun(x, 'refused exchange 2');
  }, { exchange: 'refuse-2' });
  // The agent app has no grant for the agent scope (the owner has not re-run the setup script yet): the actor token is refused, and the words say what to do.
  await withFull(async (url, { gw, p1 }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_REFUSED'); assert.match(x.reply.text, /scope agent:invoke \(invalid_scope\).*no grant.*pingone-real-setup\.mjs --apply/s);
    assert.equal(x.hops.length, 9); assert.deepEqual(x.hops.slice(2, 4).map((h) => h.source), ['not-run', 'not-run']); assert.equal(gw.seen.length, 0);
    assert.equal(tokenCalls(p1).filter((c) => c.form.grant_type === TX).length, 0);
  }, { setup: (p1) => { p1.state.agentGrants = [SCOPE]; } });
});

test('act is required: a token without act after exchange 2 stops the run BEFORE the gateway (nothing is sent to it), with the clear message', async () => {
  const MSG = "the delegated token carries no act claim: check the agent:invoke resource's act attribute";
  // (a) The agent scope's resource has no act attribute: exchange 1 already has no act, so exchange 2 is not spent.
  await withFull(async (url, { gw, p1 }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC1', { vertical: 'banking' });
    assert.equal(r.status, 200); const x = r.body.run;
    assert.equal(x.outcome, 'REAL_NO_ACT'); assert.equal(x.reply.who, 'PingOne'); assert.ok(x.reply.text.includes(MSG), x.reply.text); assert.match(x.reply.text, /nothing was sent to it/);
    assert.equal(gw.seen.length, 0, 'the gateway was never called'); assert.equal(x.hops.length, 9);
    assert.deepEqual(x.hops.map((h) => h.source), ['real', 'real', 'real', 'not-run', 'not-run', 'not-run', 'not-run', 'not-run', 'not-run']);
    assert.equal(x.hops[2].verdict, 'deny'); assert.match(x.hops[2].note, /NO act claim/); assert.equal(x.hops[2].response.body.act_claim, 'ABSENT'); assert.match(x.hops[3].note, /exchange 1 carries no act claim/);
    assert.equal(tokenCalls(p1).filter((c) => c.form.grant_type === TX).length, 1, 'exchange 2 only passes act through, so it is not attempted');
    assert.deepEqual(x.tokens.map((t) => t.claims.act === undefined), [true, true, true]); assert.equal(x.tokens[2].expectAct, true, 'the page can say "no act claim" next to it');
    noSecretsInRun(x, 'no act after exchange 1');
  }, { setup: (p1) => { p1.state.resources.agent.act = 'absent'; } });
  // (b) Exchange 1 has act, but the gateway scope's resource does not pass it through (the old bug's cousin): exchange 2 has none, the gateway is not called.
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_NO_ACT'); assert.ok(x.reply.text.includes(MSG)); assert.match(x.reply.text, /Exchange 1 had the claim.*passes the subject token's act through.*never edits that resource/);
    assert.equal(gw.seen.length, 0); assert.equal(x.hops.length, 9);
    assert.deepEqual(x.hops.map((h) => h.source), ['real', 'real', 'real', 'real', 'not-run', 'not-run', 'not-run', 'not-run', 'not-run']);
    assert.deepEqual(x.hops.slice(2, 4).map((h) => h.verdict), ['ok', 'deny']); assert.equal(x.hops[3].response.body.act_claim, 'ABSENT');
    assert.equal(x.tokens.length, 4); assert.deepEqual(x.tokens[2].claims.act, { sub: AGENT_CLIENT_ID }); assert.equal(x.tokens[3].claims.act, undefined);
    assert.ok(x.hops.every((h) => (h.source === 'not-run' ? /\[NOT RUN\]$/ : /^(?!.*(\[REAL\]|\[NOT RUN\]|mock))/i).test(h.label)));
    noSecretsInRun(x, 'no act after exchange 2');
  }, { setup: (p1) => { p1.state.resources.gateway.act = 'absent'; } });
  // (d) An act that names nobody (no sub) is no act: HasValidActorChain could not match it.
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_NO_ACT'); assert.equal(gw.seen.length, 0); assert.equal(x.hops[2].response.body.act_claim, 'ABSENT');
  }, { setup: (p1) => { p1.state.resources.agent.act = 'empty'; } });
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_NO_ACT', 'an act with a blank sub is no act'); assert.equal(gw.seen.length, 0);
  }, { setup: (p1) => { p1.state.resources.agent.act = 'blank'; } });
  // (c) With a correct setup the same use case reaches the gateway (the contrast).
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    assert.equal((await run(url, 'UC1', { vertical: 'banking' })).body.run.outcome, 'REAL_PERMIT'); assert.ok(gw.seen.length >= 3);
  });
});

test('the fake PingOne models the old bug: ONE exchange (user + agent actor + gateway scope) or an exchange 2 on the plain user token mints NO act, and the gateway refuses it', async () => {
  const p1 = await startFakePingOne();
  const gw = await startFakeGateway({ isDelegated: (t) => p1.issued.delegated.has(t) });
  const real = createReal({ config: realConfig(fullSettingsFor(gw.url), { AAG_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true });
  try {
    assert.equal((await real.signIn('w', DEMO_PASSWORD)).ok, true);
    const user = real.session('w').accessToken;
    const AT = 'urn:ietf:params:oauth:token-type:access_token';
    const post = async (form) => (await fetch(`${p1.base}/as/token`, { method: 'POST', headers: { authorization: BASIC_AGENT, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) })).json();
    const agent = (await post({ grant_type: 'client_credentials', scope: AGENT_SCOPE })).access_token;
    const one = await post({ grant_type: TX, subject_token: user, subject_token_type: AT, actor_token: agent, actor_token_type: AT, audience: AUDIENCE, scope: SCOPE });
    assert.equal(claimsOf(one.access_token).act, undefined, 'the old single exchange: no act');
    const plain = await post({ grant_type: TX, subject_token: user, subject_token_type: AT, scope: SCOPE });
    assert.equal(claimsOf(plain.access_token).act, undefined, 'exchange 2 on a plain user token: no act');
    const init = (token) => fetch(gw.url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    assert.equal((await init(one.access_token)).status, 401, 'the gateway refuses the act-less token'); assert.equal((await init(plain.access_token)).status, 401);
    const ex1 = await post({ grant_type: TX, subject_token: user, subject_token_type: AT, actor_token: agent, actor_token_type: AT, scope: AGENT_SCOPE });
    assert.deepEqual(claimsOf(ex1.access_token).act, { sub: AGENT_CLIENT_ID }, 'exchange 1 mints act from the actor token, only on the agent scope');
    const ex2 = await post({ grant_type: TX, subject_token: ex1.access_token, subject_token_type: AT, scope: SCOPE });
    assert.deepEqual(claimsOf(ex2.access_token).act, { sub: AGENT_CLIENT_ID }, 'exchange 2 passes it through'); assert.equal((await init(ex2.access_token)).status, 200);
    const onGateway = await post({ grant_type: TX, subject_token: user, subject_token_type: AT, actor_token: agent, actor_token_type: AT, scope: SCOPE });
    assert.equal(claimsOf(onGateway.access_token).act, undefined, 'the gateway scope never mints act from an actor token');
    assert.equal((await post({ grant_type: TX, subject_token: user, subject_token_type: AT, scope: 'no:such:scope' })).error, 'invalid_scope');
  } finally { await p1.close(); await gw.close(); }
});

test('AAG_AGENT_SCOPE: optional, default agent:invoke; a custom scope is what the actor token and exchange 1 ask for; a bad one names the setting', async () => {
  const good = fullSettingsFor('https://gw.lab-test.net/mcp');
  assert.equal(realConfig(good, {}).agentScope, 'agent:invoke'); assert.equal(realConfig({ ...good, AAG_AGENT_SCOPE: '' }, {}).agentScope, 'agent:invoke', 'empty (compose passes an empty value) is the default');
  assert.equal(realConfig({ ...good, AAG_AGENT_SCOPE: 'custom:agent' }, {}).agentScope, 'custom:agent');
  for (const v of ['a  b', 'a b', ' a', 'a"b', 'a\nb', 'x'.repeat(301)]) assert.match(realConfig({ ...good, AAG_AGENT_SCOPE: v }, {}).problem, /AAG_AGENT_SCOPE/, JSON.stringify(v.slice(0, 8)));
  assert.match(realConfig({ ...good, AAG_AGENT_SCOPE: SCOPE }, {}).problem, /AAG_AGENT_SCOPE equal to AAG_GATEWAY_SCOPE/, 'exchange 1 must not ask for the gateway scope');
  assert.match(realConfig({ ...good, AAG_GATEWAY_SCOPE: `x:y ${AGENT_SCOPE}` }, {}).problem, /equal to AAG_GATEWAY_SCOPE/);
  assert.deepEqual(missingFull(good), [], 'it is not one of the required names'); assert.ok(!FULL_KEYS.includes('AAG_AGENT_SCOPE'));
  assert.equal(fullWanted({ AAG_AGENT_SCOPE: 'custom:agent' }), false, 'on its own it does not make full Real the target');
  await withFull(async (url, { p1 }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_PERMIT');
    assert.deepEqual(tokenCalls(p1).slice(1, 3).map((c) => c.form.scope), ['custom:agent', 'custom:agent']);
    assert.match(x.hops[1].label, /scope custom:agent/);
  }, { agentScope: 'custom:agent', settings: { AAG_AGENT_SCOPE: 'custom:agent' } });
});

test('the exchange-2 token\'s aud is checked against AAG_GATEWAY_AUDIENCE: a difference is a clear note, not a stop', async () => {
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.match(x.hops[3].note, /The token's aud \(fake-gateway-audience\) is not AAG_GATEWAY_AUDIENCE.*Check which resource owns the gateway scope/);
    assert.match(x.tokens[3].notice, /is not AAG_GATEWAY_AUDIENCE/); assert.ok(gw.seen.length >= 3, 'the run went on');
  }, { settings: { AAG_GATEWAY_AUDIENCE: 'https://some-other-audience.example/mcp' } });
  await withFull(async (url) => {
    await toReal(url); await signIn(url);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.doesNotMatch(x.hops[3].note, /AAG_GATEWAY_AUDIENCE/, 'no note when the audience matches');
  });
});

test('the password is never logged, stored, returned or shown in a hop; the sign-in answer carries a fixed placeholder', async () => {
  const logs = []; const rawTokens = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => { logs.push(a.map(String).join(' ')); };
  try {
    await withFull(async (url, { real }) => {
      await toReal(url);
      const s = await signIn(url);
      assert.equal(s.status, 200);
      const step = s.body.steps.find((x) => /username and password/.test(x.step));
      assert.equal(step.request.body.password, PASSWORD_SHOWN);
      const r = await run(url, 'UC1', { vertical: 'banking' });
      assert.equal(r.body.run.tokens.length, 4); rawTokens.push(...r.body.run.tokens.map((t) => t.raw));
      const texts = [s.text, JSON.stringify(r.body)];
      for (const p of ['/api/info', '/api/signin', '/api/runs', '/api/mode', '/api/health']) texts.push(await (await get(url, p)).text());
      noSecret(texts.join(''), 'an answer');
      const session = real.session('default');
      assert.ok(!JSON.stringify(session).includes(DEMO_PASSWORD), 'the session holds no password');
    });
  } finally { Object.assign(console, orig); }
  assert.ok(!logs.join('\n').includes(DEMO_PASSWORD), 'no log line carries the password');
  for (const secret of [...SECRETS, ...rawTokens]) assert.ok(!logs.join('\n').includes(secret), 'no log line carries a client secret or a token');
});

test('sign-in input is bounded and never echoed; unknown fields refused; GET /api/signin and POST refuse when full Real is not available (409)', async () => {
  await withFull(async (url) => {
    for (const body of [{}, { password: '' }, { password: 'x'.repeat(257) }, { password: 5 }, { password: 'a', username: 'other' }]) {
      const r = await post(url, '/api/signin', body); assert.equal(r.status, 400); assert.ok(!(await r.text()).includes('x'.repeat(50)));
    }
  });
  await withServer(async (url) => {
    const g = await (await get(url, '/api/signin')).json(); assert.equal(g.available, false); assert.equal(g.username, null); assert.match(g.reason, /AAG_USER_CLIENT_ID/);
    const r = await post(url, '/api/signin', { password: 'whatever-1' }); assert.equal(r.status, 409);
  }, { env: ENV });
});

test('rule 19: not configured = Real disabled with the missing names, POST /api/mode 409; toggle both ways without a restart; Reset ends the sign-in', async () => {
  await withServer(async (url) => {
    const info = await (await get(url, '/api/info')).json();
    assert.equal(info.realAvailable, false); assert.equal(info.real.level, null);
    assert.deepEqual(info.real.missing, ['PINGONE_ENVIRONMENT_ID', ...FULL_KEYS]);
    const r = await toReal(url); assert.equal(r.status, 409); assert.match((await r.json()).message, /fill PINGONE_ENVIRONMENT_ID, AAG_USER_CLIENT_ID/);
  }, { env: ENV, real: createReal({ missing: missingFull({}), wanted: false }) });
  await withFull(async (url) => {
    const info = await (await get(url, '/api/info')).json();
    assert.equal(info.realAvailable, true); assert.equal(info.real.level, 'full'); assert.deepEqual(info.real.missing, []); assert.equal(info.real.redirectUri, REDIRECT_URI);
    for (const src of ['real', 'mock', 'real', 'mock']) {
      assert.equal((await post(url, '/api/mode', { source: src })).status, 200);
      assert.equal((await (await get(url, '/api/info')).json()).source, src);
    }
    await toReal(url); await signIn(url);
    assert.equal((await run(url, 'UC1', { vertical: 'banking' })).body.run.kind, 'real');
    await post(url, '/api/mode', { source: 'mock' });
    assert.equal((await run(url, 'UC1', { vertical: 'banking' })).body.run.mode, 'mock', 'back to Mock without a restart');
    await post(url, '/api/reset', {});
    assert.equal((await (await get(url, '/api/signin')).json()).signedIn, true, 'Reset ends the workspace\'s token session, not the PingOne session: signed in again with no password (owner 2026-11-16)');
    await post(url, '/api/signout', {});
    assert.equal((await (await get(url, '/api/signin')).json()).signedIn, false, 'an explicit Sign out ends it for good');
    await toReal(url);
    assert.equal((await run(url, 'UC1', { vertical: 'banking' })).status, 401);
  });
});

test('a sign-in is a token session per workspace; another workspace signs in from the PingOne session (no password); sign-out ends it', async () => {
  await withFull(async (url) => {
    await toReal(url, W('ws-a')); await toReal(url, W('ws-b'));
    await signIn(url, DEMO_PASSWORD, W('ws-a'));
    assert.equal((await run(url, 'UC1', { vertical: 'banking' }, W('ws-a'))).status, 200);
    assert.equal((await run(url, 'UC1', { vertical: 'banking' }, W('ws-b'))).status, 200, 'the other workspace signs in from the PingOne session: no password');
    await post(url, '/api/signout', {}, W('ws-a'));
    assert.equal((await run(url, 'UC1', { vertical: 'banking' }, W('ws-a'))).status, 401);
  });
});

test('use-case gating: only tools served through the SE gateway run Real; the rest run on the LABELLED MOCK engine in Real mode (owner 2026-11-16, reversing the 2026-11-13 refusal)', async () => {
  const cast = loadCast('/nonexistent', 'banking');
  const realIds = MANIFEST.usecases.filter((u) => realGate(u, cast).real).map((u) => u.id);
  // Owner 2026-11-13: UC7/UC8 (HITL with the SE gateway's real challenge pipeline) run Real too. 2026-11-16: UC33 (api-resource-server scaled up on SE)
  // and the third-party tool servers (UC30, UC31, UC41, UC42, UC-TOOL1) run Real; the gateway's own tools/list still decides at run time.
  assert.deepEqual(realIds, ['UC1', 'UC3', 'UC19', 'UC20', 'UC33', 'UC4', 'UC6', 'UC7', 'UC8', 'UC21', 'UC24', 'UC17', 'UC30', 'UC31', 'UC41', 'UC42', 'UC-TOOL1', 'UC28']);
  const why = (id) => realGate(findUseCase(id), cast).reason;
  // The software pack: the SE gateway serves none of its tools, so no use case runs Real, even the pass-through third-party ones (brave_news_search, code_search).
  const soft = loadCast('/nonexistent', 'software');
  assert.deepEqual(MANIFEST.usecases.filter((u) => realGate(u, soft).real).map((u) => u.id), [], 'no software use case runs Real');
  for (const id of ['UC41', 'UC42', 'UC-TOOL1', 'UC1', 'UC7']) assert.match(realGate(findUseCase(id), soft).reason, /SE gateway serves no tool of this vertical/, id);
  assert.match(realGate(findUseCase('UC9'), soft).reason, /guided page|SE gateway serves no tool/, 'a guided page keeps its own reason or the pack one');
  assert.match(why('UC13'), /trusted-caller/); assert.match(why('UC18'), /trusted-caller/);
  assert.equal(realGate(findUseCase('UC21'), cast).tool, 'get_sensitive_account_details', 'UC21 runs Real: the tier is the signed-in user\'s own PingOne group');
  assert.match(why('UC22'), /approval/); assert.match(why('UC2'), /A2A/); assert.match(why('UC37'), /A2A/);
  assert.match(why('UC40'), /Privilege|ID-JAG/); assert.match(why('UC9'), /feature flag/);
  assert.deepEqual(['UC33', 'UC30', 'UC41', 'UC-TOOL1'].map((id) => realGate(findUseCase(id), cast).tool), ['show_mortgage', 'get_weather', 'brave_news_search', 'code_search']);
  for (const id of realIds) assert.ok(SE_MCP_TOOLS.has(realGate(findUseCase(id), cast).tool));
  assert.deepEqual(toolArgs('get_weather', { args: { state: 'FL' } }), { state: 'FL' }); assert.deepEqual(toolArgs('get_weather', {}), { state: 'TX' });
  assert.deepEqual(toolArgs('brave_news_search', { args: { query: 'regional weather outlook' } }), { query: 'regional weather outlook' });
  assert.deepEqual(toolArgs('show_mortgage', {}), {});
  await withFull(async (url, { gw }) => {
    await toReal(url);
    const r = await run(url, 'UC2', { vertical: 'banking' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const x = r.body.run;
    assert.equal(x.mode, 'mock'); assert.equal(x.kind, 'flow'); assert.ok(x.hops.length > 0);
    assert.deepEqual(x.realGate, { real: false, reason: x.realGate.reason }); assert.match(x.realGate.reason, /agent-to-agent/);
    assert.ok(x.hops.every((h) => h.source === 'mock' || h.source === 'not-run'), 'every hop of a fallback run is MOCK or NOT RUN, never REAL (in the data)');
    // The engine still marks itself in the DATA (hop.mock, hop.source, token.mock, run.mode, run.realGate) while no word says so (owner 2026-11-16).
    assert.ok(x.hops.every((h) => h.mock === true), 'every hop says mock:true in the data');
    assert.ok(x.tokens.length > 0 && x.tokens.every((t) => t.mock === true && !/mock/i.test(t.label) && t.notice === 'Shown raw for teaching.'), 'tokens say mock:true in the data, with a neutral label and notice');
    assert.deepEqual(findWords(x, 'fallback run'), [], 'a fallback run reads like any other run');
    assert.equal((await (await get(url, '/api/info')).json()).source, 'real', 'the workspace stays in Real: only this run used the lab\'s own steps');
    assert.equal(gw.seen.length, 0, 'a use case that cannot run Real never calls the gateway');
    const hist = await (await get(url, '/api/runs')).json();
    assert.equal(hist.runs.at(-1).id, 'UC2');
    const list = await (await get(url, '/api/usecases?vertical=banking')).json();
    const uc1 = list.tracks.flatMap((t) => t.usecases).find((u) => u.id === 'UC1'); assert.equal(uc1.realGate.real, true);
    const uc2 = list.tracks.flatMap((t) => t.usecases).find((u) => u.id === 'UC2'); assert.equal(uc2.realGate.real, false); assert.match(uc2.realGate.reason, /A2A/);
  });
});

test('UC33 (show my mortgage) runs Real now that api-resource-server is up on SE: tools/call show_mortgage, a REAL_PERMIT reply, every hop REAL', async () => {
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC33', { vertical: 'banking' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const x = r.body.run;
    assert.equal(x.kind, 'real'); assert.equal(x.outcome, 'REAL_PERMIT'); assert.equal(x.hops.length, 9);
    const call = gw.seen.find((c) => c.rpc?.method === 'tools/call');
    assert.equal(call.rpc.params.name, 'show_mortgage'); assert.deepEqual(call.rpc.params.arguments, {});
    assert.ok(x.hops.every((h) => h.verdict === 'skip' || h.source === 'real'));
  });
});

test('a third-party tool (UC31, get_weather) runs Real with the state the use case stages; if the gateway does not list it the run stops REAL_NOT_LISTED and never calls it', async () => {
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC31', { vertical: 'banking' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const call = gw.seen.find((c) => c.rpc?.method === 'tools/call');
    assert.equal(call.rpc.params.name, 'get_weather'); assert.deepEqual(call.rpc.params.arguments, { state: 'FL' });
    assert.equal(r.body.run.kind, 'real');
  });
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC31', { vertical: 'banking' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.run.outcome, 'REAL_NOT_LISTED'); assert.match(r.body.run.reply.text, /does not list the tool get_weather/);
    assert.equal(gw.seen.filter((c) => c.rpc?.method === 'tools/call').length, 0, 'a tool the gateway does not list is never called');
  }, { gateway: 'no-weather' });
});

test('UC21 (entitlement tiers) runs Real: a premium user is offered get_sensitive_account_details and it runs; a standard user is never offered it (REAL_NOT_LISTED, never called)', async () => {
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC21', { vertical: 'banking', persona: 'premium' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.run.kind, 'real'); assert.equal(r.body.run.outcome, 'REAL_PERMIT');
    const call = gw.seen.filter((c) => c.rpc?.method === 'tools/call').find((c) => c.rpc.params.name === 'get_sensitive_account_details');
    assert.ok(call, 'the sensitive tool was called'); assert.deepEqual(gw.seen.filter((c) => c.headers['x-demo-force-tier']).length, 0, 'no tier header is ever sent');
  });
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC21', { vertical: 'banking', persona: 'premium' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const x = r.body.run;
    assert.equal(x.outcome, 'REAL_NOT_LISTED'); assert.equal(x.reply.who, 'Gateway');
    assert.match(x.reply.text, /does not offer the tool get_sensitive_account_details to this user/); assert.match(x.reply.text, /standard tier/); assert.match(x.reply.text, /premium-tier group/);
    assert.ok(!/Switch to Mock/.test(x.reply.text), 'the tier case does not tell the visitor to switch to Mock');
    assert.equal(gw.seen.filter((c) => c.rpc?.method === 'tools/call' && c.rpc.params.name === 'get_sensitive_account_details').length, 0, 'a tool the gateway does not offer is never called');
  }, { gateway: 'no-sensitive' });
});

test('in Real mode, a use case that cannot run Real is refused with the reason only when the mock engine is not available here', async () => {
  await withFull(async (url, { gw }) => {
    await toReal(url);
    const r = await run(url, 'UC2', { vertical: 'banking' });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'mock_in_real_refused');
    assert.match(r.body.detail, /“A2A delegation” cannot run Real \(the agent-to-agent/); assert.match(r.body.detail, /sign-in is not available here to run it on the lab's own steps/);
    assert.equal(gw.seen.length, 0);
  }, { env: { ...ENV, ALLOW_MOCK_SIGNIN: '' } });
});

test('the old two-call path only while the new settings are absent, labelled identity provider only; any AAG_* setting turns it off', async () => {
  const fake = await startFakePingOne();
  try {
    const live = createLive({ config: liveConfig(settingsFor(), { AAG_LIVE_TEST_BASE: fake.base }) });
    await withServer(async (url) => {
      const info = await (await get(url, '/api/info')).json();
      assert.equal(info.real.level, 'idp-only'); assert.match(info.real.label, /identity provider only/); assert.ok(info.real.missing.includes('AAG_USER_CLIENT_ID'));
      assert.equal((await toReal(url)).status, 200);
      const r = await run(url, 'UC1', { vertical: 'banking' });
      assert.equal(r.body.run.kind, 'live'); assert.equal(r.body.run.real.level, 'idp-only'); assert.equal(fake.seen.length, 2);
      assert.ok(r.body.run.hops.every((h) => h.source === 'real' && /identity provider only \[REAL\]/.test(h.label)));
    }, { env: ENV, live, real: createReal({ missing: missingFull(settingsFor()), wanted: false }) });
    // One AAG_* name set (the owner started the scripts): the old path is ignored, Real is unavailable until all are set.
    const partial = { ...settingsFor(), AAG_USER_CLIENT_ID: 'u-1' };
    assert.equal(fullWanted(partial), true); assert.equal(fullWanted(settingsFor()), false);
    await withServer(async (url) => {
      const info = await (await get(url, '/api/info')).json();
      assert.equal(info.real.level, null); assert.equal(info.realAvailable, false); assert.equal(info.liveSettings.configured, false);
      assert.ok(!info.real.missing.includes('AAG_USER_CLIENT_ID') && info.real.missing.includes('AAG_AGENT_CLIENT_SECRET'));
      assert.equal((await toReal(url)).status, 409);
      assert.equal((await run(url, 'UC1', { vertical: 'banking', mode: 'live' })).status, 503);
      assert.equal(fake.seen.length, 2, 'the worker client is never used once a AAG_* setting is there');
    }, { env: ENV, live, real: createReal({ config: realConfig(partial, {}), missing: missingFull(partial), wanted: true }) });
  } finally { await fake.close(); }
});

test('netguard per mode: Mock runs make zero attempts with full Real configured; Real reaches only the allowed hosts', async () => {
  const guard = installNetguard();
  try {
    await withFull(async (url) => {
      for (const id of ['UC1', 'UC2', 'UC6', 'UC13']) await run(url, id, { vertical: 'banking' });
      assert.deepEqual(guard.attempts, [], 'Mock: nothing left the machine');
      await toReal(url); await signIn(url); await run(url, 'UC1', { vertical: 'banking' });
      assert.deepEqual(guard.attempts, [], 'Real reached only the loopback fakes');
    });
    assert.deepEqual(guard.allowedHosts(), [], 'nothing is allowed unless index.js allows it');
  } finally { guard.restore(); }
  // The hosts index.js would allow: the auth host and the gateway host, and nothing else.
  const real = createReal({ config: realConfig({ ...fullSettingsFor('https://gw.lab-test.net/mcp'), PINGONE_REGION: 'eu' }, {}), wanted: true });
  assert.deepEqual(real.hosts(), ['auth.pingone.eu', 'gw.lab-test.net']);
});

test('config and URL guards: bad settings name the setting; PingOne calls only to the four fixed paths; gateway URL https only', () => {
  const good = fullSettingsFor('https://gw.lab-test.net/mcp');
  assert.equal(realConfig(good, {}).problem, undefined);
  for (const [k, v] of [['AAG_USER_CLIENT_ID', ''], ['AAG_AGENT_CLIENT_SECRET', 'a\nb'], ['AAG_AGENT_GATEWAY_URL', 'http://gw.lab-test.net/mcp'], ['AAG_AGENT_GATEWAY_URL', 'https://u:p@gw.lab-test.net/'], ['AAG_GATEWAY_SCOPE', 'a  b'], ['AAG_AGENT_SCOPE', 'a  b'], ['PINGONE_ENVIRONMENT_ID', 'x']]) {
    assert.match(realConfig({ ...good, [k]: v }, {}).problem, new RegExp(k), `${k}=${JSON.stringify(v)}`);
  }
  assert.equal(gatewayUrlProblem('http://127.0.0.1:5/mcp'), null, 'loopback http only for the fakes');
  const base = `https://auth.pingone.com/${ENV_ID}`;
  for (const ok of [`${base}/as/authorize?x=1`, `${base}/as/token`, `${base}/flows/abc-123`, `${base}/as/resume?flowId=a`]) assert.ok(assertAuthUrl(ok, base));
  for (const bad of [`https://evil.example/${ENV_ID}/as/token`, `${base}/as/userinfo`, `${base}/flows/../../x`, `${base}/as/token?x=1`, `http://auth.pingone.com/${ENV_ID}/as/token`, `${base}/../other/as/token`]) assert.throws(() => assertAuthUrl(bad, base), undefined, bad);
});

test('parsers: event-stream replies, audit trail JSON / base64 / text', () => {
  assert.deepEqual(parseRpc('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"a":1}}\n\n', 'text/event-stream', 2), { jsonrpc: '2.0', id: 2, result: { a: 1 } });
  assert.equal(parseRpc('data: {"id":1}\n\n', 'text/event-stream', 2), null);
  assert.equal(parseAuditTrail(AUDIT_TRAIL).decision, 'DENY');
  assert.equal(parseAuditTrail(Buffer.from('{"decision":"PERMIT"}').toString('base64url')).decision, 'PERMIT');
  assert.deepEqual(parseAuditTrail('plain words'), { raw: 'plain words', parsed: null, decision: null });
});

test('an event-stream gateway works end to end', async () => {
  await withFull(async (url) => {
    await toReal(url); await signIn(url);
    assert.equal((await run(url, 'UC1', { vertical: 'healthcare' })).body.run.outcome, 'REAL_PERMIT');
  }, { gateway: 'sse' });
});

test('review fixes: a password echoed by PingOne never comes back; state and nonce are required; the sign-in is refused under the guards', async () => {
  await withFull(async (url) => {
    await toReal(url);
    const s = await signIn(url);
    assert.equal(s.status, 401); assert.ok(!s.text.includes(DEMO_PASSWORD), 'an echoed password is not passed on');
    assert.ok(!s.text.includes('fake echo'), 'after the password step only PingOne error codes are kept');
  }, { signin: 'echo-pw' });
  for (const v of ['bad-state', 'no-state']) {
    await withFull(async (url) => {
      await toReal(url);
      const s = await signIn(url); assert.equal(s.status, 502, v); assert.match(s.body.message, /without the state the lab sent/);
    }, { signin: v });
  }
  for (const [env, headers] of [[{ ...ENV, AAG_ALLOW_LIVE: '0' }, {}], [ENV, { 'x-forwarded-for': '10.0.0.1' }]]) {
    await withFull(async (url, { p1 }) => {
      const r = await post(url, '/api/signin', { password: DEMO_PASSWORD }, headers);
      assert.equal(r.status, 409); assert.equal(p1.seen.length, 0, 'nothing was sent to PingOne');
    }, { env });
  }
});

test('review fixes: a gateway redirect is never followed; one account means no transfer; control characters never become a decision', async () => {
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC1', { vertical: 'banking' });
    assert.equal(r.body.run.outcome, 'REAL_REFUSED'); assert.equal(gw.state.elsewhere, 0);
  }, { gateway: 'redirect' });
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC6', { vertical: 'banking' });
    assert.equal(r.body.run.outcome, 'REAL_TOOL_ERROR'); assert.equal(r.body.run.hops.length, 9);
    assert.ok(!gw.seen.some((c) => c.rpc?.params?.name === 'create_transfer'), 'create_transfer is never called with one account');
  }, { gateway: 'one-account' });
  await withFull(async (url) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC1', { vertical: 'banking' });
    assert.equal(r.body.run.outcome, 'REAL_DENY'); assert.doesNotMatch(r.body.run.reply.text, /[\u0000-\u001f]/);
    assert.equal(r.body.run.hops.find((h) => h.kind === 'authorize-decision').decision.outcome, 'DENY', 'falls back to the HTTP answer');
  }, { gateway: 'audit-ctl' });
});

test('an error PingOne writes that echoes the agent secret is scrubbed before the hop or the reply keeps it (exchange 1 and exchange 2); an echoed token stays (not redacted)', async () => {
  for (const exchange of ['echo', 'echo-2']) {
    await withFull(async (url, { gw }) => {
      await toReal(url); await signIn(url);
      const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
      assert.equal(x.outcome, 'REAL_REFUSED', exchange); assert.equal(gw.seen.length, 0);
      noSecretsInRun(x, exchange);
    }, { exchange });
  }
  assert.deepEqual(scrubError({ error: 'e', access_token: 'eyJabcdef.eyJxyz.sig', details: [{ message: 'x eyJabcdef.eyJxyz', code: 'C' }, 5] }, ['s3cr3t-value']).access_token, 'eyJabcdef.eyJxyz.sig', 'a success answer\'s access_token is not touched');
  assert.equal(scrubError({ message: 'is s3cr3t-value ok' }, ['s3cr3t-value']).message, 'is [secret] ok');
  assert.equal(scrubError({ message: 'x eyJabcdef.eyJxyz' }, ['s3cr3t-value']).message, 'x eyJabcdef.eyJxyz', 'a token echoed in an error is not redacted');
});

// ---- Real A2A (owner, 2026-11-16): the chained exchange of AI-DEMO2's a2aDelegationService, against the fakes -------------------------------------------------
const ranBank = async (url, id = 'UC2', extra = {}) => { const r = await run(url, id, { vertical: 'banking', ...extra }, { traceparent: TP }); return { status: r.status, x: r.body.run, body: r.body }; };

test('A2A Real: UC2 runs the chained exchange (agent 1, then the specialist as actor, a nested act) and the gateway call; the exact parameters are pinned', async () => {
  await withFull(async (url, { p1, gw }) => {
    await toReal(url); assert.equal((await signIn(url)).status, 200);
    const { status, x } = await ranBank(url);
    assert.equal(status, 200); assert.equal(x.kind, 'real'); assert.equal(x.outcome, 'REAL_PERMIT', JSON.stringify(x.reply));
    assert.equal(x.real.a2a, true); assert.equal(x.real.tool, 'get_portfolio_summary');
    assert.deepEqual(x.hops.map((h) => h.kind), ['sign-in', 'actor-token', 'a2a-exchange-1', 'actor-token', 'a2a-exchange-2', 'gateway-check', 'authorize-decision', 'tool-dispatched', 'api-call', 'agent-reply']);
    assert.deepEqual(x.hops.filter((h) => /^A2A/.test(h.title)).map((h) => h.title), ['A2A exchange 1: act = agent 1', 'A2A actor token: the specialist', 'A2A exchange 2: nested act']);
    assert.ok(x.hops.every((h) => h.source === 'real'), 'every hop is REAL');
    // what the lab sent, in order (the sign-in code exchange first)
    const calls = tokenCalls(p1).slice(1);
    assert.equal(calls.length, 4);
    const [agentCc, ex1, specCc, ex2] = calls;
    assert.deepEqual([agentCc.form.grant_type, agentCc.form.scope], ['client_credentials', 'agent:invoke']);
    assert.equal(agentCc.auth, BASIC_AGENT);
    assert.equal(ex1.form.grant_type, TX); assert.equal(ex1.form.audience, A2A_INTERMEDIATE_AUD); assert.equal(ex1.form.scope, A2A_INTERMEDIATE_SCOPE); assert.ok(ex1.form.actor_token, 'exchange 1 has the agent as actor');
    assert.equal(ex1.auth, BASIC_AGENT, 'exchange 1 is made by the agent client');
    assert.deepEqual([specCc.form.grant_type, specCc.form.scope], ['client_credentials', A2A_INTERMEDIATE_SCOPE]);
    assert.equal(specCc.form.client_id, SPECIALIST_ID, 'the specialist is CLIENT_SECRET_POST: id and secret in the body, no Authorization header'); assert.equal(specCc.auth, undefined);
    assert.equal(ex2.form.grant_type, TX); assert.equal(ex2.form.audience, A2A_GATEWAY_AUD); assert.equal(ex2.form.scope, A2A_SCOPE);
    assert.equal(ex2.form.client_id, SPECIALIST_ID, 'exchange 2 is made by the specialist');
    assert.notEqual(ex2.form.actor_token, ex1.form.actor_token, 'exchange 2 has the specialist, not the first agent, as actor');
    // the chain, read from the delegated token the gateway was given
    const delegated = x.tokens.find((t) => /A2A exchange 2: nested act/.test(t.label));
    const c = claimsOf(delegated.raw);
    assert.equal(c.act.sub, SPECIALIST_ID); assert.equal(c.act.act.sub, AGENT_CLIENT_ID); assert.equal(c.aud, A2A_GATEWAY_AUD);
    assert.match(delegated.notice, /UNVERIFIED/);
    const toolCall = gw.seen.find((r) => r.rpc?.method === 'tools/call');
    assert.equal(toolCall.rpc.params.name, 'get_portfolio_summary');
    assert.match(String(toolCall.headers.authorization), /^Bearer /);
    assert.deepEqual(Object.keys(toolCall.headers).filter((h) => TRUSTED_HEADERS.map((t) => t.toLowerCase()).includes(h)), [], 'no trusted-caller header');
    for (const sec of [SPECIALIST_SECRET, ...SECRETS]) assert.ok(!JSON.stringify({ hops: x.hops, reply: x.reply }).includes(sec), 'no secret in the hops or the reply');
  }, { settings: a2aSettings() });
});

test('A2A Real: without the AAG_A2A_* settings UC2 runs the labelled mock engine in Real mode and names them; some of them set names the missing ones; never a value', async () => {
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const { status, x } = await ranBank(url);
    assert.equal(status, 200); assert.equal(x.realGate.real, false); assert.match(x.realGate.reason, /AAG_A2A_\*/);
    assert.ok(x.hops.every((h) => h.source !== 'real')); assert.equal(gw.seen.length, 0, 'the gateway was never called');
  });
  const partial = { AAG_A2A_AGENT_CLIENT_ID: SPECIALIST_ID, AAG_A2A_AGENT_CLIENT_SECRET: SPECIALIST_SECRET };
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const { x } = await ranBank(url);
    assert.equal(x.realGate.real, false); assert.match(x.realGate.reason, /sets some AAG_A2A_\* names but not AAG_A2A_INTERMEDIATE_AUDIENCE, AAG_A2A_INTERMEDIATE_SCOPE, AAG_A2A_GATEWAY_AUDIENCE, AAG_A2A_SCOPE/);
    assert.ok(!JSON.stringify(x).includes(SPECIALIST_SECRET)); assert.equal(gw.seen.length, 0);
  }, { settings: partial });
  assert.match(realConfig(fullSettingsFor('http://127.0.0.1:1/mcp', { ...a2aSettings(), AAG_A2A_INTERMEDIATE_SCOPE: 'two scopes' }), { AAG_LIVE_TEST_BASE: `http://127.0.0.1:1/${ENV_ID}` }).a2aProblem, /AAG_A2A_INTERMEDIATE_SCOPE/);
  assert.equal(realConfig(fullSettingsFor('http://127.0.0.1:1/mcp', a2aSettings({ AAG_A2A_AGENT_CLIENT_ID: 'replace-me' })), { AAG_LIVE_TEST_BASE: `http://127.0.0.1:1/${ENV_ID}` }).a2a, null, 'a placeholder counts as unset');
});

test('A2A Real: every failure stops before the gateway and says which step: the specialist token, exchange 1, exchange 2 refused, a flat act, no act', async () => {
  const cases = [
    ['specialist', { specialist: 'bad-secret' }, 'REAL_REFUSED', /specialist agent's token/],
    ['exchange1', { exchange1: 'refuse' }, 'REAL_REFUSED', /token exchange 1/],
    ['exchange2', { exchange2: 'refuse' }, 'REAL_REFUSED', /A2A exchange 2/],
    ['flat', { exchange2: 'flat' }, 'REAL_NO_ACT', /nested act chain/],
    ['none', { exchange2: 'none' }, 'REAL_NO_ACT', /nested act chain/],
  ];
  for (const [name, a2a, outcome, text] of cases) {
    await withFull(async (url, { gw }) => {
      await toReal(url); await signIn(url);
      const { status, x } = await ranBank(url);
      assert.equal(status, 200, name); assert.equal(x.outcome, outcome, name); assert.match(x.reply.text, text, name);
      assert.equal(gw.seen.length, 0, `${name}: nothing was sent to the gateway`);
      assert.ok(x.hops.some((h) => h.source === 'not-run'), `${name}: the steps that did not run say so`);
      for (const sec of [SPECIALIST_SECRET, ...SECRETS]) assert.ok(!JSON.stringify({ hops: x.hops, reply: x.reply }).includes(sec), `${name}: no secret`);
    }, { settings: a2aSettings(), setup: (p1) => Object.assign(p1.state.a2a, a2a) });
  }
});

test('A2A Real: only the plain two-agent hand-off (UC2, UC2.5) in the vertical the settings name; the agent card, protocol, mismatch probe and signed assertion stay mock', () => {
  const cast = loadCast(null, 'banking');
  for (const id of ['UC2', 'UC2.5']) {
    assert.deepEqual(realGate(findUseCase(id), cast, { a2a: true }), { real: true, tool: 'get_portfolio_summary', a2a: true }, id);
    assert.equal(realGate(findUseCase(id), cast, { a2a: false }).real, false, `${id}: off without the settings`);
    assert.match(realGate(findUseCase(id), cast, { a2a: false, a2aWhy: 'because' }).reason, /^because$/);
  }
  for (const id of ['UC2.6', 'UC2.7', 'UC37']) {
    const g = realGate(findUseCase(id), cast, { a2a: true });
    assert.equal(g.real, false, id); assert.match(g.reason, /A2A.*staged by the lab only/, id);
  }
});

test('A2A Real: in a vertical other than the one the settings name, UC2 stays mock and says so', async () => {
  await withFull(async (url, { gw }) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC2', { vertical: 'healthcare' }, { traceparent: TP });
    assert.equal(r.status, 200); assert.equal(r.body.run.realGate.real, false); assert.match(r.body.run.realGate.reason, /banking/);
    assert.equal(gw.seen.length, 0);
  }, { settings: a2aSettings() });
});

// ---- "no response" is not a malformed request (owner 2026-11-16): the gateway's no-decision answers are told apart and shown whole ---------------------------
test('a gateway 5xx on tools/call is NO DECISION (not DENIED): the hop says it answered HTTP 502 with its own text, the raw answer is shown, and nothing claims SE is down', async () => {
  await withFull(async (url) => {
    await toReal(url); await signIn(url);
    const r = await run(url, 'UC1', { vertical: 'banking' });
    assert.equal(r.status, 200); const x = r.body.run;
    assert.equal(x.outcome, 'REAL_UNREACHABLE');
    assert.match(x.reply.text, /^No decision: the Agent Gateway answered HTTP 502 and did not complete the call.*unable to get a decision from Authorize/);
    assert.doesNotMatch(x.reply.text, /SE is down/);
    const az = x.hops.find((h) => h.kind === 'authorize-decision');
    assert.match(az.label, /NO DECISION/); assert.equal(az.verdict, 'error'); assert.equal(az.fact, 'no decision');
    assert.match(JSON.stringify(az.response), /decision request was malformed/, 'the gateway\'s own text is on the hop');
    const tool = x.hops.find((h) => h.kind === 'tool-refused');
    assert.equal(tool.verdict, 'error'); assert.match(JSON.stringify(tool.response.calls.at(-1).body), /decision request was malformed/);
    assert.ok(!x.hops.some((h) => h.verdict === 'deny'), 'nothing is marked denied: there was no decision');
  }, { gateway: 'authz-502' });
});

test('no HTTP response at all is a timeout or a failed connection, said as such: tools/call waits 30 s, and the hop never says denied', async () => {
  const p1 = await startFakePingOne({}); const gw = await startFakeGateway({ isDelegated: (t) => p1.issued.delegated.has(t) });
  const seen = [];
  const gatewayFetch = (u, init) => { const m = JSON.parse(init.body).method; seen.push(m); return m === 'tools/call' ? Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })) : fetch(u, init); };
  const real = createReal({ config: realConfig(fullSettingsFor(gw.url, {}), { AAG_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true, gatewayFetch });
  try {
    await withServer(async (url) => {
      await toReal(url); await signIn(url);
      const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
      assert.equal(x.outcome, 'REAL_UNREACHABLE');
      assert.match(x.reply.text, /sent no HTTP response within 30 s, so the lab stopped waiting.*A timeout is not an error answer/);
      const az = x.hops.find((h) => h.kind === 'authorize-decision');
      assert.equal(az.verdict, 'error'); assert.match(az.response.no_response, /no HTTP response within 30 s/); assert.equal(az.response.status, 0);
      assert.ok(!x.hops.some((h) => h.verdict === 'deny'));
    }, { env: ENV, real });
  } finally { await p1.close(); await gw.close(); }
  assert.ok(seen.includes('initialize') && seen.includes('tools/list') && seen.includes('tools/call'));
});

// ---- the PingOne session (owner, 2026-11-16): once signed in, no password again ------------------------------------------------------------------------------
const WA = W('w-aaaaaaaaaaaaaaaa'); const WB = W('w-bbbbbbbbbbbbbbbb');
const passwordPosts = (p1) => p1.seen.filter((c) => c.method === 'POST' && /\/flows\//.test(c.url)).length;
const authorizes = (p1) => p1.seen.filter((c) => c.url.includes('/as/authorize'));
async function withClock(fn) {
  const p1 = await startFakePingOne({}); const gw = await startFakeGateway({ isDelegated: (t) => p1.issued.delegated.has(t) });
  let t = Date.now();
  const real = createReal({ config: realConfig(fullSettingsFor(gw.url, {}), { AAG_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true, now: () => t });
  try { await withServer((url) => fn(url, { p1, gw, real, advance: (ms) => { t += ms; } }), { env: ENV, real }); } finally { await p1.close(); await gw.close(); }
}

test('P1 session: after one password sign-in, another workspace (a new tab) is signed in with no password, runs Real, and says so in the sign-in hop; no cookie or password leaks', async () => {
  await withFull(async (url, { p1 }) => {
    await toReal(url, WA); await toReal(url, WB);
    assert.equal((await signIn(url, DEMO_PASSWORD, WA)).status, 200); assert.equal(passwordPosts(p1), 1);
    const sres = await get(url, '/api/signin', WB); const stext = await sres.clone().text(); const s = await sres.json();
    assert.equal(s.signedIn, true); assert.equal(s.user.name, DEMO_USERNAME);
    assert.equal(passwordPosts(p1), 1, 'the password was not sent again');
    assert.match(String(authorizes(p1).at(-1).headers.cookie), /P1SSO=/, 'the PingOne session cookie went to authorize');
    const { status, body } = await run(url, 'UC1', { vertical: 'banking' }, WB);
    assert.equal(status, 200); assert.equal(body.run.outcome, 'REAL_PERMIT');
    assert.match(body.run.hops[0].label, /your PingOne session/); assert.match(body.run.hops[0].note, /No password was typed or sent/);
    assert.match(body.run.hops[0].request.steps[0].step, /with your PingOne session: no password/);
    const text = stext + JSON.stringify(body.run.hops[0]);
    assert.ok(!/P1SSO=[0-9a-f]{6}/.test(stext), 'the session cookie is not returned by /api/signin'); noSecret(text, 'the silent sign-in');
  });
});

test('P1 session: an expired token signs in again silently (no password), and a Reset keeps the PingOne session', async () => {
  await withClock(async (url, { p1, advance }) => {
    await toReal(url, WA);
    assert.equal((await signIn(url, DEMO_PASSWORD, WA)).status, 200);
    advance(2 * 3600 * 1000); // the token (and the workspace session) have expired
    const s = await (await get(url, '/api/signin', WA)).json();
    assert.equal(s.signedIn, true, 'signed in again from the PingOne session'); assert.equal(passwordPosts(p1), 1);
    assert.equal((await run(url, 'UC1', { vertical: 'banking' }, WA)).body.run.outcome, 'REAL_PERMIT');
    assert.equal((await post(url, '/api/reset', {}, WA)).status, 200);
    assert.equal((await (await get(url, '/api/signin', WA)).json()).signedIn, true, 'Reset ended the token session, not the PingOne session'); assert.equal(passwordPosts(p1), 1);
  });
});

test('P1 session: when PingOne ended its session the password is asked for the usual way; one failed silent try is not repeated for 5 seconds', async () => {
  await withClock(async (url, { p1, advance }) => {
    await toReal(url, WA); await toReal(url, WB);
    assert.equal((await signIn(url, DEMO_PASSWORD, WA)).status, 200);
    p1.state.sso.mode = 'expired';
    const before = authorizes(p1).length;
    assert.equal((await (await get(url, '/api/signin', WB)).json()).signedIn, false);
    assert.equal(authorizes(p1).length, before + 1, 'one silent try');
    const r = await run(url, 'UC1', { vertical: 'banking' }, WB);
    assert.equal(r.status, 401); assert.equal(r.body.error, 'sign_in_required');
    assert.equal(authorizes(p1).length, before + 1, 'no second try inside 5 seconds');
    advance(6000);
    assert.equal((await (await get(url, '/api/signin', WB)).json()).signedIn, false); assert.equal(passwordPosts(p1), 1);
    // PingOne forgot the session, so the lab forgot it too: the next try goes straight to the password
    const n = authorizes(p1).length; advance(6000);
    assert.equal((await (await get(url, '/api/signin', WB)).json()).signedIn, false); assert.equal(authorizes(p1).length, n, 'the lab no longer tries a session PingOne ended');
    assert.equal((await signIn(url, DEMO_PASSWORD, WB)).status, 200, 'the password still signs in');
  });
});

test('P1 session: an explicit Sign out forgets the PingOne session; the next workspace is not signed in and PingOne is not asked', async () => {
  await withFull(async (url, { p1 }) => {
    await toReal(url, WA); await toReal(url, WB);
    assert.equal((await signIn(url, DEMO_PASSWORD, WA)).status, 200);
    assert.equal((await post(url, '/api/signout', {}, WA)).status, 200);
    const n = authorizes(p1).length;
    assert.equal((await (await get(url, '/api/signin', WB)).json()).signedIn, false);
    assert.equal(authorizes(p1).length, n, 'no silent try after Sign out');
    assert.equal((await run(url, 'UC1', { vertical: 'banking' }, WB)).status, 401);
  });
});

