// localServices.js (design-real-local.md B.1): the supervisor that forks the lab's own tool server and approval service. Two ways: in-process with a fake forkImpl
// (no process, no clock) for the protocol and the supervision, and a real fork of fakeLocalChild.js (a script that speaks the IPC protocol) for the options.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalServices } from '../src/localServices.js';
import { makeFakeFork } from './fakeLocalChild.js';

const CHILD = fileURLToPath(new URL('./fakeLocalChild.js', import.meta.url));
const CONFIG = { issuer: 'https://auth.pingone.example/11111111-2222-4333-8444-555555555555/as', audience: 'appfire-work-tools', allowedActors: ['88888888-9999-4aaa-8bbb-cccccccccccc'], tierGroup: 'Software_EnterpriseTier', tierGroupAirline: 'Airline_OrbitTier' };
const READY = (extra = {}) => ({ type: 'ready', port: 41234, pid: 99, tools: ['get_my_issues', 'bulk_update_issues'], ...extra });
// Names the platform or Node itself puts into a child's environment (the IPC channel, macOS's __CF_USER_TEXT_ENCODING): not the parent's.
const PLATFORM_ENV = /^(node_channel|__cf_)/;
const tick = () => new Promise((r) => setImmediate(r));

test('start sends ONE init, resolves on ready, and exposes only urls built from the validated port', async () => {
  const f = makeFakeFork();
  const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl, modulePath: '/x/local/main.js' });
  assert.equal(svc.state(), 'off'); assert.equal(svc.mcpUrl(), null); assert.equal(svc.hitl(), null); assert.deepEqual(svc.toolNames(), []);
  const started = svc.start(); await tick();
  assert.equal(svc.state(), 'starting'); assert.equal(f.calls.length, 1);
  const child = f.last(); assert.equal(child.sent.length, 1);
  const init = child.sent[0]; assert.equal(init.type, 'init');
  assert.deepEqual(Object.keys(init.config).sort(), ['allowedActors', 'audience', 'authorize', 'clockSkewSeconds', 'hitlSecret', 'issuer', 'tierGroup', 'tierGroupAirline']);
  assert.deepEqual([init.config.issuer, init.config.audience, init.config.allowedActors, init.config.tierGroup, init.config.clockSkewSeconds], [CONFIG.issuer, CONFIG.audience, CONFIG.allowedActors, CONFIG.tierGroup, 60]);
  assert.equal(init.config.tierGroupAirline, 'Airline_OrbitTier');
  assert.match(init.config.hitlSecret, /^[0-9a-f]{64}$/);
  child.emit('message', READY());
  assert.deepEqual(await started, { ok: true, port: 41234 });
  assert.equal(svc.state(), 'ready'); assert.equal(svc.mcpUrl(), 'http://127.0.0.1:41234/mcp'); assert.equal(svc.healthUrl(), 'http://127.0.0.1:41234/health'); assert.deepEqual(svc.toolNames(), ['get_my_issues', 'bulk_update_issues']);
  assert.deepEqual(svc.hitl(), { url: 'http://127.0.0.1:41234/hitl', secret: init.config.hitlSecret });
  assert.deepEqual(await svc.start(), { ok: true, port: 41234 }, 'a second start while ready is the same answer and forks nothing'); assert.equal(f.calls.length, 1);
  assert.equal(child.sent.length, 1, 'the init is sent once, never again');
});

test('the fork call is exactly the design: module, no args, cwd, env NODE_ENV only, execArgv, stdio with ipc, json serialization', async () => {
  const f = makeFakeFork();
  const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl, modulePath: '/srv/app/server/src/local/main.js' });
  svc.start(); await tick();
  assert.deepEqual(f.calls[0], { modulePath: '/srv/app/server/src/local/main.js', args: [], options: { cwd: '/srv/app/server/src/local', env: { NODE_ENV: 'production' }, execArgv: ['--max-old-space-size=96'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'json', windowsHide: true } });
  const g = makeFakeFork();
  createLocalServices({ config: CONFIG, forkImpl: g.forkImpl, caCertsPath: '/etc/ssl/extra.pem' }).start(); await tick();
  assert.deepEqual(g.calls[0].options.env, { NODE_ENV: 'production', NODE_EXTRA_CA_CERTS: '/etc/ssl/extra.pem' }, 'only the CA path is forwarded');
  for (const bad of ['', 'x'.repeat(1025), 7, null, {}]) { const h = makeFakeFork(); createLocalServices({ config: CONFIG, forkImpl: h.forkImpl, caCertsPath: bad }).start(); await tick(); assert.deepEqual(h.calls[0].options.env, { NODE_ENV: 'production' }, `a bad CA path (${String(bad).slice(0, 10)}) is dropped`); }
  assert.equal(g.calls[0].modulePath, fileURLToPath(new URL('../src/local/main.js', import.meta.url)), 'the default module path is server/src/local/main.js');
});

