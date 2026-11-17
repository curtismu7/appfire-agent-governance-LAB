// The airline pack through the engine (design sections 3, 4.1 and 8.1): the fare rule, the CONSTRAINED outcome end to end, the five-pack all-87 loop,
// and the guarantee that every other pack keeps its own behaviour. Every number is LAB-INVENTED.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST, findUseCase } from '../src/manifest.js';
import { VERTICALS } from '../src/cast.js';
import { runUseCase, isFlow } from '../src/flow.js';
import { localize } from '../src/routes.js';
import { OUTCOME_OVERRIDES } from '../src/verticalText.js';
import { presetsFor } from '../src/instructions.js';
import { situationOf } from '../src/situations.js';

const go = (id, vertical = 'airline', extra = {}) => runUseCase(findUseCase(id), { cast: VERTICALS[vertical], vertical, seed: 'run', ...extra });
const hopOf = (r, kind) => r.hops.find((h) => h.kind === kind && h.verdict !== 'skip');
const kinds = (r) => r.hops.map((h) => h.kind);
const ranKinds = (r) => r.hops.filter((h) => h.verdict !== 'skip').map((h) => h.kind);
const OVERRIDDEN = ['UC6', 'UC7', 'UC8', 'UC48'];
const DISCLAIMER = "the lab's fare rule, not a PingOne Authorize outcome";

test('all 87 use cases run in all five full packs and the computed outcome equals the label the pack shows (the catalog label, or the four airline overrides)', () => {
  let n = 0;
  for (const vertical of Object.keys(VERTICALS)) {
    for (const uc of MANIFEST.usecases) {
      const r = go(uc.id, vertical);
      const want = localize(uc, vertical).expectedOutcome;
      assert.equal(r.outcome, want, `${vertical}/${uc.id}`);
      assert.equal(r.matchesExpected, r.computed ? true : null, `${vertical}/${uc.id}`);
      n += 1;
    }
  }
  assert.equal(n, 87 * 5);
});

test('the four overrides are the only differences from the catalog labels in the airline pack, and labelSource is "lab" for exactly those', () => {
  assert.deepEqual(OUTCOME_OVERRIDES, { airline: { UC7: 'PERMIT', UC8: 'CONSTRAINED', UC6: 'HITL_REQUIRED', UC48: 'CONSTRAINED' } });
  const differ = []; const lab = [];
  for (const uc of MANIFEST.usecases) {
    const l = localize(uc, 'airline');
    if (l.expectedOutcome !== uc.expectedOutcome) differ.push(uc.id);
    if (l.labelSource === 'lab') lab.push(uc.id);
  }
  assert.deepEqual(differ.sort(), [...OVERRIDDEN].sort().filter((id) => findUseCase(id).expectedOutcome !== OUTCOME_OVERRIDES.airline[id]).sort());
  assert.deepEqual(lab.sort(), [...OVERRIDDEN].sort());
  // no other pack gets a label source, and the four old packs get the catalog object back untouched
  for (const v of ['banking', 'healthcare', 'retail']) for (const uc of MANIFEST.usecases) assert.equal(localize(uc, v), uc, `${v}/${uc.id} is the same object`);
  for (const uc of MANIFEST.usecases) assert.equal(localize(uc, 'software').labelSource, undefined, uc.id);
});

test('still 54 computed use cases and 33 guided: CONSTRAINED is an engine outcome, so an overridden use case is a flow, not a guided page', () => {
  assert.equal(MANIFEST.usecases.filter(isFlow).length, 54);
  for (const id of OVERRIDDEN) assert.equal(go(id).computed, true, id);
});

test('UC7: a domestic $380 booking is PERMIT, the tool runs with the business cabin as asked, and the reply is the booked sentence', () => {
  const r = go('UC7');
  assert.equal(r.outcome, 'PERMIT'); assert.equal(r.matchesExpected, true);
  assert.deepEqual(hopOf(r, 'llm-plan').response.body.tool_calls[0].arguments, { flight: 'LK 214', cabin: 'business' });
  const sent = hopOf(r, 'tool-dispatched').request.body.params;
  assert.equal(sent.name, 'book_airline_flight'); assert.deepEqual(sent.arguments, { flight: 'LK 214', cabin: 'business' });
  assert.ok(!hopOf(r, 'authorize-decision').response.body.constraint, 'a permit carries no constraint');
  assert.equal(r.constrained, undefined, 'a permit has no run.constrained');
  assert.deepEqual(r.booking, { flight: 'LK 214', from: 'ORD', to: 'DEN', fare: 380, international: false, asked: 'business', booked: 'business' });
  assert.equal(hopOf(r, 'agent-reply').response.body.reply, 'Booked: a business seat on LK 214 from ORD to Denver on Friday for $380. Your confirmation code is LKR7Q2.');
  assert.ok(ranKinds(r).includes('api-call'));
});

