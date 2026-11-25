// The run-observability half of the lab: a mock (engine) run becomes a six-layer record, and one stdout line per policy decision.
// The core (server/src/runObservability.js) is vendored and pinned; these tests only exercise the lab's own mapping and routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPin } from '../../scripts/run-observability-checkPin.mjs';
import { assertRunObservability, classify, LAYERS, OUTCOMES } from '../src/runObservability.js';
import { createRunRecords, decisionLine, layerOfHop, MATCHER_WORDS, DECISION_STEPS } from '../src/runRecord.js';
import { MANIFEST } from '../src/manifest.js';
import { loadCast } from '../src/cast.js';
import { runUseCase } from '../src/flow.js';
import { get, post, run, W, withServer } from './helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const silent = () => {};
const CAST_VERTICAL = 'software';

test('the vendored core and web panel are byte-pinned to shared/run-observability (checkPin finds no problem)', () => {
  assert.deepEqual(checkPin(root), []);
});

test('no RUN_OBS_ name lives in web/src or server/src outside the pinned vendored files: this lab reads no logs', () => {
  const pinned = new Set(['web/src/run-observability/RunObservability.jsx', 'web/src/run-observability/run-observability.css', 'web/src/run-observability/run-observability.test.jsx', 'web/src/run-observability/fixtures.js', 'server/src/runObservability.js']);
  const hits = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = `${dir}/${e.name}`; if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f); } else if (/\.(m?js|jsx)$/.test(e.name)) { const rel = path.relative(root, f); if (!pinned.has(rel) && fs.readFileSync(f, 'utf8').includes('RUN_OBS_')) hits.push(rel); } } };
  walk(path.join(root, 'web/src')); walk(path.join(root, 'server/src'));
  assert.deepEqual(hits, []);
});

test('every hop kind the engine produces, for all catalog use cases, maps to one of the six layers (none falls through to a guess)', () => {
  const kinds = new Set(); const unknown = new Set();
  const cast = loadCast(undefined, CAST_VERTICAL);
  for (const uc of MANIFEST.usecases) {
    const r = runUseCase(uc, { cast, vertical: CAST_VERTICAL, seed: 'run' });
    for (const h of r.hops || []) { kinds.add(h.kind); if (!layerOfHop(h).known) unknown.add(h.kind); }
  }
  assert.ok(kinds.size > 20, 'the engine produced its hop kinds');
  assert.deepEqual([...unknown].sort(), []);
});

test('a mock run is recorded with all six layers, source mock, every row simulated, and it passes the core assertion', async () => {
  await withServer(async (url) => {
    const r = await run(url, 'UC1', { vertical: CAST_VERTICAL }, W('ro-a'));
    assert.equal(r.status, 200);
    const id = r.body.observability?.runId;
    assert.match(id, /^run-[0-9a-z]+-[0-9a-f]{8}$/);
    const g = await get(url, `/api/run-observability/${id}`, W('ro-a'));
    assert.equal(g.status, 200); assert.equal(g.headers.get('cache-control'), 'no-store');
    const rec = await g.json();
    assert.equal(rec.source, 'mock'); assert.equal(rec.runId, id);
    assert.deepEqual(Object.keys(rec.coverage).sort(), [...LAYERS].sort());
    const shown = rec.rows.filter((row) => row.origin !== 'not-logged');
    assert.ok(shown.length > 0);
    assert.ok(shown.every((row) => row.origin === 'simulated' && OUTCOMES.includes(row.outcome)));
    assertRunObservability(rec);
  });
});

test('a stdout line is written for each policy decision only, and every line is null under the shared classify() (no matcher word, no second key=value)', async () => {
  const lines = [];
  const records = createRunRecords({ writer: (l) => lines.push(l), clock: () => 1_780_000_000_000, log: silent });
  const cast = loadCast(undefined, CAST_VERTICAL);
  for (const uc of MANIFEST.usecases.slice(0, 40)) {
    const r = runUseCase(uc, { cast, vertical: CAST_VERTICAL, seed: 'run' });
    await records.record('ws-lines', r, { uc });
  }
  assert.ok(lines.length > 0, 'some policy decisions were written');
  for (const l of lines) {
    assert.equal(classify(l), null, `classify() must not read a decision line: ${l}`);
    assert.equal(/\b(?:refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served)\b/i.test(l), false, l);
    assert.match(l, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z appfire-agent-governance decision step=(?:authorize-policy|gateway-policy|privilege-policy|lab-stop) actor=\S+ result=(?:passed|stopped) run=run-\S+$/);
  }
});