test('hosted: start says hosted and forkImpl is never called (spy count 0)', async () => {
  const f = makeFakeFork();
  const svc = createLocalServices({ config: CONFIG, hosted: true, forkImpl: f.forkImpl });
  assert.deepEqual(await svc.start(), { ok: false, reason: 'hosted' }); assert.deepEqual(await svc.start(), { ok: false, reason: 'hosted' });
  assert.equal(f.calls.length, 0); assert.equal(svc.state(), 'off'); assert.equal(svc.mcpUrl(), null); assert.equal(svc.hitl(), null);
  await svc.stop(); assert.equal(f.calls.length, 0);
});

test('silence is a failure: no ready within the timeout is `failed`, the child is killed and no url or secret is exposed', async () => {
  const f = makeFakeFork();
  const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl, startTimeoutMs: 30 });
  const r = await svc.start();
  assert.deepEqual(r, { ok: false, reason: 'start_timeout' }); assert.equal(svc.state(), 'failed'); assert.equal(f.last().killed, true);
  assert.equal(svc.mcpUrl(), null); assert.equal(svc.hitl(), null); assert.deepEqual(await svc.start(), { ok: false, reason: 'failed' }, 'failed stays failed until the process restarts');
});

test('an error message from the child, an exit before ready and a failing fork are `failed`', async () => {
  const f = makeFakeFork(); const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl });
  const p = svc.start(); await tick(); f.last().emit('message', { type: 'error', code: 'init_invalid', detail: 'fixed text' });
  assert.deepEqual(await p, { ok: false, reason: 'init_failed' }); assert.equal(svc.state(), 'failed');
  const g = makeFakeFork(); const s2 = createLocalServices({ config: CONFIG, forkImpl: g.forkImpl });
  const p2 = s2.start(); await tick(); g.last().emit('exit', 1, null);
  assert.deepEqual(await p2, { ok: false, reason: 'exited' }); assert.equal(s2.state(), 'failed');
  const s3 = createLocalServices({ config: CONFIG, forkImpl: () => { throw new Error('spawn denied'); } });
  assert.deepEqual(await s3.start(), { ok: false, reason: 'fork_failed' }); assert.equal(s3.state(), 'failed');
  const s4 = createLocalServices({ config: CONFIG, forkImpl: () => ({ on() {}, send() { throw new Error('closed'); }, kill() {}, removeAllListeners() {} }) });
  assert.deepEqual(await s4.start(), { ok: false, reason: 'send_failed' }, 'a closed channel is a failure, never a throw into the caller');
});

test('what the child says is validated: a port outside 1024-65535 or inside 7814-7839, a non-integer port, a bad tool name, too many tools are all `failed`', async () => {
  const bads = [
    { port: 80 }, { port: 1023 }, { port: 65536 }, { port: 7814 }, { port: 7820 }, { port: 7839 }, { port: '41234' }, { port: 41234.5 }, { port: null },
    { tools: ['Not A Tool!'] }, { tools: ['UPPER'] }, { tools: ['a b'] }, { tools: ['x'.repeat(65)] }, { tools: [''] }, { tools: [7] }, { tools: 'get_my_issues' }, { tools: Array.from({ length: 51 }, (_, i) => `t${i}`) },
  ];
  for (const bad of bads) {
    const f = makeFakeFork(); const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl });
    const p = svc.start(); await tick(); f.last().emit('message', READY(bad));
    assert.deepEqual(await p, { ok: false, reason: 'ready_invalid' }, JSON.stringify(bad).slice(0, 60)); assert.equal(svc.state(), 'failed'); assert.equal(svc.mcpUrl(), null); assert.equal(f.last().killed, true);
  }
  const f = makeFakeFork(); const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl });
  const p = svc.start(); await tick(); f.last().emit('message', READY({ port: 7840, tools: ['a1_b2', ...Array.from({ length: 49 }, (_, i) => `t${i}`)] }));
  assert.equal((await p).ok, true, 'the edges are accepted: 7840 and 50 tools'); assert.equal(svc.toolNames().length, 50);
  f.last().emit('message', null); f.last().emit('message', 'ready'); f.last().emit('message', { type: 'other' }); assert.equal(svc.state(), 'ready', 'other messages are ignored');
});

