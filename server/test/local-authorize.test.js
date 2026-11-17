// The tool server's PingOne Authorize branch (design-authorize-lab.md B.2, B.5): the child's broker (ids, timeouts, shapes), the booking decision for the whole F table, and the
// rule that matters most here: NO SILENT PERMIT. The parent is played by a stub that answers from the fake endpoint's own reading (fakeAuthorize.js) through the reader, and once by a
// REAL forked child with a hand-written parent on the other end of the IPC channel. Every flight, fare and group is LAB-INVENTED.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fork } from 'node:child_process';
import path from 'node:path';
import { createBroker, shapeOfResult } from '../src/local/util.js';
import { AUTHORIZE_CODES, AUTHORIZE_REASONS } from '../src/local/registry.js';
import { FLIGHTS } from '../src/local/data.js';
import { argsDigest } from '../src/local/hitl.js';
import { CODES, REASON_WORDS, readDecision, shapeResult } from '../src/authorize.js';
import { createFakeAuthorize } from './fakeAuthorize.js';
import { startRig, SECRET } from './localHarness.js';
import { ACTOR, AUDIENCE, ENV_ID, TIER_GROUP, TIER_GROUP_AIRLINE, startFakeIdp } from './localFakeIdp.js';
import { findWords } from './wordScan.js';

const fake = createFakeAuthorize({ envId: ENV_ID });
const noDec = (reason) => ({ outcome: 'no_decision', code: null, reason, correlationId: null, elapsedMs: null });
// What the real parent would send for these seven parameters if the endpoint answered the way the fake does: the fake's answer, read by the lab's own reader.
const parentResult = (params, mode = 'ok') => {
  const a = fake.answer(mode, params);
  const r = readDecision({ status: a.status, contentType: a.type, text: typeof a.body === 'string' ? a.body : JSON.stringify(a.body), sent: params });
  return shapeResult({ ...r, elapsedMs: 12 });
};

// A stub parent: every message the child sends is recorded, and answered by `answer(message)` (a result object, or null for silence), asynchronously, through the broker like IPC.
const parent = { sent: [], answer: (m) => parentResult(m.params), delay: 0, last: null };
let broker;
const asks = () => parent.sent.filter((m) => m.type === 'authorize');
let rig;
before(async () => {
  broker = createBroker({
    waitMs: 400,
    send: (m) => {
      parent.sent.push(m);
      const reply = parent.answer(m);
      parent.last = reply;
      if (reply) setTimeout(() => broker.onMessage({ type: 'authorize-result', id: m.id, ...reply }), parent.delay);
      return true;
    },
  });
  rig = await startRig({ authorize: broker.ask });
});
after(async () => { await rig.close(); });
const reset = () => { parent.sent.length = 0; parent.answer = (m) => parentResult(m.params); parent.delay = 0; };

const BOOK = (o = {}) => rig.token({ scope: 'flights:book', ...o });
const auditOf = (r) => JSON.parse(r.headers['x-gw-audit-trail']);
const book = (args, o = {}) => rig.call('book_airline_flight', args, { tok: o.tok ?? BOOK(), ...(o.session ? { session: o.session } : {}), ...(o.headers ? { headers: o.headers } : {}) });
const approve = (id) => rig.hitl(`/${id}/respond`, { body: { decision: 'approved', respondedBy: 'test phone' } });

