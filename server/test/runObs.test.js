// Rule 27: the lab's half of the run-observability panel (runObs.js, the run field on POST /run/:id and GET /run-record).
// The vendored collector has its own tests in the shared folder. The owner granted this lab the wording exception
// (mock/real/simulated allowed in its rows), but a stdout line still passes the sanitiser and no shared matcher reads one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRunObservability, classify, layerMatchers } from '../src/runObservability.js';
import { KEEP_RUNS, SERVICE, createRunLog, decisionLine, lineValue, runEvents, recordOf } from '../src/runObs.js';
import { createApp } from '../src/app.js';
import { createWorkspaces } from '../src/workspaces.js';

const WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served|unauthori[sz]ed|insufficient|not allowed/i;
const LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z appfire-agent-governance-lab decision step=[A-Za-z0-9._:/@-]+ layer=[a-z]+ actor=[A-Za-z0-9._:/@-]+ result=(?:passed|stopped|unclear) run=[A-Za-z0-9._:/@-]+$/;
const PRODUCTS = [...new Set(layerMatchers.map((m) => m.product))];
// No shared matcher reads a line, in any of the shapes a collector could hand it (the whole line: no field is cut out first).
const noMatcherReads = (line) => {
  const at = line.split(' ')[0];
  for (const product of PRODUCTS) {
    for (const message of [line, `[${at}] INFO: ${line.split(' ').slice(1).join(' ')}`, `[${at}] WARN: ${line.split(' ').slice(1).join(' ')}`]) {
      assert.equal(classify({ product, message, at: Date.parse(at), atExact: at }, []), null, `${product}: ${message}`);
    }
  }
};

// A minimal flow run shaped like runUseCase's output (hops with from/to/verdict, tokens with signed views).
const TOK = (label, claims) => ({ label, mock: true, notice: 'Shown raw for teaching.', raw: 'x.y.z', header: {}, claims });
const HOP = (kind, from, to, verdict = 'ok', label = kind, extra = {}) => ({ n: 1, kind, label, from, to, mock: true, verdict, request: { method: 'POST', url: `https://x.example/${kind}` }, response: { status: 200, headers: {}, body: {} }, ...extra });

const RUN = {
  schema: 'appfire-agent-governance-run/1', mode: 'mock', kind: 'flow', computed: true,
  useCase: { id: 'UC22', track: 'govern', title: 'a held write', maturity: 'shipped' },
  vertical: 'airline', persona: 'standard', outcome: 'HITL_REQUIRED', matchesExpected: true,
  hops: [
    HOP('sign-in', 'browser', 'idp', 'ok', 'Sign in'),
    HOP('llm-plan', 'agent', 'llm', 'ok', 'The agent plans'),
    HOP('authorize-decision', 'bff', 'authorize', 'obligation', 'Authorize decides', { detail: { decision: { outcome: 'HITL_REQUIRED', by: 'authorize policy', reasons: ['a write over the band'] } }, response: { status: 202, headers: {}, body: { decision: 'HITL_REQUIRED' } } }),
    HOP('step-up', 'authorize', 'hitl', 'held', 'Step up'),
    HOP('tool-held', 'gateway', 'mcp', 'held', 'Held at the gateway'),
  ],
  tokens: [TOK('user token', { sub: 'user-7', scope: 'tools:read' }), TOK('exchanged token', { sub: 'user-7', act: { sub: 'agent-1' }, scope: 'tools:write' })],
  traceId: 't-1', traceparent: '00-t-1-1-01', narration: 'n',
};

test('runEvents: the hops map to the six layers; the Authorize decision is a policy row; a held call is information', async () => {
  const events = runEvents(RUN);
  const layers = events.map((e) => [e.layer, e.outcome]);
  assert.deepEqual(layers, [
    ['person', 'allowed'],      // sign-in
    ['agent', 'allowed'],       // llm plan
    ['authorize', 'info'],      // decision: obligation = a pause, not a verdict
    ['gateway', 'info'],        // step-up: the hold is the gateway's view of the obligation
    ['resource', 'info'],       // tool-held
  ]);
  const dec = events[2];
  assert.equal(dec.step, 'pdp-decision');
  assert.equal(dec.detail.verdict, 'obligation');
  assert.equal(dec.detail.policy.decision, 'obligation');
  // The chain: user, agent, scopes, policy — from the tokens the run itself minted.
  assert.equal(dec.detail.user, 'user-7');
  assert.equal(dec.detail.agent, 'agent-1');
  assert.deepEqual(dec.detail.scopes, ['tools:write']);
  const at = new Date().toISOString();
  const rec = await recordOf({ id: 'run-abc123-1', source: 'mock', startedAt: at, endedAt: at, events: events.map((e, seq) => ({ ...e, at, seq })), notes: [], partial: false });
  assert.deepEqual(await assertRunObservability(rec), []);
  assert.equal(rec.chain.chains[0].user.value, 'user-7');
  assert.equal(rec.chain.chains[0].agent.value, 'agent-1');
  assert.deepEqual(rec.chain.chains[0].scopes.values, ['tools:write']);
  assert.equal(rec.chain.chains[0].policies[0].decision, 'obligation');
});

