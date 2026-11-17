#!/usr/bin/env node
// Builds the PingOne Authorize import file for the Larkspur Air booking rule: the owner's exported snapshot PLUS only our objects.
//
//   node scripts/owner/build-authorize-import.mjs --base <snapshot> --out <file> [--update-from <snapshot>]   build (base = the owner's export, or our last build)
//   node scripts/owner/build-authorize-import.mjs --check <file> [--base <snapshot>] [--update-from <snapshot>]   verify a built file, print the tables
//   node scripts/owner/build-authorize-import.mjs --strip <file> --out <file> [--base-original <snapshot>]   take every object of ours out again (the rollback by hand)
//
// How it works. The snapshot is a JSON array written compactly. The script cuts it into its top-level elements WITH their text, takes out the elements that
// are OURS (found by their deterministic ids and our name prefixes), generates ours fresh from FARE_RULE in server/src/policy.js, and splices them back in
// as raw text. Every other element is copied as the same characters it had, so it is never re-serialised. The ONE existing element that changes is the root
// policy set: one child (our policy) is appended by string splice and its `version` is replaced (an unchanged version makes an import skip the object).
// The OVERLAY (--update-from). An import replaces the whole tree, so two files must not compete: when another snapshot carries a newer version of a few shared
// objects, those objects are folded into THIS file. Only the objects named in OVERLAY_ALLOW (matched by type, id AND name in both files) are taken, as element
// text spliced over the base's element; the update must differ from the base only in the expected content (a semantic diff that ignores `version`), and its
// `version` must differ from the base's so an import applies it. Everything else in the update is ignored, whatever it holds. Order: the owner's export, then the
// overlay, then ours. --strip keeps the overlay (it restores the base as the build saw it) unless --base-original names the owner's original export, which
// restores the overlaid objects too and gives that export back byte for byte.
// Run it again on its own output and it replaces exactly our elements, adds new ones and removes any it no longer generates. It never reads a tenant or
// the network, and it never prints a description or a payload of the owner's objects.
//
// Two rules of the P1AZ import skill are enforced: every attribute a condition of ours reads has a fail-safe defaultValue (ours AND the shared ones; the build
// refuses and --check fails otherwise), and our policy ends with exactly one catch-all permit rule (condition {empty:{}}, unconditionalPermit, listed last).
// Authoring stays the GA snapshot import through the console; nothing here calls any API.
//
// The numbers (the two fare limits, the cabin names, the booking tool) come from server/src/policy.js; none is written here.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
export const POLICY_PATH = path.join(REPO, 'server', 'src', 'policy.js');

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Identity: ids and versions are uuid v5 of a fixed namespace, so a rebuild is byte for byte the same.
export const NAMESPACE = '6f1c2d9a-4b7e-5c3a-8d10-3a9e5b7c2f64';
// The value the lab sends in AirLabMarker. A request without it (every other demo) finds our policy not applicable.
export const MARKER = 'larkspur-air';
export function uuid5(name, namespace = NAMESPACE) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = crypto.createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v));

// Which type an element is, and the name prefix that marks an object as ours for that type.
export const typeOf = (o) => (o && typeof o === 'object' ? (o.objectType ?? o.type ?? o['@class'] ?? 'unknown') : 'null');
export const nameOf = (o) => (o && typeof o === 'object' ? (o.fullName ?? o.name ?? '') : '');
export const OUR_PREFIX = { AttributeDefinition: 'Air', ConditionDefinition: 'Larkspur Air', Statement: 'Larkspur Air', Rule: 'Larkspur Air', Policy: 'Larkspur Air' };
export const detId = (type, name) => uuid5(`id:${type}:${name}`);
// OURS = our name prefix for its type AND the id we derive from that type and name. A prefixed name with any other id is not ours.
export const isOurs = (o) => {
  const t = typeOf(o); const p = OUR_PREFIX[t];
  return Boolean(p) && typeof o.id === 'string' && nameOf(o).startsWith(p) && o.id === detId(t, nameOf(o));
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Parsing: top-level elements with their text. The file must be the compact form `[e1,e2,...]` so that joining the texts with commas rebuilds it exactly.
export function splitElements(text, { loose = false } = {}) {
  if (loose) text = text.trim();
  if (text[0] !== '[' || text[text.length - 1] !== ']') throw new Error('the snapshot is not a JSON array written as [..] with no surrounding whitespace');
  const els = []; let depth = 0; let inStr = false; let esc = false; let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; if (depth === 1 && start < 0) start = i; continue; }
    if (c === '[' || c === '{') { if (depth === 1 && start < 0) start = i; depth++; continue; }
    if (c === ']' || c === '}') { depth--; if (depth === 1) { els.push({ start, end: i + 1 }); start = -1; } else if (depth === 0 && start >= 0) { els.push({ start, end: i }); start = -1; } continue; }
    if (depth === 1 && c === ',') { if (start >= 0) { els.push({ start, end: i }); start = -1; } continue; }
    if (depth === 1 && start < 0 && !/\s/.test(c)) start = i;
  }
  const out = els.map((r) => ({ ...r, text: loose ? text.slice(r.start, r.end).trim() : text.slice(r.start, r.end) }));
  if (!loose && out.map((e) => e.text).join(',') !== text.slice(1, -1)) throw new Error('the snapshot is not in the compact form (elements separated by a bare comma, no whitespace); refusing to re-space it');
  for (const e of out) { try { e.obj = JSON.parse(e.text); } catch { throw new Error(`an element is not valid JSON (at offset ${e.start})`); } }
  return out;
}
export const joinElements = (texts) => `[${texts.join(',')}]`;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// References: every id an object points at, read from structural positions only (descriptions and constants can mention ids that are not in the file).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_RE = /\{\{([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}\}/g;
export function refsOf(obj) {
  const refs = new Set();
  const walk = (node, key) => {
    if (typeof node === 'string') { if (key !== 'description' && key !== 'name' && key !== 'fullName') for (const m of node.matchAll(TOKEN_RE)) refs.add(m[1]); if (key === 'userIdAttribute' && UUID_RE.test(node)) refs.add(node); return; }
    if (Array.isArray(node)) { for (const x of node) { if ((key === 'statements' || key === 'attributes' || key === 'services') && typeof x === 'string') refs.add(x); else walk(x, key); } return; }
    if (!node || typeof node !== 'object') return;
    if ((key === 'attribute' || key === 'reference') && typeof node.id === 'string') refs.add(node.id);
    if (key === 'children' && typeof node.id === 'string') refs.add(node.id);
    if (node.attributeResolverType === 'service' && typeof node.id === 'string') refs.add(node.id);
    for (const [k, v] of Object.entries(node)) walk(v, k);
  };
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'children' && Array.isArray(v)) { for (const c of v) if (c && typeof c.id === 'string') refs.add(c.id); } else if (k === 'parentId' && typeof v === 'string') refs.add(v); else walk(v, k);
  }
  return refs;
}
const HAS_ID = (e) => e.obj && typeof e.obj === 'object' && typeof e.obj.id === 'string' && !String(typeOf(e.obj)).startsWith('SnapshotPackageFile') && e.obj['@class'] === undefined;

