import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DIAGRAM_NAMES, buildDiagram, loadDiagram, rawDiagram } from '../src/diagramData.js';
import { validateDiagram } from '../src/diagramStudioValidate.js';
import { VERTICALS, unfilled } from '../src/cast.js';
import { LABELS, EXTRA_TOKENS } from '../src/data.js';
import { get, withServer } from './helpers.js';

test('the diagrams are diagram-studio/1 data that passes the studio validator, and every {{token}} is defined by every full vertical pack', () => {
  assert.deepEqual(DIAGRAM_NAMES, ['delegation-chain', 'gateway-refusals']);
  for (const n of DIAGRAM_NAMES) {
    const d = loadDiagram(n);
    assert.deepEqual(validateDiagram(d), [], n); assert.equal(d.schema, 'diagram-studio/1'); assert.equal(d.id, n);
    for (const v of Object.values(VERTICALS)) assert.deepEqual(unfilled(JSON.stringify(d), v), [], n);
    for (const v of Object.keys(VERTICALS)) assert.ok(!JSON.stringify(buildDiagram(VERTICALS[v], n)).includes('{{'));
  }
});

test('the validator has teeth: a bad schema, a dangling edge and a bad step edge are each reported', () => {
  const d = structuredClone(rawDiagram('delegation-chain'));
  d.schema = 'x'; d.edges[0].target = 'ghost'; d.steps[0].edges = [99];
  const p = validateDiagram(d).join('\n');
  assert.match(p, /schema must be/); assert.match(p, /unknown target "ghost"/); assert.match(p, /valid edge numbers/);
});

test('every step names a hop kind the engine really emits, and each step walks one real edge', () => {
  for (const n of DIAGRAM_NAMES) {
    const d = buildDiagram(VERTICALS.banking, n);
    const ids = new Set(d.nodes.map((x) => x.id));
    for (const s of d.steps) {
      // A represented step (HIVE, never called) has no hop in any run; every other step names a hop kind the engine emits.
      if (s.dashed) assert.equal(s.hop, undefined, `${n}: a represented step has no hop`);
      else assert.ok(Object.hasOwn(LABELS, s.hop), `${n}: ${s.hop}`);
      assert.ok(ids.has(s.from) && ids.has(s.to));
    }
    assert.equal(new Set(d.nodes.map((x) => `${x.x},${x.y}`)).size, d.nodes.length, `${n}: no two nodes share a position`);
  }
  assert.ok(EXTRA_TOKENS.length > 0);
});

test('GET /api/diagram loads a diagram by name; an unknown name falls back to the first and is never echoed', async () => {
  await withServer(async (url) => {
    const j = await (await get(url, '/api/diagram?name=gateway-refusals&vertical=retail')).json();
    assert.equal(j.diagram.name, 'gateway-refusals'); assert.deepEqual(j.names, DIAGRAM_NAMES); assert.ok(j.diagram.nodes.some((n) => n.label.includes('Appfire Retail Suite')));
    const r = await get(url, '/api/diagram?name=__proto__%20zzz'); const t = await r.text();
    assert.equal(r.status, 200); assert.equal(JSON.parse(t).diagram.name, 'delegation-chain'); assert.ok(!t.includes('zzz'));
    assert.equal((await get(url, '/api/diagram?vertical=nope')).status, 400);
    assert.equal((await get(url, '/api/diagram?name[]=x')).status, 200);
  });
  assert.ok(fs.existsSync(new URL('../diagrams/delegation-chain.json', import.meta.url)));
});

test('HIVE is drawn in the delegation chain as a dashed, represented-not-called step beside the tool; no other diagram step is dashed', () => {
  const d = buildDiagram(VERTICALS.banking, 'delegation-chain');
  const hive = d.nodes.find((n) => n.id === 'hive');
  assert.ok(hive, 'a hive node');
  assert.equal(hive.kind, 'appfire');
  assert.match(hive.label, /not called/);
  const dashed = d.steps.filter((s) => s.dashed);
  assert.equal(dashed.length, 1);
  assert.deepEqual([dashed[0].from, dashed[0].to], ['hive', 'mcp']);
  assert.match(dashed[0].say, /never calls it/);
  assert.equal(d.steps.at(-1), dashed[0], 'the represented step comes last, after every step the engine runs');
  assert.equal(d.groups.appfire.label, 'Appfire (represented, not called)');
  assert.ok(!buildDiagram(VERTICALS.banking, 'gateway-refusals').steps.some((s) => s.dashed));
});
