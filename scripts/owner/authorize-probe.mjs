#!/usr/bin/env node
// OWNER-RUN. Asks the owner's PingOne Authorize decision endpoint ("Larkspur Air Booking") the 21 questions of docs/design-authorize-lab.md section F and reports,
// per row, whether the answer is the one the lab expects. DECISION CALLS ONLY: it never reads or writes a policy, an application or a user.
//
//   node scripts/owner/authorize-probe.mjs                       # dry run (default): prints what it would call, sends nothing
//   node scripts/owner/authorize-probe.mjs --run                 # the 21 rows, at least 1.2 s apart
//   node scripts/owner/authorize-probe.mjs --run --record <dir>  # also writes one JSON file per row (the raw answers) into <dir>, which must be OUTSIDE any git repository
//
// Flags: --env-file <path> (default: this repo's .env; read only). Settings, from that file only (never a shell variable): PINGONE_ENVIRONMENT_ID, PINGONE_REGION
// (com, eu, ca or asia; com if unset), AAG_AUTHORIZE_ENDPOINT_ID, AAG_AUTHORIZE_CLIENT_ID, AAG_AUTHORIZE_CLIENT_SECRET (a WORKER-type app's client credentials).
// Exit codes: 0 every row passed; 1 a row failed; 2 refused to start (a setting is missing, a bad flag, a record directory inside a repository); 3 could not finish
// (the endpoint is unreachable, the token endpoint refused the worker credential, or a 429 survived its retries).
//
// What a row sends is EXACTLY the lab's seven string parameters, always all of them: AirLabMarker, ToolName, UserId, AirFare, AirIsInternational, AirCabinAsked,
// AirApproval. It never sends shared attributes (no Amount, no DecisionContext, no ActClientId) and no user data beyond the fixed probe subject. The endpoint
// evaluates the WHOLE shared policy tree, so every answer also carries other demos' codes: they and the catch-all airline-unmatched are listed as ignored, never judged.
// A row PASSES when the answer holds exactly ONE distinct code of the lab's eight, equal to the expected one, with the top-level decision the lab requires.
// A negative row PASSES when the answer holds NO code of the lab's eight. INDETERMINATE fails every row except N01 (a malformed fare may be INDETERMINATE). A 429 is retried
// once, after 1.5 s, and is never recorded as an answer.
// NOT PROBED: airline-second-factor-required and airline-booking-refused (no input the lab can send produces them; the reader maps them and the fakes cover them).
// The bearer token, the client secret and the full endpoint id are never printed or recorded. Test calls appear in the endpoint's "recent decisions" list.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSettings } from './pingone-real-setup.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PARAM_NAMES = ['AirLabMarker', 'ToolName', 'UserId', 'AirFare', 'AirIsInternational', 'AirCabinAsked', 'AirApproval'];
export const SETTING_NAMES = ['PINGONE_ENVIRONMENT_ID', 'AAG_AUTHORIZE_ENDPOINT_ID', 'AAG_AUTHORIZE_CLIENT_ID', 'AAG_AUTHORIZE_CLIENT_SECRET'];
export const UNMATCHED = 'airline-unmatched';
// The lab's eight codes and the top-level decision each one comes with (design-authorize-lab.md C.1).
export const OUR_CODES = {
  'airline-permit-as-asked': 'PERMIT',
  'airline-economy-intl': 'PERMIT',
  'airline-economy-over-limit': 'PERMIT',
  'airline-economy-intl-over-limit': 'PERMIT',
  'airline-approval-required': 'PERMIT',
  'airline-approved-as-asked': 'PERMIT',
  'airline-second-factor-required': 'PERMIT',
  'airline-booking-refused': 'DENY',
};
export const PACE_MS = 1200;
export const RETRY_429 = 1;
const REGION_TLD = { na: 'com', us: 'com', com: 'com', eu: 'eu', ca: 'ca', ap: 'asia', asia: 'asia' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER = /^(0{8}-0{4}-0{4}-0{4}-0{12}|replace-me)$/i;

const BASE = { AirLabMarker: 'larkspur-air', ToolName: 'book_airline_flight', UserId: 'lab-probe-subject' };
const row = (id, name, fare, intl, cabin, approval, expect, extra = {}) => ({
  id, name, expect, kind: 'positive', ...extra,
  params: { ...BASE, AirFare: fare, AirIsInternational: intl, AirCabinAsked: cabin, AirApproval: approval, ...(extra.override || {}) },
});
const neg = (id, name, fare, intl, cabin, approval, override = {}, extra = {}) => row(id, name, fare, intl, cabin, approval, null, { kind: 'negative', override, ...extra });
// The 21 rows of section F, in order: 13 positive, 6 negative, 2 leniency. `lab` is what the page shows when the lab's tool server sends the row.
export const CASES = [
  row('P01', 'Denver', '380', 'false', 'business', 'none', 'airline-permit-as-asked'),
  row('P02', 'Toronto', '380', 'true', 'business', 'none', 'airline-economy-intl'),
  row('P03', 'Boston', '780', 'false', 'business', 'none', 'airline-economy-over-limit'),
  row('P04', 'Paris', '2400', 'true', 'business', 'none', 'airline-approval-required'),
  row('P05', 'edge 400', '400', 'false', 'business', 'none', 'airline-permit-as-asked'),
  row('P06', 'edge 401', '401', 'false', 'business', 'none', 'airline-economy-over-limit'),
  row('P07', 'edge 1500', '1500', 'false', 'business', 'none', 'airline-economy-over-limit'),
  row('P08', 'edge 1501', '1501', 'false', 'business', 'none', 'airline-approval-required'),
  row('P09', 'both reasons', '1100', 'true', 'business', 'none', 'airline-economy-intl-over-limit'),
  row('P10', 'economy asked, international', '380', 'true', 'economy', 'none', 'airline-permit-as-asked'),
  row('P11', 'economy asked over the hold', '1501', 'false', 'economy', 'none', 'airline-approval-required'),
  row('P12', 'approved retry', '2400', 'true', 'business', 'verified', 'airline-approved-as-asked'),
  row('P13', 'receipt at or under the hold', '380', 'true', 'business', 'verified', 'airline-economy-intl'),
  neg('N01', 'malformed fare', 'abc', 'false', 'business', 'none', {}, { allowIndeterminate: true }),
  neg('N02', 'empty user', '380', 'false', 'business', 'none', { UserId: '' }),
  neg('N03', 'out of our gate', '380', 'false', 'business', 'none', { AirLabMarker: 'other' }),
  neg('N04', 'unknown cabin', '380', 'false', 'first', 'none'),
  neg('N05', 'unknown approval over the hold', '2400', 'true', 'business', 'maybe'),
  neg('N06', 'other tool name (assumed)', '380', 'false', 'business', 'none', { ToolName: 'other_tool' }, { assumed: true }),
  row('L01', 'lenient true', '380', 'True', 'business', 'none', 'airline-economy-intl', { kind: 'lenient' }),
  row('L02', 'lenient false', '380', 'maybe', 'business', 'none', 'airline-permit-as-asked', { kind: 'lenient' }),
];

// The request body a row sends: exactly the seven keys, in this order, every value a string. A row can never add a key.
export function buildRequest(c) {
  const parameters = {};
  for (const k of PARAM_NAMES) parameters[k] = String(c.params[k]);
  return { parameters };
}

const clip = (v, n = 120) => String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);

