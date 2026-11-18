// The airline pack's replies, proposals, constrained family and cast (design sections 1.1, 1.5 and D10). Values are LAB-INVENTED.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST, findUseCase } from '../src/manifest.js';
import { VERTICALS, STUB_VERTICALS, PERSONAS, toolFor, roleOf, extrasOf, TOOL_ROLES, OPTIONAL_CAST_KEYS, DEFAULT_VERTICAL, DEFAULT_CAST, verticalList, unfilled } from '../src/cast.js';
import { runUseCase } from '../src/flow.js';
import { localize } from '../src/routes.js';
import { REPLIES, proposalFor, replyFor, templateFor, valuesFor, money } from '../src/replies.js';
import { FARE_RULE } from '../src/policy.js';

const cast = VERTICALS.airline;
const run = (id, persona = 'standard', vertical = 'airline') => runUseCase(findUseCase(id), { cast: VERTICALS[vertical], vertical, persona, seed: 't' });
const toolsOf = (c) => new Set([c.castReadTool, ...MANIFEST.usecases.filter((u) => u.primaryTool).map((u) => toolFor(c, u.primaryTool))]);
const AIRLINE_TOOLS = ['get_airline_bookings', 'get_flight_status', 'book_airline_flight', 'sensitive_passenger_record', 'list_airports', 'request_change_fee_waiver'];
const BOOKING = { flight: 'LK 322', from: 'ORD', city: 'Toronto', day: 'Friday', conf: 'LKR7Q2' };

test('the cast: Larkspur Air is the first key, the default, and every value is a plain short string (invented brand, never a real airline)', () => {
  assert.deepEqual(Object.keys(VERTICALS), ['airline', 'banking', 'healthcare', 'retail', 'software']);
  assert.equal(DEFAULT_VERTICAL, 'airline'); assert.equal(DEFAULT_CAST, cast);
  assert.equal(cast.castBrand, 'Larkspur Air'); assert.equal(cast.castHost, 'larkspur-air');
  assert.deepEqual([cast.castUser, cast.castUser2, cast.castOwner2, cast.castAgent, cast.castAgent2, cast.castAgent3, cast.castAdmin],
    ['elena.novak', 'jun.takeda', 'marcus.bell', 'travel-assistant', 'bookings-specialist', 'report-generalist', 'sofia.reyes']);
  assert.deepEqual([cast.castReadTool, cast.castWriteTool, cast.castSensitiveTool, cast.castA2aTool, cast.castPublicTool, cast.castStatusTool, cast.castRequestTool],
    ['get_airline_bookings', 'book_airline_flight', 'sensitive_passenger_record', 'get_airline_bookings', 'list_airports', 'get_flight_status', 'request_change_fee_waiver']);
  assert.deepEqual([cast.castAsset, cast.castAction, cast.castGroup, cast.castPerson, cast.castMoney], ['trip', 'booking', 'orbit-tier', 'traveller', 'trips and bookings']);
  for (const val of Object.values(cast)) { assert.equal(typeof val, 'string'); assert.ok(val.length > 0 && val.length < 41, val); assert.ok(!/[:/@]/.test(val), val); }
  assert.equal(new Set(Object.values(VERTICALS).map((p) => p.castUser)).size, 5);
  assert.equal(cast.castUnit, undefined, 'a count unit would print "380 trips" and bypass the booking logic');
  assert.equal(cast.castScanTool, undefined, 'third-party scan keeps the state rule');
  for (const k of ['castFareRule', 'castFareLimit', 'castFareHold', 'castPublicTool', 'castStatusTool', 'castRequestTool', 'castPerson']) assert.ok(OPTIONAL_CAST_KEYS.includes(k), `${k} is an optional cast key`);
});

test('five full packs and six stubs: eleven verticals; the airlines stub is gone', () => {
  const list = verticalList();
  assert.equal(list.length, 11);
  assert.deepEqual(list.filter((v) => v.pack === 'full').map((v) => v.id), ['airline', 'banking', 'healthcare', 'retail', 'software']);
  assert.equal(list.filter((v) => v.pack === 'stub').length, 6);
  assert.ok(!Object.hasOwn(STUB_VERTICALS, 'airlines'));
  assert.equal(list[0].id, 'airline', 'the menu opens on the default');
});

