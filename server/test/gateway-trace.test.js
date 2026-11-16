// "What Privilege did" (rule 25) for this lab: the trace of every gateway call, Mock and Real, against the shared contract (assertTrace) and the
// honesty rule. Mock: the engine's own gateway computed the checks, so they are `checked`. Real: the lab's MCP client called a fake gateway on a
// loopback port (the same fakes real.test.js uses), and a real gateway reports no per-check detail, so only `inferred` and `observed` are allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runUseCase } from '../src/flow.js';
import { MANIFEST } from '../src/manifest.js';
import { VERTICALS } from '../src/cast.js';
import { createReal, realConfig } from '../src/real.js';
import { assertTrace } from '../src/gatewayTrace.js';
import { mockExchange, mockGatewayUrl, realExchange } from '../src/gatewayExchanges.js';
import { post, run, withServer } from './helpers.js';
import { AGENT_CLIENT_SECRET, CLIENT_SECRET, DEMO_PASSWORD, USER_CLIENT_SECRET, fullSettingsFor, startFakePingOne } from './fakePingone.js';
import { SESSION_ID, startFakeGateway } from './fakeGateway.js';

const go = (uc, extra = {}) => runUseCase(uc, { cast: VERTICALS.banking, vertical: 'banking', seed: 'run', ...extra });

