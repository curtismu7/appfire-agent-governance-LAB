// PingOne Authorize decides the airline booking, end to end (design-authorize-lab.md D, E.1): the lab (createApp) with the REAL forked tool server, the real parent module
// (authorize.js) and the fake PingOne's decision endpoint. These prove the lab's own reading, the labels in the DATA and the secrecy; they say nothing about the real tenant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createLocalServices } from '../src/localServices.js';
import { createReal, realConfig, replyText } from '../src/real.js';
import { createProviders } from '../src/provider.js';
import { createAuthorize, CODES, POLICY_NAME, readDecision, REASON_WORDS } from '../src/authorize.js';
import { decide as toolDecide } from '../src/local/policy.js';
import { createHitl } from '../src/local/hitl.js';
import { FLIGHTS, isInternational } from '../src/local/data.js';
import { post, run, withServer } from './helpers.js';
import { AUTHORIZE_CLIENT_ID, AUTHORIZE_CLIENT_SECRET, AUTHORIZE_ENDPOINT_ID, DEMO_PASSWORD, authorizeSettings, fullSettingsFor, startFakePingOne } from './fakePingone.js';
import { startFakeToolServer, stubLocal } from './fakeToolServer.js';
import { findWords } from './wordScan.js';

const ENV = { ALLOW_MOCK_SIGNIN: '1' };
const TP = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const BY = `PingOne Authorize (policy ${POLICY_NAME})`;
const LAB_BY = 'lab policy (local), not PingOne Authorize';
const FAST = { headersMs: 250, bodyMs: 250, totalMs: 6000, paceMs: 0, retry429Ms: 20 };

// A forkImpl that forks the real child but records every message in both directions (the IPC recorder).
const recordingFork = (log) => (modulePath, args, options) => {
  const c = fork(modulePath, args, options);
  const send = c.send.bind(c);
  c.send = (m, ...rest) => { log.push({ dir: 'to-child', m }); return send(m, ...rest); };
  c.on('message', (m) => log.push({ dir: 'from-child', m }));
  return c;
};