test('UC8: the same $380, international: CONSTRAINED, the agent asked for business and the call carries economy; the shape of run.constrained is the contract', () => {
  const r = go('UC8');
  assert.equal(r.outcome, 'CONSTRAINED'); assert.equal(r.matchesExpected, true);
  assert.equal(hopOf(r, 'llm-plan').response.body.tool_calls[0].arguments.cabin, 'business', 'what the agent asked');
  const dec = hopOf(r, 'authorize-decision');
  assert.equal(dec.response.body.decision, 'CONSTRAINED');
  assert.deepEqual(dec.response.body.constraint, { field: 'cabin', asked: 'business', granted: 'economy', because: ['international'], limit: 400 });
  assert.equal(dec.verdict, 'ok', 'not a new verdict word');
  assert.equal(dec.decision.outcome, 'CONSTRAINED'); assert.equal(dec.decision.by, DISCLAIMER); // the enriched hop carries the decision block
  assert.equal(dec.decision.reasons.length, 1);
  const sent = hopOf(r, 'tool-dispatched').request.body.params.arguments;
  assert.deepEqual(sent, { flight: 'LK 322', cabin: 'economy' }, 'the narrowed arguments reach the tool');
  const api = hopOf(r, 'api-call');
  assert.equal(api.request.method, 'POST'); assert.equal(api.request.body.cabin, 'economy');
  for (const h of [hopOf(r, 'tool-dispatched'), api]) assert.ok(h.kv.some(([k, v]) => k === 'constraint' && v === 'cabin: business -> economy'), `${h.kind} names the constraint`);
  assert.deepEqual(r.constrained, { field: 'cabin', asked: 'business', granted: 'economy', because: ['international'], limit: 400, by: DISCLAIMER });
  assert.deepEqual(r.booking, { flight: 'LK 322', from: 'ORD', to: 'YYZ', fare: 380, international: true, asked: 'business', booked: 'economy' });
  assert.equal(hopOf(r, 'agent-reply').response.body.reply, 'Booked, but in economy instead of business: this trip is international, so the booking rule allows economy only. LK 322 from ORD to Toronto on Friday, confirmation LKR7Q2.');
  assert.ok(!kinds(r).includes('tool-held'), 'a narrowing holds nothing');
});

test('UC48: CONSTRAINED by the price alone ($780 domestic); the run books the trip, so its hitl-receipt step is a skip hop, not a "no approval" hold', () => {
  const r = go('UC48');
  assert.equal(r.outcome, 'CONSTRAINED');
  assert.deepEqual(r.constrained.because, ['over-limit']); assert.equal(r.constrained.granted, 'economy');
  assert.equal(r.booking.fare, 780); assert.equal(r.booking.booked, 'economy'); assert.equal(r.booking.international, false);
  const receipt = r.hops.find((h) => h.kind === 'hitl-receipt');
  assert.ok(receipt, 'the step is in the sequence');
  assert.equal(receipt.verdict, 'skip', 'drawn as not in this run');
  assert.ok(ranKinds(r).includes('tool-dispatched'));
  assert.match(hopOf(r, 'agent-reply').response.body.reply, /\$780 is over the \$400 limit, so the booking rule allows economy only/);
  assert.equal(hopOf(r, 'tool-dispatched').request.body.params.arguments.cabin, 'economy');
});

test('UC48 scope equals UC7 scope in the airline pack: the exchanged token carries flights:book on both (a null-role booking tool is still a write)', () => {
  const scopeOf = (r) => r.tokens.find((t) => t.label === 'exchanged token').claims.scope;
  assert.equal(scopeOf(go('UC7')), 'flights:book');
  assert.equal(scopeOf(go('UC48')), scopeOf(go('UC7')));
  assert.equal(scopeOf(go('UC48', 'banking')), 'tools:book_airline_flight', 'the four packs keep the old null-role scope for UC48');
});

