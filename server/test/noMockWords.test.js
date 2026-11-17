// Owner, 2026-11-16: "Get rid of the mock calls, everything should be real mode. Stop calling out mock, demo watchers do not need to know."
// The engine stays (it still runs what the SE gateway cannot serve) and keeps marking itself in the DATA (hop.mock, hop.source, token.mock, run.mode); this
// test fails when any WORDS the server sends say mock, simulated, offline, engine or scripted. See wordScan.js for what is data and what is read.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { VERTICALS } from '../src/cast.js';
import { DIAGRAM_NAMES, buildDiagram } from '../src/diagramData.js';
import { LABELS, HOSTED_BANNER, rawStory, TALK_TRACK } from '../src/data.js';
import { MANIFEST } from '../src/manifest.js';
import { REASONS } from '../src/brain.js';
import { runUseCase } from '../src/flow.js';
import { renderTalkTrackMarkdown } from '../src/story.js';
import { HOSTED_LIVE_REFUSAL, mockSignInRefusal, liveRefusal } from '../src/safety.js';
import { get, run, W, withServer } from './helpers.js';
import { BANNED, findWords } from './wordScan.js';

const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const none = (hits, what) => assert.deepEqual(hits, [], `${what} says mock, simulated, offline or engine:\n${hits.slice(0, 12).join('\n')}`);

test('the scanner itself: it finds the words, skips raw protocol data and the named exceptions', () => {
  assert.equal(findWords({ label: 'a MOCK token' }).length, 1); assert.equal(findWords({ note: 'Simulated' }).length, 1); assert.equal(findWords({ note: 'the engine ran it' }).length, 1);
  assert.equal(findWords({ note: 'a policy decision' }).length, 0);
  assert.equal(findWords({ request: { body: { signIn: 'mock persona picker' } }, tokens: [{ mock: true, claims: { iss: 'https://idp.mock.example/as' }, label: 'user token' }] }).length, 0, 'data is not words');
  assert.equal(findWords({ source: 'mock', mode: 'mock', header: { kid: 'mock-key-1' } }).length, 0);
  assert.equal(findWords({ detail: 'Start the lab with ALLOW_MOCK_SIGNIN=1 to allow it.' }).length, 0, 'a config name');
  assert.equal(findWords({ note: 'Scripted intent match' }).length, 0, 'the brain keeps its name (owner Q4)');
});

test('story, banners, labels, talk track and diagrams carry none of the words (every full vertical)', async () => {
  none(findWords({ banner: rawStory().banner, hosted: HOSTED_BANNER, labels: LABELS, talkTrack: TALK_TRACK, notDemonstrated: rawStory().notDemonstrated, why: rawStory().why }), 'data.js');
  await withServer(async (url) => {
    for (const v of Object.keys(VERTICALS)) {
      const story = await (await get(url, `/api/story?vertical=${v}`)).json();
      none(findWords(story, `story(${v})`), `/api/story?vertical=${v}`);
      none(findWords(renderTalkTrackMarkdown(VERTICALS[v]).split('\n'), `talk-track(${v})`), `the rendered talk track (${v})`);
      for (const name of DIAGRAM_NAMES) none(findWords(buildDiagram(VERTICALS[v], name), `diagram(${name},${v})`), `diagram ${name} (${v})`);
    }
  });
  none(findWords(read('docs/talk-track.md').split('\n'), 'docs/talk-track.md'), 'docs/talk-track.md');
  none(findWords(JSON.parse(read('content-pack.json')), 'content-pack.json'), 'content-pack.json');
});

test('the hosted /api/info banner, the served hosted page and every refusal text carry none of the words', async () => {
  const HOSTED = { AAG_DEPLOY_MODE: 'hosted', ALLOW_MOCK_SIGNIN: '1', LAB_ALLOWED_HOSTS: 'appfire-agent-governance.lab.example' };
  await withServer(async (url) => {
    const info = await (await get(url, '/api/info')).json();
    none(findWords({ hostedBanner: info.hostedBanner, real: info.real, guards: info.guards }), '/api/info (hosted)');
    none(findWords([HOSTED_LIVE_REFUSAL, mockSignInRefusal({ env: { IDP: 'okta' }, bind: '127.0.0.1', headers: {} }), mockSignInRefusal({ env: {}, bind: '127.0.0.1', headers: {} }),
      mockSignInRefusal({ env: { ALLOW_MOCK_SIGNIN: '1' }, bind: '0.0.0.0', headers: {} }), liveRefusal({ env: { IDP: 'mock' }, bind: '127.0.0.1', headers: {} }),
      liveRefusal({ env: { AAG_ALLOW_LIVE: '0' }, bind: '127.0.0.1', headers: {} })]), 'the guard refusals');
  }, { env: HOSTED, bind: '0.0.0.0' });
});

test('every run of every use case in every full vertical: narration, token labels and notices, hop labels, titles, notes and details, replies, instructions, live notes', () => {
  const hits = [];
  let runs = 0;
  for (const [vertical, cast] of Object.entries(VERTICALS)) {
    for (const uc of MANIFEST.usecases) {
      const r = runUseCase(uc, { cast, vertical, seed: 'scan' });
      runs += 1;
      // Everything of the run except the vendored gateway trace's raw request/response (skipped by key) and the data the engine marks itself with.
      hits.push(...findWords(r, `${vertical}/${uc.id}`));
    }
  }
  assert.ok(runs >= 87 * 5, `scanned ${runs} runs`);
  const unique = [...new Set(hits.map((h) => h.replace(/^[^:]+: /, '')))];
  none(unique, `the runs (${runs} of them)`);
});

test('every use case list entry (realGate reasons, the live note, the route) carries none of the words, over HTTP', async () => {
  await withServer(async (url) => {
    for (const v of Object.keys(VERTICALS)) {
      const list = await (await get(url, `/api/usecases?vertical=${v}`)).json();
      // The catalog's own text (title, story, pingOneSolution, trigger text) is verbatim and pinned by the manifest tests; the lab's words are these fields.
      const lab = list.tracks.flatMap((t) => t.usecases).map((u) => ({ id: u.id, realGate: u.realGate, live: u.live, route: u.route, labInputs: u.labInputs, guided: u.guided }));
      assert.ok(lab.length >= 87);
      none(findWords(lab, `usecases(${v})`), `/api/usecases?vertical=${v}`);
    }
    none(findWords(REASONS, 'brain reasons'), 'the brain refusal texts');
    const instr = await (await get(url, '/api/instructions')).json();
    none(findWords(instr, 'instructions'), '/api/instructions');
    const r = await run(url, 'UC1', { vertical: 'banking' }, W('w-words'));
    none(findWords(r.body, 'run'), 'POST /api/run/UC1');
    assert.equal(r.body.run.mode, 'mock', 'the data still says which engine ran'); assert.ok(r.body.run.tokens.every((t) => t.mock === true), 'and the tokens still carry mock:true');
  });
});
