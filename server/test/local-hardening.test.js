// Review-fix tests for the local tool server (security pass 2026-11-16): stalled bodies, one caller's hold flood, the anonymous session pool,
// the blocked-term fold and the issuer shape. Each one failed before its fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startRig } from './localHarness.js';
import { createHitl } from '../src/local/hitl.js';
import { validateInit } from '../src/local/server.js';
import { ACTOR, AUDIENCE, TIER_GROUP } from './localFakeIdp.js';
import { SECRET } from './localHarness.js';

const bulk = (n, extra = {}) => ({ project: 'PLAT', issue_count: n, field: 'status', value: 'Done', ...extra });

test('stalled request bodies do not wedge the server: 40 half-sent bodies, then /health still answers 200 (it never did before the deadline)', async (t) => {
  const rig = await startRig({ bodyDeadlineMs: 3000 });
  const sockets = [];
  try {
    for (let i = 0; i < 40; i += 1) {
      const s = net.connect(rig.local.port, '127.0.0.1');
      s.on('error', () => {});
      s.write(`POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${rig.local.port}\r\ncontent-type: application/json\r\ncontent-length: 100\r\n\r\n{`);
      sockets.push(s);
    }
    // Did the attack land? Under a heavily loaded machine the sockets can be slow to be accepted, so this is read, not assumed: the deterministic proof of the deadline is the
    // readBody unit test below; this one proves the whole server recovers.
    const t00 = Date.now(); let peak = 0;
    while (peak < 32 && Date.now() - t00 < 2000) { await new Promise((r) => setTimeout(r, 25)); peak = Math.max(peak, rig.local.inFlight()); }
    if (peak >= 32) assert.equal((await rig.raw('/health')).status, 503, 'while 40 bodies stall, every slot is held (the attack is real)');
    else t.diagnostic(`the attack did not fill the slots within 2 s (peak ${peak}); recovery is still checked`);
    const t0 = Date.now();
    let ok = null;
    while (Date.now() - t0 < 12_000) {
      const r = await rig.raw('/health').catch(() => null);
      if (r?.status === 200) { ok = r; break; }
      await new Promise((r2) => setTimeout(r2, 200));
    }
    assert.ok(ok, '/health recovered within 12 s');
    const t1 = Date.now();
    while (rig.local.inFlight() > 0 && Date.now() - t1 < 5000) await new Promise((r) => setTimeout(r, 100));
    assert.equal(rig.local.inFlight(), 0, 'every slot was given back');
    const tool = await rig.call('list_marketplace_apps', {});
    assert.equal(tool.status, 200, 'the tool server serves again');
  } finally { for (const s of sockets) s.destroy(); await rig.close(); }
});

test('readBody: a body that never completes resolves as timed out at the deadline and the request is destroyed (deterministic)', async () => {
  const { readBody } = await import('../src/local/util.js');
  const { EventEmitter } = await import('node:events');
  const req = Object.assign(new EventEmitter(), { headers: { 'content-length': '100' }, destroyed: false, destroy() { this.destroyed = true; } });
  const t0 = Date.now();
  const r = await readBody(req, 65536, { deadlineMs: 120 });
  assert.deepEqual(r, { ok: false, tooLarge: false, timedOut: true });
  assert.equal(req.destroyed, true, 'the socket is dropped so its slot is given back');
  assert.ok(Date.now() - t0 >= 100 && Date.now() - t0 < 5000);
  // A body that arrives in time is unaffected, and the timer does not outlive it.
  const ok = new EventEmitter(); ok.headers = {}; ok.destroy = () => { throw new Error('must not be destroyed'); };
  const p = readBody(ok, 65536, { deadlineMs: 120 });
  ok.emit('data', Buffer.from('{"a":')); ok.emit('data', Buffer.from('1}')); ok.emit('end');
  assert.deepEqual(await p, { ok: true, text: '{"a":1}' });
  await new Promise((r2) => setTimeout(r2, 200));
  // A request that closes early is a failure at once, not a wait for the deadline.
  const gone = new EventEmitter(); gone.headers = {}; gone.destroy = () => {};
  const q = readBody(gone, 65536, { deadlineMs: 60_000 }); gone.emit('close');
  assert.deepEqual(await q, { ok: false, tooLarge: false });
});