test('a PERMIT run: the decision row is allowed; a DENY run is refused; every line is sanitised and matcher-free', async () => {
  const permit = runEvents({ ...RUN, hops: [...RUN.hops.slice(0, 2), HOP('authorize-decision', 'bff', 'authorize', 'ok', 'Authorize decides', { detail: { decision: { outcome: 'PERMIT', by: 'authorize policy', reasons: [] } }, response: { status: 200, headers: {}, body: { decision: 'PERMIT' } } }), HOP('tool-dispatched', 'gateway', 'mcp', 'ok', 'Tool runs'), HOP('api-call', 'mcp', 'api', 'ok', 'API call')] });
  assert.equal(permit[2].outcome, 'allowed');
  assert.equal(permit[3].layer, 'resource');
  const deny = runEvents({ ...RUN, hops: [...RUN.hops.slice(0, 2), HOP('authorize-decision', 'bff', 'authorize', 'deny', 'Authorize decides', { detail: { decision: { outcome: 'DENY_403', by: 'authorize policy', reasons: ['group'] } }, response: { status: 403, headers: {}, body: { decision: 'DENY' } } })] });
  assert.equal(deny[2].outcome, 'refused');
  const at = '2026-11-25T10:00:00.000Z';
  for (const ev of [...permit, ...deny]) noMatcherReads(decisionLine({ ...ev, at }, 'run-abc123-1'));
  const line = decisionLine({ ...permit[2], at, who: 'agent-1 x=1\ninjected' }, 'run\nx=1');
  assert.equal(line.split('\n').length, 1);
  assert.match(line, LINE);
});

test('a guided run (one hop, no policy) records information and builds no policy node', async () => {
  const events = runEvents({ ...RUN, kind: 'guided', computed: false, hops: [HOP('guided', 'browser', 'page', 'ok', 'Open the page')] });
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'info');
  assert.equal(events[0].detail.policy, undefined);
  const at = new Date().toISOString();
  const rec = await recordOf({ id: 'run-abc123-2', source: 'mock', startedAt: at, endedAt: at, events: events.map((e, seq) => ({ ...e, at, seq })), notes: [], partial: false });
  assert.deepEqual(await assertRunObservability(rec), []);
  assert.equal(rec.chain.chains[0].policies.length, 0, 'a guided run names no policy decision');
  // A run whose tokens name nobody builds no chain at all.
  const bare = await recordOf({ id: 'run-abc123-3', source: 'mock', startedAt: at, endedAt: at, events: runEvents({ ...RUN, kind: 'guided', hops: [HOP('guided', 'browser', 'page')], tokens: [] }).map((e, seq) => ({ ...e, at, seq })), notes: [], partial: false });
  assert.equal(bare.chain, null, 'no token, no chain');
});

test('the log keeps the last few runs and Reset clears it', () => {
  const lines = [];
  const runLog = createRunLog({ write: (l) => lines.push(l), clock: () => Date.parse('2026-11-25T10:00:00.000Z') });
  for (let i = 0; i < KEEP_RUNS + 3; i += 1) runLog.mock(() => runEvents(RUN));
  assert.equal(runLog.size(), KEEP_RUNS);
  assert.equal(runLog.get('run-nope-1'), null);
  runLog.clear();
  assert.equal(runLog.size(), 0);
});

test('a throwing writer drops its own line only, and the run stays reachable', () => {
  let n = 0;
  const runLog = createRunLog({ write: () => { n += 1; if (n === 2) throw new Error('ENOSPC'); } });
  const id = runLog.mock(() => runEvents(RUN));
  assert.ok(id);
  assert.ok(runLog.get(id));
});

test('over the API: a run answers its run id, /run-record answers that record, Reset clears', async () => {
  const { createServer } = await import('node:http');
  const app = createApp({ workspaces: createWorkspaces(), env: { ALLOW_MOCK_SIGNIN: '1' }, openingMode: 'mock' });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = async (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const run = await post('/api/run/UC1', { vertical: 'airline' });
    assert.equal(run.status, 200, JSON.stringify(run.body).slice(0, 200));
    assert.ok(run.body.obs?.id, 'a run id answers a run');
    const rec = await fetch(`${base}/api/run-record?runId=${encodeURIComponent(run.body.obs.id)}`).then(async (r) => ({ status: r.status, body: await r.json() }));
    assert.equal(rec.status, 200);
    assert.deepEqual(await assertRunObservability(rec.body.record), []);
    const stamped = rec.body.record.rows.filter((r) => r.origin !== 'not-logged');
    assert.ok(stamped.length > 0, 'the record has rows');
    assert.equal((await fetch(`${base}/api/run-record?runId=nope`)).status, 400);
    const reset = await post('/api/reset', {});
    assert.equal(reset.status, 200);
    const after = await fetch(`${base}/api/run-record?runId=${encodeURIComponent(run.body.obs.id)}`).then(async (r) => r.json());
    assert.equal(after.record, null, 'Reset clears the records');
  } finally { await new Promise((r) => server.close(r)); }
});