// ---------------------------------------------------------------------------------------------------------------- the broker (B.2)
test('the broker: ids bind the reply; unknown, duplicate and late ids are dropped; another call\'s id answers nothing', async () => {
  const sent = []; const timers = [];
  const b = createBroker({ send: (m) => { sent.push(m); return true; }, waitMs: 1000, setTimeoutImpl: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimeoutImpl: (t) => { t.cleared = true; } });
  const p1 = b.ask({ x: 1 }, 'a'.repeat(32)); const p2 = b.ask({ x: 2 }, null);
  assert.deepEqual(sent.map((m) => [m.type, m.id, m.trace]), [['authorize', 1, 'a'.repeat(32)], ['authorize', 2, null]]);
  assert.equal(sent[0].params.x, 1);
  const permit = (id) => ({ type: 'authorize-result', id, outcome: 'permit', code: 'airline-permit-as-asked', reason: null, correlationId: 'c-1', elapsedMs: 4 });
  b.onMessage(permit(99));                                         // unknown id: dropped
  b.onMessage(permit(2));                                          // answers call 2 only
  assert.equal((await p2).code, 'airline-permit-as-asked'); assert.equal(b.pendingCount(), 1);
  b.onMessage(permit(2));                                          // a duplicate: dropped, never answers anything else
  assert.equal(b.pendingCount(), 1);
  b.onMessage({ ...permit(1), outcome: 'deny', code: 'airline-booking-refused' });
  assert.equal((await p1).code, 'airline-booking-refused', 'call 1 got the reply that carried its id, nothing else');
  // late: after the timeout the id is forgotten, so a late reply is dropped and answers nothing
  const p3 = b.ask({ x: 3 }); const t3 = timers.at(-1); assert.equal(t3.ms, 1000); t3.fn();
  assert.deepEqual(decisionOf(await p3), { outcome: 'no_decision', reason: 'timeout' });
  b.onMessage(permit(3)); assert.equal(b.pendingCount(), 0);
  // a message of another type, or no object at all, changes nothing
  for (const junk of [null, 'x', 5, [], { type: 'init' }, { type: 'authorize', id: 4 }, { type: 'authorize-result' }, { type: 'authorize-result', id: '4' }]) b.onMessage(junk);
});

const decisionOf = (r) => ({ outcome: r.outcome, reason: r.reason });

test('the broker: a reply with the wrong shape is a no decision (malformed); an extra key, a missing key, an outcome or a code that does not go together, a reason on a decision are all refused', async () => {
  const good = { type: 'authorize-result', outcome: 'narrow', code: 'airline-economy-intl', reason: null, correlationId: 'abc', elapsedMs: 10 };
  const variants = [
    { ...good, extra: 1 }, (({ elapsedMs, ...rest }) => rest)(good), { ...good, outcome: 'maybe' }, { ...good, outcome: 'permit' }, { ...good, code: 'airline-unmatched' }, { ...good, code: 'lab-fare-hold' },
    { ...good, code: null }, { ...good, reason: 'timeout' }, { ...good, correlationId: 'has space' }, { ...good, correlationId: 5 }, { ...good, elapsedMs: -1 }, { ...good, elapsedMs: 1.5 }, { ...good, elapsedMs: 600001 },
    { type: 'authorize-result', outcome: 'no_decision', code: 'airline-permit-as-asked', reason: 'timeout', correlationId: null, elapsedMs: null },
    { type: 'authorize-result', outcome: 'no_decision', code: null, reason: 'bespoke', correlationId: null, elapsedMs: null },
    { type: 'authorize-result', outcome: 'no_decision', code: null, reason: null, correlationId: null, elapsedMs: null },
  ];
  for (const v of variants) {
    const b = createBroker({ send: () => true, waitMs: 1000 });
    const p = b.ask({}); b.onMessage({ ...v, id: 1 });
    assert.deepEqual(decisionOf(await p), { outcome: 'no_decision', reason: 'malformed' }, JSON.stringify(v));
  }
  const b = createBroker({ send: () => true }); const p = b.ask({}); b.onMessage({ ...good, id: 1 });
  assert.equal((await p).outcome, 'narrow');
  assert.equal(shapeOfResult({ ...good, id: 1 }).code, 'airline-economy-intl');
});

test('the broker: nine at once is busy without sending; a send that fails is unavailable; two bookings at once resolve independently and out of order; silence is a timeout, never a permit', async () => {
  const sent = []; const b = createBroker({ send: (m) => { sent.push(m); return true; }, waitMs: 5000 });
  const eight = Array.from({ length: 8 }, (_, i) => b.ask({ i }));
  const ninth = await b.ask({ i: 8 });
  assert.deepEqual(decisionOf(ninth), { outcome: 'no_decision', reason: 'busy' }); assert.equal(sent.length, 8, 'the ninth was NOT sent');
  // answer them in the reverse order: each gets its own
  for (const m of [...sent].reverse()) b.onMessage({ type: 'authorize-result', id: m.id, outcome: 'permit', code: 'airline-permit-as-asked', reason: null, correlationId: `c-${m.params.i}`, elapsedMs: m.params.i });
  const got = await Promise.all(eight); assert.deepEqual(got.map((r) => r.correlationId), Array.from({ length: 8 }, (_, i) => `c-${i}`));
  const dead = createBroker({ send: () => false }); assert.equal((await dead.ask({})).reason, 'unavailable');
  const throwing = createBroker({ send: () => { throw new Error('closed'); } }); assert.equal((await throwing.ask({})).reason, 'unavailable');
  const quiet = createBroker({ send: () => true, waitMs: 30 }); const r = await quiet.ask({});
  assert.deepEqual(decisionOf(r), { outcome: 'no_decision', reason: 'timeout' }); assert.equal(r.code, null);
});

