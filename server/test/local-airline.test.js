// The airline pack on the REAL tool server over real HTTP (design-airline-real.md 4 and 7 D.S2): the booking rule, hostile arguments, the approval path,
// the per-pack group gate. Every flight, fare and group here is LAB-INVENTED.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { AIRLINE_SCOPES, ALL_SCOPES, TIER_GROUP, TIER_GROUP_AIRLINE } from './localFakeIdp.js';
import { startRig } from './localHarness.js';
import { FLIGHTS } from '../src/local/data.js';
import { argsDigest, createHitl } from '../src/local/hitl.js';
import { findWords } from './wordScan.js';

let rig;
before(async () => { rig = await startRig(); });
after(async () => { await rig.close(); });

const BOOK = (o = {}) => rig.token({ scope: 'flights:book', ...o });
const auditOf = (r) => JSON.parse(r.headers['x-gw-audit-trail']);
const book = (args, o = {}) => rig.call('book_airline_flight', args, { tok: o.tok ?? BOOK(), ...(o.session ? { session: o.session } : {}) });
const approve = async (id) => rig.hitl(`/${id}/respond`, { body: { decision: 'approved', respondedBy: 'test phone' } });

test('scope: a token with flights:read only is refused 403 insufficient_scope naming flights:book; no token is 401 no_token', async () => {
  const r = await book({ flight: 'LK 214' }, { tok: rig.token({ scope: 'flights:read' }) });
  assert.equal(r.status, 403); assert.equal(r.json.error, 'insufficient_scope'); assert.equal(r.json.required_scope, 'flights:book'); assert.equal(auditOf(r).decision, 'DENY');
  const none = await rig.call('book_airline_flight', { flight: 'LK 214' }, { session: await rig.open() });
  assert.equal(none.status, 401); assert.equal(none.json.error, 'no_token');
  for (const tool of ['get_airline_bookings', 'get_flight_status', 'sensitive_passenger_record', 'request_change_fee_waiver']) {
    const anon = await rig.call(tool, {}, { session: await rig.open() });
    assert.equal(anon.status, 401, tool); assert.equal(anon.json.reason, 'no_token', tool);
  }
  assert.equal((await rig.call('list_airports', {}, { session: await rig.open() })).status, 200, 'the public tool needs no token');
});

test('hostile flight: an unknown, folded, prototype, object, array or huge value is -32602 with fixed text, never echoed', async () => {
  const tok = BOOK(); const session = await rig.open(tok);
  for (const flight of ['LK 999', 'lk 214', 'LK 214 ', '__proto__', 'constructor', 'toString', {}, ['LK 214'], 214, null, true, 'x'.repeat(10_000), '']) {
    const r = await rig.call('book_airline_flight', { flight }, { tok, session });
    assert.equal(r.json.error.code, -32602, JSON.stringify(flight).slice(0, 30));
    assert.equal(r.json.error.message, 'invalid arguments: flight is not valid');
    assert.ok(!r.text.includes('x'.repeat(50)) && !r.text.includes('LK 999') && !r.text.includes('__proto__'), 'the request is never echoed');
  }
  assert.equal((await rig.call('book_airline_flight', {}, { tok, session })).json.error.message, 'invalid arguments: flight is required');
  for (const cabin of ['first', 'Business', 'ECONOMY', '', 7, {}, ['economy'], null]) {
    const r = await rig.call('book_airline_flight', { flight: 'LK 214', cabin }, { tok, session });
    assert.equal(r.json.error.code, -32602, JSON.stringify(cabin));
    assert.equal(r.json.error.message, 'invalid arguments: cabin is not valid');
  }
});

test('the fare is never the caller\'s: fare, amount, price, international, confirmation, cabin_booked and any other field are refused one at a time', async () => {
  const tok = BOOK(); const session = await rig.open(tok);
  for (const field of ['fare', 'amount', 'price', 'international', 'confirmation', 'cabin_booked', 'fare_judged', 'surprise']) {
    const r = await rig.call('book_airline_flight', { flight: 'LK 704', cabin: 'business', [field]: 1 }, { tok, session });
    assert.equal(r.json.error.code, -32602, field);
    assert.equal(r.json.error.message, 'invalid arguments: unexpected field', field);
  }
  const ok = await book({ flight: 'LK 214', cabin: 'business' }, { tok, session });
  assert.equal(ok.result.fare_judged, FLIGHTS['LK 214'].fare);
});

