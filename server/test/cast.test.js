import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VERTICALS, STUB_VERTICALS, DEFAULT_CAST, DEFAULT_VERTICAL, OPTIONAL_CAST_KEYS, OPTIONAL_TOOL_ROLES, extrasOf, DEFAULT_EXTRAS, unfilled, fill, fillDeep, loadCast, verticalList, isFullVertical, isKnownVertical, personaOf, toolFor, roleOf, TOOL_ROLES } from '../src/cast.js';
import { LABELS, EXTRA_TOKENS, NOT_DEMONSTRATED, rawStory } from '../src/data.js';
import { buildStory, renderTalkTrackMarkdown } from '../src/story.js';

test('four full vertical packs define every {{token}} the labels and the story use; a test fails on any undefined token', () => {
  assert.deepEqual(Object.keys(VERTICALS), ['banking', 'healthcare', 'retail', 'software']);
  assert.equal(DEFAULT_VERTICAL, 'software'); assert.equal(DEFAULT_CAST, VERTICALS.software);
  const text = JSON.stringify(rawStory());
  for (const [v, pack] of Object.entries(VERTICALS)) {
    const known = { ...pack, ...Object.fromEntries(EXTRA_TOKENS.map((t) => [t, 'x'])) };
    assert.deepEqual(unfilled(text, known), [], v);
    assert.deepEqual(unfilled(JSON.stringify(buildStory(pack, v)), pack), [], `${v}: the filled story has no token left`);
  }
  assert.deepEqual(unfilled('{{castBrand}} and {{castMissing}} and {{__proto__}} and {{constructor}}', DEFAULT_CAST), ['castMissing', '__proto__', 'constructor']);
});

test('all packs share one set of required keys (optional keys only where named), every value is a plain short string and no host or person is real', () => {
  const keys = Object.keys(VERTICALS.banking).sort();
  for (const [v, pack] of Object.entries(VERTICALS)) {
    assert.deepEqual(Object.keys(pack).filter((k) => !OPTIONAL_CAST_KEYS.includes(k)).sort(), keys, v);
    for (const val of Object.values(pack)) { assert.equal(typeof val, 'string'); assert.ok(val.length > 0 && val.length < 41); assert.ok(!/[:/@]/.test(val)); }
  }
  assert.equal(new Set(Object.values(VERTICALS).map((p) => p.castUser)).size, 4);
  for (const v of ['banking', 'healthcare', 'retail']) assert.deepEqual(Object.keys(VERTICALS[v]).filter((k) => OPTIONAL_CAST_KEYS.includes(k)), [], `${v} defines no optional key`);
  assert.deepEqual(Object.keys(VERTICALS.software).filter((k) => OPTIONAL_CAST_KEYS.includes(k)).sort(), [...OPTIONAL_CAST_KEYS].sort(), 'software defines every optional key');
});

test('fill never reads inherited properties: {{__proto__}} and {{constructor}} stay as text', () => {
  assert.equal(fill('a {{__proto__}} b {{constructor}} c {{toString}}', DEFAULT_CAST), 'a {{__proto__}} b {{constructor}} c {{toString}}');
  assert.deepEqual(fillDeep({ a: ['{{castBrand}}', { b: '{{castUser}}' }], n: 1, z: null }, DEFAULT_CAST), { a: ['Appfire Work Suite', { b: 'maya.chen' }], n: 1, z: null });
});

test('fillDeep is iterative: a structure 50,000 levels deep does not overflow the stack', () => {
  let deep = '{{castBrand}}'; for (let i = 0; i < 50000; i++) deep = { x: deep };
  let out = fillDeep(deep, DEFAULT_CAST); let n = 0; while (typeof out === 'object') { out = out.x; n++; }
  assert.equal(n, 50000); assert.equal(out, 'Appfire Work Suite');
});

test('seven verticals are data stubs (a name only); one customer-flavoured source name is left out', () => {
  const list = verticalList();
  assert.equal(list.length, 11);
  assert.deepEqual(list.filter((v) => v.pack === 'full').map((v) => v.id), ['banking', 'healthcare', 'retail', 'software']);
  assert.deepEqual(list.filter((v) => v.pack === 'stub').map((v) => v.id), Object.keys(STUB_VERTICALS));
  for (const stub of Object.values(STUB_VERTICALS)) assert.equal(typeof stub, 'string');
  assert.equal(isFullVertical('government'), false); assert.equal(isKnownVertical('government'), true);
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', undefined, null, 1, ['banking']]) { assert.equal(isKnownVertical(bad), false, String(bad)); assert.equal(isFullVertical(bad), false); }
});