test('the child\'s copy of the nine answers equals the parent\'s (outcome, because) and the reasons are the same fifteen words', () => {
  assert.deepEqual(Object.keys(AUTHORIZE_CODES), Object.keys(CODES));
  for (const [code, row] of Object.entries(CODES)) { assert.equal(AUTHORIZE_CODES[code].outcome, row.outcome, code); assert.deepEqual([...AUTHORIZE_CODES[code].because], [...row.because], code); }
  assert.deepEqual([...AUTHORIZE_REASONS].sort(), Object.keys(REASON_WORDS).sort());
});

// ---------------------------------------------------------------------------------------------------------------- the booking decision (B.5), the whole F table
const ROWS = [
  // [label, flight, cabin, expected code, status, audit decision, cabin booked, because]
  ['P01 Denver', 'LK 214', 'business', 'airline-permit-as-asked', 200, 'PERMIT', 'business', null],
  ['P02 Toronto', 'LK 322', 'business', 'airline-economy-intl', 200, 'CONSTRAINED', 'economy', ['international']],
  ['P03 Boston', 'LK 560', 'business', 'airline-economy-over-limit', 200, 'CONSTRAINED', 'economy', ['over-limit']],
  ['P04 Paris', 'LK 704', 'business', 'airline-approval-required', 428, 'HITL_REQUIRED', null, null],
  ['P05 edge 400', 'LK 330', 'business', 'airline-permit-as-asked', 200, 'PERMIT', 'business', null],
  ['P06 edge 401', 'LK 331', 'business', 'airline-economy-over-limit', 200, 'CONSTRAINED', 'economy', ['over-limit']],
  ['P07 edge 1500', 'LK 650', 'business', 'airline-economy-over-limit', 200, 'CONSTRAINED', 'economy', ['over-limit']],
  ['P08 edge 1501', 'LK 651', 'business', 'airline-approval-required', 428, 'HITL_REQUIRED', null, null],
  ['P09 both', 'LK 800', 'business', 'airline-economy-intl-over-limit', 200, 'CONSTRAINED', 'economy', ['international', 'over-limit']],
  ['P10 economy intl', 'LK 322', 'economy', 'airline-permit-as-asked', 200, 'PERMIT', 'economy', null],
  ['P11 economy over the hold', 'LK 651', 'economy', 'airline-approval-required', 428, 'HITL_REQUIRED', null, null],
];

test('every positive row of the F table: the seven parameters sent, the answer applied, the audit header says pingone-authorize with the code as the rule, constrained.rule is the code', async () => {
  const tok = BOOK({ sub: 'sub-for-rows' }); const session = await rig.open(tok);
  for (const [label, flight, cabin, code, status, word, booked, because] of ROWS) {
    reset();
    const r = await book({ flight, cabin }, { tok, session });
    assert.equal(r.status, status, label);
    const q = asks(); assert.equal(q.length, 1, `${label}: exactly one question`);
    const f = FLIGHTS[flight];
    assert.deepEqual(q[0].params, { AirLabMarker: 'larkspur-air', ToolName: 'book_airline_flight', UserId: 'sub-for-rows', AirFare: String(f.fare), AirIsInternational: String(country(f.from) !== country(f.to)), AirCabinAsked: cabin, AirApproval: 'none' }, label);
    assert.deepEqual(Object.keys(q[0].params), ['AirLabMarker', 'ToolName', 'UserId', 'AirFare', 'AirIsInternational', 'AirCabinAsked', 'AirApproval'], 'canonical key order');
    assert.match(q[0].trace ?? 'null', /^([0-9a-f]{32}|null)$/);
    const a = auditOf(r);
    assert.deepEqual([a.decision, a.source, a.rule, a.tool], [word, 'pingone-authorize', code, 'book_airline_flight'], label);
    assert.equal(a.correlation, parent.last.correlationId, label); assert.match(a.correlation, /^[0-9a-f-]{36}$/, label); assert.equal(a.elapsed_ms, 12, label);
    if (status === 200) {
      assert.equal(r.result.cabin_booked, booked, label); assert.equal(r.result.fare_judged, f.fare, label); assert.match(r.result.confirmation, /^LKR-[0-9A-F]{6}$/);
      if (because) { assert.deepEqual(r.result.constrained, { field: 'cabin', asked: 'business', granted: 'economy', because, limit: 400, rule: 'lab-fare-constrained' }, label); }
      else assert.equal(r.result.constrained, undefined, label);
    } else {
      assert.equal(r.json.error, 'approval_required'); assert.equal(r.json.reason, code); assert.equal(r.json.fare_judged, f.fare); assert.match(r.json.challengeId, /^[0-9a-f-]{36}$/); assert.equal(r.json.by, 'tool server');
    }
  }
});
const country = (code) => ({ ORD: 'US', MDW: 'US', DEN: 'US', SFO: 'US', SEA: 'US', BOS: 'US', LAX: 'US', HNL: 'US', YYZ: 'CA', CDG: 'FR', LHR: 'GB' })[code];

