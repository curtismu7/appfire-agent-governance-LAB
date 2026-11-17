#!/usr/bin/env node
// The byte-identical guard for the four existing full packs (banking, healthcare, retail, software).
//
//   node scripts/golden-capture.mjs                 write server/test/golden/fourPacks.json  (run ONLY on an unmodified main)
//   node scripts/golden-capture.mjs --check         recompute and compare; exit 1 and name every (vertical, use case, persona) that changed
//   node scripts/golden-capture.mjs --out <file>    write somewhere else (determinism proofs)
//
// What is captured, per vertical and per use case of the 87, with the persona set explicitly to standard and to premium (and once with no persona):
//   runs        sha256 of the canonical runUseCase output (the same entry the engine tests use). The only non-deterministic bytes are the ES256 token
//               signatures; they are cut (as strip() in engine.test.js does). Keys are sorted, so key order is not part of the contract.
//   steered     UC1 under the poisoned instructions preset (the steered path of flow.js and instructions.js).
//   web         sha256 of what the page derives from that run with its own pure functions (decisionOf, riskLevelOf, replyOf, captionFor per hop):
//               the web-visible text of a four-pack run. Skipped with a note when the web modules cannot be loaded by node.
//   webStatic   the walkthrough (DEMO_GUIDE filled per vertical), the Compare presets and the hop captions, per vertical.
//   api         /api/prompts, /api/story (minus the lines meant to change), /api/usecases, /api/instructions, /api/diagram, per vertical.
//   intended    what the design says MAY change for the four packs: the menu (verticals list and order), the story's notDemonstrated lines.
//               Reported by --check as INFO, never as a failure.
// Each run entry also keeps outcome, hop count and a one-line summary so a failure message says something readable.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = path.join(ROOT, 'server/test/golden/fourPacks.json');
const FOUR = ['banking', 'healthcare', 'retail', 'software'];
const PERSONAS = ['standard', 'premium'];
const SEED = 'run';

// The web sources import each other without an extension (Vite resolves them); node needs a hint.
module.registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx); } catch (e) {
      if (!/^\.\.?\//.test(spec)) throw e;
      for (const ext of ['.js', '/index.js']) { try { return next(spec + ext, ctx); } catch { /* try the next */ } }
      throw e;
    }
  },
});

