// The airline pack's fare rule (design section 3.1): two limits and one flag. Every number here is LAB-INVENTED: $400 and $1,500 come from the owner's
// example, not from any product policy. The rule: a domestic booking up to $400 is allowed as asked; an international booking, or any booking over $400
// and up to $1,500, is booked but only in economy (CONSTRAINED); over $1,500 a person approves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, FARE_RULE } from '../src/policy.js';

const base = { role: 'write', tool: 'book_airline_flight', sub: 'elena.novak', groups: [], actor: { registered: true }, fareRule: true, cabin: 'business' };
const at = (amount, extra = {}) => decide({ ...base, amount, ...extra });

test('the rule is the owner\'s: limit 400, hold 1500, business narrowed to economy (frozen)', () => {
  assert.deepEqual({ ...FARE_RULE }, { limit: 400, hold: 1500, from: 'business', to: 'economy' });
  assert.ok(Object.isFrozen(FARE_RULE));
});

test('the edges, domestic: 400 allowed, 401 constrained, 1500 constrained, 1501 a person approves', () => {
  for (const [fare, want] of [[0, 'PERMIT'], [150, 'PERMIT'], [380, 'PERMIT'], [400, 'PERMIT'], [401, 'CONSTRAINED'], [780, 'CONSTRAINED'], [1500, 'CONSTRAINED'], [1501, 'HITL_REQUIRED'], [2400, 'HITL_REQUIRED'], [1e6, 'HITL_REQUIRED']]) {
    assert.equal(at(fare).decision, want, `domestic $${fare}`);
  }
  const permit = at(400);
  assert.match(permit.reason, /at or under the \$400 limit/); assert.match(permit.reason, /lab-invented/);
  assert.equal(permit.constrain, undefined, 'a permit narrows nothing');
});

test('the edges, international: the flag alone narrows at any fare up to 1500; over 1500 a person approves, domestic or not', () => {
  for (const [fare, want] of [[150, 'CONSTRAINED'], [380, 'CONSTRAINED'], [400, 'CONSTRAINED'], [1100, 'CONSTRAINED'], [1500, 'CONSTRAINED'], [1501, 'HITL_REQUIRED'], [2400, 'HITL_REQUIRED']]) {
    assert.equal(at(fare, { international: true }).decision, want, `international $${fare}`);
  }
});

test('same $380, domestic against international: PERMIT against CONSTRAINED, and the reason says the flag alone did it', () => {
  assert.equal(at(380).decision, 'PERMIT');
  const intl = at(380, { international: true });
  assert.equal(intl.decision, 'CONSTRAINED');
  assert.match(intl.reason, /the flag alone/); assert.match(intl.reason, /not over the \$400 limit/);
  assert.deepEqual(intl.constrain, { field: 'cabin', asked: 'business', granted: 'economy', because: ['international'], limit: 400 });
});

test('the price alone constrains: because is over-limit, and the reason names both limits', () => {
  const r = at(780);
  assert.equal(r.decision, 'CONSTRAINED');
  assert.deepEqual(r.constrain, { field: 'cabin', asked: 'business', granted: 'economy', because: ['over-limit'], limit: 400 });
  assert.match(r.reason, /\$780 is over the \$400 limit and not over \$1,500/); assert.match(r.reason, /business is narrowed to economy/);
});

test('both gates trip: because lists both, in that order (LK 800, international, $1,100)', () => {
  const r = at(1100, { international: true });
  assert.equal(r.decision, 'CONSTRAINED');
  assert.deepEqual(r.constrain.because, ['international', 'over-limit']);
  assert.match(r.reason, /the trip is international and \$1,100 is over the \$400 limit/);
});

test('a cabin that is already economy has nothing to narrow: PERMIT, never a CONSTRAINED that changes nothing', () => {
  for (const [fare, extra] of [[380, { international: true }], [780, {}], [1500, { international: true }]]) {
    const r = at(fare, { ...extra, cabin: 'economy' });
    assert.equal(r.decision, 'PERMIT', `economy $${fare}`);
    assert.match(r.reason, /nothing is narrowed/); assert.equal(r.constrain, undefined);
  }
  assert.equal(at(1501, { cabin: 'economy' }).decision, 'HITL_REQUIRED', 'the second limit still needs a person');
});