test('the narrowing carries the lab\'s own limit for display; a narrowing needs a business ask (an economy ask answered "narrow" is a no decision); the code, never the payload, names the reasons', async () => {
  reset();
  parent.answer = (m) => ({ outcome: 'narrow', code: 'airline-economy-intl', reason: null, correlationId: null, elapsedMs: null });
  const bad = await book({ flight: 'LK 214', cabin: 'economy' });
  assert.equal(bad.status, 503); assert.equal(bad.json.reason, 'unrecognised'); assert.equal(bad.result, null);
  const ok = await book({ flight: 'LK 214', cabin: 'business' });
  assert.equal(ok.status, 200); assert.deepEqual(ok.result.constrained.because, ['international'], 'the code names it, whatever the flight is'); assert.equal(ok.result.constrained.limit, 400); assert.equal(ok.result.constrained.rule, 'lab-fare-constrained');
  assert.equal(auditOf(ok).rule, 'airline-economy-intl');
});

test('second factor and refusal are mapped (the v1 inputs never produce them): 428 step_up_required and 403 access_denied, with the audit header and nothing run', async () => {
  reset();
  parent.answer = (m) => parentResult(m.params, 'second-factor');
  const s = await book({ flight: 'LK 214', cabin: 'business' });
  assert.equal(s.status, 428); assert.equal(s.json.error, 'step_up_required'); assert.equal(s.json.reason, 'airline-second-factor-required'); assert.equal(s.result, null);
  assert.deepEqual([auditOf(s).decision, auditOf(s).source, auditOf(s).rule], ['STEP_UP', 'pingone-authorize', 'airline-second-factor-required']);
  parent.answer = (m) => parentResult(m.params, 'deny');
  const d = await book({ flight: 'LK 214', cabin: 'business' });
  assert.equal(d.status, 403); assert.equal(d.json.error, 'access_denied'); assert.equal(d.json.reason, 'airline-booking-refused'); assert.ok(!d.text.includes('confirmation'));
  assert.deepEqual([auditOf(d).decision, auditOf(d).source, auditOf(d).rule], ['DENY', 'pingone-authorize', 'airline-booking-refused']);
});

test('the fare is never the caller\'s: fare, amount, price and the rest are -32602 and nothing is asked', async () => {
  reset();
  const tok = BOOK(); const session = await rig.open(tok);
  for (const field of ['fare', 'amount', 'price', 'international', 'AirFare', 'AirApproval']) {
    const r = await book({ flight: 'LK 704', cabin: 'business', [field]: 1 }, { tok, session });
    assert.equal(r.json.error.code, -32602, field);
  }
  assert.equal(asks().length, 0, 'a refused argument never asks Authorize');
  const ok = await book({ flight: 'LK 214', cabin: 'business' }, { tok, session });
  assert.equal(ok.result.fare_judged, FLIGHTS['LK 214'].fare); assert.equal(asks()[0].params.AirFare, '380');
});

// ---------------------------------------------------------------------------------------------------------------- NO SILENT PERMIT
const NO_DECISION_MODES = ['only-unmatched', 'no-airline-code', 'not-applicable', 'indeterminate', 'two-specific-codes', 'unknown-airline-code', 'decision-code-mismatch', 'payload-contradicts-code-2', 'bad-json', 'wrong-content-type', 'oversize', 'redirect', 'forbidden', 'not-found', 'bad-request', '5xx'];