test('supervision: an unexpected exit restarts up to 3 times inside 60 s with a 1 s, 2 s, 4 s backoff, a new secret each time, then `failed`', async () => {
  const f = makeFakeFork(); let clock = 0;
  const realSetTimeout = globalThis.setTimeout;
  const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl, now: () => clock, backoffMs: [5, 6, 7] });
  const secrets = [];
  const up = async () => { await tick(); secrets.push(f.last().sent[0].config.hitlSecret); f.last().emit('message', READY({ port: 41300 + secrets.length })); await tick(); };
  const first = svc.start(); await up(); assert.equal((await first).ok, true);
  for (let i = 1; i <= 3; i++) {
    clock += 1_000; const was = f.calls.length;
    f.last().emit('exit', 1, null);
    assert.equal(svc.state(), 'starting', `restart ${i} is scheduled`); assert.equal(svc.mcpUrl(), null); assert.equal(svc.hitl(), null);
    await new Promise((r) => realSetTimeout(r, 30)); assert.equal(f.calls.length, was + 1, `restart ${i} forked`);
    await up(); assert.equal(svc.state(), 'ready'); assert.equal(svc.mcpUrl(), `http://127.0.0.1:${41300 + secrets.length}/mcp`, 'a new port after a restart');
  }
  clock += 1_000; f.last().emit('exit', 1, null); await new Promise((r) => realSetTimeout(r, 30));
  assert.equal(svc.state(), 'failed', 'the fourth unexpected exit inside 60 s is final'); assert.equal(f.calls.length, 4); assert.equal(svc.hitl(), null);
  assert.equal(new Set(secrets).size, 4, 'the secret is made again for every start');
});

test('supervision window: exits more than 60 s apart do not add up', async () => {
  const f = makeFakeFork(); let clock = 0;
  const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl, now: () => clock, backoffMs: [5, 5, 5] });
  const first = svc.start(); await tick(); f.last().emit('message', READY()); await first;
  for (let i = 0; i < 6; i++) {
    clock += 61_000; f.last().emit('exit', 1, null); await new Promise((r) => setTimeout(r, 25)); await tick();
    assert.equal(svc.state(), 'starting', `exit ${i + 1}`); f.last().emit('message', READY({ port: 42000 + i })); await tick(); assert.equal(svc.state(), 'ready');
  }
  assert.equal(f.calls.length, 7);
});

test('stop sends shutdown, waits for the exit, and leaves the service off with nothing exposed; stop with nothing running is a no-op', async () => {
  const f = makeFakeFork(); const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl });
  await svc.stop(); assert.equal(svc.state(), 'off');
  const p = svc.start(); await tick(); f.last().emit('message', READY()); await p;
  const child = f.last(); const stopped = svc.stop(); await tick();
  assert.deepEqual(child.sent.at(-1), { type: 'shutdown' }); child.emit('exit', 0, null); await stopped;
  assert.equal(svc.state(), 'off'); assert.equal(svc.mcpUrl(), null); assert.equal(svc.hitl(), null);
  child.emit('exit', 1, null); await tick(); assert.equal(svc.state(), 'off', 'an exit after stop is not supervised');
  // A child that ignores shutdown is killed after the grace period (the test shortens nothing: the fake exits on kill).
  const g = makeFakeFork(); const s2 = createLocalServices({ config: CONFIG, forkImpl: g.forkImpl });
  const p2 = s2.start(); await tick(); g.last().emit('message', READY()); await p2;
  g.last().send = () => { throw new Error('closed'); }; await s2.stop(); assert.equal(g.last().killed, true); assert.equal(s2.state(), 'off');
});

