// The provider choice (design-real-local.md C.1): `auto` = SE when its settings are present and a cheap health probe passes, else the lab's own; AAG_PROVIDER
// forces one; the choice is made ONCE per run and never switches. These are MAPPING tests of the lab's own rules, not Ping's behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PROVIDER_SETTINGS, providerSettingOf, createProviders, LOCAL_TOOLS, TOOL_SCOPES, PUBLIC_TOOLS, GROUP_GATED_TOOLS, CALL_UNLISTED, toolScopeOf } from '../src/provider.js';
import { createReal, realConfig } from '../src/real.js';
import { fullSettingsFor, startFakePingOne } from './fakePingone.js';
import { startFakeToolServer, stubLocal } from './fakeToolServer.js';
import { startFakeGateway } from './fakeGateway.js';
import { withServer, run, post, get } from './helpers.js';

const GW = { url: 'https://gw.se.example/mcp', audience: 'gw-aud', scope: 'gw:scope' };
const SE_URL = 'https://tools.se.example/mcp';
const mkReal = ({ gateway = GW, toolsSe = SE_URL, configured = true } = {}) => ({ configured: () => configured, gateway: () => gateway, toolsSeUrl: () => toolsSe, toolsAudience: () => 'appfire-work-tools' });
const mkLocal = (state = 'ready') => ({ state: () => state, mcpUrl: () => (state === 'ready' ? 'http://127.0.0.1:41234/mcp' : null), toolNames: () => [...LOCAL_TOOLS] });
const okFetch = (log, status = 200) => async (url, init) => { log.push({ url: String(url), init }); return new Response('{"ok":true}', { status }); };

test('providerSettingOf: empty is auto, any case of auto|se|local is itself, anything else is a problem (null)', () => {
  assert.deepEqual(PROVIDER_SETTINGS, ['auto', 'se', 'local']);
  for (const v of [undefined, null, '']) assert.equal(providerSettingOf(v), 'auto');
  assert.equal(providerSettingOf('LOCAL'), 'local'); assert.equal(providerSettingOf('Se'), 'se'); assert.equal(providerSettingOf('auto'), 'auto');
  for (const v of ['both', 'pf', ' local', 'local ', 7, {}, []]) assert.equal(providerSettingOf(v), null, String(v));
});

test('the tool tables: scopes, the one public tool, the group-gated tool, the call-anyway use case', () => {
  assert.equal(LOCAL_TOOLS.size, 16); assert.deepEqual(Object.keys(TOOL_SCOPES).sort(), [...LOCAL_TOOLS].sort());
  assert.deepEqual([...PUBLIC_TOOLS], ['list_marketplace_apps', 'list_airports']); assert.deepEqual([...GROUP_GATED_TOOLS], ['get_project_security_settings', 'sensitive_passenger_record']); assert.deepEqual([...CALL_UNLISTED], ['UC9']);
  assert.equal(toolScopeOf('get_my_issues'), 'issues:read'); assert.equal(toolScopeOf('list_marketplace_apps'), null);
  for (const bad of ['__proto__', 'constructor', 'toString', 'nope', undefined, 7]) assert.equal(toolScopeOf(bad), null, String(bad));
});

test('choose, capability gateway: only SE exists; local forces null; the probe is never consulted', async () => {
  const log = [];
  for (const [setting, want] of [['auto', 'only-option'], ['se', 'forced']]) {
    const p = createProviders({ setting, real: mkReal(), local: mkLocal(), fetchImpl: okFetch(log) });
    assert.deepEqual(await p.choose({ capability: 'gateway' }), { provider: 'se', capability: 'gateway', url: GW.url, audience: GW.audience, scope: GW.scope, why: want, answeredBy: 'Agent Gateway (SE)', label: 'Agent Gateway [SE]' });
  }
  assert.equal(await createProviders({ setting: 'local', real: mkReal(), local: mkLocal() }).choose({ capability: 'gateway' }), null);
  assert.equal(await createProviders({ setting: 'auto', real: mkReal({ gateway: null }), local: mkLocal() }).choose({ capability: 'gateway' }), null, 'no gateway settings: nothing to pick');
  assert.equal(await createProviders({ setting: 'auto', real: mkReal({ configured: false }), local: mkLocal() }).choose({ capability: 'gateway' }), null, 'Real not configured');
  assert.equal(log.length, 0, 'the gateway has no alternative to switch to: no probe');
});