test('hostile values never add a key=value or a second line: each typed field is reduced to [A-Za-z0-9._:/@-]', () => {
  const line = decisionLine({ at: '2026-11-25T10:00:00.000Z', step: 'gateway-policy', actor: 'UC1 x=y\nscope=yes', result: 'passed', runId: 'run-1-00000001' });
  assert.equal(line.includes('\n'), false);
  assert.equal(line.split(' ').filter((p) => p.includes('=')).length, 4);
  assert.match(line, /actor=UC1_x_y_scope_yes /);
  assert.deepEqual(DECISION_STEPS.map((s) => s.step).sort(), ['authorize-policy', 'gateway-policy', 'lab-stop', 'privilege-policy']);
  assert.ok(MATCHER_WORDS.length >= 10);
});

test('a throwing writer drops one line, not the rest: the record and the run answer are the same as with a healthy writer', async () => {
  const healthy = []; const broken = []; const stderr = []; let n = 0;
  const cast = loadCast(undefined, CAST_VERTICAL);
  const uc = MANIFEST.usecases.find((u) => u.id === 'UC1');
  const good = createRunRecords({ writer: (l) => healthy.push(l), clock: () => 1_780_000_000_000, log: silent });
  const bad = createRunRecords({ writer: (l) => { n += 1; if (n === 1) throw Object.assign(new Error('secret-ish text'), { code: 'EPIPE' }); broken.push(l); }, clock: () => 1_780_000_000_000, log: (m) => stderr.push(m) });
  const a = await good.record('ws-w', runUseCase(uc, { cast, vertical: CAST_VERTICAL, seed: 'run' }), { uc });
  const b = await bad.record('ws-w', runUseCase(uc, { cast, vertical: CAST_VERTICAL, seed: 'run' }), { uc });
  assert.ok(healthy.length >= 2, 'the run has at least two decision lines (UC1 has two)');
  assert.equal(broken.length, healthy.length - 1);
  assert.equal(stderr.length, 1); assert.match(stderr[0], /EPIPE/); assert.doesNotMatch(stderr[0], /secret-ish/);
  assert.deepEqual(b.record.rows.map((r) => r.outcome), a.record.rows.map((r) => r.outcome));
  assert.ok(bad.get('ws-w', b.runId));
});

test('GET only: POST answers 405 with Allow GET; a bad run id is a 400 JSON; an unknown run is a 404 JSON; Live never answers a Mock record', async () => {
  await withServer(async (url) => {
    const p = await post(url, '/api/run-observability/run-x', {}, W('ro-b'));
    assert.equal(p.status, 405); assert.equal(p.headers.get('allow'), 'GET');
    const bad = await get(url, '/api/run-observability/..%2Fetc', W('ro-b'));
    assert.equal(bad.status, 400); assert.equal((await bad.json()).error, 'bad_run');
    const none = await get(url, '/api/run-observability/run-zz-00000000', W('ro-b'));
    assert.equal(none.status, 404); assert.equal((await none.json()).error, 'run_not_found');
  });
});

test('record ids are unique within a workspace after Reset, and Reset clears the records of that workspace', async () => {
  await withServer(async (url) => {
    const a = await run(url, 'UC1', { vertical: CAST_VERTICAL }, W('ro-c'));
    const id = a.body.observability.runId;
    await post(url, '/api/reset', {}, W('ro-c'));
    const gone = await get(url, `/api/run-observability/${id}`, W('ro-c'));
    assert.equal(gone.status, 404);
    const b = await run(url, 'UC1', { vertical: CAST_VERTICAL }, W('ro-c'));
    assert.notEqual(b.body.observability.runId, id);
  });
});

test('the per-workspace cap never evicts the newest record, and another workspace is not affected', async () => {
  const rs = createRunRecords({ max: 2, writer: silent, clock: () => 1_780_000_000_000, log: silent });
  const cast = loadCast(undefined, CAST_VERTICAL);
  const uc = MANIFEST.usecases[0];
  const ids = [];
  for (let i = 0; i < 3; i += 1) ids.push((await rs.record('ws-cap', runUseCase(uc, { cast, vertical: CAST_VERTICAL, seed: 'run' }), { uc })).runId);
  assert.equal(rs.get('ws-cap', ids[0]), null);
  assert.ok(rs.get('ws-cap', ids[2]));
  assert.equal(rs.get('ws-other', ids[2]), null);
});