test('the airline write role is reached through toolFor, TOOL_ROLES stays four, and the pack carries its own scope names', () => {
  assert.deepEqual(Object.values(TOOL_ROLES).sort(), ['a2a', 'read', 'sensitive', 'write']);
  assert.equal(toolFor(cast, 'create_transfer'), 'book_airline_flight'); assert.equal(toolFor(cast, 'book_airline_flight'), 'book_airline_flight');
  assert.equal(toolFor(cast, 'get_account_balance'), 'get_airline_bookings'); assert.equal(toolFor(cast, 'get_sensitive_account_details'), 'sensitive_passenger_record');
  assert.equal(toolFor(cast, 'get_branch_hours'), 'list_airports'); assert.equal(toolFor(cast, 'show_mortgage'), 'get_flight_status'); assert.equal(toolFor(cast, 'request_fee_waiver'), 'request_change_fee_waiver');
  assert.equal(toolFor(cast, 'get_weather'), 'get_weather'); assert.equal(toolFor(cast, 'brave_news_search'), 'brave_news_search');
  assert.equal(roleOf('book_airline_flight'), null, 'not a policy role');
  const x = extrasOf('airline');
  assert.deepEqual(x.scopes, { read: 'trips:read', write: 'flights:book', sensitive: 'travellers:read', a2a: 'records:read' });
  assert.deepEqual(x.authz, { type: 'flight-booking', maxKey: 'maxFare' }); assert.equal(x.intent, 'flight-booking:limited');
});

test('D10: the fare numbers are cast text AND data text, and all three equal the rule (a number is never typed twice)', () => {
  assert.equal(cast.castFareRule, 'fare');
  assert.equal(cast.castFareLimit, money(FARE_RULE.limit)); assert.equal(cast.castFareHold, money(FARE_RULE.hold));
  const common = REPLIES.values.airline.common;
  assert.equal(common.limit, money(FARE_RULE.limit)); assert.equal(common.hold, money(FARE_RULE.hold));
  assert.equal(common.defaultAmount, 380);
});