// The ONE intended change to the two diagrams (design-authorize-lab.md D.5, E.3): PingOne Authorize (P1AZ) is drawn. undoIntendedDiagram(name, answer) takes a /api/diagram answer
// ({ diagram: { nodes, edges, steps, ... }, names }) and puts back EXACTLY these items and nothing else, so the baseline hashes still apply to the four older packs:
//   delegation-chain: node `az` label "PingOne Authorize (P1AZ)" -> "Authorize (policy decision)"; the node `ts`; the edges n 7 and 8; the two steps that walk them.
//   gateway-refusals: node `az` label "PingOne Authorize (P1AZ)" -> "Authorize".
// Anything else that differs (an extra unlisted node, edge or step, another label) is NOT undone, so --check still fails on it. Returns { value, notes }.
export const P1AZ_LABEL = 'PingOne Authorize (P1AZ)';
const OLD_AZ_LABEL = { 'delegation-chain': 'Authorize (policy decision)', 'gateway-refusals': 'Authorize' };
const NEW_TS = { id: 'ts', label: 'Lab tool server (own tools, local)', group: 'tool' };
const NEW_EDGES = { 7: { source: 'bff', target: 'ts', label: "tool call with the delegated token (lab's own tools)" }, 8: { source: 'ts', target: 'az', label: 'booking decision request (PingOne Authorize)' } };
const NEW_STEPS = {
  7: { from: 'bff', to: 'ts', label: 'Lab tool server', say: "On the lab's own tools (the airline and software packs) the delegated token goes to the lab's tool server, which checks it itself. No gateway is in this path.", hop: 'gateway-check', dashed: false },
  8: { from: 'ts', to: 'az', label: 'PingOne Authorize (P1AZ): booking decision', say: "With the Authorize settings set, the lab's own tool server asks PingOne Authorize about an airline booking (fare, international or not, cabin, approval state) and applies the answer: a real call, drawn solid. Without them, or in the hosted build, the lab's own policy answers and the page says so.", hop: 'authorize-decision', dashed: false },
};
const sameKeys = (o, want) => Object.entries(want).every(([k, v]) => o?.[k] === v);
export function undoIntendedDiagram(name, answer) {
  const notes = [];
  const value = JSON.parse(JSON.stringify(answer));
  const d = value?.diagram;
  if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.edges) || !Array.isArray(d.steps)) return { value, notes };
  const az = d.nodes.find((n) => n.id === 'az');
  if (az && az.label === P1AZ_LABEL && Object.hasOwn(OLD_AZ_LABEL, d.name ?? name)) { az.label = OLD_AZ_LABEL[d.name ?? name]; notes.push(`${name} node az relabelled to ${P1AZ_LABEL}`); }
  if ((d.name ?? name) === 'delegation-chain') {
    const ts = d.nodes.findIndex((n) => n.id === 'ts' && n.label === NEW_TS.label && n.kind === NEW_TS.group);
    if (ts >= 0) { d.nodes.splice(ts, 1); notes.push(`${name} node ts (the lab tool server) added`); }
    for (const n of [7, 8]) {
      const e = d.edges.findIndex((x) => x.n === n && sameKeys(x, NEW_EDGES[n]));
      if (e >= 0) { d.edges.splice(e, 1); notes.push(`${name} edge ${n} (${NEW_EDGES[n].source} to ${NEW_EDGES[n].target}) added`); }
      const st = d.steps.findIndex((x) => x.edge === n && sameKeys(x, NEW_STEPS[n]));
      if (st >= 0) { d.steps.splice(st, 1); notes.push(`${name} step "${NEW_STEPS[n].label}" added`); }
    }
  }
  return { value, notes };
}
const diagramNotes = [];

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const cutSig = (s) => s.replace(JWT, (m) => m.split('.').slice(0, 2).join('.'));
// Canonical form: sorted keys, undefined dropped, token signatures cut.
function canon(v) {
  if (typeof v === 'string') return cutSig(v);
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canon(x)));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');