test('NO SILENT PERMIT: for every answer that is not a decision the booking tool does not run, the answer is 503 authorize_no_decision with a fixed body, never 200 and never 403, and nothing is spent or held', async () => {
  const tok = BOOK({ sub: 'no-silent' }); const session = await rig.open(tok);
  for (const mode of NO_DECISION_MODES) {
    reset();
    const before = rig.local.hitl.size();
    parent.answer = (m) => parentResult(m.params, mode);
    const r = await book({ flight: 'LK 214', cabin: 'business' }, { tok, session });
    assert.equal(r.status, 503, mode); assert.equal(r.json.error, 'authorize_no_decision', mode); assert.equal(r.json.message, 'PingOne Authorize gave no decision.');
    assert.ok(Object.hasOwn(REASON_WORDS, r.json.reason), `${mode}: ${r.json.reason}`); assert.equal(r.json.by, 'tool server'); assert.deepEqual(Object.keys(r.json).sort(), ['by', 'error', 'message', 'reason']);
    assert.equal(r.result, null, `${mode}: nothing ran`); assert.ok(!r.text.includes('confirmation') && !r.text.includes('cabin_booked'), mode);
    assert.equal(r.headers['x-gw-audit-trail'], undefined, `${mode}: no audit header, so nothing is credited`);
    assert.equal(rig.local.hitl.size(), before, `${mode}: no challenge was made`);
  }
  // the same $380 domestic booking the lab's own rule would permit is a 503 when Authorize is silent or hung
  reset(); parent.answer = () => null;
  const hung = await book({ flight: 'LK 214', cabin: 'business' }, { tok, session });
  assert.equal(hung.status, 503); assert.equal(hung.json.reason, 'timeout'); assert.equal(hung.result, null);
  // and a parent that sends rubbish
  for (const junk of [{ outcome: 'permit' }, { outcome: 'permit', code: 'lab-no-restriction', reason: null, correlationId: null, elapsedMs: null }, { outcome: 'permit', code: 'airline-permit-as-asked', reason: null, correlationId: null, elapsedMs: null, extra: true }]) {
    reset(); parent.answer = () => junk;
    const r = await book({ flight: 'LK 214', cabin: 'business' }, { tok, session });
    assert.equal(r.status, 503); assert.equal(r.json.reason, 'malformed'); assert.equal(r.result, null);
  }
  assert.deepEqual(findWords({ reasons: Object.values(REASON_WORDS) }), []);
});

test('with the Authorize branch OFF the phase B rule answers exactly as before and says so (source lab-policy); the parent is never asked', async () => {
  const off = await startRig();
  try {
    const tok = off.token({ scope: 'flights:book' });
    const r = await off.call('book_airline_flight', { flight: 'LK 214', cabin: 'business' }, { tok });
    assert.equal(r.status, 200); assert.deepEqual([auditOf(r).source, auditOf(r).rule, auditOf(r).decision], ['lab-policy', 'lab-no-restriction', 'PERMIT']);
    assert.equal(auditOf(r).correlation, undefined);
    const t = await off.call('book_airline_flight', { flight: 'LK 322', cabin: 'business' }, { tok });
    assert.deepEqual([auditOf(t).source, auditOf(t).rule], ['lab-policy', 'lab-fare-constrained']);
  } finally { await off.close(); }
});

