// The PingOne Authorize client and reader (server/src/authorize.js, design-authorize-lab.md B.3, B.4, C, F), against the fake decision endpoint and against hand-made fetches.
// Everything here proves the lab's own READING; nothing reaches a tenant. The fake's `ok` answers are written from the 21-case table independently of the reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CODES, MAX_RESPONSE_CHARS, OUTCOMES, PARAMS, POLICY_NAME, REASON_WORDS, createAuthorize, normalizeParams, readDecision, reasonForStatus, shapeResult, trustedAnswer } from '../src/authorize.js';
import { realConfig } from '../src/real.js';
import { AUTHORIZE_CLIENT_ID, AUTHORIZE_CLIENT_SECRET, AUTHORIZE_ENDPOINT_ID, ENV_ID, authorizeSettings, fullSettingsFor, startFakePingOne } from './fakePingone.js';
import { createFakeAuthorize } from './fakeAuthorize.js';

const BASE = { AirLabMarker: 'larkspur-air', ToolName: 'book_airline_flight', UserId: 'lab-probe-subject', AirFare: '380', AirIsInternational: 'false', AirCabinAsked: 'business', AirApproval: 'none' };
const P = (over = {}) => ({ ...BASE, ...over });
const TRACE = '0af7651916cd43dd8448eb211c80319c';

// The 13 rows the tool server can produce, then the rows only the probe sends (design F). [label, param overrides, expected specific code or null].
const POSITIVE = [
  ['P01 Denver', {}, 'airline-permit-as-asked'],
  ['P02 Toronto', { AirIsInternational: 'true' }, 'airline-economy-intl'],
  ['P03 Boston', { AirFare: '780' }, 'airline-economy-over-limit'],
  ['P04 Paris', { AirFare: '2400', AirIsInternational: 'true' }, 'airline-approval-required'],
  ['P05 edge 400', { AirFare: '400' }, 'airline-permit-as-asked'],
  ['P06 edge 401', { AirFare: '401' }, 'airline-economy-over-limit'],
  ['P07 edge 1500', { AirFare: '1500' }, 'airline-economy-over-limit'],
  ['P08 edge 1501', { AirFare: '1501' }, 'airline-approval-required'],
  ['P09 both', { AirFare: '1100', AirIsInternational: 'true' }, 'airline-economy-intl-over-limit'],
  ['P10 economy intl', { AirIsInternational: 'true', AirCabinAsked: 'economy' }, 'airline-permit-as-asked'],
  ['P11 economy over hold', { AirFare: '1501', AirCabinAsked: 'economy' }, 'airline-approval-required'],
  ['P12 approved retry', { AirFare: '2400', AirIsInternational: 'true', AirApproval: 'verified' }, 'airline-approved-as-asked'],
  ['P13 receipt under the hold', { AirIsInternational: 'true', AirApproval: 'verified' }, 'airline-economy-intl'],
];
const NEGATIVE = [
  ['N01 malformed fare', { AirFare: 'abc' }],
  ['N02 empty user', { UserId: '' }],
  ['N03 out of the gate', { AirLabMarker: 'other' }],
  ['N04 unknown cabin', { AirCabinAsked: 'first' }],
  ['N05 unknown approval over the hold', { AirFare: '2400', AirIsInternational: 'true', AirApproval: 'maybe' }],
  ['N06 other tool', { ToolName: 'other_tool' }],
];
const LENIENT = [['L01 True', { AirIsInternational: 'True' }, 'airline-economy-intl'], ['L02 maybe', { AirIsInternational: 'maybe' }, 'airline-permit-as-asked']];

const fakeAnswer = createFakeAuthorize({ envId: ENV_ID }).answer;
// An answer of the fake, read the way the lab reads it.
const readMode = (mode, params, sent = params) => {
  const a = fakeAnswer(mode, params);
  return readDecision({ status: a.status, contentType: a.type, text: typeof a.body === 'string' ? a.body : JSON.stringify(a.body), sent });
};
const noDec = (reason) => ({ outcome: 'no_decision', code: null, reason, correlationId: null, elapsedMs: null });
const decisionOf = (r) => ({ outcome: r.outcome, code: r.code, reason: r.reason });

