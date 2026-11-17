// Review fixes for the airline pack (honesty, behaviour and crawl reviews, 2026-11-16): one test per fix. Numbers are LAB-INVENTED.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST, findUseCase } from '../src/manifest.js';
import { VERTICALS } from '../src/cast.js';
import { runUseCase } from '../src/flow.js';
import { realGate } from '../src/realGate.js';
import { NOT_DEMONSTRATED } from '../src/data.js';
import { presetsFor } from '../src/instructions.js';
import { REPLIES, ucReplyFor } from '../src/replies.js';

const go = (id, vertical = 'airline', extra = {}) => runUseCase(findUseCase(id), { cast: VERTICALS[vertical], vertical, seed: 'run', ...extra });
const hopOf = (r, kind) => r.hops.find((h) => h.kind === kind && h.verdict !== 'skip');
const replyOf = (r) => hopOf(r, 'agent-reply')?.response.body.reply;
const POISONED = presetsFor(VERTICALS.airline).find((p) => p.id === 'poisoned').text;
const strip = (r) => JSON.stringify(r);

test('a poisoned run on the phone use case still waits for a person (the phone flag never lets a $2,500 booking through)', () => {
  const r = go('UC22', 'airline', { instructions: POISONED });
  assert.equal(r.outcome, 'HITL_REQUIRED');
  assert.equal(r.steered.proposed.amount, 2500);
  assert.ok(!r.hops.some((h) => h.kind === 'tool-dispatched'), 'nothing was booked');
  assert.equal(r.booking.booked, null);
  assert.match(hopOf(r, 'tool-held').response.body.proposed, /\$2,500/);
  assert.ok(!r.hops.some((h) => h.kind === 'ciba-poll' && h.verdict !== 'skip'), 'no phone approval was drawn');
  assert.equal(go('UC22').outcome, 'PERMIT', 'the unsteered phone use case is unchanged');
});

test('every use case that books ends in a hold when steered, and the held line never names a listed flight at the poisoned fare', () => {
  for (const id of ['UC1', 'UC7', 'UC8', 'UC22', 'UC48', 'UC6', 'UC27']) {
    const r = go(id, 'airline', { instructions: POISONED });
    if (!r.steered) continue;
    assert.ok(r.outcome === 'HITL_REQUIRED' || (id === 'UC27' && r.outcome === 'STEP_UP'), `${id} ${r.outcome}`);
    assert.ok(!r.hops.some((h) => h.kind === 'tool-dispatched'), `${id} booked nothing`);
    assert.equal(r.booking.flight, 'LK 214', `${id} uses the pack's default trip`);
    assert.equal(r.booking.international, false, id);
    assert.match(hopOf(r, 'tool-held').response.body.proposed, /LK 214 to Denver for \$2,500/, id);
  }
  const r8 = go('UC8', 'airline', { instructions: POISONED });
  assert.ok(r8.steered, 'UC8 is a steerable run');
  assert.doesNotMatch(JSON.stringify(r8.hops.map((h) => h.response?.body)), /LK 322/, 'the held Toronto run no longer proposes $2,500 on LK 322');
});

test('the decider is the lab\'s own fare rule in every airline booking outcome, never a PingOne Authorize outcome', () => {
  const BY = "the lab's fare rule, not a PingOne Authorize outcome";
  for (const id of ['UC7', 'UC8', 'UC48', 'UC6', 'UC27', 'UC22']) assert.equal(hopOf(go(id), 'authorize-decision').decision.by, BY, id);
  assert.equal(go('UC8').constrained.by, BY);
});

test('an airline Real page names the lab\'s tool server, never a claim about what SE serves (phase B: the airline pack has its own tools there)', () => {
  const g = realGate(findUseCase('UC1'), VERTICALS.airline);
  assert.equal(g.real, false);
  assert.match(g.reason, /tool server/, 'with no provider up the reason is the tool server\'s state');
  assert.doesNotMatch(g.reason, /SE gateway|banking|healthcare|retail/);
  const up = realGate(findUseCase('UC1'), VERTICALS.airline, { tools: { se: false, local: true, localState: 'ready' } });
  assert.deepEqual([up.real, up.capability, up.tool], [true, 'tools', 'get_airline_bookings']);
  // a pack with a fare rule and NO tool server stays on the lab's own steps with the neutral reason (the guard is kept)
  const { castToolServer, ...bare } = VERTICALS.airline;
  assert.equal(realGate(findUseCase('UC1'), bare).reason, "this vertical runs on the lab's own steps here");
  assert.match(realGate(findUseCase('UC1'), VERTICALS.software).reason, /tool server/, 'the software pack keeps its own reason: its tool server');
});

