// Live sequence (owner, 2026-11-28): a Real run with body.stream=true answers text/x-ndjson — one {type:"hop", hop}
// line per finished hop, then the ordinary full answer as one {type:"done", ...} line. The streamed hops are byte-equal
// (JSON-equal) to the same hops in the done line's run. A refusal before the stream (401 sign-in) is still ordinary JSON.
// Mock runs ignore stream and stay one JSON document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReal, realConfig } from '../src/real.js';
import { get, post, W, withServer } from './helpers.js';
import { AGENT_CLIENT_ID, CLIENT_SECRET, DEMO_PASSWORD, DEMO_USERNAME, USER_CLIENT_SECRET, fullSettingsFor, startFakePingOne } from './fakePingone.js';
import { startFakeGateway } from './fakeGateway.js';

const ENV = { ALLOW_MOCK_SIGNIN: '1' };
const TP = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

async function withFull(fn) {
  const p1 = await startFakePingOne({});
  const gw = await startFakeGateway({ behaviour: 'ok', isDelegated: (t) => p1.issued.delegated.has(t) });
  const real = createReal({ config: realConfig(fullSettingsFor(gw.url), { AAG_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true });
  try { await withServer((url) => fn(url, { p1 }), { env: ENV, real }); } finally { await p1.close(); await gw.close(); }
}

// Reads the whole NDJSON answer: { status, contentType, events }.
async function runStream(url, id, body = {}, headers = {}) {
  const r = await post(url, `/api/run/${encodeURIComponent(id)}`, { ...body, stream: true }, headers);
  const contentType = r.headers.get('content-type') || '';
  const text = await r.text();
  const events = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  return { status: r.status, contentType, events };
}

test('a streamed Real run: one hop line per hop, then the done line; hop lines JSON-equal the done run hops', async () => {
  await withFull(async (url) => {
    assert.equal((await post(url, '/api/signin', { password: DEMO_PASSWORD })).status, 200);
    // The page's switch: PUT /mode live (per workspace). POST /mode {source:"real"} only moves the default workspace.
    const w = await fetch(`${url}/api/mode`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': 'ws1' }, body: JSON.stringify({ mode: 'live' }) });
    assert.equal(w.status, 200);
    assert.equal((await post(url, '/api/signin', { password: DEMO_PASSWORD })).status, 200);
    const { status, contentType, events } = await runStream(url, 'UC1', { vertical: 'banking' }, { 'x-workspace': 'ws1', traceparent: TP });
    assert.equal(status, 200);
    assert.match(contentType, /text\/x-ndjson/);
    const kinds = events.map((e) => e.type);
    assert.equal(kinds[kinds.length - 1], 'done');
    const hops = events.filter((e) => e.type === 'hop').map((e) => e.hop);
    assert.equal(hops.length, 9, 'one hop line per hop of the full chain');
    const done = events.find((e) => e.type === 'done');
    assert.equal(done.run.kind, 'real');
    assert.equal(done.run.outcome, 'REAL_PERMIT');
    assert.deepEqual(hops, done.run.hops, 'every streamed hop is byte-equal the same hop in the finished run');
    assert.deepEqual(hops.map((h) => h.kind), ['sign-in', 'actor-token', 'token-exchange', 'token-exchange', 'gateway-check', 'authorize-decision', 'tool-dispatched', 'api-call', 'agent-reply']);
  });
});

test('a streamed Real run with no sign-in answers ordinary JSON 401 (the stream has not begun)', async () => {
  await withFull(async (url) => {
    assert.equal((await post(url, "/api/mode", { source: "real" })).status, 200);
    const { status, contentType } = await runStream(url, 'UC1', { vertical: 'banking' });
    assert.equal(status, 401);
    assert.match(contentType, /application\/json/);
  });
});

test('a mock run ignores stream: the answer is one JSON document, unchanged', async () => {
  await withFull(async (url) => {
    const r = await post(url, '/api/run/UC1', { vertical: 'banking', stream: true });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /application\/json/);
    const body = await r.json();
    assert.equal(body.run.kind, 'flow');
    assert.equal(body.run.hops.length > 0, true);
  });
});

test('no secret and no password ever reaches a streamed hop line', async () => {
  await withFull(async (url) => {
    assert.equal((await post(url, "/api/mode", { source: "real" })).status, 200);
    assert.equal((await post(url, '/api/signin', { password: DEMO_PASSWORD })).status, 200);
    const { events } = await runStream(url, 'UC1', { vertical: 'banking' });
    const text = JSON.stringify(events);
    for (const s of [DEMO_PASSWORD, USER_CLIENT_SECRET, CLIENT_SECRET]) {
      assert.ok(!text.includes(s), 'a secret is not in the stream');
    }
    assert.ok(text.includes(DEMO_USERNAME), 'the username is not a secret');
  });
});
