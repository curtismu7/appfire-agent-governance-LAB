// The owner-run PingOne Authorize probe (scripts/owner/authorize-probe.mjs). It talks only to a stub on loopback that this test starts: no tenant, no network.
// The stub is hand-written from section F of docs/design-authorize-lab.md; it is not the lab's own fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as probe from './owner/authorize-probe.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(root, 'scripts', 'owner', 'authorize-probe.mjs');
const ENV_ID = '11111111-2222-4333-8444-555555555555';
const EP_ID = 'abcdef12-3456-4789-8abc-def012345678';
const CLIENT = 'probe-test-client';
const SECRET = ['probe', '-test-', 'secret-', 'not-real-', '0123456789'].join('');
const TOKEN = ['probe', '-test-', 'bearer-', 'not-real-', '9876543210'].join('');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cal-probe-'));
const noSleep = async () => {};

// The correct answer to each of the 21 rows, from the section F table, with the foreign codes and the catch-all the live endpoint always adds.
const ANSWER = {
  P01: ['PERMIT', 'airline-permit-as-asked'], P02: ['PERMIT', 'airline-economy-intl'], P03: ['PERMIT', 'airline-economy-over-limit'], P04: ['PERMIT', 'airline-approval-required'],
  P05: ['PERMIT', 'airline-permit-as-asked'], P06: ['PERMIT', 'airline-economy-over-limit'], P07: ['PERMIT', 'airline-economy-over-limit'], P08: ['PERMIT', 'airline-approval-required'],
  P09: ['PERMIT', 'airline-economy-intl-over-limit'], P10: ['PERMIT', 'airline-permit-as-asked'], P11: ['PERMIT', 'airline-approval-required'], P12: ['PERMIT', 'airline-approved-as-asked'],
  P13: ['PERMIT', 'airline-economy-intl'], L01: ['PERMIT', 'airline-economy-intl'], L02: ['PERMIT', 'airline-permit-as-asked'],
};
// What a row is, from the seven parameters alone (so a stub test also proves the probe sends the right parameters for each row).
function rowOf(p) {
  const key = `${p.AirFare}|${p.AirIsInternational}|${p.AirCabinAsked}|${p.AirApproval}|${p.UserId}|${p.AirLabMarker}|${p.ToolName}`;
  const table = {
    '380|false|business|none|lab-probe-subject|larkspur-air|book_airline_flight': 'P01', '380|true|business|none|lab-probe-subject|larkspur-air|book_airline_flight': 'P02',
    '780|false|business|none|lab-probe-subject|larkspur-air|book_airline_flight': 'P03', '2400|true|business|none|lab-probe-subject|larkspur-air|book_airline_flight': 'P04',
    '400|false|business|none|lab-probe-subject|larkspur-air|book_airline_flight': 'P05', '401|false|business|none|lab-probe-subject|larkspur-air|book_airline_flight': 'P06',
    '1500|false|business|none|lab-probe-subject|larkspur-air|book_airline_flight': 'P07', '1501|false|business|none|lab-probe-subject|larkspur-air|book_airline_flight': 'P08',
    '1100|true|business|none|lab-probe-subject|larkspur-air|book_airline_flight': 'P09', '380|true|economy|none|lab-probe-subject|larkspur-air|book_airline_flight': 'P10',
    '1501|false|economy|none|lab-probe-subject|larkspur-air|book_airline_flight': 'P11', '2400|true|business|verified|lab-probe-subject|larkspur-air|book_airline_flight': 'P12',
    '380|true|business|verified|lab-probe-subject|larkspur-air|book_airline_flight': 'P13', '380|True|business|none|lab-probe-subject|larkspur-air|book_airline_flight': 'L01',
    '380|maybe|business|none|lab-probe-subject|larkspur-air|book_airline_flight': 'L02',
  };
  return table[key] || null;
}
const foreign = [{ code: 'transaction-approved', name: 'other demo' }, { code: 'HITL_CONSENT', name: 'other demo' }];
const okAnswer = (params) => {
  const r = rowOf(params);
  if (r) { const [decision, code] = ANSWER[r]; return { decision, statements: [{ code, name: 'Larkspur Air Booking', payload: '{"outcome":"x"}' }, { code: 'airline-unmatched', name: 'catch-all' }, ...foreign], status: { code: 'OKAY' } }; }
  return { decision: 'PERMIT', statements: [...foreign, { code: 'airline-unmatched', name: 'catch-all' }], status: { code: 'OKAY' } }; // every negative row: no specific code
};

