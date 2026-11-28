import test from 'node:test';
import assert from 'node:assert/strict';
import { TALK_TRACK } from '../src/data.js';
import { DEFAULT_CAST } from '../src/cast.js';
import { buildStory } from '../src/story.js';
import { DEMO_GUIDE } from '../../web/src/demoGuide.js';

const STEP_IDS = DEMO_GUIDE.map((g) => g.id);

test('talk track: every step value is a walkthrough step id, and each walkthrough step has an entry', () => {
  for (const t of TALK_TRACK) if (t.step !== undefined) assert.ok(STEP_IDS.includes(t.step), `${t.id}: ${t.step}`);
  for (const id of STEP_IDS) assert.ok(TALK_TRACK.some((t) => t.step === id), `no entry for step ${id}`);
});

test('talk track: no title or run label carries a use case id, and entry ids are unique', () => {
  const ids = TALK_TRACK.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of TALK_TRACK) {
    assert.ok(!/UC\d/.test(t.title), t.title);
    for (const r of t.run || []) { assert.ok(!/UC\d/.test(r.label), r.label); assert.match(r.uc, /^UC\d+$/); }
  }
});

test('talk track: entries follow the walkthrough order, general entries after the steps', () => {
  const stepped = TALK_TRACK.filter((t) => t.step);
  const idx = stepped.map((t) => STEP_IDS.indexOf(t.step));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
  assert.equal(TALK_TRACK.findIndex((t) => !t.step), stepped.length, 'entries without a step come last');
  assert.deepEqual(TALK_TRACK.map((t) => t.id), ['say-first', 'ask-iam', 'ask-privilege', 'ask-authorize', 'step-allow', 'theme-hitl', 'attacks', 'audit', 'real', 'honesty', 'why-agent-governance']);
});

test('the story carries the step through and fills the cast', () => {
  const s = buildStory(DEFAULT_CAST, 'banking');
  assert.deepEqual(s.talkTrack.map((t) => t.step), TALK_TRACK.map((t) => t.step));
  assert.ok(!JSON.stringify(s.talkTrack).includes('{{'));
});