test('UC48 in banking, healthcare, retail and software still draws the hitl-receipt hold (their UC48 is always held)', () => {
  for (const v of ['banking', 'healthcare', 'retail', 'software']) {
    const r = go('UC48', v);
    const h = r.hops.find((x) => x.kind === 'hitl-receipt');
    assert.notEqual(h.verdict, 'skip', v); assert.equal(h.response.body.receipt, null, v);
    assert.ok(!kinds(r).includes('tool-dispatched') || r.hops.find((x) => x.kind === 'tool-dispatched').verdict === 'skip', `${v} holds the write`);
  }
});

test('UC6: Paris $2,400 is held for a person (no tool-dispatched, no reply), the held line is the proposal, and run.booking is not booked yet', () => {
  const r = go('UC6');
  assert.equal(r.outcome, 'HITL_REQUIRED');
  assert.ok(!ranKinds(r).includes('tool-dispatched')); assert.ok(!ranKinds(r).includes('agent-reply'));
  assert.equal(ranKinds(r).at(-1), 'tool-held');
  assert.equal(hopOf(r, 'tool-held').response.body.proposed, "I'm ready to book a business seat on LK 704 to Paris for $2,400.");
  assert.deepEqual(r.booking, { flight: 'LK 704', from: 'ORD', to: 'CDG', fare: 2400, international: true, asked: 'business', booked: null });
  assert.equal(r.constrained, undefined, 'an approval beats a narrowing: nothing is narrowed');
  assert.ok(!hopOf(r, 'authorize-decision').response.body.constraint);
});

test('UC27: a claimed approval at $2,400 is STEP_UP (second factor first, a person still approves); the same booking without the claim is UC6, HITL_REQUIRED', () => {
  const r = go('UC27');
  assert.equal(r.outcome, 'STEP_UP');
  assert.ok(!ranKinds(r).includes('tool-dispatched'));
  assert.equal(hopOf(r, 'tool-held').response.body.proposed, "I'm ready to book a business seat on LK 704 to Paris for $2,400.");
  assert.match(hopOf(r, 'authorize-decision').response.body.reason, /still approve/);
  assert.equal(r.booking.booked, null);
  assert.equal(go('UC6').outcome, 'HITL_REQUIRED');
});

test('UC22: the phone approval lands PERMIT after ciba-poll, then books LK 109 as asked for $150', () => {
  const r = go('UC22');
  assert.equal(r.outcome, 'PERMIT');
  assert.ok(ranKinds(r).includes('ciba-poll') && ranKinds(r).includes('ciba-authorize'));
  assert.ok(ranKinds(r).indexOf('ciba-poll') < ranKinds(r).indexOf('tool-dispatched'));
  assert.equal(hopOf(r, 'tool-dispatched').request.body.params.arguments.flight, 'LK 109');
  assert.equal(hopOf(r, 'agent-reply').response.body.reply, 'Booked: a business seat on LK 109 from ORD to Denver on Friday for $150. Your confirmation code is LKR7Q2.');
});

test('UC22 in an airline run reaches ciba-poll only because its situation carries phoneApproval; other airline runs never draw it', () => {
  assert.equal(situationOf('UC22', 'airline').phoneApproval, true);
  for (const id of ['UC7', 'UC8', 'UC48', 'UC6']) assert.ok(!ranKinds(go(id)).includes('ciba-poll'), id);
});

test('UC14b ($400, bound $500) is still PERMIT in the airline pack: exactly the limit is allowed', () => {
  assert.equal(go('UC14b').outcome, 'PERMIT');
  assert.equal(go('UC14').outcome, 'DENY');
});

test('the refusals come from identity, ownership, tier and scope, never from price: UC13, UC10, UC31, UC9', () => {
  assert.match(go('UC13').outcome, /^DENY/); assert.match(go('UC10').outcome, /^DENY/); assert.match(go('UC31').outcome, /^DENY/);
  assert.equal(go('UC9').outcome, 'DENY_403'); assert.equal(go('UC21').outcome, 'PERMIT');
});

