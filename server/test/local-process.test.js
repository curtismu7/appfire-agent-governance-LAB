// The real child entry, forked the way the lab forks it: init over IPC, ready with a loopback port, shutdown, and every refusal path.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTOR, AUDIENCE, TIER_GROUP, startFakeIdp } from './localFakeIdp.js';
import { SECRET } from './localHarness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(here, '../src/local/main.js');
const PROBE = path.join(here, 'localChildProbe.mjs');
let idp;
before(async () => { idp = await startFakeIdp(); });
after(async () => { await idp.close(); });

const goodConfig = () => ({ issuer: idp.issuer, audience: AUDIENCE, allowedActors: [ACTOR], tierGroup: TIER_GROUP, hitlSecret: SECRET, clockSkewSeconds: 60 });

// Forks the way localServices.js does (design B.1): a sentinel in THIS process's environment must not reach the child.
function start(entry = MAIN, args = [], env = { NODE_ENV: 'production' }) {
  process.env.LOCAL_TEST_SENTINEL = 'should-not-reach-the-child';
  const child = fork(entry, args, { cwd: path.dirname(MAIN), env, execArgv: ['--max-old-space-size=96'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'json', windowsHide: true });
  const out = { messages: [], stderr: '', exit: null };
  child.stderr.on('data', (c) => { out.stderr += c; });
  child.on('message', (m) => out.messages.push(m));
  out.exited = new Promise((resolve) => child.on('exit', (code, signal) => { out.exit = { code, signal }; resolve(out.exit); }));
  out.child = child;
  out.next = (type) => new Promise((resolve, reject) => {
    const hit = out.messages.find((m) => m.type === type);
    if (hit) { resolve(hit); return; }
    const t = setTimeout(() => reject(new Error(`no ${type} message`)), 8000);
    child.on('message', (m) => { if (m.type === type) { clearTimeout(t); resolve(m); } });
    out.exited.then(() => { clearTimeout(t); const late = out.messages.find((m) => m.type === type); if (late) resolve(late); else reject(new Error(`child exited without ${type}`)); });
  });
  return out;
}
const mcp = async (port, message, { tok, session } = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(message) });
  return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
};