test('tools follow the role: the manifest tool is a banking name and a run swaps in the vertical\'s tool for the same role', () => {
  assert.deepEqual(Object.values(TOOL_ROLES).sort(), ['a2a', 'read', 'sensitive', 'write'], 'the policy roles stay four');
  assert.deepEqual(Object.values(OPTIONAL_TOOL_ROLES).sort(), ['public', 'request', 'scan', 'status']);
  assert.equal(toolFor(VERTICALS.healthcare, 'create_transfer'), 'pay_bill'); assert.equal(toolFor(VERTICALS.retail, 'get_account_balance'), 'list_orders');
  assert.equal(toolFor(VERTICALS.banking, 'get_account_balance'), 'get_account_balance');
  assert.equal(toolFor(VERTICALS.retail, 'get_weather'), 'get_weather'); assert.equal(toolFor(VERTICALS.retail, null), null);
  // software renames the pass-through tools through its optional cast keys; the other three packs keep the banking names
  assert.equal(toolFor(VERTICALS.software, 'get_account_balance'), 'get_my_issues'); assert.equal(toolFor(VERTICALS.software, 'create_transfer'), 'bulk_update_issues');
  assert.equal(toolFor(VERTICALS.software, 'get_sensitive_account_details'), 'get_project_security_settings'); assert.equal(toolFor(VERTICALS.software, 'get_portfolio_summary'), 'get_release_summary');
  assert.equal(toolFor(VERTICALS.software, 'get_branch_hours'), 'list_marketplace_apps'); assert.equal(toolFor(VERTICALS.software, 'show_mortgage'), 'get_deployment_status');
  assert.equal(toolFor(VERTICALS.software, 'request_fee_waiver'), 'request_admin_access'); assert.equal(toolFor(VERTICALS.software, 'get_weather'), 'scan_repository');
  for (const v of ['banking', 'healthcare', 'retail']) for (const t of Object.keys(OPTIONAL_TOOL_ROLES)) assert.equal(toolFor(VERTICALS[v], t), t, `${v} ${t} keeps its name`);
  assert.equal(toolFor(VERTICALS.software, 'brave_news_search'), 'brave_news_search'); assert.equal(toolFor(VERTICALS.software, 'code_search'), 'code_search');
  assert.equal(roleOf('get_branch_hours'), null, 'an optional role is not a policy role');
  assert.equal(roleOf('__proto__'), null); assert.equal(roleOf('constructor'), null); assert.equal(roleOf('create_transfer'), 'write'); assert.equal(roleOf(undefined), null);
});

test('software scope names, authorization detail and amount unit are the pack\'s; the other packs keep the banking values', () => {
  assert.deepEqual(extrasOf('software').scopes, { read: 'issues:read', write: 'issues:write', sensitive: 'projects:admin', a2a: 'releases:read' });
  assert.deepEqual(extrasOf('software').authz, { type: 'issue-change', maxKey: 'maxIssues' });
  for (const v of ['banking', 'healthcare', 'retail', '__proto__', 'nope']) assert.equal(extrasOf(v), DEFAULT_EXTRAS, v);
  assert.deepEqual(DEFAULT_EXTRAS.scopes, { read: 'accounts:read', write: 'transfers:write', sensitive: 'accounts:sensitive', a2a: 'portfolio:read' });
  assert.equal(DEFAULT_EXTRAS.authz.type, 'payment');
});

test('personas: standard is the pack\'s first customer, premium the second and in the group', () => {
  const p = personaOf(DEFAULT_CAST, 'premium'); const s = personaOf(DEFAULT_CAST, 'standard');
  assert.deepEqual([s.sub, s.groups], [DEFAULT_CAST.castUser, []]); assert.deepEqual([p.sub, p.groups], [DEFAULT_CAST.castUser2, [DEFAULT_CAST.castGroup]]);
  assert.equal(personaOf(DEFAULT_CAST, 'admin').key, 'standard');
});

test('customer.config.json can set only the brand and a one-label host; a bad value is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-cast-'));
  const f = path.join(dir, 'c.json');
  try {
    fs.writeFileSync(f, JSON.stringify({ cast: { brand: 'Acme Test', host: 'acme', castUser: 'evil', custodian: 'x' } }));
    const c = loadCast(f, 'retail');
    assert.equal(c.castBrand, 'Acme Test'); assert.equal(c.castHost, 'acme'); assert.equal(c.castUser, VERTICALS.retail.castUser);
    for (const bad of [{ brand: 'https://x.example', host: 'a.b' }, { brand: 'a@b.example', host: 'Has Space' }, { brand: 'see 10.0.0.1', host: 7 }]) {
      fs.writeFileSync(f, JSON.stringify({ cast: bad }));
      const d = loadCast(f, 'retail'); assert.equal(d.castBrand, VERTICALS.retail.castBrand); assert.equal(d.castHost, VERTICALS.retail.castHost);
    }
    fs.writeFileSync(f, 'not json'); assert.equal(loadCast(f).castBrand, 'Appfire Work Suite');
    assert.equal(loadCast('/nonexistent/c.json', 'healthcare').castBrand, 'Appfire Health Suite');
    assert.equal(loadCast(f, '__proto__').castBrand, 'Appfire Work Suite', 'an unknown vertical falls back to the default');
    assert.equal(loadCast(f, 'banking').castBrand, 'Appfire Platform'); assert.equal(loadCast('/nonexistent/c.json', 'software').castUnit, 'issues');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('labels cover every hop kind the engine emits, and the talk track on disk is exactly what the data renders', async () => {
  const { MANIFEST } = await import('../src/manifest.js');
  const { runUseCase } = await import('../src/flow.js');
  const kinds = new Set();
  for (const uc of MANIFEST.usecases) for (const h of runUseCase(uc, { cast: DEFAULT_CAST, vertical: 'banking', seed: 'x' }).hops) kinds.add(h.kind);
  for (const k of kinds) assert.ok(Object.hasOwn(LABELS, k), `a label for ${k}`);
  assert.equal(fs.readFileSync(new URL('../../docs/talk-track.md', import.meta.url), 'utf8'), renderTalkTrackMarkdown(DEFAULT_CAST));
});

test('review fix: the presenter text counts the stub verticals correctly (the NOT_DEMONSTRATED line says as many as there are stubs)', () => {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const line = NOT_DEMONSTRATED.find((l) => /verticals are data stubs/.test(l));
  assert.ok(line.toLowerCase().startsWith(`${words[Object.keys(STUB_VERTICALS).length]} verticals are data stubs`), line);
  assert.equal(Object.keys(STUB_VERTICALS).length, 7);
});