// ---------------------------------------------------------------------------------------------------------------- normalizeParams
test('normalizeParams: exactly the seven keys as strings; every hostile shape is refused', () => {
  const ok = normalizeParams(BASE); assert.equal(ok.ok, true); assert.deepEqual(Object.keys(ok.params), PARAMS); assert.notEqual(ok.params, BASE, 'a fresh object');
  const bad = (p, why) => assert.equal(normalizeParams(p).ok, false, why);
  bad({ ...BASE, Amount: '1', DecisionContext: 'x', ActClientId: 'y', A: '1', B: '2' }, '12 keys');
  const six = { ...BASE }; delete six.AirApproval; bad(six, '6 keys');
  bad({ ...BASE, AirFare: 380 }, 'a number value'); bad({ ...BASE, AirFare: null }, 'null value');
  bad(JSON.parse('{"AirLabMarker":"larkspur-air","ToolName":"book_airline_flight","UserId":"u","AirFare":"380","AirIsInternational":"true","AirCabinAsked":"business","__proto__":"x"}'), 'a __proto__ key in place of the seventh');
  bad({ ...BASE, UserId: 'a\u0007b' }, 'a control character'); bad({ ...BASE, UserId: 'u'.repeat(201) }, 'a 201 character UserId'); assert.equal(normalizeParams({ ...BASE, UserId: 'u'.repeat(200) }).ok, true);
  for (const f of ['0', '0.00', '-5', 'abc', '1e3', '', ' 380', '380 ', '1234567', '1.234']) bad({ ...BASE, AirFare: f }, `fare ${JSON.stringify(f)}`);
  for (const f of ['1', '380', '2400.5', '999999']) assert.equal(normalizeParams({ ...BASE, AirFare: f }).ok, true, f);
  for (const v of ['True', 'maybe', '1', '']) bad({ ...BASE, AirIsInternational: v }, `flag ${v}`);
  for (const v of ['first', 'Business', '']) bad({ ...BASE, AirCabinAsked: v }, `cabin ${v}`);
  for (const v of ['maybe', 'Verified', '']) bad({ ...BASE, AirApproval: v }, `approval ${v}`);
  bad({ ...BASE, AirLabMarker: 'other' }, 'marker'); bad({ ...BASE, ToolName: 'other_tool' }, 'tool name');
  for (const v of [null, undefined, 'x', 5, [], [BASE]]) bad(v, `a non-object ${JSON.stringify(v)}`);
});

// ---------------------------------------------------------------------------------------------------------------- the reader table
test('readDecision over the 21-case matrix: the thirteen positive rows give exactly the expected code, with and without the catch-all, foreign codes ignored', () => {
  for (const mode of ['ok', 'ok-no-catchall', 'hal-json']) {
    for (const [label, over, code] of POSITIVE) {
      const r = readMode(mode, P(over));
      assert.deepEqual([r.outcome, r.code, r.reason], [CODES[code].outcome, code, null], `${mode} ${label}`);
    }
  }
  // the SAME answer with and without airline-unmatched
  for (const [label, over] of POSITIVE) assert.deepEqual(decisionOf(readMode('ok', P(over))), decisionOf(readMode('ok-no-catchall', P(over))), label);
  for (const [label, over, code] of LENIENT) assert.equal(readMode('ok', P(over)).code, code, label);
});

test('readDecision: every negative row is a no decision with its own reason (a specific code is never invented), in both policy builds', () => {
  const want = { 'N01 malformed fare': 'indeterminate', 'N02 empty user': 'no_airline_code', 'N03 out of the gate': 'no_airline_code', 'N04 unknown cabin': 'only_unmatched', 'N05 unknown approval over the hold': 'only_unmatched', 'N06 other tool': 'no_airline_code' };
  for (const [label, over] of NEGATIVE) {
    const r = readMode('ok', P(over), P());          // the reader's consistency rules read what the lab SENT (a valid base) - none applies to a no-code answer
    assert.deepEqual(decisionOf(r), decisionOf(noDec(want[label])), label);
  }
  // without the catch-all the unknown-cabin answer holds no airline code at all: still a no decision, the reason differs and nothing else
  assert.equal(readMode('ok-no-catchall', P({ AirCabinAsked: 'first' }), P()).outcome, 'no_decision');
  assert.equal(readMode('ok-no-catchall', P({ AirCabinAsked: 'first' }), P()).reason, 'no_airline_code');
});

test('readDecision: every fake mode that is not an answer is a no decision with the reason the design names; none can be read as a permit', () => {
  const table = [
    ['only-unmatched', 'only_unmatched'], ['no-airline-code', 'no_airline_code'], ['not-applicable', 'not_applicable'], ['indeterminate', 'indeterminate'], ['indeterminate-status', 'indeterminate'],
    ['two-specific-codes', 'ambiguous'], ['unknown-airline-code', 'unrecognised'], ['decision-code-mismatch', 'unrecognised'], ['decision-code-mismatch-2', 'unrecognised'],
    ['payload-contradicts-code', 'unrecognised'], ['payload-contradicts-code-2', 'unrecognised'],
    ['bad-json', 'malformed'], ['wrong-content-type', 'malformed'], ['wrong-content-type-textjson', 'malformed'], ['wrong-content-type-plain', 'malformed'], ['wrong-content-type-octet', 'malformed'],
    ['oversize', 'malformed'], ['statements-object', 'malformed'], ['decision-lowercase', 'malformed'],
    ['redirect', 'endpoint'], ['5xx', 'server_error'], ['5xx-503', 'server_error'], ['forbidden', 'refused_credential'], ['not-found', 'endpoint'], ['bad-request', 'endpoint'],
  ];
  for (const [mode, reason] of table) {
    // the payload-contradiction modes carry a specific code only for a booking that matches them; the first row is a business booking that is narrowed (P02) for the narrowing contradiction and P01 for the other
    const params = mode === 'payload-contradicts-code' ? P({ AirIsInternational: 'true' }) : P();
    const r = readMode(mode, params);
    assert.equal(r.outcome, 'no_decision', mode); assert.equal(r.reason, reason, mode); assert.equal(r.code, null, mode);
  }
  // the two answers that ARE decisions whatever the parameters
  assert.deepEqual(decisionOf(readMode('second-factor', P())), { outcome: 'second_factor', code: 'airline-second-factor-required', reason: null });
  assert.deepEqual(decisionOf(readMode('deny', P())), { outcome: 'deny', code: 'airline-booking-refused', reason: null });
  // a valid permit with extra fields, __proto__ and constructor members and a 5 KB foreign code is still just the permit
  assert.deepEqual(decisionOf(readMode('permit-extra-fields', P())), { outcome: 'permit', code: 'airline-permit-as-asked', reason: null });
});