// [flight, fare, domestic?, expected decision for business, because]
const MATRIX = [
  ['LK 109', 150, 'PERMIT', null], ['LK 214', 380, 'PERMIT', null], ['LK 330', 400, 'PERMIT', null],
  ['LK 331', 401, 'CONSTRAINED', ['over-limit']], ['LK 322', 380, 'CONSTRAINED', ['international']], ['LK 800', 1100, 'CONSTRAINED', ['international', 'over-limit']],
  ['LK 560', 780, 'CONSTRAINED', ['over-limit']], ['LK 650', 1500, 'CONSTRAINED', ['over-limit']],
  ['LK 651', 1501, 'HITL_REQUIRED', null], ['LK 704', 2400, 'HITL_REQUIRED', null],
];
test('the boundary matrix by flight: 400 allowed, 401 and 1500 narrowed, 1501 and 2400 a person; international always narrowed', async () => {
  const tok = BOOK(); const session = await rig.open(tok);
  for (const [flight, fare, decision, because] of MATRIX) {
    assert.equal(FLIGHTS[flight].fare, fare, flight);
    const r = await book({ flight, cabin: 'business' }, { tok, session });
    assert.equal(auditOf(r).decision, decision, flight);
    if (decision === 'HITL_REQUIRED') { assert.equal(r.status, 428, flight); continue; }
    assert.equal(r.status, 200, flight);
    assert.equal(r.result.status, 'booked'); assert.equal(r.result.fare_judged, fare); assert.equal(r.result.cabin_asked, 'business');
    assert.match(r.result.confirmation, /^LKR-[0-9A-F]{6}$/);
    assert.equal(Object.keys(r.result).at(-1), 'lab_invented'); assert.equal(r.result.lab_invented, true);
    for (const banned of ['fare', 'price', 'charged']) assert.ok(!Object.hasOwn(r.result, banned), banned);
    if (decision === 'PERMIT') {
      assert.equal(r.result.cabin_booked, 'business', flight); assert.equal(r.result.constrained, undefined, flight); assert.equal(auditOf(r).rule, 'lab-no-restriction');
    } else {
      assert.equal(r.result.cabin_booked, 'economy', flight); assert.equal(auditOf(r).rule, 'lab-fare-constrained');
      assert.deepEqual(r.result.constrained, { field: 'cabin', asked: 'business', granted: 'economy', because, limit: 400, rule: 'lab-fare-constrained' }, flight);
      assert.equal(r.result.constrained.asked, r.result.cabin_asked); assert.equal(r.result.constrained.granted, r.result.cabin_booked);
    }
  }
});

test('economy asked: permitted everywhere under the hold and never narrowed; economy over the hold is still held; the cabin defaults to economy', async () => {
  const tok = BOOK(); const session = await rig.open(tok);
  for (const [flight, , decision] of MATRIX) {
    const r = await book({ flight, cabin: 'economy' }, { tok, session });
    if (decision === 'HITL_REQUIRED') { assert.equal(r.status, 428, flight); assert.equal(auditOf(r).decision, 'HITL_REQUIRED'); continue; }
    assert.equal(r.status, 200, flight); assert.equal(auditOf(r).decision, 'PERMIT', flight);
    assert.equal(r.result.cabin_booked, 'economy'); assert.equal(r.result.constrained, undefined);
  }
  const dflt = await book({ flight: 'LK 322' }, { tok, session });
  assert.equal(dflt.result.cabin_asked, 'economy'); assert.equal(dflt.result.cabin_booked, 'economy'); assert.equal(auditOf(dflt).decision, 'PERMIT');
});