test('choose, capability tools: the full matrix of setting x SE configured x probe x local ready, with the exact `why`', async () => {
  const rows = [];
  for (const setting of ['auto', 'se', 'local']) for (const se of [true, false]) for (const probeOk of [true, false]) for (const localReady of [true, false]) {
    const log = [];
    const p = createProviders({ setting, real: mkReal({ toolsSe: se ? SE_URL : null }), local: mkLocal(localReady ? 'ready' : 'failed'), fetchImpl: okFetch(log, probeOk ? 200 : 500) });
    const pick = await p.choose({ capability: 'tools' });
    let want;
    if (setting === 'se') want = se ? { provider: 'se', why: 'forced' } : null;
    else if (setting === 'local') want = localReady ? { provider: 'local', why: 'forced' } : null;
    else if (se && probeOk) want = { provider: 'se', why: 'auto-se-ok' };
    else if (localReady) want = { provider: 'local', why: se ? 'auto-se-probe-failed' : 'auto-se-not-configured' };
    else want = null;
    rows.push([setting, se, probeOk, localReady, pick && [pick.provider, pick.why]]);
    if (!want) { assert.equal(pick, null, JSON.stringify([setting, se, probeOk, localReady])); continue; }
    assert.deepEqual([pick.provider, pick.why], [want.provider, want.why], JSON.stringify([setting, se, probeOk, localReady]));
    assert.equal(pick.capability, 'tools'); assert.equal(pick.audience, 'appfire-work-tools'); assert.equal(pick.scope, null);
    if (pick.provider === 'se') assert.deepEqual([pick.url, pick.answeredBy, pick.label], [SE_URL, 'tool server (SE)', 'Tool server [SE]']);
    else assert.deepEqual([pick.url, pick.answeredBy, pick.label], ['http://127.0.0.1:41234/mcp', 'tool server (local)', 'Tool server [local]']);
    assert.deepEqual(Object.keys(pick).sort(), ['answeredBy', 'audience', 'capability', 'label', 'provider', 'scope', 'url', 'why'], 'exactly the eight keys');
    // A forced provider is used as is: no probe. auto probes only when SE is configured.
    assert.equal(log.length, setting === 'auto' && se ? 1 : 0, JSON.stringify([setting, se]));
  }
  assert.equal(rows.length, 24);
});

test('choose: an unknown capability (a later wave such as CIBA) has no provider yet and an unknown setting falls back to auto', async () => {
  const p = createProviders({ setting: 'auto', real: mkReal(), local: mkLocal() });
  assert.equal(await p.choose({ capability: 'ciba' }), null); assert.equal(await p.choose({}), null); assert.equal(await p.choose(), null);
  assert.equal(createProviders({ setting: 'weird', real: mkReal() }).setting, 'auto');
});

test('hosted: choose is null, snapshot is all false, info says hosted; nothing is probed and nothing is read', async () => {
  const log = [];
  const p = createProviders({ setting: 'se', real: mkReal(), local: mkLocal(), hosted: true, fetchImpl: okFetch(log) });
  assert.equal(await p.choose({ capability: 'tools' }), null); assert.equal(await p.choose({ capability: 'gateway' }), null);
  assert.deepEqual(p.snapshot(), { setting: 'auto', gateway: false, tools: { se: false, local: false } });
  assert.deepEqual(p.info(), { setting: 'auto', hosted: true, gateway: false, toolsSe: false, local: { state: 'hosted', tools: 0 } });
  assert.equal(log.length, 0);
});