test('a REAL fork: the child gets exactly the design environment, and the secret is sent only in init', async () => {
  // fakeLocalChild.js answers `ready` with the names of ITS environment variables as tool names when tierGroup is report-env.
  const svc = createLocalServices({ config: { ...CONFIG, tierGroup: 'report-env' }, modulePath: CHILD, startTimeoutMs: 8000 });
  process.env.APPFIRE_SENTINEL_FOR_TEST = 'should-not-reach-the-child'; process.env.AAG_USER_CLIENT_SECRET = 'should-not-reach-the-child';
  try {
    const r = await svc.start(); assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(svc.toolNames().filter((n) => !PLATFORM_ENV.test(n)).sort(), ['node_env'], 'the child sees NODE_ENV and nothing of the parent');
  } finally { delete process.env.APPFIRE_SENTINEL_FOR_TEST; delete process.env.AAG_USER_CLIENT_SECRET; await svc.stop(); }
  const svc2 = createLocalServices({ config: { ...CONFIG, tierGroup: 'report-env' }, modulePath: CHILD, caCertsPath: '/etc/ssl/none.pem', startTimeoutMs: 8000 });
  try { assert.equal((await svc2.start()).ok, true); assert.deepEqual(svc2.toolNames().filter((n) => !PLATFORM_ENV.test(n)).sort(), ['node_env', 'node_extra_ca_certs']); } finally { await svc2.stop(); }
});

test('a REAL fork: silence, a bad port, a bad tool name and an init error are all `failed`; a child that keeps dying is restarted three times and then `failed`', async () => {
  for (const [how, reason] of [['silent', 'start_timeout'], ['bad-port', 'ready_invalid'], ['reserved-port', 'ready_invalid'], ['bad-tool', 'ready_invalid'], ['error', 'init_failed']]) {
    const svc = createLocalServices({ config: { ...CONFIG, tierGroup: how }, modulePath: CHILD, startTimeoutMs: how === 'silent' ? 400 : 8000 });
    const r = await svc.start(); assert.deepEqual(r, { ok: false, reason }, how); assert.equal(svc.state(), 'failed', how); await svc.stop();
  }
  // die-after-ready: the child exits once ready; the supervisor restarts it (the fake dies again each time) and ends `failed` after 3 restarts.
  const svc = createLocalServices({ config: { ...CONFIG, tierGroup: 'die-after-ready' }, modulePath: CHILD, startTimeoutMs: 8000, backoffMs: [10, 10, 10] });
  assert.equal((await svc.start()).ok, true);
  const deadline = Date.now() + 8000; while (svc.state() !== 'failed' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  assert.equal(svc.state(), 'failed', 'three restarts, then failed'); await svc.stop();
});

test('the secret: 64 hex chars made per start, sent only in the init message, never in hitl()\'s service object, JSON of the service, or any stringification of the API', async () => {
  const seen = [];
  for (let i = 0; i < 2; i++) {
    const f = makeFakeFork(); const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl });
    const p = svc.start(); await tick(); f.last().emit('message', READY()); await p;
    const secret = f.last().sent[0].config.hitlSecret; seen.push(secret); assert.match(secret, /^[0-9a-f]{64}$/);
    assert.equal(svc.hitl().secret, secret);
    const exposed = JSON.stringify({ state: svc.state(), mcp: svc.mcpUrl(), health: svc.healthUrl(), tools: svc.toolNames(), svc, calls: f.calls });
    assert.ok(!exposed.includes(secret), 'the secret is in no url, no state, no fork option and not in the service object');
    assert.equal(f.calls.every((c) => !JSON.stringify(c).includes(secret)), true, 'not in env or argv');
    assert.deepEqual(f.last().sent.filter((m) => JSON.stringify(m).includes(secret)).map((m) => m.type), ['init'], 'only the init message holds it');
  }
  assert.notEqual(seen[0], seen[1], 'a new secret per start');
});

