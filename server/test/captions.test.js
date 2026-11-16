// Presenter captions: every hop kind the mock engine can emit has a caption, and no caption says anything it should not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST } from '../src/manifest.js';
import { VERTICALS } from '../src/cast.js';
import { runUseCase } from '../src/flow.js';
import { CAPTIONS, NOT_IN_PATH, captionFor } from '../../web/src/captions.js';

test('every hop kind the engine emits, in every full vertical and use case, has a caption', () => {
  const kinds = new Set();
  for (const vertical of Object.keys(VERTICALS)) for (const uc of MANIFEST.usecases) {
    try { for (const h of runUseCase(uc, { cast: VERTICALS[vertical], vertical, seed: 'run' }).hops) kinds.add(h.kind); } catch { /* a stub vertical or a guided page has no run here */ }
  }
  assert.ok(kinds.size >= 40, `expected the engine's kinds, got ${kinds.size}`);
  const missing = [...kinds].filter((k) => !Object.hasOwn(CAPTIONS, k));
  assert.deepEqual(missing, [], `hop kinds with no caption: ${missing.join(', ')}`);
});

test('every caption has words to say and a thing to point at, in plain text', () => {
  for (const [kind, c] of Object.entries(CAPTIONS)) {
    for (const f of ['say', 'point']) assert.ok(typeof c[f] === 'string' && c[f].length > 20, `${kind}.${f}`);
    for (const f of ['deny', 'held']) if (c[f] !== undefined) assert.ok(typeof c[f] === 'string' && c[f].length > 20, `${kind}.${f}`);
    assert.ok(c.agenda === null || ['start', 'identity', 'call', 'evaluate', 'allow', 'escalate', 'audit'].includes(c.agenda), `${kind}.agenda`);
    assert.doesNotMatch(JSON.stringify(c).replace(/\b401\b/g, ''), /<|https?:|[0-9]{2,}|\$|\.example|\.invalid/i, `${kind} carries markup, a URL or a number the lab would have to invent (an HTTP 401 is a fact)`);
  }
});

test('HIVE is named only in the brief\'s own words and never as called', () => {
  for (const [kind, c] of Object.entries(CAPTIONS)) {
    const t = JSON.stringify(c);
    if (/hive/i.test(t)) assert.match(t, /back-end role: data policy and which MCP servers may be used/, `${kind} says something else about HIVE`);
    assert.doesNotMatch(t, /hive[^.]*\b(called|calls|checks|decides|approves|blocks)\b/i, `${kind} says HIVE acts`);
  }
});

test('captionFor: a skipped step says it is not in the path; deny and held replace the words; real is labelled; an unknown kind falls back', () => {
  assert.equal(captionFor({ kind: 'step-up', verdict: 'skip' }).say, NOT_IN_PATH.say);
  assert.equal(captionFor({ kind: 'step-up', verdict: 'skip' }).notInPath, true);
  assert.equal(captionFor({ kind: 'authorize-decision', verdict: 'ok' }).say, CAPTIONS['authorize-decision'].say);
  assert.equal(captionFor({ kind: 'authorize-decision', verdict: 'deny' }).say, CAPTIONS['authorize-decision'].deny);
  assert.equal(captionFor({ kind: 'authorize-decision', verdict: 'ok', decision: { outcome: 'deny: over limit' } }).say, CAPTIONS['authorize-decision'].deny);
  assert.equal(captionFor({ kind: 'gateway-check', verdict: 'held' }).say, CAPTIONS['gateway-check'].held);
  assert.equal(captionFor({ kind: 'tool-dispatched', verdict: 'deny' }).say, CAPTIONS['tool-dispatched'].say, 'a kind with no deny words keeps its own');
  assert.equal(captionFor({ kind: 'sign-in', verdict: 'ok', source: 'real' }).real, true);
  assert.equal(captionFor({ kind: 'sign-in', verdict: 'ok', source: 'mock' }).real, false);
  assert.match(captionFor({ kind: 'brand-new-kind', verdict: 'ok' }).say, /one step of the run/);
  assert.equal(captionFor(null), null);
  assert.doesNotThrow(() => captionFor({ kind: ['x'], verdict: 5, decision: 3 }));
  assert.doesNotThrow(() => captionFor({ kind: '__proto__' }));
});
