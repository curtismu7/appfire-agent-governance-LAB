// The approval service in both providers (design-real-local.md C.8): the SE HITL settings now reach the approvals (finding F1: takeLiveSettingsFromEnv deletes them
// from process.env, so reading them there always gave an empty URL), a local approval is recorded with the lab's own service with its secret over a header,
// a failure fails closed, and the SE HITL host is allowed through the netguard (it threw "network blocked" before). Mapping tests: they prove the lab's reading.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApprovals } from '../src/approval.js';
import { createReal, realConfig } from '../src/real.js';
import { installNetguard } from '../src/netguard.js';
import { fullSettingsFor } from './fakePingone.js';
import { HITL_SECRET } from './fakeToolServer.js';

// A fake HITL service: records every request and answers as `answer` says.
async function fakeHitl(answer = { status: 200, body: (id, d) => ({ id, status: d.decision, decision: d.decision }) }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const id = /challenges\/([^/]+)\/respond/.exec(req.url)?.[1];
      res.writeHead(answer.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer.body(id, body ?? {})));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, url: `http://127.0.0.1:${server.address().port}/hitl`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
const CH = '6f1c9a52-0b7e-4d0e-9f1e-7c3f5a2d8b10';

test('F1: the SE HITL url and secret come from the Real settings (liveSettingsFor), not process.env; real.hitl() carries them and nothing else leaks', () => {
  const none = createReal({ config: realConfig(fullSettingsFor('https://gw.lab-test.net/mcp'), {}), wanted: true });
  assert.equal(none.hitl(), null);
  const real = createReal({ config: realConfig(fullSettingsFor('https://gw.lab-test.net/mcp', { AAG_HITL_SERVICE_URL: 'https://hitl.lab-test.net', AAG_HITL_INTERNAL_SECRET: HITL_SECRET }), {}), wanted: true });
  assert.deepEqual(real.hitl(), { url: 'https://hitl.lab-test.net/', secret: HITL_SECRET });
  assert.ok(!JSON.stringify(real.origins()).includes(HITL_SECRET) && !JSON.stringify(real.hosts()).includes(HITL_SECRET));
  assert.ok(real.hosts().includes('hitl.lab-test.net'), 'its host is allowed through the netguard');
  // A bad url is dropped (never reaches the guard) and its secret is not offered anywhere.
  const bad = createReal({ config: realConfig(fullSettingsFor(null, { AAG_HITL_SERVICE_URL: 'http://evil.lab-test.net', AAG_HITL_INTERNAL_SECRET: HITL_SECRET }), {}), wanted: true });
  assert.equal(bad.hitl(), null); assert.match(bad.hitlProblem(), /AAG_HITL_SERVICE_URL/); assert.ok(!bad.hosts().includes('evil.lab-test.net'));
});

test('a LOCAL approval is recorded with the lab\'s own service: POST /challenges/:id/respond with the secret header, the fixed body, and the receipt is the challenge id', async () => {
  const hitl = await fakeHitl();
  try {
    const approvals = createApprovals({ hitl: (p) => (p === 'local' ? { url: hitl.url, secret: HITL_SECRET } : null) });
    const s = approvals.start({ workspace: 'w1', kind: 'real', tool: 'bulk_update_issues', amount: 300, challengeId: CH, provider: 'local' });
    assert.equal(s.state, 'pending'); assert.equal(JSON.stringify(s).includes(CH), false, 'the challenge id never leaves the server');
    const d = await approvals.decide('w1', s.id, true);
    assert.equal(d.state, 'approved'); assert.equal(approvals.receiptOf('w1', s.id), CH);
    assert.equal(hitl.seen.length, 1); const r = hitl.seen[0];
    assert.deepEqual([r.method, r.url], ['POST', `/hitl/challenges/${CH}/respond`]); assert.equal(r.headers['x-hitl-internal-secret'], HITL_SECRET);
    assert.deepEqual(r.body, { decision: 'approved', respondedBy: 'appfire-agent-governance-lab phone' });
    assert.ok(!JSON.stringify(d).includes(HITL_SECRET), 'the secret is never in an answer');
    const s2 = approvals.start({ workspace: 'w1', kind: 'real', tool: 'bulk_update_issues', challengeId: CH, provider: 'local' });
    const denied = await approvals.decide('w1', s2.id, false); assert.equal(denied.state, 'denied'); assert.equal(hitl.seen.at(-1).body.decision, 'denied');
  } finally { await hitl.close(); }
});

