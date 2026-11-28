// {{token}} templating for the story, hop labels and narration. Tokens are filled from one of five FULL vertical packs (airline, banking, healthcare, retail, software).
// The other verticals are listed as data stubs: they have a name and nothing else, and a run on one is refused with 501. A test fails on any token a pack does not define.
// Every person, agent and host in a pack is synthetic: only .example hosts, no real company, tenant or account. Product vocabulary (Jira, Confluence,
// Marketplace) in the software pack is allowed (owner, 2026-11-16); customer and tenant names are not.
import fs from 'node:fs';
import { scanHosts } from './safety.js';

const TOKEN = /\{\{(\w+)\}\}/g;
const MAX_CAST = 40;
const ID = /^[a-z0-9.-]{1,40}$/;

// The tool names per ROLE. The manifest's primaryTool is a banking tool name; a run in another vertical swaps in that vertical's tool for the same role
// (lab reading of the source's per-vertical tool maps: the names are the source's, the role grouping is the lab's).
export const TOOL_ROLES = { get_account_balance: 'read', create_transfer: 'write', get_sensitive_account_details: 'sensitive', get_portfolio_summary: 'a2a' };
// OPTIONAL roles for tools that pass through unchanged in banking, healthcare and retail. A pack renames them only by defining the cast key below;
// a pack without the key keeps the banking name, so those three packs are byte-identical. These are not policy roles (roleOf never returns them).
export const OPTIONAL_TOOL_ROLES = { get_branch_hours: 'public', show_mortgage: 'status', request_fee_waiver: 'request', get_weather: 'scan' };
const OPTIONAL_ROLE_KEY = { public: 'castPublicTool', status: 'castStatusTool', request: 'castRequestTool', scan: 'castScanTool' };
// Cast keys only some packs define. Everything else is required of every pack (a test pins both lists).
// castFareRule marks a pack that uses the fare rule (policy.js fareDecision, like castUnit marks a count); castFareLimit and castFareHold carry its two numbers as text
// so no copy of the rule types a number by hand (a test pins them against FARE_RULE).
export const OPTIONAL_CAST_KEYS = [...Object.values(OPTIONAL_ROLE_KEY), 'castUnit', 'castPerson', 'castToolServer', 'castFareRule', 'castFareLimit', 'castFareHold'];