test('readDecision: the order of the checks and the hard rules (C.3)', () => {
  const body = (o) => JSON.stringify(o);
  const j = (o, extra = {}) => readDecision({ status: 200, contentType: 'application/json', text: typeof o === 'string' ? o : body(o), sent: P(), ...extra });
  const permit = { decision: 'PERMIT', statements: [{ code: 'airline-permit-as-asked', payload: '{"outcome":"permit"}' }] };
  assert.equal(j(permit).outcome, 'permit');
  // a PERMIT with no recognised code is never a permit
  assert.equal(j({ decision: 'PERMIT', statements: [{ code: 'transaction-approved' }] }).reason, 'no_airline_code');
  assert.equal(j({ decision: 'PERMIT' }).reason, 'no_airline_code'); assert.equal(j({ decision: 'PERMIT', statements: null }).reason, 'no_airline_code');
  // media types: parameters and case ignored, any +json accepted; text/json and the rest refused; none refused
  for (const t of ['application/json; charset=utf-8', 'APPLICATION/JSON', 'application/hal+json', 'application/hal+json;charset=UTF-8', 'application/vnd.pingidentity.decision+json']) assert.equal(j(permit, { contentType: t }).outcome, 'permit', t);
  for (const t of ['text/json', 'text/html', 'text/plain', 'application/octet-stream', '', null, undefined, 'application/jsonx']) assert.equal(j(permit, { contentType: t }).reason, 'malformed', String(t));
  // size and shape
  assert.equal(j(' '.repeat(MAX_RESPONSE_CHARS + 1)).reason, 'malformed'); assert.equal(j('[]').reason, 'malformed'); assert.equal(j('"x"').reason, 'malformed'); assert.equal(j('null').reason, 'malformed'); assert.equal(j('{').reason, 'malformed');
  assert.equal(readDecision({ status: 200, contentType: 'application/json', text: 5, sent: P() }).reason, 'malformed');
  // decision: exact words only
  for (const d of ['permit', 'Permit', 'ALLOW', '', null, ['PERMIT'], 1, undefined]) assert.equal(j({ ...permit, decision: d }).reason, 'malformed', JSON.stringify(d));
  assert.equal(j({ ...permit, decision: 'NOT_APPLICABLE' }).reason, 'not_applicable'); assert.equal(j({ ...permit, decision: 'INDETERMINATE' }).reason, 'indeterminate');
  // statements: an object is malformed; an element that is not an object or has no string code is another policy's statement and is IGNORED (it never stops our code from counting)
  assert.equal(j({ decision: 'PERMIT', statements: {} }).reason, 'malformed');
  for (const bad of ['x', 5, null, [], {}, { code: 5 }, { name: 'n' }]) { const r = j({ decision: 'PERMIT', statements: [permit.statements[0], bad] }); assert.equal(r.outcome, 'permit', JSON.stringify(bad)); assert.equal(r.code, 'airline-permit-as-asked'); }
  // ... and with nothing of ours next to them they are still no decision, never a permit
  for (const bad of ['x', 5, null, [], {}, { code: 5 }, { name: 'n' }]) assert.equal(j({ decision: 'PERMIT', statements: [bad] }).reason, 'no_airline_code', JSON.stringify(bad));
  // status: only OKAY (or absent) lets the answer stand
  assert.equal(j({ ...permit, status: { code: 'OKAY' } }).outcome, 'permit'); assert.equal(j({ ...permit, status: { code: 'FAILED' } }).reason, 'indeterminate'); assert.equal(j({ ...permit, status: 'x' }).outcome, 'permit');
  // codes: case sensitive, no trimming; a code with a trailing space or another case is not ours
  for (const c of ['Airline-permit-as-asked', ' airline-permit-as-asked', 'AIRLINE-PERMIT-AS-ASKED']) assert.equal(j({ decision: 'PERMIT', statements: [{ code: c }] }).reason, 'no_airline_code', JSON.stringify(c));
  assert.equal(j({ decision: 'PERMIT', statements: [{ code: 'airline-permit-as-asked ' }] }).reason, 'unrecognised', 'a trailing space starts with airline- but is not a code of ours: no decision, never a permit');
  // the same code in two statements counts once; two different ones are ambiguous even when one is the catch-all's neighbour
  assert.equal(j({ decision: 'PERMIT', statements: [{ code: 'airline-permit-as-asked' }, { code: 'airline-permit-as-asked' }, { code: 'airline-unmatched' }] }).outcome, 'permit');
  assert.equal(j({ decision: 'PERMIT', statements: [{ code: 'airline-permit-as-asked' }, { code: 'airline-approval-required' }] }).reason, 'ambiguous');
  // an unknown airline- code beats a known one
  assert.equal(j({ decision: 'PERMIT', statements: [{ code: 'airline-permit-as-asked' }, { code: 'airline-surprise' }] }).reason, 'unrecognised');
  // the decision a code needs: refused is a DENY, the rest PERMIT; a DENY from another demo beside our permit is no decision
  assert.equal(j({ decision: 'DENY', statements: [{ code: 'airline-booking-refused' }] }).outcome, 'deny'); assert.equal(j({ decision: 'PERMIT', statements: [{ code: 'airline-booking-refused' }] }).reason, 'unrecognised');
  assert.equal(j({ decision: 'DENY', statements: [{ code: 'airline-permit-as-asked' }, { code: 'transaction-denied' }] }).reason, 'unrecognised');
  // consistency with what the lab SENT: a narrowing when economy was asked, an approval answer when verified was sent, approved when none was sent
  const narrow = { decision: 'PERMIT', statements: [{ code: 'airline-economy-intl' }] };
  assert.equal(j(narrow).outcome, 'narrow'); assert.equal(j(narrow, { sent: P({ AirCabinAsked: 'economy' }) }).reason, 'unrecognised');
  const ask = { decision: 'PERMIT', statements: [{ code: 'airline-approval-required' }] };
  assert.equal(j(ask, { sent: P({ AirFare: '2400' }) }).outcome, 'approval'); assert.equal(j(ask, { sent: P({ AirFare: '2400', AirApproval: 'verified' }) }).reason, 'unrecognised');
  const approved = { decision: 'PERMIT', statements: [{ code: 'airline-approved-as-asked' }] };
  assert.equal(j(approved, { sent: P({ AirApproval: 'verified' }) }).outcome, 'approved'); assert.equal(j(approved).reason, 'unrecognised');
  // NO rule compares a code with the fare NUMBER: a permit for 5000 (the owner edited the limit) stands
  assert.equal(j(permit, { sent: P({ AirFare: '5000' }) }).outcome, 'permit');
  // payload: an object or a string of JSON; only `cabin` (narrowing codes) and `outcome` are read, and only to catch a contradiction
  const withPayload = (code, payload) => ({ decision: 'PERMIT', statements: [{ code, payload }] });
  assert.equal(j(withPayload('airline-economy-intl', { cabin: 'economy', outcome: 'narrow' })).outcome, 'narrow');
  assert.equal(j(withPayload('airline-economy-intl', { cabin: 'first' })).reason, 'unrecognised'); assert.equal(j(withPayload('airline-economy-intl', '{"cabin":"business"}')).reason, 'unrecognised');
  assert.equal(j(withPayload('airline-permit-as-asked', { cabin: 'first' })).outcome, 'permit', 'cabin is read for the narrowing codes only');
  assert.equal(j(withPayload('airline-permit-as-asked', { outcome: 'refused' })).reason, 'unrecognised'); assert.equal(j(withPayload('airline-permit-as-asked', '{"outcome":"narrow"}')).reason, 'unrecognised');
  assert.equal(j(withPayload('airline-permit-as-asked', { outcome: 'a word nobody knows' })).outcome, 'permit', 'an unknown word is ignored');
  for (const junk of ['not json', '[1]', '5', 'null', 7, null, true]) assert.equal(j(withPayload('airline-permit-as-asked', junk)).outcome, 'permit', `display text: ${JSON.stringify(junk)}`);
  assert.equal(j(withPayload('airline-economy-intl-over-limit', { limit: 99999, hold: 1, cabin: 'economy' })).outcome, 'narrow', 'the payload\'s numbers are never read');
  // correlation id: copied only when it is a plain id
  assert.equal(j({ ...permit, correlationId: 'abc-123' }).correlationId, 'abc-123');
  for (const c of ['has space', 'x'.repeat(65), '', 5, '<script>', null]) assert.equal(j({ ...permit, correlationId: c }).correlationId, null, JSON.stringify(c));
  // non-200 statuses
  for (const [st, why] of [[401, 'refused_credential'], [403, 'refused_credential'], [429, 'rate_limited'], [500, 'server_error'], [503, 'server_error'], [404, 'endpoint'], [400, 'endpoint'], [302, 'endpoint'], [418, 'endpoint']]) {
    assert.equal(readDecision({ status: st, contentType: 'application/json', text: JSON.stringify(permit), sent: P() }).reason, why, String(st)); assert.equal(reasonForStatus(st), why, String(st));
  }
});