// A loopback stub of the token and decision endpoints. `answer(params, n)` returns { status, body, type } or null for the default; everything received is kept.
async function stub({ answer = null, tokenStatus = 200 } = {}) {
  const seen = { token: [], decision: [], other: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (req.method === 'POST' && req.url === `/${ENV_ID}/as/token`) {
        seen.token.push({ headers: req.headers, body });
        const ok = req.headers.authorization === `Basic ${Buffer.from(`${CLIENT}:${SECRET}`).toString('base64')}` && body === 'grant_type=client_credentials';
        if (!ok || tokenStatus !== 200) { res.writeHead(ok ? tokenStatus : 401, { 'content-type': 'application/json' }); res.end('{"error":"invalid_client"}'); return; }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ access_token: TOKEN, token_type: 'Bearer', expires_in: 3600 })); return;
      }
      if (req.method === 'POST' && req.url === `/v1/environments/${ENV_ID}/decisionEndpoints/${EP_ID}`) {
        const parsed = JSON.parse(body);
        seen.decision.push({ headers: req.headers, body: parsed });
        if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); res.end(); return; }
        const a = (answer && answer(parsed.parameters, seen.decision.length)) || { status: 200, body: okAnswer(parsed.parameters), type: 'application/json' };
        res.writeHead(a.status, { 'content-type': a.type || 'application/json' }); res.end(typeof a.body === 'string' ? a.body : JSON.stringify(a.body)); return;
      }
      seen.other.push(`${req.method} ${req.url}`);
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}/${ENV_ID}`;
  return { seen, base, close: () => new Promise((r) => { server.close(r); }) };
}
const envFile = (dir, extra = {}, omit = []) => {
  const vals = { PINGONE_ENVIRONMENT_ID: ENV_ID, PINGONE_REGION: 'com', AAG_AUTHORIZE_ENDPOINT_ID: EP_ID, AAG_AUTHORIZE_CLIENT_ID: CLIENT, AAG_AUTHORIZE_CLIENT_SECRET: SECRET, ...extra };
  for (const k of omit) delete vals[k];
  const f = path.join(dir, '.env');
  fs.writeFileSync(f, `${Object.entries(vals).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
  return f;
};
const drive = async (s, { run = true, record = null, extra = {}, omit = [] } = {}) => {
  const dir = tmp();
  const lines = []; const sleeps = [];
  const code = await probe.run({ run, envFile: envFile(dir, { AAG_LIVE_TEST_BASE: s?.base || 'http://127.0.0.1:1', ...extra }, omit), record }, { log: (l) => lines.push(String(l)), sleep: async (ms) => { sleeps.push(ms); } });
  return { code, out: lines.join('\n'), lines, sleeps, dir };
};
const SENTINELS = [SECRET, TOKEN, EP_ID, ENV_ID, Buffer.from(`${CLIENT}:${SECRET}`).toString('base64')];

test('the 21 rows are the section F table: 13 positive, 6 negative, 2 leniency, and each sends exactly the seven parameters', () => {
  assert.equal(probe.CASES.length, 21);
  assert.deepEqual(probe.CASES.map((c) => c.kind), [...Array(13).fill('positive'), ...Array(6).fill('negative'), 'lenient', 'lenient']);
  assert.deepEqual(probe.CASES.map((c) => c.id), ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'N01', 'N02', 'N03', 'N04', 'N05', 'N06', 'L01', 'L02']);
  for (const c of probe.CASES) {
    const b = probe.buildRequest(c);
    assert.deepEqual(Object.keys(b), ['parameters']);
    assert.deepEqual(Object.keys(b.parameters), probe.PARAM_NAMES, c.id);
    assert.ok(Object.values(b.parameters).every((v) => typeof v === 'string'), c.id);
    assert.ok(!/Amount|DecisionContext|ActClientId/.test(JSON.stringify(b)), c.id);
  }
  const byId = Object.fromEntries(probe.CASES.map((c) => [c.id, c]));
  assert.equal(byId.P09.expect, 'airline-economy-intl-over-limit');
  assert.equal(byId.N02.params.UserId, '');
  assert.equal(byId.N03.params.AirLabMarker, 'other');
  assert.equal(byId.N04.params.AirCabinAsked, 'first');
  assert.equal(byId.N05.params.AirApproval, 'maybe');
  assert.equal(byId.N06.params.ToolName, 'other_tool');
  assert.equal(byId.L01.params.AirIsInternational, 'True');
  assert.equal(byId.L02.params.AirIsInternational, 'maybe');
});