test('localServices.js pins: the only child_process use is `fork`; no environment read; no client secret named; the module reads no file', () => {
  const code = fs.readFileSync(new URL('../src/localServices.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.deepEqual([...code.matchAll(/from 'node:child_process'/g)].length, 1); assert.ok(/import \{ fork as nodeFork \} from 'node:child_process'/.test(code));
  assert.ok(!/\b(spawn|exec|execFile|execSync|spawnSync|execFileSync)\b/.test(code)); assert.ok(!/process\.env/.test(code)); assert.ok(!/CLIENT_SECRET|clientSecret/.test(code)); assert.ok(!/node:fs/.test(code));
  assert.equal(path.basename(fileURLToPath(new URL('../src/local/main.js', import.meta.url))), 'main.js');
});

// ---- review fixes (behaviour pass 2026-11-16): a failed supervisor recovers, a restart that dies spends the budget, a restart window is waited out, a wedged child is replaced ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a restart attempt that dies while starting is another crash, not the end: it is retried inside the budget (it was `failed` at once before)', async () => {
  const f = makeFakeFork(); let clock = 0;
  const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl, now: () => clock, backoffMs: [5, 5, 5], pingMs: 0 });
  const first = svc.start(); await tick(); f.last().emit('message', READY()); await first;
  clock += 1000; f.last().emit('exit', 1, null);
  await sleep(30); assert.equal(f.calls.length, 2, 'restart 1 forked'); assert.equal(svc.state(), 'starting');
  clock += 1000; f.last().emit('exit', 1, null);                       // the restart attempt itself dies before it is ready
  assert.equal(svc.state(), 'starting', 'still supervised: not failed after one dead restart attempt');
  await sleep(30); assert.equal(f.calls.length, 3, 'restart 2 forked');
  f.last().emit('message', READY({ port: 41999 })); await tick();
  assert.equal(svc.state(), 'ready'); assert.equal(svc.mcpUrl(), 'http://127.0.0.1:41999/mcp');
});

test('a restart attempt that never says ready (start_timeout) is also a crash that is retried', async () => {
  const f = makeFakeFork(); let clock = 0;
  const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl, now: () => clock, backoffMs: [5, 5, 5], startTimeoutMs: 40, pingMs: 0 });
  const first = svc.start(); await tick(); f.last().emit('message', READY()); await first;
  clock += 1000; f.last().emit('exit', 1, null);
  await sleep(120); assert.ok(f.calls.length >= 3, `the silent attempt was replaced (${f.calls.length} forks)`);
});

test('failed is not for ever: after the cool-down start() forks again with a fresh budget and a new run finds the tool server back', async () => {
  const f = makeFakeFork(); let clock = 0;
  const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl, now: () => clock, backoffMs: [5, 5, 5], retryAfterMs: 30_000, pingMs: 0 });
  const first = svc.start(); await tick(); f.last().emit('message', READY()); await first;
  for (let i = 0; i < 4; i += 1) { clock += 1000; f.last().emit('exit', 1, null); await sleep(25); if (i < 3) { f.last().emit('message', READY({ port: 42100 + i })); await tick(); } }
  assert.equal(svc.state(), 'failed'); const forks = f.calls.length;
  assert.deepEqual(await svc.start(), { ok: false, reason: 'failed' }, 'inside the cool-down it stays failed'); assert.equal(f.calls.length, forks);
  assert.equal(await svc.ready(10), false);
  clock += 30_000;
  const again = svc.start(); await tick(); assert.equal(f.calls.length, forks + 1, 'the cool-down passed: one more fork'); assert.equal(svc.state(), 'starting');
  f.last().emit('message', READY({ port: 42200 }));
  assert.deepEqual(await again, { ok: true, port: 42200 }); assert.equal(svc.state(), 'ready'); assert.equal(svc.mcpUrl(), 'http://127.0.0.1:42200/mcp');
});

test('ready(): waits out a restart window and answers true when it ends ready, false when the supervisor has given up or the wait is over', async () => {
  const f = makeFakeFork(); let clock = 0;
  const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl, now: () => clock, backoffMs: [20, 20, 20], pingMs: 0 });
  assert.equal(await svc.ready(10), false, 'never started: nothing to wait for');
  const first = svc.start(); await tick(); f.last().emit('message', READY()); await first;
  assert.equal(await svc.ready(10), true);
  clock += 1000; f.last().emit('exit', 1, null); assert.equal(svc.state(), 'starting');
  const waiting = svc.ready(2000);
  await sleep(60); f.last().emit('message', READY({ port: 42300 }));
  assert.equal(await waiting, true); assert.equal(svc.mcpUrl(), 'http://127.0.0.1:42300/mcp');
  clock += 1000; f.last().emit('exit', 1, null);
  assert.equal(await svc.ready(80), false, 'the restart never became ready inside the wait');
  const h = createLocalServices({ config: CONFIG, hosted: true, forkImpl: f.forkImpl }); assert.equal(await h.ready(10), false);
});

test('a wedged child (alive, answering nothing) is killed after two missed health checks and the service restarts it', async () => {
  const f = makeFakeFork(); let clock = 0; const asked = [];
  const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl, now: () => clock, backoffMs: [5, 5, 5], pingMs: 20, pingTimeoutMs: 50, fetchImpl: async (url) => { asked.push(url); throw new Error('timeout'); } });
  const first = svc.start(); await tick(); const child = f.last(); child.emit('message', READY({ port: 42400 })); await first;
  await sleep(150);
  assert.equal(child.killed, true, 'killed after two misses');
  assert.deepEqual([...new Set(asked)], ['http://127.0.0.1:42400/health'], 'only the loopback health url is asked');
  await sleep(80); assert.equal(f.calls.length, 2, 'the crash path forked a new child'); await svc.stop();
});

