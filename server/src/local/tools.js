// The sixteen tools (ten software, six airline): descriptors, strict argument schemas and the synthetic answers. Every payload ends with `lab_invented: true` as its LAST key.
import { randomBytes } from 'node:crypto';
import { FARE, TOOL_META } from './registry.js';
import { AIRPORTS, APPS, CODE_MATCHES, FLIGHTS, FLIGHT_IDS, ISSUES, MILES, NEWS, SECURITY_SETTINGS, TRAVELLER, TRIPS, isInternational } from './data.js';

import { CONTROL_FIELD } from './hitl.js';

const CONTROL_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

const int = (minimum, maximum, o = {}) => ({ type: 'integer', minimum, maximum, ...o });
const str = (minLength, maxLength, o = {}) => ({ type: 'string', minLength, maxLength, ...o });
const PROJECT = (o = {}) => str(2, 10, { pattern: /^[A-Z]{2,10}$/, ...o });

const hex6 = () => randomBytes(3).toString('hex').toUpperCase();

// fields: name -> schema ({ default } makes it optional, `required: true` makes it mandatory). run(args, ctx) -> payload without lab_invented.
const SPEC = {
  get_my_issues: {
    description: 'List the signed-in user\'s issues (lab data, the same fixed list for everyone).',
    fields: { limit: int(1, 20, { default: 5 }) },
    annotations: { readOnlyHint: true, destructiveHint: false },
    run: (a, ctx) => ({ signed_in_sub: ctx.sub, total: ISSUES.length, returned: Math.min(a.limit, ISSUES.length), issues: ISSUES.slice(0, a.limit).map((i) => ({ ...i })) }),
  },
  bulk_update_issues: {
    description: 'Change one field on many issues of a project at once (a bulk edit). Larger edits are held, stepped up or refused by the lab policy.',
    fields: {
      project: PROJECT({ required: true }),
      issue_count: int(1, 100000, { required: true }),
      field: str(1, 20, { enum: ['status', 'assignee', 'labels', 'priority'], default: 'status' }),
      value: str(1, 80, { default: 'Done' }),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    run: (a) => ({ project: a.project, field: a.field, value: a.value, issue_count: a.issue_count, status: 'applied', change_id: `CHG-${hex6()}`, note: 'Applied to synthetic lab data only.' }),
  },
  get_project_security_settings: {
    description: 'Read a project\'s security settings. Offered to the enterprise tier group only.',
    fields: { project: PROJECT({ default: 'PLAT' }) },
    annotations: { readOnlyHint: true, destructiveHint: false },
    run: (a) => ({ project: a.project, ...SECURITY_SETTINGS, ip_allowlist: [...SECURITY_SETTINGS.ip_allowlist] }),
  },
  get_release_summary: {
    description: 'Summarise a release of a project (lab data).',
    fields: { project: PROJECT({ default: 'PLAT' }), release: str(1, 40, { default: '2026.11.2' }) },
    annotations: { readOnlyHint: true, destructiveHint: false },
    run: (a) => ({ project: a.project, release: a.release, status: 'on track', issues_done: 41, issues_open: 6, risks: ['Audit log export latency'], target_date: '2026-11-30' }),
  },
  list_marketplace_apps: {
    description: 'List apps from a marketplace catalogue. Public: no token is needed.',
    fields: { limit: int(1, 10, { default: 5 }) },
    annotations: { readOnlyHint: true, destructiveHint: false },
    run: (a) => ({ total: APPS.length, apps: APPS.slice(0, a.limit).map((x) => ({ ...x })) }),
  },
  get_deployment_status: {
    description: 'Read the deployment status of the platform service (lab data).',
    fields: { environment: str(1, 20, { enum: ['staging', 'production'], default: 'production' }) },
    annotations: { readOnlyHint: true, destructiveHint: false },
    run: (a) => ({ environment: a.environment, service: 'platform-api', version: '2026.11.2', status: 'healthy', last_deploy: '2026-11-15T14:02:00Z', commit: 'a1b2c3d' }),
  },
  request_admin_access: {
    description: 'Ask for an admin role on a project. This only files a request; this tool server has no tool that grants access.',
    fields: {
      role: str(1, 20, { enum: ['project-admin', 'site-admin'], required: true }),
      project: PROJECT({ default: 'PLAT' }),
      reason: str(1, 200, { required: true }),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: (a, ctx) => ({ request_id: `REQ-${hex6()}`, status: 'pending', role: a.role, project: a.project, requested_by: ctx.sub, note: 'A request only. Nothing was granted: this tool server has no tool that grants access.' }),
  },
  scan_repository: {
    description: 'Scan a repository for findings (lab data). Configured for the platform, billing and mobile repositories only.',
    fields: { repo: str(1, 60, { pattern: /^[A-Za-z0-9._-]+$/, required: true }) },
    annotations: { readOnlyHint: true, destructiveHint: false },
    run: (a, ctx) => ({
      repo: a.repo, findings: [{ id: 'SCAN-1', severity: 'medium', title: 'Outdated dependency (example)' }], summary: { critical: 0, high: 0, medium: 1, low: 2 }, scanned_at: new Date(ctx.now()).toISOString(),
    }),
  },
  brave_news_search: {
    description: 'Search news articles (lab data, three fixed results).',
    fields: { query: str(1, 200, { required: true }) },
    annotations: { readOnlyHint: true, destructiveHint: false },
    run: (a) => ({ query: a.query, results: NEWS.map((n) => ({ ...n })) }),
  },
  code_search: {
    description: 'Search source code across repositories (lab data).',
    fields: { query: str(1, 200, { required: true }) },
    annotations: { readOnlyHint: true, destructiveHint: false },
    run: (a) => ({ query: a.query, matches: CODE_MATCHES.map((m) => ({ ...m })) }),
  },
  get_airline_bookings: {
    description: "List the signed-in traveller's upcoming trips (lab data, the same fixed list for everyone).",
    fields: { limit: int(1, 10, { default: 5 }) },
    annotations: { readOnlyHint: true, destructiveHint: false },
    run: (a, ctx) => ({ signed_in_sub: ctx.sub, total: TRIPS.length, returned: Math.min(a.limit, TRIPS.length), trips: TRIPS.slice(0, a.limit).map((t) => ({ ...t })), miles: MILES }),
  },
  get_flight_status: {
    description: 'Read the status of a flight (lab data).',
    fields: { flight: str(1, 10, { enum: FLIGHT_IDS, default: 'LK 214' }) },
    annotations: { readOnlyHint: true, destructiveHint: false },
    run: (a) => {
      const f = FLIGHTS[a.flight];
      return { flight: a.flight, route: `${f.from} to ${f.to}`, status: 'on time', gate: f.gate, departs: `${f.day} ${f.time}` };
    },
  },
  book_airline_flight: {
    description: "Book a seat on a flight. The lab's fare rule applies: a booking over the second limit is held for a person, and an international or over-limit booking is booked in economy only.",
    fields: { flight: str(1, 10, { enum: FLIGHT_IDS, required: true }), cabin: str(1, 10, { enum: ['business', 'economy'], default: 'economy' }) },
    annotations: { readOnlyHint: false, destructiveHint: false },
    // The fare is the table's, never the caller's. ctx.narrow is null or { granted, because } and is set by the policy only.
    run: (a, ctx) => {
      const f = FLIGHTS[a.flight];
      const narrow = ctx.narrow ?? null;
      const out = {
        status: 'booked', confirmation: `LKR-${hex6()}`, flight: a.flight, from: f.from, to: f.to, international: isInternational(f), fare_judged: f.fare,
        cabin_asked: a.cabin, cabin_booked: narrow ? narrow.granted : a.cabin,
      };
      if (narrow) out.constrained = { field: 'cabin', asked: a.cabin, granted: narrow.granted, because: [...narrow.because], limit: FARE.limit, rule: 'lab-fare-constrained' };
      out.note = 'Booked on synthetic lab data only.';
      return out;
    },
  },
  sensitive_passenger_record: {
    description: "Read the traveller's private record (masked). Offered to the orbit tier group only.",
    fields: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
    run: () => ({ passport_last4: TRAVELLER.passport_last4, known_traveller_number: 'on file (hidden)', card_last4: TRAVELLER.card_last4, note: 'Full numbers are never returned by this tool.' }),
  },
  list_airports: {
    description: 'List airports near the traveller. Public: no token is needed.',
    fields: { limit: int(1, 10, { default: 5 }) },
    annotations: { readOnlyHint: true, destructiveHint: false },
    run: (a) => {
      const all = Object.entries(AIRPORTS);
      return { total: all.length, airports: all.slice(0, a.limit).map(([code, x]) => ({ code, name: x.name, miles_away: x.miles_away })) };
    },
  },
  request_change_fee_waiver: {
    description: 'Ask for a change fee to be waived. This only files a request; this tool server has no tool that grants a waiver.',
    fields: { flight: str(1, 10, { enum: FLIGHT_IDS, default: 'LK 214' }), reason: str(1, 80, { required: true }) },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: (a, ctx) => ({ request_id: `CFW-${hex6()}`, status: 'pending review', flight: a.flight, requested_by: ctx.sub, note: 'This tool only files a request; no tool here can grant a waiver.' }),
  },
};

export const TOOL_NAMES = Object.keys(SPEC);

const schemaOf = (f) => {
  const { required, pattern, ...rest } = f;
  return { ...rest, ...(pattern ? { pattern: pattern.source } : {}) };
};

export function descriptorOf(name) {
  const spec = SPEC[name];
  const meta = TOOL_META[name];
  const properties = Object.fromEntries(Object.entries(spec.fields).map(([k, f]) => [k, schemaOf(f)]));
  properties[CONTROL_FIELD] = { type: 'string', pattern: CONTROL_PATTERN.source, description: 'An approval receipt, sent back on the retry of a held call.' };
  return {
    name,
    description: spec.description,
    inputSchema: { type: 'object', properties, required: Object.entries(spec.fields).filter(([, f]) => f.required).map(([k]) => k), additionalProperties: false },
    annotations: { ...spec.annotations },
    _meta: { requiredScope: meta.scope, labInvented: true },
  };
}

const fieldOk = (f, v) => {
  if (f.type === 'integer') return Number.isInteger(v) && v >= f.minimum && v <= f.maximum;
  if (typeof v !== 'string' || v.length < f.minLength || v.length > f.maxLength) return false;
  if (f.enum && !f.enum.includes(v)) return false;
  return !f.pattern || f.pattern.test(v);
};

// Strict validation (own properties only). Returns { ok: true, args, receipt } or { ok: false, text }; the text is fixed and never echoes the request.
export function validateArgs(name, raw) {
  const spec = SPEC[name];
  const given = raw === undefined || raw === null ? {} : raw;
  if (typeof given !== 'object' || Array.isArray(given)) return { ok: false, text: 'invalid arguments: arguments must be an object' };
  let receipt = null;
  if (Object.hasOwn(given, CONTROL_FIELD)) {
    const v = given[CONTROL_FIELD];
    if (typeof v !== 'string' || !CONTROL_PATTERN.test(v)) return { ok: false, text: `invalid arguments: ${CONTROL_FIELD} is not valid` };
    receipt = v;
  }
  for (const k of Object.keys(given)) if (k !== CONTROL_FIELD && !Object.hasOwn(spec.fields, k)) return { ok: false, text: 'invalid arguments: unexpected field' };
  const args = {};
  for (const [k, f] of Object.entries(spec.fields)) {
    if (!Object.hasOwn(given, k)) {
      if (f.required) return { ok: false, text: `invalid arguments: ${k} is required` };
      args[k] = f.default;
    } else {
      if (!fieldOk(f, given[k])) return { ok: false, text: `invalid arguments: ${k} is not valid` };
      args[k] = given[k];
    }
  }
  return { ok: true, args, receipt };
}

// ctx: { sub, now, narrow? }. The payload ends with lab_invented.
export const runTool = (name, args, ctx) => ({ ...SPEC[name].run(args, ctx), lab_invented: true });