test('the dry run prints the plan and sends nothing at all', async () => {
  const s = await stub();
  try {
    const r = await drive(s, { run: false });
    assert.equal(r.code, 0);
    assert.match(r.out, /Dry run: nothing was sent/);
    assert.match(r.out, /P01 /); assert.match(r.out, /L02 /);
    assert.deepEqual([s.seen.token.length, s.seen.decision.length, s.seen.other.length], [0, 0, 0]);
    for (const x of SENTINELS) assert.ok(!r.out.includes(x), 'the plan shows no secret, token or id');
  } finally { await s.close(); }
});

test('--run against a stub that answers every row correctly: 21 PASS, exit 0, one token, paced 1.2 s, only the seven parameters sent', async () => {
  const s = await stub();
  try {
    const r = await drive(s);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.lines.filter((l) => /\bPASS\b/.test(l) && /^\s*\d+\s+[PNL]\d\d/.test(l)).length, 21, r.out);
    assert.match(r.out, /21 PASS, 0 FAIL, 0 NOTE of 21/);
    assert.equal(s.seen.token.length, 1, 'one token for the whole run');
    assert.equal(s.seen.decision.length, 21);
    assert.deepEqual(r.sleeps.filter((ms) => ms === probe.PACE_MS).length, 20, 'a pause of 1.2 s between rows');
    for (const d of s.seen.decision) {
      assert.deepEqual(Object.keys(d.body), ['parameters']);
      assert.deepEqual(Object.keys(d.body.parameters), probe.PARAM_NAMES);
      assert.ok(Object.values(d.body.parameters).every((v) => typeof v === 'string'));
      assert.ok(!/Amount|DecisionContext|ActClientId/.test(JSON.stringify(d.body)));
      assert.equal(d.headers.authorization, `Bearer ${TOKEN}`);
      assert.equal(d.headers['content-type'], 'application/json');
    }
    assert.deepEqual(s.seen.other, [], 'no request to any path but the token and the decision path');
    // the foreign codes the endpoint always adds are shown as ignored, never judged
    assert.match(r.out, /ignored: transaction-approved/);
    // the first narrowing row's statements are printed once: code, name, payload type
    assert.equal((r.out.match(/statement code=airline-economy-intl /g) || []).length, 1);
    assert.match(r.out, /payload string/);
  } finally { await s.close(); }
});

test('the output never holds the secret, the token, the client credential or a full id', async () => {
  const s = await stub();
  const rec = path.join(tmp(), 'rec');
  try {
    const r = await drive(s, { record: rec });
    assert.equal(r.code, 0);
    const all = [r.out, ...fs.readdirSync(rec).map((f) => fs.readFileSync(path.join(rec, f), 'utf8'))].join('\n');
    for (const x of SENTINELS) assert.ok(!all.includes(x), `a sentinel leaked: ${x.slice(0, 6)}`);
    assert.ok(!r.out.includes(CLIENT), 'the client id is not printed');
    assert.match(r.out, /<endpoint id>/);
  } finally { await s.close(); }
});

