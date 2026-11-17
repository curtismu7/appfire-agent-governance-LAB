// The two copies of the tool tables (design-real-local.md E.2): provider.js (the lab's side) and local/registry.js, policy.js (the child's side) must agree. The
// child's code is read-only here (the one allowed import).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_TOOLS, TOOL_SCOPES, PUBLIC_TOOLS, GROUP_GATED_TOOLS, TOOL_PACK, PACK_OF_TOOL_SERVER } from '../src/provider.js';
import { BANDS, FARE_RULE, GATEWAY, SCANNER_REPOS as LAB_SCANNER_REPOS, decide as labDecide } from '../src/policy.js';
import { VERTICALS } from '../src/cast.js';
import { AIRPORTS, FLIGHTS, isInternational } from '../src/local/data.js';
import { FLIGHTS as FAKE_FLIGHTS, COUNTRY as FAKE_COUNTRY } from './fakeToolServer.js';
import { createHitl } from '../src/local/hitl.js';
import { decide as toolDecide } from '../src/local/policy.js';
import { situationOf } from '../src/situations.js';
import { SE_MCP_TOOLS } from '../src/realGate.js';

const reg = await import('../src/local/registry.js');   // a missing registry is a failing test (an import error), never a skipped one

test('the tool names, the scope each needs, the public tool and the group-gated tool are the same in both copies', () => {
  const names = Object.keys(reg.TOOL_META);
  assert.equal(names.length, 16); assert.deepEqual([...LOCAL_TOOLS].sort(), [...names].sort());
  assert.deepEqual(Object.fromEntries(Object.entries(TOOL_SCOPES).sort()), Object.fromEntries(names.map((n) => [n, reg.TOOL_META[n].scope]).sort()));
  assert.deepEqual([...PUBLIC_TOOLS].sort(), names.filter((n) => reg.TOOL_META[n].public).sort());
  assert.deepEqual([...GROUP_GATED_TOOLS].sort(), names.filter((n) => reg.TOOL_META[n].group).sort());
  // Every scope a tool needs is one of the eleven scopes of the PingOne resource, and every scope is used by some tool.
  assert.deepEqual([...new Set(Object.values(TOOL_SCOPES).filter(Boolean))].sort(), [...reg.SCOPES].sort());
  // The tools the SE gateway also serves under the same names (the third-party two) are not a second copy of anything here.
  for (const n of ['brave_news_search', 'code_search']) assert.ok(SE_MCP_TOOLS.has(n));
});

test('the lab\'s bands are the engine\'s bands minus the reserved CIBA band; the scanner repositories and the blocked terms are the engine\'s', () => {
  assert.deepEqual(reg.BANDS.map(({ min, decision }) => ({ min, decision })), BANDS.money.filter((b) => b.decision !== 'CIBA'));
  assert.deepEqual(reg.BANDS.map((b) => b.rule), ['lab-band-deny', 'lab-band-step-up', 'lab-band-hold']);
  assert.deepEqual(reg.SCANNER_REPOS, LAB_SCANNER_REPOS); assert.deepEqual(reg.BLOCKED_TERMS, GATEWAY.blockedTerms);
});

test('every in-scope write amount is outside the reserved CIBA band [100, 200), and lands in the band the use case is about', () => {
  const band = (n) => reg.BANDS.find((b) => n >= b.min)?.decision ?? 'PERMIT';
  for (const [id, want] of [['UC6', 'DENY'], ['UC7', 'STEP_UP'], ['UC8', 'HITL_REQUIRED']]) {
    const n = situationOf(id, 'software').amount; assert.ok(Number.isFinite(n), id); assert.ok(!(n >= 100 && n < 200), `${id}: ${n} is in the reserved CIBA band`); assert.equal(band(n), want, id);
  }
  assert.equal(band(25), 'PERMIT', 'the default amount');
});

test('the situations the tool server\'s edge rules need: UC30 scans an allowed repository, UC31 a refused one, UC42 a blocked term', () => {
  assert.ok(reg.SCANNER_REPOS.includes(situationOf('UC30', 'software').args?.repo ?? 'platform')); assert.ok(!reg.SCANNER_REPOS.includes(situationOf('UC31', 'software').args.repo));
  const q = situationOf('UC42', 'software').args.query.toLowerCase(); assert.ok(reg.BLOCKED_TERMS.some((t) => q.includes(t)));
});

