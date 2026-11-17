// The byte-identical guard (airline design 6.3): the four packs that were on main before the airline vertical (banking, healthcare, retail, software)
// must produce exactly the bytes they produced then. server/test/golden/fourPacks.json was captured from unmodified origin/main by
// scripts/golden-capture.mjs; this test recomputes everything and fails naming the exact (vertical, use case, persona) that moved.
// Never regenerate the golden to make this pass: a failure here means a four-pack output changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const goldenPath = fileURLToPath(new URL('./golden/fourPacks.json', import.meta.url));

test('the golden baseline is the one captured from main: four packs, 87 use cases, two personas', () => {
  const gold = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  assert.equal(gold.schema, 'appfire-golden-four-packs/1');
  assert.deepEqual(gold.verticals, ['banking', 'healthcare', 'retail', 'software']);
  assert.equal(gold.useCases, 87);
  assert.deepEqual(gold.counts, { runs: 696, runsDefaultPersona: 348, steered: 8, web: 696 });
  assert.equal(gold.webNote, null, 'the baseline covers the web-visible text too');
});

test('golden: a fresh run of banking, healthcare, retail and software is byte-identical to main (every use case, both personas, the steered run, the web text, the API)', () => {
  const r = spawnSync(process.execPath, ['scripts/golden-capture.mjs', '--check'], { cwd: root, encoding: 'utf8', timeout: 120000 });
  const out = `${r.stdout}${r.stderr}`;
  // The script prints one line per difference as "  runs/<vertical>/<use case>/<persona>: ..." under "GOLDEN FAIL".
  const moved = out.split('\n').filter((l) => /^ {2}\S+\/\S+/.test(l));
  assert.equal(r.status, 0, `the four packs changed (vertical/use case/persona):\n${moved.join('\n') || out}`);
  assert.match(out, /golden ok: 696 runs, 348 default-persona runs, 8 steered, 696 web/);
});

// design-authorize-lab.md E.3: the one intended diagram change (P1AZ) is undone EXACTLY, so the four older packs stay byte-identical, and nothing else is hidden by it.
test('undoIntendedDiagram: restores exactly the P1AZ label, the lab tool server node, edges 7 and 8 and their two steps; an extra node, a changed label or an extra edge is NOT undone', async () => {
  const { undoIntendedDiagram } = await import('../../scripts/golden-capture.mjs');
  const { buildDiagram } = await import('../src/diagramData.js');
  const { VERTICALS } = await import('../src/cast.js');
  const answer = (name, v = 'banking') => ({ names: ['delegation-chain', 'gateway-refusals'], diagram: buildDiagram(VERTICALS[v], name) });
  const chain = answer('delegation-chain'); const refusals = answer('gateway-refusals');
  const u = undoIntendedDiagram('delegation-chain', chain);
  assert.equal(u.value.diagram.nodes.find((n) => n.id === 'az').label, 'Authorize (policy decision)');
  assert.deepEqual([u.value.diagram.nodes.length, u.value.diagram.edges.length, u.value.diagram.steps.length], [7, 7, 7], 'seven nodes, seven edges, seven steps: the four-pack diagram');
  assert.ok(!JSON.stringify(u.value).includes('P1AZ') && !u.value.diagram.nodes.some((n) => n.id === 'ts') && !u.value.diagram.edges.some((e) => e.n >= 7) && !u.value.diagram.steps.some((s) => s.edge >= 7));
  assert.equal(u.value.diagram.steps.at(-1).dashed, true, 'HIVE is last again');
  assert.equal(u.notes.length, 6); assert.deepEqual(chain, answer('delegation-chain'), 'the input is never changed');
  const r = undoIntendedDiagram('gateway-refusals', refusals);
  assert.equal(r.value.diagram.nodes.find((n) => n.id === 'az').label, 'Authorize'); assert.equal(r.notes.length, 1);
  assert.deepEqual(r.value.diagram.nodes.map((n) => n.id), refusals.diagram.nodes.map((n) => n.id));
  // teeth: one extra, unlisted node; a changed unlisted label; an extra edge or step; a changed ts label; an az label that is not the intended one
  const mutate = (fn, name = 'delegation-chain') => { const a = answer(name); fn(a.diagram); return JSON.stringify(undoIntendedDiagram(name, a).value); };
  const clean = JSON.stringify(u.value);
  assert.notEqual(mutate((d) => d.nodes.push({ id: 'extra', label: 'Unlisted', kind: 'tool', x: 5, y: 5 })), clean, 'an extra node survives the undo');
  assert.notEqual(mutate((d) => { d.nodes.find((n) => n.id === 'mcp').label = 'Changed'; }), clean, 'a changed unlisted label survives');
  assert.notEqual(mutate((d) => d.edges.push({ n: 9, source: 'bff', target: 'ts', label: 'surprise' })), clean, 'an extra edge n 9 survives');
  assert.notEqual(mutate((d) => d.steps.push({ from: 'a', to: 'b', label: 'x', say: 'y', hop: 'z', edge: 9, dashed: false })), clean, 'an extra step survives');
  assert.notEqual(mutate((d) => { d.nodes.find((n) => n.id === 'ts').label = 'Another label'; }), clean, 'a changed ts label is not a listed change');
  assert.notEqual(mutate((d) => { d.nodes.find((n) => n.id === 'az').label = 'Something else'; }), clean, 'an az label that is not the intended one is not undone');
  assert.notEqual(mutate((d) => { d.edges.find((e) => e.n === 8).label = 'changed'; }), clean, 'a changed new edge label is not undone');
  assert.notEqual(mutate((d) => { d.steps.find((s) => s.edge === 8).say = 'changed'; }), clean, 'a step whose text is changed is still undone only by its listed keys; the rest is compared');
});