test('the result shapes: every reason has words, every code row is consistent, and shapeResult/trustedAnswer accept nothing else', () => {
  assert.deepEqual(Object.keys(REASON_WORDS).sort(), ['ambiguous', 'busy', 'endpoint', 'indeterminate', 'malformed', 'no_airline_code', 'not_applicable', 'only_unmatched', 'rate_limited', 'refused_credential', 'server_error', 'timeout', 'unavailable', 'unreachable', 'unrecognised']);
  for (const w of Object.values(REASON_WORDS)) assert.match(w, /^[a-z][a-z' ]{5,80}$/, w);
  assert.equal(Object.keys(CODES).length, 8); assert.deepEqual(OUTCOMES.slice(), ['permit', 'narrow', 'approval', 'approved', 'second_factor', 'deny', 'no_decision']);
  assert.deepEqual(Object.values(CODES).filter((c) => c.decision === 'DENY').length, 1, 'only the refusal is a DENY');
  assert.equal(POLICY_NAME, 'Larkspur Air Booking Authorization');
  for (const [code, row] of Object.entries(CODES)) {
    assert.deepEqual(decisionOf(shapeResult({ outcome: row.outcome, code, reason: null, correlationId: null, elapsedMs: 5 })), { outcome: row.outcome, code, reason: null }, code);
    assert.equal(shapeResult({ outcome: row.outcome === 'permit' ? 'deny' : 'permit', code, reason: null }), null, `${code}: a code with another outcome`);
    const t = trustedAnswer({ source: 'pingone-authorize', rule: code, decision: row.word, correlation: 'c-1', elapsed_ms: 7 });
    assert.deepEqual(t, { code, outcome: row.outcome, word: row.word, correlationId: 'c-1', elapsedMs: 7 }, code);
    assert.equal(trustedAnswer({ source: 'lab-policy', rule: code, decision: row.word }), null, `${code}: another source is never credited`);
    assert.equal(trustedAnswer({ source: 'pingone-authorize', rule: code, decision: row.word === 'PERMIT' ? 'DENY' : 'PERMIT' }), null, `${code}: the decision word must be the code's`);
  }
  assert.equal(trustedAnswer({ source: 'pingone-authorize', rule: 'lab-fare-hold', decision: 'HITL_REQUIRED' }), null); assert.equal(trustedAnswer(null), null); assert.equal(trustedAnswer('x'), null);
  assert.equal(shapeResult({ outcome: 'no_decision', code: null, reason: 'nope' }), null); assert.equal(shapeResult({ outcome: 'permit', code: 'airline-permit-as-asked', reason: 'timeout' }) === null, false, 'a stray reason on a decision is dropped, not kept');
  assert.equal(shapeResult({ outcome: 'permit', code: 'airline-permit-as-asked', reason: 'timeout' }).reason, null);
  assert.equal(shapeResult({ outcome: 'permit', code: 'airline-permit-as-asked', correlationId: '<x>', elapsedMs: -1 }).correlationId, null);
  assert.equal(shapeResult({ outcome: 'permit', code: 'airline-permit-as-asked', elapsedMs: 1e9 }).elapsedMs, null);
});

// ---------------------------------------------------------------------------------------------------------------- the call, against the fake
async function withFake(fn, { limits = {}, now, sleep, settings = {} } = {}) {
  const p1 = await startFakePingOne({ authorize: true });
  const cfg = realConfig(fullSettingsFor(null, authorizeSettings(settings)), { AAG_LIVE_TEST_BASE: p1.base }).authorize;
  assert.ok(cfg, 'the three settings make a config');
  const az = createAuthorize({ config: cfg, limits: { paceMs: 0, retry429Ms: 20, ...limits }, ...(now ? { now } : {}), ...(sleep ? { sleep } : {}) });
  try { await fn({ p1, fake: p1.authorize, az, cfg }); } finally { await p1.close(); }
}
const ask = (az, over = {}, trace = TRACE) => az.decide(P(over), { trace });

test('the call: seven parameters, a bearer from a client_credentials grant with no scope, the answer read; the same answers as the pure reader for every positive row', async () => {
  await withFake(async ({ fake, az, p1 }) => {
    for (const [label, over, code] of POSITIVE) {
      const r = await ask(az, over);
      assert.deepEqual([r.outcome, r.code, r.reason], [CODES[code].outcome, code, null], label);
      assert.match(r.correlationId, /^[0-9a-f-]{36}$/, label); assert.ok(Number.isInteger(r.elapsedMs) && r.elapsedMs >= 0, label);
    }
    assert.equal(fake.seen.length, POSITIVE.length); assert.ok(fake.seen.every((s) => s.bearer === true));
    assert.deepEqual(Object.keys(fake.seen[0].parameters), PARAMS);
    assert.ok(!fake.seen.some((s) => /Amount|DecisionContext|ActClientId/.test(JSON.stringify(s.parameters))), 'shared attributes are never sent');
    assert.equal(fake.tokenRequests, 1, 'the token is cached and reused');
    const tokenCall = p1.seen.find((c) => c.url.endsWith('/as/token') && /^Basic /.test(c.headers.authorization ?? '') && c.body === 'grant_type=client_credentials');
    assert.ok(tokenCall, 'a client_credentials grant, no scope, no audience, HTTP Basic');
    assert.equal(Buffer.from(tokenCall.headers.authorization.slice(6), 'base64').toString('utf8'), `${AUTHORIZE_CLIENT_ID}:${AUTHORIZE_CLIENT_SECRET}`);
    const post = p1.seen.find((c) => c.url.includes('/decisionEndpoints/'));
    assert.equal(post.url, `/v1/environments/${ENV_ID}/decisionEndpoints/${AUTHORIZE_ENDPOINT_ID}`); assert.equal(post.headers['content-type'], 'application/json');
    assert.deepEqual(Object.keys(JSON.parse(post.body)), ['parameters']);
  });
});

test('no decision, whatever the answer: every hostile or failing fake mode gives a no decision with the right reason, never a decision (fake modes, over the wire)', async () => {
  const table = [
    ['only-unmatched', 'only_unmatched'], ['no-airline-code', 'no_airline_code'], ['not-applicable', 'not_applicable'], ['indeterminate', 'indeterminate'], ['two-specific-codes', 'ambiguous'],
    ['unknown-airline-code', 'unrecognised'], ['decision-code-mismatch', 'unrecognised'], ['payload-contradicts-code-2', 'unrecognised'], ['bad-json', 'malformed'], ['wrong-content-type', 'malformed'],
    ['wrong-content-type-textjson', 'malformed'], ['oversize', 'malformed'], ['redirect', 'endpoint'], ['forbidden', 'refused_credential'], ['not-found', 'endpoint'], ['bad-request', 'endpoint'], ['5xx', 'server_error'], ['5xx-503', 'server_error'],
  ];
  await withFake(async ({ fake, az }) => {
    for (const [mode, reason] of table) {
      fake.setMode(mode);
      const before = fake.seen.length;
      const r = await ask(az);
      assert.deepEqual(decisionOf(r), decisionOf(noDec(reason)), mode);
      assert.equal(fake.seen.length - before, 1, `${mode}: exactly one post, a 5xx or a refusal is never retried`);
    }
  });
});

test('the transport: 429 once then ok retries ONCE after 1500 ms (injected sleep); 429 every time is rate_limited after exactly two posts; a 5xx is never retried', async () => {
  const waits = [];
  await withFake(async ({ fake, az }) => {
    fake.setMode('429-then-ok');
    const r = await ask(az);
    assert.equal(r.code, 'airline-permit-as-asked'); assert.equal(fake.seen.length, 2); assert.deepEqual(waits, [1500]);
    fake.reset(); fake.setMode('429-always'); waits.length = 0;
    const r2 = await ask(az);
    assert.deepEqual(decisionOf(r2), decisionOf(noDec('rate_limited'))); assert.equal(fake.seen.length, 2, 'never a third post'); assert.deepEqual(waits, [1500]);
    fake.reset(); fake.setMode('5xx');
    assert.equal((await ask(az)).reason, 'server_error'); assert.equal(fake.seen.length, 1);
  }, { limits: { retry429Ms: 1500 }, sleep: async (ms) => { waits.push(ms); } });
});

test('401: ONE refresh (a second token request, the post repeated once), then a second 401 is refused_credential; a wrong secret at the token endpoint is refused_credential', async () => {
  await withFake(async ({ fake, az }) => {
    fake.setMode('unauthorized-then-ok');
    const r = await ask(az);
    assert.equal(r.code, 'airline-permit-as-asked'); assert.equal(fake.tokenRequests, 2, 'a new token was fetched once'); assert.equal(fake.seen.length, 2);
    assert.equal((await ask(az)).code, 'airline-permit-as-asked'); assert.equal(fake.tokenRequests, 2, 'the new token is cached');
  });
  await withFake(async ({ az }) => {
    const r = await ask(az);
    assert.deepEqual(decisionOf(r), decisionOf(noDec('refused_credential')));
  }, { settings: { AAG_AUTHORIZE_CLIENT_SECRET: `${AUTHORIZE_CLIENT_SECRET}x` } });
});

test('the timers: a decision endpoint that never answers is a timeout at the headers deadline; a stalled body is a timeout at the body deadline; the total deadline is 20 s counted from arrival', async () => {
  await withFake(async ({ fake, az }) => {
    fake.setMode('timeout');
    const t0 = Date.now(); const r = await ask(az);
    assert.equal(r.reason, 'timeout'); assert.ok(Date.now() - t0 < 1500, 'gave up at the headers deadline, not later');
    fake.release(); fake.setMode('slow-body');
    const t1 = Date.now(); const r2 = await ask(az);
    assert.equal(r2.reason, 'timeout'); assert.ok(Date.now() - t1 < 1500);
  }, { limits: { headersMs: 200, bodyMs: 250, totalMs: 4000 } });
  // the total deadline: injected clock past 20 s since arrival is a timeout before any post
  let t = 1_000_000;
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); t += 21_000; return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const az = createAuthorize({ config: { tokenUrl: 'http://127.0.0.1:1/e/as/token', decisionUrl: 'http://127.0.0.1:1/v1/environments/e/decisionEndpoints/x', clientId: 'c', clientSecret: 's' }, fetchImpl, now: () => t, sleep: async () => {}, limits: { paceMs: 0 } });
  assert.equal((await az.decide(P(), { trace: null })).reason, 'timeout'); assert.equal(calls.length, 1, 'only the token was fetched: the post never went');
});

test('calls are serial, in arrival order, at least paceMs apart; at most four wait or run and a fifth is busy', async () => {
  let running = 0; let max = 0; const starts = [];
  let release; const gate = new Promise((r) => { release = r; });
  const order = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/as/token')) return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    running += 1; max = Math.max(max, running); starts.push(Date.now()); order.push(JSON.parse(init.body).parameters.UserId);
    await gate; running -= 1;
    return new Response(JSON.stringify({ decision: 'PERMIT', statements: [{ code: 'airline-permit-as-asked' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const waits = [];
  const az = createAuthorize({ config: { tokenUrl: 'http://127.0.0.1:1/e/as/token', decisionUrl: 'http://127.0.0.1:1/v1/environments/e/decisionEndpoints/x', clientId: 'c', clientSecret: 's' }, fetchImpl, sleep: async (ms) => { waits.push(ms); }, limits: { paceMs: 1100 } });
  const ps = ['u1', 'u2', 'u3', 'u4'].map((u) => az.decide(P({ UserId: u }), { trace: null }));
  const fifth = await az.decide(P({ UserId: 'u5' }), { trace: null });
  assert.deepEqual(decisionOf(fifth), decisionOf(noDec('busy')), 'the fifth waiting call is refused at once');
  await new Promise((r) => setTimeout(r, 30)); assert.equal(running, 1, 'only one at a time'); release();
  const all = await Promise.all(ps);
  assert.ok(all.every((r) => r.code === 'airline-permit-as-asked'));
  assert.equal(max, 1); assert.deepEqual(order, ['u1', 'u2', 'u3', 'u4'], 'arrival order');
  assert.equal(waits.length, 3, 'the second, third and fourth waited for the pace'); assert.ok(waits.every((w) => w > 900 && w <= 1100), JSON.stringify(waits));
  // it frees up: a later call is accepted again
  assert.equal((await az.decide(P(), { trace: null })).code, 'airline-permit-as-asked');
});

test('a bad request never reaches the network; an unconfigured or unsafe configuration asks nothing and says unavailable', async () => {
  let n = 0; const fetchImpl = async () => { n += 1; throw new Error('must not be called'); };
  const cfg = { tokenUrl: 'http://127.0.0.1:1/e/as/token', decisionUrl: 'http://127.0.0.1:1/v1/environments/e/decisionEndpoints/x', clientId: 'c', clientSecret: 's' };
  const az = createAuthorize({ config: cfg, fetchImpl });
  for (const bad of [{ ...BASE, Amount: '1' }, null, 'x', { ...BASE, AirFare: '0' }]) assert.equal((await az.decide(bad, { trace: null })).reason, 'malformed');
  assert.equal(n, 0);
  for (const unsafe of [null, undefined, {}, { ...cfg, decisionUrl: 'http://evil.example/x' }, { ...cfg, tokenUrl: 'https://user:pw@auth.example/x' }, { ...cfg, decisionUrl: 'file:///etc/passwd' }, { ...cfg, clientSecret: '' }]) {
    const off = createAuthorize({ config: unsafe, fetchImpl });
    assert.equal(off.configured, false); assert.equal((await off.decide(P(), { trace: null })).reason, 'unavailable');
  }
  assert.equal(n, 0, 'no fetch for any of them');
});

test('the decision URL is the parent\'s: a params value that looks like a URL changes nothing about the request path; the host the lab may reach is the API host only when all three settings are set', async () => {
  await withFake(async ({ fake, az, p1 }) => {
    const r = await ask(az, { UserId: 'http://evil.example/steal?x=1' });
    assert.equal(r.code, 'airline-permit-as-asked');
    assert.ok(p1.seen.filter((c) => c.url.includes('/decisionEndpoints/')).every((c) => c.url === `/v1/environments/${ENV_ID}/decisionEndpoints/${AUTHORIZE_ENDPOINT_ID}`));
    assert.equal(fake.seen[0].parameters.UserId, 'http://evil.example/steal?x=1', 'it is data in the body, nothing else');
  });
  const on = realConfig(fullSettingsFor(null, authorizeSettings()), {});
  assert.equal(on.authorize.decisionUrl, `https://api.pingone.com/v1/environments/${ENV_ID}/decisionEndpoints/${AUTHORIZE_ENDPOINT_ID}`); assert.equal(on.authorize.tokenUrl, `https://auth.pingone.com/${ENV_ID}/as/token`);
  const eu = realConfig(fullSettingsFor(null, authorizeSettings({ PINGONE_REGION: 'eu' })), {});
  assert.equal(new URL(eu.authorize.decisionUrl).hostname, 'api.pingone.eu');
  const off = realConfig(fullSettingsFor(null, {}), {}); assert.equal(off.authorize, null); assert.equal(off.authorizeProblem, undefined);
});

test('the secret and the token appear in no result, no evidence entry, no thrown text; the evidence names no bearer, no client id and no secret', async () => {
  await withFake(async ({ az, p1 }) => {
    const seenResults = [];
    for (const [, over] of POSITIVE.slice(0, 4)) { seenResults.push(await ask(az, over, TRACE)); }
    const bearer = /^Bearer (.+)$/.exec(p1.seen.find((c) => c.url.includes('/decisionEndpoints/')).headers.authorization)[1];
    const ev = az.evidenceFor(TRACE);
    assert.ok(ev, 'an entry exists for the trace');
    const all = JSON.stringify({ seenResults, ev });
    for (const secret of [AUTHORIZE_CLIENT_SECRET, bearer, AUTHORIZE_CLIENT_ID, Buffer.from(`${AUTHORIZE_CLIENT_ID}:${AUTHORIZE_CLIENT_SECRET}`).toString('base64')]) assert.ok(!all.includes(secret), 'a secret value leaked');
    assert.equal(ev.request.headers.authorization, 'Bearer (worker token, not shown)');
    assert.deepEqual(Object.keys(ev.request.body.parameters), PARAMS); assert.equal(ev.request.method, 'POST'); assert.match(ev.request.url, /\/decisionEndpoints\//);
    assert.equal(ev.response.status, 200); assert.equal(typeof ev.response.elapsedMs, 'number'); assert.equal(ev.response.body.decision, 'PERMIT'); assert.equal(ev.posts, 1);
    assert.equal(ev.answer.code, seenResults[3].code, 'the entry records the code the parent read (the lab confirms an audit header against it)');
    assert.equal(az.evidenceFor(TRACE), null, 'forgotten once read');
    // a no-decision answer records no answer code
    p1.authorize.setMode('only-unmatched'); await ask(az, {}, TRACE); assert.equal(az.evidenceFor(TRACE).answer, undefined); p1.authorize.setMode('ok');
    // a sentinel scan over every failure mode: the secret never shows up in what comes back
    for (const mode of ['bad-json', 'oversize', '5xx', 'forbidden', 'only-unmatched']) {
      p1.authorize.setMode(mode);
      const r = await ask(az, {}, TRACE); const e = az.evidenceFor(TRACE);
      const t = JSON.stringify({ r, e });
      assert.ok(!t.includes(AUTHORIZE_CLIENT_SECRET) && !t.includes(bearer), mode);
    }
  });
});

test('the evidence ring keeps the newest 50 by trace id, keeps nothing without a trace, and shortens what it shows (4096 characters, 400 for text)', async () => {
  await withFake(async ({ az, fake }) => {
    const ids = Array.from({ length: 52 }, (_, i) => `${i.toString(16).padStart(32, '0')}`);
    for (const id of ids) await ask(az, {}, id);
    assert.equal(az.evidenceFor(ids[0]), null, 'the oldest was dropped'); assert.equal(az.evidenceFor(ids[1]), null); assert.ok(az.evidenceFor(ids[2])); assert.ok(az.evidenceFor(ids[51]));
    await ask(az, {}, null); await ask(az, {}, 'not-a-trace-id'); assert.equal(az.evidenceFor(null), null); assert.equal(az.evidenceFor('not-a-trace-id'), null);
    fake.setMode('bad-json'); await ask(az, {}, ids[10]); const bad = az.evidenceFor(ids[10]);
    assert.deepEqual(Object.keys(bad.response.body), ['text']); assert.ok(bad.response.body.text.length <= 400);
    fake.setMode('oversize'); await ask(az, {}, ids[11]); const big = az.evidenceFor(ids[11]);
    assert.equal(big.response.body.truncated, true); assert.ok(big.response.body.text.length <= 4000);
    fake.setMode('permit-extra-fields'); await ask(az, {}, ids[12]); const mid = az.evidenceFor(ids[12]);
    assert.equal(mid.response.body.truncated, true, 'a 5 KB code is over 4096 characters: shown cut, not parsed');
  });
});

test('the module has no console, no process.env, no file access and no import beyond node: built-ins; and it is the only place besides settings, live, real and the settings that names the secret', () => {
  const code = fs.readFileSync(new URL('../src/authorize.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/console\./.test(code) && !/process\.env/.test(code) && !/node:fs/.test(code) && !/child_process/.test(code));
  assert.deepEqual([...code.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+'([^']+)'/g)].map((m) => m[1]), [], 'no imports at all');
  assert.ok(!/new RegExp\(/.test(code));
});

// Security review 2026-11-17: an endpoint that ECHOES the credentials must not put them on the page (the raw answer is shown in the step detail).
test('an endpoint that echoes the worker secret, its Basic form and the bearer leaves none of them in the evidence; the decision itself is still read', async () => {
  const SECRET_TEXT = 'echo-test-worker-secret-value-1234'; const BEARER = 'echo-test-bearer-token-abcdef0123456789';
  const basic = Buffer.from(`cid:${SECRET_TEXT}`).toString('base64');
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/as/token')) return new Response(JSON.stringify({ access_token: BEARER, expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    const body = { decision: 'PERMIT', statements: [{ code: 'airline-permit-as-asked', payload: { outcome: 'permit' } }], echo: { authorization: init.headers.authorization, secret: SECRET_TEXT, basic } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const az = createAuthorize({ config: { tokenUrl: 'http://127.0.0.1:9/e/as/token', decisionUrl: 'http://127.0.0.1:9/v1/environments/e/decisionEndpoints/x', clientId: 'cid', clientSecret: SECRET_TEXT }, fetchImpl, limits: { paceMs: 0 } });
  const r = await az.decide(P(), { trace: TRACE });
  assert.equal(r.outcome, 'permit'); assert.equal(r.code, 'airline-permit-as-asked');
  const shown = JSON.stringify(az.evidenceFor(TRACE));
  for (const v of [SECRET_TEXT, BEARER, basic]) assert.ok(!shown.includes(v), 'a credential the endpoint echoed is on the page');
  assert.ok(shown.includes('(removed)'));
});