test('an approval with no provider named is the SE service; a provider with no service is not configured and fails closed', async () => {
  const hitl = await fakeHitl();
  try {
    const asked = [];
    const approvals = createApprovals({ hitl: (p) => { asked.push(p); return p === 'se' ? { url: hitl.url, secret: HITL_SECRET } : null; } });
    const se = approvals.start({ workspace: 'w1', kind: 'real', tool: 't', challengeId: CH });
    assert.equal((await approvals.decide('w1', se.id, true)).state, 'approved'); assert.deepEqual(asked, ['se']);
    const local = approvals.start({ workspace: 'w1', kind: 'real', tool: 't', challengeId: CH, provider: 'local' });
    const d = await approvals.decide('w1', local.id, true);
    assert.equal(d.state, 'expired'); assert.equal(d.error, 'the HITL service is not configured'); assert.equal(approvals.receiptOf('w1', local.id), undefined, 'no receipt without a recorded approval');
    const odd = approvals.start({ workspace: 'w1', kind: 'real', tool: 't', challengeId: CH, provider: 'nowhere' }); await approvals.decide('w1', odd.id, true);
    assert.ok(asked.every((p) => p === 'se' || p === 'local'), 'an unknown provider is the SE service, never a name the caller made up');
  } finally { await hitl.close(); }
});

test('fail closed: a non-2xx, a refused decision, an unreadable answer and no answer at all are never an approval, and no receipt is made', async () => {
  for (const [name, answer] of [
    ['500', { status: 500, body: () => ({ error: 'boom' }) }],
    ['401', { status: 401, body: () => ({ error: 'unauthorized' }) }],
    ['409', { status: 409, body: () => ({ error: 'already_answered', status: 'approved' }) }],
    ['410', { status: 410, body: () => ({ error: 'expired' }) }],
    ['200 with no decision', { status: 200, body: () => ({}) }],
  ]) {
    const hitl = await fakeHitl(answer);
    try {
      const approvals = createApprovals({ hitl: () => ({ url: hitl.url, secret: HITL_SECRET }) });
      const s = approvals.start({ workspace: 'w', kind: 'real', tool: 't', challengeId: CH, provider: 'local' });
      const d = await approvals.decide('w', s.id, true);
      assert.notEqual(d.state, 'approved', name); assert.equal(d.state, 'expired', name); assert.ok(!JSON.stringify(d).includes(HITL_SECRET), name);
      if (!/^200/.test(name)) assert.equal(approvals.receiptOf('w', s.id), undefined, `${name}: no receipt after a failed record`);
    } finally { await hitl.close(); }
  }
  const dead = createApprovals({ hitl: () => ({ url: 'http://127.0.0.1:1/hitl', secret: HITL_SECRET }) });
  const s = dead.start({ workspace: 'w', kind: 'real', tool: 't', challengeId: CH, provider: 'local' });
  const d = await dead.decide('w', s.id, true);
  assert.equal(d.state, 'expired'); assert.match(d.error, /did not answer; the approval was not recorded \(fail closed\)/); assert.ok(!JSON.stringify(d).includes(HITL_SECRET)); assert.equal(dead.receiptOf('w', s.id), undefined);
});

test('a redirect from the HITL service is never followed (a secret must not travel to another place)', async () => {
  const seen = [];
  const server = http.createServer((req, res) => { seen.push(req.url); res.writeHead(307, { location: 'http://127.0.0.1:1/elsewhere' }); res.end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const approvals = createApprovals({ hitl: () => ({ url: `http://127.0.0.1:${server.address().port}/hitl`, secret: HITL_SECRET }) });
    const s = approvals.start({ workspace: 'w', kind: 'real', tool: 't', challengeId: CH, provider: 'local' });
    assert.equal((await approvals.decide('w', s.id, true)).state, 'expired'); assert.equal(seen.length, 1);
  } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
});

test('the SE HITL host is allowed through the netguard (what index.js does with real.hosts()), and before that the guard refuses it and records the attempt', async () => {
  const guard = installNetguard();
  try {
    const real = createReal({ config: realConfig(fullSettingsFor(null, { AAG_HITL_SERVICE_URL: 'https://hitl.lab-test.net', AAG_HITL_INTERNAL_SECRET: HITL_SECRET }), {}), wanted: true });
    const approvals = createApprovals({ hitl: () => real.hitl() });
    // Not allowed yet: the approvals' own fetch is refused by the guard before any socket opens (the "network blocked" the SE phone loop used to hit).
    const s = approvals.start({ workspace: 'g', kind: 'real', tool: 't', challengeId: CH });
    const d = await approvals.decide('g', s.id, true);
    assert.equal(d.state, 'expired'); assert.deepEqual(guard.attempts, ['fetch:hitl.lab-test.net'], 'refused and recorded'); assert.ok(!guard.isPermitted('hitl.lab-test.net'));
    // index.js allows the non-loopback hosts real.hosts() names; the HITL host is among them, and nothing else widens.
    for (const h of real.hosts().filter((x) => x !== 'auth.pingone.com')) guard.allowHost(h);
    assert.deepEqual(guard.allowedHosts(), ['hitl.lab-test.net']); assert.ok(guard.isPermitted('hitl.lab-test.net')); assert.ok(!guard.isPermitted('other.lab-test.net'), 'an exact name, not a pattern');
  } finally { guard.restore(); }
});