// ---------------------------------------------------------------------------------------------------------------- receipts
test('receipts: an approved booking spends the receipt exactly once and only after Authorize answered approved; an invalid receipt over the hold is refused and Authorize saw none; a valid receipt under the hold is unspent', async () => {
  reset();
  const tok = BOOK({ sub: 'receipt-user' }); const session = await rig.open(tok);
  const held = await book({ flight: 'LK 704', cabin: 'business' }, { tok, session });
  assert.equal(held.status, 428); const id = held.json.challengeId;
  assert.equal(asks().at(-1).params.AirApproval, 'none');
  // pending receipt: invalid -> Authorize is asked with none and says approval-required -> the lab refuses the receipt (no new hold)
  const pend = await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: id }, { tok, session });
  assert.equal(pend.status, 403); assert.equal(pend.json.error, 'hitl_receipt_rejected'); assert.equal(pend.json.reason, 'receipt_pending'); assert.equal(pend.headers['x-gw-audit-trail'], undefined);
  assert.equal(asks().at(-1).params.AirApproval, 'none', 'the fake saw none');
  await approve(id);
  // the check does not spend it: asking twice with the receipt while Authorize is silent leaves it unspent
  parent.answer = () => null; parent.delay = 0;
  const down = await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: id }, { tok, session });
  assert.equal(down.status, 503); assert.equal(asks().at(-1).params.AirApproval, 'verified');
  const digest = argsDigest({ flight: 'LK 704', cabin: 'business' });
  assert.equal(rig.local.hitl.check(id, { sub: 'receipt-user', tool: 'book_airline_flight', argsDigest: digest }).valid, true, 'Authorize down after a valid receipt was checked leaves it unspent');
  parent.answer = (m) => parentResult(m.params);
  const done = await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: id }, { tok, session });
  assert.equal(asks().at(-1).params.AirApproval, 'verified');
  assert.equal(done.status, 200); assert.equal(done.result.cabin_booked, 'business'); assert.equal(done.result.constrained, undefined, 'an approval beats a narrowing');
  assert.deepEqual([auditOf(done).decision, auditOf(done).rule, auditOf(done).source], ['PERMIT', 'airline-approved-as-asked', 'pingone-authorize']);
  assert.equal(rig.local.hitl.check(id, { sub: 'receipt-user', tool: 'book_airline_flight', argsDigest: digest }).reason, 'receipt_used', 'spent once, after the answer');
  const again = await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: id }, { tok, session });
  assert.equal(again.status, 403); assert.equal(again.json.reason, 'receipt_used'); assert.equal(asks().at(-1).params.AirApproval, 'none');
  // a receipt bound to other arguments is invalid (the fake saw none)
  const other = await book({ flight: 'LK 651', cabin: 'business', _hitl_challenge_id: id }, { tok, session });
  assert.equal(other.status, 403); assert.equal(other.json.reason, 'receipt_binding_mismatch'); assert.equal(asks().at(-1).params.AirApproval, 'none');
});

test('a valid receipt at or under the hold is checked but never spent: Authorize sees verified and answers the narrowing; the receipt stays valid', async () => {
  reset();
  const tok = BOOK({ sub: 'under-hold' }); const session = await rig.open(tok);
  const args = { flight: 'LK 322', cabin: 'business' };
  const made = (await rig.hitl('', { body: { sub: 'under-hold', tool: 'book_airline_flight', argsDigest: argsDigest(args), amount: 380 } })).json;
  await approve(made.id);
  const r = await book({ ...args, _hitl_challenge_id: made.id }, { tok, session });
  assert.equal(asks().at(-1).params.AirApproval, 'verified'); assert.equal(r.status, 200); assert.equal(r.result.cabin_booked, 'economy'); assert.equal(auditOf(r).rule, 'airline-economy-intl');
  assert.equal(rig.local.hitl.check(made.id, { sub: 'under-hold', tool: 'book_airline_flight', argsDigest: argsDigest(args) }).valid, true, 'unspent');
  // an answer of "approved" for a call that carried no verified receipt is a no decision, and nothing is spent
  parent.answer = () => ({ outcome: 'approved', code: 'airline-approved-as-asked', reason: null, correlationId: null, elapsedMs: null });
  const lie = await book({ flight: 'LK 704', cabin: 'business' }, { tok, session });
  assert.equal(lie.status, 503); assert.equal(lie.json.reason, 'unrecognised');
  // and "approval required" when verified was sent
  parent.answer = () => ({ outcome: 'approval', code: 'airline-approval-required', reason: null, correlationId: null, elapsedMs: null });
  const lie2 = await book({ ...args, _hitl_challenge_id: made.id }, { tok, session });
  assert.equal(lie2.status, 503); assert.equal(lie2.json.reason, 'unrecognised');
});