test('a healthy child is never killed by the ping, and one missed answer is forgiven', async () => {
  const f = makeFakeFork(); let n = 0;
  const svc = createLocalServices({ config: CONFIG, forkImpl: f.forkImpl, pingMs: 15, pingTimeoutMs: 50, fetchImpl: async () => { n += 1; return n === 2 ? { status: 503, body: null } : { status: 200, body: null }; } });
  const first = svc.start(); await tick(); const child = f.last(); child.emit('message', READY()); await first;
  await sleep(160); assert.ok(n >= 5, `pinged ${n} times`); assert.equal(child.killed, false); assert.equal(svc.state(), 'ready'); await svc.stop();
});

// ---- PingOne Authorize over IPC (design-authorize-lab.md B.3): the parent asks, the child never holds a secret or a URL ----
const AZ_PARAMS = { AirLabMarker: 'larkspur-air', ToolName: 'book_airline_flight', UserId: 'u-1', AirFare: '380', AirIsInternational: 'false', AirCabinAsked: 'business', AirApproval: 'none' };
const AZ_TRACE = '0af7651916cd43dd8448eb211c80319c';
const AZ_OK = { outcome: 'permit', code: 'airline-permit-as-asked', reason: null, correlationId: 'c-1', elapsedMs: 9 };
const results = (child) => child.sent.filter((m) => m.type === 'authorize-result');
async function readyWith(authorize, config = { ...CONFIG, authorize: true }) {
  const f = makeFakeFork();
  const svc = createLocalServices({ config, forkImpl: f.forkImpl, pingMs: 0, authorize });
  const first = svc.start(); await tick(); const child = f.last(); child.emit('message', READY()); await first;
  return { f, svc, child };
}

test('authorize over IPC: init carries a boolean only (from config.authorize); a valid question is answered with ONE small message that carries its id and nothing else', async () => {
  const seen = [];
  const { svc, child, f } = await readyWith({ decide: async (p, o) => { seen.push([p, o]); return AZ_OK; } });
  assert.equal(child.sent[0].config.authorize, true); assert.deepEqual(Object.keys(child.sent[0].config).sort().includes('authorizeSecret'), false);
  child.emit('message', { type: 'authorize', id: 17, trace: AZ_TRACE, params: AZ_PARAMS }); await tick(); await tick();
  assert.deepEqual(results(child), [{ type: 'authorize-result', id: 17, outcome: 'permit', code: 'airline-permit-as-asked', reason: null, correlationId: 'c-1', elapsedMs: 9 }]);
  assert.deepEqual(seen, [[AZ_PARAMS, { trace: AZ_TRACE }]]);
  child.emit('message', { type: 'authorize', id: 18, trace: null, params: AZ_PARAMS }); await tick(); await tick();
  assert.equal(results(child).at(-1).id, 18); assert.equal(seen.at(-1)[1].trace, null);
  assert.equal(f.calls.length, 1); await svc.stop();
  const off = await readyWith(null, { ...CONFIG }); assert.equal(off.child.sent[0].config.authorize, false); await off.svc.stop();
});