test('--record writes one JSON file per row, mode 600, and refuses a directory inside a git repository', async () => {
  const s = await stub();
  try {
    const rec = path.join(tmp(), 'out');
    const ok = await drive(s, { record: rec });
    assert.equal(ok.code, 0);
    const files = fs.readdirSync(rec).sort();
    assert.equal(files.length, 21);
    assert.equal(files[0], '01-P01.json');
    const j = JSON.parse(fs.readFileSync(path.join(rec, files[1]), 'utf8'));
    assert.equal(j.case, 'P02'); assert.equal(j.verdict, 'PASS'); assert.deepEqual(Object.keys(j.request.parameters), probe.PARAM_NAMES);
    assert.equal(fs.statSync(path.join(rec, files[0])).mode & 0o777, 0o600);

    const before = s.seen.decision.length;
    const inRepo = path.join(root, '.data', 'probe-record-test'); // this repository: a directory inside it
    const bad = await drive(s, { record: inRepo });
    assert.equal(bad.code, 2);
    assert.match(bad.out, /OUTSIDE any git repository/);
    assert.equal(s.seen.decision.length, before, 'nothing was sent');
    assert.ok(!fs.existsSync(inRepo), 'nothing was created');
    const fakeRepo = tmp(); fs.mkdirSync(path.join(fakeRepo, '.git'));
    assert.equal((await drive(s, { record: path.join(fakeRepo, 'sub', 'deeper') })).code, 2);
    assert.equal(probe.insideGitRepo(os.tmpdir()), false);
  } finally { await s.close(); }
});

test('each failure class is reported and exits 1', async () => {
  const cases = {
    'a wrong code': { rows: { P01: ['PERMIT', 'airline-economy-intl'] }, want: /WRONG CODE: expected airline-permit-as-asked, got airline-economy-intl/ },
    'a specific code on a negative row': { rows: { N03: ['PERMIT', 'airline-permit-as-asked'] }, want: /UNEXPECTED CODE on a negative row: airline-permit-as-asked/ },
    'INDETERMINATE on a positive row': { rows: { P02: ['INDETERMINATE', null] }, want: /INDETERMINATE: PingOne Authorize could not evaluate/ },
    'a wrong decision': { rows: { P04: ['DENY', 'airline-approval-required'] }, want: /WRONG DECISION/ },
    'no airline code on a positive row': { rows: { P05: ['PERMIT', null] }, want: /NO AIRLINE CODE/ },
    'an unknown airline code': { rows: { P03: ['PERMIT', 'airline-cabin-first'] }, want: /UNRECOGNISED airline code/ },
  };
  for (const [name, { rows, want }] of Object.entries(cases)) {
    const answer = (params) => {
      const id = probe.CASES.find((c) => JSON.stringify(probe.buildRequest(c).parameters) === JSON.stringify(params))?.id;
      if (!rows[id]) return null;
      const [decision, code] = rows[id];
      return { status: 200, type: 'application/json', body: { decision, statements: code ? [{ code, name: 'x' }] : [] } };
    };
    const s = await stub({ answer });
    try {
      const r = await drive(s);
      assert.equal(r.code, 1, `${name}: ${r.out}`);
      assert.match(r.out, want, name);
      assert.match(r.out, /1 FAIL/, name);
    } finally { await s.close(); }
  }
  // two specific codes in one answer
  const two = await stub({ answer: (p) => (rowOf(p) === 'P01' ? { status: 200, type: 'application/json', body: { decision: 'PERMIT', statements: [{ code: 'airline-permit-as-asked' }, { code: 'airline-economy-intl' }] } } : null) });
  try { const r = await drive(two); assert.equal(r.code, 1); assert.match(r.out, /TWO SPECIFIC CODES/); } finally { await two.close(); }
  // HTTP 500, a non-JSON body and a wrong content type fail the row without stopping the probe
  for (const [a, want] of [[{ status: 500, body: '{}' }, /HTTP 500/], [{ status: 200, type: 'text/html', body: '<p>x</p>' }, /not JSON \(content type text\/html\)/], [{ status: 200, type: 'application/json', body: 'not json' }, /not JSON/]]) {
    const s = await stub({ answer: (p, n) => (n === 1 ? a : null) });
    try { const r = await drive(s); assert.equal(r.code, 1); assert.match(r.out, want); assert.equal(s.seen.decision.length, 21, 'the other rows still ran'); } finally { await s.close(); }
  }
});