// ---------------------------------------------------------------------------------------------------------------- the stamping rule
test('the stamping rule: scope, group and argument refusals, an invalid receipt, every other tool and every no decision never carry pingone-authorize, and the literal sits in ONE place in server/src/local', async () => {
  reset();
  const tok = BOOK(); const session = await rig.open(tok);
  const noScope = await rig.call('book_airline_flight', { flight: 'LK 214' }, { tok: rig.token({ scope: 'flights:read' }) });
  assert.equal(noScope.status, 403); assert.equal(auditOf(noScope).source, 'lab-policy');
  const bad = await book({ flight: 'LK 999' }, { tok, session }); assert.equal(bad.json.error.code, -32602);
  assert.equal(asks().length, 0, 'none of those asked');
  for (const [tool, args, scope, groups] of [['get_airline_bookings', {}, 'trips:read'], ['get_flight_status', { flight: 'LK 214' }, 'flights:read'], ['list_airports', {}, null], ['request_change_fee_waiver', { flight: 'LK 214', reason: 'weather' }, 'fees:request']]) {
    const t = scope ? rig.token({ scope }) : undefined;
    const r = await rig.call(tool, args, { ...(t ? { tok: t } : {}), session: await rig.open(t) });
    if (r.headers['x-gw-audit-trail']) assert.equal(auditOf(r).source, 'lab-policy', tool);
  }
  const group = await rig.call('sensitive_passenger_record', {}, { tok: rig.token({ scope: 'travellers:read' }) });
  assert.equal(group.status, 403); assert.equal(auditOf(group).source, 'lab-policy'); assert.equal(auditOf(group).rule, 'lab-group-gate');
  assert.equal(asks().length, 0, 'no other tool and no refusal before the booking decision ever asks');
  const files = fs.readdirSync(new URL('../src/local/', import.meta.url)).filter((f) => f.endsWith('.js'));
  const count = files.reduce((n, f) => n + (fs.readFileSync(new URL(`../src/local/${f}`, import.meta.url), 'utf8').match(/'pingone-authorize'/g) ?? []).length, 0);
  assert.equal(count, 1, 'the literal appears in exactly one place');
});