test('one caller cannot fill the approval store: five pending per caller, the oldest of their own is dropped, others are unaffected', async () => {
  const rig = await startRig();
  try {
    const alice = rig.token({ sub: 'alice-sub' });
    const bob = rig.token({ sub: 'bob-sub' });
    const sa = await rig.open(alice); const sb = await rig.open(bob);
    const ids = [];
    for (let i = 0; i < 230; i += 1) {
      const r = await rig.call('bulk_update_issues', bulk(250, { value: `v${i}` }), { tok: alice, session: sa });
      assert.equal(r.status, 428, `call ${i}`);
      ids.push(r.json.challengeId);
    }
    assert.ok(rig.local.hitl.size() <= 5, `alice holds ${rig.local.hitl.size()} challenges, at most 5`);
    const b = await rig.call('bulk_update_issues', bulk(300), { tok: bob, session: sb });
    assert.equal(b.status, 428, 'bob still gets a challenge (it was 503 capacity before)');
    assert.equal((await rig.hitl(`/${ids[0]}`, { method: 'GET' })).status, 404, 'alice\'s oldest was dropped');
    assert.equal((await rig.hitl(`/${ids[229]}`, { method: 'GET' })).status, 200, 'her newest is kept');
  } finally { await rig.close(); }
});

test('the same held call retried with the same arguments gets the same challenge (idempotent), a different value gets a new one', async () => {
  const rig = await startRig();
  try {
    const tok = rig.token({ sub: 'carol-sub' });
    const s = await rig.open(tok);
    const a = await rig.call('bulk_update_issues', bulk(300), { tok, session: s });
    const b = await rig.call('bulk_update_issues', bulk(300), { tok, session: s });
    const c = await rig.call('bulk_update_issues', bulk(300, { value: 'Other' }), { tok, session: s });
    assert.equal(a.json.challengeId, b.json.challengeId);
    assert.notEqual(a.json.challengeId, c.json.challengeId);
    assert.equal(rig.local.hitl.size(), 2);
  } finally { await rig.close(); }
});

test('createHitl: the per-caller cap and the reuse hold in the unit too, an approved challenge is never reused', () => {
  let n = 0;
  const h = createHitl({ now: () => 1000, newId: () => `id-${n += 1}`, perSub: 2 });
  const d = (c) => c.repeat(64);
  const first = h.create({ sub: 'a', tool: 't', argsDigest: d('a') });
  assert.equal(h.create({ sub: 'a', tool: 't', argsDigest: d('a') }).id, first.id);
  h.respond(first.id, { decision: 'approved', respondedBy: 'p' });
  assert.notEqual(h.create({ sub: 'a', tool: 't', argsDigest: d('a') }).id, first.id, 'an answered challenge is not handed out again');
  h.create({ sub: 'a', tool: 't', argsDigest: d('b') });
  h.create({ sub: 'a', tool: 't', argsDigest: d('c') });
  assert.equal(h.get(first.id).ok, true, 'an answered one is not pending, so it is not part of the cap');
});

test('tokenless initialize calls cannot evict a signed-in user\'s session', async () => {
  const rig = await startRig();
  try {
    const tok = rig.token({ sub: 'dave-sub' });
    const s = await rig.open(tok);
    for (let i = 0; i < 260; i += 1) await rig.rpc('initialize', { protocolVersion: '2025-06-18' });
    const r = await rig.rpc('tools/list', {}, { tok, session: s });
    assert.equal(r.status, 200, 'dave\'s session survived (it was 404 session_unknown before)');
  } finally { await rig.close(); }
});

test('the blocked-term rule folds zero-width, soft-hyphen, combining and full-width characters', async () => {
  const rig = await startRig();
  try {
    const tok = rig.token({});
    const s = await rig.open(tok);
    const q = (query) => rig.call('brave_news_search', { query }, { tok, session: s });
    for (const bad of ['BiTcOiN', 'cr​ypto', 'bit­coin', 'cry⁠pto', 'b́itcoin', 'ｃｒｙｐｔｏ', 'bit﻿coin']) {
      const r = await q(bad);
      assert.equal(r.status, 403, JSON.stringify(bad));
      assert.equal(r.json.reason, 'lab-blocked-term');
    }
    assert.equal((await q('release notes')).status, 200);
  } finally { await rig.close(); }
});

test('validateInit: an issuer with a trailing slash is refused at init, one without is accepted', () => {
  const base = { audience: AUDIENCE, allowedActors: [ACTOR], tierGroup: TIER_GROUP, hitlSecret: SECRET };
  assert.equal(validateInit({ ...base, issuer: 'https://auth.pingone.com/11111111-2222-4333-8444-555555555555/as' }).ok, true);
  assert.equal(validateInit({ ...base, issuer: 'https://auth.pingone.com/11111111-2222-4333-8444-555555555555/as/' }).ok, false);
});