test('the negative rows: INDETERMINATE passes only N01 (and says so); N06 is a NOTE, never a FAIL', async () => {
  const answer = (p) => {
    const bad = probe.CASES.find((c) => JSON.stringify(probe.buildRequest(c).parameters) === JSON.stringify(p));
    if (bad?.id === 'N01') return { status: 200, type: 'application/json', body: { decision: 'INDETERMINATE', statements: [] } };
    if (bad?.id === 'N06') return { status: 200, type: 'application/json', body: { decision: 'PERMIT', statements: [{ code: 'airline-permit-as-asked' }] } };
    return null;
  };
  const s = await stub({ answer });
  try {
    const r = await drive(s);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /N01 .*PASS \(INDETERMINATE, a no decision\)/);
    assert.match(r.out, /N06 .*NOTE/);
    assert.match(r.out, /20 PASS, 0 FAIL, 1 NOTE of 21/);
  } finally { await s.close(); }
  const s2 = await stub({ answer: (p) => (probe.CASES.find((c) => JSON.stringify(probe.buildRequest(c).parameters) === JSON.stringify(p))?.id === 'N02' ? { status: 200, type: 'application/json', body: { decision: 'INDETERMINATE', statements: [] } } : null) });
  try { const r = await drive(s2); assert.equal(r.code, 1); assert.match(r.out, /N02 .*FAIL.*INDETERMINATE/); } finally { await s2.close(); }
});

test('a 429 is retried once after 1.5 s and never recorded as an answer; one that survives exits 3', async () => {
  const s = await stub({ answer: (p, n) => (n <= 1 ? { status: 429, body: '{}' } : null) });
  try {
    const r = await drive(s);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /P01 .*PASS.*\(429 retried 1x\)/);
    assert.ok(r.sleeps.includes(1500) && !r.sleeps.includes(3000));
    assert.ok(!/ 429/.test(r.lines.filter((l) => / P01 /.test(l)).join('')) || /retried/.test(r.out));
  } finally { await s.close(); }
  const always = await stub({ answer: () => ({ status: 429, body: '{}' }) });
  try {
    const r = await drive(always);
    assert.equal(r.code, 3);
    assert.match(r.out, /kept answering 429/);
    assert.equal(always.seen.decision.length, 1 + probe.RETRY_429, 'the first post and one retry, then it stops');
    assert.ok(!/ PASS /.test(r.out.split('\n').filter((l) => /^\s*\d+\s+P01/.test(l)).join('')));
  } finally { await always.close(); }
});

test('an unreachable endpoint exits 3; a refused worker credential exits 3 and says so without printing it', async () => {
  const dead = await stub(); const base = dead.base; await dead.close();
  const r = await drive({ base });
  assert.equal(r.code, 3);
  assert.match(r.out, /could not be reached/);
  const refused = await stub({ tokenStatus: 401 });
  try {
    const x = await drive(refused);
    assert.equal(x.code, 3);
    assert.match(x.out, /refused the worker credential \(HTTP 401\)/);
    assert.equal(refused.seen.decision.length, 0);
    for (const v of SENTINELS) assert.ok(!x.out.includes(v));
  } finally { await refused.close(); }
});

test('one 401 on a decision refreshes the token once; a second 401 fails the row', async () => {
  let n401 = 0;
  const flaky = await stub({ answer: () => (n401++ === 0 ? { status: 401, body: '{}' } : null) });
  try {
    const r = await drive(flaky);
    assert.equal(r.code, 0, r.out);
    assert.equal(flaky.seen.token.length, 2, 'one new token after the 401, no more');
    assert.equal(flaky.seen.decision.length, 22, 'the refused post, then the repeat, then the other 20 rows');
  } finally { await flaky.close(); }
  let calls = 0;
  const stubborn = await stub({ answer: () => (calls++ < 2 ? { status: 401, body: '{}' } : null) });
  try {
    const r = await drive(stubborn);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /P01 .*FAIL.*HTTP 401/);
    assert.equal(stubborn.seen.token.length, 2, 'only ONE refresh');
  } finally { await stubborn.close(); }
});