test('the hold: 428 with the fixed body and a challenge that records the fare; approval books AS ASKED with no narrowing; a replay is refused', async () => {
  const tok = BOOK(); const session = await rig.open(tok);
  const held = await book({ flight: 'LK 704', cabin: 'business' }, { tok, session });
  assert.equal(held.status, 428);
  assert.equal(held.json.error, 'approval_required'); assert.equal(held.json.reason, 'lab-fare-hold'); assert.equal(held.json.by, 'tool server'); assert.equal(held.json.tool, 'book_airline_flight');
  assert.match(held.json.challengeId, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...auditOf(held), trace: null }, { decision: 'HITL_REQUIRED', source: 'lab-policy', rule: 'lab-fare-hold', tool: 'book_airline_flight', trace: null });
  const id = held.json.challengeId;
  assert.equal((await rig.hitl(`/${id}`, { method: 'GET' })).json.amount, 2400, 'the challenge records the fare the rule judged');
  // still pending, then approved
  const pending = await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: id }, { tok, session });
  assert.equal(pending.status, 403); assert.equal(pending.json.error, 'hitl_receipt_rejected'); assert.equal(pending.json.reason, 'receipt_pending'); assert.equal(pending.headers['x-gw-audit-trail'], undefined);
  assert.equal((await approve(id)).status, 200);
  const done = await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: id }, { tok, session });
  assert.equal(done.status, 200); assert.equal(done.result.cabin_booked, 'business'); assert.equal(done.result.constrained, undefined, 'an approval beats a narrowing');
  assert.equal(done.result.international, true); assert.equal(done.result.fare_judged, 2400);
  assert.deepEqual([auditOf(done).decision, auditOf(done).rule], ['PERMIT', 'lab-fare-approved']);
  const again = await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: id }, { tok, session });
  assert.equal(again.status, 403); assert.equal(again.json.reason, 'receipt_used');
});

test('a retry of a held call with the same arguments finds the same pending challenge', async () => {
  const tok = BOOK({ sub: 'user-same' }); const session = await rig.open(tok);
  const a = await book({ flight: 'LK 651', cabin: 'business' }, { tok, session });
  const b = await book({ cabin: 'business', flight: 'LK 651' }, { tok, session });
  assert.equal(a.json.challengeId, b.json.challengeId, 'key order does not matter');
});

test('a denied approval is receipt_denied', async () => {
  const tok = BOOK(); const session = await rig.open(tok);
  const held = await book({ flight: 'LK 651', cabin: 'economy' }, { tok, session });
  await rig.hitl(`/${held.json.challengeId}/respond`, { body: { decision: 'denied', respondedBy: 'test phone' } });
  const r = await book({ flight: 'LK 651', cabin: 'economy', _hitl_challenge_id: held.json.challengeId }, { tok, session });
  assert.equal(r.status, 403); assert.equal(r.json.reason, 'receipt_denied');
});

test('a receipt is bound to the subject, the tool and the exact arguments', async () => {
  const tokA = BOOK({ sub: 'user-a' }); const sA = await rig.open(tokA);
  const tokB = BOOK({ sub: 'user-b' }); const sB = await rig.open(tokB);
  const held = await book({ flight: 'LK 704', cabin: 'business' }, { tok: tokA, session: sA });
  const id = held.json.challengeId; await approve(id);
  const mismatch = (r, why) => { assert.equal(r.status, 403, why); assert.equal(r.json.error, 'hitl_receipt_rejected', why); assert.equal(r.json.reason, 'receipt_binding_mismatch', why); };
  mismatch(await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: id }, { tok: tokB, session: sB }), 'another subject');
  mismatch(await book({ flight: 'LK 704', cabin: 'economy', _hitl_challenge_id: id }, { tok: tokA, session: sA }), 'another cabin');
  // another flight over the hold with the same receipt
  mismatch(await book({ flight: 'LK 651', cabin: 'business', _hitl_challenge_id: id }, { tok: tokA, session: sA }), 'another flight');
  // a challenge minted for ANOTHER tool, same subject, same digest as the booking
  const digest = rig.local.argsDigest({ flight: 'LK 704', cabin: 'business' });
  const other = await rig.hitl('', { body: { sub: 'user-a', tool: 'bulk_update_issues', argsDigest: digest, amount: 300 } });
  await approve(other.json.id);
  mismatch(await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: other.json.id }, { tok: tokA, session: sA }), 'another tool');
  // none of the failures spent the right receipt
  const ok = await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: id }, { tok: tokA, session: sA });
  assert.equal(ok.status, 200); assert.equal(ok.result.cabin_booked, 'business');
  assert.equal((await rig.call('get_airline_bookings', { _hitl_challenge_id: 'bad id!' }, { tok: rig.token({ scope: 'trips:read' }) })).json.error.code, -32602, 'an invalid control field');
  assert.equal((await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: 'no such challenge 1' })).json.error.code, -32602);
  assert.equal((await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: '11111111-2222-4333-8444-555555555555' })).json.reason, 'receipt_unknown');
});

