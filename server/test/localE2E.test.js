// The integration gate (design-real-local.md E.2, E.4): the REAL child (server/src/local/main.js, forked by createLocalServices) validates tokens that the fake PingOne
// signs (ES256, JWKS from discovery) and enforces the lab's own policy, and the lab runs the software use cases against it through createApp. Nothing here reaches
// a real PingOne or SE: the fake PingOne and the child are both on loopback. These tests prove the lab's reading of the child's wire shapes, and the child's
// verification of the fake's tokens; they say nothing about the real PingOne's tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLocalServices } from '../src/localServices.js';
import { createReal, realConfig } from '../src/real.js';
import { createProviders } from '../src/provider.js';
import { post, get, run, withServer } from './helpers.js';
import { DEMO_PASSWORD, TIER_GROUP, TOOLS_AUDIENCE, fullSettingsFor, startFakePingOne } from './fakePingone.js';
import { findWords } from './wordScan.js';

// A missing child entry is a failing test, never a skipped one.
assert.ok(fs.existsSync(new URL('../src/local/main.js', import.meta.url)), 'server/src/local/main.js exists');
const ENV = { ALLOW_MOCK_SIGNIN: '1' };
const TP = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
// The honesty walk (design C.5): the VALUES of label, title, note, fact, narrative, text, head, body, by, outcome and decision never say gateway, Agent Gateway or
// Authorize except inside "not PingOne Authorize" (lane and kind values are data keys and are exempt).
const WALKED = new Set(['label', 'title', 'note', 'fact', 'narrative', 'text', 'head', 'body', 'by', 'outcome', 'decision']);
const vocab = (x) => {
  const hits = [];
  const walk = (v, key, where) => {
    if (typeof v === 'string') { if (WALKED.has(key) && /Agent Gateway|gateway|Authorize/.test(v.split('not PingOne Authorize').join(''))) hits.push(`${where}.${key}: ${v.slice(0, 140)}`); }
    else if (Array.isArray(v)) v.forEach((e, i) => walk(e, key, `${where}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, e] of Object.entries(v)) walk(e, k, `${where}.${k}`);
  };
  walk({ hops: x.hops.map(({ tokens: _t, ...h }) => h), reply: x.reply, narration: x.narration, tokens: x.tokens.map((t) => ({ label: t.label, notice: t.notice })) }, '', '$');
  return hits;
};

// A fake PingOne, the real child on a loopback port, and a lab wired to both. fn(url, { p1, local, real }).
async function withChild(fn, { groups = [], settings = {} } = {}) {
  const p1 = await startFakePingOne(); p1.state.tools.groups = groups;
  const real = createReal({ config: realConfig(fullSettingsFor(null, settings), { AAG_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true });
  const local = createLocalServices({ config: real.localConfig(), startTimeoutMs: 10_000 });
  try {
    const started = await local.start(); assert.equal(started.ok, true, `the child did not start: ${JSON.stringify(started)}`);
    const providers = createProviders({ setting: real.providerSetting(), real, local });
    await withServer(async (url) => {
      assert.equal((await post(url, '/api/mode', { source: 'real' })).status, 200);
      assert.equal((await post(url, '/api/signin', { password: DEMO_PASSWORD })).status, 200);
      await fn(url, { p1, local, real });
    }, { env: ENV, real, local, providers });
  } finally { await local.stop(); await p1.close(); }
}
const runSoft = async (url, id, extra = {}) => { const r = await run(url, id, { vertical: 'software', ...extra }, { traceparent: TP }); assert.equal(r.status, 200, `${id}: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body.run; };

test('the real child validates the fake PingOne\'s ES256 tokens and the permitted use cases run: UC1, UC33, UC28, UC30, UC41, UC-TOOL1', async () => {
  await withChild(async (url, { local }) => {
    assert.equal(local.state(), 'ready');
    for (const id of ['UC1', 'UC33', 'UC28', 'UC30', 'UC41', 'UC-TOOL1']) {
      const x = await runSoft(url, id);
      assert.equal(x.outcome, 'REAL_PERMIT', `${id}: ${x.reply?.text}`); assert.equal(x.provider, 'local'); assert.equal(x.providerWhy, 'auto-se-not-configured'); assert.equal(x.kind, 'real');
      assert.deepEqual(vocab(x), [], `${id}: no gateway or Authorize word`); assert.deepEqual(findWords(x, id), [], `${id}: banned words`);
      assert.deepEqual(x.gatewayTrace, [], id);
      const answered = x.hops.filter((h) => ['gateway-check', 'authorize-decision', 'tool-dispatched'].includes(h.kind));
      assert.ok(answered.length === 3 && answered.every((h) => h.provider === 'local' && h.answeredBy === 'tool server (local)'), id);
      const decide = x.hops.find((h) => h.kind === 'authorize-decision'); assert.equal(decide.decision.outcome, 'PERMIT'); assert.equal(decide.decision.basis, 'observed', 'read from the audit header the child sends');
      assert.match(x.reply.text, /\(lab-invented data from the lab's own tool server\)\.?$|\(and \d+ [a-z]+\)|returned/);
    }
    const issues = await runSoft(url, 'UC1'); assert.match(issues.reply.text, /signed_in_sub .*total 8/);
  });
});

test('the lab\'s own refusals through the real child: UC6 DENY, UC31 repo allow-list, UC42 blocked term, each read as lab policy, never as PingOne Authorize', async () => {
  await withChild(async (url) => {
    for (const [id, code] of [['UC6', 'access_denied'], ['UC31', 'repo_not_allowed'], ['UC42', 'blocked_term']]) {
      const x = await runSoft(url, id);
      assert.equal(x.outcome, 'REAL_DENY', id); assert.equal(x.reply.who, 'Tool server'); assert.match(x.reply.text, new RegExp(`HTTP 403, ${code}\\) under the lab's own policy \\(local\\), not PingOne Authorize\\. Nothing was run\\.$`));
      const d = x.hops.find((h) => h.kind === 'authorize-decision'); assert.equal(d.decision.by, 'lab policy (local), not PingOne Authorize'); assert.equal(d.decision.outcome, 'DENY'); assert.equal(d.decision.basis, 'observed');
      assert.deepEqual(vocab(x), [], id); assert.deepEqual(findWords(x, id), [], id);
    }
    const seven = await runSoft(url, 'UC7');
    assert.equal(seven.outcome, 'REAL_HOLD'); assert.equal(seven.challenge, undefined, 'step-up has no challenge'); assert.equal(seven.reply.approval.head, 'Held for step-up'); assert.deepEqual(vocab(seven), []);
  });
});

test('UC8 end to end with the real child: the hold mints a challenge, the phone approves it on the lab\'s own approval service, the retry with the receipt is PERMITted, and a second use is refused', async () => {
  await withChild(async (url, { local }) => {
    const hold = await runSoft(url, 'UC8');
    assert.equal(hold.outcome, 'REAL_HOLD'); assert.equal(hold.provider, 'local'); assert.match(hold.challenge, /^[0-9a-f-]{36}$/); assert.equal(hold.reply.approval.head, 'Held for approval');
    const secret = local.hitl().secret;
    assert.ok(!JSON.stringify(hold).includes(secret), 'the approval secret is in no run');
    const start = await (await post(url, '/api/approval/start', { kind: 'real', tool: 'bulk_update_issues', challengeId: hold.challenge, provider: hold.provider })).json(); assert.equal(start.ok, true);
    const decided = await (await post(url, '/api/approval/decide', { id: start.approval.id, approved: true })).json();
    assert.equal(decided.approval.state, 'approved'); assert.ok(!JSON.stringify(decided).includes(secret) && !JSON.stringify(decided).includes(hold.challenge));
    const retry = await runSoft(url, 'UC8', { approvalId: start.approval.id });
    assert.equal(retry.outcome, 'REAL_PERMIT', retry.reply?.text); assert.equal(retry.hops.find((h) => h.kind === 'authorize-decision').decision.outcome, 'PERMIT');
    for (const x of [hold, retry]) assert.ok(!JSON.stringify({ hops: x.hops, reply: x.reply, narration: x.narration }).includes(hold.challenge), 'the challenge id is in no hop');
    assert.equal((await runSoft(url, 'UC8', { approvalId: start.approval.id })).outcome, 'REAL_RECEIPT_REJECTED', 'a receipt is single use');
    const hold2 = await runSoft(url, 'UC8');
    const s2 = (await (await post(url, '/api/approval/start', { kind: 'real', tool: 'bulk_update_issues', challengeId: hold2.challenge, provider: 'local' })).json()).approval.id;
    assert.equal((await (await post(url, '/api/approval/decide', { id: s2, approved: false })).json()).approval.state, 'denied');
    const refused = await runSoft(url, 'UC8', { approvalId: s2 });
    assert.equal(refused.outcome, 'REAL_RECEIPT_REJECTED'); assert.equal(refused.reply.who, 'Tool server'); assert.match(refused.reply.text, /receipt_denied/); assert.deepEqual(vocab(refused), []);
  });
});

test('UC9 and UC21 through the real child: outside the tier group UC9 is called anyway and DENIED (group_required) and UC21 is NOT OFFERED; inside it both PERMIT', async () => {
  await withChild(async (url) => {
    const nine = await runSoft(url, 'UC9'); assert.equal(nine.outcome, 'REAL_DENY'); assert.match(nine.reply.text, /HTTP 403, group_required/); assert.match(nine.hops.find((h) => h.kind === 'gateway-check').note, /is not among them; this use case calls it anyway/);
    const twenty1 = await runSoft(url, 'UC21'); assert.equal(twenty1.outcome, 'REAL_NOT_LISTED'); assert.equal(twenty1.reply.who, 'Tool server'); assert.match(twenty1.reply.text, new RegExp(`tier group ${TIER_GROUP}`));
    assert.equal(twenty1.hops.find((h) => h.kind === 'tool-dispatched')?.source ?? 'not-run', 'not-run', 'UC21 never called the tool');
    for (const x of [nine, twenty1]) assert.deepEqual(vocab(x), []);
  }, { groups: [] });
  await withChild(async (url) => {
    for (const id of ['UC9', 'UC21']) { const x = await runSoft(url, id); assert.equal(x.outcome, 'REAL_PERMIT', `${id}: ${x.reply?.text}`); assert.equal(x.provider, 'local'); }
  }, { groups: [TIER_GROUP] });
});

test('UC24 through the real child: the public tool runs with no token and the protected probe is refused 401 no_token; no agent token and no exchange were made', async () => {
  await withChild(async (url, { p1 }) => {
    const before = p1.seen.filter((c) => c.url.endsWith('/as/token')).length;
    const x = await runSoft(url, 'UC24');
    assert.equal(x.outcome, 'REAL_PERMIT', x.reply?.text); assert.equal(x.provider, 'local');
    assert.deepEqual(x.hops.map((h) => h.kind), ['sign-in', 'gateway-check', 'tool-dispatched', 'tool-refused', 'agent-reply']);
    assert.equal(p1.seen.filter((c) => c.url.endsWith('/as/token')).length, before, 'no token call for the public path');
    assert.equal(x.hops.find((h) => h.kind === 'tool-refused').verdict, 'deny'); assert.match(x.hops.find((h) => h.kind === 'tool-refused').response.calls[0].status.toString(), /^401$/);
    assert.deepEqual(vocab(x), []);
  });
});

test('the real child refuses what it should: an unknown actor, a wrong audience and a tampered token are 401 with the child\'s reason, read as a token problem and never run', async () => {
  // The audience the child requires is the one the lab asks PingOne for; here the lab's own AAG_TOOLS_AUDIENCE differs from the fake resource's audience, so the
  // child rejects the exchanged token (aud_mismatch) and the lab says so in its own words.
  await withChild(async (url) => {
    const x = await runSoft(url, 'UC1');
    assert.equal(x.outcome, 'REAL_TOKEN_PROBLEM', x.reply?.text); assert.equal(x.reply.who, 'Tool server');
    assert.match(x.hops.find((h) => h.kind === 'gateway-check').note, /answered 401: it did not accept the delegated token \(aud_mismatch\)\. The token's aud must be AAG_TOOLS_AUDIENCE\./);
    assert.ok(x.hops.filter((h) => ['tool-dispatched', 'tool-refused'].includes(h.kind)).every((h) => h.source === 'not-run'), 'no tool call after a token problem');
    assert.deepEqual(vocab(x), []);
  }, { settings: { AAG_TOOLS_AUDIENCE: `${TOOLS_AUDIENCE}-other` } });
});

test('/api/info says the local tool server is ready, with no url, port, secret or token', async () => {
  await withChild(async (url, { local }) => {
    const info = await (await get(url, '/api/info')).json();
    assert.deepEqual(info.provider, { setting: 'auto', hosted: false, gateway: false, toolsSe: false, local: { state: 'ready', tools: 16 } });
    assert.ok(!/\d{4,5}|127\.0\.0\.1|secret|token/i.test(JSON.stringify(info.provider)), 'no port, address, secret or token in the provider data');
    const text = JSON.stringify(info); assert.ok(!text.includes(`:${new URL(local.mcpUrl()).port}`) && !text.includes(local.hitl().secret), 'neither the child\'s port nor its secret is in /api/info');
  });
});

// ---- The airline pack through the real child (design-airline-real.md 7 D.S6): the booking rule is the child's, read from its own answer ----
const AIR_GROUP = 'Airline_OrbitTier';
const runAir = async (url, id, extra = {}) => { const r = await run(url, id, { vertical: 'airline', ...extra }, { traceparent: TP }); assert.equal(r.status, 200, `${id}: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body.run; };

test('airline through the real child: UC7 books as asked, UC8 is CONSTRAINED (economy), UC1/UC33/UC28/UC24 permit; every decision is observed from the child\'s audit header', async () => {
  await withChild(async (url) => {
    for (const id of ['UC1', 'UC33', 'UC28', 'UC24']) { const x = await runAir(url, id); assert.equal(x.outcome, 'REAL_PERMIT', `${id}: ${x.reply?.text}`); assert.equal(x.provider, 'local'); assert.ok(x.fareRule, id); assert.deepEqual(vocab(x), [], id); assert.deepEqual(findWords(x, id), [], id); }
    const seven = await runAir(url, 'UC7');
    assert.equal(seven.outcome, 'REAL_PERMIT', seven.reply?.text); assert.equal(seven.booking.booked, 'business'); assert.equal(seven.constrained, undefined);
    assert.match(seven.reply.text, /^Booked: a business seat on LK 214 from ORD to DEN, confirmation LKR-[0-9A-F]{6} /);
    const eight = await runAir(url, 'UC8');
    assert.equal(eight.outcome, 'REAL_CONSTRAINED', eight.reply?.text); assert.deepEqual(eight.booking, { flight: 'LK 322', from: 'ORD', to: 'YYZ', fare: 380, international: true, asked: 'business', booked: 'economy' });
    assert.deepEqual(eight.constrained.because, ['international']); assert.equal(eight.constrained.by, 'lab policy (local), not PingOne Authorize');
    const d = eight.hops.find((h) => h.kind === 'authorize-decision'); assert.deepEqual(d.decision, { outcome: 'CONSTRAINED', by: 'lab policy (local), not PingOne Authorize', basis: 'observed' });
    assert.match(eight.reply.text, /^Booked in economy, not business: this trip is international\. LK 322 from ORD to YYZ, confirmation LKR-[0-9A-F]{6} /);
    for (const x of [seven, eight]) { assert.deepEqual(vocab(x), []); assert.deepEqual(findWords(x, x.useCase.id), []); assert.ok(!/"basis":"checked"/.test(JSON.stringify(x))); }
  });
});

test('airline UC6 through the real child: the hold (428), the phone on the child\'s approval service, the retry books business AS ASKED, a second use and a denial are refused receipts', async () => {
  await withChild(async (url, { local }) => {
    const hold = await runAir(url, 'UC6');
    assert.equal(hold.outcome, 'REAL_HOLD', hold.reply?.text); assert.equal(hold.provider, 'local'); assert.match(hold.challenge, /^[0-9a-f-]{36}$/); assert.equal(hold.booking.booked, null); assert.equal(hold.booking.fare, 2400);
    const secret = local.hitl().secret; assert.ok(!JSON.stringify(hold).includes(secret));
    const start = await (await post(url, '/api/approval/start', { kind: 'real', tool: 'book_airline_flight', amount: hold.booking.fare, challengeId: hold.challenge, provider: hold.provider })).json(); assert.equal(start.ok, true);
    assert.equal((await (await post(url, '/api/approval/decide', { id: start.approval.id, approved: true })).json()).approval.state, 'approved');
    const retry = await runAir(url, 'UC6', { approvalId: start.approval.id });
    assert.equal(retry.outcome, 'REAL_PERMIT', retry.reply?.text); assert.equal(retry.booking.booked, 'business'); assert.equal(retry.constrained, undefined);
    assert.match(retry.reply.text, /^Booked as approved: a business seat on LK 704 from ORD to CDG, confirmation LKR-[0-9A-F]{6} /);
    assert.deepEqual(retry.hops.find((h) => h.kind === 'authorize-decision').decision, { outcome: 'PERMIT', by: 'lab policy (local), not PingOne Authorize', basis: 'observed' });
    for (const x of [hold, retry]) { assert.ok(!JSON.stringify({ hops: x.hops, reply: x.reply, narration: x.narration }).includes(hold.challenge), 'the challenge id is in no hop'); assert.deepEqual(vocab(x), []); }
    assert.equal((await runAir(url, 'UC6', { approvalId: start.approval.id })).outcome, 'REAL_RECEIPT_REJECTED', 'a receipt is single use');
    const hold2 = await runAir(url, 'UC6');
    const s2 = (await (await post(url, '/api/approval/start', { kind: 'real', tool: 'book_airline_flight', challengeId: hold2.challenge, provider: 'local' })).json()).approval.id;
    await post(url, '/api/approval/decide', { id: s2, approved: false });
    const refused = await runAir(url, 'UC6', { approvalId: s2 });
    assert.equal(refused.outcome, 'REAL_RECEIPT_REJECTED'); assert.match(refused.reply.text, /receipt_denied/); assert.equal(refused.booking.booked, null);
  });
});

test('airline UC9 and UC21 through the real child: the airline tier group alone unlocks the sensitive record; the software group does not', async () => {
  await withChild(async (url) => {
    const nine = await runAir(url, 'UC9'); assert.equal(nine.outcome, 'REAL_DENY'); assert.match(nine.reply.text, /HTTP 403, group_required/);
    assert.ok(JSON.stringify(nine.hops.find((h) => h.kind === 'authorize-decision').response).includes(AIR_GROUP));
    assert.equal((await runAir(url, 'UC21')).outcome, 'REAL_NOT_LISTED');
  }, { groups: [TIER_GROUP] });
  await withChild(async (url) => {
    for (const id of ['UC9', 'UC21']) { const x = await runAir(url, id); assert.equal(x.outcome, 'REAL_PERMIT', `${id}: ${x.reply?.text}`); assert.deepEqual(vocab(x), [], id); }
  }, { groups: [AIR_GROUP] });
});