// ---------------------------------------------------------------------------------------------------------------- a REAL child process with a hand-written parent
test('a REAL forked child: authorize true sends one message per booking with the seven parameters and the trace id, and applies the reply that carries its id; authorize false never asks', async () => {
  const idp = await startFakeIdp();
  const modulePath = new URL('../src/local/main.js', import.meta.url).pathname;
  const runChild = async (authorize, body) => {
    const child = fork(modulePath, [], { cwd: path.dirname(modulePath), env: { NODE_ENV: 'production' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'json' });
    const messages = [];
    const ready = new Promise((resolve, reject) => { child.on('message', (m) => { messages.push(m); if (m?.type === 'ready') resolve(m); if (m?.type === 'error') reject(new Error('init refused')); }); setTimeout(() => reject(new Error('no ready')), 8000).unref(); });
    child.send({ type: 'init', config: { issuer: idp.issuer, audience: AUDIENCE, allowedActors: [ACTOR], tierGroup: TIER_GROUP, tierGroupAirline: TIER_GROUP_AIRLINE, hitlSecret: SECRET, clockSkewSeconds: 60, ...(authorize === undefined ? {} : { authorize }) } });
    try { const r = await ready; await body({ child, port: r.port, messages }); } finally { child.kill('SIGKILL'); }
  };
  const call = async (port, args) => {
    const tok = idp.mint({ scope: 'flights:book' }, { nowMs: Date.now() });
    const post = async (message, session) => fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}`, traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(message) });
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    const sid = init.headers.get('mcp-session-id');
    return post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'book_airline_flight', arguments: args } }, sid);
  };
  try {
    await runChild(true, async ({ child, port, messages }) => {
      child.on('message', (m) => { if (m?.type === 'authorize') child.send({ type: 'authorize-result', id: m.id, ...parentResult(m.params) }); });
      const r = await call(port, { flight: 'LK 322', cabin: 'business' });
      assert.equal(r.status, 200); const a = JSON.parse(r.headers.get('x-gw-audit-trail'));
      assert.deepEqual([a.source, a.rule, a.decision, a.trace], ['pingone-authorize', 'airline-economy-intl', 'CONSTRAINED', '0af7651916cd43dd8448eb211c80319c']);
      const q = messages.filter((m) => m.type === 'authorize'); assert.equal(q.length, 1);
      assert.deepEqual(Object.keys(q[0]).sort(), ['id', 'params', 'trace', 'type']); assert.equal(q[0].trace, '0af7651916cd43dd8448eb211c80319c'); assert.equal(q[0].params.AirCabinAsked, 'business'); assert.equal(q[0].params.AirIsInternational, 'true');
      assert.ok(JSON.stringify(q[0]).length <= 1024, 'at most 1 KB');
      assert.ok(!JSON.stringify(q[0]).includes('Bearer') && !JSON.stringify(q[0]).includes(SECRET), 'no token and no approval secret in the question');
    });
    await runChild(true, async ({ child, port, messages }) => {
      // a parent that answers with ANOTHER call's id: nothing is answered, the call times out into a 503 only after the child's wait; here we answer a wrong id then the right one
      child.on('message', (m) => { if (m?.type === 'authorize') { child.send({ type: 'authorize-result', id: m.id + 1000, ...parentResult(m.params) }); child.send({ type: 'authorize-result', id: m.id, ...noDec('endpoint') }); } });
      const r = await call(port, { flight: 'LK 214', cabin: 'business' });
      assert.equal(r.status, 503); assert.equal((await r.json()).reason, 'endpoint');
      assert.equal(messages.filter((m) => m.type === 'authorize').length, 1);
    });
    for (const flag of [false, undefined]) {
      await runChild(flag, async ({ child, port, messages }) => {
        child.send({ type: 'authorize-result', id: 1, ...parentResult(BASE_PARAMS) });      // ignored: there is no broker
        const r = await call(port, { flight: 'LK 214', cabin: 'business' });
        assert.equal(r.status, 200); assert.equal(JSON.parse(r.headers.get('x-gw-audit-trail')).source, 'lab-policy');
        assert.equal(messages.filter((m) => m.type === 'authorize').length, 0, 'authorize false never asks');
      });
    }
    // an init with a non-boolean authorize is refused
    const child = fork(modulePath, [], { cwd: path.dirname(modulePath), env: { NODE_ENV: 'production' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'json' });
    const out = await new Promise((resolve) => { child.on('message', (m) => { if (m?.type === 'error' || m?.type === 'ready') resolve(m.type); }); child.on('exit', () => resolve('exit')); child.send({ type: 'init', config: { issuer: idp.issuer, audience: AUDIENCE, allowedActors: [ACTOR], tierGroup: TIER_GROUP, hitlSecret: SECRET, authorize: 'yes' } }); });
    child.kill('SIGKILL'); assert.ok(['error', 'exit'].includes(out), out);
  } finally { await idp.close(); }
});
const BASE_PARAMS = { AirLabMarker: 'larkspur-air', ToolName: 'book_airline_flight', UserId: 'x', AirFare: '380', AirIsInternational: 'false', AirCabinAsked: 'business', AirApproval: 'none' };

// ---------------------------------------------------------------------------------------------------------------- hitl.check
import { createHitl } from '../src/local/hitl.js';
test('hitl.check is verify without the spend: the same six reasons, no state change; verify calls it so they cannot drift', () => {
  let t = 1_000_000; const h = createHitl({ now: () => t, ttlMs: 1000 });
  const bind = { sub: 'u', tool: 'book_airline_flight', argsDigest: 'a'.repeat(64) };
  assert.deepEqual(h.check('nope', bind), { valid: false, reason: 'receipt_unknown' }); assert.deepEqual(h.check(undefined, bind), { valid: false, reason: 'receipt_unknown' });
  const c = h.create({ ...bind, amount: 5 });
  assert.equal(h.check(c.id, { ...bind, sub: 'other' }).reason, 'receipt_binding_mismatch');
  assert.equal(h.check(c.id, bind).reason, 'receipt_pending'); h.respond(c.id, { decision: 'approved', respondedBy: 'p' });
  for (let i = 0; i < 3; i += 1) assert.deepEqual(h.check(c.id, bind), { valid: true, id: c.id }, 'checking never spends');
  assert.deepEqual(h.verify(c.id, bind), { valid: true, id: c.id, consumed: true });
  assert.equal(h.check(c.id, bind).reason, 'receipt_used'); assert.equal(h.verify(c.id, bind).reason, 'receipt_used');
  const d = h.create({ ...bind, argsDigest: 'b'.repeat(64) }); h.respond(d.id, { decision: 'denied', respondedBy: 'p' });
  const bd = { ...bind, argsDigest: 'b'.repeat(64) };
  assert.equal(h.check(d.id, bd).reason, 'receipt_denied'); assert.equal(h.verify(d.id, bd).reason, 'receipt_denied');
  const e = h.create({ ...bind, argsDigest: 'c'.repeat(64) }); h.respond(e.id, { decision: 'approved', respondedBy: 'p' }); t += 5000;
  const be = { ...bind, argsDigest: 'c'.repeat(64) };
  assert.equal(h.check(e.id, be).reason, 'receipt_expired'); assert.equal(h.verify(e.id, be).reason, 'receipt_expired');
});