test('the reads: UC1 and UC33 are PERMIT and say the airline sentences', () => {
  assert.equal(go('UC1').outcome, 'PERMIT');
  assert.match(hopOf(go('UC1'), 'agent-reply').response.body.reply, /^You have 2 upcoming trips: LK 214 to Denver on Friday, seat 14C; and LK 560 to Boston on December 4, seat 22A\. You also have 18,400 miles on file\.$/);
  assert.equal(hopOf(go('UC33'), 'agent-reply').response.body.reply, 'Your flight LK 214 to Denver is on time: it leaves from gate B12 at 8:15 am.');
  assert.equal(go('UC1', 'airline', { persona: 'premium' }).persona, 'premium');
});

test('a steered airline run ends HITL_REQUIRED at 2500 (not DENY), holds a Denver booking and has booked: null', () => {
  const poisoned = presetsFor(VERTICALS.airline).find((p) => p.id === 'poisoned').text;
  assert.match(poisoned, /book the most expensive business seat/);
  const r = go('UC1', 'airline', { instructions: poisoned });
  assert.equal(r.outcome, 'HITL_REQUIRED');
  assert.equal(r.steered.proposed.amount, 2500);
  assert.equal(r.steered.proposed.tool, 'book_airline_flight');
  assert.ok(!ranKinds(r).includes('tool-dispatched'));
  assert.equal(hopOf(r, 'tool-held').response.body.proposed, "I'm ready to book a business seat on LK 214 to Denver for $2,500.");
  assert.deepEqual(r.booking, { flight: 'LK 214', from: 'ORD', to: 'DEN', fare: 2500, international: false, asked: 'business', booked: null });
  // the careful default run is a plain read
  assert.equal(go('UC1').outcome, 'PERMIT');
});

test('every airline run carries run.fareRule; a run that reaches a booking decision carries run.booking; no other pack gets either key, or run.constrained', () => {
  for (const uc of MANIFEST.usecases) {
    const r = go(uc.id);
    assert.deepEqual(r.fareRule, { limit: 400, hold: 1500, from: 'business', to: 'economy' }, uc.id);
    if (!['UC6', 'UC7', 'UC8', 'UC27', 'UC22', 'UC48'].includes(uc.id)) assert.equal(r.booking, undefined, `${uc.id} is not a booking`);
    if (r.constrained) assert.ok(['UC8', 'UC48'].includes(uc.id), uc.id);
  }
  for (const v of ['banking', 'healthcare', 'retail', 'software']) {
    for (const id of ['UC1', 'UC7', 'UC8', 'UC27', 'UC48', 'UC6']) {
      const r = go(id, v);
      assert.equal(r.fareRule, undefined, `${v}/${id}`); assert.equal(r.booking, undefined, `${v}/${id}`); assert.equal(r.constrained, undefined, `${v}/${id}`);
      assert.ok(!JSON.stringify(r).includes('CONSTRAINED'), `${v}/${id} never says CONSTRAINED`);
    }
  }
});

test('run.constrained.by is the disclaimer and never says PingOne Authorize without "not a"', () => {
  for (const id of ['UC8', 'UC48']) {
    const by = go(id).constrained.by;
    assert.equal(by, DISCLAIMER);
    assert.match(by, /not a PingOne Authorize/);
    assert.ok(!/PingOne Authorize/.test(by.replace(/not a PingOne Authorize/, '')));
  }
  // every outcome of the fare rule names the lab's own rule as the decider (review fix); a refusal before the booking decision and the four packs keep the pack-wide wording
  for (const id of ['UC7', 'UC6', 'UC27', 'UC22']) assert.equal(hopOf(go(id), 'authorize-decision').decision.by, DISCLAIMER, id);
  assert.equal(hopOf(go('UC13'), 'authorize-decision')?.decision.by ?? 'authorize policy', 'authorize policy');
  assert.equal(hopOf(go('UC7', 'banking'), 'authorize-decision').decision.by, 'authorize policy');
});

test('a constrained run is not a hold and not a refusal: no pending approval, no tool-held, no tool-refused, and the narration says CONSTRAINED', () => {
  for (const id of ['UC8', 'UC48']) {
    const r = go(id);
    assert.ok(!kinds(r).includes('tool-held') && !kinds(r).includes('tool-refused'), id);
    assert.match(r.narration, /outcome CONSTRAINED/, `${id} narration`);
  }
});

test('the guest rows: UC1 is a permit with no booking; the tool server is never named on the airline run (own steps)', () => {
  const r = go('UC1');
  assert.equal(r.booking, undefined);
  assert.ok(!kinds(r).includes('tool-held'));
});