test('every airline tool a use case can run has an airline reply, every {{name}} is filled for both personas, and none says a banking word', () => {
  const tools = toolsOf(cast);
  for (const t of AIRLINE_TOOLS) assert.equal(typeof REPLIES.replies.airline[t], 'string', t);
  for (const t of tools) assert.equal(typeof templateFor('airline', t), 'string', `${t} has a template`);
  const BANKING = /\b(balance|transfers?|checking|savings|mortgage|bank(ing)?|deposit|portfolio|branch(es)?|fee waiver)\b/i;
  for (const persona of PERSONAS) for (const t of tools) {
    const values = valuesFor({ cast, vertical: 'airline', persona, tool: t, amount: 380, args: {} });
    assert.deepEqual(unfilled(templateFor('airline', t), values), [], `${persona} ${t}`);
    const said = replyFor({ cast, vertical: 'airline', persona, tool: t, amount: 380 });
    assert.doesNotMatch(said, /\{\{|undefined|null|mock result/, said);
    assert.doesNotMatch(said, BANKING, `${persona} ${t}: ${said}`); // a miles balance is an airline word
    assert.ok(!said.includes(t), `the reply does not name ${t}`);
  }
  for (const t of Object.values(REPLIES.proposals.airline)) assert.deepEqual(unfilled(t, valuesFor({ cast, vertical: 'airline', persona: 'standard', tool: 'book_airline_flight' })), []);
});

test('the exact replies: both personas, lab-invented values', () => {
  const say = (tool, persona = 'standard', extra = {}) => replyFor({ cast, vertical: 'airline', persona, tool, ...extra });
  assert.equal(say('get_airline_bookings'), 'You have 2 upcoming trips: LK 214 to Denver on Friday, seat 14C; and LK 560 to Boston on December 4, seat 22A. You also have 18,400 miles on file.');
  assert.equal(say('get_airline_bookings', 'premium'), 'You have 2 upcoming trips: LK 704 to Paris on November 28, seat 2A; and LK 214 to Denver on Friday, seat 3C. You also have 96,200 miles on file.');
  assert.equal(say('get_flight_status'), 'Your flight LK 214 to Denver is on time: it leaves from gate B12 at 8:15 am.');
  assert.equal(say('sensitive_passenger_record'), 'Your traveller record is on file: passport ending 4471, a known traveller number, and a card ending 4821. Full numbers stay masked in chat.');
  assert.equal(say('list_airports'), "The nearest airports are Midway (MDW), 14 miles away, and O'Hare (ORD), 17 miles away. Larkspur Air flies from both.");
  assert.equal(say('request_change_fee_waiver'), "I've filed request CFW-318 to waive the $75.00 change fee on your trip. I can't grant it myself; a Larkspur Air service agent will review it.");
  assert.equal(say('book_airline_flight', 'standard', { amount: 380, booking: { ...BOOKING, city: 'Denver', flight: 'LK 214' } }), 'Booked: a business seat on LK 214 from ORD to Denver on Friday for $380. Your confirmation code is LKR7Q2.');
  assert.equal(proposalFor({ cast, vertical: 'airline', persona: 'standard', tool: 'book_airline_flight', amount: 2400, booking: { flight: 'LK 704', city: 'Paris' } }), "I'm ready to book a business seat on LK 704 to Paris for $2,400.");
});

test('the constrained family fires only for a constrained run, only in the airline pack, with the reason filled', () => {
  const input = { cast, vertical: 'airline', persona: 'standard', tool: 'book_airline_flight', amount: 380, booking: BOOKING };
  assert.equal(replyFor({ ...input, constrained: { because: ['international'] } }), 'Booked, but in economy instead of business: this trip is international, so the booking rule allows economy only. LK 322 from ORD to Toronto on Friday, confirmation LKR7Q2.');
  assert.match(replyFor({ ...input, amount: 780, constrained: { because: ['over-limit'] } }), /: \$780 is over the \$400 limit, so the booking rule allows economy only\./);
  assert.match(replyFor({ ...input, amount: 1100, constrained: { because: ['international', 'over-limit'] } }), /this trip is international and \$1,100 is over the \$400 limit/);
  assert.doesNotMatch(replyFor(input), /economy/, 'a run that is not constrained takes the unchanged path');
  // another pack, even given the field, never reads the family
  const banking = { cast: VERTICALS.banking, vertical: 'banking', persona: 'standard', tool: 'create_transfer', amount: 600 };
  assert.equal(replyFor({ ...banking, constrained: { because: ['international'] } }), replyFor(banking));
  assert.equal(replyFor({ ...banking, booking: BOOKING }), replyFor(banking));
});

test('miles appear only as data inside the trips reply, and redeem_miles keeps its shared sentence', () => {
  assert.equal(REPLIES.replies.shared.redeem_miles, 'Done: 25,000 miles redeemed for a $250.00 travel credit.');
  assert.ok(!Object.hasOwn(REPLIES.replies.airline, 'redeem_miles'));
});

test('the airline pack has no banking word in any run, any persona (credit only in the shared miles line)', () => {
  const BANKING = /\b(balance|transfers?|checking(?! (the|policy|its|only)\b)|savings|mortgage|bank(ing)?|deposit|portfolio|branch(es)?|fee waiver)\b/i;
  for (const persona of PERSONAS) for (const uc of MANIFEST.usecases) {
    const s = JSON.stringify(run(uc.id, persona));
    assert.doesNotMatch(s, BANKING, `${persona} ${uc.id}: ${s.match(new RegExp(`.{0,60}${BANKING.source}.{0,60}`, 'i'))?.[0]}`);
  }
});

test('a use case in the airline pack reaches the run in the airline\'s own words (titles, not ids; the four story words)', () => {
  const words = (id) => localize(findUseCase(id), 'airline');
  assert.equal(run('UC7').useCase.title, 'Booking within the limit'); assert.equal(words('UC7').title, 'Booking within the limit');
  assert.equal(run('UC8').useCase.title, 'International booking, economy only');
  assert.equal(run('UC6').useCase.title, 'Booking over the higher limit');
  assert.equal(run('UC27').useCase.title, 'Approval claimed, not proven');
  assert.equal(run('UC22').useCase.title, 'Approval on your own phone');
  assert.equal(run('UC48').useCase.title, 'Consumer Agent — governed flight booking');
  // UC48's catalog solution sentence would say the product holds the booking; the pack overrides it so the page never contradicts a CONSTRAINED run
  assert.doesNotMatch(words('UC48').pingOneSolution, /consent obligation|waits for a verified/i);
  assert.match(words('UC48').pingOneSolution, /reference setup/);
  assert.match(words('UC8').pingOneSolution, /not claimed here/);
});

test('the other packs keep the old replies byte for byte', () => {
  assert.equal(replyFor({ cast: VERTICALS.banking, vertical: 'banking', persona: 'standard', tool: 'create_transfer', amount: 600 }), 'Done: $600 moved from checking to savings.');
  assert.equal(replyFor({ cast: VERTICALS.software, vertical: 'software', persona: 'standard', tool: 'bulk_update_issues', amount: 600 }), 'Done: 600 issues in the Billing project moved to Done.');
});
