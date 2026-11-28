import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CAPTIONS_PATH, loadCaptions, resetCaptionsCache, storyResponse } from '../src/storyRoute.js';
import { parity } from '../src/story/captions.js';
import { checkPin } from '../../scripts/story-checkPin.mjs';
import { STEPS, STORY_ONLY, VIDEO_ONLY, scriptKeys } from '../../web/src/storyScript.js';
import { withServer, get } from './helpers.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('story: the vendored Story files match their pin (an edited copy fails CI)', () => {
  assert.deepEqual(checkPin(root), []);
});

test('story: every caption key has a step in the script and every step has wording (the parity test)', () => {
  assert.deepEqual(parity(loadCaptions(), scriptKeys(), { allowUnused: VIDEO_ONLY }), []);
});

test('story: the parity check really fails when the wording and the script drift', () => {
  const captions = loadCaptions();
  const missingWording = { ...captions, steps: Object.fromEntries(Object.entries(captions.steps).filter(([k]) => k !== 'turn_denied')) };
  assert.deepEqual(parity(missingWording, scriptKeys(), { allowUnused: VIDEO_ONLY }), ['the demo has step "turn_denied" but captions.md does not']);
  const extra = { ...scriptKeys(), steps: [...scriptKeys().steps, 'brand_new'] };
  assert.deepEqual(parity(captions, extra, { allowUnused: VIDEO_ONLY }), ['the demo has step "brand_new" but captions.md does not']);
});

test('story: the five-act order is the script\'s bubble order, and every prompt step presses a control the page has', () => {
  const bubbles = STEPS.filter((s) => s.type === 'bubble' && !STORY_ONLY.includes(s.key)).map((s) => s.key);
  // The five acts: hero (prompt, panel is story-only, summary, chain is story-only, streams), the turn (five), the close (slide only — no bubble after it).
  assert.deepEqual(bubbles, ['hero_run_prompt', 'hero_summary', 'hero_streams', 'turn_overlimit', 'turn_hold', 'turn_denied', 'turn_blocked', 'turn_compare']);
  // Every prompt step presses the prompt picker (a select since the dropdown amendment, UI standard amendment 2) and names the
  // use case it picks (prompt.pick): the picker runs the use case itself (there is no separate Run control for it).
  const chips = new Set(['UC1', 'UC27', 'UC6', 'UC13', 'UC31']);   // the hero pick and the turn picks (demoGuide.js: the escalate step's buttons)
  for (const s of STEPS.filter((st) => st.prompt)) {
    const sels = [].concat(s.prompt.press);
    const picks = [].concat(s.prompt.pick ?? []);
    assert.equal(sels.length, picks.length, `${s.key}: a press names what it picks`);
    for (const sel of sels) assert.equal(sel, '[data-testid=wtt-select]', `${s.key}: the prompt presses the picker: ${sel}`);
    for (const pick of picks) assert.ok(chips.has(pick), `${s.key}: the picker picks a real use case: ${pick}`);
  }
});

test('story (rule 29): the Opening and Closing slides have a header naming the demo', () => {
  const captions = loadCaptions();
  assert.ok(captions.opening.header && captions.opening.header.length > 3, 'the opening slide has a header');
  assert.equal(captions.opening.header, 'Observability across Ping: one run, six products, one pane');
  assert.equal(captions.closing.header, 'Observability across Ping: one run, six products, one pane');
});

test('story: captions.md and the script are public-safe (no internal host, tenant id, key or UUID)', () => {
  const text = fs.readFileSync(CAPTIONS_PATH, 'utf8') + fs.readFileSync(`${root}web/src/storyScript.js`, 'utf8');
  assert.equal(/ping-devops|procyon|\.local\b|sk-ant|mcpgw|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text), false);
});

test('story: storyResponse serves the parsed wording, and a broken file is a 500 that names the problem (never a crash, never a path)', () => {
  const ok = storyResponse();
  assert.equal(ok.status, 200);
  assert.ok(ok.body.opening.title && ok.body.steps.turn_denied);
  assert.equal(ok.body.sourceSha256, createHash('sha256').update(fs.readFileSync(CAPTIONS_PATH)).digest('hex'));
  const tmp = fs.mkdtempSync(`${root}.tmp-story-`);
  try {
    const bad = `${tmp}/captions.md`;
    fs.writeFileSync(bad, '# Step: x\n\n## Title\nonly a title\n');
    const broken = storyResponse(bad);
    assert.equal(broken.status, 500);
    assert.match(broken.body.error, /^Story wording could not be read: captions\.md: step "x" needs both a "## Title" and a "## Text" section$/);
    const missing = storyResponse(`${tmp}/missing.md`);
    assert.equal(missing.status, 500);
    assert.match(missing.body.error, /missing or unreadable/);
    assert.equal(JSON.stringify(missing.body).includes(tmp), false, 'the 500 never carries a server path');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  resetCaptionsCache();
});

test('story: a fix to captions.md shows without a restart (the wording is read again when the bytes change, whatever the timestamp)', () => {
  const tmp = fs.mkdtempSync(`${root}.tmp-story2-`);
  const file = `${tmp}/captions.md`;
  const slide = (t) => `# Opening Slide\n\n## Header\nh\n\n## Title\n${t}\n\n## Lead\nl\n\n## Column A: a\n- x\n\n## Column B: b\n- y\n\n## Verdict\nv\n\n---\n\n`;
  const doc = (t) => slide(t) + slide('c').replace('# Opening Slide', '# Closing Slide');
  try {
    fs.writeFileSync(file, doc('first'));
    assert.equal(loadCaptions(file).opening.title, 'first');
    const when = new Date(Date.now() - 60_000);
    fs.utimesSync(file, when, when);
    fs.writeFileSync(file, doc('second'));
    fs.utimesSync(file, when, when);            // new bytes, the very same timestamp
    assert.equal(loadCaptions(file).opening.title, 'second');
    const served = storyResponse(file);
    assert.equal(served.body.opening.title, 'second');
    assert.equal(served.body.sourceSha256, createHash('sha256').update(fs.readFileSync(file)).digest('hex'), 'the served hash matches the bytes it parsed');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  resetCaptionsCache();
});

test('story: GET /api/story/wording answers the wording, and the Demo page does not mention Story', async () => {
  await withServer(async (url) => {
    const r = await get(url, '/api/story/wording');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const body = await r.json();
    assert.ok(body.steps.turn_denied?.title && body.opening.title);
    assert.equal(typeof body.sourceSha256, 'string');
    const page = await (await fetch(`${url}/`)).text();
    assert.equal(/story\/wording|storyScript|story-bar/i.test(page), false, 'Demo mode: the served page does not mention Story');
  });
});
