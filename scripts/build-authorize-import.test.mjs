// Tests for scripts/owner/build-authorize-import.mjs. The base here is a SYNTHETIC snapshot written by hand in the shape of a PingOne Authorize v2 export;
// it is never the owner's data. Run: node --test scripts/build-authorize-import.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FARE_RULE, BOOKING_TOOLS } from '../server/src/policy.js';
import { applyOverlay, build, CATCH_ALL_RULE, compareExisting, completeness, detId, generate, gridProof, isOurs, MAX_NAME, missingDefaults, OUR_PREFIX, makeEngine, nameOf, OVERLAY_ALLOW, POLICY_NAME, refsOf, semanticDiff, specificCodes, spliceRoot, splitElements, stripOurs, summaryLine, typeOf, UNMATCHED_CODE, verifyBuilt, xorVersion } from './owner/build-authorize-import.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'owner', 'build-authorize-import.mjs');
const FARE = { ...FARE_RULE }; const TOOLS = [...BOOKING_TOOLS]; const TOOL = TOOLS[0];
const attr = (n, id, valueType, defaultValue) => ({ objectType: 'AttributeDefinition', defaultValue, description: 'synthetic', fullName: n, id, name: n, numberOfChildren: null, parentId: null, repetitionSource: null, resolvers: [{ attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null }], type: 'ATTRIBUTE', valueProcessor: null, valueSchema: null, valueType, version: '00000000-0000-4000-8000-000000000001' });
const ID = (n) => `99999999-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cmp = (a, op, v) => ({ comparison: { left: { attribute: { id: a } }, op, right: { constant: { value: v } } } });
const ROOT_VERSION = 'b1c2d3e4-1111-4222-8333-444455556666';
const syntheticElements = () => [
  { '@class': 'DataStreamHeader', kind: 'SnapshotHeader', version: 2 },
  { type: 'SnapshotPackageFile$PackageHeader', snapshotId: '11111111-2222-4333-8444-555555555555', snapshotFileVersion: 2, applicationVersion: 'P1AZ-1.0.0.0' },
  attr('ToolName', ID(1), 'STRING', 'none'), attr('Amount', ID(2), 'NUMBER', '0'), attr('UserId', ID(3), 'STRING', 'none'), attr('ActClientId', ID(4), 'STRING', 'none'), attr('HitlApproved', ID(5), 'BOOLEAN', 'false'),
  { objectType: 'ConditionDefinition', condition: { and: { conditions: [cmp(ID(1), 'Equals', 'pay_bill')] } }, description: 'synthetic é — ü', fullName: 'SyntheticIsPayBill', id: ID(10), name: 'SyntheticIsPayBill', numberOfChildren: null, parentId: null, type: 'CONDITION', version: '00000000-0000-4000-8000-000000000002' },
  { objectType: 'ConditionDefinition', condition: { and: { conditions: [cmp(ID(1), 'Equals', TOOL)] } }, description: 'synthetic', fullName: 'SyntheticIsBooking', id: ID(11), name: 'SyntheticIsBooking', numberOfChildren: null, parentId: null, type: 'CONDITION', version: '00000000-0000-4000-8000-000000000012' },
  { type: 'SnapshotPackageFile$PackageSeparator' },
  { id: ID(20), version: '00000000-0000-4000-8000-000000000003', name: 'Synthetic Deny', description: 'x', shared: false, code: 'synthetic-deny', appliesTo: 'DENY', appliesIf: 'PATH_MATCHES', payload: '{"d":1}', obligatory: false, attributes: [], services: [], type: 'Statement' },
  { id: ID(21), version: '00000000-0000-4000-8000-000000000013', name: 'Synthetic Permit', description: 'x', shared: false, code: 'synthetic-permit', appliesTo: 'PERMIT', appliesIf: 'PATH_MATCHES', payload: `{"tool":"{{${ID(1)}}}"}`, obligatory: false, attributes: [ID(1)], services: [], type: 'Statement' },
  { id: ID(30), version: '00000000-0000-4000-8000-000000000004', targets: [], name: 'Synthetic Deny Rule', shared: false, disabled: false, condition: { and: { conditions: [{ reference: { id: ID(10) } }] } }, effectSettings: { type: 'unconditionalPermit' }, statements: [ID(20)], description: 'x', type: 'Rule' },
  { id: ID(31), version: '00000000-0000-4000-8000-000000000014', targets: [], name: 'Synthetic Permit Rule', shared: false, disabled: false, condition: { empty: {} }, effectSettings: { type: 'unconditionalPermit' }, statements: [ID(21)], description: 'x', type: 'Rule' },
  { id: ID(40), version: '00000000-0000-4000-8000-000000000005', targets: [], combiningAlgorithm: { algorithm: 'DenyOverrides' }, name: 'Synthetic Policy', description: 'x', shared: false, disabled: false, children: [{ id: ID(30), type: 'Rule' }, { id: ID(31), type: 'Rule' }], condition: { empty: {} }, statements: [], repetitionSettings: null, type: 'Policy' },
  { id: ID(50), version: ROOT_VERSION, targets: [], combiningAlgorithm: { algorithm: 'DenyOverrides', evaluateAll: true }, name: 'Synthetic Policies', shared: false, disabled: false, children: [{ id: ID(40), type: 'Policy' }], condition: { empty: {} }, statements: [], description: 'x', managedEntity: { owner: { service: { name: 'Editor Service' } } }, type: 'PolicySet' },
  { type: 'SnapshotPackageFile$PackageSeparator' },
  { type: 'SnapshotPackageFile$EndOfPackage' },
  { '@class': 'DataStreamFooter', digest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
];
const textOf = (els) => `[${els.map((e) => JSON.stringify(e)).join(',')}]`;
const BASE = textOf(syntheticElements());
const run = (baseText = BASE, fare = FARE, tools = TOOLS) => build({ baseText, fare, tools });
const oursOf = (text) => new Map(splitElements(text).filter((e) => isOurs(e.obj)).map((e) => [e.obj.name, e.text]));
const nonOurs = (text) => splitElements(text).filter((e) => !isOurs(e.obj)).map((e) => e.text);
const RULE2 = { ...FARE, limit: 500, hold: 2000 };
const at = (els, id) => els.findIndex((e) => e.id === id);
const typeCount = (text, t) => splitElements(text).filter((e) => isOurs(e.obj) && typeOf(e.obj) === t).length;

test('the synthetic base is a complete snapshot', () => {
  assert.deepEqual(completeness(splitElements(BASE)).problems, []);
});

test('byte identity: removing ours gives the input back, every non-ours element keeps its exact text but the root', () => {
  const r = run();
  assert.equal(stripOurs(r.text), BASE, 'removing ours from the output gives the input, byte for byte');
  const inEls = splitElements(BASE).map((e) => e.text); const outRest = nonOurs(r.text);
  assert.equal(outRest.length, inEls.length);
  const differing = inEls.map((t, i) => (t === outRest[i] ? -1 : i)).filter((i) => i >= 0);
  assert.equal(differing.length, 1, 'exactly one non-ours element differs');
  assert.equal(JSON.parse(outRest[differing[0]]).type, 'PolicySet');
  assert.ok(r.text.includes('synthetic é — ü'), 'non-ASCII text stays as written');
  assert.deepEqual({ ...r.summary }, { added: 36, updated: 0, unchanged: 0, removed: 0, rootChanged: true, rootChildAlreadyThere: false });
  const v = verifyBuilt({ outText: r.text, inText: BASE, fare: FARE, tools: TOOLS });
  assert.equal(v.fail, 0, v.lines.join('\n'));
});

test('the header, the package header, the separators, the end marker and the footer stay in place', () => {
  const els = splitElements(run().text);
  const inEls = splitElements(BASE);
  for (const i of [0, 1]) assert.equal(els[i].text, inEls[i].text);
  assert.equal(els.at(-1).text, inEls.at(-1).text); assert.equal(els.at(-2).text, inEls.at(-2).text);
  assert.equal(els.filter((e) => e.obj.type === 'SnapshotPackageFile$PackageSeparator').length, 2);
});

test('the counts: 5 attributes, 12 conditions, 9 statements, 9 rules, 1 policy, no new policy set', () => {
  const t = run().text;
  assert.deepEqual(['AttributeDefinition', 'ConditionDefinition', 'Statement', 'Rule', 'Policy', 'PolicySet'].map((x) => typeCount(t, x)), [5, 12, 9, 9, 1, 0]);
  assert.equal(splitElements(t).filter((e) => e.obj.type === 'PolicySet').length, 1, 'still one policy set: the owner root');
});

test('our objects land in the right groups', () => {
  const els = splitElements(run().text).map((e) => e.obj);
  const idx = (pred) => els.map((o, i) => (pred(o) ? i : -1)).filter((i) => i >= 0);
  const sep = idx((o) => o.type === 'SnapshotPackageFile$PackageSeparator');
  const ours = (t) => idx((o) => typeOf(o) === t && isOurs(o));
  assert.ok(Math.max(...ours('AttributeDefinition'), ...ours('ConditionDefinition')) < sep[0], 'attributes and conditions end package 1');
  assert.ok(Math.min(...ours('AttributeDefinition')) > idx((o) => o.name === 'HitlApproved')[0], 'after the existing attributes');
  const firstRule = idx((o) => o.type === 'Rule' && !isOurs(o))[0];
  assert.ok(Math.max(...ours('Statement')) < firstRule && Math.min(...ours('Statement')) > sep[0], 'statements go before the rules of package 2');
  assert.ok(Math.min(...ours('Rule')) > idx((o) => o.type === 'Rule' && !isOurs(o)).at(-1), 'rules after the existing rules');
  assert.ok(ours('Policy')[0] > ours('Rule').at(-1) && ours('Policy')[0] > idx((o) => o.type === 'Policy' && !isOurs(o))[0] && ours('Policy')[0] < idx((o) => o.type === 'PolicySet')[0], 'our policy after the existing policy, before the policy set');
});

test('the root policy set: one child appended by splice, a new valid version, everything else the same characters', () => {
  const r = run(); const before = splitElements(BASE).find((e) => e.obj.type === 'PolicySet'); const after = splitElements(r.text).find((e) => e.obj.type === 'PolicySet');
  const pol = [...splitElements(r.text)].find((e) => isOurs(e.obj) && e.obj.type === 'Policy').obj;
  assert.deepEqual(after.obj.children, [...before.obj.children, { id: pol.id, type: 'Policy' }]);
  assert.notEqual(after.obj.version, before.obj.version);
  assert.match(after.obj.version, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'still shaped like the owner version (uuid version 4 nibble and variant)');
  assert.equal(xorVersion(after.obj.version, pol.version), before.obj.version, 'the original version is recoverable');
  const expect = before.text.replace(before.obj.version, after.obj.version).replace(`{"id":"${ID(40)}","type":"Policy"}]`, `{"id":"${ID(40)}","type":"Policy"},{"id":"${pol.id}","type":"Policy"}]`);
  assert.equal(after.text, expect, 'the only differences are the version string and the appended child');
});

test('our policy is gated: the marker and the booking tool are in its gate condition, the fare attribute fails closed', () => {
  const gen = generate({ fare: FARE, tools: TOOLS, ref: { ToolName: ID(1), UserId: ID(3), ActClientId: ID(4), Amount: ID(2), HitlApproved: ID(5) } });
  const byName = (n) => gen.find((g) => g.name === n);
  const fare = byName('AirFare').obj; assert.equal(fare.valueType, 'NUMBER'); assert.equal(fare.defaultValue, '0');
  assert.equal(byName('AirLabMarker').obj.defaultValue, ''); assert.equal(byName('AirIsInternational').obj.valueType, 'BOOLEAN'); assert.equal(byName('AirApproval').obj.defaultValue, 'none');
  const gate = JSON.stringify(byName('Larkspur Air - Is A Booking Request').obj.condition);
  for (const must of [byName('AirLabMarker').id, byName('AirFare').id, ID(1), '"GreaterThan"', '"0"', 'larkspur-air', TOOL]) assert.ok(gate.includes(must), `the gate holds ${must}`);
  const pol = byName(POLICY_NAME).obj; assert.deepEqual(pol.condition.and.conditions, [{ reference: { id: byName('Larkspur Air - Is A Booking Request').id } }]);
  // The Amount, HitlApproved and ActClientId attributes are never referenced; the AirFare is used instead of Amount.
  const all = JSON.stringify(gen.map((g) => g.obj));
  for (const unused of [ID(2), ID(4), ID(5)]) assert.ok(!all.includes(unused));
});

test('outcome statements: codes, effect, no gate words, flat static payloads with the numbers from FARE_RULE', () => {
  const gen = generate({ fare: FARE, tools: TOOLS, ref: { ToolName: ID(1), UserId: ID(3), ActClientId: ID(4), Amount: ID(2), HitlApproved: ID(5) } });
  const st = gen.filter((g) => g.type === 'Statement').map((g) => g.obj);
  assert.deepEqual(st.map((s) => s.code).sort(), ['airline-approval-required', 'airline-approved-as-asked', 'airline-booking-refused', 'airline-economy-intl', 'airline-economy-intl-over-limit', 'airline-economy-over-limit', 'airline-permit-as-asked', 'airline-second-factor-required', 'airline-unmatched']);
  assert.equal(st.filter((s) => s.appliesTo === 'DENY').length, 1);
  for (const s of st) {
    assert.equal(s.obligatory, false); assert.equal(s.appliesIf, 'PATH_MATCHES'); assert.deepEqual(s.attributes, []); assert.deepEqual(s.services, []);
    assert.ok(!/HITL|STEPUP|CONSENT|ELICITATION|HUMANAPPROVAL/.test(s.code.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    const p = JSON.parse(s.payload); assert.ok(Object.values(p).every((v) => typeof v !== 'object' || Array.isArray(v)), 'flat'); assert.ok(!/\{\{|\}\}|\$\{/.test(s.payload));
  }
  assert.equal(st.find((s) => s.code === 'airline-economy-intl').payload, `{"outcome":"narrow","cabin":"${FARE.to}","because":["international"],"limit":${FARE.limit},"hold":${FARE.hold}}`);
  const rules = gen.filter((g) => g.type === 'Rule').map((g) => g.obj);
  const deny = rules.filter((r) => r.effectSettings.type === 'conditionalDenyElsePermit'); assert.equal(deny.length, 1);
  assert.deepEqual(deny[0].effectSettings.condition, deny[0].condition, 'the deny rule effect condition equals its own condition');
  assert.ok(rules.filter((r) => r.effectSettings.type === 'unconditionalPermit').length === 8);
});

test('refuses a base that is not a v2 snapshot, or is not complete, or not compact', () => {
  const v1 = syntheticElements(); v1[0].version = 1;
  assert.throws(() => run(textOf(v1)), /version 2/);
  const v1p = syntheticElements(); v1p[1].snapshotFileVersion = 1;
  assert.throws(() => run(textOf(v1p)), /snapshotFileVersion 2/);
  const dangling = syntheticElements(); dangling[at(dangling, ID(50))].children = [{ id: ID(30), type: 'Rule' }, { id: ID(77), type: 'Rule' }];
  assert.throws(() => run(textOf(dangling)), /not in the snapshot/);
  assert.throws(() => run(JSON.stringify(syntheticElements(), null, 2)), /compact|no surrounding whitespace/);
  assert.throws(() => run('{"not":"an array"}'), /array/);
});

test('refuses when a referenced existing attribute is missing, ambiguous or the wrong type', () => {
  for (const name of ['Amount', 'UserId', 'ActClientId', 'HitlApproved']) {
    const els = syntheticElements().filter((e) => e.name !== name);
    assert.throws(() => run(textOf(els)), new RegExp(`0 attributes named ${name}`), name);
  }
  // ToolName is also read by an existing condition, so its absence is caught as an incomplete base first; either way nothing is built.
  assert.throws(() => run(textOf(syntheticElements().filter((e) => e.name !== 'ToolName'))), /ToolName|not in the snapshot/);
  const wrong = syntheticElements(); wrong[2] = attr('ToolName', ID(1), 'NUMBER', '0');
  assert.throws(() => run(textOf(wrong)), /ToolName is NUMBER/);
  const twice = syntheticElements(); twice.splice(3, 0, attr('Amount', ID(9), 'NUMBER', '0'));
  assert.throws(() => run(textOf(twice)), /2 attributes named Amount/);
});

test('refuses when a NON-ours object collides with one of our names or ids', () => {
  const byName = syntheticElements(); byName.splice(7, 0, attr('AirFare', ID(90), 'NUMBER', '0'));
  assert.throws(() => run(textOf(byName)), /collides/);
  const rid = detId('Rule', 'Larkspur Air - Permit As Asked');
  const byId = syntheticElements(); const r30 = at(byId, ID(30)); byId[r30].id = rid; byId[at(byId, ID(40))].children = [{ id: rid, type: 'Rule' }, { id: ID(31), type: 'Rule' }];
  assert.throws(() => run(textOf(byId)), /collides/);
  const byRuleName = syntheticElements(); byRuleName[at(byRuleName, ID(30))].name = 'Larkspur Air - Permit As Asked';
  assert.throws(() => run(textOf(byRuleName)), /collides/);
  // A non-ours attribute that merely starts with Air is not a collision.
  const fine = syntheticElements(); fine.splice(7, 0, attr('Airport', ID(91), 'STRING', ''));
  const r = run(textOf(fine)); assert.ok(splitElements(r.text).some((e) => e.obj.name === 'Airport' && !isOurs(e.obj)));
});

test('refuses when the root policy set is ambiguous or absent', () => {
  const none = syntheticElements().filter((e) => e.type !== 'PolicySet');
  assert.throws(() => run(textOf(none)), /exactly one root/);
  const two = syntheticElements(); two.splice(at(two, ID(50)), 0, { ...two[at(two, ID(50))], id: ID(51), name: 'Second Root', children: [] });
  assert.throws(() => run(textOf(two)), /exactly one root/);
});

test('deterministic: building twice gives the same bytes, and the ids and versions are uuids', () => {
  const a = run().text; const b = run().text; assert.equal(a, b);
  for (const e of splitElements(a).filter((x) => isOurs(x.obj))) {
    assert.match(e.obj.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); assert.match(e.obj.version, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});

test('repeatable: building from our own output changes nothing', () => {
  const first = run(); const again = run(first.text);
  assert.equal(again.text, first.text);
  assert.deepEqual({ ...again.summary }, { added: 0, updated: 0, unchanged: 36, removed: 0, rootChanged: false, rootChildAlreadyThere: true });
  assert.equal(stripOurs(again.text), BASE);
  assert.equal(run(again.text).text, first.text);
});

test('FARE_RULE changes flow through: only the affected objects change, from the base or from the previous output, and the result is the same either way', () => {
  const first = run();
  const fromOut = run(first.text, RULE2); const fromBase = run(BASE, RULE2);
  assert.equal(fromOut.text, fromBase.text, 'the path does not matter');
  assert.deepEqual(nonOurs(fromOut.text), nonOurs(first.text), 'non-ours bytes identical (the root keeps its version: the policy content did not change)');
  const a = oursOf(first.text); const b = oursOf(fromOut.text);
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
  const changed = [...a.keys()].filter((k) => a.get(k) !== b.get(k)).sort();
  const expectChanged = ['Larkspur Air - Fare Over Hold', 'Larkspur Air - Fare Over Limit', 'Larkspur Air - Narrowable', 'Larkspur Air - Economy Only International', 'Larkspur Air - Economy Only Over Limit', 'Larkspur Air - Economy Only Both Reasons', 'Larkspur Air - Approval Required', 'Larkspur Air - Approved As Asked', 'Larkspur Air - Second Factor Required', 'Larkspur Air - Permit As Asked', 'Larkspur Air - Booking Refused', 'Larkspur Air Stmt - Economy Only International', 'Larkspur Air Stmt - Economy Only Over Limit', 'Larkspur Air Stmt - Economy Only Both Reasons', 'Larkspur Air Stmt - Approval Required', 'Larkspur Air Stmt - Approved As Asked', 'Larkspur Air Stmt - Second Factor Required', 'Larkspur Air Stmt - Permit As Asked', 'Larkspur Air Stmt - Booking Refused'];
  for (const k of changed) assert.ok(expectChanged.includes(k) || /Rule|Fare|Narrow/.test(k), `unexpected change: ${k}`);
  for (const stay of ['AirLabMarker', 'AirFare', 'AirIsInternational', 'AirCabinAsked', 'AirApproval', 'Larkspur Air - Is A Booking Request', 'Larkspur Air - Cabin Known', 'Larkspur Air - Request Complete', 'Larkspur Air - Approval None', 'Larkspur Air - Approval Verified', 'Larkspur Air - Route International', 'Larkspur Air - Business Asked', 'Larkspur Air - Approval Claimed', 'Larkspur Air - Approval Denied', CATCH_ALL_RULE, 'Larkspur Air Stmt - Unmatched', POLICY_NAME]) assert.equal(a.get(stay), b.get(stay), `${stay} keeps its text and version`);
  assert.ok(changed.includes('Larkspur Air - Fare Over Hold') && changed.includes('Larkspur Air - Fare Over Limit'));
  assert.deepEqual({ ...fromOut.summary }.added, 0); assert.ok(fromOut.summary.updated > 0 && fromOut.summary.unchanged > 0);
  // The new numbers are in, the old ones are out.
  const cond = JSON.stringify(splitElements(fromOut.text).filter((e) => isOurs(e.obj) && e.obj.type === 'CONDITION').map((e) => e.obj.condition));
  assert.ok(cond.includes('"2000"') && cond.includes('"500"') && !cond.includes(`"${FARE.hold}"`) && !cond.includes(`"${FARE.limit}"`));
  const v = verifyBuilt({ outText: fromOut.text, inText: first.text, fare: RULE2, tools: TOOLS }); assert.equal(v.fail, 0, v.lines.join('\n'));
  const grid = gridProof(splitElements(fromOut.text), RULE2, TOOL); assert.deepEqual(grid.bad, []);
});

test('a version changes when its content changes, and only then (an unchanged version makes the console skip)', () => {
  const a = oursOf(run().text); const b = oursOf(run(BASE, RULE2).text);
  const ver = (t) => JSON.parse(t).version;
  assert.notEqual(ver(a.get('Larkspur Air - Fare Over Hold')), ver(b.get('Larkspur Air - Fare Over Hold')));
  assert.equal(ver(a.get('Larkspur Air - Cabin Known')), ver(b.get('Larkspur Air - Cabin Known')));
});

test('a generated object that is no longer generated disappears (removal of our own only)', () => {
  const r = run(); const els = splitElements(r.text).map((e) => e.obj);
  const ghost = attr('AirOldThing', detId('AttributeDefinition', 'AirOldThing'), 'STRING', ''); els.splice(7, 0, ghost);
  const withGhost = textOf(els); assert.ok(isOurs(ghost));
  const again = run(withGhost); assert.equal(again.summary.removed, 1); assert.equal(again.text, r.text);
  const v = verifyBuilt({ outText: again.text, inText: withGhost, fare: FARE, tools: TOOLS }); assert.equal(v.fail, 0, v.lines.join('\n'));
});

test('a non-ours attribute with an Air name but another id is left alone and not treated as ours', () => {
  const els = syntheticElements(); els.splice(7, 0, attr('AirportCode', ID(95), 'STRING', ''));
  const r = run(textOf(els)); assert.ok(r.text.includes(JSON.stringify(els[7])));
  assert.equal(stripOurs(r.text), textOf(els));
});

test('referential integrity: every id our objects reference exists, nothing existing references ours but the root, ours are never shared', () => {
  const r = run(); const els = splitElements(r.text); const ids = new Set(els.filter((e) => e.obj.id).map((e) => e.obj.id));
  const ours = els.filter((e) => isOurs(e.obj)); const oursIds = new Set(ours.map((e) => e.obj.id));
  for (const e of ours) { for (const ref of refsOf(e.obj)) assert.ok(ids.has(ref), `${nameOf(e.obj)} references ${ref}`); assert.ok(e.obj.shared !== true); }
  for (const e of els.filter((x) => !isOurs(x.obj) && x.obj.id)) { const hits = [...refsOf(e.obj)].filter((x) => oursIds.has(x)); if (e.obj.type === 'PolicySet') assert.equal(hits.length, 1); else assert.equal(hits.length, 0); }
  assert.deepEqual(completeness(els).problems, []);
  // Each statement is used by exactly one rule, each rule by our policy once.
  const stUse = new Map(); const ruUse = new Map();
  for (const e of ours.filter((x) => x.obj.type === 'Rule')) for (const s of e.obj.statements) stUse.set(s, (stUse.get(s) ?? 0) + 1);
  for (const c of ours.find((x) => x.obj.type === 'Policy').obj.children) ruUse.set(c.id, (ruUse.get(c.id) ?? 0) + 1);
  assert.ok([...stUse.values()].every((n) => n === 1)); assert.ok([...ruUse.values()].every((n) => n === 1)); assert.equal(stUse.size, 9); assert.equal(ruUse.size, 9);
  // Only operators and combinators that already appear in the owner's file.
  const ops = new Set(); const kinds = new Set();
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { if (n.op) ops.add(n.op); for (const k of ['and', 'or', 'not', 'comparison', 'reference', 'empty']) if (k in n) kinds.add(k); Object.values(n).forEach(walk); } };
  for (const e of ours) { walk(e.obj.condition); walk(e.obj.effectSettings); }
  for (const o of ops) assert.ok(['Equals', 'NotEquals', 'GreaterThan'].includes(o)); for (const k of kinds) assert.ok(['and', 'or', 'not', 'comparison', 'reference', 'empty'].includes(k));
});

test('the policy answers what FARE_RULE says over the whole grid, and matches nothing incomplete or foreign', () => {
  const g = gridProof(splitElements(run().text), FARE, TOOL);
  assert.deepEqual(g.bad, []); assert.ok(g.n > 500);
  // The proof can fail: a policy that lost its fail-closed fare gate is caught (a deliberately broken copy).
  const brokenEls = splitElements(run().text).map((e) => e.obj); brokenEls.find((o) => o.name === 'AirFare').defaultValue = '1'; const broken = textOf(brokenEls);
  const bad = gridProof(splitElements(broken), FARE, TOOL); assert.ok(bad.bad.some((m) => m.startsWith('fare omitted')), 'a fail-open fare default is caught by the grid');
});

test('no behaviour change for other demos: an evaluation corpus gives identical answers through the base root and the output root', () => {
  const r = run(); const baseEls = splitElements(BASE); const outEls = splitElements(r.text);
  const c = compareExisting(baseEls, outEls, TOOL, FARE);
  assert.equal(c.diff, 0); assert.ok(c.evaluations > 200); assert.equal(c.weakened, 0);
  assert.ok(c.changedWithMarker > 0, 'with the marker the answer gains our statements');
});

test('the lab request through the root set: our code arrives with the shared statements, and the foreign request is untouched', () => {
  const eng = makeEngine(splitElements(run().text));
  const mine = { ToolName: TOOL, UserId: 'u', AirLabMarker: 'larkspur-air', AirFare: '380', AirIsInternational: 'true', AirCabinAsked: 'business', AirApproval: 'none' };
  assert.deepEqual(eng.evaluate('Synthetic Policies', mine).codes, ['airline-economy-intl', 'airline-unmatched', 'synthetic-permit']);
  assert.deepEqual(specificCodes(eng.evaluate('Synthetic Policies', mine).codes), ['airline-economy-intl']);
  const foreign = { ...mine }; delete foreign.AirLabMarker;
  assert.deepEqual(eng.evaluate('Synthetic Policies', foreign).codes, ['synthetic-permit']);
});

test('no hard-coded fare numbers in the script: the limits come from FARE_RULE', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  for (const n of [String(FARE.limit), String(FARE.hold), `$${FARE.limit}`, `$${FARE.hold}`]) assert.ok(!new RegExp(`(?<![\\d.])${n.replace('$', '\\$')}(?![\\d])`).test(src), `${n} is not written in the script`);
  assert.ok(!src.includes(`'${FARE.from}'`) && !src.includes(`'${FARE.to}'`) && !src.includes(`'${TOOL}'`));
});

test('the command line: build, check, strip, refusals leave no file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authz-'));
  try {
    const base = path.join(dir, 'base.snapshot'); const out = path.join(dir, 'out.snapshot'); const back = path.join(dir, 'back.snapshot'); fs.writeFileSync(base, BASE);
    const node = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    const b = node('--base', base, '--out', out); assert.equal(b.status, 0, b.stdout + b.stderr);
    assert.match(b.stdout, /36 added, 0 updated, 0 removed \(all ours\).*exactly 1 non-ours changed: the root PolicySet "Synthetic Policies" \(one child appended, version changed\)/);
    assert.match(b.stdout, /ALL CHECKS PASSED/);
    const c = node('--check', out, '--base', base); assert.equal(c.status, 0, c.stdout + c.stderr); assert.match(c.stdout, /Larkspur Air Booking Authorization/);
    const s = node('--strip', out, '--out', back); assert.equal(s.status, 0, s.stderr); assert.equal(fs.readFileSync(back, 'utf8'), BASE);
    const out2 = path.join(dir, 'out2.snapshot'); const again = node('--base', out, '--out', out2); assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.match(again.stdout, /0 added, 0 updated, 0 removed \(all ours\), 36 of ours unchanged; no non-ours element changed/); assert.equal(fs.readFileSync(out2, 'utf8'), fs.readFileSync(out, 'utf8'));
    const same = node('--base', base, '--out', base); assert.equal(same.status, 2);
    const bad = path.join(dir, 'bad.snapshot'); fs.writeFileSync(bad, BASE.replace('"version":2', '"version":1'));
    const nope = path.join(dir, 'nope.snapshot'); const r = node('--base', bad, '--out', nope); assert.equal(r.status, 1); assert.match(r.stderr, /REFUSED/); assert.ok(!fs.existsSync(nope));
    assert.equal(fs.readFileSync(base, 'utf8'), BASE, 'the base is never touched');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('names: no statement shares a name with a rule or anything else, none is longer than the longest in the owner file (47), the fare gate is above 0 not below', () => {
  const gen = generate({ fare: FARE, tools: TOOLS, ref: { ToolName: ID(1), UserId: ID(3), ActClientId: ID(4), Amount: ID(2), HitlApproved: ID(5) } });
  const names = gen.map((g) => g.name); assert.equal(new Set(names).size, names.length, 'no name is used twice, across types');
  assert.ok(names.every((n) => n.length <= MAX_NAME), `longest ${Math.max(...names.map((n) => n.length))}`);
  assert.ok(gen.every((g) => OUR_PREFIX[g.type] && g.name.startsWith(OUR_PREFIX[g.type])));
  assert.ok(!JSON.stringify(gen.map((g) => g.obj)).includes('"-1"'), 'no negative number anywhere (the owner file has none)');
});

test('condition shapes stay inside what the owner file holds: no and inside and, no and[1] wrapper, no or of references', () => {
  const gen = generate({ fare: FARE, tools: TOOLS, ref: { ToolName: ID(1), UserId: ID(3), ActClientId: ID(4), Amount: ID(2), HitlApproved: ID(5) } });
  const bad = [];
  const walk = (n, parent, label) => { if (!n || typeof n !== 'object') return; if (n.and) { if (parent === 'and') bad.push(`${label}: and in and`); for (const c of n.and.conditions) walk(c, 'and', label); } else if (n.or) { if (n.or.conditions.some((c) => c.reference)) bad.push(`${label}: or of references`); for (const c of n.or.conditions) walk(c, 'or', label); } else if (n.not) walk(n.not.condition, 'not', label); };
  for (const g of gen.filter((x) => x.type === 'ConditionDefinition')) { walk(g.obj.condition, null, g.name); if (g.obj.condition.and?.conditions.length === 1) bad.push(`${g.name}: and[1] wrapper`); }
  assert.deepEqual(bad, []);
});

const REFS = { ToolName: ID(1), UserId: ID(3), ActClientId: ID(4), Amount: ID(2), HitlApproved: ID(5) };

test('the catch-all: exactly one permit rule with an empty condition, listed last, with its own flat PERMIT statement', () => {
  const gen = generate({ fare: FARE, tools: TOOLS, ref: REFS });
  const rules = gen.filter((g) => g.type === 'Rule');
  const empties = rules.filter((g) => JSON.stringify(g.obj.condition) === '{"empty":{}}'); assert.equal(empties.length, 1);
  const ca = empties[0].obj; assert.equal(ca.name, CATCH_ALL_RULE); assert.equal(ca.name, 'Larkspur Air - Unmatched'); assert.deepEqual(ca.effectSettings, { type: 'unconditionalPermit' });
  const pol = gen.find((g) => g.type === 'Policy').obj; assert.equal(pol.children.length, 9); assert.equal(pol.children.at(-1).id, ca.id, 'listed last');
  const st = gen.find((g) => g.id === ca.statements[0]).obj;
  assert.deepEqual([st.name, st.code, st.appliesTo, st.appliesIf, st.obligatory], ['Larkspur Air Stmt - Unmatched', 'airline-unmatched', 'PERMIT', 'PATH_MATCHES', false]);
  assert.equal(st.payload, '{"outcome":"unmatched"}'); assert.ok(!/HITL|STEPUP|CONSENT|ELICITATION|HUMANAPPROVAL/.test(st.code.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  assert.equal(UNMATCHED_CODE, 'airline-unmatched');
  // every deny-else-permit rule keeps an effect condition byte-identical to its own condition
  for (const g of rules.filter((x) => x.obj.effectSettings.type === 'conditionalDenyElsePermit')) assert.equal(JSON.stringify(g.obj.effectSettings.condition), JSON.stringify(g.obj.condition));
});

test('the catch-all semantics: unmatched rides next to the specific code, stands alone when no outcome matched, and never comes with the DENY', () => {
  const eng = makeEngine(splitElements(run().text));
  const mk = (o) => ({ ToolName: TOOL, UserId: 'u', AirLabMarker: 'larkspur-air', AirFare: '380', AirIsInternational: 'false', AirCabinAsked: FARE.from, AirApproval: 'none', ...o });
  const pol = (o) => eng.evaluatePolicy(POLICY_NAME, mk(o));
  assert.deepEqual([pol({}).decision, pol({}).codes], ['PERMIT', ['airline-permit-as-asked', 'airline-unmatched']]);
  assert.deepEqual([pol({ AirCabinAsked: 'first' }).decision, pol({ AirCabinAsked: 'first' }).codes], ['PERMIT', ['airline-unmatched']], 'an unknown cabin: only the catch-all');
  const noCabin = mk({}); delete noCabin.AirCabinAsked; assert.deepEqual(eng.evaluatePolicy(POLICY_NAME, noCabin).codes, ['airline-unmatched']);
  assert.deepEqual(pol({ AirFare: String(FARE.hold + 1), AirApproval: 'maybe' }).codes, ['airline-unmatched'], 'an unknown approval value: only the catch-all');
  // an unknown approval value matches no outcome at ANY fare (a malformed field never books); the valid ones, and an omitted one (default none), still decide
  for (const fare of [380, 400.5, FARE.limit + 1, FARE.hold, FARE.hold + 1]) for (const bad of ['maybe', '', 'Verified', 'verified ', 'approved']) assert.deepEqual([pol({ AirFare: String(fare), AirApproval: bad }).decision, pol({ AirFare: String(fare), AirApproval: bad }).codes], ['PERMIT', ['airline-unmatched']], `fare ${fare} approval "${bad}"`);
  const noAppr = mk({}); delete noAppr.AirApproval; assert.deepEqual(eng.evaluatePolicy(POLICY_NAME, noAppr).codes, ['airline-permit-as-asked', 'airline-unmatched'], 'an omitted approval is none');
  // a valid declined approval at or under the second limit changes nothing (the lab rule only reads approval over it)
  assert.deepEqual(pol({ AirApproval: 'denied' }).codes, ['airline-permit-as-asked', 'airline-unmatched']);
  const denied = pol({ AirFare: String(FARE.hold + 1), AirApproval: 'denied' }); assert.deepEqual([denied.decision, denied.codes], ['DENY', ['airline-booking-refused']]);
  assert.deepEqual(specificCodes(['airline-unmatched', 'x-other']), [], 'the reader decides only from the specific codes');
  assert.deepEqual(specificCodes(['airline-unmatched', 'airline-permit-as-asked']), ['airline-permit-as-asked']);
  // no marker, foreign tool, no fare: still nothing of ours, the catch-all included
  for (const o of [{ AirLabMarker: '' }, { AirLabMarker: 'other' }, { ToolName: 'transfer_funds' }, { UserId: 'none' }, { AirFare: '0' }]) assert.deepEqual([pol(o).decision, pol(o).codes], ['NOT_APPLICABLE', []], JSON.stringify(o));
  const noFare = mk({}); delete noFare.AirFare; assert.deepEqual(eng.evaluatePolicy(POLICY_NAME, noFare).codes, []);
  // the root: the other demos' requests (no marker) get no airline- code at all
  assert.deepEqual(eng.evaluate('Synthetic Policies', mk({ AirLabMarker: '' })).codes, ['synthetic-permit']);
});

test('fail-safe defaults are enforced: a shared attribute our conditions read with no defaultValue refuses the build and fails --check', () => {
  assert.deepEqual(missingDefaults(splitElements(run().text), splitElements(run().text).filter((e) => isOurs(e.obj)).map((e) => e.obj)), []);
  for (const name of ['ToolName', 'UserId']) for (const gone of ['null', 'absent']) {
    const els = syntheticElements(); const a = els.find((e) => e.name === name); if (gone === 'null') a.defaultValue = null; else delete a.defaultValue;
    assert.throws(() => run(textOf(els)), new RegExp(`no defaultValue.*${name} \\(shared\\)`), `${name} ${gone}`);
  }
  // an attribute the conditions do NOT read may lack a default (Amount is not ours to police)
  const amt = syntheticElements(); amt.find((e) => e.name === 'Amount').defaultValue = null; assert.doesNotThrow(() => run(textOf(amt)));
  // an empty-string default is a default
  const empty = syntheticElements(); empty.find((e) => e.name === 'UserId').defaultValue = ''; assert.doesNotThrow(() => run(textOf(empty)));
  // --check on a finished file: break a shared default, and break one of ours
  const out = splitElements(run().text).map((e) => e.obj);
  const brokenShared = out.map((o) => (o.name === 'UserId' && !isOurs(o) ? { ...o, defaultValue: null } : o));
  const v1 = verifyBuilt({ outText: textOf(brokenShared), fare: FARE, tools: TOOLS }); assert.ok(v1.fail > 0); assert.ok(v1.lines.some((l) => l.startsWith('FAIL') && /fail-safe defaultValue.*UserId \(shared\)/.test(l)), v1.lines.join('\n'));
  const brokenOurs = out.map((o) => (o.name === 'AirApproval' ? { ...o, defaultValue: null } : o));
  const v2 = verifyBuilt({ outText: textOf(brokenOurs), fare: FARE, tools: TOOLS }); assert.ok(v2.lines.some((l) => l.startsWith('FAIL') && /fail-safe defaultValue.*AirApproval/.test(l)), v2.lines.join('\n'));
  // the check also fails when the catch-all is not last or is missing
  const reordered = out.map((o) => (o.name === POLICY_NAME ? { ...o, children: [...o.children.slice(-1), ...o.children.slice(0, -1)] } : o));
  assert.ok(verifyBuilt({ outText: textOf(reordered), fare: FARE, tools: TOOLS }).lines.some((l) => l.startsWith('FAIL') && /catch-all/.test(l)));
  const noCatch = out.filter((o) => o.name !== CATCH_ALL_RULE).map((o) => (o.name === POLICY_NAME ? { ...o, children: o.children.slice(0, -1) } : o));
  assert.ok(verifyBuilt({ outText: textOf(noCatch), fare: FARE, tools: TOOLS }).lines.some((l) => l.startsWith('FAIL') && /catch-all/.test(l)));
  // and through the command line
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authz-')); try {
    const bad = path.join(dir, 'bad.snapshot'); const o = path.join(dir, 'o.snapshot'); const els = syntheticElements(); els.find((e) => e.name === 'ToolName').defaultValue = null; fs.writeFileSync(bad, textOf(els));
    const r = spawnSync(process.execPath, [SCRIPT, '--base', bad, '--out', o], { encoding: 'utf8' }); assert.equal(r.status, 1); assert.match(r.stderr, /REFUSED.*no defaultValue.*ToolName \(shared\)/); assert.ok(!fs.existsSync(o));
    const good = path.join(dir, 'good.snapshot'); fs.writeFileSync(good, brokenShared.length ? textOf(brokenShared) : '');
    const c = spawnSync(process.execPath, [SCRIPT, '--check', good], { encoding: 'utf8' }); assert.equal(c.status, 1); assert.match(c.stdout, /FAIL .*fail-safe defaultValue/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an import of the PREVIOUS version (no catch-all, no known-approval requirement) updates only what changed: 2 new objects, the Request Complete condition, the policy, and the root version', () => {
  const now = run(); const els = splitElements(now.text).map((e) => e.obj);
  const rule = els.find((o) => o.name === CATCH_ALL_RULE); const stmt = els.find((o) => o.name === 'Larkspur Air Stmt - Unmatched');
  const oldPolicy = { ...els.find((o) => o.name === POLICY_NAME) }; oldPolicy.children = oldPolicy.children.filter((c) => c.id !== rule.id); oldPolicy.description = 'previous'; oldPolicy.version = '5b0a1c20-0000-5000-8000-0000000000aa';
  const oldC4 = JSON.parse(JSON.stringify(els.find((o) => o.name === 'Larkspur Air - Request Complete'))); oldC4.condition.and.conditions = oldC4.condition.and.conditions.slice(0, 2); oldC4.description = 'previous'; oldC4.version = '5b0a1c20-0000-5000-8000-0000000000bb';
  const root = splitElements(BASE).find((e) => e.obj.type === 'PolicySet'); const newRootText = spliceRoot(root.text, oldPolicy.id, oldPolicy.version, root.obj.version);
  const prev = textOf(els.filter((o) => o !== rule && o !== stmt).map((o) => (o.name === POLICY_NAME ? oldPolicy : o.name === oldC4.name ? oldC4 : o.type === 'PolicySet' ? JSON.parse(newRootText) : o)));
  assert.equal(prev.includes(CATCH_ALL_RULE), false);
  const up = run(prev);
  assert.deepEqual({ ...up.summary }, { added: 2, updated: 2, unchanged: 32, removed: 0, rootChanged: true, rootChildAlreadyThere: true });
  assert.equal(up.text, now.text, 'from the previous build or from the original: the same bytes');
  const was = oursOf(prev); const is = oursOf(up.text);
  const changed = [...is.keys()].filter((k) => was.get(k) !== is.get(k)).sort();
  assert.deepEqual(changed, [CATCH_ALL_RULE, POLICY_NAME, 'Larkspur Air Stmt - Unmatched', 'Larkspur Air - Request Complete'].sort(), 'the four, nothing else (every other object keeps its text and version)');
  assert.equal(stripOurs(up.text), BASE);
  const nowRoot = splitElements(up.text).find((e) => e.obj.type === 'PolicySet'); const prevRoot = splitElements(prev).find((e) => e.obj.type === 'PolicySet');
  assert.notEqual(nowRoot.obj.version, prevRoot.obj.version, 'the root version changes (it follows our policy version)');
  assert.deepEqual(nowRoot.obj.children, prevRoot.obj.children, 'the root children are the same');
});


// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The overlay (--update-from). Everything here is synthetic: the audiences, ids and payloads are made up for these tests.
const COND_NAME = 'HasValidMcpAudience'; const STMT_NAME = 'MCP Denied — Invalid Audience';
const V = (n) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const audCond = (branches, version, description) => ({ objectType: 'ConditionDefinition', condition: { or: { conditions: branches } }, description, fullName: COND_NAME, id: ID(12), name: COND_NAME, numberOfChildren: null, parentId: null, type: 'CONDITION', version });
const audStmt = (payload, version) => ({ id: ID(22), version, name: STMT_NAME, description: 'synthetic', shared: false, code: 'synthetic-aud-deny', appliesTo: 'DENY', appliesIf: 'PATH_MATCHES', payload, obligatory: false, attributes: [], services: [], type: 'Statement' });
const BR = () => [cmp(ID(6), 'Equals', 'aud-a'), cmp(ID(6), 'Equals', 'aud-b'), { and: { conditions: [cmp(ID(6), 'Equals', 'aud-c'), cmp(ID(3), 'NotEquals', 'none')] } }];
// The base with the two allow-listed objects (and the attribute the audience condition reads) added; the base the owner would export.
const overlayBaseEls = () => {
  const els = syntheticElements();
  els.splice(at(els, ID(5)) + 1, 0, attr('AudSyn', ID(6), 'STRING', 'none'));
  els.splice(at(els, ID(11)) + 1, 0, audCond(BR(), V(1), 'synthetic old description'));
  els.splice(at(els, ID(21)) + 1, 0, audStmt('{"reason":"old"}', V(2)));
  return els;
};
const OBASE = textOf(overlayBaseEls());
// The update: new branch put in the MIDDLE of the list (as a real update may), new description, new payload, new versions. `mut(els)` can make it drift.
const updateEls = (mut = () => {}) => {
  const els = overlayBaseEls();
  const c = els.find((e) => e.name === COND_NAME); const b = BR(); c.condition.or.conditions = [b[0], cmp(ID(6), 'Equals', 'aud-new'), b[1], b[2]]; c.description = 'synthetic new description'; c.version = V(3);
  const st = els.find((e) => e.name === STMT_NAME); st.payload = '{"reason":"new"}'; st.version = V(4);
  // noise elsewhere in the update that must never be taken: a retyped default and a different id for a shared rule
  els.find((e) => e.name === 'Amount').defaultValue = 0; els.find((e) => e.name === 'Synthetic Permit Rule').id = ID(39);
  mut(els); return els;
};
const prettyOf = (els) => `[\n  ${els.map((e) => JSON.stringify(e)).join(',\n  ')}\n]\n`;
const UPD = prettyOf(updateEls());
const runO = (baseText = OBASE, updateText = UPD, fare = FARE) => build({ baseText, fare, tools: TOOLS, updateText });
const elText = (text, name) => splitElements(text, { loose: true }).find((e) => e.obj.name === name && !isOurs(e.obj)).text;
const changedNonOurs = (a, b) => { const x = splitElements(a).filter((e) => !isOurs(e.obj)); const y = splitElements(b).filter((e) => !isOurs(e.obj)); assert.equal(x.length, y.length); return y.filter((e, i) => e.text !== x[i].text).map((e) => nameOf(e.obj)).sort(); };

test('overlay: the two allow-listed objects are spliced in as the update\'s own text, the base\'s id is kept, the version is the update\'s, nothing else of the base changes but the root', () => {
  const r = runO();
  assert.equal(elText(r.text, COND_NAME), elText(UPD, COND_NAME), 'character for character the update\'s element');
  assert.equal(elText(r.text, STMT_NAME), elText(UPD, STMT_NAME));
  const c = JSON.parse(elText(r.text, COND_NAME)); assert.equal(c.id, ID(12)); assert.equal(c.version, V(3)); assert.equal(c.condition.or.conditions.length, 4);
  assert.equal(JSON.parse(elText(r.text, STMT_NAME)).payload, '{"reason":"new"}'); assert.equal(JSON.parse(elText(r.text, STMT_NAME)).version, V(4));
  assert.deepEqual(changedNonOurs(OBASE, r.text), [COND_NAME, STMT_NAME, 'Synthetic Policies'].sort(), 'the overlay objects and the root, nothing else');
  assert.deepEqual({ ...r.summary }, { added: 36, updated: 0, unchanged: 0, removed: 0, rootChanged: true, rootChildAlreadyThere: false });
  assert.deepEqual(r.overlay.map((x) => [x.name, x.status]), [[COND_NAME, 'applied'], [STMT_NAME, 'applied']]);
  assert.deepEqual(r.overlay.find((x) => x.name === COND_NAME).paths.sort(), ['condition.or.conditions', 'description']);
  assert.match(summaryLine(r.summary, r.rootName, r.overlay), /36 added.*3 shared objects changed.*overlay: taken from the update: "HasValidMcpAudience", "MCP Denied — Invalid Audience"/);
  assert.equal(JSON.parse(elText(r.text, 'Amount')).defaultValue, '0', 'the base\'s own text for a shared attribute stays');
  assert.equal(JSON.parse(elText(r.text, 'Synthetic Permit Rule')).id, ID(31), 'a shared rule with another id in the update is not touched');
  const v = verifyBuilt({ outText: r.text, inText: OBASE, fare: FARE, tools: TOOLS, updateText: UPD }); assert.equal(v.fail, 0, v.lines.join('\n'));
  assert.ok(v.lines.some((l) => /overlay.*HasValidMcpAudience.*makes the condition true in the output and not in the input/.test(l)), v.lines.join('\n'));
  // the same check without the update would flag the two objects as unexpected changes
  const w = verifyBuilt({ outText: r.text, inText: OBASE, fare: FARE, tools: TOOLS }); assert.ok(w.fail > 0);
});

test('overlay: order is original export, then overlay, then ours; the groups and the root logic are unchanged', () => {
  const plain = build({ baseText: OBASE, fare: FARE, tools: TOOLS }); const r = runO();
  assert.deepEqual(splitElements(r.text).map((e) => e.obj.id ?? e.obj.type), splitElements(plain.text).map((e) => e.obj.id ?? e.obj.type), 'same elements in the same places as a build with no overlay');
  assert.deepEqual(oursOf(r.text), oursOf(plain.text), 'our 36 objects are the same texts and versions');
  assert.equal(nonOurs(r.text).filter((t, i) => t !== nonOurs(plain.text)[i]).length, 2, 'only the two overlay elements differ from a build without the overlay');
});

test('overlay: repeatable, building from its own output with the same update changes nothing', () => {
  const first = runO(); const again = runO(first.text);
  assert.equal(again.text, first.text);
  assert.deepEqual({ ...again.summary }, { added: 0, updated: 0, unchanged: 36, removed: 0, rootChanged: false, rootChildAlreadyThere: true });
  assert.deepEqual(again.overlay.map((x) => x.status), ['already', 'already']);
  assert.match(summaryLine(again.summary, again.rootName, again.overlay), /overlay: nothing to take/);
  assert.equal(runO(again.text).text, first.text);
  const v = verifyBuilt({ outText: again.text, inText: first.text, fare: FARE, tools: TOOLS, updateText: UPD }); assert.equal(v.fail, 0, v.lines.join('\n'));
  // an update that carries the SAME content as the base but another version and key order is not taken (nothing to change)
  const same = overlayBaseEls(); same.find((e) => e.name === COND_NAME).version = V(9); const reorder = (o) => Object.fromEntries(Object.entries(o).reverse());
  same[same.findIndex((e) => e.name === COND_NAME)] = reorder(same.find((e) => e.name === COND_NAME));
  const noop = runO(OBASE, prettyOf(same)); assert.equal(noop.overlay[0].status, 'already'); assert.equal(elText(noop.text, COND_NAME), elText(OBASE, COND_NAME));
});

test('overlay: the semantic diff ignores version and key order and names only paths', () => {
  const a = { version: 'x', a: 1, b: { c: [1, 2], d: 'q' } }; const b = { b: { d: 'q', c: [1, 2] }, a: 1, version: 'y' };
  assert.deepEqual(semanticDiff(a, b), []);
  assert.deepEqual(semanticDiff(a, { ...b, a: 2 }).map((d) => d.path), ['a']);
  assert.deepEqual(semanticDiff(a, { ...b, b: { d: 'q', c: [1, 3] } }).map((d) => d.path), ['b.c[1]']);
  assert.deepEqual(semanticDiff(a, { ...b, e: 1 }).map((d) => d.path), ['e']);
  assert.deepEqual(OVERLAY_ALLOW.map((r) => [r.type, r.name]), [['ConditionDefinition', COND_NAME], ['Statement', STMT_NAME]]);
});

test('overlay: the semantic-diff guard refuses an update that drifts, naming the paths and never the values', () => {
  const refuse = (mut, re) => { const upd = prettyOf(updateEls(mut)); assert.throws(() => runO(OBASE, upd), (e) => { assert.match(e.message, re, e.message); assert.ok(!/aud-|synthetic-aud|reason/.test(e.message), `no content in: ${e.message}`); return true; }); };
  refuse((els) => { els.find((e) => e.name === COND_NAME).shared = true; }, /more than the expected content.*shared/);
  refuse((els) => { els.find((e) => e.name === STMT_NAME).code = 'other'; }, /more than the expected content.*code/);
  refuse((els) => { els.find((e) => e.name === STMT_NAME).appliesTo = 'PERMIT'; }, /appliesTo/);
  refuse((els) => { els.find((e) => e.name === STMT_NAME).description = 'drift'; }, /description/);
  refuse((els) => { els.find((e) => e.name === COND_NAME).condition.or.conditions[0] = cmp(ID(6), 'Equals', 'aud-changed'); }, /condition\.or\.conditions: an existing branch was changed or removed/);
  refuse((els) => { els.find((e) => e.name === COND_NAME).condition.or.conditions.splice(0, 1); }, /condition\.or\.conditions: 3 branches became 3|an existing branch|exactly one may be added/);
  refuse((els) => { els.find((e) => e.name === COND_NAME).condition.or.conditions.push(cmp(ID(6), 'Equals', 'aud-two')); }, /3 branches became 5; exactly one may be added/);
  refuse((els) => { const c = els.find((e) => e.name === COND_NAME).condition.or.conditions; c[1] = cmp(ID(6), 'NotEquals', 'aud-new'); }, /not one Equals comparison/);
  refuse((els) => { const c = els.find((e) => e.name === COND_NAME).condition.or.conditions; c[1] = cmp(ID(3), 'Equals', 'aud-new'); }, /reads an attribute that no existing comparison branch reads/);
  refuse((els) => { const c = els.find((e) => e.name === COND_NAME).condition.or.conditions; c[1] = { and: { conditions: [cmp(ID(6), 'Equals', 'x')] } }; }, /not one Equals comparison/);
  refuse((els) => { els.find((e) => e.name === COND_NAME).condition = { and: { conditions: [] } }; }, /condition/);
  // the update's version must differ from the base's: an import would skip an object whose version is unchanged
  refuse((els) => { els.find((e) => e.name === STMT_NAME).version = V(2); }, /same version as the base's/);
  refuse((els) => { delete els.find((e) => e.name === STMT_NAME).version; }, /same version|version/);
});

test('overlay: refused when an allow-listed object is missing, duplicated, or has another id or name in either file', () => {
  const refuse = (mut, re, base = OBASE) => assert.throws(() => runO(base, prettyOf(updateEls(mut))), re);
  refuse((els) => els.splice(els.findIndex((e) => e.name === COND_NAME), 1), /exactly one ConditionDefinition named "HasValidMcpAudience" in the update; found 0/);
  refuse((els) => els.splice(els.findIndex((e) => e.name === STMT_NAME), 1), /exactly one Statement named .* in the update; found 0/);
  refuse((els) => { els.find((e) => e.name === COND_NAME).id = ID(99); }, /the overlay refuses: ConditionDefinition "HasValidMcpAudience" has the id 99999999\.\.\. in the update and 99999999\.\.\. in the base/);
  refuse((els) => { els.find((e) => e.name === STMT_NAME).id = ID(98); }, /Statement .* has the id/);
  refuse((els) => { const c = els.find((e) => e.name === COND_NAME); c.name = 'HasValidMcpAudience2'; c.fullName = c.name; }, /found 0/);
  refuse((els) => els.push({ ...els.find((e) => e.name === COND_NAME), id: ID(97) }), /found 2/);
  const noBaseCond = overlayBaseEls().filter((e) => e.name !== COND_NAME);
  assert.throws(() => runO(textOf(noBaseCond)), /exactly one ConditionDefinition named "HasValidMcpAudience" in the base; found 0/);
  const renamed = overlayBaseEls(); renamed.find((e) => e.name === STMT_NAME).name = 'Another Name';
  assert.throws(() => runO(textOf(renamed)), /Statement named .* in the base; found 0/);
  const reid = overlayBaseEls(); reid.find((e) => e.name === STMT_NAME).id = ID(96);
  assert.throws(() => runO(textOf(reid)), /has the id/);
  // an update element spread over several lines is not spliced (it would put new whitespace into the file)
  const multi = `[\n  ${updateEls().map((e) => (e.name === COND_NAME ? JSON.stringify(e, null, 1) : JSON.stringify(e))).join(',\n  ')}\n]`;
  assert.throws(() => runO(OBASE, multi), /not in the compact form/);
  // a base with no overlay objects (the plain synthetic one) is refused when an update is given, never silently skipped
  assert.throws(() => runO(BASE), /in the base; found 0/);
  // a refusal builds nothing: applyOverlay itself leaves the inputs alone
  const rest = splitElements(OBASE).filter((e) => !isOurs(e.obj)); const before = rest.map((e) => e.text);
  assert.throws(() => applyOverlay(rest, splitElements(prettyOf(updateEls((els) => { els.find((e) => e.name === COND_NAME).shared = true; })), { loose: true })));
  assert.deepEqual(rest.map((e) => e.text), before);
});

test('overlay: --strip restores the base as built unless the original is given, then the original byte for byte (decision: the original is not stored in the file)', () => {
  const r = runO();
  const kept = stripOurs(r.text);
  assert.notEqual(kept, OBASE, 'without the original the overlay stays: the original text is not in the file');
  assert.equal(elText(kept, COND_NAME), elText(UPD, COND_NAME));
  assert.deepEqual(changedNonOurs(OBASE, kept), [COND_NAME, STMT_NAME].sort(), 'only the two overlay objects differ from the original; the root and ours are gone');
  assert.equal(stripOurs(r.text, { original: OBASE }), OBASE, 'with the original: byte for byte');
  assert.equal(stripOurs(runO(r.text).text, { original: OBASE }), OBASE, 'also from a rebuilt output');
  // a file with ours but no overlay, stripped with an original that has them, would be changed: refused when the ids differ
  const other = overlayBaseEls(); other.find((e) => e.name === COND_NAME).id = ID(95);
  assert.throws(() => stripOurs(r.text, { original: textOf(other) }), /another id/);
  assert.throws(() => stripOurs(r.text, { original: BASE }), /in the original; found 0/);
  // a build without an overlay is stripped exactly as before, with or without an original
  const plain = build({ baseText: OBASE, fare: FARE, tools: TOOLS }); assert.equal(stripOurs(plain.text), OBASE); assert.equal(stripOurs(plain.text, { original: OBASE }), OBASE);
});

test('overlay: the command line builds, checks (overlay objects and proof lines), strips with and without --base-original, and refuses cleanly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authz-')); const e = (n) => path.join(dir, n);
  try {
    fs.writeFileSync(e('base'), OBASE); fs.writeFileSync(e('upd'), UPD);
    const node = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    const b = node('--base', e('base'), '--out', e('out'), '--update-from', e('upd')); assert.equal(b.status, 0, b.stdout + b.stderr);
    assert.match(b.stdout, /36 added, 0 updated, 0 removed \(all ours\).*3 shared objects changed.*overlay: taken from the update/); assert.match(b.stdout, /ALL CHECKS PASSED/);
    assert.match(b.stdout, /Overlay objects \(allow-listed shared objects, taken from the update\):/); assert.match(b.stdout, /HasValidMcpAudience\s+id 99999999\.\.\.\s+version 00000000\.\.\. -> 00000000\.\.\.\s+\(changed against the input\)/);
    assert.match(b.stdout, /PASS\s+overlay ConditionDefinition "HasValidMcpAudience": the output carries the update's element, character for character/);
    const c = node('--check', e('out'), '--base', e('base'), '--update-from', e('upd')); assert.equal(c.status, 0, c.stdout + c.stderr); assert.match(c.stdout, /overlay Statement "MCP Denied — Invalid Audience": against the input only payload changed and the version is new/);
    const c2 = node('--check', e('out'), '--update-from', e('upd')); assert.equal(c2.status, 0, c2.stdout + c2.stderr); assert.match(c2.stdout, /the file carries the update's element, character for character \(without --base/);
    const c3 = node('--check', e('out')); assert.equal(c3.status, 0, c3.stdout + c3.stderr); assert.match(c3.stdout, /no --update-from given, so only what the file holds is listed/);
    const s1 = node('--strip', e('out'), '--out', e('kept')); assert.equal(s1.status, 0, s1.stderr); assert.match(s1.stdout, /overlay objects are left as the file has them/); assert.equal(fs.readFileSync(e('kept'), 'utf8'), stripOurs(fs.readFileSync(e('out'), 'utf8')));
    const s2 = node('--strip', e('out'), '--out', e('orig'), '--base-original', e('base')); assert.equal(s2.status, 0, s2.stderr); assert.equal(fs.readFileSync(e('orig'), 'utf8'), OBASE); assert.match(s2.stdout, /byte for byte the original/);
    // a different original (a plain base that lacks the objects) or one the file was not built from is refused and nothing is written
    fs.writeFileSync(e('plain'), BASE); const s3 = node('--strip', e('out'), '--out', e('nope'), '--base-original', e('plain')); assert.equal(s3.status, 1); assert.match(s3.stderr, /REFUSED/); assert.ok(!fs.existsSync(e('nope')));
    const drift = overlayBaseEls(); drift.find((x) => x.name === 'Amount').defaultValue = '5'; fs.writeFileSync(e('drift'), textOf(drift));
    const s4 = node('--strip', e('out'), '--out', e('nope2'), '--base-original', e('drift')); assert.equal(s4.status, 1); assert.match(s4.stderr, /not built from that original/); assert.ok(!fs.existsSync(e('nope2')));
    // a drifting update: refused, no output file, the message lists paths
    fs.writeFileSync(e('bad'), prettyOf(updateEls((els) => { els.find((x) => x.name === STMT_NAME).code = 'other'; })));
    const r = node('--base', e('base'), '--out', e('nope3'), '--update-from', e('bad')); assert.equal(r.status, 1); assert.match(r.stderr, /REFUSED.*more than the expected content.*code/); assert.ok(!fs.existsSync(e('nope3')));
    // repeatable through the command line
    const again = node('--base', e('out'), '--out', e('out2'), '--update-from', e('upd')); assert.equal(again.status, 0, again.stdout + again.stderr); assert.equal(fs.readFileSync(e('out2'), 'utf8'), fs.readFileSync(e('out'), 'utf8'));
    assert.match(again.stdout, /0 added, 0 updated, 0 removed \(all ours\), 36 of ours unchanged; no non-ours element changed.*overlay: nothing to take/);
    assert.equal(fs.readFileSync(e('base'), 'utf8'), OBASE, 'the base is never touched'); assert.equal(fs.readFileSync(e('upd'), 'utf8'), UPD, 'the update is never touched');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('overlay: no real constant is written in the script (the allow-list names objects, never an audience, id or payload)', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/.test(src.replace(NAMESPACE_LINE(src), '')), 'no object id in the script');
});
function NAMESPACE_LINE(src) { return src.split('\n').find((l) => l.startsWith('export const NAMESPACE')) ?? ''; }