test('init, ready on an ephemeral loopback port, a real call with a fake-issuer token, shutdown exits 0', async () => {
  const c = start();
  try {
    c.child.send({ type: 'bogus' });                                  // every other message type is ignored
    c.child.send({ type: 'init', config: goodConfig() });
    const ready = await c.next('ready');
    assert.ok(Number.isInteger(ready.port) && ready.port >= 1024 && ready.port <= 65535);
    assert.ok(ready.port < 7814 || ready.port > 7839, 'nothing in the lab port range');
    assert.equal(ready.pid, c.child.pid);
    assert.equal(ready.tools.length, 10); assert.ok(ready.tools.every((n) => /^[a-z0-9_]{1,64}$/.test(n)));
    assert.deepEqual(Object.keys(ready).sort(), ['pid', 'port', 'tools', 'type']);
    const init = await mcp(ready.port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { tok: idp.mint({}) });
    const session = init.headers.get('mcp-session-id');
    const call = await mcp(ready.port, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_my_issues', arguments: { limit: 2 } } }, { tok: idp.mint({}), session });
    assert.equal(call.status, 200); assert.equal(call.json.result.structuredContent.returned, 2);
    // the approval service answers on the same port with the secret that crossed IPC
    const hold = await mcp(ready.port, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bulk_update_issues', arguments: { project: 'PLAT', issue_count: 300 } } }, { tok: idp.mint({}), session });
    assert.equal(hold.status, 428);
    const id = hold.json.challengeId;
    const noSecret = await fetch(`http://127.0.0.1:${ready.port}/hitl/challenges/${id}`);
    assert.equal(noSecret.status, 401);
    const got = await fetch(`http://127.0.0.1:${ready.port}/hitl/challenges/${id}`, { headers: { 'x-hitl-internal-secret': SECRET } });
    assert.equal((await got.json()).status, 'pending');
    assert.equal((await (await fetch(`http://127.0.0.1:${ready.port}/health`)).json()).jwks, 'ok');
    c.child.send({ type: 'shutdown' });
    assert.deepEqual(await c.exited, { code: 0, signal: null });
    assert.equal(c.stderr, '');
  } finally { c.child.kill('SIGKILL'); }
});

const BAD = {
  'no issuer': (c) => { delete c.issuer; },
  'http issuer that is not loopback': (c) => { c.issuer = 'http://auth.example.com/env/as'; },
  'issuer with a query': (c) => { c.issuer = 'https://auth.example.com/env/as?x=1'; },
  'issuer with a fragment': (c) => { c.issuer = 'https://auth.example.com/env/as#f'; },
  'issuer with credentials': (c) => { c.issuer = 'https://user:pw@auth.example.com/env/as'; },
  'issuer with no path': (c) => { c.issuer = 'https://auth.example.com'; },
  'issuer that is an IP literal': (c) => { c.issuer = 'https://203.0.113.9/env/as'; },
  'issuer that is not a URL': (c) => { c.issuer = 'not a url'; },
  'issuer that is not a string': (c) => { c.issuer = 5; },
  'empty audience': (c) => { c.audience = ''; },
  'audience too long': (c) => { c.audience = 'a'.repeat(301); },
  'no actors': (c) => { c.allowedActors = []; },
  'six actors': (c) => { c.allowedActors = ['a', 'b', 'c', 'd', 'e', 'f']; },
  'a blank actor': (c) => { c.allowedActors = ['']; },
  'actors not an array': (c) => { c.allowedActors = ACTOR; },
  'empty tier group': (c) => { c.tierGroup = ''; },
  'short secret': (c) => { c.hitlSecret = 'abc'; },
  'upper-case secret': (c) => { c.hitlSecret = SECRET.toUpperCase(); },
  'secret not hex': (c) => { c.hitlSecret = 'z'.repeat(64); },
  'skew 301': (c) => { c.clockSkewSeconds = 301; },
  'skew negative': (c) => { c.clockSkewSeconds = -1; },
  'skew not an integer': (c) => { c.clockSkewSeconds = 1.5; },
};
for (const [name, mutate] of Object.entries(BAD)) {
  test(`init refused: ${name} gives error init_invalid and exit 1, with no value in the message`, async () => {
    const c = start();
    try {
      const cfg = goodConfig(); mutate(cfg);
      c.child.send({ type: 'init', config: cfg });
      const err = await c.next('error');
      assert.deepEqual(Object.keys(err).sort(), ['code', 'detail', 'type']);
      assert.equal(err.code, 'init_invalid');
      assert.ok(!JSON.stringify(err).includes(SECRET));
      assert.deepEqual(await c.exited, { code: 1, signal: null });
    } finally { c.child.kill('SIGKILL'); }
  });
}

test('init with no config at all, and init that is not an object, is refused', async () => {
  for (const config of [undefined, null, 'x', []]) {
    const c = start();
    try {
      c.child.send({ type: 'init', config });
      assert.equal((await c.next('error')).code, 'init_invalid');
      assert.equal((await c.exited).code, 1);
    } finally { c.child.kill('SIGKILL'); }
  }
});

test('a second init is ignored', async () => {
  const c = start();
  try {
    c.child.send({ type: 'init', config: goodConfig() });
    const ready = await c.next('ready');
    c.child.send({ type: 'init', config: { ...goodConfig(), issuer: 'bad' } });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(c.messages.filter((m) => m.type === 'error').length, 0);
    assert.equal((await fetch(`http://127.0.0.1:${ready.port}/health`)).status, 200);
  } finally { c.child.kill('SIGKILL'); }
});

test('the child sees only NODE_ENV, plus NODE_EXTRA_CA_CERTS only when the parent passed one', async () => {
  const a = start(PROBE, ['env'], { NODE_ENV: 'production' });
  try {
    const probe = await a.next('probe');
    assert.deepEqual(probe.env.filter((k) => !/^__CF_/.test(k)), ['NODE_ENV'], 'the sentinel in the parent environment did not reach the child');
    assert.ok(!probe.env.includes('LOCAL_TEST_SENTINEL'));
  } finally { a.child.kill('SIGKILL'); }
  const b = start(PROBE, ['env'], { NODE_ENV: 'production', NODE_EXTRA_CA_CERTS: '/etc/ssl/extra.pem' });
  try {
    const probe = await b.next('probe');
    assert.deepEqual(probe.env.filter((k) => !/^__CF_/.test(k)), ['NODE_ENV', 'NODE_EXTRA_CA_CERTS']);
  } finally { b.child.kill('SIGKILL'); }
});

for (const mode of ['throw', 'reject']) {
  test(`an uncaught ${mode === 'throw' ? 'exception' : 'rejection'} writes one fixed line (no message, no stack) and exits 1`, async () => {
    const c = start(PROBE, [mode]);
    try {
      assert.deepEqual(await c.exited, { code: 1, signal: null });
      assert.equal(c.stderr, 'appfire-tools-local: fatal error\n');
      assert.ok(!c.stderr.includes('SENTINEL'));
    } finally { c.child.kill('SIGKILL'); }
  });
}

test('the parent going away (IPC disconnect) makes the child exit', async () => {
  const c = start();
  try {
    c.child.send({ type: 'init', config: goodConfig() });
    await c.next('ready');
    c.child.disconnect();
    assert.deepEqual(await c.exited, { code: 0, signal: null });
  } finally { c.child.kill('SIGKILL'); }
});

test('SIGTERM stops it cleanly', async () => {
  const c = start();
  try {
    c.child.send({ type: 'init', config: goodConfig() });
    await c.next('ready');
    c.child.kill('SIGTERM');
    assert.deepEqual(await c.exited, { code: 0, signal: null });
  } finally { c.child.kill('SIGKILL'); }
});

test('with no init for 5 seconds the child exits 1', { timeout: 15_000 }, async () => {
  const c = start();
  try {
    const t0 = Date.now();
    assert.deepEqual(await c.exited, { code: 1, signal: null });
    assert.ok(Date.now() - t0 >= 4500, 'it waited about 5 seconds');
    assert.equal(c.messages.length, 0, 'it said nothing before init');
  } finally { c.child.kill('SIGKILL'); }
});

test('it answers only on 127.0.0.1: the IPv6 loopback and a non-loopback bind are not offered', async () => {
  const c = start();
  try {
    c.child.send({ type: 'init', config: goodConfig() });
    const ready = await c.next('ready');
    await assert.rejects(fetch(`http://[::1]:${ready.port}/health`, { signal: AbortSignal.timeout(1500) }));
  } finally { c.child.kill('SIGKILL'); }
});