test('a receipt on a call that was not held is ignored: still narrowed, and the receipt is still unspent', async () => {
  const tok = BOOK({ sub: 'user-c' }); const session = await rig.open(tok);
  const held = await book({ flight: 'LK 704', cabin: 'business' }, { tok, session });
  const id = held.json.challengeId; await approve(id);
  const narrowed = await book({ flight: 'LK 322', cabin: 'business', _hitl_challenge_id: id }, { tok, session });
  assert.equal(narrowed.status, 200); assert.equal(narrowed.result.cabin_booked, 'economy'); assert.equal(auditOf(narrowed).decision, 'CONSTRAINED');
  assert.equal((await rig.hitl(`/${id}`, { method: 'GET' })).json.status, 'approved', 'not consumed');
  const ok = await book({ flight: 'LK 704', cabin: 'business', _hitl_challenge_id: id }, { tok, session });
  assert.equal(ok.result.cabin_booked, 'business');
});

test('group gate: sensitive_passenger_record is hidden and refused 403 group_required naming Airline_OrbitTier; each pack has its own group', async () => {
  const noGroup = rig.token({ scope: 'travellers:read' });
  assert.ok(!(await rig.list(noGroup)).includes('sensitive_passenger_record'));
  const refused = await rig.call('sensitive_passenger_record', {}, { tok: noGroup });
  assert.equal(refused.status, 403); assert.equal(refused.json.error, 'group_required'); assert.equal(refused.json.required_group, 'Airline_OrbitTier'); assert.equal(auditOf(refused).decision, 'DENY');
  const softwareOnly = rig.token({ scope: 'travellers:read', groups: [TIER_GROUP] });
  assert.ok(!(await rig.list(softwareOnly)).includes('sensitive_passenger_record'));
  assert.equal((await rig.call('sensitive_passenger_record', {}, { tok: softwareOnly })).json.error, 'group_required');
  const airlineOnly = rig.token({ scope: `${ALL_SCOPES} ${AIRLINE_SCOPES}`, groups: [TIER_GROUP_AIRLINE] });
  const names = await rig.list(airlineOnly);
  assert.ok(names.includes('sensitive_passenger_record')); assert.ok(!names.includes('get_project_security_settings'), 'the airline group does not unlock the software tool');
  assert.equal((await rig.call('get_project_security_settings', {}, { tok: airlineOnly })).json.required_group, 'Software_EnterpriseTier');
  const ok = await rig.call('sensitive_passenger_record', {}, { tok: airlineOnly });
  assert.equal(ok.status, 200); assert.equal(ok.result.passport_last4, '4471'); assert.equal(ok.result.known_traveller_number, 'on file (hidden)'); assert.equal(Object.keys(ok.result).at(-1), 'lab_invented');
  assert.ok(!/\d{6,}/.test(JSON.stringify(ok.result)), 'no full number');
});

test('a configured airline group name is the one the gate reads', async () => {
  const other = await startRig({ tierGroupAirline: 'Orbit_Custom' });
  try {
    const mk = (groups) => other.token({ scope: 'travellers:read', groups });
    assert.equal((await other.call('sensitive_passenger_record', {}, { tok: mk([TIER_GROUP_AIRLINE]) })).json.required_group, 'Orbit_Custom');
    assert.equal((await other.call('sensitive_passenger_record', {}, { tok: mk(['Orbit_Custom']) })).status, 200);
  } finally { await other.close(); }
});

test('the other airline tools: bookings, flight status, airports and the fee waiver request', async () => {
  const tok = rig.token({ scope: AIRLINE_SCOPES }); const session = await rig.open(tok);
  const trips = (await rig.call('get_airline_bookings', {}, { tok, session })).result;
  assert.equal(trips.total, 2); assert.equal(trips.returned, 2); assert.equal(trips.trips[0].flight, 'LK 214'); assert.equal(trips.signed_in_sub, 'user-lab-1'); assert.equal(Object.keys(trips).at(-1), 'lab_invented');
  assert.equal((await rig.call('get_airline_bookings', { limit: 1 }, { tok, session })).result.trips.length, 1);
  for (const bad of [0, 11, 1.5, '5']) assert.equal((await rig.call('get_airline_bookings', { limit: bad }, { tok, session })).json.error.code, -32602);
  const st = (await rig.call('get_flight_status', { flight: 'LK 322' }, { tok, session })).result;
  assert.deepEqual([st.flight, st.route, st.status, st.gate], ['LK 322', 'ORD to YYZ', 'on time', 'C9']);
  assert.equal((await rig.call('get_flight_status', {}, { tok, session })).result.flight, 'LK 214', 'the default flight');
  const air = (await rig.call('list_airports', { limit: 3 }, { session: await rig.open() })).result;
  assert.equal(air.total, 11); assert.deepEqual(air.airports.map((a) => a.code), ['MDW', 'ORD', 'DEN']);
  const fee = (await rig.call('request_change_fee_waiver', { reason: 'Lab request: waive the change fee' }, { tok, session })).result;
  assert.match(fee.request_id, /^CFW-[0-9A-F]{6}$/); assert.equal(fee.status, 'pending review'); assert.equal(fee.requested_by, 'user-lab-1');
  assert.equal((await rig.call('request_change_fee_waiver', {}, { tok, session })).json.error.message, 'invalid arguments: reason is required');
  assert.equal(rig.local.toolNames.length, 16); assert.ok(!rig.local.toolNames.some((n) => /^grant_/.test(n)), 'no tool grants a waiver');
});