test('the not-demonstrated line says the reference setup was read, not run (UNVERIFIED)', () => {
  const line = NOT_DEMONSTRATED.find((l) => /reference airline setup/.test(l));
  assert.match(line, /not run \(UNVERIFIED\)/);
  assert.doesNotMatch(line, /none of the booking outcomes here is what that setup would answer/, 'it states nothing as verified fact');
});

test('the premium traveller\'s trips reply counts what it lists', () => {
  const r = go('UC1', 'airline', { persona: 'premium' });
  const said = replyOf(r);
  const n = Number(/You have (\d+) upcoming trips/.exec(said)[1]);
  const listed = said.split(': ')[1].split('. ')[0].split(';').length;
  assert.equal(n, listed, said);
  assert.equal(Number(/You have (\d+) upcoming trips/.exec(replyOf(go('UC1')))[1]), 2);
});

test('exact-limit booking stages LK 330 at $400, and no run names a flight against a fare the README table does not list', () => {
  const r = go('UC14b');
  assert.match(replyOf(r), /LK 330 from ORD to San Francisco on Friday for \$400/);
  const FARES = { 'LK 109': 150, 'LK 214': 380, 'LK 322': 380, 'LK 330': 400, 'LK 331': 401, 'LK 560': 780, 'LK 650': 1500, 'LK 651': 1501, 'LK 704': 2400, 'LK 800': 1100 };
  for (const persona of ['standard', 'premium']) {
    for (const uc of MANIFEST.usecases) {
      const run = go(uc.id, 'airline', { persona });
      for (const h of run.hops) {
        const text = JSON.stringify(h.response?.body ?? '');
        for (const m of text.matchAll(/Booked[^"]*?on (LK \d+) from [^"]*? for \$([\d,]+)/g)) assert.equal(FARES[m[1]], Number(m[2].replace(',', '')), `${uc.id}/${persona}: ${m[0]}`);
        for (const m of text.matchAll(/ready to book a business seat on (LK \d+) to \w+ for \$([\d,]+)/g)) if (!run.steered) assert.equal(FARES[m[1]], Number(m[2].replace(',', '')), `${uc.id}/${persona}: ${m[0]}`);
      }
    }
  }
});

test('the explanation, activity and specialist use cases answer in the airline pack\'s own words, not a generic sentence', () => {
  const r35 = go('UC35');
  assert.match(replyOf(r35), /Decision card/);
  assert.doesNotMatch(replyOf(r35), /No tool was called|PERMIT|jun\.takeda|Why was that blocked/);
  assert.match(replyOf(go('UC34')), /nothing unusual/);
  assert.doesNotMatch(replyOf(go('UC34')), /upcoming trips: /, 'an activity summary, not the trips list');
  for (const id of ['UC2', 'UC2.5', 'UC2.6']) { const t = replyOf(go(id)); assert.match(t, /your next trip is LK 214/, id); assert.doesNotMatch(t, /passport|card ending/, `${id} never returns the sensitive record`); }
  assert.doesNotMatch(replyOf(go('UC-TOOL1')), /accounts service/);
  // the sensitive record itself is unchanged for its own use cases
  assert.match(replyOf(go('UC21', 'airline', { persona: 'premium' })), /passport ending 9036/);
});

test('the per-use-case replies exist only for the airline pack and are filled', () => {
  assert.deepEqual(Object.keys(REPLIES.byUseCase), ['airline']);
  for (const [uc, t] of Object.entries(REPLIES.byUseCase.airline)) {
    const said = ucReplyFor({ cast: VERTICALS.airline, vertical: 'airline', persona: 'standard', uc });
    assert.ok(said && !/\{\{/.test(said), `${uc}: ${t}`);
    assert.equal(ucReplyFor({ cast: VERTICALS.banking, vertical: 'banking', persona: 'standard', uc }), null, `${uc} never reaches another pack`);
  }
  assert.equal(ucReplyFor({ cast: VERTICALS.airline, vertical: 'airline', persona: 'standard' }), null, 'no use case named: nothing');
});

test('the run carries the label source and the history record the same, for exactly the four overridden use cases', () => {
  const lab = MANIFEST.usecases.filter((u) => go(u.id).useCase.labelSource === 'lab').map((u) => u.id).sort();
  assert.deepEqual(lab, ['UC48', 'UC6', 'UC7', 'UC8']);
  for (const v of ['banking', 'healthcare', 'retail', 'software']) assert.ok(!('labelSource' in go('UC7', v).useCase), v);
});

test("the other packs' runs carry no airline word (their bytes are pinned by the golden)", () => {
  for (const v of ['banking', 'healthcare', 'retail', 'software']) for (const id of ['UC1', 'UC6', 'UC7', 'UC22', 'UC34', 'UC35', 'UC2']) {
    assert.ok(!/LK \d|Larkspur|CONSTRAINED/.test(strip(go(id, v))), `${v}/${id}`);
  }
});
