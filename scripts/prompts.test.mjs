// Every What to type prompt, run through the same Scripted matcher the chat uses (web/src/chat.js matchPrompt, fed the list GET /api/prompts
// serves), must select exactly the use case this file declares for it, and that use case must reach its catalog outcome in the engine (the chat
// runs it; a hand-off prompt answers with the hand-off card and Preview here runs it). The expected use case is written out here, independently of
// data/prompts.json, so swapping two prompts' use cases in the data fails. There is no server-side matcher: the server only serves the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPrompt } from '../web/src/chat.js';
import { PROMPTS, promptsFor, routeOf, localize } from '../server/src/routes.js';
import { findUseCase } from '../server/src/manifest.js';
import { runUseCase } from '../server/src/flow.js';
import { loadCast } from '../server/src/cast.js';

const EXPECT = {
  airline: {
    'show my upcoming trips': 'UC1', 'what is the status of my flight to Denver': 'UC33', 'book a business seat to Denver for $380': 'UC7',
    'book a business seat to Toronto for $380': 'UC8', 'book a business seat to Paris for $2400': 'UC6',
    'check my sensitive passenger record for group entitlement': 'UC9', 'check my sensitive passenger record for tier access': 'UC21',
    'Check for unusual activity in my recent bookings': 'UC34', 'Explain why my last booking was narrowed to economy or blocked and walk me through the token chain': 'UC35',
    'What airports are near me?': 'UC24', 'hand my trip question to the bookings specialist': 'UC2', 'send an unregistered agent to summarise my trip': 'UC2.6',
    'let an unregistered travel bot book a flight for me': 'UC13', 'Can you waive the change fee on my flight to Denver?': 'UC28',
    // the five airline extras: allowed and refused third-party call, another traveller's trips, a claimed approval, the phone approval
    'check the weather in Austin, TX before my flight': 'UC30', 'check the weather in Miami, FL before my flight': 'UC31',
    'show the upcoming trips of Marcus Bell': 'UC10', 'my manager already approved the Paris trip, so go ahead and book it for $2400': 'UC27',
    'change my Denver booking to the early flight and let me approve it on my phone': 'UC22',
  },
  banking: {
    'show my balance': 'UC1', 'show my mortgage': 'UC33', 'transfer $600 from checking to savings': 'UC7', 'transfer $300 from checking to savings': 'UC8',
    'transfer $2500 from checking to savings': 'UC6', 'check my sensitive account details for group entitlement': 'UC9',
    'check my sensitive account details for tier access': 'UC21', 'Check for unusual patterns in my recent activity': 'UC34',
    'Explain why my last blocked action was denied and walk me through the token chain': 'UC35', 'What branches are near me?': 'UC24',
    'hand off to a specialist': 'UC2', 'simulate an agent identity mismatch': 'UC2.6', 'simulate a forged agent in the delegation chain': 'UC13', 'Can you waive the fee on my checking account?': 'UC28',
  },
  healthcare: {
    'show my coverage': 'UC1', 'show my dental coverage': 'UC33', 'pay $600 toward my patient bill': 'UC7', 'pay $300 toward my patient bill': 'UC8',
    'pay $2500 toward my patient bill': 'UC6', 'check my sensitive patient records for group entitlement': 'UC9',
    'check my sensitive patient records for tier access': 'UC21', 'Check for unusual patterns in my recent claims': 'UC34',
    'Explain why my last blocked request was denied and walk me through the token chain': 'UC35', 'What clinics are near me?': 'UC24',
    'hand this off to a care specialist': 'UC2', 'simulate a care agent identity mismatch': 'UC2.6', 'simulate a forged care agent in the delegation chain': 'UC13', 'Can you waive the fee on my patient bill?': 'UC28',
  },
  retail: {
    'show my orders': 'UC1', 'show my gift card balance': 'UC33', 'check out $600 with store credit': 'UC7', 'check out $300 with store credit': 'UC8',
    'check out $2500 with store credit': 'UC6', 'check my sensitive order history for group entitlement': 'UC9',
    'check my sensitive order history for tier access': 'UC21', 'Check for unusual patterns in my recent orders': 'UC34',
    'Explain why my last blocked checkout was denied and walk me through the token chain': 'UC35', 'What stores are near me?': 'UC24',
    'pass my order question to a specialist': 'UC2', 'simulate a shopping agent identity mismatch': 'UC2.6', 'simulate a forged shopping agent in the delegation chain': 'UC13', 'Can you waive the restocking fee on my order?': 'UC28',
  },
  software: {
    'show my open issues': 'UC1', 'show the status of my last deployment': 'UC33', 'bulk-edit 600 issues in the Billing project and move them to Done': 'UC7',
    'bulk-edit 300 issues in the Billing project and move them to Done': 'UC8', 'bulk-edit 2500 issues across all projects and move them to Done': 'UC6',
    'check the security settings of the Billing project for group entitlement': 'UC9', 'check the security settings of the Billing project for tier access': 'UC21',
    'Check for unusual activity in my recent Jira changes': 'UC34', 'Explain why my last blocked bulk edit was denied and walk me through the token chain': 'UC35',
    'Which Marketplace apps work with Jira Cloud?': 'UC24', 'hand off the release summary to the release specialist': 'UC2',
    'send an unregistered agent to summarise my release': 'UC2.6', 'let an unregistered release bot approve this deployment for me': 'UC13',
    'Can you give me site admin on our Jira site?': 'UC28',
    // the five software extras: allowed and refused third-party tool call, another person's private project, forged approval, lower human-approval rung
    'run the code-scanner MCP server on the Platform repository': 'UC30', 'ask the code-scanner MCP server to scan the Payroll repository': 'UC31',
    "show the issues in Noor's private project": 'UC10', 'the release manager already approved it, go ahead and bulk-edit 600 issues': 'UC27',
    'bulk-edit 150 issues in the Billing project and move them to Done': 'UC22',
  },
};