test('the SE probe: an unauthenticated initialize POSTed to the MCP url, 200 or 401 is up, cached 30 s per url, concurrent calls share one request, a redirect or an error is a failure', async () => {
  const log = []; let clock = 1_000;
  const p = createProviders({ setting: 'auto', real: mkReal(), local: mkLocal(), fetchImpl: okFetch(log), now: () => clock });
  const [a, b] = await Promise.all([p.choose({ capability: 'tools' }), p.choose({ capability: 'tools' })]);
  assert.equal(a.provider, 'se'); assert.equal(b.provider, 'se'); assert.equal(log.length, 1, 'concurrent probes share one promise');
  assert.equal(log[0].url, SE_URL, 'the MCP url itself, not <origin>/health (a shared ingress may have no /health, or answer it for another service)');
  assert.equal(log[0].init.method, 'POST'); assert.equal(log[0].init.redirect, 'manual');
  assert.deepEqual(Object.keys(log[0].init.headers).sort(), ['accept', 'content-type']);
  assert.equal(JSON.parse(log[0].init.body).method, 'initialize');
  assert.ok(log[0].init.signal instanceof AbortSignal);
  clock += 29_000; await p.choose({ capability: 'tools' }); assert.equal(log.length, 1, 'cached for 30 s');
  clock += 2_000; await p.choose({ capability: 'tools' }); assert.equal(log.length, 2, 'probed again after the cache');
  const up401 = createProviders({ setting: 'auto', real: mkReal(), local: mkLocal(), fetchImpl: okFetch([], 401) });
  assert.equal((await up401.choose({ capability: 'tools' })).why, 'auto-se-ok', 'HTTP 401 means it answered and wants a token: up');
  for (const status of [301, 302, 307, 400, 403, 404, 500, 503]) {
    const q = createProviders({ setting: 'auto', real: mkReal(), local: mkLocal(), fetchImpl: okFetch([], status) });
    assert.equal((await q.choose({ capability: 'tools' })).why, 'auto-se-probe-failed', `HTTP ${status} is a failed probe`);
  }
  const boom = createProviders({ setting: 'auto', real: mkReal(), local: mkLocal(), fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); } });
  assert.equal((await boom.choose({ capability: 'tools' })).why, 'auto-se-probe-failed');
  // No token and no lab header ever goes to the probe.
  assert.ok(!JSON.stringify(log).toLowerCase().includes('authorization'));
});

test('a tool server mid-restart is waited for before the pick (it was a silent switch to the lab\'s own steps), and a failed one is asked to try again', async () => {
  let state = 'starting'; const asked = [];
  const local = { state: () => state, mcpUrl: () => (state === 'ready' ? 'http://127.0.0.1:41234/mcp' : null), toolNames: () => [...LOCAL_TOOLS], ready: async (ms) => { asked.push(ms); state = 'ready'; return true; } };
  const p = createProviders({ setting: 'local', real: mkReal({ toolsSe: null }), local });
  assert.deepEqual(p.snapshot().tools, { se: false, local: false, localState: 'starting' });
  const pick = await p.choose({ capability: 'tools' });
  assert.equal(pick.provider, 'local'); assert.equal(asked.length, 1); assert.ok(asked[0] >= 1000 && asked[0] <= 10_000);
  state = 'failed'; await p.prepare(); assert.equal(asked.length, 2, 'a failed service is asked again');
  state = 'ready'; await p.prepare(); assert.equal(asked.length, 2, 'a ready one is not');
  const se = createProviders({ setting: 'se', real: mkReal(), local: { ...local, state: () => 'starting', ready: async () => { throw new Error('must not wait'); } }, fetchImpl: okFetch([]) });
  assert.equal((await se.choose({ capability: 'tools' })).provider, 'se', 'AAG_PROVIDER=se never waits for the local server');
  const gone = createProviders({ setting: 'local', real: mkReal({ toolsSe: null }), local: { ...local, state: () => 'failed', mcpUrl: () => null, ready: async () => false } });
  assert.equal(await gone.choose({ capability: 'tools' }), null, 'still failed after the wait: no pick');
});

test('snapshot() never touches the network and reflects what can answer; info() carries no url, port or secret', async () => {
  const log = [];
  const local = mkLocal('starting');
  const p = createProviders({ setting: 'auto', real: mkReal(), local, fetchImpl: okFetch(log) });
  assert.deepEqual(p.snapshot(), { setting: 'auto', gateway: true, tools: { se: true, local: false, localState: 'starting' } });
  assert.equal(log.length, 0);
  const info = p.info(); assert.deepEqual(info, { setting: 'auto', hosted: false, gateway: true, toolsSe: true, local: { state: 'starting', tools: 16 } });
  const text = JSON.stringify(info); assert.ok(!/https?:|127\.0\.0\.1|secret|token/i.test(text), text);
  assert.deepEqual(createProviders({ setting: 'local', real: mkReal({ gateway: null, toolsSe: null }), local: mkLocal() }).snapshot(), { setting: 'local', gateway: false, tools: { se: false, local: true, localState: 'ready' } });
  assert.deepEqual(createProviders({ real: mkReal({ configured: false }) }).snapshot(), { setting: 'auto', gateway: false, tools: { se: false, local: false, localState: 'off' } }, 'Real not configured: SE is not usable');
});