// Judge one answer (HTTP 200, JSON object). Pure. Returns { verdict: PASS|FAIL|NOTE, text, specific, ignored }.
export function judge(c, answer) {
  const decision = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer.decision : undefined;
  if (typeof decision !== 'string' || !['PERMIT', 'DENY', 'NOT_APPLICABLE', 'INDETERMINATE'].includes(decision)) return { verdict: 'FAIL', text: 'the answer has no decision the lab can read', specific: [], ignored: [] };
  const statements = answer.statements == null ? [] : answer.statements;
  if (!Array.isArray(statements) || statements.some((s) => !s || typeof s !== 'object' || typeof s.code !== 'string')) return { verdict: 'FAIL', text: 'the answer\'s statements could not be read', specific: [], ignored: [] };
  const codes = [...new Set(statements.map((s) => s.code))];
  const specific = codes.filter((k) => Object.hasOwn(OUR_CODES, k));
  const unknownAirline = codes.filter((k) => k.startsWith('airline-') && k !== UNMATCHED && !Object.hasOwn(OUR_CODES, k));
  const ignored = codes.filter((k) => !Object.hasOwn(OUR_CODES, k)).map((k) => clip(k, 60));
  const seen = specific.length ? `${specific.join(', ')} (${decision})` : `no airline code (${decision})`;
  const done = (verdict, text) => ({ verdict, text, specific, ignored });

  if (c.kind === 'negative') {
    if (c.assumed) return specific.length || unknownAirline.length || decision === 'INDETERMINATE' ? done('NOTE', `an assumed row came out differently: ${seen}; the facts do not say ToolName is part of the policy gate`) : done('PASS', `no airline code (${decision})`);
    if (specific.length) return done('FAIL', `UNEXPECTED CODE on a negative row: ${seen}`);
    if (unknownAirline.length) return done('FAIL', `UNEXPECTED CODE on a negative row: ${clip(unknownAirline[0], 60)}`);
    if (decision === 'INDETERMINATE') return c.allowIndeterminate ? done('PASS', '(INDETERMINATE, a no decision)') : done('FAIL', 'INDETERMINATE on a row that should have no airline code');
    return done('PASS', `no airline code (${decision})`);
  }
  if (decision === 'INDETERMINATE') return done('FAIL', 'INDETERMINATE: PingOne Authorize could not evaluate the request');
  if (unknownAirline.length) return done('FAIL', `UNRECOGNISED airline code: ${clip(unknownAirline[0], 60)} (the lab would give no decision)`);
  if (specific.length === 0) return done('FAIL', `NO AIRLINE CODE: expected ${c.expect}, got ${decision} with none`);
  if (specific.length > 1) return done('FAIL', `TWO SPECIFIC CODES: ${specific.join(', ')} (the lab would give no decision)`);
  if (specific[0] !== c.expect) return done('FAIL', `WRONG CODE: expected ${c.expect}, got ${specific[0]}`);
  if (decision !== OUR_CODES[c.expect]) return done('FAIL', `WRONG DECISION: ${c.expect} must come with ${OUR_CODES[c.expect]}, got ${decision}`);
  return done('PASS', `${c.expect} (${decision})`);
}