export const VERTICALS = {
  // The airline pack (owner, 2026-11-16): an INVENTED airline, Larkspur Air (never a real carrier), the lab's default. Flights, fares, limits and the
  // two lab-invented tools (list_airports, request_change_fee_waiver) are LAB-INVENTED. castFareRule marks the fare rule. castToolServer: its tools run on the lab's own
  // tool server (phase B), which enforces the booking rule, so the airline use cases listed in realGate run Real.
  airline: {
    castBrand: 'Larkspur Air', castHost: 'larkspur-air', castUser: 'elena.novak', castUser2: 'jun.takeda', castOwner2: 'marcus.bell', castAgent: 'travel-assistant', castAgent2: 'bookings-specialist', castAgent3: 'report-generalist',
    castAdmin: 'sofia.reyes', castMoney: 'trips and bookings', castReadTool: 'get_airline_bookings', castWriteTool: 'book_airline_flight', castSensitiveTool: 'sensitive_passenger_record', castA2aTool: 'get_airline_bookings',
    castAsset: 'trip', castAction: 'booking', castGroup: 'orbit-tier',
    castPublicTool: 'list_airports', castStatusTool: 'get_flight_status', castRequestTool: 'request_change_fee_waiver', castPerson: 'traveller',
    castFareRule: 'fare', castFareLimit: '$400', castFareHold: '$1,500', castToolServer: 'larkspur-air',
  },
  banking: {
    castBrand: 'AeroGuard Platform', castHost: 'aeroguard-platform', castUser: 'alex.morgan', castUser2: 'sam.rivera', castOwner2: 'dana.whitfield', castAgent: 'triage-agent', castAgent2: 'analytics-specialist', castAgent3: 'report-generalist',
    castAdmin: 'priya.nair', castMoney: 'checking', castReadTool: 'get_account_balance', castWriteTool: 'create_transfer', castSensitiveTool: 'get_sensitive_account_details', castA2aTool: 'get_portfolio_summary',
    castAsset: 'account', castAction: 'transfer', castGroup: 'premium-tier',
  },
  healthcare: {
    castBrand: 'AeroGuard Health Suite', castHost: 'aeroguard-health', castUser: 'grace.liu', castUser2: 'kofi.mensah', castOwner2: 'lena.ortiz', castAgent: 'care-assistant', castAgent2: 'records-specialist', castAgent3: 'report-generalist',
    castAdmin: 'tariq.hassan', castMoney: 'patient billing', castReadTool: 'view_coverage', castWriteTool: 'pay_bill', castSensitiveTool: 'sensitive_patient_records', castA2aTool: 'sensitive_patient_records',
    castAsset: 'coverage record', castAction: 'bill payment', castGroup: 'premium-tier',
  },
  retail: {
    castBrand: 'AeroGuard Retail Suite', castHost: 'aeroguard-retail', castUser: 'olu.adeyemi', castUser2: 'anna.berg', castOwner2: 'diego.ruiz', castAgent: 'shopping-assistant', castAgent2: 'orders-specialist', castAgent3: 'report-generalist',
    castAdmin: 'hana.sato', castMoney: 'store credit', castReadTool: 'list_orders', castWriteTool: 'checkout', castSensitiveTool: 'sensitive_order_history', castA2aTool: 'sensitive_order_history',
    castAsset: 'order', castAction: 'checkout', castGroup: 'premium-tier',
  },
  // The AeroGuard Work Suite (owner, 2026-11-16): Jira and Confluence work management. The write tool's `amount` is the NUMBER OF ISSUES in a bulk edit
  // (castUnit); castPerson is what the signed-in human is called in the agent's instructions; castToolServer marks a pack whose tools the lab's own tool
  // server (the local provider, or an SE-hosted instance of it) serves: the SE Agent Gateway serves none of them (owner 2026-11-16, reversing "software is mock-only").
  software: {
    castBrand: 'AeroGuard Work Suite', castHost: 'aeroguard-work', castUser: 'maya.chen', castUser2: 'raj.patel', castOwner2: 'noor.haddad', castAgent: 'release-assistant', castAgent2: 'release-specialist', castAgent3: 'report-generalist',
    castAdmin: 'ivan.petrov', castMoney: 'projects and issues', castReadTool: 'get_my_issues', castWriteTool: 'bulk_update_issues', castSensitiveTool: 'get_project_security_settings', castA2aTool: 'get_release_summary',
    castAsset: 'project', castAction: 'bulk edit', castGroup: 'enterprise-tier',
    castPublicTool: 'list_marketplace_apps', castStatusTool: 'get_deployment_status', castRequestTool: 'request_admin_access', castScanTool: 'scan_repository', castUnit: 'issues', castPerson: 'user',
    castToolServer: 'work-suite',
  },
};

// What a pack puts in tokens and authorization details where the engine used banking values. The banking values are the defaults, so a pack with no entry
// is unchanged. Scope names hold ':' so they cannot be cast values (a cast value may not contain one).
export const DEFAULT_EXTRAS = {
  scopes: { read: 'accounts:read', write: 'transfers:write', sensitive: 'accounts:sensitive', a2a: 'portfolio:read' },
  authz: { type: 'payment', maxKey: 'maxAmount' },
  intent: 'transfer:limited',
};
export const PACK_EXTRAS = {
  // records:read is used only by the staged agent-to-agent hand-off and is not created anywhere.
  airline: {
    scopes: { read: 'trips:read', write: 'flights:book', sensitive: 'travellers:read', a2a: 'records:read' },
    authz: { type: 'flight-booking', maxKey: 'maxFare' },
    intent: 'flight-booking:limited',
  },
  software: {
    scopes: { read: 'issues:read', write: 'issues:write', sensitive: 'projects:admin', a2a: 'releases:read' },
    authz: { type: 'issue-change', maxKey: 'maxIssues' },
    intent: 'issue-change:limited',
  },
};
export const extrasOf = (vertical) => (Object.hasOwn(PACK_EXTRAS, vertical) ? PACK_EXTRAS[vertical] : DEFAULT_EXTRAS);
export const DEFAULT_VERTICAL = 'airline';
export const DEFAULT_CAST = VERTICALS[DEFAULT_VERTICAL];