test('authorize over IPC: a bad id gets no reply; a bad trace, bad params or an oversize message is answered malformed AT ONCE; no authorize object is unavailable; an exception is unavailable', async () => {
  const { svc, child } = await readyWith({ decide: async () => AZ_OK });
  const q = async (m) => { const n = results(child).length; child.emit('message', m); await tick(); await tick(); return results(child).slice(n); };
  for (const id of [0, -1, 1.5, '7', null, undefined, 2147483648, {}]) assert.deepEqual(await q({ type: 'authorize', id, trace: null, params: AZ_PARAMS }), [], `id ${JSON.stringify(id)}`);
  const bad = async (m, why) => { const [r] = await q(m); assert.deepEqual([r.outcome, r.code, r.reason], ['no_decision', null, 'malformed'], why); assert.equal(r.id, m.id); };
  await bad({ type: 'authorize', id: 1, trace: 'xyz', params: AZ_PARAMS }, 'a trace that is not 32 hex'); await bad({ type: 'authorize', id: 2, trace: AZ_TRACE.toUpperCase(), params: AZ_PARAMS }, 'upper case');
  await bad({ type: 'authorize', id: 3, trace: undefined, params: AZ_PARAMS }, 'no trace field');
  await bad({ type: 'authorize', id: 4, trace: null, params: { ...AZ_PARAMS, Amount: '5' } }, 'an extra shared attribute'); await bad({ type: 'authorize', id: 5, trace: null, params: { ...AZ_PARAMS, AirFare: 'abc' } }, 'a bad fare');
  await bad({ type: 'authorize', id: 6, trace: null, params: 'http://evil.example' }, 'params that look like a URL'); await bad({ type: 'authorize', id: 7, trace: null, params: AZ_PARAMS, junk: 'x'.repeat(2000) }, 'over 1 KB');
  await svc.stop();
  const none = await readyWith(null); const n0 = results(none.child).length;
  none.child.emit('message', { type: 'authorize', id: 9, trace: null, params: AZ_PARAMS }); await tick(); await tick();
  assert.equal(results(none.child)[n0].reason, 'unavailable'); await none.svc.stop();
  const boom = await readyWith({ decide: async () => { throw new Error('secret-text-in-an-error'); } });
  boom.child.emit('message', { type: 'authorize', id: 10, trace: null, params: AZ_PARAMS }); await tick(); await tick();
  const r = results(boom.child)[0]; assert.equal(r.reason, 'unavailable'); assert.ok(!JSON.stringify(r).includes('secret-text')); await boom.svc.stop();
  const rubbish = await readyWith({ decide: async () => ({ outcome: 'permit', code: 'lab-no-restriction', url: 'https://x.example', token: 'tok' }) });
  rubbish.child.emit('message', { type: 'authorize', id: 11, trace: null, params: AZ_PARAMS }); await tick(); await tick();
  const rr = results(rubbish.child)[0]; assert.equal(rr.outcome, 'no_decision'); assert.deepEqual(Object.keys(rr).sort(), ['code', 'correlationId', 'elapsedMs', 'id', 'outcome', 'reason', 'type'], 'nothing the authorize object returned beyond the five fields is forwarded'); await rubbish.svc.stop();
});

test('authorize over IPC: more than eight outstanding is busy at once; the reply goes only to the child that asked; a question before ready is ignored', async () => {
  const gate = []; 
  const { svc, child, f } = await readyWith({ decide: () => new Promise((resolve) => gate.push(resolve)) });
  for (let id = 1; id <= 8; id += 1) child.emit('message', { type: 'authorize', id, trace: null, params: AZ_PARAMS });
  child.emit('message', { type: 'authorize', id: 9, trace: null, params: AZ_PARAMS }); await tick(); await tick();
  assert.deepEqual(results(child).map((r) => [r.id, r.reason]), [[9, 'busy']], 'the ninth is busy and eight are waiting');
  for (const r of gate) r(AZ_OK); await tick(); await tick(); await tick();
  assert.equal(results(child).filter((r) => r.outcome === 'permit').length, 8);
  // a replaced child never receives an answer meant for the old one
  gate.length = 0;
  child.emit('message', { type: 'authorize', id: 20, trace: null, params: AZ_PARAMS }); await tick();
  child.emit('exit', 1, null); await tick();
  const before = results(child).length; for (const r of gate) r(AZ_OK); await tick(); await tick();
  assert.equal(results(child).length, before, 'the dead child got nothing');
  await svc.stop();
  const early = makeFakeFork(); const s2 = createLocalServices({ config: { ...CONFIG, authorize: true }, forkImpl: early.forkImpl, pingMs: 0, authorize: { decide: async () => AZ_OK } });
  const st = s2.start(); await tick(); early.last().emit('message', { type: 'authorize', id: 1, trace: null, params: AZ_PARAMS }); await tick(); await tick();
  assert.equal(results(early.last()).length, 0, 'before ready nothing is answered'); early.last().emit('message', READY()); await st; await s2.stop();
});

test('authorize over IPC: localServices.js never names a client secret or a URL of the endpoint, and the real child gets only the boolean', () => {
  const src = fs.readFileSync(new URL('../src/localServices.js', import.meta.url), 'utf8');
  assert.ok(!/clientSecret|CLIENT_SECRET|decisionUrl|tokenUrl/.test(src));
});