test('a forged approval claim: over $1,500 it is STEP_UP (second factor first, a person still approves); at or under $1,500 it is ignored', () => {
  const over = at(2400, { international: true, forgedApproval: true });
  assert.equal(over.decision, 'STEP_UP');
  assert.match(over.reason, /a claim is not an approval/); assert.match(over.reason, /a person must still approve/); assert.match(over.reason, /\$1,500/);
  assert.equal(at(1501, { forgedApproval: true }).decision, 'STEP_UP', 'just over the second limit');
  // never a weaker gate than the same booking without the claim: the same booking without the claim is a person
  assert.equal(at(2400, { international: true }).decision, 'HITL_REQUIRED');
  // at or under the second limit the claim changes nothing: it decides exactly like the run without it
  for (const [fare, extra] of [[380, {}], [380, { international: true }], [400, {}], [401, {}], [1500, {}], [150, {}]]) {
    assert.deepEqual(at(fare, { ...extra, forgedApproval: true }), at(fare, extra), `$${fare} ${JSON.stringify(extra)}`);
  }
});

test('phoneApproval is CIBA (a lab input flag; the fare rule itself has no phone step)', () => {
  const r = at(150, { phoneApproval: true });
  assert.equal(r.decision, 'CIBA'); assert.match(r.reason, /own phone/);
});

test('the order: forged claim over the hold, then hold, then phone, then narrow, then permit', () => {
  assert.equal(at(2400, { forgedApproval: true, phoneApproval: true }).decision, 'STEP_UP');
  // The phone input never lets a booking over the second limit through with no person (a poisoned run steered to $2,500 on the phone use case, review fix).
  assert.equal(at(2400, { phoneApproval: true }).decision, 'HITL_REQUIRED');
  assert.equal(at(2500, { phoneApproval: true }).decision, 'HITL_REQUIRED');
  assert.equal(at(1501, { phoneApproval: true }).decision, 'HITL_REQUIRED');
  assert.equal(at(1500, { phoneApproval: true }).decision, 'CIBA', 'at the second limit the phone still decides');
  assert.equal(at(150, { phoneApproval: true }).decision, 'CIBA');
  assert.equal(at(1501, { international: true }).decision, 'HITL_REQUIRED');
});

test('the earlier checks still beat the fare rule: unregistered actor, other owner, pushed bound, group gate', () => {
  assert.equal(at(380, { actor: { registered: false } }).decision, 'DENY');
  assert.equal(at(380, { owner: 'marcus.bell' }).decision, 'DENY');
  assert.equal(at(380, { rar: { maxAmount: 300 } }).decision, 'DENY');
  assert.equal(at(380, { groupGate: true, group: 'orbit-tier' }).decision, 'DENY_403');
  assert.equal(at(2400, { international: true, forgedApproval: true, actor: { registered: false } }).decision, 'DENY', 'a forged actor is refused before any fare rule');
});

test('a read call in an airline run takes no fare rule (the rule is for bookings with an amount)', () => {
  assert.equal(decide({ ...base, role: 'read', tool: 'get_airline_bookings', amount: undefined }).decision, 'PERMIT');
  assert.equal(decide({ ...base, role: 'read', tool: 'get_airline_bookings', amount: 5000 }).decision, 'PERMIT');
});

test('a booking tool with a null role (UC48 reaches the rule through BOOKING_TOOLS) is judged by the fare rule', () => {
  assert.equal(decide({ ...base, role: null, amount: 780 }).decision, 'CONSTRAINED');
});

test('every non-airline call (fareRule false) keeps the old 249/250 booking band and the money bands byte for byte', () => {
  const old = (amount, tool, role) => decide({ role, tool, amount, sub: 's', groups: [], actor: { registered: true } });
  assert.equal(old(249, 'book_airline_flight', null).decision, 'PERMIT'); assert.equal(old(250, 'book_airline_flight', null).decision, 'HITL_REQUIRED');
  assert.equal(old(380, 'book_airline_flight', 'write').decision, 'HITL_REQUIRED', 'no fare rule without the flag');
  assert.equal(old(380, 'book_airline_flight', 'write').constrain, undefined);
  assert.equal(old(600, 'create_transfer', 'write').decision, 'STEP_UP');
  assert.equal(decide({ role: 'write', tool: 'create_transfer', amount: 600, fareRule: false, international: true, forgedApproval: true, sub: 's', groups: [], actor: { registered: true } }).decision, 'STEP_UP', 'the airline-only fields mean nothing without fareRule');
});