async function capture() {
  const { MANIFEST } = await imp('server/src/manifest.js');
  const { VERTICALS, verticalList } = await imp('server/src/cast.js');
  const { runUseCase } = await imp('server/src/flow.js');
  const { presetsFor } = await imp('server/src/instructions.js');
  const { withServer } = await imp('server/test/helpers.js');
  for (const v of FOUR) if (!VERTICALS[v]) throw new Error(`vertical ${v} missing`);

  // ---- the engine ----
  const runs = {}; const runsDefaultPersona = {}; const steered = {}; const web = {};
  let wb = null; let webNote = null;
  try {
    const [decision, chat, captions] = await Promise.all([imp('web/src/decision.js'), imp('web/src/chat.js'), imp('web/src/captions.js')]);
    wb = { decisionOf: decision.decisionOf, riskLevelOf: decision.riskLevelOf, replyOf: chat.replyOf, captionFor: captions.captionFor, CAPTIONS: captions.CAPTIONS };
  } catch (e) { webNote = `web modules not loadable by node: ${String(e.message).split('\n')[0]}`; }
  const webOf = (run) => ({ decision: wb.decisionOf(run), level: wb.riskLevelOf(run), reply: wb.replyOf(run), captions: run.hops.map((h) => wb.captionFor(h)) });
  const entry = (run) => ({ hash: hash(run), outcome: run.outcome, hops: run.hops.length, matchesExpected: run.matchesExpected });

  for (const vertical of FOUR) {
    const cast = VERTICALS[vertical];
    for (const uc of MANIFEST.usecases) {
      for (const persona of PERSONAS) {
        const run = runUseCase(uc, { cast, vertical, persona, seed: SEED });
        const key = `${vertical}/${uc.id}/${persona}`;
        runs[key] = entry(run);
        if (wb) web[key] = hash(webOf(run));
      }
      const run = runUseCase(uc, { cast, vertical, seed: SEED });
      runsDefaultPersona[`${vertical}/${uc.id}/default`] = { ...entry(run), persona: run.persona };
    }
    const poisoned = presetsFor(cast).find((p) => p.id === 'poisoned').text;
    for (const persona of PERSONAS) {
      const run = runUseCase(MANIFEST.usecases.find((u) => u.id === 'UC1'), { cast, vertical, persona, seed: SEED, instructions: poisoned });
      steered[`${vertical}/UC1/${persona}/poisoned`] = entry(run);
    }
  }

  // ---- the web's static text, per vertical ----
  const webStatic = {};
  const api = { prompts: {}, story: {}, usecases: {}, instructions: {}, diagram: {} };
  const intended = { menu: null, notDemonstrated: {}, storyVerticals: {} };
  const getJson = async (url, p) => { const r = await fetch(`${url}${p}`); if (r.status !== 200) throw new Error(`${p} -> ${r.status}`); return r.json(); };
  await withServer(async (url) => {
    const info = await getJson(url, '/api/info');
    intended.menu = info.verticals;
    for (const v of FOUR) {
      const q = `?vertical=${v}`;
      const prompts = await getJson(url, `/api/prompts${q}`);
      api.prompts[v] = hash(prompts);
      const story = await getJson(url, `/api/story${q}`);
      intended.notDemonstrated[v] = hash(story.notDemonstrated);
      intended.storyVerticals[v] = { verticals: story.verticals, fullVerticals: story.fullVerticals };
      const { notDemonstrated, verticals, fullVerticals, ...rest } = story;
      api.story[v] = hash(rest);
      api.usecases[v] = hash(await getJson(url, `/api/usecases${q}`));
      api.instructions[v] = hash(await getJson(url, `/api/instructions${q}`));
      const first = await getJson(url, `/api/diagram${q}`);
      // The intended P1AZ change is undone BEFORE hashing (at capture and at check), so the four older packs are still compared byte for byte.
      const undone = (n, a) => { const u = undoIntendedDiagram(n, a); for (const note of u.notes) diagramNotes.push(`${v}: ${note}`); return u.value; };
      api.diagram[v] = { names: first.names, ...Object.fromEntries(await Promise.all(first.names.map(async (n) => [n, hash(undone(n, await getJson(url, `/api/diagram${q}&name=${n}`)))]))) };
      if (wb) {
        try {
          const [guide, compare] = await Promise.all([imp('web/src/demoGuide.js'), imp('web/src/compare.js')]);
          const ctx = { cast: VERTICALS[v], prompts: prompts.prompts };
          // What the page shows for this vertical: the pairs its cast lists (presetsFor, added with the airline pack; on main every pair), without the airline-only
          // bookkeeping fields. The four packs must still show the same five pairs with the same words.
          const shown = compare.presetsFor ? compare.presetsFor(VERTICALS[v]) : compare.PRESETS;
          const bare = ({ onlyFor, hideFor, fare, ...rest }) => rest;
          webStatic[v] = { guide: hash(guide.DEMO_GUIDE.map((s) => guide.guideStep(s, ctx))), presets: hash(shown.map((p) => bare(compare.presetFor(p, ctx)))), prompts: hash(guide.promptGroups(prompts.prompts)) };
        } catch (e) { webNote = `${webNote ? `${webNote}; ` : ''}web static not loadable: ${String(e.message).split('\n')[0]}`; }
      }
    }
  });
  // The caption table gained `constrained` lines (airline pack); a four-pack run only reads one when its hop is CONSTRAINED, which the per-run `web` hashes prove
  // never happens. The table itself is hashed without them, as it was on main.
  const noConstrained = (t) => Object.fromEntries(Object.entries(t).map(([k, c]) => [k, Object.fromEntries(Object.entries(c).filter(([f]) => f !== 'constrained'))]));
  if (wb) webStatic.captions = hash(noConstrained(wb.CAPTIONS));

  const count = (o) => Object.keys(o).length;
  return {
    schema: 'appfire-golden-four-packs/1',
    note: 'Captured from unmodified origin/main before the airline vertical. Never regenerate this file after the airline work starts: it is the baseline.',
    verticals: FOUR, personas: PERSONAS, seed: SEED, useCases: MANIFEST.usecases.length,
    counts: { runs: count(runs), runsDefaultPersona: count(runsDefaultPersona), steered: count(steered), web: count(web) },
    webNote,
    runs, runsDefaultPersona, steered, web, webStatic, api, intended,
  };
}