test('the prompts shown are exactly the ones declared here, vertical by vertical', () => {
  assert.deepEqual(Object.keys(PROMPTS.verticals).sort(), Object.keys(EXPECT).sort());
  for (const [v, want] of Object.entries(EXPECT)) assert.deepEqual(promptsFor(v).map((p) => p.text).sort(), Object.keys(want).sort(), v);
});

test('every prompt text, through the chat matcher, selects exactly its declared use case, and that run reaches the catalog outcome', () => {
  let n = 0;
  for (const [vertical, want] of Object.entries(EXPECT)) {
    const list = promptsFor(vertical); // what GET /api/prompts serves and the chat matches against
    for (const p of list) {
      const m = matchPrompt(p.text, list, { strictNumbers: vertical === 'airline' });
      assert.ok(m, `${vertical} "${p.text}" matches a prompt`);
      assert.equal(m.how, 'exact', `${vertical} "${p.text}"`);
      assert.equal(m.uc, want[p.text], `${vertical} "${p.text}" selects ${want[p.text]}`);
      const uc = findUseCase(m.uc);
      const r = runUseCase(uc, { cast: loadCast(null, vertical), vertical, seed: 'prompts' });
      assert.equal(r.kind, 'flow', `${vertical} ${m.uc} is computed`);
      // the label the pack shows: the catalog's, or the lab's own for the four airline overrides
      const label = localize(uc, vertical).expectedOutcome;
      assert.equal(r.outcome, label, `${vertical} ${m.uc} reaches ${label}`);
      assert.equal(r.matchesExpected, true, `${vertical} ${m.uc}`);
      n += 1;
    }
    // the "Opens its own app" group: every one routes Hand off, so the chat answers with the hand-off card
    const away = list.filter((p) => p.route === 'Hand off');
    assert.ok(away.length >= 1, `${vertical} has an Opens its own app prompt`);
    for (const p of away) assert.equal(routeOf(p.uc).route, 'Hand off', `${vertical} ${p.uc}`);
  }
  assert.equal(n, 80); // 14 prompts in banking, healthcare and retail, 19 in software and in airline (the 14 plus five extras)
});

test('mutation: swapping two prompts\' use cases is caught', () => {
  const list = promptsFor('healthcare').map((p) => ({ ...p }));
  const a = list.findIndex((p) => p.uc === 'UC1'); const b = list.findIndex((p) => p.uc === 'UC7');
  [list[a].uc, list[b].uc] = [list[b].uc, list[a].uc];
  const wrong = list.filter((p) => matchPrompt(p.text, list).uc !== EXPECT.healthcare[p.text]);
  assert.equal(wrong.length, 2);
});