test('a missing setting exits 2 and names it, and nothing is sent', async () => {
  const s = await stub();
  try {
    for (const name of probe.SETTING_NAMES) {
      const r = await drive(s, { omit: [name] });
      assert.equal(r.code, 2, name);
      assert.ok(r.out.includes(name), `names ${name}`);
      for (const other of probe.SETTING_NAMES.filter((k) => k !== name)) assert.ok(!r.out.includes(other), `${name}: names only the missing one`);
    }
    const ph = await drive(s, { extra: { AAG_AUTHORIZE_CLIENT_SECRET: 'replace-me' } });
    assert.equal(ph.code, 2); assert.ok(ph.out.includes('AAG_AUTHORIZE_CLIENT_SECRET'));
    assert.equal((await drive(s, { extra: { PINGONE_REGION: 'mars' } })).code, 2);
    assert.equal((await drive(s, { extra: { AAG_AUTHORIZE_ENDPOINT_ID: 'not-an-id' } })).code, 2);
    assert.equal((await drive(s, { extra: { AAG_LIVE_TEST_BASE: 'https://example.invalid' } })).code, 2);
    assert.equal(s.seen.token.length + s.seen.decision.length, 0);
  } finally { await s.close(); }
  const dir = tmp();
  const cli = spawnSync(process.execPath, [SCRIPT, '--env-file', envFile(dir, {}, ['AAG_AUTHORIZE_ENDPOINT_ID', 'AAG_AUTHORIZE_CLIENT_SECRET'])], { encoding: 'utf8' });
  assert.equal(cli.status, 2);
  assert.ok(cli.stdout.includes('AAG_AUTHORIZE_ENDPOINT_ID') && cli.stdout.includes('AAG_AUTHORIZE_CLIENT_SECRET'));
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--record', tmp()], { encoding: 'utf8' }).status, 2, '--record without --run is refused');
});

test('the CLI dry run prints the plan from a settings file and exits 0 with nothing sent', async () => {
  const s = await stub();
  try {
    const dir = tmp();
    const f = envFile(dir, { AAG_LIVE_TEST_BASE: s.base });
    const cli = spawnSync(process.execPath, [SCRIPT, '--env-file', f], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.match(cli.stdout, /Dry run/);
    assert.equal(s.seen.token.length + s.seen.decision.length, 0);
    for (const x of SENTINELS) assert.ok(!cli.stdout.includes(x) && !cli.stderr.includes(x));
    const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0); assert.match(help.stdout, /--run/);
  } finally { await s.close(); }
});

test('the judge reads a code in the wrong case or with a trailing space as not ours, and a lenient row by the code the engine reads', () => {
  const c = probe.CASES[0];
  assert.equal(probe.judge(c, { decision: 'PERMIT', statements: [{ code: 'Airline-permit-as-asked' }] }).verdict, 'FAIL');
  assert.equal(probe.judge(c, { decision: 'PERMIT', statements: [{ code: 'airline-permit-as-asked ' }] }).verdict, 'FAIL');
  assert.equal(probe.judge(c, { decision: 'permit', statements: [{ code: 'airline-permit-as-asked' }] }).verdict, 'FAIL');
  assert.equal(probe.judge(c, { decision: 'PERMIT', statements: 'x' }).verdict, 'FAIL');
  assert.equal(probe.judge(c, null).verdict, 'FAIL');
  assert.equal(probe.judge(c, { decision: 'PERMIT', statements: [{ code: 'airline-permit-as-asked' }, { code: 'airline-permit-as-asked' }, { code: 'airline-unmatched' }] }).verdict, 'PASS');
  assert.equal(probe.judge(c, { decision: 'PERMIT', statements: [{ code: 'airline-permit-as-asked' }] }).verdict, 'PASS', 'the same with no catch-all (the older policy build)');
});

test('the source: settings come only through readSettings, no header or secret is logged, and only the token and decision paths are posted to', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(!/process\.env/.test(src), 'no environment variable is read');
  assert.ok(/readSettings\(opts\.envFile\)/.test(src));
  for (const line of src.split('\n').filter((l) => /\blog\(/.test(l))) assert.ok(!/authorization|headers|clientSecret|\bBearer \$\{|access_token/i.test(line.replace('Authorization: Bearer (worker token, not shown)', '')), `a log call touches a credential: ${line.trim().slice(0, 80)}`);
  const posts = src.match(/fetchImpl\(([^,]+),/g) || [];
  assert.deepEqual(posts.map((p) => p.replace(/fetchImpl\(|,/g, '')).sort(), ['t.decisionUrl', 't.tokenUrl']);
  assert.ok(!/console\.log/.test(src.replace(/log = console\.log/, '').replace(/console\.log\(fs\.readFileSync[^\n]*/, '')), 'output goes through the injected log');
  assert.ok(!/(DELETE|PUT|PATCH)/.test(src.replace(/NOT PROBED[^\n]*/, '')), 'it never writes to a policy, an application or a user');
});