test('provider.js pins: reads no environment, imports nothing from real.js, realGate.js or app.js, builds no regular expression from input, never names a client secret', () => {
  const code = fs.readFileSync(new URL('../src/provider.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/process\.env/.test(code)); assert.ok(!/from '\.\/(real|realGate|app)\.js'/.test(code)); assert.ok(!/new RegExp/.test(code)); assert.ok(!/CLIENT_SECRET|clientSecret/.test(code));
});

// ---- the choice is made ONCE per run, through the app ---------------------------------------------------------------------------------------------------
const ENV = { ALLOW_MOCK_SIGNIN: '1' };
test('the pick is made once per run: a run whose picked provider fails does NOT choose again and ends REAL_UNREACHABLE (never a switch to the other provider)', async () => {
  const p1 = await startFakePingOne(); const ts = await startFakeToolServer({ behaviour: 'down-after-probe', isDelegated: (t) => p1.issued.delegated.has(t) });
  const real = createReal({ config: realConfig(fullSettingsFor(null, { AAG_TOOLS_SE_URL: ts.url }), { AAG_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true });
  const local = stubLocal(ts); // the local provider is ready too, and would answer if the lab switched
  let chose = 0; const inner = createProviders({ setting: 'auto', real, local });
  const providers = { ...inner, choose: async (a) => { chose += 1; return inner.choose(a); } };
  try {
    await withServer(async (url) => {
      assert.equal((await post(url, '/api/mode', { source: 'real' })).status, 200);
      assert.equal((await post(url, '/api/signin', { password: (await import('./fakePingone.js')).DEMO_PASSWORD })).status, 200);
      const before = ts.seen.length;
      const r = await run(url, 'UC1', { vertical: 'software' });
      assert.equal(r.status, 200); assert.equal(chose, 1, 'choose was called exactly once');
      assert.equal(r.body.run.provider, 'se'); assert.equal(r.body.run.providerWhy, 'auto-se-ok');
      assert.equal(r.body.run.outcome, 'REAL_UNREACHABLE', 'the SE provider failed: an honest no decision');
      assert.ok(ts.seen.length > before);
    }, { env: ENV, real, providers, local });
  } finally { await p1.close(); await ts.close(); }
});

test('the gate and the pick agree for all four provider states; a null pick runs the labelled engine with a fixed reason and never reaches a provider', async () => {
  const p1 = await startFakePingOne(); const ts = await startFakeToolServer({ isDelegated: (t) => p1.issued.delegated.has(t) }); const gw = await startFakeGateway({ isDelegated: (t) => p1.issued.delegated.has(t) });
  const { DEMO_PASSWORD } = await import('./fakePingone.js');
  const states = [
    { name: 'local only', settings: {}, local: 'ready', gateway: false, want: { UC1: 'local' } },
    { name: 'SE tools', settings: { AAG_TOOLS_SE_URL: ts.url }, local: 'failed', gateway: false, want: { UC1: 'se' } },
    { name: 'forced local, local not ready', settings: { AAG_PROVIDER: 'local' }, local: 'failed', gateway: true, want: { UC1: null } },
    { name: 'gateway only', settings: {}, local: 'failed', gateway: true, want: { UC1: null } },
  ];
  try {
    for (const s of states) {
      const real = createReal({ config: realConfig(fullSettingsFor(s.gateway ? gw.url : null, s.settings), { AAG_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true });
      const local = stubLocal(ts, { state: s.local });
      const providers = createProviders({ setting: real.providerSetting(), real, local });
      await withServer(async (url) => {
        const gate = (await (await get(url, '/api/usecases/UC1?vertical=software')).json()).usecase.realGate;
        assert.equal(gate.real, s.want.UC1 !== null, `${s.name}: the picker says ${JSON.stringify(gate)}`);
        const pick = await providers.choose({ capability: 'tools' });
        assert.equal(pick?.provider ?? null, s.want.UC1, `${s.name}: the pick`);
        await post(url, '/api/mode', { source: 'real' }); await post(url, '/api/signin', { password: DEMO_PASSWORD });
        const seen = ts.seen.length;
        const r = await run(url, 'UC1', { vertical: 'software' });
        assert.equal(r.status, 200, s.name);
        if (s.want.UC1) assert.equal(r.body.run.provider, s.want.UC1, s.name);
        else { assert.equal(r.body.run.kind === 'real', false, `${s.name}: runs on the lab's own steps`); assert.equal(ts.seen.length, seen, `${s.name}: no tool server was reached`); assert.ok(typeof r.body.run.realGate?.reason === 'string' && r.body.run.realGate.reason.length > 0, `${s.name}: the run carries the reason`); }
      }, { env: ENV, real, local, providers });
    }
  } finally { await p1.close(); await ts.close(); await gw.close(); }
});

test('a partial or invalid SE gateway trio is named in the gate\'s reason (fixed words, no value), not just "not set up"', async () => {
  const { realGate } = await import('../src/realGate.js');
  const { loadCast } = await import('../src/cast.js');
  const { MANIFEST } = await import('../src/manifest.js');
  const uc = MANIFEST.usecases.find((u) => u.id === 'UC1');
  const cast = loadCast(undefined, 'banking');
  const problem = 'the app .env sets some of AAG_AGENT_GATEWAY_URL, AAG_GATEWAY_AUDIENCE, AAG_GATEWAY_SCOPE but not AAG_GATEWAY_SCOPE';
  const p = createProviders({ setting: 'auto', real: { ...mkReal({ gateway: null, toolsSe: null }), gatewayProblem: () => problem }, local: mkLocal() });
  assert.equal(p.snapshot().gatewayProblem, problem);
  assert.equal(realGate(uc, cast, p.snapshot()).reason, `the SE gateway is not set up here: ${problem}`);
  const plain = createProviders({ setting: 'auto', real: mkReal({ gateway: null, toolsSe: null }), local: mkLocal() });
  assert.equal(Object.hasOwn(plain.snapshot(), 'gatewayProblem'), false, 'no problem, no key');
  assert.match(realGate(uc, cast, plain.snapshot()).reason, /^the SE gateway is not set up here \(AAG_AGENT_GATEWAY_URL, AAG_GATEWAY_AUDIENCE, AAG_GATEWAY_SCOPE\)$/);
});

test('choose with the airline pack: on auto the lab\'s own tool server answers (an SE copy is not known to carry the airline tools) and no probe is made; a forced SE and the software pack are unchanged', async () => {
  const log = [];
  const auto = createProviders({ setting: 'auto', real: mkReal(), local: mkLocal('ready'), fetchImpl: okFetch(log, 200) });
  const air = await auto.choose({ capability: 'tools', pack: 'airline' });
  assert.deepEqual([air.provider, air.why, air.answeredBy], ['local', 'auto-airline-local', 'tool server (local)']); assert.equal(log.length, 0, 'the SE probe is not consulted');
  assert.deepEqual((await auto.choose({ capability: 'tools', pack: 'software' })).why, 'auto-se-ok', 'software still prefers a healthy SE copy');
  assert.equal((await auto.choose({ capability: 'tools' })).why, 'auto-se-ok');
  // Local not up: the airline pack falls to SE only when SE is configured and answers; otherwise nothing answers.
  const down = createProviders({ setting: 'auto', real: mkReal(), local: mkLocal('failed'), fetchImpl: okFetch([], 200) });
  assert.equal((await down.choose({ capability: 'tools', pack: 'airline' })).why, 'auto-se-ok');
  assert.equal(await createProviders({ setting: 'auto', real: mkReal({ toolsSe: null }), local: mkLocal('failed'), fetchImpl: okFetch([], 200) }).choose({ capability: 'tools', pack: 'airline' }), null);
  const forced = createProviders({ setting: 'se', real: mkReal(), local: mkLocal('ready'), fetchImpl: okFetch([], 200) });
  assert.equal((await forced.choose({ capability: 'tools', pack: 'airline' })).why, 'forced'); assert.equal((await forced.choose({ capability: 'tools', pack: 'airline' })).provider, 'se');
});