// Vertical ids named in the source's vertical list, minus banking/healthcare/retail (full packs; software and airline are the lab's own, not from the source list) and minus one customer-flavoured name that is left out.
// Data stubs: an id and a label, nothing else.
export const STUB_VERTICALS = {
  government: 'Government', university: 'University', workforce: 'Workforce', 'sporting-goods': 'Sporting goods',
  manufacturing: 'Manufacturing', investment: 'Investment',
};

export const unfilled = (text, cast) => [...String(text).matchAll(TOKEN)].map((m) => m[1]).filter((k) => !Object.hasOwn(cast, k));
export const fill = (text, cast) => String(text).replace(TOKEN, (m, k) => (Object.hasOwn(cast, k) ? cast[k] : m));
// Iterative, so a deep structure cannot overflow the stack.
export function fillDeep(value, cast) {
  const clone = (x) => (Array.isArray(x) ? [] : x && typeof x === 'object' ? {} : x);
  const outRoot = { v: clone(value) };
  const work = [[value, outRoot, 'v']];
  while (work.length) {
    const [src, dst, key] = work.pop();
    if (typeof src === 'string') { dst[key] = fill(src, cast); continue; }
    if (src === null || typeof src !== 'object') { dst[key] = src; continue; }
    const copy = clone(src);
    dst[key] = copy;
    for (const k of Object.keys(src).reverse()) work.push([src[k], copy, k]);
  }
  return outRoot.v;
}

export const isFullVertical = (id) => typeof id === 'string' && Object.hasOwn(VERTICALS, id);
export const isStubVertical = (id) => typeof id === 'string' && Object.hasOwn(STUB_VERTICALS, id);
export const isKnownVertical = (id) => isFullVertical(id) || isStubVertical(id);
export const verticalFrom = (id) => (isFullVertical(id) ? id : DEFAULT_VERTICAL);
export const verticalList = () => [
  ...Object.entries(VERTICALS).map(([id, c]) => ({ id, label: c.castBrand, pack: 'full' })),
  ...Object.entries(STUB_VERTICALS).map(([id, label]) => ({ id, label, pack: 'stub' })),
];

// Only brand and host as short plain strings from the optional, git-ignored customer.config.json; anything else in the file is ignored.
export function loadCast(file, vertical = DEFAULT_VERTICAL) {
  const cast = { ...VERTICALS[verticalFrom(vertical)] };
  if (!file) return cast;
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [short, key] of [['brand', 'castBrand'], ['host', 'castHost']]) {
      const v = cfg?.cast?.[short];
      if (typeof v !== 'string' || !v.trim()) continue;
      const clean = v.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim().slice(0, MAX_CAST);
      if (/:\/\/|@/.test(clean) || scanHosts(clean).length) continue;
      if (short === 'host' && (!ID.test(clean.toLowerCase()) || clean.includes('.'))) continue;
      cast[key] = short === 'brand' ? clean : clean.toLowerCase();
    }
  } catch { /* no file or not JSON: the defaults */ }
  return cast;
}

// Personas: the signed-in customer. standard = the pack's castUser; premium = castUser2, a member of castGroup (drives UC9 vs UC21).
export const PERSONAS = ['standard', 'premium'];
export const isPersona = (p) => typeof p === 'string' && PERSONAS.includes(p);
export function personaOf(cast, persona) {
  return persona === 'premium'
    ? { key: 'premium', sub: cast.castUser2, groups: [cast.castGroup], tier: 'premium' }
    : { key: 'standard', sub: cast.castUser, groups: [], tier: 'standard' };
}
export const toolFor = (cast, tool) => {
  if (tool && Object.hasOwn(OPTIONAL_TOOL_ROLES, tool)) return cast[OPTIONAL_ROLE_KEY[OPTIONAL_TOOL_ROLES[tool]]] ?? tool;
  if (!tool || !Object.hasOwn(TOOL_ROLES, tool)) return tool;
  return { read: cast.castReadTool, write: cast.castWriteTool, sensitive: cast.castSensitiveTool, a2a: cast.castA2aTool }[TOOL_ROLES[tool]];
};
export const roleOf = (tool) => (typeof tool === 'string' && Object.hasOwn(TOOL_ROLES, tool) ? TOOL_ROLES[tool] : null);