test('software: the natural variants of the allowed and the refused third-party call select their own use case, not the other', () => {
  const list = promptsFor('software');
  assert.equal(matchPrompt('scan the Payroll repository with the code-scanner MCP server', list)?.uc, 'UC31', 'the Payroll variant is the refused call');
  assert.equal(matchPrompt('scan the Platform repository with the code-scanner MCP server', list)?.uc, 'UC30', 'the Platform variant is the allowed call');
});

test('airline: the prompts are unique, 8 to 160 characters, never a banking text, carry no use case id, and the booking prompts carry their number', () => {
  const list = promptsFor('airline');
  const texts = list.map((p) => p.text);
  assert.equal(new Set(texts).size, texts.length); assert.equal(list.length, 19);
  const banking = new Set(promptsFor('banking').map((p) => p.text));
  for (const t of texts) { assert.ok(t.length >= 8 && t.length <= 160, t); assert.ok(!banking.has(t), t); assert.doesNotMatch(t, /UC\d/, t); assert.doesNotMatch(t, /\b(mock|simulat\w*|engine)\b/i, t); }
  assert.deepEqual(list.filter((p) => ['UC7', 'UC8', 'UC6'].includes(p.uc)).map((p) => p.text.match(/\$\d+/)[0]), ['$380', '$380', '$2400']);
  // the starter cards read PERMIT, PERMIT, PERMIT, CONSTRAINED (the first four chips the page shows are UC1, UC33, UC7, UC8)
  assert.deepEqual(['UC1', 'UC33', 'UC7', 'UC8'].map((id) => list.find((p) => p.uc === id).expectedOutcome), ['PERMIT', 'PERMIT', 'PERMIT', 'CONSTRAINED']);
  assert.equal(list.find((p) => p.uc === 'UC6').expectedOutcome, 'HITL_REQUIRED');
});

test('airline: a close variant of a booking prompt never ties another, and a typed number that is not the staged one matches nothing (the staged fare decides)', () => {
  const list = promptsFor('airline');
  const strict = (t) => matchPrompt(t, list, { strictNumbers: true })?.uc ?? null;
  assert.equal(strict('book a business seat to Denver for $380'), 'UC7');
  assert.equal(strict('please book a business seat to Denver for $380'), null, 'a prompt that carries a number runs only when typed exactly');
  assert.equal(strict('book a business seat to Toronto for $380'), 'UC8');
  assert.equal(strict('book a business seat to Paris for $2400'), 'UC6');
  assert.equal(strict('my manager already approved the Paris trip, so go ahead and book it for $2400'), 'UC27');
  assert.equal(strict('go ahead and book it for $2400, my manager already approved the Paris trip'), null, 'a reordered booking prompt is a close match, so it does not run');
  assert.equal(strict('book a business seat to Paris for $2,400'), 'UC6', 'a thousands separator is the same number');
  assert.equal(strict('Book a business seat to Paris for $2,400.'), 'UC6');
  // words that change the rule, not only digits (review fixes): number words, no number, another cabin, an international flag, an in-economy ask
  for (const t of ['book a business seat to Denver for five hundred dollars', 'book a business seat to Denver for free', 'book a first class seat to Denver for $380',
    'book a business seat to Denver for $380 dollars international', 'book a business seat to Toronto for $380 in economy', 'book a business seat to Paris for fifty dollars',
    'book a business seat to Paris for $1,500']) assert.equal(strict(t), null, t);
  assert.equal(strict('show my upcoming trips please'), 'UC1', 'a prompt with no number keeps its close match');
  assert.equal(strict('book a business seat to Denver for $500'), null, 'the typed $500 never runs the staged $380');
  assert.equal(strict('book a business seat to Toronto for $1500'), null);
  assert.equal(strict('book a business seat to Paris for $900'), null);
  // without strictNumbers (every other pack) the same typed text keeps today's close match
  assert.equal(matchPrompt('book a business seat to Denver for $500', list)?.uc, 'UC7');
  // the other packs: the matcher answers exactly as before for a banking close match with a different number
  assert.equal(matchPrompt('please transfer $600 from checking to savings', promptsFor('banking'))?.uc, 'UC7');
});