// ---- Mock -----------------------------------------------------------------------------------------------------------------------------
test('mock: every use case yields traces that pass assertTrace, with a non-real host and no full token', () => {
  let traced = 0;
  for (const uc of MANIFEST.usecases) {
    const r = go(uc);
    assert.ok(Array.isArray(r.gatewayTrace), `${uc.id}: gatewayTrace is always an array`);
    for (const ex of r.gatewayTrace) {
      traced += 1;
      assert.deepEqual(assertTrace(ex.trace), [], `${uc.id} step ${ex.step}`);
      assert.equal(ex.trace.source, 'mock');
      assert.match(ex.trace.request.url, /^https:\/\/[a-z0-9.-]+\.invalid\//, 'a simulated gateway never has a real host');
      const text = JSON.stringify(ex.trace);
      for (const t of r.tokens) assert.ok(!text.includes(t.raw), `${uc.id}: a full mock token is in the trace`);
      assert.ok(r.hops.some((h) => h.n === ex.step), 'the step is a hop of the run, so the Sequence and the panel agree');
    }
  }
  assert.ok(traced > 100, `the engine's gateway hops are traced (${traced})`);
  assert.equal(mockGatewayUrl('https://gateway.x.example/mcp'), 'https://gateway.x.invalid/mcp');
});

test('mock: the gateway-check decisions ARE the checks the engine ran: same order, same verdicts, nothing after the first refusal, all `checked`', () => {
  const statuses = new Set();
  let refused = 0; let passedAll = 0;
  for (const uc of MANIFEST.usecases) {
    const r = go(uc);
    for (const ex of r.gatewayTrace.filter((e) => /^Gateway check/.test(e.title))) {
      const hop = r.hops.find((h) => h.n === ex.step);
      const checks = hop.response.body.checks;
      assert.ok(checks.length > 0, `${uc.id}: the engine ran checks`);
      assert.deepEqual(ex.trace.decisions.map((d) => d.outcome), checks.map((c) => (c.ok ? 'pass' : 'fail')), `${uc.id}: decisions match what the engine computed`);
      assert.ok(ex.trace.decisions.every((d) => d.basis === 'checked'), 'computed by the lab\'s own gateway: checked');
      assert.equal(ex.status, hop.response.status);
      statuses.add(ex.status);
      const fails = ex.trace.decisions.filter((d) => d.outcome === 'fail');
      if (fails.length) { refused += 1; assert.equal(fails.length, 1); assert.equal(ex.trace.decisions.at(-1).outcome, 'fail', 'the chain stops at the refusal: no later check is listed'); } else passedAll += 1;
    }
  }
  assert.ok(refused > 3 && passedAll > 3, `both kinds of run exist (${refused} refused, ${passedAll} passed)`);
  for (const s of [200, 401, 403]) assert.ok(statuses.has(s), `HTTP ${s} is traced`);
});

test('mock: the no-token challenge, tools/list and the Privilege leg compute nothing, so they are never `checked`; the challenge shows no Authorization header', () => {
  const seen = new Set();
  for (const uc of MANIFEST.usecases) {
    for (const ex of go(uc).gatewayTrace.filter((e) => !/^Gateway check/.test(e.title))) {
      seen.add(ex.title.split(' ').slice(0, 2).join(' '));
      assert.ok(ex.trace.decisions.every((d) => d.basis === 'observed'), `${uc.id} ${ex.title}`);
      assert.ok(!ex.trace.decisions.some((d) => d.outcome === 'pass'), 'nothing was verified, so nothing passes');
      if (/challenge/.test(ex.title)) { assert.equal(ex.status, 401); assert.match(ex.trace.request.headers.authorization, /^\(none/); assert.ok(ex.trace.response.headers['www-authenticate']); }
    }
  }
  assert.ok(seen.has('Gateway challenge:') && seen.has('Gateway: tools/list'), [...seen].join(' | '));
});

test('mock: a run that never reaches a gateway has no traces, and the API carries them on the run reply', async () => {
  const guided = MANIFEST.usecases.find((u) => go(u).kind === 'guided');
  assert.deepEqual(go(guided).gatewayTrace, []);
  await withServer(async (url) => {
    const r = await run(url, 'UC1', { vertical: 'banking' });
    assert.equal(r.status, 200);
    assert.ok(r.body.run.gatewayTrace.length >= 2);
    for (const ex of r.body.run.gatewayTrace) assert.deepEqual(assertTrace(ex.trace), []);
    assert.ok(r.body.run.hops.length > 0 && r.body.run.tokens.length > 0, 'the existing fields are still there');
  });
});

// ---- Real, against the fakes -----------------------------------------------------------------------------------------------------------
async function withFull(fn, { gateway = 'ok', gatewayFetch, setup } = {}) {
  const p1 = await startFakePingOne();
  p1.state.full = { signin: 'ok', exchange: 'ok' };
  if (setup) setup(p1);
  const gw = await startFakeGateway({ behaviour: gateway, isDelegated: (t) => p1.issued.delegated.has(t) });
  const real = createReal({ config: realConfig(fullSettingsFor(gw.url), { AAG_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true, ...(gatewayFetch ? { gatewayFetch } : {}) });
  try { await withServer((url) => fn(url, { gw, real }), { env: { ALLOW_MOCK_SIGNIN: '1' }, real }); } finally { await p1.close(); await gw.close(); }
}
async function realRun(url, id = 'UC1') {
  assert.equal((await post(url, '/api/mode', { source: 'real' })).status, 200);
  const s = await post(url, '/api/signin', { password: DEMO_PASSWORD }); assert.equal(s.status, 200);
  const r = await run(url, id, { vertical: 'banking' }); assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.run;
}
const NEVER_SHOWN = [DEMO_PASSWORD, CLIENT_SECRET, USER_CLIENT_SECRET, AGENT_CLIENT_SECRET, SESSION_ID];
function checkReal(x, { titles } = {}) {
  assert.equal(x.kind, 'real');
  assert.ok(x.gatewayTrace.length > 0);
  if (titles) assert.deepEqual(x.gatewayTrace.map((e) => e.title), titles);
  const delegated = x.tokens.find((t) => /^delegated token/.test(t.label)).raw;
  for (const ex of x.gatewayTrace) {
    assert.deepEqual(assertTrace(ex.trace), [], ex.title);
    assert.equal(ex.trace.source, 'real');
    const text = JSON.stringify(ex.trace);
    for (const t of x.tokens) assert.ok(!text.includes(t.raw), `${ex.title}: a real token is in the trace`);
    assert.ok(!text.includes(delegated));
    for (const s of NEVER_SHOWN) assert.ok(!text.includes(s), `${ex.title}: a secret or the full session id is in the trace`);
    assert.match(ex.trace.request.headers.authorization, /^Bearer <token, \d+ characters, kept on the server>$/);
    assert.ok(ex.trace.decisions.every((d) => d.basis === 'inferred' || d.basis === 'observed'), 'a real gateway reports no per-check detail: never `checked`');
    assert.ok(ex.trace.request.headers.traceparent && ex.trace.request.headers['x-active-vertical'] === 'banking', 'the headers the lab really sent');
  }
}
const decisionOf = (ex, id) => ex.trace.decisions.find((d) => d.id === id);

test('real, 200: tools/list, get_my_accounts and the tool call each have a trace; decisions inferred/observed only; no token, key or full session id', async () => {
  await withFull(async (url, { gw }) => {
    const x = await realRun(url);
    assert.equal(x.outcome, 'REAL_PERMIT');
    checkReal(x, { titles: ['tools/list', 'tools/call get_my_accounts', 'tools/call get_account_balance'] });
    const [list, accounts, call] = x.gatewayTrace;
    assert.deepEqual(list.step, 1); assert.deepEqual(call.step, 3);
    assert.deepEqual(list.trace.setup, [{ label: 'initialize', status: 200 }, { label: 'notifications/initialized', status: 202 }]);
    assert.equal(decisionOf(list, 'authenticated').basis, 'inferred');
    assert.equal(decisionOf(list, 'grant').outcome, 'pass');
    assert.match(decisionOf(list, 'grant').evidence, /get_account_balance/);
    assert.equal(list.trace.request.body.method, 'tools/list');
    assert.deepEqual(accounts.trace.request.body.params, { name: 'get_my_accounts', arguments: {} });
    assert.equal(call.trace.request.body.params.name, 'get_account_balance');
    assert.equal(call.trace.request.body.params.arguments.account_id, 'acct-fake-1', 'the request is shown as it was sent');
    assert.match(call.trace.request.headers['mcp-session-id'], /^fake-mcp… \(shortened\)$/);
    assert.equal(call.trace.response.status, 200);
    assert.match(call.trace.response.body.result.content[0].text, /1200\.5/, 'the exact answer');
    // what the fake actually received matches what the trace says was sent
    const sent = gw.seen.filter((s) => s.rpc?.method === 'tools/call').at(-1);
    assert.deepEqual(call.trace.request.body, sent.rpc);
  });
});

test('real, 403 DENY: the grant is inferred as refused, the Authorize decision is observed from X-Gw-Audit-Trail', async () => {
  await withFull(async (url) => {
    const x = await realRun(url);
    assert.equal(x.outcome, 'REAL_DENY');
    checkReal(x);
    const last = x.gatewayTrace.at(-1);
    assert.equal(last.status, 403);
    assert.deepEqual([decisionOf(last, 'authenticated').outcome, decisionOf(last, 'authenticated').basis], ['pass', 'inferred']);
    assert.deepEqual([decisionOf(last, 'grant').outcome, decisionOf(last, 'grant').basis], ['fail', 'inferred']);
    const audit = decisionOf(last, 'audit');
    assert.deepEqual([audit.outcome, audit.basis], ['fail', 'observed']);
    assert.match(audit.evidence, /DENY/);
  }, { gateway: 'deny' });
});

test('real, 401 at the handshake: one trace for initialize, authentication refused (inferred), the grant not reached', async () => {
  await withFull(async (url) => {
    const x = await realRun(url);
    assert.equal(x.outcome, 'REAL_TOKEN_PROBLEM');
    checkReal(x, { titles: ['initialize'] });
    const ex = x.gatewayTrace[0];
    assert.deepEqual([decisionOf(ex, 'authenticated').outcome, decisionOf(ex, 'authenticated').basis], ['fail', 'inferred']);
    assert.equal(decisionOf(ex, 'grant').outcome, 'skipped');
    assert.ok(ex.trace.response.headers['www-authenticate']);
  }, { gateway: 'token' });
});

test('real, 428 hold: an info decision, never counted as passed and never a pass', async () => {
  await withFull(async (url) => {
    const x = await realRun(url);
    assert.equal(x.outcome, 'REAL_HOLD');
    checkReal(x);
    const last = x.gatewayTrace.at(-1);
    assert.equal(last.status, 428);
    assert.deepEqual(last.trace.decisions.map((d) => [d.outcome, d.basis]), [['info', 'observed']]);
    assert.ok(!last.trace.decisions.some((d) => d.outcome === 'pass'));
  }, { gateway: 'hold' });
});

test('real, 503 and a tool error: observed, not guessed', async () => {
  await withFull(async (url) => {
    const x = await realRun(url);
    checkReal(x, { titles: ['initialize'] });
    assert.deepEqual(x.gatewayTrace[0].trace.decisions.map((d) => [d.outcome, d.basis]), [['info', 'observed']]);
  }, { gateway: 'down' });
  await withFull(async (url) => {
    const x = await realRun(url);
    assert.equal(x.outcome, 'REAL_TOOL_ERROR');
    checkReal(x);
    const result = decisionOf(x.gatewayTrace.at(-1), 'result');
    assert.deepEqual([result.outcome, result.basis], ['fail', 'observed']);
    assert.match(result.evidence, /account was not found/);
  }, { gateway: 'tool-error' });
});

test('real, event-stream answer: the JSON-RPC reply inside it is the response body', async () => {
  await withFull(async (url) => {
    const x = await realRun(url);
    assert.equal(x.outcome, 'REAL_PERMIT');
    checkReal(x);
    assert.equal(x.gatewayTrace.at(-1).trace.response.body.jsonrpc, '2.0');
  }, { gateway: 'sse' });
});

test('real, no answer at all: a failure trace (no response, one observed failure), not an invented decision', async () => {
  await withFull(async (url) => {
    const x = await realRun(url);
    assert.equal(x.outcome, 'REAL_UNREACHABLE');
    checkReal(x, { titles: ['initialize'] });
    const ex = x.gatewayTrace[0];
    assert.equal(ex.trace.response, null); assert.equal(ex.status, null);
    assert.deepEqual(ex.trace.decisions.map((d) => [d.id, d.outcome, d.basis]), [['reach', 'fail', 'observed']]);
  }, { gatewayFetch: async () => { throw new Error('connect refused'); } });
});

test('real: a run that stops before the gateway (no act claim) has no traces: nothing to show, nothing invented; Reset-clean runs keep the old fields', async () => {
  await withFull(async (url, { gw }) => {
    assert.equal((await post(url, '/api/mode', { source: 'real' })).status, 200);
    assert.equal((await post(url, '/api/signin', { password: DEMO_PASSWORD })).status, 200);
    const x = (await run(url, 'UC1', { vertical: 'banking' })).body.run;
    assert.equal(x.outcome, 'REAL_NO_ACT'); assert.equal(gw.seen.length, 0);
    assert.deepEqual(x.gatewayTrace, []);
    assert.ok(x.hops.length > 0 && x.tokens.length > 0);
  }, { setup: (p1) => { p1.state.resources.agent.act = 'empty'; } });
});

// ---- The redaction, on a synthetic answer ----------------------------------------------------------------------------------------------
test('realExchange: the delegated token, the session id, the approval receipt and a hold challenge id never appear; the hold and the receipt are explained', () => {
  const token = ['eyJ', 'hbGciOiJub25lIn0'].join('') + '.' + ['payload', 'segment', 'abc'].join('-') + '.' + ['sig', 'nature', 'xyz', '123'].join('-');
  const receipt = ['rcpt', 'abcdef', '123456'].join('-');
  const challenge = ['chal', 'lenge', '987654'].join('-');
  const sessionId = ['session', 'id', 'abcdef', '0123456789'].join('-');
  const c = {
    method: 'tools/call', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', status: 428, kind: 'hold', headers: { 'content-type': 'application/json', 'mcp-session-id': sessionId },
    rpc: { error: { code: -32000, message: `held; echo ${token}`, challengeId: challenge } }, truncated: false, rawText: null, at: '2026-01-01T00:00:00.000Z', sessionId, protocol: '2025-06-18',
    sentBody: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_transfer', arguments: { amount: 5, _hitl_challenge_id: receipt } } },
  };
  const ex = realExchange(c, { step: 3, title: 'tools/call create_transfer', url: 'http://127.0.0.1:1/mcp', token, vertical: 'banking', receipt });
  assert.deepEqual(assertTrace(ex.trace), []);
  const text = JSON.stringify(ex.trace);
  for (const s of [token, receipt, challenge, sessionId]) assert.ok(!text.includes(s));
  assert.equal(ex.trace.request.body.params.arguments._hitl_challenge_id, '<approval receipt, kept on the server>');
  assert.deepEqual(ex.trace.decisions.map((d) => [d.outcome, d.basis]), [['info', 'observed']]);
  assert.match(ex.trace.decisions[0].evidence, /held the call for a person/);
});

// ---- The request headers the lab really sent, through the shared builder's requestHeaders option ---------------------------------------
test('requestHeaders: a simulated hop shows the headers it sent (an accept of its own replaces the default, whatever its case); the real hop shows traceparent and session', () => {
  const hop = { n: 5, request: { url: 'https://gw.mock.example/mcp', headers: { authorization: 'Bearer abc', 'content-type': 'application/json', Accept: 'application/json', 'x-edge': 'edge-1', 'x-empty': undefined }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }, response: { status: 200, body: { jsonrpc: '2.0', id: 1, result: { tools: [] } } } };
  const mock = mockExchange(hop, { title: 'Gateway check: tools/list', decisions: [{ id: 'edge', label: 'Edge', outcome: 'pass', evidence: 'the simulation ran it' }] }).trace;
  assert.deepEqual(assertTrace(mock), []);
  assert.equal(mock.request.headers.Accept, 'application/json');
  assert.ok(!('accept' in mock.request.headers), 'the default accept is replaced, not repeated');
  assert.equal(mock.request.headers['x-edge'], 'edge-1');
  assert.ok(!('x-empty' in mock.request.headers));
  const c = { method: 'tools/list', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', status: 200, kind: 'ok', headers: { 'content-type': 'application/json' }, rpc: { jsonrpc: '2.0', id: 1, result: { tools: [] } }, truncated: false, rawText: null, at: '2026-01-01T00:00:00.000Z', sessionId: 'abcdef0123456789', protocol: '2025-06-18', sentBody: { jsonrpc: '2.0', id: 1, method: 'tools/list' } };
  const real = realExchange(c, { step: 1, title: 'tools/list', url: 'http://127.0.0.1:1/mcp', token: 'typed-value', vertical: 'banking' }).trace;
  assert.deepEqual(assertTrace(real), []);
  assert.equal(real.request.headers.traceparent, c.traceparent);
  assert.equal(real.request.headers['mcp-session-id'], 'abcdef01… (shortened)');
  assert.equal(real.request.headers.accept, 'application/json, text/event-stream');
});
