// The lab's own approval service: the secret on every route, the state machine, the capacity, the digest.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { SECRET, startRig } from './localHarness.js';
import { argsDigest, createHitl } from '../src/local/hitl.js';

let rig;
before(async () => { rig = await startRig(); });
after(async () => { await rig.close(); });

const DIGEST = 'a'.repeat(64);
const create = (extra = {}, o = {}) => rig.hitl('', { body: { sub: 'u1', tool: 'bulk_update_issues', argsDigest: DIGEST, amount: 300, ...extra }, ...o });

test('the secret is needed on all four routes: missing, wrong, wrong length, right', async () => {
  const made = await create();
  assert.equal(made.status, 201);
  const id = made.json.id;
  const routes = [
    ['', 'POST', { sub: 'u1', tool: 't', argsDigest: DIGEST }], [`/${id}/respond`, 'POST', { decision: 'approved', respondedBy: 'p' }],
    [`/${id}/verify`, 'POST', { sub: 'u1', tool: 'bulk_update_issues', argsDigest: DIGEST }], [`/${id}`, 'GET', undefined],
  ];
  for (const [path, method, body] of routes) {
    for (const secret of [null, 'wrong', SECRET.slice(0, -1), `${SECRET}0`, SECRET.toUpperCase(), '']) {
      const r = await rig.hitl(path, { method, body, secret });
      assert.equal(r.status, 401, `${method} ${path} with ${JSON.stringify(secret)}`);
      assert.deepEqual(r.json, { error: 'unauthorized' });
    }
  }
  assert.equal((await rig.hitl(`/${id}`, { method: 'GET' })).status, 200);
});

