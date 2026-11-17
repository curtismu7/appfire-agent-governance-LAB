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
