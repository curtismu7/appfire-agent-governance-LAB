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

// PingOne Authorize (P1AZ) on the diagrams (design-authorize-lab.md D.5): the exact strings. Nothing else in either diagram changed.
test('P1AZ is drawn: the Authorize node is named PingOne Authorize (P1AZ) in both diagrams, and the delegation chain has the lab tool server path to it, solid, with HIVE still last and the only dashed step', () => {
  const d = rawDiagram('delegation-chain');
  assert.equal(d.nodes.find((n) => n.id === 'az').label, 'PingOne Authorize (P1AZ)');
  const { x, y, ...ts } = d.nodes.at(-1);
  assert.deepEqual(ts, { id: 'ts', label: 'Lab tool server (own tools, local)', group: 'tool' }, 'the node is appended last (its position is layout, not pinned here)'); assert.ok(Number.isFinite(x) && Number.isFinite(y));
  assert.equal(d.nodes.length, 8); assert.equal(d.edges.length, 9);
  assert.deepEqual(d.edges.slice(7), [
    { source: 'bff', target: 'ts', label: "tool call with the delegated token (lab's own tools)" },
    { source: 'ts', target: 'az', label: 'booking decision request (PingOne Authorize)' },
  ]);
  assert.ok(d.edges.slice(7).every((e) => e.dashed === undefined), 'both new edges are solid: the arrow is a real call');
  assert.equal(d.edges[6].dashed, true, 'the seven existing edges keep their indices and HIVE stays dashed');
  assert.deepEqual(d.steps.slice(6, 8), [
    { title: 'Lab tool server', what: "On the lab's own tools (the airline and software packs) the delegated token goes to the lab's tool server, which checks it itself. No gateway is in this path.", hop: 'gateway-check', edges: [7] },
    { title: 'PingOne Authorize (P1AZ): booking decision', what: "With the Authorize settings set, the lab's own tool server asks PingOne Authorize about an airline booking (fare, international or not, cabin, approval state) and applies the answer: a real call, drawn solid. Without them, or in the hosted build, the lab's own policy answers and the page says so.", hop: 'authorize-decision', edges: [8] },
  ]);
  for (const s of d.steps.slice(6, 8)) assert.ok(s.what.length <= 300, `${s.title}: ${s.what.length} characters`);
  assert.equal(d.steps.length, 9); assert.equal(d.steps.at(-1).title, 'HIVE (represented, not called)'); assert.deepEqual(d.steps.at(-1).edges, [6]);
  assert.equal(d.steps.filter((s) => d.edges[s.edges[0]].dashed).length, 1, 'HIVE is the only dashed step');
  assert.equal(d.steps[4].title, 'Authorize decision', 'the gateway Authorize step keeps its title');
  assert.equal(d.steps[4].what, 'PERMIT, DENY, or an obligation (step-up, human approval, CIBA). The thresholds are the lab\'s own.');
  assert.deepEqual(validateDiagram(d), []);
  const g = rawDiagram('gateway-refusals');
  assert.equal(g.nodes.find((n) => n.id === 'az').label, 'PingOne Authorize (P1AZ)'); assert.equal(g.nodes.filter((n) => /Authorize/.test(n.label)).length, 1);
  for (const v of Object.keys(VERTICALS)) for (const n of ['delegation-chain', 'gateway-refusals']) assert.ok(!JSON.stringify(buildDiagram(VERTICALS[v], n)).includes('{{'), `${v} ${n}`);
  // the built diagram: the new step walks edge 8 from the tool server to the Authorize node
  const built = buildDiagram(VERTICALS.airline, 'delegation-chain');
  const step = built.steps.find((s) => s.edge === 8); assert.deepEqual([step.from, step.to, step.dashed, step.hop], ['ts', 'az', false, 'authorize-decision']);
  assert.ok(new Set(built.nodes.map((n) => `${n.x},${n.y}`)).size === built.nodes.length, 'no two nodes share a position');
});