const sortedJson = (o) => `${JSON.stringify(canonForFile(o), null, 1)}\n`;
// Sorted keys at every level so the file is byte-stable; the hashes inside were made by canon() already.
function canonForFile(v) {
  if (Array.isArray(v)) return v.map(canonForFile);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonForFile(v[k])]));
  return v;
}

// ---- compare ----
function diffs(a, b, prefix = '') {
  const out = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of [...keys].sort()) {
    const x = a?.[k]; const y = b?.[k]; const p = prefix ? `${prefix}/${k}` : k;
    if (x === undefined) out.push(`${p}: new, not in the golden`);
    else if (y === undefined) out.push(`${p}: in the golden, missing now`);
    else if (x && y && typeof x === 'object' && typeof y === 'object' && !('hash' in x)) out.push(...diffs(x, y, p));
    else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${p}: ${typeof x === 'object' ? `${x.outcome}/${x.hops} hops -> ${y.outcome}/${y.hops} hops (hash ${String(x.hash).slice(0, 10)} -> ${String(y.hash).slice(0, 10)})` : `${String(x).slice(0, 10)} -> ${String(y).slice(0, 10)}`}`);
  }
  return out;
}

if (process.argv[1] !== fileURLToPath(import.meta.url)) { /* imported (the undo test): export only */ } else {
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const now = await capture();
if (argv.includes('--check')) {
  const gold = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const fails = [];
  for (const sec of ['runs', 'runsDefaultPersona', 'steered', 'web', 'webStatic', 'api']) fails.push(...diffs(gold[sec], JSON.parse(JSON.stringify(canonForFile(now[sec]))), sec));
  const info = diffs(gold.intended, JSON.parse(JSON.stringify(canonForFile(now.intended))), 'intended');
  if (now.webNote && !gold.webNote) fails.push(`web: ${now.webNote}`);
  for (const l of info) console.log(`INFO (allowed to change) ${l}`);
  for (const l of [...new Set(diagramNotes)]) console.log(`INFO intended diagram change: ${l}`);
  if (fails.length) { console.log(`GOLDEN FAIL: ${fails.length} difference(s)`); for (const l of fails) console.log(`  ${l}`); process.exit(1); }
  console.log(`golden ok: ${gold.counts.runs} runs, ${gold.counts.runsDefaultPersona} default-persona runs, ${gold.counts.steered} steered, ${gold.counts.web} web, api + webStatic identical (${info.length} allowed change(s) reported above)`);
} else {
  const file = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : GOLDEN;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, sortedJson(now));
  console.log(`wrote ${file} (${fs.statSync(file).size} bytes; ${now.counts.runs} runs, ${now.counts.runsDefaultPersona} default-persona, ${now.counts.steered} steered, ${now.counts.web} web)${now.webNote ? ` NOTE ${now.webNote}` : ''}`);
}
process.exit(0);
}