// A directory is "inside a git repository" when it, or any parent that exists, holds a .git (a folder, or a file as a worktree has).
export function insideGitRepo(dir) {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    const up = path.dirname(d);
    if (up === d) return false;
    d = up;
  }
}

export function parseArgs(argv) {
  const o = { run: false, envFile: path.join(repoRoot, '.env'), record: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') o.run = true;
    else if (a === '--dry-run') o.run = false;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--env-file' || a === '--record') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      if (a === '--env-file') o.envFile = path.resolve(v); else o.record = path.resolve(v);
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (argv.includes('--run') && argv.includes('--dry-run')) throw new Error('--run and --dry-run together: pick one');
  if (o.record && !o.run) throw new Error('--record needs --run');
  return o;
}

const usable = (s, k) => typeof s[k] === 'string' && s[k].trim() !== '' && !PLACEHOLDER.test(s[k].trim());

// The URLs, from the settings only. AAG_LIVE_TEST_BASE (http on loopback, tests only: the same name the lab uses) redirects both calls to a stub on this machine.
export function targetOf(s) {
  const missing = SETTING_NAMES.filter((k) => !usable(s, k));
  if (missing.length) return { missing };
  const region = String(s.PINGONE_REGION || 'com').toLowerCase();
  const tld = REGION_TLD[region];
  if (!tld) return { missing: [], bad: 'PINGONE_REGION is not one of com, eu, ca or asia' };
  const env = s.PINGONE_ENVIRONMENT_ID.trim();
  const endpoint = s.AAG_AUTHORIZE_ENDPOINT_ID.trim();
  if (!UUID.test(env)) return { missing: [], bad: 'PINGONE_ENVIRONMENT_ID is not an id' };
  if (!UUID.test(endpoint)) return { missing: [], bad: 'AAG_AUTHORIZE_ENDPOINT_ID is not an id' };
  let tokenUrl = `https://auth.pingone.${tld}/${env}/as/token`;
  let decisionUrl = `https://api.pingone.${tld}/v1/environments/${env}/decisionEndpoints/${endpoint}`;
  let shown = { token: `https://auth.pingone.${tld}/<environment id>/as/token`, decision: `https://api.pingone.${tld}/v1/environments/<environment id>/decisionEndpoints/<endpoint id>` };
  if (usable(s, 'AAG_LIVE_TEST_BASE')) {
    let u;
    try { u = new URL(s.AAG_LIVE_TEST_BASE.trim()); } catch { return { missing: [], bad: 'AAG_LIVE_TEST_BASE is not a URL' }; }
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return { missing: [], bad: 'AAG_LIVE_TEST_BASE must be http on loopback' };
    tokenUrl = `${u.origin}${u.pathname.replace(/\/$/, '')}/as/token`;
    decisionUrl = `${u.origin}/v1/environments/${env}/decisionEndpoints/${endpoint}`;
    shown = { token: `${u.origin}/<environment id>/as/token`, decision: `${u.origin}/v1/environments/<environment id>/decisionEndpoints/<endpoint id>` };
  }
  return { tokenUrl, decisionUrl, shown, clientId: s.AAG_AUTHORIZE_CLIENT_ID.trim(), clientSecret: s.AAG_AUTHORIZE_CLIENT_SECRET.trim() };
}

const sleepFor = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Returns the exit code. fetchImpl, log and sleep are injectable so a test can drive it against a stub on loopback with no waiting.
export async function run(opts, { fetchImpl = (...a) => globalThis.fetch(...a), log = console.log, sleep = sleepFor } = {}) {
  let settings;
  try { settings = readSettings(opts.envFile); } catch (e) { log(`refusing: ${clip(e.message, 200)}`); return 2; }
  const t = targetOf(settings);
  if (t.missing?.length) { log(`refusing: these settings are missing or still placeholders in ${path.basename(opts.envFile)}: ${t.missing.join(', ')}`); return 2; }
  if (t.bad) { log(`refusing: ${t.bad}`); return 2; }
  if (opts.record) {
    if (insideGitRepo(opts.record)) { log('refusing: --record must be a directory OUTSIDE any git repository (the raw answers are not for a commit)'); return 2; }
  }

  log(`PingOne Authorize decision probe: ${CASES.length} rows against the decision endpoint (decision calls only)`);
  log(`  token:    POST ${t.shown.token}  (client_credentials, HTTP Basic, no scope; the credential is not shown)`);
  log(`  decision: POST ${t.shown.decision}  (Authorization: Bearer (worker token, not shown))`);
  log(`  sends exactly: ${PARAM_NAMES.join(', ')}`);
  if (!opts.run) {
    for (const c of CASES) log(`  ${c.id.padEnd(4)} ${c.name.padEnd(32)} ${PARAM_NAMES.slice(3).map((k) => `${k}=${c.params[k] === '' ? '(empty)' : c.params[k]}`).join(' ')}${c.params.UserId === '' ? ' UserId=(empty)' : ''}${c.params.AirLabMarker !== BASE.AirLabMarker ? ` AirLabMarker=${c.params.AirLabMarker}` : ''}${c.params.ToolName !== BASE.ToolName ? ` ToolName=${c.params.ToolName}` : ''}`);
    log('Dry run: nothing was sent. Add --run to ask the endpoint (rows are 1.2 s apart).');
    return 0;
  }

  if (opts.record) fs.mkdirSync(opts.record, { recursive: true, mode: 0o700 });
  let token = null;
  const getToken = async () => {
    let r;
    try {
      r = await fetchImpl(t.tokenUrl, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: { authorization: `Basic ${Buffer.from(`${t.clientId}:${t.clientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: 'grant_type=client_credentials',
      });
    } catch { return { error: 'the token endpoint could not be reached' }; }
    if (r.status === 400 || r.status === 401) return { error: `the token endpoint refused the worker credential (HTTP ${r.status})` };
    if (r.status !== 200) return { error: `the token endpoint answered HTTP ${r.status}` };
    let j;
    try { j = JSON.parse(await r.text()); } catch { return { error: 'the token endpoint answered something that is not JSON' }; }
    if (!j || typeof j.access_token !== 'string' || !j.access_token) return { error: 'the token endpoint answered no access token' };
    return { token: j.access_token };
  };

  const tally = { PASS: 0, FAIL: 0, NOTE: 0 };
  let shownStatements = false;
  let first = true;
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    if (!first) await sleep(PACE_MS);
    first = false;
    const label = `${String(i + 1).padStart(2)}  ${c.id.padEnd(4)} ${c.name.padEnd(32)}`;
    if (!token) {
      const g = await getToken();
      if (g.error) { log(`${label} STOPPED: ${g.error}`); return 3; }
      token = g.token;
    }
    const body = JSON.stringify(buildRequest(c));
    let res = null; let text = ''; let retries = 0; let refreshed = false;
    for (;;) {
      try {
        res = await fetchImpl(t.decisionUrl, {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, application/hal+json' }, body,
        });
        text = await res.text();
      } catch { log(`${label} STOPPED: the decision endpoint could not be reached`); return 3; }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        const g = await getToken();
        if (g.error) { log(`${label} STOPPED: ${g.error}`); return 3; }
        token = g.token;
        continue;
      }
      if (res.status === 429) {
        if (retries >= RETRY_429) { log(`${label} STOPPED: the endpoint kept answering 429 (rate limited) after ${RETRY_429} retries`); return 3; }
        retries += 1;
        await sleep(1500);
        continue;
      }
      break;
    }
    const note = retries ? ` (429 retried ${retries}x)` : '';
    let verdict; let answer = null;
    const type = String(res.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (res.status !== 200) verdict = { verdict: 'FAIL', text: `HTTP ${res.status}${res.status === 403 ? ' (the worker credential may lack the decision permission)' : res.status === 404 ? ' (is AAG_AUTHORIZE_ENDPOINT_ID the decision endpoint id?)' : ''}`, specific: [], ignored: [] };
    else if (!(type === 'application/json' || type.endsWith('+json'))) verdict = { verdict: 'FAIL', text: `the answer is not JSON (content type ${clip(type || 'none', 60)})`, specific: [], ignored: [] };
    else {
      try { answer = JSON.parse(text); } catch { answer = null; }
      verdict = answer === null ? { verdict: 'FAIL', text: 'the answer is not JSON', specific: [], ignored: [] } : judge(c, answer);
    }
    tally[verdict.verdict] += 1;
    log(`${label} ${verdict.verdict.padEnd(4)} ${verdict.text}${note}${verdict.ignored.length ? `  [ignored: ${verdict.ignored.join(', ')}]` : ''}`);
    // The first narrowing row's statements, once: what the payload really is (type and keys only, never values).
    if (!shownStatements && c.id === 'P02' && answer && Array.isArray(answer.statements)) {
      shownStatements = true;
      for (const s of answer.statements) {
        if (!s || typeof s !== 'object') continue;
        const keys = Object.keys(s).filter((k) => k !== 'code' && k !== 'name').map((k) => clip(k, 40));
        const p = s.payload;
        const payload = p === undefined ? 'no payload field' : `payload ${p === null ? 'null' : Array.isArray(p) ? 'array' : typeof p}${p && typeof p === 'object' && !Array.isArray(p) ? ` keys [${Object.keys(p).map((k) => clip(k, 40)).join(', ')}]` : ''}`;
        log(`        statement code=${clip(s.code, 60)} name=${clip(s.name ?? '(none)', 60)} other keys [${keys.join(', ')}] ${payload}`);
      }
    }
    if (opts.record) {
      const rec = { case: c.id, name: c.name, request: buildRequest(c), httpStatus: res.status, contentType: type || null, answer: answer ?? { text: clip(text, 400) }, verdict: verdict.verdict, detail: verdict.text };
      fs.writeFileSync(path.join(opts.record, `${String(i + 1).padStart(2, '0')}-${c.id}.json`), `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
    }
  }
  log(`${tally.PASS} PASS, ${tally.FAIL} FAIL, ${tally.NOTE} NOTE of ${CASES.length}${opts.record ? `; raw answers written to ${opts.record}` : ''}`);
  if (tally.FAIL) log('At least one row FAILED: do not rely on the lab\'s Authorize path until the policy or the settings are fixed.');
  return tally.FAIL ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`refusing: ${e.message}`); process.exit(2); }
  if (opts.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  run(opts).then((code) => { process.exit(code); }).catch(() => { console.error('failed: unexpected error'); process.exit(3); });
}