test('no airline answer, descriptor or refusal carries a banned word, a UC id, or a claim that PingOne Authorize decided', async () => {
  const tok = rig.token({ scope: `${ALL_SCOPES} ${AIRLINE_SCOPES}`, groups: [TIER_GROUP_AIRLINE] }); const session = await rig.open(tok);
  const listed = await rig.rpc('tools/list', {}, { tok, session });
  const seen = [listed.json.result.tools.filter((t) => ['get_airline_bookings', 'get_flight_status', 'book_airline_flight', 'sensitive_passenger_record', 'list_airports', 'request_change_fee_waiver'].includes(t.name))];
  for (const [name, args] of [['get_airline_bookings', {}], ['get_flight_status', {}], ['book_airline_flight', { flight: 'LK 322', cabin: 'business' }], ['book_airline_flight', { flight: 'LK 704', cabin: 'business' }], ['sensitive_passenger_record', {}], ['list_airports', {}], ['request_change_fee_waiver', { reason: 'x' }]]) {
    seen.push((await rig.call(name, args, { tok, session })).json);
  }
  const text = JSON.stringify(seen);
  assert.deepEqual(findWords(seen), [], 'the word scan');
  assert.ok(!/\bUC\d/.test(text)); assert.ok(!/PingOne Authorize/.test(text), 'the tool server never names a product as its decider');
});

test('the 428 hold body names the fare and the flag the rule judged (the lab reads them, never its own staged copy)', async () => {
  const held = await book({ flight: 'LK 704', cabin: 'business' }, { tok: BOOK({ sub: 'user-hold-body' }) });
  assert.equal(held.status, 428); assert.equal(held.json.fare_judged, 2400); assert.equal(held.json.international, true);
  const dom = await book({ flight: 'LK 651', cabin: 'business' }, { tok: BOOK({ sub: 'user-hold-body-2' }) });
  assert.equal(dom.json.fare_judged, 1501); assert.equal(dom.json.international, false);
});

test('a session opened with no token cannot be used by a token whose sub is the word anon, and a signed-in session cannot be used with no token', async () => {
  const anonSession = await rig.open();
  const r = await book({ flight: 'LK 214', cabin: 'economy' }, { tok: BOOK({ sub: 'anon' }), session: anonSession });
  assert.equal(r.status, 404); assert.equal(r.json.error, 'session_unknown');
  const signedIn = await rig.open(BOOK({ sub: 'anon' }));
  const back = await rig.call('list_airports', {}, { session: signedIn });
  assert.equal(back.status, 404); assert.equal(back.json.error, 'session_unknown');
});

test('a challenge minted for ANOTHER tool, carrying the booking\'s own argument digest, is refused for the booking and is not spent (the tool binding itself)', () => {
  const hitl = createHitl();
  const digest = argsDigest({ flight: 'LK 704', cabin: 'business' });
  const made = hitl.create({ sub: 'user-x', tool: 'bulk_update_issues', argsDigest: digest, amount: 12 });
  hitl.respond(made.id, { decision: 'approved', respondedBy: 'test phone' });
  assert.deepEqual(hitl.verify(made.id, { sub: 'user-x', tool: 'book_airline_flight', argsDigest: digest }), { valid: false, reason: 'receipt_binding_mismatch' });
  assert.equal(hitl.get(made.id).status, 'approved', 'a refused verify spends nothing');
  assert.equal(hitl.verify(made.id, { sub: 'user-x', tool: 'bulk_update_issues', argsDigest: digest }).valid, true, 'the tool it was minted for still accepts it');
});