test('create, get, respond, verify: the state machine over HTTP', async () => {
  const made = await create();
  assert.equal(made.status, 201);
  assert.match(made.json.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(made.json.status, 'pending'); assert.equal(made.json.ttlSeconds, 300);
  assert.equal(Date.parse(made.json.expiresAt) - rig.clock.t, 300_000);
  const id = made.json.id;
  const got = await rig.hitl(`/${id}`, { method: 'GET' });
  assert.deepEqual(Object.keys(got.json), ['id', 'status', 'tool', 'amount', 'createdAt', 'expiresAt'], 'no sub and no digest');
  assert.equal(got.json.status, 'pending'); assert.equal(got.json.amount, 300);
  const bind = { sub: 'u1', tool: 'bulk_update_issues', argsDigest: DIGEST };
  assert.deepEqual((await rig.hitl(`/${id}/verify`, { body: bind })).json, { valid: false, reason: 'receipt_pending' });
  const yes = await rig.hitl(`/${id}/respond`, { body: { decision: 'approved', respondedBy: 'test phone' } });
  assert.equal(yes.status, 200); assert.equal(yes.json.status, 'approved'); assert.equal(yes.json.decision, 'approved'); assert.ok(Date.parse(yes.json.respondedAt));
  const second = await rig.hitl(`/${id}/respond`, { body: { decision: 'denied', respondedBy: 'other' } });
  assert.equal(second.status, 409); assert.deepEqual(second.json, { error: 'already_answered', status: 'approved' });
  assert.deepEqual((await rig.hitl(`/${id}/verify`, { body: { ...bind, sub: 'u2' } })).json, { valid: false, reason: 'receipt_binding_mismatch' });
  assert.equal((await rig.hitl(`/${id}`, { method: 'GET' })).json.status, 'approved', 'a failed verify leaves it untouched');
  assert.deepEqual((await rig.hitl(`/${id}/verify`, { body: bind })).json, { valid: true, id, consumed: true });
  assert.equal((await rig.hitl(`/${id}`, { method: 'GET' })).json.status, 'consumed');
  assert.deepEqual((await rig.hitl(`/${id}/verify`, { body: bind })).json, { valid: false, reason: 'receipt_used' });
});

test('denied, expired and unknown ids', async () => {
  const d = await create();
  assert.equal((await rig.hitl(`/${d.json.id}/respond`, { body: { decision: 'denied', respondedBy: 'p' } })).json.status, 'denied');
  const bind = { sub: 'u1', tool: 'bulk_update_issues', argsDigest: DIGEST };
  assert.deepEqual((await rig.hitl(`/${d.json.id}/verify`, { body: bind })).json, { valid: false, reason: 'receipt_denied' });
  const e = await create();
  rig.clock.t += 300_001;
  const late = await rig.hitl(`/${e.json.id}/respond`, { body: { decision: 'approved', respondedBy: 'p' } });
  assert.equal(late.status, 410); assert.deepEqual(late.json, { error: 'expired' });
  assert.equal((await rig.hitl(`/${e.json.id}`, { method: 'GET' })).json.status, 'expired');
  assert.deepEqual((await rig.hitl(`/${e.json.id}/verify`, { body: bind })).json, { valid: false, reason: 'receipt_expired' });
  for (const id of ['6f1c9a52-0b7e-4d0e-9f1e-7c3f5a2d8b10', 'nope', 'x'.repeat(128)]) {
    assert.equal((await rig.hitl(`/${id}`, { method: 'GET' })).status, 404, id);
    assert.equal((await rig.hitl(`/${id}/respond`, { body: { decision: 'approved', respondedBy: 'p' } })).json.error, 'unknown_challenge');
    assert.deepEqual((await rig.hitl(`/${id}/verify`, { body: bind })).json, { valid: false, reason: 'receipt_unknown' });
  }
});

test('bad bodies, bad methods and a wrong media type are refused with fixed words', async () => {
  for (const body of [{}, { sub: '', tool: 't', argsDigest: DIGEST }, { sub: 'u', tool: 't', argsDigest: 'short' }, { sub: 'u', tool: 't', argsDigest: DIGEST, amount: 'many' }, { sub: 'u', tool: 't'.repeat(65), argsDigest: DIGEST }]) {
    const r = await rig.hitl('', { body });
    assert.equal(r.status, 400, JSON.stringify(body)); assert.deepEqual(r.json, { error: 'bad_request' });
  }
  const id = (await create()).json.id;
  for (const body of [{ decision: 'maybe', respondedBy: 'p' }, { decision: 'approved' }, { decision: 'approved', respondedBy: 'p'.repeat(81) }]) assert.equal((await rig.hitl(`/${id}/respond`, { body })).status, 400);
  assert.equal((await rig.hitl(`/${id}/verify`, { body: { sub: 'u' } })).status, 400);
  assert.equal((await rig.hitl(`/${id}/respond`, { method: 'GET' })).status, 405);
  assert.equal((await rig.hitl(`/${id}`, { method: 'POST', body: {} })).status, 405);
  const text = await rig.raw('/hitl/challenges', { method: 'POST', body: '{}', headers: { 'x-hitl-internal-secret': SECRET, 'content-type': 'text/plain' } });
  assert.equal(text.status, 415);
  const junk = await rig.raw('/hitl/challenges', { method: 'POST', body: 'not json', headers: { 'x-hitl-internal-secret': SECRET, 'content-type': 'application/json' } });
  assert.equal(junk.status, 400);
  assert.equal((await rig.hitl('/a/b/c', { method: 'GET' })).status, 404);
  assert.equal((await rig.raw('/hitl', { headers: { 'x-hitl-internal-secret': SECRET } })).status, 404);
});

test('capacity: 200 pending challenges fill it, the 201st is 503; a decided one makes room', async () => {
  const fresh = await startRig();
  try {
    const ids = [];
    for (let i = 0; i < 200; i += 1) {
      const r = await fresh.hitl('', { body: { sub: `u${i}`, tool: 't', argsDigest: DIGEST } });
      assert.equal(r.status, 201); ids.push(r.json.id);
    }
    const full = await fresh.hitl('', { body: { sub: 'u-late', tool: 't', argsDigest: DIGEST } });
    assert.equal(full.status, 503); assert.deepEqual(full.json, { error: 'capacity' });
    await fresh.hitl(`/${ids[5]}/respond`, { body: { decision: 'denied', respondedBy: 'p' } });
    assert.equal((await fresh.hitl('', { body: { sub: 'u-late', tool: 't', argsDigest: DIGEST } })).status, 201);
    assert.equal((await fresh.hitl(`/${ids[5]}`, { method: 'GET' })).status, 404, 'the decided one was evicted first');
    assert.equal((await fresh.hitl(`/${ids[0]}`, { method: 'GET' })).status, 200, 'a pending one was kept');
    // an expired one also makes room
    fresh.clock.t += 301_000;
    assert.equal((await fresh.hitl('', { body: { sub: 'u-later', tool: 't', argsDigest: DIGEST } })).status, 201);
  } finally { await fresh.close(); }
});

test('the enforcer reports the full store as 503 capacity without an audit header', async () => {
  const fresh = await startRig();
  try {
    for (let i = 0; i < 200; i += 1) await fresh.hitl('', { body: { sub: `u${i}`, tool: 't', argsDigest: DIGEST } });   // 200 different callers: the per-caller cap does not apply
    const r = await fresh.call('bulk_update_issues', { project: 'PLAT', issue_count: 300 }, { tok: fresh.token({}) });
    assert.equal(r.status, 503); assert.equal(r.json.error, 'capacity'); assert.equal(r.headers['x-gw-audit-trail'], undefined);
  } finally { await fresh.close(); }
});

test('argsDigest is key-order independent, recursive, and ignores the control field', () => {
  assert.equal(argsDigest({ a: 1, b: 2 }), argsDigest({ b: 2, a: 1 }));
  assert.equal(argsDigest({ a: { x: 1, y: [1, { q: 1, p: 2 }] } }), argsDigest({ a: { y: [1, { p: 2, q: 1 }], x: 1 } }));
  assert.equal(argsDigest({ a: 1, _hitl_challenge_id: 'abc' }), argsDigest({ a: 1 }));
  assert.notEqual(argsDigest({ a: 1 }), argsDigest({ a: '1' }));
  assert.notEqual(argsDigest({ a: 1 }), argsDigest({ a: 1, b: null }));
  assert.match(argsDigest({}), /^[0-9a-f]{64}$/);
  assert.equal(argsDigest(undefined), argsDigest({}));
});

test('the store unit: injected clock and ids', () => {
  let t = 1_000_000; let n = 0;
  const h = createHitl({ now: () => t, newId: () => `id-${n += 1}`, ttlMs: 1000, max: 2 });
  const bind = { sub: 's', tool: 't', argsDigest: DIGEST };
  const a = h.create({ ...bind, amount: 1 }); h.create({ ...bind, sub: 's2' });
  assert.equal(h.create({ ...bind, sub: 's3' }).reason, 'capacity');
  assert.equal(h.respond(a.id, { decision: 'approved', respondedBy: 'p' }).ok, true);
  assert.equal(h.verify(a.id, bind).valid, true);
  assert.equal(h.verify(a.id, bind).reason, 'receipt_used');
  t += 1001;
  assert.equal(h.create(bind).ok, true, 'everything is expired, so the oldest goes');
  assert.equal(h.verify(undefined, bind).reason, 'receipt_unknown');
  assert.equal(h.get('id-2').status, 'expired');
});