// A fake PingOne (with the decision endpoint), the real child, the real parent module and a lab wired to all three.
async function withAuthorize(fn, { settings = authorizeSettings(), extraSettings = {}, limits = FAST, withAz = true } = {}) {
  const p1 = await startFakePingOne({ authorize: true });
  const cfg = realConfig(fullSettingsFor(null, { ...settings, ...extraSettings }), { AAG_LIVE_TEST_BASE: p1.base });
  const authorize = withAz && cfg.authorize ? createAuthorize({ config: cfg.authorize, limits }) : null;
  const real = createReal({ config: cfg, missing: [], wanted: true, authorize });
  const ipc = [];
  const local = createLocalServices({ config: real.localConfig(), startTimeoutMs: 10_000, authorize, forkImpl: recordingFork(ipc) });
  try {
    const started = await local.start(); assert.equal(started.ok, true, `the child did not start: ${JSON.stringify(started)}`);
    const providers = createProviders({ setting: real.providerSetting(), real, local });
    await withServer(async (url) => {
      assert.equal((await post(url, '/api/mode', { source: 'real' })).status, 200);
      assert.equal((await post(url, '/api/signin', { password: DEMO_PASSWORD })).status, 200);
      await fn(url, { p1, fake: p1.authorize, real, local, ipc, cfg, providers, authorize });
    }, { env: ENV, real, local, providers });
  } finally { await local.stop(); await p1.close(); }
}
const runAir = async (url, id, extra = {}) => { const r = await run(url, id, { vertical: 'airline', ...extra }, { traceparent: TP }); assert.equal(r.status, 200, `${id}: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body.run; };
const decisionHop = (x) => x.hops.find((h) => h.kind === 'authorize-decision');
const bearerOf = (p1) => /^Bearer (.+)$/.exec(p1.seen.find((c) => c.url.includes('/decisionEndpoints/')).headers.authorization)[1];

// What no run may ever hold: the worker secret, the worker token, and the client id of the worker app in a request header.
function noAzSecrets(x, p1, what) {
  const text = JSON.stringify(x);
  assert.ok(!text.includes(AUTHORIZE_CLIENT_SECRET), `${what}: the worker secret is in the run`);
  assert.ok(!text.includes(Buffer.from(`${AUTHORIZE_CLIENT_ID}:${AUTHORIZE_CLIENT_SECRET}`).toString('base64')), `${what}: the Basic form of the worker secret is in the run`);
  if (p1.seen.some((c) => c.url.includes('/decisionEndpoints/'))) assert.ok(!text.includes(bearerOf(p1)), `${what}: the worker token is in the run`);
  assert.ok(!text.includes(AUTHORIZE_CLIENT_ID), `${what}: the worker client id is in the run`);
}
// The words (design D.6): the word Authorize may appear only where Authorize decided (or gave no decision); a lab-policy run says it only inside "not PingOne Authorize".
const WALKED = new Set(['label', 'title', 'note', 'fact', 'narrative', 'text', 'head', 'body', 'by', 'outcome', 'decision', 'reason', 'line']);
const AZ_PHRASES = /PingOne Authorize (gave no decision|answered|decided|\(policy|\(P1AZ\)|returned)/;
const authorizeWords = (x) => {
  const hits = [];
  const walk = (v, key, where, inDecisionHop) => {
    if (typeof v === 'string') { if (WALKED.has(key) && /Authorize/.test(v.split('not PingOne Authorize').join(''))) hits.push({ where, v, inDecisionHop }); }
    else if (Array.isArray(v)) v.forEach((e, i) => walk(e, key, `${where}[${i}]`, inDecisionHop));
    else if (v && typeof v === 'object') for (const [k, e] of Object.entries(v)) { if (k === 'request' || k === 'response' || k === 'raw' || k === 'claims') continue; walk(e, k, `${where}.${k}`, inDecisionHop); }
  };
  x.hops.forEach((h, i) => walk({ ...h, tokens: undefined }, '', `hop${i + 1}`, h.kind === 'authorize-decision'));
  walk({ reply: x.reply, narration: x.narration, constrained: x.constrained }, '', 'run', false);
  return hits;
};

test('Denver, Authorize on: PingOne Authorize answered permit; the data says who decided, the decision hop draws on the Authorize lane, the raw request and answer are in the step detail', async () => {
  await withAuthorize(async (url, { p1, fake }) => {
    const x = await runAir(url, 'UC7');
    assert.equal(x.outcome, 'REAL_PERMIT'); assert.equal(x.provider, 'local');
    assert.equal(x.decidedBy, 'pingone-authorize'); assert.deepEqual(x.authorize, { configured: true, asked: true, answered: true, code: 'airline-permit-as-asked', reason: null });
    assert.deepEqual(x.booking, { flight: 'LK 214', from: 'ORD', to: 'DEN', fare: 380, international: false, asked: 'business', booked: 'business' });
    const d = decisionHop(x);
    assert.deepEqual([d.from, d.to, d.title, d.fact, d.decidedBy, d.source, d.verdict], ['toolserver', 'authorize', 'PingOne Authorize (P1AZ)', 'PingOne Authorize decided', 'pingone-authorize', 'real', 'ok']);
    assert.equal(d.label, 'PingOne Authorize decision: PERMIT (airline-permit-as-asked), asked by the tool server (local) and read from its answer to tools/call');
    assert.deepEqual(d.decision, { outcome: 'PERMIT', by: BY, basis: 'observed', line: `${BY} returned PERMIT with the statement airline-permit-as-asked; the lab read that as book as asked and applied it` });
    assert.deepEqual(Object.keys(d.authorize).sort(), ['code', 'correlationId', 'elapsedMs', 'outcome', 'said']);
    assert.deepEqual([d.authorize.code, d.authorize.outcome], ['airline-permit-as-asked', 'PERMIT']); assert.match(d.authorize.correlationId, /^[0-9a-f-]{36}$/); assert.ok(Number.isInteger(d.authorize.elapsedMs));
    assert.equal(d.note, "PingOne Authorize returned PERMIT with the statement airline-permit-as-asked. The tool server (local) ran the tool as asked. Read from the tool server's audit header (source pingone-authorize); the lab sees the statement code, not the rule that produced it.");
    assert.deepEqual([d.provider, d.answeredBy], ['local', 'tool server (local)']);
    // the raw request: the seven parameters, the bearer line that hides the worker token, no shared attribute
    assert.equal(d.request.method, 'POST'); assert.equal(d.request.url, `${new URL(p1.base).origin}/v1/environments/${new URL(p1.base).pathname.slice(1)}/decisionEndpoints/${AUTHORIZE_ENDPOINT_ID}`);
    assert.equal(d.request.headers.authorization, 'Bearer (worker token, not shown)');
    assert.deepEqual(d.request.body, { parameters: { AirLabMarker: 'larkspur-air', ToolName: 'book_airline_flight', UserId: x.tokens[3].claims.sub, AirFare: '380', AirIsInternational: 'false', AirCabinAsked: 'business', AirApproval: 'none' } });
    assert.ok(!/Amount|DecisionContext|ActClientId/.test(JSON.stringify(d.request)));
    // the raw answer, as it came, plus what the tool server said to the lab
    assert.equal(d.response.status, 200); assert.equal(d.response.body.decision, 'PERMIT'); assert.ok(d.response.body.statements.some((s) => s.code === 'airline-permit-as-asked')); assert.ok(d.response.body.statements.some((s) => s.code === 'transaction-approved'), 'foreign codes are shown, not hidden');
    assert.equal(d.response.tool_call.status, 200); assert.equal(d.response.tool_call['x-gw-audit-trail'].source, 'pingone-authorize');
    assert.equal(fake.seen.length, 1, 'exactly one decision call'); assert.equal(fake.seen[0].parameters.UserId, d.request.body.parameters.UserId);
    // the other hops are not credited to Authorize
    for (const h of x.hops.filter((hop) => hop.kind !== 'authorize-decision')) assert.ok(h.decidedBy === undefined, h.kind);
    assert.equal(x.hops.find((h) => h.kind === 'tool-dispatched').note, 'The tool server ran the tool. The data is lab-invented.');
    noAzSecrets(x, p1, 'Denver'); assert.deepEqual(findWords(x, 'Denver'), []); assert.deepEqual(x.gatewayTrace, []);
    assert.ok(!/"basis":"checked"/.test(JSON.stringify(x)));
    for (const h of authorizeWords(x)) assert.ok(h.inDecisionHop || AZ_PHRASES.test(h.v), `Authorize outside where it decided: ${h.where}: ${h.v}`);
    assert.ok(!/\bUC\d/.test(JSON.stringify({ hops: x.hops.map((h) => [h.label, h.note, h.title]), reply: x.reply })));
  });
});

test('Toronto, Authorize on: CONSTRAINED (economy booked), the statement code names the narrowing, the card line says the lab applied it', async () => {
  await withAuthorize(async (url, { p1 }) => {
    const x = await runAir(url, 'UC8');
    assert.equal(x.outcome, 'REAL_CONSTRAINED'); assert.equal(x.decidedBy, 'pingone-authorize'); assert.equal(x.authorize.code, 'airline-economy-intl');
    assert.deepEqual(x.constrained, { field: 'cabin', asked: 'business', granted: 'economy', because: ['international'], limit: 400, by: BY, reason: 'PingOne Authorize returned PERMIT with the statement airline-economy-intl; the lab read that as economy only, and the tool server applied it: this trip is international' });
    const d = decisionHop(x);
    assert.equal(d.decision.line, `${BY} returned PERMIT with the statement airline-economy-intl; the lab read that as economy only and applied it`); assert.equal(d.decision.outcome, 'PERMIT', 'what PingOne Authorize returned, not the lab word'); assert.equal(d.authorize.outcome, 'CONSTRAINED', 'the lab\'s own reading'); assert.equal(d.authorize.said, 'PERMIT');
    assert.match(d.note, /^PingOne Authorize returned PERMIT with the statement airline-economy-intl, which this lab reads as economy only\. The tool server \(local\) applied it: the cabin was narrowed from business to economy\./);
    assert.match(x.reply.text, /^Booked in economy, not business: this trip is international\. LK 322 from ORD to YYZ, confirmation LKR-[0-9A-F]{6}\.$/);
    assert.equal(x.booking.booked, 'economy'); noAzSecrets(x, p1, 'Toronto');
    for (const h of authorizeWords(x)) assert.ok(h.inDecisionHop || AZ_PHRASES.test(h.v), `${h.where}: ${h.v}`);
  });
});

test('Paris, Authorize on: held for a person (428), the phone approves on the lab\'s own approval service, the retry carries the receipt, Authorize answers approved and the booking is as asked; the fake saw none then verified', async () => {
  await withAuthorize(async (url, { p1, fake }) => {
    const hold = await runAir(url, 'UC6');
    assert.equal(hold.outcome, 'REAL_HOLD'); assert.equal(hold.decidedBy, 'pingone-authorize'); assert.equal(hold.authorize.code, 'airline-approval-required'); assert.match(hold.challenge, /^[0-9a-f-]{36}$/);
    assert.equal(hold.reply.approval.head, 'Held for approval');
    assert.equal(hold.reply.approval.body, "The tool server answered 428: PingOne Authorize returned a statement the lab reads as: a person must approve this booking. Approve (or deny) on the phone: the answer is recorded with the lab's own approval service and the call is retried with the receipt.");
    const d = decisionHop(hold); assert.equal(d.verdict, 'held'); assert.deepEqual([d.decision.outcome, d.decision.basis, d.authorize.outcome], ['PERMIT', 'observed', 'HITL_REQUIRED']); assert.equal(d.decision.line, `${BY} returned PERMIT with the statement airline-approval-required; the lab read that as hold for a person to approve and applied it`); assert.match(d.note, /^PingOne Authorize returned PERMIT with the statement airline-approval-required, which this lab reads as: a person must approve this booking\. The approval itself runs on the lab's own approval service\./);
    assert.ok(!JSON.stringify({ hops: hold.hops, reply: hold.reply }).includes(hold.challenge), 'the challenge id is in no hop');
    const start = await (await post(url, '/api/approval/start', { kind: 'real', tool: 'book_airline_flight', amount: hold.booking.fare, challengeId: hold.challenge, provider: hold.provider })).json();
    assert.equal(start.ok, true); const id = start.approval.id;
    assert.equal((await (await post(url, '/api/approval/decide', { id, approved: true })).json()).approval.state, 'approved');
    const retry = await runAir(url, 'UC6', { approvalId: id });
    assert.equal(retry.outcome, 'REAL_PERMIT', retry.reply?.text); assert.equal(retry.decidedBy, 'pingone-authorize'); assert.equal(retry.authorize.code, 'airline-approved-as-asked'); assert.equal(retry.constrained, undefined);
    assert.equal(retry.booking.booked, 'business'); assert.match(retry.reply.text, /^Booked as approved: a business seat on LK 704/);
    assert.equal(decisionHop(retry).decision.line, `${BY} returned PERMIT with the statement airline-approved-as-asked; the lab read that as book as approved and applied it`);
    assert.match(decisionHop(retry).note, /^PingOne Authorize returned PERMIT with the statement airline-approved-as-asked, which this lab reads as: approved, once the lab's approval service vouched for the receipt\. The approval was given on the lab's own approval service\./);
    assert.deepEqual(fake.seen.map((s) => s.parameters.AirApproval), ['none', 'verified'], 'Authorize saw none, then verified');
    assert.ok(!JSON.stringify({ hops: retry.hops, reply: retry.reply }).includes(hold.challenge), 'the receipt is in no hop');
    // spent once: the same approval a second time is refused as a receipt, and Authorize is asked with none
    const again = await runAir(url, 'UC6', { approvalId: id });
    assert.equal(again.outcome, 'REAL_RECEIPT_REJECTED'); assert.equal(again.decidedBy, 'lab-policy-local'); assert.deepEqual([again.authorize.asked, again.authorize.answered], [true, false], 'Authorize WAS asked (the booking ended after the call), and did not decide the refusal'); assert.equal(again.booking.booked, null);
    noAzSecrets(hold, p1, 'hold'); noAzSecrets(retry, p1, 'retry');
  });
});

test('NO DECISION: a hung endpoint and an answer with only the catch-all both end in REAL_NO_DECISION; nothing is booked, the lab\'s own rule is not used in its place, and the page says why', async () => {
  await withAuthorize(async (url, { p1, fake }) => {
    for (const [mode, reason] of [['timeout', 'timeout'], ['only-unmatched', 'only_unmatched'], ['5xx', 'server_error'], ['two-specific-codes', 'ambiguous'], ['forbidden', 'refused_credential']]) {
      fake.release(); fake.setMode(mode);
      const x = await runAir(url, 'UC7');
      assert.equal(x.outcome, 'REAL_NO_DECISION', mode); assert.equal(x.decidedBy, 'none', mode); assert.deepEqual(x.authorize, { configured: true, asked: true, answered: false, code: null, reason }, mode);
      assert.equal(x.booking.booked, null, `${mode}: nothing was booked`); assert.equal(x.constrained, undefined);
      assert.equal(x.reply.text, `PingOne Authorize gave no decision (${REASON_WORDS[reason]}). Nothing was booked, and the lab did not use its own rule instead.`, mode);
      const d = decisionHop(x);
      assert.deepEqual([d.from, d.to, d.verdict, d.decidedBy], ['toolserver', 'toolserver', 'error', 'none'], `${mode}: a note on the tool server lane, never the Authorize lane`);
      assert.deepEqual(d.decision, { outcome: 'NO DECISION', by: `PingOne Authorize gave no decision: ${REASON_WORDS[reason]}`, basis: 'inferred' }, mode);
      assert.equal(d.label, "PingOne Authorize gave no decision, read from the tool server's answer to tools/call");
      assert.equal(d.note, `PingOne Authorize gave no decision: ${REASON_WORDS[reason]}. The tool server (local) booked nothing and did not use its own rule instead.`);
      assert.equal(d.fact, 'no decision'); assert.ok(!/ALLOWED|DENIED|ESCALATED/.test(JSON.stringify({ reply: x.reply, hop: d.decision })));
      assert.ok(!x.hops.some((h) => h.kind === 'tool-dispatched' && h.source === 'real'), `${mode}: the tool never ran`); assert.ok(x.hops.filter((h) => h.n > decisionHop(x).n).every((h) => h.source === 'not-run' || h.kind === 'agent-reply' || h.kind === 'tool-refused'), mode);
      assert.deepEqual(findWords(x, mode), []); noAzSecrets(x, p1, mode);
      for (const h of authorizeWords(x)) assert.ok(h.inDecisionHop || AZ_PHRASES.test(h.v), `${mode}: ${h.where}: ${h.v}`);
    }
    // the endpoint back: the same booking is decided again, nothing was remembered
    fake.release(); fake.setMode('ok');
    const back = await runAir(url, 'UC7'); assert.equal(back.outcome, 'REAL_PERMIT'); assert.equal(back.decidedBy, 'pingone-authorize');
  });
});

test('Authorize settings absent or partial: the lab\'s own rule answers and says so, exactly as before; the tool server is never told to ask', async () => {
  for (const settings of [{}, { AAG_AUTHORIZE_ENDPOINT_ID: authorizeSettings().AAG_AUTHORIZE_ENDPOINT_ID }, { AAG_AUTHORIZE_CLIENT_ID: AUTHORIZE_CLIENT_ID, AAG_AUTHORIZE_CLIENT_SECRET: AUTHORIZE_CLIENT_SECRET }]) {
    await withAuthorize(async (url, { fake, ipc, real, cfg }) => {
      assert.equal(cfg.authorize, null); assert.equal(real.authorizeOn(), false);
      if (Object.keys(settings).length) assert.match(cfg.authorizeProblem, /^the app \.env sets some of AAG_AUTHORIZE_ENDPOINT_ID, AAG_AUTHORIZE_CLIENT_ID, AAG_AUTHORIZE_CLIENT_SECRET but not /);
      const x = await runAir(url, 'UC8');
      assert.equal(x.outcome, 'REAL_CONSTRAINED'); assert.equal(x.decidedBy, 'lab-policy-local'); assert.equal(x.authorize, undefined);
      assert.deepEqual(decisionHop(x).decision, { outcome: 'CONSTRAINED', by: Object.keys(settings).length ? `${LAB_BY}: the PingOne Authorize settings are incomplete, so it was not asked` : LAB_BY, basis: 'observed' }); assert.equal(decisionHop(x).to, 'toolserver'); assert.equal(decisionHop(x).authorize, undefined); assert.equal(decisionHop(x).decidedBy, 'lab-policy-local');
      assert.equal(x.constrained.by, LAB_BY); assert.equal(fake.seen.length, 0, 'Authorize was never asked'); assert.equal(ipc.filter((e) => e.m?.type === 'authorize').length, 0);
      assert.equal(ipc.find((e) => e.m?.type === 'init').m.config.authorize, false);
      assert.deepEqual(authorizeWords(x).filter((h) => h.v.includes('Authorize') && !/^lab policy \(local\), not PingOne Authorize(: the PingOne Authorize settings are incomplete, so it was not asked)?$/.test(h.v)), [], 'the word Authorize appears only inside "not PingOne Authorize" (and, for partial settings, the incomplete-settings clause)');
      assert.ok(!JSON.stringify(x).includes('PingOne Authorize decided'));
    }, { settings });
  }
});

test('a booking that is refused BEFORE the decision (an unknown flight, a missing scope) is the lab\'s own refusal: Authorize is not asked and not credited; a software run on the same lab keeps lab-policy-local', async () => {
  await withAuthorize(async (url, { fake }) => {
    const soft = await run(url, 'UC1', { vertical: 'software' }, { traceparent: TP }); const s = soft.body.run;
    assert.equal(s.outcome, 'REAL_PERMIT'); assert.equal(s.decidedBy, 'lab-policy-local'); assert.equal(s.authorize, undefined); assert.equal(decisionHop(s).decision.by, LAB_BY);
    const nine = await runAir(url, 'UC9');
    assert.equal(nine.decidedBy, 'lab-policy-local'); assert.equal(nine.authorize, undefined, 'only a booking run carries the field');
    assert.equal(fake.seen.length, 0, 'no other tool asks Authorize');
    for (const x of [s, nine]) assert.deepEqual(authorizeWords(x).filter((h) => h.v.includes('Authorize')), []);
  });
});

test('an SE-hosted tool server that CLAIMS pingone-authorize is never credited; a local tool server on a lab with no Authorize settings that claims it is not credited either', async () => {
  for (const [label, settings, withSe] of [['SE-hosted, settings on', { ...authorizeSettings(), AAG_PROVIDER: 'se' }, true], ['local, settings off', {}, false]]) {
    const p1 = await startFakePingOne({ authorize: true });
    const ts = await startFakeToolServer({ isDelegated: (t) => p1.issued.delegated.has(t), auditSource: 'pingone-authorize', auditRule: 'airline-economy-intl' });
    const cfg = realConfig(fullSettingsFor(null, { ...settings, ...(withSe ? { AAG_TOOLS_SE_URL: ts.url } : {}) }), { AAG_LIVE_TEST_BASE: p1.base });
    const authorize = cfg.authorize ? createAuthorize({ config: cfg.authorize, limits: FAST }) : null;
    const real = createReal({ config: cfg, missing: [], wanted: true, authorize });
    try {
      await withServer(async (url) => {
        assert.equal((await post(url, '/api/mode', { source: 'real' })).status, 200); assert.equal((await post(url, '/api/signin', { password: DEMO_PASSWORD })).status, 200);
        const x = await runAir(url, 'UC8');
        assert.equal(x.outcome, 'REAL_CONSTRAINED', label); assert.equal(x.provider, withSe ? 'se' : 'local', label);
        assert.equal(x.decidedBy, withSe ? 'tool-server-se' : 'lab-policy-local', label); assert.equal(x.authorize?.answered ?? false, false, label);
        const d = decisionHop(x); assert.equal(d.to, 'toolserver', 'never drawn on the Authorize lane'); assert.equal(d.decision.line, undefined); assert.equal(d.authorize, undefined);
        assert.ok(!/PingOne Authorize decided|returned CONSTRAINED/.test(JSON.stringify(x)), label); assert.equal(p1.authorize.seen.length, 0);
        assert.equal(x.constrained.by, withSe ? `the tool server (SE); the lab cannot see which policy it applied` : LAB_BY, label);
      }, { env: ENV, real, local: withSe ? undefined : stubLocal(ts) });
    } finally { await p1.close(); await ts.close(); }
  }
});

test('secrets: the worker secret, the worker token and the client id are in no run, no IPC message in either direction and nothing the lab logs; the child gets only the boolean', async () => {
  const logged = []; const keep = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(keep)) console[k] = (...a) => { logged.push(a.map(String).join(' ')); };
  try {
    await withAuthorize(async (url, { p1, ipc, fake }) => {
      const runs = [await runAir(url, 'UC7'), await runAir(url, 'UC8'), await runAir(url, 'UC6')];
      fake.setMode('only-unmatched'); runs.push(await runAir(url, 'UC7')); fake.setMode('forbidden'); runs.push(await runAir(url, 'UC7'));
      const bearer = bearerOf(p1);
      for (const x of runs) noAzSecrets(x, p1, x.outcome);
      assert.ok(ipc.some((e) => e.m?.type === 'authorize') && ipc.some((e) => e.m?.type === 'authorize-result'), 'the recorder saw the questions and the answers');
      const everything = JSON.stringify(ipc) + logged.join('\n');
      for (const secret of [AUTHORIZE_CLIENT_SECRET, bearer, AUTHORIZE_CLIENT_ID, AUTHORIZE_ENDPOINT_ID]) assert.ok(!everything.includes(secret), 'a secret or an endpoint id crossed IPC or was logged');
      assert.ok(!/api\.pingone|decisionEndpoints|https?:\/\//.test(JSON.stringify(ipc.filter((e) => e.m?.type?.startsWith('authorize')))), 'no URL crosses the channel');
      const init = ipc.find((e) => e.m?.type === 'init').m.config; assert.equal(init.authorize, true); assert.ok(!Object.keys(init).some((k) => /secret|url|endpoint|client|token/i.test(k.replace('hitlSecret', ''))), Object.keys(init).join());
      for (const e of ipc.filter((x) => x.m?.type === 'authorize')) assert.deepEqual(Object.keys(e.m.params), ['AirLabMarker', 'ToolName', 'UserId', 'AirFare', 'AirIsInternational', 'AirCabinAsked', 'AirApproval']);
      for (const e of ipc.filter((x) => x.m?.type === 'authorize-result')) assert.deepEqual(Object.keys(e.m).sort(), ['code', 'correlationId', 'elapsedMs', 'id', 'outcome', 'reason', 'type']);
    });
  } finally { Object.assign(console, keep); }
});

test('the netguard\'s hosts: the API host is added exactly when all three settings are set; nothing else changes', () => {
  const on = createReal({ config: realConfig(fullSettingsFor(null, authorizeSettings()), {}), missing: [], wanted: true });
  const off = createReal({ config: realConfig(fullSettingsFor(null, {}), {}), missing: [], wanted: true });
  assert.deepEqual(on.hosts().sort(), ['api.pingone.com', 'auth.pingone.com']); assert.deepEqual(off.hosts(), ['auth.pingone.com']);
  assert.ok(on.origins().includes('https://api.pingone.com')); assert.ok(!off.origins().some((o) => o.includes('api.pingone')));
  const partial = createReal({ config: realConfig(fullSettingsFor(null, { AAG_AUTHORIZE_CLIENT_ID: AUTHORIZE_CLIENT_ID }), {}), missing: [], wanted: true });
  assert.deepEqual(partial.hosts(), ['auth.pingone.com']); assert.equal(partial.authorizeOn(), false); assert.match(partial.authorizeProblem(), /but not AAG_AUTHORIZE_ENDPOINT_ID, AAG_AUTHORIZE_CLIENT_SECRET$/);
  for (const bad of [{ AAG_AUTHORIZE_ENDPOINT_ID: 'not-a-uuid' }, { AAG_AUTHORIZE_CLIENT_SECRET: 'x\u0007y' }]) {
    const r = realConfig(fullSettingsFor(null, authorizeSettings(bad)), {}); assert.equal(r.authorize, null); assert.match(r.authorizeProblem, /^the app \.env has no valid AAG_AUTHORIZE_/); assert.ok(!r.authorizeProblem.includes('x\u0007y'));
  }
  assert.equal(createReal({ config: realConfig(fullSettingsFor(null, authorizeSettings({ AAG_AUTHORIZE_CLIENT_SECRET: 'replace-me' })), {}), missing: [], wanted: true }).authorizeOn(), false, 'a placeholder counts as not set');
});

// ---------------------------------------------------------------------------------------------------------------- parity: the lab's own phase B rule and the Authorize reading agree on every flight and cabin
test('parity: for every flight and cabin the code the fake endpoint answers (read by the reader) is the same class and the same narrowing as the lab\'s own rule on the tool server', () => {
  const cfg = { tierGroup: 'Software_EnterpriseTier', tierGroupAirline: 'Airline_OrbitTier' };
  const auth = { scopes: ['flights:book'], groups: [], claims: { sub: 'parity-user' } };
  const classOf = { PERMIT: 'permit', CONSTRAINED: 'narrow', HITL_REQUIRED: 'approval' };
  let n = 0;
  const fake = startNoServerFake();
  for (const [flight, f] of Object.entries(FLIGHTS)) {
    for (const cabin of ['business', 'economy']) {
      const lab = toolDecide({ name: 'book_airline_flight', rawArgs: { flight, cabin }, auth, config: cfg, hitl: createHitl(), now: Date.now });
      const params = { AirLabMarker: 'larkspur-air', ToolName: 'book_airline_flight', UserId: 'parity-user', AirFare: String(f.fare), AirIsInternational: String(isInternational(f)), AirCabinAsked: cabin, AirApproval: 'none' };
      const a = fake.answer('ok', params);
      const r = readDecision({ status: a.status, contentType: a.type, text: JSON.stringify(a.body), sent: params });
      const label = `${flight} ${cabin}`;
      assert.equal(r.outcome, classOf[lab.audit?.decision ?? 'HITL_REQUIRED'], label);
      assert.equal(CODES[r.code].word, lab.audit.decision, label);
      if (lab.audit.decision === 'CONSTRAINED') assert.deepEqual([...CODES[r.code].because], lab.payload.constrained.because, label);
      n += 1;
    }
  }
  assert.equal(n, Object.keys(FLIGHTS).length * 2);
});
import { createFakeAuthorize } from './fakeAuthorize.js';
import { ENV_ID } from './fakePingone.js';
function startNoServerFake() { return createFakeAuthorize({ envId: ENV_ID }); }

test('a tool server whose audit header names PingOne Authorize, with no record of the lab\'s own call, is NOT credited: the page says the lab has no record of asking it', async () => {
  for (const [name, forge] of [['no record', () => null], ['a record for another code', () => ({ request: {}, response: { status: 200, body: {} }, answer: { code: 'airline-economy-intl' } })], ['a record of an answer that was not 200', () => ({ request: {}, response: { status: 500, body: {} }, answer: { code: 'airline-permit-as-asked' } })]]) {
    await withAuthorize(async (url, { authorize }) => {
      authorize.evidenceFor = forge;           // the parent's own ring says something else than the audit header the child sent
      const x = await runAir(url, 'UC7');
      assert.equal(x.outcome, 'REAL_PERMIT', name);   // the tool server did book (it is the enforcer); only the credit is withheld
      assert.equal(x.decidedBy, 'tool-server-local-unconfirmed', name);
      assert.deepEqual(x.authorize, { configured: true, asked: forge() !== null, answered: false, code: null, reason: null }, name);
      const d = decisionHop(x);
      assert.deepEqual([d.to, d.decidedBy, d.authorize, d.fact], ['toolserver', 'tool-server-local-unconfirmed', undefined, 'lab policy decided'], name);
      assert.match(d.decision.by, /its audit header named PingOne Authorize, but the lab has no record of asking it/, name);
      assert.ok(!JSON.stringify(x).includes('PingOne Authorize decided'), name);
      assert.ok(!x.hops.some((h) => h.to === 'authorize' || h.decidedBy === 'pingone-authorize'), name);
    });
  }
});

test('a booking Authorize narrowed or approved says why from the CODE only: no dollar figure of the lab is put in a sentence attributed to PingOne Authorize', () => {
  const booking = (extra = {}) => ({ content: [{ type: 'text', text: JSON.stringify({ lab_invented: true, status: 'booked', flight: 'LK 214', from: 'ORD', to: 'DEN', confirmation: 'LKR-ABCDEF', cabin_booked: 'economy', constrained: { field: 'cabin', asked: 'business', granted: 'economy', because: ['over-limit'], limit: 300 }, ...extra }) }] });
  assert.match(replyText('book_airline_flight', booking(), { provider: 'local', byAuthorize: true }), /^Booked in economy, not business: the fare is over the policy's limit\. LK 214/);
  assert.ok(!/\$\d/.test(replyText('book_airline_flight', booking(), { provider: 'local', byAuthorize: true })));
  assert.match(replyText('book_airline_flight', booking(), { provider: 'local' }), /^Booked in economy, not business: the fare is over the \$300 limit\./, 'the lab\'s own rule keeps its own figure');
});