// ---- the airline pack (design-airline-real.md 7 D.S3) ----
const AIRLINE_TOOLS = ['get_airline_bookings', 'get_flight_status', 'book_airline_flight', 'sensitive_passenger_record', 'list_airports', 'request_change_fee_waiver'];

test('TOOL_PACK equals the registry pack of every tool; PACK_OF_TOOL_SERVER names the two cast values; the fare copy equals the lab\'s FARE_RULE', () => {
  const names = Object.keys(reg.TOOL_META);
  assert.deepEqual(Object.fromEntries(Object.entries(TOOL_PACK).sort()), Object.fromEntries(names.map((n) => [n, reg.TOOL_META[n].pack]).sort()));
  assert.deepEqual(names.filter((n) => reg.TOOL_META[n].pack === 'airline'), AIRLINE_TOOLS);
  assert.deepEqual(PACK_OF_TOOL_SERVER, { 'work-suite': 'software', 'larkspur-air': 'airline' });
  for (const v of ['software', 'airline']) assert.ok(Object.hasOwn(PACK_OF_TOOL_SERVER, VERTICALS[v].castToolServer), v);
  assert.deepEqual({ ...reg.FARE }, { ...FARE_RULE });
  assert.equal(VERTICALS.airline.castFareLimit, '$400'); assert.equal(VERTICALS.airline.castFareHold, '$1,500');
});

test('for every flight and cabin the lab engine and the tool server reach the same decision, and the same narrowing', () => {
  const cfg = { tierGroup: 'Software_EnterpriseTier', tierGroupAirline: 'Airline_OrbitTier' };
  const auth = { scopes: ['flights:book'], groups: [], claims: { sub: 'parity-user' } };
  for (const [flight, f] of Object.entries(FLIGHTS)) {
    for (const cabin of ['business', 'economy']) {
      const lab = labDecide({ fareRule: true, role: 'write', tool: 'book_airline_flight', amount: f.fare, international: isInternational(f), cabin });
      const tool = toolDecide({ name: 'book_airline_flight', rawArgs: { flight, cabin }, auth, config: cfg, hitl: createHitl(), now: Date.now });
      assert.equal(tool.audit.decision, lab.decision, `${flight} ${cabin}`);
      if (lab.decision === 'CONSTRAINED') assert.deepEqual(tool.payload.constrained.because, lab.constrain.because, `${flight} ${cabin}`);
      if (lab.decision === 'PERMIT') assert.equal(tool.payload.constrained, undefined, `${flight} ${cabin}`);
    }
  }
});

test('every airline situation with a trip names a flight the tool server holds, with the same fare, flag and route', () => {
  for (const id of ['UC6', 'UC7', 'UC8', 'UC14b', 'UC22', 'UC27', 'UC48']) {
    const sit = situationOf(id, 'airline'); const f = FLIGHTS[sit.trip.flight];
    assert.ok(f, `${id}: ${sit.trip.flight} is in the table`);
    assert.equal(sit.amount, f.fare, `${id}: amount`);
    assert.equal(sit.international === true, isInternational(f), `${id}: international`);
    assert.equal(sit.trip.from, f.from, id); assert.equal(sit.trip.to, f.to, id);
  }
});

test('the fake tool server\'s own flight and country tables (a third copy of the rule\'s data) equal the real tool server\'s tables', () => {
  assert.deepEqual(Object.keys(FAKE_FLIGHTS), Object.keys(FLIGHTS));
  for (const [id, f] of Object.entries(FLIGHTS)) assert.deepEqual(FAKE_FLIGHTS[id], [f.from, f.to, f.fare], id);
  // the fake holds the countries of the airports the flights use (MDW is listed by list_airports only); each must equal the real one and every flight end must be there
  for (const [code, country] of Object.entries(FAKE_COUNTRY)) assert.equal(AIRPORTS[code].country, country, code);
  for (const f of Object.values(FLIGHTS)) for (const code of [f.from, f.to]) assert.ok(Object.hasOwn(FAKE_COUNTRY, code), code);
});