// The completeness check of a snapshot: shape, and every referenced id resolves inside it.
export function completeness(els) {
  const problems = [];
  const o0 = els[0]?.obj; const o1 = els[1]?.obj; const last = els[els.length - 1]?.obj;
  if (!(o0 && o0['@class'] === 'DataStreamHeader' && o0.kind === 'SnapshotHeader' && o0.version === 2)) problems.push('the first element is not a SnapshotHeader of version 2');
  if (!(o1 && o1.type === 'SnapshotPackageFile$PackageHeader' && o1.snapshotFileVersion === 2)) problems.push('the second element is not a PackageHeader with snapshotFileVersion 2');
  if (!(last && last['@class'] === 'DataStreamFooter')) problems.push('the last element is not a DataStreamFooter');
  if (!els.some((e) => e.obj?.type === 'SnapshotPackageFile$PackageSeparator')) problems.push('no PackageSeparator');
  if (!els.some((e) => e.obj?.type === 'SnapshotPackageFile$EndOfPackage')) problems.push('no EndOfPackage');
  const ids = new Map();
  for (const e of els.filter(HAS_ID)) { if (ids.has(e.obj.id)) problems.push(`duplicate id ${e.obj.id} (${nameOf(e.obj)})`); ids.set(e.obj.id, e); }
  let refCount = 0;
  for (const e of els.filter(HAS_ID)) for (const r of refsOf(e.obj)) { refCount++; if (!ids.has(r)) problems.push(`${typeOf(e.obj)} "${nameOf(e.obj)}" references ${r}, which is not in the snapshot`); }
  for (const e of els.filter((x) => x.obj?.type === 'Policy' || x.obj?.type === 'PolicySet')) for (const c of e.obj.children ?? []) { const t = ids.get(c.id); if (t && typeOf(t.obj) !== c.type) problems.push(`child ${c.id} of "${nameOf(e.obj)}" is declared ${c.type} but is ${typeOf(t.obj)}`); }
  return { problems, ids, refCount };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Generation. `fare` is FARE_RULE ({limit, hold, from, to}); `tools` the booking tool names; `ref` maps the existing attributes' names to their ids.
const finish = (type, name, build) => {
  const id = detId(type, name);
  const body = build(id);
  const { version: _v, ...content } = body; void _v;
  const version = uuid5(`version:${type}:${name}:${stable(content)}`);
  return { type, name, id, obj: { ...body, version } };
};
// Key order is the owner's file's key order, per type.
const attrObj = (id, name, valueType, defaultValue, description) => ({ objectType: 'AttributeDefinition', defaultValue, description, fullName: name, id, name, numberOfChildren: null, parentId: null, repetitionSource: null, resolvers: [{ attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null }], type: 'ATTRIBUTE', valueProcessor: null, valueSchema: null, valueType, version: null });
const condObj = (id, name, condition, description) => ({ objectType: 'ConditionDefinition', condition, description, fullName: name, id, name, numberOfChildren: null, parentId: null, type: 'CONDITION', version: null });
const stmtObj = (id, name, description, code, appliesTo, payload) => ({ id, version: null, name, description, shared: false, code, appliesTo, appliesIf: 'PATH_MATCHES', payload, obligatory: false, attributes: [], services: [], type: 'Statement' });
const ruleObj = (id, name, condition, effectSettings, statements, description) => ({ id, version: null, targets: [], name, shared: false, disabled: false, condition, effectSettings, statements, description, type: 'Rule' });

// The prefix of the names of the conditions, statements and rules (the design's names, under the Larkspur Air prefix).
const P = 'Larkspur Air - ';
// Statements get their own prefix so no statement shares its name with a rule (the owner's file has no name under two types). Both start 'Larkspur Air'.
const PS = 'Larkspur Air Stmt - ';
// The longest name in the owner's file is 47 characters; ours stay within it.
export const MAX_NAME = 47;
export const POLICY_NAME = 'Larkspur Air Booking Authorization';
export const CATCH_ALL_RULE = 'Larkspur Air - Unmatched';
// Words in a code the owner's gateway reads as a hold (after upper-casing and stripping non-alphanumerics). Ours must not carry them.
export const CODE_PREFIX = 'airline-';
export const UNMATCHED_CODE = 'airline-unmatched';
// The lab decides ONLY from the specific outcome codes: every code except the catch-all's.
export const specificCodes = (codes) => codes.filter((c) => c.startsWith(CODE_PREFIX) && c !== UNMATCHED_CODE);
// The AirApproval values the lab sends. Any other value matches no outcome rule, at any fare.
export const APPROVALS = ['none', 'verified', 'claimed', 'denied'];
const GATE_WORDS = ['HITL', 'STEPUP', 'CONSENT', 'ELICITATION', 'HUMANAPPROVAL'];

export function generate({ fare, tools, ref }) {
  const { limit, hold, from, to } = fare;
  for (const [k, v] of [['limit', limit], ['hold', hold]]) if (!Number.isFinite(v)) throw new Error(`FARE_RULE.${k} is not a number`);
  if (!(limit < hold)) throw new Error('FARE_RULE.limit must be below FARE_RULE.hold');
  if (typeof from !== 'string' || typeof to !== 'string' || !from || !to || from === to) throw new Error('FARE_RULE.from and .to must be two different cabin names');
  const toolList = [...tools].sort(); if (!toolList.length) throw new Error('BOOKING_TOOLS is empty');
  const out = [];
  const add = (x) => { out.push(x); return x; };
  const usd = (n) => `$${Number(n).toLocaleString('en-US')}`;
  const NOTE = 'Larkspur Air lab rule (LAB-INVENTED limits, read from server/src/policy.js FARE_RULE when this file was built).';

  // --- attributes (new, request-supplied; the fare fails CLOSED: its default 0 matches no rule, like the shared Amount's default 0 with GreaterThan 0) ---
  const aMark = add(finish('AttributeDefinition', 'AirLabMarker', (id) => attrObj(id, 'AirLabMarker', 'STRING', '', `Marker the Larkspur Air lab sends (${MARKER}). A request from any other demo never sends it, so the Larkspur Air policy is not applicable to it. Larkspur Air lab attribute, nothing else reads it.`)));
  const aFare = add(finish('AttributeDefinition', 'AirFare', (id) => attrObj(id, 'AirFare', 'NUMBER', '0', 'The fare in dollars, from the lab flights table. Default 0 on purpose: a request that omits it resolves to 0 and matches no rule (fail closed; a fare of 0 is not a booking). Larkspur Air lab attribute, separate from the shared Amount.')));
  const aIntl = add(finish('AttributeDefinition', 'AirIsInternational', (id) => attrObj(id, 'AirIsInternational', 'BOOLEAN', 'false', 'True when the staged trip is international. Sent by the Larkspur Air lab with the booking request; absent means false. Larkspur Air lab attribute, nothing else reads it.')));
  const aCabin = add(finish('AttributeDefinition', 'AirCabinAsked', (id) => attrObj(id, 'AirCabinAsked', 'STRING', '', `Cabin the agent asked for (${from} or ${to}). Default empty: a request that omits it matches no rule. Larkspur Air lab attribute, nothing else reads it.`)));
  const aAppr = add(finish('AttributeDefinition', 'AirApproval', (id) => attrObj(id, 'AirApproval', 'STRING', 'none', 'What the lab attests about a human approval: none, verified, claimed or denied. Set by the lab from its own approval service, never from the caller. Default none. Larkspur Air lab attribute, nothing else reads it.')));
  const A = { mark: aMark.id, fare: aFare.id, intl: aIntl.id, cabin: aCabin.id, appr: aAppr.id, tool: ref.ToolName, user: ref.UserId };

  // --- conditions ---
  const cmp = (attr, op, value) => ({ comparison: { left: { attribute: { id: attr } }, op, right: { constant: { value: String(value) } } } });
  const ref_ = (c) => ({ reference: { id: c.id } });
  const not_ = (c) => ({ not: { condition: { reference: { id: c.id } } } });
  const cond = (name, description, tree) => add(finish('ConditionDefinition', `${P}${name}`, (id) => condObj(id, `${P}${name}`, tree, description)));
  const toolTree = toolList.length === 1 ? cmp(A.tool, 'Equals', toolList[0]) : { or: { conditions: toolList.map((t) => cmp(A.tool, 'Equals', t)) } };
  // C1 is the gate: the marker, the booking tool, a known user, and a fare that resolved (its default is 0).
  const c1 = cond('Is A Booking Request', `The request carries the Larkspur Air marker (${MARKER}), ToolName is ${toolList.join(' or ')}, UserId is known (not none, not empty) and AirFare resolved (above 0). Any other request finds the Larkspur Air policy not applicable.`, { and: { conditions: [cmp(A.mark, 'Equals', MARKER), toolTree, cmp(A.user, 'NotEquals', 'none'), cmp(A.user, 'NotEquals', ''), cmp(A.fare, 'GreaterThan', 0)] } });
  const c3 = cond('Cabin Known', `AirCabinAsked is ${from} or ${to}.`, { or: { conditions: [cmp(A.cabin, 'Equals', from), cmp(A.cabin, 'Equals', to)] } });
  const c4 = cond('Request Complete', `The request is a booking request (C1), names a known cabin (C3) and carries a known AirApproval value (${APPROVALS.join(', ')}). An unknown approval value therefore matches no outcome at any fare: the catch-all answers alone, which the lab reads as no decision.`, { and: { conditions: [ref_(c1), ref_(c3), { or: { conditions: APPROVALS.map((a) => cmp(A.appr, 'Equals', a)) } }] } });
  const c5 = cond('Fare Over Hold', `AirFare is over ${usd(hold)} (FARE_RULE.hold). Strict: exactly ${usd(hold)} is not over.`, cmp(A.fare, 'GreaterThan', hold));
  const c6 = cond('Fare Over Limit', `AirFare is over ${usd(limit)} (FARE_RULE.limit). Strict: exactly ${usd(limit)} is not over.`, cmp(A.fare, 'GreaterThan', limit));
  const c7 = cond('Route International', 'AirIsInternational is true.', cmp(A.intl, 'Equals', 'true'));
  const c9 = cond('Business Asked', `AirCabinAsked is ${from} (FARE_RULE.from), the cabin the fare rule can narrow.`, cmp(A.cabin, 'Equals', from));
  const c10 = cond('Narrowable', `The cabin asked is ${from} and (the trip is international or the fare is over ${usd(limit)}).`, { and: { conditions: [cmp(A.cabin, 'Equals', from), { or: { conditions: [cmp(A.intl, 'Equals', 'true'), cmp(A.fare, 'GreaterThan', limit)] } }] } });
  const c11 = cond('Approval None', 'AirApproval is none.', cmp(A.appr, 'Equals', 'none'));
  const c12 = cond('Approval Verified', 'AirApproval is verified: the lab vouches for an approval receipt.', cmp(A.appr, 'Equals', 'verified'));
  const c13 = cond('Approval Claimed', 'AirApproval is claimed: the client says a person approved, with no verified receipt.', cmp(A.appr, 'Equals', 'claimed'));
  const c14 = cond('Approval Denied', 'AirApproval is denied: the person declined.', cmp(A.appr, 'Equals', 'denied'));

  // --- statements (advice: obligatory false; the lab reads the code; the narrowing is carried by the code, the payload is evidence only) ---
  const stmt = (name, description, code, appliesTo, payloadObj) => {
    const payload = JSON.stringify(payloadObj);
    const gate = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (GATE_WORDS.some((w) => gate.includes(w))) throw new Error(`statement code ${code} contains a word the gateway reads as a hold`);
    if (/\{\{|\}\}|\$\{/.test(payload)) throw new Error('a payload contains an interpolation sequence');
    return add(finish('Statement', `${PS}${name}`, (id) => stmtObj(id, `${PS}${name}`, description, code, appliesTo, payload)));
  };
  const narrow = (because) => ({ outcome: 'narrow', cabin: to, because, limit, hold });
  const s1 = stmt('Permit As Asked', 'Booking allowed as asked.', 'airline-permit-as-asked', 'PERMIT', { outcome: 'permit', cabin: 'as-asked' });
  const s2 = stmt('Economy Only International', `Booked, cabin narrowed ${from} to ${to}: the trip is international.`, 'airline-economy-intl', 'PERMIT', narrow(['international']));
  const s3 = stmt('Economy Only Over Limit', `Booked, cabin narrowed ${from} to ${to}: the fare is over the limit.`, 'airline-economy-over-limit', 'PERMIT', narrow(['over-limit']));
  const s4 = stmt('Economy Only Both Reasons', `Booked, cabin narrowed ${from} to ${to}: international and over the limit.`, 'airline-economy-intl-over-limit', 'PERMIT', narrow(['international', 'over-limit']));
  const s5 = stmt('Approval Required', 'The booking needs a person to approve it (over the second limit, no verified approval).', 'airline-approval-required', 'PERMIT', { outcome: 'approval-required', hold });
  const s6 = stmt('Approved As Asked', 'Over the second limit with a verified approval: booked as asked.', 'airline-approved-as-asked', 'PERMIT', { outcome: 'approved', cabin: 'as-asked' });
  const s7 = stmt('Second Factor Required', 'Over the second limit with an approval claimed but not verified: a second factor first.', 'airline-second-factor-required', 'PERMIT', { outcome: 'second-factor-required', hold });
  const s8 = stmt('Booking Refused', 'DENY: the person declined the approval.', 'airline-booking-refused', 'DENY', { outcome: 'refused', reason: 'approval-denied' });
  // The catch-all's statement. It comes back NEXT TO the specific outcome code on every permit that passes the policy's gate; a decision with only this code means no outcome matched.
  const s9 = stmt('Unmatched', `Catch-all permit: comes with every PERMIT that passes the Larkspur Air gate. Alone (no other specific airline- code) it means no outcome rule matched: the lab treats it as no decision, never as a permit.`, UNMATCHED_CODE, 'PERMIT', { outcome: 'unmatched' });

  // --- rules: disjoint by construction, so the combining algorithm returns exactly one outcome statement ---
  const rule = (name, description, conds, statement, effect = { type: 'unconditionalPermit' }) => {
    const condition = { and: { conditions: conds } };
    return add(finish('Rule', `${P}${name}`, (id) => ruleObj(id, `${P}${name}`, condition, effect.type === 'conditionalDenyElsePermit' ? { type: effect.type, condition } : effect, [statement.id], description)));
  };
  const r1 = rule('Permit As Asked', `Complete request, fare at or under ${usd(hold)}, and not narrowable: booked as asked.`, [ref_(c4), not_(c5), not_(c10)], s1);
  const r2 = rule('Economy Only International', `Cabin ${from}, international, fare at or under ${usd(limit)}: narrowed to ${to}.`, [ref_(c4), ref_(c7), not_(c6), ref_(c9)], s2);
  const r3 = rule('Economy Only Over Limit', `Cabin ${from}, domestic, fare over ${usd(limit)} and at or under ${usd(hold)}: narrowed to ${to}.`, [ref_(c4), not_(c7), ref_(c6), not_(c5), ref_(c9)], s3);
  const r4 = rule('Economy Only Both Reasons', `Cabin ${from}, international, fare over ${usd(limit)} and at or under ${usd(hold)}: narrowed to ${to}.`, [ref_(c4), ref_(c7), ref_(c6), not_(c5), ref_(c9)], s4);
  const r5 = rule('Approval Required', `Fare over ${usd(hold)} and no approval: a person approves.`, [ref_(c4), ref_(c5), ref_(c11)], s5);
  const r6 = rule('Approved As Asked', `Fare over ${usd(hold)} with a verified approval: booked as asked.`, [ref_(c4), ref_(c5), ref_(c12)], s6);
  const r7 = rule('Second Factor Required', `Fare over ${usd(hold)} and an approval claimed but not verified: second factor first.`, [ref_(c4), ref_(c5), ref_(c13)], s7);
  const r8 = rule('Booking Refused', `Fare over ${usd(hold)} and the person declined: refused.`, [ref_(c4), ref_(c5), ref_(c14)], s8, { type: 'conditionalDenyElsePermit' });

  // The catch-all the skill requires: exactly one rule whose condition is empty, an unconditional permit, listed LAST. It is not wrapped in an and (the skill's shape).
  const r9 = add(finish('Rule', CATCH_ALL_RULE, (id) => ruleObj(id, CATCH_ALL_RULE, { empty: {} }, { type: 'unconditionalPermit' }, [s9.id], `Catch-all permit (the P1AZ import skill requires one, listed last). Fires on every request that passes the Larkspur Air gate, so its statement ${UNMATCHED_CODE} comes next to the specific outcome code; alone it means no outcome rule matched (for example an unknown cabin or approval value).`)));

  // --- the policy: ONE child of the owner's existing root policy set, gated on the marker and the booking tool ---
  add(finish('Policy', POLICY_NAME, (id) => ({ id, version: null, targets: [], combiningAlgorithm: { algorithm: 'DenyOverrides' }, name: POLICY_NAME, description: `Authorizes the Larkspur Air booking tool: allowed as asked, constrained (cabin narrowed), held for a person, second factor, or refused; ends with one catch-all permit (the code ${UNMATCHED_CODE}, never an outcome by itself). ${NOTE} Applies only when the request carries the AirLabMarker marker and ToolName is the booking tool; every other request finds it not applicable.`, shared: false, disabled: false, children: [r1, r2, r3, r4, r5, r6, r7, r8, r9].map((r) => ({ id: r.id, type: 'Rule' })), condition: { and: { conditions: [ref_(c1)] } }, statements: [], repetitionSettings: null, type: 'Policy' })));
  for (const g of out) g.text = JSON.stringify(g.obj);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The one edit of an existing element: the root policy set gets our policy as a child and a new version. Both are string splices.
// The new version is the OLD version XOR a mask derived from our policy's version (the version nibble and the two variant marker bits are untouched; the rest of the variant digit can change, e.g. a to 9, both valid), so it is content-derived, always
// differs from the old one, and is reversible: the original version is recovered from our output, which makes "remove ours" return the original bytes.
const maskOf = (policyVersion) => { const h = crypto.createHash('sha256').update(`larkspur-air:root-version:${policyVersion}`).digest(); const b = Buffer.from(h.subarray(0, 16)); b[6] &= 0x0f; b[8] &= 0x3f; return b; };
export function xorVersion(version, policyVersion) {
  if (!UUID_RE.test(version)) throw new Error('the root policy set version is not a lowercase uuid; refusing to derive a new one');
  const a = Buffer.from(version.replace(/-/g, ''), 'hex'); const m = maskOf(policyVersion);
  const x = Buffer.from(a.map((v, i) => v ^ m[i])).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const childText = (policyId) => `{"id":${JSON.stringify(policyId)},"type":"Policy"}`;
// The text range of the `[...]` of the element's own top-level "children" array (first occurrence at depth 1).
function childrenRange(text) {
  let depth = 0; let inStr = false; let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { if (depth === 1 && text.startsWith('"children":[', i)) { const s = i + '"children":'.length; let d = 0; let st = false; let es = false; for (let j = s; j < text.length; j++) { const ch = text[j]; if (st) { if (es) es = false; else if (ch === '\\') es = true; else if (ch === '"') st = false; continue; } if (ch === '"') st = true; else if (ch === '[') d++; else if (ch === ']') { d--; if (d === 0) return { open: s, close: j }; } } throw new Error('unterminated children array'); } inStr = true; continue; }
    if (c === '[' || c === '{') depth++; else if (c === ']' || c === '}') depth--;
  }
  return null;
}
const VERSION_RE = /^(\{"id":"[^"]*","version":")([^"]*)(")/;
// Splice ours IN: returns the new root text. `origVersion` is the root's version before our edit.
export function spliceRoot(rootText, policyId, policyVersion, origVersion) {
  const r = childrenRange(rootText); if (!r) throw new Error('the root policy set has no children array');
  const inner = rootText.slice(r.open + 1, r.close); const child = childText(policyId);
  let text = rootText;
  if (!inner.split(',{').some((p, i) => (i ? `{${p}` : p) === child)) text = `${rootText.slice(0, r.close)}${inner.trim() === '' ? '' : ','}${child}${rootText.slice(r.close)}`;
  const m = VERSION_RE.exec(text); if (!m) throw new Error('the root policy set does not start {"id":..,"version":..; refusing to edit it');
  return `${m[1]}${xorVersion(origVersion, policyVersion)}${m[3]}${text.slice(m[0].length)}`;
}
// Splice ours OUT: returns { text, hadChild, version } where `version` is the original one restored (only when our child was there).
export function unspliceRoot(rootText, policyId, policyVersion) {
  const r = childrenRange(rootText); if (!r) throw new Error('the root policy set has no children array');
  const inner = rootText.slice(r.open + 1, r.close); const child = childText(policyId);
  const parts = inner === '' ? [] : inner.split(/,(?=\{)/);
  const hadChild = parts.includes(child);
  const m = VERSION_RE.exec(rootText); if (!m) throw new Error('the root policy set does not start {"id":..,"version":..; refusing to edit it');
  if (!hadChild) return { text: rootText, hadChild: false, version: m[2] };
  if (!policyVersion) throw new Error('the root policy set lists our policy as a child but our policy is not in the file; cannot recover its original version');
  const version = xorVersion(m[2], policyVersion);
  const kept = parts.filter((p) => p !== child).join(',');
  const text = `${rootText.slice(0, r.open + 1)}${kept}${rootText.slice(r.close)}`;
  return { text: `${m[1]}${version}${m[3]}${text.slice(m[0].length)}`, hadChild: true, version };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Fail-safe defaults (the P1AZ skill: an attribute a condition reads with no defaultValue makes the decision INDETERMINATE when the caller omits it).
// The ids of every attribute our conditions read (conditions, rule conditions, a rule's effect condition, the policy condition), read from `attribute` nodes.
export function attributeIdsRead(objs) {
  const ids = new Set();
  const walk = (n, key) => {
    if (Array.isArray(n)) { n.forEach((x) => walk(x, key)); return; }
    if (!n || typeof n !== 'object') return;
    if (key === 'attribute' && typeof n.id === 'string') ids.add(n.id);
    for (const [k, v] of Object.entries(n)) walk(v, k);
  };
  for (const o of objs) walk(o, '');
  return ids;
}
// Problems for every attribute read by `ourObjs` that has no defaultValue (null or absent; the empty string IS a default), whoever owns the attribute.
export function missingDefaults(els, ourObjs) {
  const attrs = new Map(els.filter((e) => e.obj?.objectType === 'AttributeDefinition').map((e) => [e.obj.id, e.obj]));
  const out = [];
  for (const id of attributeIdsRead(ourObjs.filter((o) => typeOf(o) !== 'AttributeDefinition'))) {
    const a = attrs.get(id);
    if (!a) out.push(`${id} (not in the file)`); else if (a.defaultValue === null || a.defaultValue === undefined) out.push(`${a.name}${isOurs(a) ? '' : ' (shared)'}`);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The overlay: a few shared objects taken from an update snapshot, nothing else. The allow-list is the whole authority: an object is taken only when its type,
// id AND name match in both files, and only the paths in `changes` (and the special lists below) may differ. No constant, audience or payload is written here.
// The one special path: a list of OR branches may gain exactly one branch (an Equals comparison of an attribute the existing branches already read); every
// existing branch must be there unchanged (the update may put the new one anywhere in the list).
function extraBranch(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return { problem: 'the branches are not lists' };
  if (b.length !== a.length + 1) return { problem: `${a.length} branches became ${b.length}; exactly one may be added` };
  const left = b.map(stable);
  for (const x of a) { const i = left.indexOf(stable(x)); if (i < 0) return { problem: 'an existing branch was changed or removed' }; left.splice(i, 1); }
  const extra = b.find((x) => stable(x) === left[0]); const c = extra?.comparison;
  if (!(extra && Object.keys(extra).length === 1 && c && c.op === 'Equals' && typeof c.left?.attribute?.id === 'string' && c.right?.constant && typeof c.right.constant === 'object')) return { problem: 'the added branch is not one Equals comparison of an attribute with a constant' };
  const read = new Set(a.map((x) => x?.comparison?.left?.attribute?.id).filter(Boolean));
  if (!read.has(c.left.attribute.id)) return { problem: 'the added branch reads an attribute that no existing comparison branch reads' };
  return { extra, attributeId: c.left.attribute.id, value: c.right.constant.value };
}
export const OVERLAY_ALLOW = [
  { type: 'ConditionDefinition', name: 'HasValidMcpAudience', changes: ['description'], special: { 'condition.or.conditions': (a, b) => { const r = extraBranch(a, b); return r.problem ? [r.problem] : []; } } },
  { type: 'Statement', name: 'MCP Denied — Invalid Audience', changes: ['payload'], special: {} },
];
// The paths where two parsed objects differ, ignoring the top-level `version` and key order. `special` maps a path to a function (a, b) => [reasons]
// that judges that path as a whole. Values are never put in the answer, only paths and fixed words.
export function semanticDiff(a, b, special = {}, p = '') {
  if (stable(a) === stable(b)) return [];
  if (Object.hasOwn(special, p)) { const why = special[p](a, b); return why.length ? why.map((w) => ({ path: p, why: w })) : [{ path: p, why: 'accepted', ok: true }]; }
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (isObj(a) && isObj(b)) {
    const out = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (p === '' && k === 'version') continue; out.push(...semanticDiff(a[k], b[k], special, p ? `${p}.${k}` : k)); }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.flatMap((x, i) => semanticDiff(x, b[i], special, `${p}[${i}]`));
  return [{ path: p, why: 'differs' }];
}
// A special path whose judge finds nothing wrong is reported once as { ok: true }: an accepted change. Equal values are never reported (the equality test comes first).
export const overlayRuleOf = (obj) => OVERLAY_ALLOW.find((r) => typeOf(obj) === r.type && nameOf(obj) === r.name);
const short = (s) => String(s).slice(0, 8);
function findOne(els, rule, where) {
  const hits = els.filter((e) => HAS_ID(e) && typeOf(e.obj) === rule.type && nameOf(e.obj) === rule.name);
  if (hits.length !== 1) throw new Error(`the overlay needs exactly one ${rule.type} named "${rule.name}" in ${where}; found ${hits.length}`);
  return hits[0];
}
// The overlay against the base's non-ours elements: returns Map(element -> new text) and one item per allow-listed object.
export function applyOverlay(rest, updateEls) {
  const map = new Map(); const items = [];
  for (const rule of OVERLAY_ALLOW) {
    const label = `${rule.type} "${rule.name}"`;
    const b = findOne(rest, rule, 'the base'); const u = findOne(updateEls, rule, 'the update');
    if (b.obj.id !== u.obj.id) throw new Error(`the overlay refuses: ${label} has the id ${short(u.obj.id)}... in the update and ${short(b.obj.id)}... in the base`);
    if (/[\r\n]/.test(u.text)) throw new Error(`the overlay refuses: the update's ${label} spans more than one line, it is not in the compact form`);
    const item = { type: rule.type, name: rule.name, id: b.obj.id, oldVersion: b.obj.version, newVersion: u.obj.version };
    if (b.text === u.text) { items.push({ ...item, status: 'already', paths: [] }); continue; }
    const diffs = semanticDiff(b.obj, u.obj, rule.special);
    const bad = diffs.filter((d) => !d.ok && !rule.changes.includes(d.path));
    if (bad.length) throw new Error(`the overlay refuses: the update's ${label} differs from the base in more than the expected content (unexpected: ${[...new Set(bad.map((d) => `${d.path || '(object)'}: ${d.why}`))].join('; ')})`);
    if (!diffs.length) { items.push({ ...item, status: 'already', paths: [] }); continue; }
    if (typeof u.obj.version !== 'string' || !u.obj.version || u.obj.version === b.obj.version) throw new Error(`the overlay refuses: the update's ${label} has the same version as the base's, so an import would skip it`);
    map.set(b, u.text); items.push({ ...item, status: 'applied', paths: [...new Set(diffs.map((d) => d.path))] });
  }
  return { map, items };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Building by splicing.
const REF_NAMES = { ToolName: 'STRING', Amount: 'NUMBER', UserId: 'STRING', ActClientId: 'STRING', HitlApproved: 'BOOLEAN' };
export function resolveRefs(els) {
  const ref = {};
  for (const [name, vt] of Object.entries(REF_NAMES)) {
    const hits = els.filter((e) => e.obj?.objectType === 'AttributeDefinition' && e.obj.name === name && !isOurs(e.obj));
    if (hits.length !== 1) throw new Error(`the base has ${hits.length} attributes named ${name}; exactly one is required (the lab reads it, never changes it)`);
    if (hits[0].obj.valueType !== vt) throw new Error(`the base attribute ${name} is ${hits[0].obj.valueType}, expected ${vt}`);
    ref[name] = hits[0].obj.id;
  }
  return ref;
}
// The root policy set: the one PolicySet that no other policy set lists as a child.
export function findRoot(rest) {
  const sets = rest.filter((e) => e.obj?.type === 'PolicySet');
  const childIds = new Set(rest.flatMap((e) => (e.obj?.type === 'PolicySet' ? (e.obj.children ?? []).map((c) => c.id) : [])));
  const roots = sets.filter((e) => !childIds.has(e.obj.id));
  if (roots.length !== 1) throw new Error(`expected exactly one root policy set in the base, found ${roots.length}; refusing to guess which one to extend`);
  return roots[0];
}

// Where each group goes, on the list with our elements already taken out. Order at one index: attributes, conditions, statements, rules, policy.
export function insertionPlan(rest, gen) {
  const idx = (pred, from = 0) => { for (let i = from; i < rest.length; i++) if (pred(rest[i])) return i; return -1; };
  const sep1 = idx((e) => e.obj?.type === 'SnapshotPackageFile$PackageSeparator');
  if (sep1 < 0) throw new Error('no PackageSeparator');
  let end = idx((e) => e.obj?.type === 'SnapshotPackageFile$PackageSeparator', sep1 + 1);
  if (end < 0) end = idx((e) => e.obj?.type === 'SnapshotPackageFile$EndOfPackage', sep1 + 1);
  if (end < 0) throw new Error('no second PackageSeparator or EndOfPackage');
  const typeAt = (t) => idx((e) => e.obj?.type === t, sep1 + 1);
  const firstRule = typeAt('Rule'); const firstPolicy = typeAt('Policy'); const firstSet = typeAt('PolicySet');
  const pick = (...c) => c.find((i) => i >= 0 && i <= end) ?? end;
  const at = { AttributeDefinition: sep1, ConditionDefinition: sep1, Statement: pick(firstRule, firstPolicy, firstSet), Rule: pick(firstPolicy, firstSet), Policy: pick(firstSet) };
  const order = ['AttributeDefinition', 'ConditionDefinition', 'Statement', 'Rule', 'Policy'];
  const groups = order.map((t) => ({ t, idx: at[t], items: gen.filter((g) => g.type === t) })).filter((g) => g.items.length);
  groups.sort((a, b) => a.idx - b.idx || order.indexOf(a.t) - order.indexOf(b.t));
  return groups;
}

export function build({ baseText, fare, tools, updateText = null }) {
  const els = splitElements(baseText);
  const comp = completeness(els);
  if (comp.problems.length) throw new Error(`the base snapshot is not complete or not version 2:\n  - ${comp.problems.slice(0, 12).join('\n  - ')}`);
  const oursIn = els.filter((e) => isOurs(e.obj));
  const rest = els.filter((e) => !isOurs(e.obj));
  const gen = generate({ fare, tools, ref: resolveRefs(rest) });
  const noDefault = missingDefaults([...rest, ...gen], gen.map((g) => g.obj));
  if (noDefault.length) throw new Error(`these attributes are read by our conditions but have no defaultValue (an omitted attribute would make the decision INDETERMINATE): ${noDefault.join(', ')}`);
  const genIds = new Set(gen.map((g) => g.id));
  const genNames = new Set(gen.map((g) => `${g.type}:${g.name}`));
  const typeKey = (o) => (typeOf(o) === 'ATTRIBUTE' ? 'AttributeDefinition' : typeOf(o));
  for (const e of rest) {
    if (HAS_ID(e) && (genIds.has(e.obj.id) || genNames.has(`${typeKey(e.obj)}:${nameOf(e.obj)}`))) throw new Error(`a non-ours ${typeOf(e.obj)} "${nameOf(e.obj)}" (${e.obj.id}) collides with one of our names or ids; refusing`);
  }
  const policy = gen.find((g) => g.type === 'Policy');
  const rootEl = findRoot(rest);
  // The policy version recorded in the INPUT (to undo the previous edit of the root), if our policy was there.
  const oldPolicy = oursIn.find((e) => e.obj.type === 'Policy');
  const un = unspliceRoot(rootEl.text, policy.id, oldPolicy?.obj.version);
  const newRootText = spliceRoot(un.text, policy.id, policy.obj.version, un.version);
  const ov = updateText === null ? { map: new Map(), items: [] } : applyOverlay(rest, splitElements(updateText, { loose: true }));
  const plan = insertionPlan(rest, gen);
  const parts = []; let i = 0;
  const emit = (e) => (e === rootEl ? newRootText : (ov.map.get(e) ?? e.text));
  for (const g of plan) { while (i < g.idx) parts.push(emit(rest[i++])); for (const x of g.items) parts.push(x.text); }
  while (i < rest.length) parts.push(emit(rest[i++]));
  const text = joinElements(parts);
  const before = new Map(oursIn.map((e) => [e.obj.id, e.text]));
  let added = 0; let updated = 0; let unchanged = 0;
  for (const g of gen) { if (!before.has(g.id)) added++; else if (before.get(g.id) !== g.text) updated++; else unchanged++; }
  const removed = [...before.keys()].filter((id) => !genIds.has(id)).length;
  const rootChanged = newRootText !== rootEl.text;
  return { text, gen, rootName: nameOf(rootEl.obj), overlay: ov.items, summary: { added, updated, unchanged, removed, rootChanged, rootChildAlreadyThere: un.hadChild } };
}

// Take every object of ours out and restore the root exactly: the original bytes come back.
// The overlay is undone only when `original` (the owner's original export) is given: the allow-listed objects then take the text they have there. Without it
// they stay as the file has them (the base as the build saw it; an overlay build's base is the original, which is not stored in the file).
export function stripOurs(text, { original = null } = {}) {
  const els = splitElements(text);
  const ours = els.filter((e) => isOurs(e.obj)); const rest = els.filter((e) => !isOurs(e.obj));
  const pol = ours.find((e) => e.obj.type === 'Policy');
  const root = findRoot(rest);
  const un = unspliceRoot(root.text, pol ? pol.obj.id : detId('Policy', POLICY_NAME), pol?.obj.version);
  const origRest = original === null ? null : splitElements(original).filter((e) => !isOurs(e.obj));
  const restore = (e) => {
    const rule = origRest && HAS_ID(e) ? overlayRuleOf(e.obj) : null; if (!rule) return e.text;
    const o = findOne(origRest, rule, 'the original');
    if (o.obj.id !== e.obj.id) throw new Error(`the original's ${rule.type} "${rule.name}" has another id than the file's; this file was not built from that original`);
    return o.text;
  };
  return joinElements(rest.map((e) => (e === root ? un.text : restore(e))));
}
export function summaryLine(s, rootName, overlay = []) {
  const ovr = overlay.filter((x) => x.status === 'applied');
  const ovLine = overlay.length ? `; overlay: ${ovr.length ? `taken from the update: ${ovr.map((x) => `"${x.name}"`).join(', ')}` : 'nothing to take, the base already carries the update\'s objects'}` : '';
  const root = s.rootChanged ? (s.rootChildAlreadyThere ? `${ovr.length ? `${1 + ovr.length} shared objects changed: the root PolicySet "${rootName}" and the overlay` : 'exactly 1 non-ours changed: the root PolicySet "' + rootName + '"'} (our child was already there, version recomputed)` : `${ovr.length ? `${1 + ovr.length} shared objects changed: the root PolicySet "${rootName}" and the overlay` : 'exactly 1 non-ours changed: the root PolicySet "' + rootName + '"'} (one child appended, version changed)`) : 'no non-ours element changed (the root PolicySet already had our child and the same version)';
  return `${s.added} added, ${s.updated} updated, ${s.removed} removed (all ours), ${s.unchanged} of ours unchanged; ${root}${ovLine}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The evaluator: a small PDP over the snapshot's own objects. Three-valued logic (true, false, null = indeterminate). Written for this check only; it is
// not PingOne. It proves what the FILE says, not how the console reads it.
export function makeEngine(els) {
  const by = { attr: new Map(), attrName: new Map(), cond: new Map(), rule: new Map(), stmt: new Map(), pol: new Map(), set: new Map() };
  for (const e of els) {
    const o = e.obj; if (!o) continue;
    if (o.objectType === 'AttributeDefinition') { by.attr.set(o.id, o); by.attrName.set(o.name, o); } else if (o.objectType === 'ConditionDefinition') by.cond.set(o.id, o);
    else if (o.type === 'Rule') by.rule.set(o.id, o); else if (o.type === 'Statement') by.stmt.set(o.id, o); else if (o.type === 'Policy') by.pol.set(o.id, o); else if (o.type === 'PolicySet') by.set.set(o.id, o);
  }
  const value = (attrId, req) => {
    const a = by.attr.get(attrId); if (!a) throw new Error(`unknown attribute ${attrId}`);
    const raw = Object.hasOwn(req, a.name) ? req[a.name] : a.defaultValue;
    return raw === null || raw === undefined ? null : { v: raw, num: a.valueType === 'NUMBER' };
  };
  const operand = (n, req) => (n.attribute ? value(n.attribute.id, req) : { v: n.constant.value, num: false });
  const evalCond = (c, req, seen = []) => {
    if (c.empty) return true;
    if (c.and) { let nul = false; for (const x of c.and.conditions) { const r = evalCond(x, req, seen); if (r === false) return false; if (r === null) nul = true; } return nul ? null : true; }
    if (c.or) { let nul = false; for (const x of c.or.conditions) { const r = evalCond(x, req, seen); if (r === true) return true; if (r === null) nul = true; } return nul ? null : false; }
    if (c.not) { const r = evalCond(c.not.condition, req, seen); return r === null ? null : !r; }
    if (c.reference) { const id = c.reference.id; if (seen.includes(id)) throw new Error('condition cycle'); const d = by.cond.get(id); if (!d) throw new Error(`unknown condition ${id}`); return evalCond(d.condition, req, [...seen, id]); }
    if (c.comparison) {
      const l = operand(c.comparison.left, req); const r = operand(c.comparison.right, req); if (!l || !r) return null;
      const numeric = l.num || r.num; const a = numeric ? Number(l.v) : String(l.v); const b = numeric ? Number(r.v) : String(r.v);
      if (numeric && (Number.isNaN(a) || Number.isNaN(b))) return null;
      if (c.comparison.op === 'Equals') return a === b; if (c.comparison.op === 'NotEquals') return a !== b; if (c.comparison.op === 'GreaterThan') return a > b;
      throw new Error(`unsupported op ${c.comparison.op}`);
    }
    throw new Error(`unsupported condition node ${Object.keys(c)[0]}`);
  };
  const combine = (rs) => (rs.some((r) => r.d === 'DENY') ? 'DENY' : rs.some((r) => r.d === 'INDETERMINATE') ? 'INDETERMINATE' : rs.some((r) => r.d === 'PERMIT') ? 'PERMIT' : 'NOT_APPLICABLE');
  const evalRule = (r, req) => {
    const c = evalCond(r.condition, req); if (c === false) return { d: 'NOT_APPLICABLE', stmts: [] }; if (c === null) return { d: 'INDETERMINATE', stmts: [] };
    let d = 'PERMIT';
    if (r.effectSettings.type === 'conditionalDenyElsePermit') { const e = evalCond(r.effectSettings.condition, req); d = e === null ? 'INDETERMINATE' : e ? 'DENY' : 'PERMIT'; }
    return { d, stmts: r.statements.map((id) => by.stmt.get(id)).filter((s) => s && s.appliesTo === d), fired: [r.name] };
  };
  const evalNode = (n, req) => {
    const c = evalCond(n.condition, req); if (c === false) return { d: 'NOT_APPLICABLE', stmts: [], fired: [] }; if (c === null) return { d: 'INDETERMINATE', stmts: [], fired: [] };
    const kids = n.children.map((k) => (k.type === 'Rule' ? evalRule(by.rule.get(k.id), req) : evalNode(k.type === 'Policy' ? by.pol.get(k.id) : by.set.get(k.id), req)));
    const d = combine(kids);
    return { d, stmts: [...n.statements.map((id) => by.stmt.get(id)).filter((s) => s && s.appliesTo === d), ...kids.filter((k) => k.d === d).flatMap((k) => k.stmts)], fired: kids.filter((k) => k.d === d).flatMap((k) => k.fired ?? []) };
  };
  const answer = (r) => ({ decision: r.d, codes: [...new Set(r.stmts.map((x) => x.code))].sort(), payloads: r.stmts.map((x) => x.payload), fired: r.fired ?? [] });
  const evaluate = (setName, req) => { const s = [...by.set.values()].find((x) => x.name === setName); if (!s) throw new Error(`no policy set ${setName}`); return answer(evalNode(s, req)); };
  const evaluatePolicy = (name, req) => { const p = [...by.pol.values()].find((x) => x.name === name); if (!p) throw new Error(`no policy ${name}`); return answer(evalNode(p, req)); };
  return { evaluate, evaluatePolicy, by, evalCond };
}

// What the policy must answer, written independently of the generator from FARE_RULE alone (the second reading). null = no rule may fire.
export function expectedCode({ fare, intl, cabin, approval }, rule) {
  const { limit, hold, from, to } = rule;
  if (!(Number.isFinite(fare) && fare > 0) || (cabin !== from && cabin !== to) || !APPROVALS.includes(approval ?? 'none')) return null;
  if (fare > hold) return { none: 'airline-approval-required', verified: 'airline-approved-as-asked', claimed: 'airline-second-factor-required', denied: 'airline-booking-refused' }[approval] ?? null;
  const over = fare > limit;
  if (cabin === from && (intl || over)) return intl && over ? 'airline-economy-intl-over-limit' : intl ? 'airline-economy-intl' : 'airline-economy-over-limit';
  return 'airline-permit-as-asked';
}

// The request the lab sends (names are the attribute names; the lab sends every value as text, the file's convention).
const labRequest = (o, tool) => ({ ToolName: tool, UserId: 'user-1', ActClientId: 'agent-1', AirLabMarker: MARKER, AirFare: String(o.fare), AirIsInternational: String(Boolean(o.intl)), AirCabinAsked: o.cabin, AirApproval: o.approval ?? 'none', ...(o.extra ?? {}) });

// The gate of our policy as FARE_RULE and the lab's request read it: the marker, tool and user are right in the grid, so the fare decides (the default is 0).
const gateOpen = ({ fare }) => Number.isFinite(fare) && fare > 0;
// The grid proof: our policy alone, over fares x route x cabin x approval. Exactly one specific outcome rule or none, plus the catch-all.
// Gate closed: NOT_APPLICABLE, no code. Gate open: a PERMIT carries the specific code (if any) AND airline-unmatched; the DENY carries only its own code.
export function gridProof(outEls, rule, tool) {
  const eng = makeEngine(outEls); let n = 0; const bad = [];
  const { limit, hold } = rule;
  const fares = [...new Set([-5, 0, 1, 99, 999, 1000, limit - 1, limit, limit + 1, hold - 1, hold, hold + 1, hold * 10, hold * 100])];
  for (const fare of fares) for (const intl of [false, true]) for (const cabin of [rule.from, rule.to, 'first', '']) for (const approval of ['none', 'verified', 'claimed', 'denied', 'maybe']) {
    const req = labRequest({ fare, intl, cabin, approval }, tool); n++;
    const r = eng.evaluatePolicy(POLICY_NAME, req); const want = expectedCode({ fare, intl, cabin, approval }, rule);
    const got = r.codes; const specific = specificCodes(got); const firedSpecific = r.fired.filter((n) => n !== CATCH_ALL_RULE);
    const open = gateOpen({ fare });
    const wantDecision = !open ? 'NOT_APPLICABLE' : want === 'airline-booking-refused' ? 'DENY' : 'PERMIT';
    const wantCodes = !open ? [] : want === 'airline-booking-refused' ? [want] : [...(want ? [want] : []), UNMATCHED_CODE].sort();
    const wantFired = !open ? 0 : want ? 1 : 0;
    if (r.decision !== wantDecision || JSON.stringify(got) !== JSON.stringify(wantCodes) || firedSpecific.length !== wantFired || specific.length !== (want ? 1 : 0)) bad.push(`fare ${fare} intl ${intl} cabin "${cabin}" approval ${approval}: got ${r.decision} [${got.join(',')}] fired ${firedSpecific.length}, want ${wantDecision} [${wantCodes.join(',')}] fired ${wantFired}`);
  }
  // Requests that must match nothing of ours (not even the catch-all): no marker, a foreign marker, a foreign tool, no user, the fare absent, the fare unparsable.
  const mustBeSilent = [
    ['no marker', { extra: { AirLabMarker: '' } }], ['foreign marker', { extra: { AirLabMarker: 'other' } }], ['foreign tool', { tool: 'transfer_funds' }],
    ['user none', { extra: { UserId: 'none' } }], ['user empty', { extra: { UserId: '' } }], ['fare omitted', { drop: 'AirFare' }], ['fare unparsable', { extra: { AirFare: 'abc' } }],
  ];
  for (const [label, o] of mustBeSilent) {
    const req = labRequest({ fare: 380, intl: false, cabin: rule.from, extra: o.extra }, o.tool ?? tool); if (o.drop) delete req[o.drop]; n++;
    const r = eng.evaluatePolicy(POLICY_NAME, req);
    if (r.codes.length !== 0 || r.decision === 'PERMIT' || r.decision === 'DENY') bad.push(`${label}: got ${r.decision} [${r.codes.join(',')}]`);
  }
  // Requests that pass the gate but match no outcome: the catch-all permit answers ALONE (the lab reads it as no decision, never a permit).
  for (const [label, o] of [['cabin omitted', { drop: 'AirCabinAsked' }], ['cabin unknown', { extra: { AirCabinAsked: 'first' } }], ['approval unknown over the hold', { extra: { AirApproval: 'maybe' }, fare: hold + 1 }], ['approval unknown at the fare 380', { extra: { AirApproval: 'maybe' } }], ['approval empty', { extra: { AirApproval: '' } }], ['approval wrong case', { extra: { AirApproval: 'Verified' } }]]) {
    const req = labRequest({ fare: o.fare ?? 380, intl: false, cabin: rule.from, extra: o.extra }, tool); if (o.drop) delete req[o.drop]; n++;
    const r = eng.evaluatePolicy(POLICY_NAME, req);
    if (r.decision !== 'PERMIT' || r.codes.length !== 1 || r.codes[0] !== UNMATCHED_CODE) bad.push(`${label}: got ${r.decision} [${r.codes.join(',')}], want PERMIT [${UNMATCHED_CODE}] alone`);
  }
  return { n, bad };
}

// Map a code to what the lab does (the doc's table).
export const CODE_TABLE = [
  ['airline-permit-as-asked', 'allowed as asked', 'books the cabin asked'],
  ['airline-economy-intl', 'constrained: international', 'books economy, tells the traveller (cabin business to economy)'],
  ['airline-economy-over-limit', 'constrained: over the limit', 'books economy, tells the traveller'],
  ['airline-economy-intl-over-limit', 'constrained: international and over the limit', 'books economy, tells the traveller'],
  ['airline-approval-required', 'hold for a person', 'refuses the call with 428 approval_required and a challenge'],
  ['airline-approved-as-asked', 'approved (a person approved)', 'books as asked, then spends the receipt'],
  ['airline-second-factor-required', 'second factor first', 'refuses with 428 step_up_required'],
  ['airline-booking-refused', 'refused (DENY)', 'refuses with 403 access_denied'],
];
// The catch-all code is NOT an outcome. It comes next to the specific code on every permit that passes the gate; the lab decides only from CODE_TABLE's codes.
export const CATCH_ALL_ROW = [UNMATCHED_CODE, 'no outcome (catch-all)', 'ignored next to a specific code; alone it means no decision, never a permit'];

// README flights table: | LK 109 | ORD to DEN | $150 | no | ...
export function readmeFlights(readmeText) {
  const rows = [];
  for (const m of readmeText.matchAll(/^\|\s*(LK \d+)\s*\|\s*([^|]+?)\s*\|\s*\$([\d,]+)\s*\|\s*(yes|no)\s*\|/gm)) rows.push({ flight: m[1], route: m[2], fare: Number(m[3].replace(/,/g, '')), international: m[4] === 'yes' });
  return rows;
}

// Corpus for the "no behaviour change" proof: requests the OTHER demos send (no marker), crossed with every constant the existing conditions read, plus
// requests that carry some of our Air attributes but never the marker.
export function existingCorpus(baseEls, tool, fare) {
  const eng = makeEngine(baseEls);
  const constants = (attrName) => {
    const a = eng.by.attrName.get(attrName); const out = new Set(); if (!a) return [];
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { if (n.comparison && n.comparison.left?.attribute?.id === a.id && n.comparison.right?.constant) out.add(n.comparison.right.constant.value); Object.values(n).forEach(walk); } };
    for (const c of eng.by.cond.values()) walk(c.condition);
    return [...out];
  };
  const tools = [...new Set([...constants('ToolName'), tool, 'no_such_tool'])].sort();
  const amounts = [...new Set([0, 1, 100, 199, 250, 251, 501, 750, 751, 2001, 2400, fare.limit, fare.limit + 1, fare.hold, fare.hold + 1])];
  const acts = [...new Set(['none', ...constants('ActClientId')])].slice(0, 3);
  const ctxs = [...new Set(['none', ...constants('DecisionContext')])].slice(0, 3);
  const txs = [...new Set(['none', ...constants('TransactionType')])].slice(0, 3);
  const reqs = [];
  for (const ToolName of tools) for (const Amount of amounts) for (const UserId of ['none', 'user-1']) for (const ActClientId of acts) for (const HitlApproved of [false, true]) for (const DecisionContext of ctxs) for (const TransactionType of txs) reqs.push({ ToolName, Amount, UserId, ActClientId, HitlApproved, DecisionContext, TransactionType });
  const air = [];
  for (const marker of [undefined, '', 'other']) for (const AirFare of ['380', String(fare.hold + 1), '-1']) for (const AirIsInternational of ['true', 'false']) for (const AirCabinAsked of [fare.from, fare.to]) for (const AirApproval of ['none', 'verified']) for (const ToolName of [tool, 'transfer_funds']) for (const Amount of [0, fare.hold + 1]) {
    const r = { ToolName, Amount, UserId: 'user-1', ActClientId: 'agent-1', AirFare, AirIsInternational, AirCabinAsked, AirApproval };
    if (marker !== undefined) r.AirLabMarker = marker; air.push(r);
  }
  return [...reqs, ...air];
}
export function compareExisting(baseEls, outEls, tool, fare) {
  const a = makeEngine(baseEls); const b = makeEngine(outEls);
  const sets = [...a.by.set.values()].filter((s) => !isOurs(s)).map((s) => s.name);
  const reqs = existingCorpus(baseEls, tool, fare);
  let diff = 0; const tally = {};
  for (const set of sets) for (const r of reqs) {
    const x = a.evaluate(set, r); const y = b.evaluate(set, r);
    if (JSON.stringify(x) !== JSON.stringify(y)) diff++;
    tally[x.decision] = (tally[x.decision] ?? 0) + 1;
  }
  // With the marker on: our policy may ADD a statement or turn "no answer" into a permit, but it can never turn a base DENY into anything else.
  let weakened = 0; let withMarker = 0; let added = 0;
  for (const r of reqs.filter((q) => q.ToolName === tool).slice(0, 4000)) {
    const q = { ...r, AirLabMarker: MARKER, AirFare: '380', AirIsInternational: 'false', AirCabinAsked: fare.from, AirApproval: 'none' };
    for (const set of sets) { const x = a.evaluate(set, q); const y = b.evaluate(set, q); withMarker++; if (x.decision === 'DENY' && y.decision !== 'DENY') weakened++; if (JSON.stringify(x) !== JSON.stringify(y)) added++; }
  }
  return { sets, requests: reqs.length, evaluations: reqs.length * sets.length, diff, tally, withMarker, weakened, changedWithMarker: added };
}

// The lab table: every README flight through the root set (what the endpoint will evaluate), against the lab's own decide().
export function larkspurTable(outEls, { fare, readme, decide, tool, rootName }) {
  const eng = makeEngine(outEls);
  const flights = readmeFlights(readme);
  if (!flights.length) throw new Error('no flights read from the README table');
  const rows = []; let bad = 0;
  for (const f of flights) for (const cabin of [fare.from, fare.to]) for (const approval of ['none', 'claimed', 'verified']) {
    if (approval === 'claimed' && f.fare <= fare.hold) continue;
    const req = labRequest({ fare: f.fare, intl: f.international, cabin, approval }, tool);
    const r = eng.evaluatePolicy(POLICY_NAME, req); const spec = specificCodes(r.codes); const code = spec.length === 1 ? spec[0] : '(none)';
    const root = eng.evaluate(rootName, req);
    const want = expectedCode({ fare: f.fare, intl: f.international, cabin, approval }, fare);
    // The lab's own rule: it has no verified-approval case in decide(); over the hold a verified approval books as asked.
    const d = decide({ fareRule: true, role: 'write', tool, amount: f.fare, international: f.international, cabin, forgedApproval: approval === 'claimed' });
    const labWord = approval === 'verified' && f.fare > fare.hold ? 'PERMIT' : d.decision;
    const codeWord = { 'airline-permit-as-asked': 'PERMIT', 'airline-approved-as-asked': 'PERMIT', 'airline-economy-intl': 'CONSTRAINED', 'airline-economy-over-limit': 'CONSTRAINED', 'airline-economy-intl-over-limit': 'CONSTRAINED', 'airline-approval-required': 'HITL_REQUIRED', 'airline-second-factor-required': 'STEP_UP', 'airline-booking-refused': 'DENY' }[code];
    const ok = code === want && codeWord === labWord && spec.length === 1 && r.codes.includes(UNMATCHED_CODE) === (code !== 'airline-booking-refused');
    if (!ok) bad++;
    rows.push({ label: f.flight, fare: f.fare, intl: f.international, cabin, approval, code, lab: labWord, rootDecision: root.decision, rootExtra: root.codes.filter((c) => !c.startsWith('airline-')).length, catchAll: r.codes.includes(UNMATCHED_CODE), ok });
  }
  return { rows, bad };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Verification of a built file (used right after writing, and by --check).
export function verifyBuilt({ outText, inText = null, fare, tools, updateText = null }) {
  const lines = []; let fail = 0;
  const ok = (cond, msg) => { lines.push(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };
  const outEls = splitElements(outText);
  const comp = completeness(outEls);
  ok(comp.problems.length === 0, `the output is a complete v2 snapshot, every one of ${comp.refCount} references resolves inside it${comp.problems.length ? `: ${comp.problems.slice(0, 5).join('; ')}` : ''}`);
  const ours = outEls.filter((e) => isOurs(e.obj)); const rest = outEls.filter((e) => !isOurs(e.obj));
  const pol = ours.find((e) => e.obj.type === 'Policy');
  ok(Boolean(pol), 'our policy is in the file');
  const root = findRoot(rest);
  if (inText !== null) {
    const inEls = splitElements(inText);
    const inRest = inEls.filter((e) => !isOurs(e.obj));
    const inRoot = findRoot(inRest);
    ok(inRest.length === rest.length, `the same number of non-ours elements in and out (${rest.length})`);
    const differing = rest.map((e, i) => i).filter((i) => rest[i].text !== inRest[i].text);
    const overlayDiff = differing.filter((i) => rest[i] !== root);
    if (updateText === null) ok(overlayDiff.length === 0 && differing.length <= 1, `every non-ours element is byte for byte the input's, except at most the root policy set (${differing.length} differ)`);
    else ok(overlayDiff.every((i) => overlayRuleOf(rest[i].obj) && inRest[i].obj.id === rest[i].obj.id), `every non-ours element is byte for byte the input's, except the root policy set and the allow-listed overlay objects (${overlayDiff.map((i) => `"${nameOf(rest[i].obj)}"`).join(', ') || 'none changed'}; ${differing.length} differ in all)`);
    if (updateText !== null) {
      const updEls = splitElements(updateText, { loose: true });
      for (const rule of OVERLAY_ALLOW) {
        const label = `${rule.type} "${rule.name}"`; let o; let u; let inO;
        try { o = findOne(rest, rule, 'the output'); u = findOne(updEls, rule, 'the update'); inO = findOne(inRest, rule, 'the input'); } catch (err) { ok(false, `overlay ${label}: ${err.message}`); continue; }
        ok(o.text === u.text && o.obj.id === u.obj.id, `overlay ${label}: the output carries the update's element, character for character (id ${short(o.obj.id)}..., version ${short(inO.obj.version)}... -> ${short(o.obj.version)}...)`);
        const d = inO.text === o.text ? [] : semanticDiff(inO.obj, o.obj, rule.special);
        ok(d.every((x) => x.ok || rule.changes.includes(x.path)) && (d.length === 0 ? inO.text === o.text : inO.obj.version !== o.obj.version), `overlay ${label}: against the input only ${d.length ? `${[...new Set(d.map((x) => x.path))].join(', ')} changed and the version is new` : 'nothing changed (the input already carried it)'}, nothing else`);
        if (rule.type === 'ConditionDefinition' && d.some((x) => x.path === 'condition.or.conditions')) {
          const r = extraBranch(inO.obj.condition.or.conditions, o.obj.condition.or.conditions);
          if (r.problem) ok(false, `overlay ${label}: ${r.problem}`);
          else { const attr = outEls.find((e) => e.obj?.id === r.attributeId)?.obj?.name; const req = { [attr]: r.value }; const was = makeEngine(inEls).evalCond(inO.obj.condition, req); const now = makeEngine(outEls).evalCond(o.obj.condition, req);
            ok(now === true && was !== true, `overlay ${label}: the audience it adds (value not printed) makes the condition true in the output and not in the input (${now}, was ${was}); ${o.obj.condition.or.conditions.length} branches, was ${inO.obj.condition.or.conditions.length}`); }
        }
      }
    }
    const inPol = inEls.find((e) => isOurs(e.obj) && e.obj.type === 'Policy');
    let rootOk = false;
    try { const a = unspliceRoot(root.text, pol.obj.id, pol.obj.version); const b = unspliceRoot(inRoot.text, pol.obj.id, inPol?.obj.version); rootOk = a.hadChild && a.text === b.text; } catch { rootOk = false; }
    ok(rootOk, 'the root policy set differs from the input by exactly one appended child (our policy) and its version, nothing else');
    const so = updateText === null ? { } : { original: inText };
    ok(stripOurs(outText, so) === stripOurs(inText), `removing ours${updateText === null ? '' : ' (and restoring the overlay objects from the input)'} from the output and removing ours from the input give the same bytes`);
    if (!inEls.some((e) => isOurs(e.obj))) ok(stripOurs(outText, so) === inText, `the input had none of ours, and removing ours${updateText === null ? '' : ' (with the input as --base-original)'} from the output gives the input back byte for byte (the original is recoverable)`);
  } else {
    const un = pol ? unspliceRoot(root.text, pol.obj.id, pol.obj.version) : { hadChild: false };
    ok(un.hadChild, 'the root policy set lists our policy as a child');
    if (updateText !== null) for (const rule of OVERLAY_ALLOW) {
      try { const o = findOne(rest, rule, 'the output'); const u = findOne(splitElements(updateText, { loose: true }), rule, 'the update'); ok(o.text === u.text, `overlay ${rule.type} "${rule.name}": the file carries the update's element, character for character (without --base nothing more can be proven)`); } catch (err) { ok(false, `overlay ${rule.type} "${rule.name}": ${err.message}`); }
    }
  }
  const names = new Map(); let dupName = 0; const idSeen = new Set(); let dupId = 0;
  for (const e of outEls.filter(HAS_ID)) { const k = `${typeOf(e.obj)}:${nameOf(e.obj)}`; if (names.has(k)) dupName++; names.set(k, 1); if (idSeen.has(e.obj.id)) dupId++; idSeen.add(e.obj.id); }
  ok(dupId === 0 && dupName === 0, `no duplicate ids (${dupId}) or names (${dupName})`);
  const longest = Math.max(...ours.map((e) => nameOf(e.obj).length));
  ok(longest <= MAX_NAME, `our longest name is ${longest} characters (the owner's file's longest is ${MAX_NAME})`);
  const ourNames = ours.map((e) => nameOf(e.obj)); const allNames = new Set(outEls.filter((e) => HAS_ID(e) && !isOurs(e.obj)).map((e) => nameOf(e.obj)));
  ok(new Set(ourNames).size === ourNames.length && ourNames.every((n) => !allNames.has(n)), 'none of our names is used twice, by us or by an object of yours, whatever the type');
  const oursIds = new Set(ours.map((e) => e.obj.id));
  let leaks = 0; for (const e of rest.filter(HAS_ID)) { if (e === root) continue; for (const r of refsOf(e.obj)) if (oursIds.has(r)) leaks++; }
  ok(leaks === 0, `no existing object references anything of ours, except the root policy set (${leaks})`);
  const rootRefs = [...refsOf(root.obj)].filter((r) => oursIds.has(r));
  ok(rootRefs.length === 1 && rootRefs[0] === pol?.obj.id, 'the root policy set references exactly one object of ours: our policy');
  const polSets = outEls.filter((e) => e.obj?.type === 'PolicySet'); const isNewSet = polSets.filter((e) => oursIds.has(e.obj.id)).length;
  ok(isNewSet === 0 && ours.every((e) => typeOf(e.obj) !== 'PolicySet'), 'no new policy set (no second root)');
  let ourRefsOk = true; const allIds = new Set(outEls.filter(HAS_ID).map((e) => e.obj.id)); for (const e of ours) for (const r of refsOf(e.obj)) if (!allIds.has(r)) ourRefsOk = false;
  ok(ourRefsOk, 'every id referenced by our objects exists in the file');
  const existingRefd = new Set(); for (const e of ours) for (const r of refsOf(e.obj)) if (!oursIds.has(r)) existingRefd.add(r);
  const refNames = [...existingRefd].map((id) => nameOf(outEls.find((e) => e.obj?.id === id)?.obj)).sort();
  ok(refNames.every((n) => n in REF_NAMES), `our objects use only these existing objects, read only: ${refNames.join(', ')}`);
  // The skill's rules, enforced on the file itself: fail-safe defaults on every attribute our conditions read (ours and shared), one catch-all permit listed last.
  const noDef = missingDefaults(outEls, ours.map((e) => e.obj));
  ok(noDef.length === 0, `every attribute our conditions read has a fail-safe defaultValue (ours and shared)${noDef.length ? `; MISSING: ${noDef.join(', ')}` : ''}`);
  const ourRules = new Map(ours.filter((e) => e.obj.type === 'Rule').map((e) => [e.obj.id, e.obj]));
  const catchAlls = [...ourRules.values()].filter((r) => JSON.stringify(r.condition) === '{"empty":{}}');
  const lastChild = pol ? pol.obj.children[pol.obj.children.length - 1] : null;
  const ca = catchAlls[0]; const caStmt = ca ? ours.map((e) => e.obj).find((o) => o.id === ca.statements[0]) : null;
  ok(catchAlls.length === 1 && ca.name === CATCH_ALL_RULE && ca.effectSettings.type === 'unconditionalPermit' && lastChild?.id === ca.id && ca.statements.length === 1 && caStmt?.appliesTo === 'PERMIT' && caStmt.code === UNMATCHED_CODE && caStmt.obligatory === false && caStmt.appliesIf === 'PATH_MATCHES',
    `exactly one catch-all permit rule (condition empty, unconditionalPermit), listed last in our policy, with the PERMIT statement ${UNMATCHED_CODE}`);
  ok(ours.filter((e) => e.obj.type === 'Rule' && e.obj.effectSettings.type === 'conditionalDenyElsePermit').every((e) => JSON.stringify(e.obj.effectSettings.condition) === JSON.stringify(e.obj.condition)), 'a conditionalDenyElsePermit rule of ours has an effect condition byte-identical to its own condition');
  const allShared = ours.every((e) => e.obj.shared === undefined || e.obj.shared === false);
  ok(allShared, 'none of our objects is shared');
  let again = null; try { again = build({ baseText: outText, fare, tools, updateText }).text; } catch (err) { lines.push(`FAIL  rebuild threw: ${err.message}`); fail++; }
  if (again !== null) ok(again === outText, 'building again from this file gives this exact file (repeatable, same positions, same versions)');
  return { lines, fail, outEls, ours, rest, root };
}

const countBy = (els) => { const m = {}; for (const e of els) { const t = typeOf(e.obj); m[t] = (m[t] ?? 0) + 1; } return m; };

async function loadLab() {
  const pol = await import(pathToFileURL(POLICY_PATH).href);
  return { fare: { ...pol.FARE_RULE }, tools: [...pol.BOOKING_TOOLS], decide: pol.decide };
}

function printTables(v, tab, cmp) {
  const total = countBy(v.outEls); const ours = countBy(v.ours);
  console.log('\nObjects (type: total, of which ours):');
  for (const t of Object.keys(total)) console.log(`  ${t.padEnd(44)} ${String(total[t]).padStart(4)} ${String(ours[t] ?? 0).padStart(4)}`);
  console.log('\nOur objects (type, name, id):');
  for (const e of v.ours) console.log(`  ${typeOf(e.obj).padEnd(20)} ${nameOf(e.obj).padEnd(58)} ${e.obj.id}`);
  console.log(`\nThe existing root policy set "${nameOf(v.root.obj)}" lists ${v.root.obj.children.length} children, the last is ours.`);
  console.log(`\nOur policy through the output, against the lab's own rule (server/src/policy.js decide), root set "${nameOf(v.root.obj)}" also evaluated (shared policies answer too):`);
  console.log(`  ${'flight'.padEnd(8)} ${'fare'.padStart(6)} intl cabin    approval  ${'our code'.padEnd(34)} ${'lab rule'.padEnd(14)} root       shared-stmts catch-all ok`);
  for (const r of tab.rows) console.log(`  ${r.label.padEnd(8)} ${String(r.fare).padStart(6)} ${(r.intl ? 'yes' : 'no').padEnd(4)} ${r.cabin.padEnd(8)} ${r.approval.padEnd(9)} ${r.code.padEnd(34)} ${r.lab.padEnd(14)} ${r.rootDecision.padEnd(10)} ${String(r.rootExtra).padStart(3)}          ${(r.catchAll ? 'yes' : 'no').padEnd(9)} ${r.ok ? 'ok' : 'MISMATCH'}`);
  void cmp;
}

// The overlay objects: the allow-listed shared objects the file carries (ids and versions as short prefixes, never content).
function printOverlay(v, inText, updateText) {
  const inRest = inText === null ? null : splitElements(inText).filter((e) => !isOurs(e.obj));
  console.log(`\nOverlay objects (allow-listed shared objects${updateText === null ? '; no --update-from given, so only what the file holds is listed' : ', taken from the update'}):`);
  for (const rule of OVERLAY_ALLOW) {
    const o = v.rest.find((e) => HAS_ID(e) && typeOf(e.obj) === rule.type && nameOf(e.obj) === rule.name);
    if (!o) { console.log(`  ${rule.type.padEnd(20)} ${rule.name}  NOT IN THE FILE`); continue; }
    const i = inRest?.find((e) => HAS_ID(e) && typeOf(e.obj) === rule.type && nameOf(e.obj) === rule.name);
    console.log(`  ${rule.type.padEnd(20)} ${rule.name}  id ${short(o.obj.id)}...  version ${i ? `${short(i.obj.version)}... -> ` : ''}${short(o.obj.version)}...${i ? (i.text === o.text ? '  (unchanged against the input)' : '  (changed against the input)') : ''}`);
  }
}

async function main(argv) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const base = arg('--base'); const out = arg('--out'); const check = arg('--check'); const strip = arg('--strip'); const updateFrom = arg('--update-from'); const baseOriginal = arg('--base-original');
  const updateText = updateFrom ? fs.readFileSync(updateFrom, 'utf8') : null;
  if (strip) {
    if (!out) { console.error('usage: --strip <file> --out <file> [--base-original <the owner\'s original export>]'); return 2; }
    if (path.resolve(strip) === path.resolve(out)) { console.error('--out must not be the --strip file'); return 2; }
    const original = baseOriginal ? fs.readFileSync(baseOriginal, 'utf8') : null;
    let text; try { text = stripOurs(fs.readFileSync(strip, 'utf8'), { original }); } catch (err) { console.error(`REFUSED: ${err.message}`); return 1; }
    if (original !== null && text !== original) { console.error('REFUSED: with --base-original the result must be that original byte for byte, and it is not: this file was not built from that original (nothing written)'); return 1; }
    fs.writeFileSync(out, text, 'utf8');
    console.log(`wrote ${out} (${Buffer.byteLength(text)} bytes): every object of ours removed and the root policy set restored${original === null ? '; the overlay objects are left as the file has them (the base as the build saw it; pass --base-original to restore them too)' : `; the overlay objects restored from ${baseOriginal}: byte for byte the original`}`); return 0;
  }
  if (!(base && out) && !check) { console.error('usage: build-authorize-import.mjs --base <snapshot> --out <file> [--update-from <snapshot>]\n       build-authorize-import.mjs --check <file> [--base <snapshot>] [--update-from <snapshot>]\n       build-authorize-import.mjs --strip <file> --out <file> [--base-original <snapshot>]'); return 2; }
  const lab = await loadLab();
  const tool = [...lab.tools].sort()[0];
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  let outText; let inText = null; let head = null;
  if (check) { outText = fs.readFileSync(check, 'utf8'); if (base) inText = fs.readFileSync(base, 'utf8'); } else {
    if (path.resolve(base) === path.resolve(out)) { console.error('--out must not be the --base file: the base stays as the rollback'); return 2; }
    inText = fs.readFileSync(base, 'utf8');
    let r; try { r = build({ baseText: inText, fare: lab.fare, tools: lab.tools, updateText }); } catch (err) { console.error(`REFUSED: ${err.message}`); return 1; }
    fs.writeFileSync(`${out}.tmp`, r.text, 'utf8'); fs.renameSync(`${out}.tmp`, out);
    outText = fs.readFileSync(out, 'utf8');
    head = `wrote ${out} (${Buffer.byteLength(outText)} bytes)\ndiff against the input: ${summaryLine(r.summary, r.rootName, r.overlay)}`;
  }
  if (head) console.log(head);
  const v = verifyBuilt({ outText, inText, fare: lab.fare, tools: lab.tools, updateText });
  const baseEls = splitElements(stripOurs(outText));
  const bc = completeness(baseEls);
  v.lines.push(`${bc.problems.length === 0 ? 'PASS' : 'FAIL'}  completeness of the base (our objects removed): every one of ${bc.refCount} references resolves, every policy child exists, no duplicate id`);
  if (bc.problems.length) v.fail++;
  const cmp = compareExisting(baseEls, v.outEls, tool, lab.fare);
  v.lines.push(`${cmp.diff === 0 ? 'PASS' : 'FAIL'}  existing policy set(s) ${cmp.sets.map((s) => `"${s}"`).join(', ')}: ${cmp.evaluations} evaluations of requests with no marker, base vs output, ${cmp.diff} differ (decision, statements, payloads)`);
  if (cmp.diff) v.fail++;
  v.lines.push(`${cmp.weakened === 0 ? 'PASS' : 'FAIL'}  with the marker on, ${cmp.withMarker} evaluations: no base DENY became anything else (${cmp.weakened}); ${cmp.changedWithMarker} answers gained our statements`);
  if (cmp.weakened) v.fail++;
  const grid = gridProof(v.outEls, lab.fare, tool);
  v.lines.push(`${grid.bad.length === 0 ? 'PASS' : 'FAIL'}  grid of ${grid.n} requests through our policy: at most one specific outcome rule fires and its code is the one FARE_RULE gives (next to ${UNMATCHED_CODE}), a request that passes the gate with no outcome gets ${UNMATCHED_CODE} alone, a request that fails the gate matches nothing${grid.bad.length ? `: ${grid.bad.slice(0, 3).join('; ')}` : ''}`);
  if (grid.bad.length) v.fail++;
  const tab = larkspurTable(v.outEls, { fare: lab.fare, readme, decide: lab.decide, tool, rootName: nameOf(v.root.obj) });
  v.lines.push(`${tab.bad === 0 ? 'PASS' : 'FAIL'}  our policy agrees with the lab rule on ${tab.rows.length} README flight cases (${tab.bad} mismatches)`);
  if (tab.bad) v.fail++;
  // A stray shared attribute (Amount) must not hide the airline code: the root still returns exactly one airline- code (the shared policies add their own statements).
  { const eng = makeEngine(v.outEls); const root = nameOf(v.root.obj); const req = { ...labRequest({ fare: 380, intl: true, cabin: lab.fare.from }, tool), Amount: '380' }; const r = eng.evaluate(root, req); const air = specificCodes(r.codes);
    v.lines.push(`${air.length === 1 && air[0] === 'airline-economy-intl' ? 'PASS' : 'FAIL'}  a lab request that also carries a stray Amount still gets exactly one specific airline- code from the root, plus ${UNMATCHED_CODE} (${r.decision}; other statements: ${r.codes.filter((c) => !c.startsWith('airline-')).join(', ') || 'none'}); the lab must still never send it`); if (!(air.length === 1 && air[0] === 'airline-economy-intl')) v.fail++; }
  console.log(`fare rule read from server/src/policy.js: limit ${lab.fare.limit}, hold ${lab.fare.hold}, ${lab.fare.from} -> ${lab.fare.to}, tool ${lab.tools.join(',')}`);
  console.log(v.lines.join('\n'));
  console.log(`\nexisting-policy decisions by outcome over the no-marker corpus (base): ${JSON.stringify(cmp.tally)}`);
  printTables(v, tab, cmp);
  printOverlay(v, inText, updateText);
  console.log(v.fail ? `\n${v.fail} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  return v.fail ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.stack || e.message); process.exit(1); });
