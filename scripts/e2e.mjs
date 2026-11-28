#!/usr/bin/env node
// Real-browser run of the web UI against the real server, which serves the UI itself (server/src/index.js).
//
//   npm run build          (once; the server serves web/dist)
//   npm run e2e            starts the server on E2E_PORT (default 7830), drives it in Chromium, stops it
//   E2E_SHOTS=/some/dir    where screenshots go (default .data/e2e-screenshots, git-ignored)
//
// Uses the Chromium the installed Playwright resolves (`npx playwright install chromium` if it is missing). The run makes no outbound request: any
// request to another origin fails the run. Exit 0 only when every check passes.
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { AGENT_CLIENT_SECRET, CLIENT_ID, CLIENT_SECRET, DEMO_PASSWORD, DEMO_USERNAME, RECOVERY_CODE, FAKE_TOKEN, USER_CLIENT_SECRET, USER_SUB, authorizeSettings, fullSettingsFor, settingsFor, startFakePingOne } from '../server/test/fakePingone.js';
import { TRUSTED_HEADERS } from '../server/src/mcpClient.js';
import { REAL_KEYS } from '../server/src/settings.js';
import { startFakeGateway } from '../server/test/fakeGateway.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.E2E_SHOTS || path.join(root, '.data', 'e2e-screenshots');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
let failures = 0; let checks = 0;
const check = (ok, what) => { checks += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures += 1; };

const port = Number(process.env.E2E_PORT) || 7830;
if (port < 7814 || port > 7834) { console.error('E2E_PORT must be inside 7814-7834 (the live, hosted, full-Real, local-only and PingOne Authorize instances take the next five ports)'); process.exit(2); }
const base = `http://127.0.0.1:${port}`;
if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(2); }
// The run starts six servers on E2E_PORT .. E2E_PORT + 5. A port already held (a leftover server from a killed run, another checkout's e2e) would answer the health
// polls below and the run would test that stale server, failing much later with an unrelated timeout. Stop first and name the port.
const portFree = (p) => new Promise((resolve) => { const probe = net.createServer(); probe.once('error', () => resolve(false)); probe.listen(p, '127.0.0.1', () => probe.close(() => resolve(true))); });
for (let i = 0; i < 6; i++) {
  if (!(await portFree(port + i))) { console.error(`Port ${port + i} is already in use, so this run would talk to whatever holds it. Find it with: lsof -nP -iTCP:${port + i} -sTCP:LISTEN . Stop it if it is a leftover, or pick another range with E2E_PORT=<${7814}-${7834}>.`); process.exit(2); }
}
// The Mock instance has no PingOne settings (an empty settings file, like a fresh clone or CI with no .env) and no IDP pin, so Real is disabled by
// the missing settings alone and its tooltip says what to fill in.
const noEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-e2e-none-'));
const noEnvFile = path.join(noEnvDir, '.env');
fs.writeFileSync(noEnvFile, '', { mode: 0o600 });
const env = { ...process.env, PORT: String(port), ALLOW_MOCK_SIGNIN: '1', AAG_ENV_FILE: noEnvFile };
for (const k of ['CALAB_BIND', 'AAG_ALLOW_LIVE', 'AAG_LAB_MODE', 'IDP', 'AAG_LIVE_FROM_ENV', 'AAG_LIVE_TEST_BASE', ...REAL_KEYS]) delete env[k];
const server = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env, stdio: 'inherit' });
let up = false;
for (let i = 0; i < 160 && !up; i++) { try { up = (await fetch(`${base}/api/health`)).ok; } catch { await sleep(250); } }
if (!up) { server.kill(); console.error('server did not start'); process.exit(2); }
fs.mkdirSync(shots, { recursive: true });

const overlapScript = `(() => {
  // The diagram kit's labels (dk-label, in the viewport portal) and any React Flow edge labels left, above the boxes.
  const labels = [...document.querySelectorAll('.dk-label, .react-flow__edgelabel-renderer > *')].map((el) => ({ t: el.textContent.trim(), r: el.getBoundingClientRect() })).filter((l) => l.t && l.r.width > 1);
  let overlaps = 0;
  for (let a = 0; a < labels.length; a++) for (let b = a + 1; b < labels.length; b++) {
    const w = Math.min(labels[a].r.right, labels[b].r.right) - Math.max(labels[a].r.left, labels[b].r.left);
    const h = Math.min(labels[a].r.bottom, labels[b].r.bottom) - Math.max(labels[a].r.top, labels[b].r.top);
    const small = Math.min(labels[a].r.width * labels[a].r.height, labels[b].r.width * labels[b].r.height) || 1;
    if (w > 0 && h > 0 && (w * h) / small > 0.08) overlaps++;
  }
  return { labels: labels.length, overlaps };
})()`;

// The fixed neutral banner lines (owner 2026-11-16: the page never says how it runs; one honesty line stays, first on every page).
const BANNER_LOCAL = "The back-end platform, HIVE, is represented here and never called. Thresholds, personas and amounts are the lab's own (lab-invented); the use cases come from the AI-DEMO2 catalog.";
const BANNER_HOSTED = "Hosted copy. The back-end platform, HIVE, is represented and never called. Thresholds, personas and amounts are the lab's own (lab-invented). No tenant or live system is reached.";

// There is no Mock | Real control on the page any more. The lab opens in Real when Real is fully configured; tests and scripts switch a tab's workspace with
// POST /api/mode (the server contract of rule 19, unchanged) and reopen the page, then read the hidden data-mode marker (no words, "mock" or "live").
const modeMarker = (page, want) => page.locator(want ? `[data-testid="mode"][data-mode="${want}"]` : '[data-testid="mode"][data-mode]:not([data-mode=""])');
const modeCall = (page, source) => page.evaluate(async (src) => {
  const r = await fetch('/api/mode', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace': sessionStorage.getItem('cal.workspace') || '' }, body: JSON.stringify({ source: src }) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, source);
const switchMode = async (page, source) => {
  const r = await modeCall(page, source);
  await page.goto(new URL('/', page.url()).href); // the same tab (the same workspace id), back on the Agent page
  await modeMarker(page, source === 'real' ? 'live' : 'mock').waitFor({ state: 'attached', timeout: 15000 });
  await page.getByTestId('uc-UC1').waitFor();
  return r;
};
// The run bodies the page received, so a check can read the data (hop.source, run.mode, run.realGate) the page no longer shows.
const watchRuns = (page) => {
  const runs = [];
  page.on('response', async (r) => { if (r.request().method() === 'POST' && /\/api\/run\//.test(r.url())) { try { runs.push((await r.json()).run || null); } catch { runs.push(null); } } });
  return { runs, next: async (n) => { for (let i = 0; i < 100 && !runs.slice(n).some(Boolean); i++) await sleep(50); return runs.slice(n).filter(Boolean).pop() || null; } };
};

// The hop of a run that the tool (not the sign-in or the exchanges) answered, in the data.
const toolHop = (run) => (run?.hops || []).find((h) => ['tool-dispatched', 'tool-held', 'tool-refused'].includes(h.kind) && h.source === 'real');

// NO-MOCK-WORDS (owner 2026-11-16): everything a person can read or hear on a page, text, aria-label, title, placeholder, alt, an input's value and option
// text (own text nodes of every visible element stand in for innerText, so the data panes can be skipped by element). The words banned are mock, simulat*,
// offline, engine and scripted. The EXCEPTIONS are named so each one shows up in review:
//   DATA     JSON panes, hop URL lines and decoded claim values show the wire (idp.mock.example, customer-app-mock, kid mock-key-1): data, not labels.
//   Q3       "lab-simulated" (the UC15 chip and its message) is an honesty admission the owner kept.
//   Q4       the brain's name "Scripted" and the hand-off app id mock-authorize are names the owner kept.
//   RULE 5   the diagram's "Simulate" control keeps the rulebook's name for it.
//   TERM     "policy engine" is a product term.
//   CATALOG  the vendored hop catalog (server/src/vendor/hop-catalog.json) has three teaching sentences that say "(mock)" or "the engine"; they change upstream in
//            AI-DEMO-Standalone first and the labs re-vendor, so until then they are named here.
//   PROMPT   the banking pack's What to type chips are the catalog's own text, verbatim ("simulate an agent identity mismatch"); a test pins them.
const WORDS = /mock|simulat|offline|\bengine\b|scripted/i;
const EXCEPTIONS = [/lab-simulated/gi, /\bScripted\b/g, /mock-authorize/g, /\bSimulate\b/g, /policy engine/gi, /scripted intent match \(mock\)/gi, /A DENY proves the engine answered/g, /Nothing here was decided by the engine/g, /simulate an? (forged )?agent (identity mismatch|in the delegation chain)/gi,
  // RUN-OBS (owner's 2026-11-16 wording exception, granted per lab): the vendored panel's own basis line names what the rows are. The chain's origin
  // chips ("simulated") are the shared panel's honesty marker in every lab that vendors it; the origin words ride data-origin attributes, not this scan.
  /Simulated: the lab's mock computed these rows\. None of them was read from a product log\./gi];
const SCAN = `(() => {
  const DATA = ['.jsonbox', '.json', '.jwire', '.http__url', '.http__line', '.fact__v', '[data-testid="claim-diff"]', '[data-testid="sdp-kv"]', 'script', 'style',
    // the run-observability panel's own basis and origin markers: the shared panel's honesty words, vendor-fixed (not lab wording)
    '[data-testid="ro-basis"]', '.ro-chip[data-origin]', '.ro-chain-label', '[data-testid="run-lane-note"]',
    '[data-testid^="ro-coverage-"]', '[data-testid="ro-legend"]', '[data-testid^="ro-chain-"]', '[data-testid^="ro-"][data-outcome]', '[data-testid^="ro-"][data-origin]'];
  const ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
  const out = [];
  const add = (where, text) => { if (text && text.trim()) out.push({ where, text: text.trim() }); };
  add('document title', document.title);
  for (const el of document.body.querySelectorAll('*')) {
    if (DATA.some((s) => el.closest(s))) continue;
    const opt = el.tagName === 'OPTION' || el.tagName === 'OPTGROUP';
    if (!opt && el.checkVisibility && !el.checkVisibility()) continue;
    const where = el.tagName.toLowerCase() + (el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : '');
    add(where + ' text', [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
    for (const a of ATTRS) add(where + ' ' + a, el.getAttribute(a));
    if (/^(INPUT|TEXTAREA)$/.test(el.tagName) && el.type !== 'password') add(where + ' value', el.value);
  }
  return out;
})()`;
let wordsRead = 0;
const walk = async (page, label) => {
  const items = await page.evaluate(SCAN);
  wordsRead += items.length;
  const bad = items.filter(({ text }) => WORDS.test(EXCEPTIONS.reduce((s, re) => s.replace(re, ''), text))).map(({ where, text }) => `${where}: ${text.slice(0, 90)}`);
  check(bad.length === 0, `${label}: no mock, simulated, offline, engine or scripted word anywhere a person can read (${items.length} strings read${bad.length ? `; ${bad.slice(0, 4).join(' | ')}` : ''})`);
};

// Live mode (step 3) is driven against a FAKE PingOne on loopback: a second lab instance with NO opt-in and no IDP pin (option a, owner 2026-11-10: the
// settings alone make Real available), a temp settings file (mode 600, fake values) and AAG_LIVE_TEST_BASE pointing at the fake. The toggle is switched
// Mock -> Real -> Mock -> Real in one page against the one running server: no restart. No real tenant is touched; the real PingOne path is UNVERIFIED and owner-run.
const livePort = port + 1;
const liveBase = `http://127.0.0.1:${livePort}`;
const fake = await startFakePingOne();
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-e2e-'));
const settingsFile = path.join(settingsDir, '.env');
fs.writeFileSync(settingsFile, `${Object.entries(settingsFor()).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
const liveEnv = { ...process.env, PORT: String(livePort), ALLOW_MOCK_SIGNIN: '1', AAG_ENV_FILE: settingsFile, AAG_LIVE_TEST_BASE: fake.base };
for (const k of ['CALAB_BIND', 'AAG_LAB_MODE', 'IDP', 'AAG_ALLOW_LIVE', 'AAG_LIVE_FROM_ENV']) delete liveEnv[k];
const liveServer = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env: liveEnv, stdio: 'inherit' });
let liveUp = false;
for (let i = 0; i < 160 && !liveUp; i++) { try { liveUp = (await fetch(`${liveBase}/api/health`)).ok; } catch { await sleep(250); } }
if (!liveUp) { server.kill(); liveServer.kill(); console.error('live server did not start'); process.exit(2); }

// The hosted build (AAG_DEPLOY_MODE=hosted): a third instance, mock only. Its Real button is disabled with a note and never asks the server.
const hostedPort = port + 2;
const hostedBase = `http://127.0.0.1:${hostedPort}`;
const hostedEnv = { ...process.env, PORT: String(hostedPort), AAG_DEPLOY_MODE: 'hosted', AAG_LAB_MODE: 'mock', ALLOW_MOCK_SIGNIN: '1', IDP: 'mock' };
delete hostedEnv.CALAB_BIND; delete hostedEnv.AAG_ALLOW_LIVE; delete hostedEnv.AAG_BRAIN_URL;
const hostedServer = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env: hostedEnv, stdio: 'inherit' });
let hostedUp = false;
for (let i = 0; i < 160 && !hostedUp; i++) { try { hostedUp = (await fetch(`${hostedBase}/api/health`)).ok; } catch { await sleep(250); } }
if (!hostedUp) { server.kill(); liveServer.kill(); hostedServer.kill(); console.error('hosted server did not start'); process.exit(2); }

// Full Real (owner, 2026-11-10): a fourth instance with the full-Real settings (fake values), the fake PingOne (pi.flow, flows API, code, client
// credentials, token exchange with act) and the fake Agent Gateway (MCP). Still no real tenant and no SE: both fakes are on loopback.
const fullPort = port + 3;
const fullBase = `http://127.0.0.1:${fullPort}`;
const fullP1 = await startFakePingOne();
const fullGw = await startFakeGateway({ isDelegated: (tok) => fullP1.issued.delegated.has(tok) });
const fullFile = path.join(settingsDir, 'full.env');
fs.writeFileSync(fullFile, `${Object.entries({ ...settingsFor(), ...fullSettingsFor(fullGw.url) }).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
const fullEnv = { ...process.env, PORT: String(fullPort), ALLOW_MOCK_SIGNIN: '1', AAG_ENV_FILE: fullFile, AAG_LIVE_TEST_BASE: fullP1.base };
for (const k of ['CALAB_BIND', 'AAG_LAB_MODE', 'IDP', 'AAG_ALLOW_LIVE', 'AAG_LIVE_FROM_ENV']) delete fullEnv[k];
const fullServer = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env: fullEnv, stdio: 'inherit' });
let fullUp = false;
for (let i = 0; i < 160 && !fullUp; i++) { try { fullUp = (await fetch(`${fullBase}/api/health`)).ok; } catch { await sleep(250); } }
if (!fullUp) { server.kill(); liveServer.kill(); hostedServer.kill(); fullServer.kill(); console.error('full-Real server did not start'); process.exit(2); }

// Real with ONLY the lab's own provider (owner 2026-11-16: the SE gateway names are optional, so the lab runs completely standalone with just its own PingOne): a fifth
// instance with the five app names and no gateway name at all, AAG_PROVIDER=local, its own fake PingOne. No SE, no gateway fake.
const soloPort = port + 4;
const soloBase = `http://127.0.0.1:${soloPort}`;
const soloP1 = await startFakePingOne();
const soloSettings = { ...settingsFor(), ...fullSettingsFor(null, { AAG_PROVIDER: 'local' }) };
for (const k of ['AAG_AGENT_GATEWAY_URL', 'AAG_GATEWAY_AUDIENCE', 'AAG_GATEWAY_SCOPE']) delete soloSettings[k];
const soloFile = path.join(settingsDir, 'solo.env');
fs.writeFileSync(soloFile, `${Object.entries(soloSettings).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
const soloEnv = { ...process.env, PORT: String(soloPort), ALLOW_MOCK_SIGNIN: '1', AAG_ENV_FILE: soloFile, AAG_LIVE_TEST_BASE: soloP1.base };
for (const k of ['CALAB_BIND', 'AAG_LAB_MODE', 'IDP', 'AAG_ALLOW_LIVE', 'AAG_LIVE_FROM_ENV', ...REAL_KEYS]) delete soloEnv[k];
const soloServer = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env: soloEnv, stdio: 'inherit' });
let soloUp = false;
for (let i = 0; i < 160 && !soloUp; i++) { try { soloUp = (await fetch(`${soloBase}/api/health`)).ok; } catch { await sleep(250); } }
if (!soloUp) { server.kill(); liveServer.kill(); hostedServer.kill(); fullServer.kill(); soloServer.kill(); console.error('local-only server did not start'); process.exit(2); }

// PingOne Authorize decides the airline booking (phase C, owner decision 2026-11-17): a sixth instance with the local-only settings PLUS the three AAG_AUTHORIZE_* names, its
// own fake PingOne that also serves a fake decision endpoint (fake.authorize: setMode, seen). AAG_PROVIDER=local, no gateway. The fake proves only the lab's reading of an answer;
// the real endpoint is UNVERIFIED until the owner's run (scripts/owner/authorize-probe.mjs).
const authPort = port + 5;
const authBase = `http://127.0.0.1:${authPort}`;
const authP1 = await startFakePingOne({ authorize: true });
const authSettings = { ...settingsFor(), ...fullSettingsFor(null, { AAG_PROVIDER: 'local' }), ...authorizeSettings() };
for (const k of ['AAG_AGENT_GATEWAY_URL', 'AAG_GATEWAY_AUDIENCE', 'AAG_GATEWAY_SCOPE']) delete authSettings[k];
const authFile = path.join(settingsDir, 'authorize.env');
fs.writeFileSync(authFile, `${Object.entries(authSettings).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
const authEnv = { ...process.env, PORT: String(authPort), ALLOW_MOCK_SIGNIN: '1', AAG_ENV_FILE: authFile, AAG_LIVE_TEST_BASE: authP1.base };
for (const k of ['CALAB_BIND', 'AAG_LAB_MODE', 'IDP', 'AAG_ALLOW_LIVE', 'AAG_LIVE_FROM_ENV', ...REAL_KEYS]) delete authEnv[k];
const authServer = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env: authEnv, stdio: 'inherit' });
let authUp = false;
for (let i = 0; i < 160 && !authUp; i++) { try { authUp = (await fetch(`${authBase}/api/health`)).ok; } catch { await sleep(250); } }
if (!authUp) { server.kill(); liveServer.kill(); hostedServer.kill(); fullServer.kill(); soloServer.kill(); authServer.kill(); console.error('PingOne Authorize server did not start'); process.exit(2); }

// The delegated token for the tools resource, tampered on its way out of the fake PingOne (one character of the signature, same length), when armed. The fake runs in
// THIS process, so the response bytes are changed where the fake writes them; nothing in the lab or the fake knows. Used for the "a refused token is a real 401" check.
let tamperTools = false;
const tamperBody = (chunk) => {
  try {
    const j = JSON.parse(String(chunk));
    const parts = String(j.access_token || '').split('.');
    if (parts.length !== 3) return chunk;
    const aud = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).aud;
    if (!(Array.isArray(aud) ? aud : [aud]).includes('appfire-work-tools')) return chunk;
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    return JSON.stringify({ ...j, access_token: parts.join('.') });
  } catch { return chunk; }
};
for (const fn of ['write', 'end']) {
  const orig = http.ServerResponse.prototype[fn];
  http.ServerResponse.prototype[fn] = function patched(chunk, ...rest) {
    if (tamperTools && this.socket?.localPort === fullP1.port && String(this.req?.url || '').includes('/as/token') && (typeof chunk === 'string' || Buffer.isBuffer(chunk))) chunk = tamperBody(chunk);
    return orig.call(this, chunk, ...rest);
  };
}

const healthOf = async (b) => (await (await fetch(`${b}/api/health`)).json()).runtime;
check((await healthOf(liveBase)) === 'live' && (await healthOf(base)) === 'offline', 'health: the live instance reports runtime live, the mock one offline');

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
  // Today's demo set (the lab opens on all use cases; the eight are one click away): every block below drives the whole catalog, so its pages are pinned to "All use cases" (the choice is read from localStorage `aag.set`).
  // The toggle block uses `rawContext`, which leaves the saved choice alone. Every block also pins the setup sidebar open (`aag.setup` = "0"): the lab opens it collapsed, and these blocks drive its picker.
  const rawContext = browser.newContext.bind(browser);
  browser.newContext = async (o) => { const c = await rawContext(o); await c.addInitScript(() => { try { window.localStorage.setItem('aag.set', 'all'); window.localStorage.setItem('aag.setup', '0'); } catch { /* storage blocked */ } }); return c; };
  for (const [width, height, name] of [[1280, 900, 'desktop'], [375, 800, 'phone']]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `${name}-${scheme}`;
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
      const page = await ctx.newPage();
      const external = []; const errors = []; const requests = [];
      page.on('request', (r) => { requests.push(r.url()); if (!r.url().startsWith(base) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
      page.on('pageerror', (e) => errors.push(e.message));
      // the deliberate refusals (403 live, 409 Real refused, 501 stub) show up as console messages; anything else is a failure
      page.on('console', (m) => { if (m.type() === 'error' && !/status of (403|409|501)/.test(m.text())) errors.push(m.text()); });
      const t = (id) => page.getByTestId(id);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const pick = async (id) => { await t('search').fill(id); await page.locator(`[data-testid="uc-${id}"]`).click(); await t('search').fill(''); };

      await page.goto(`${base}/`);
      await t('uc-UC1').waitFor();
      // one neutral line, the same whatever the lab runs on; the page carries no Mock | Real control and no mode chip, only a hidden data-mode marker
      await modeMarker(page).waitFor({ state: 'attached', timeout: 60000 });
      check((await t('banner').innerText()) === BANNER_LOCAL && (await t('banner').getAttribute('data-state')) === 'info', `${tag}: the banner is the one neutral line (HIVE represented, the lab's own numbers)`);
      check((await modeMarker(page, 'mock').count()) === 1 && (await t('mode-select').count()) === 0 && (await t('mode-real').count()) === 1 && (await page.locator('[data-testid^="qc-mode-"], [data-testid="real-hosted-note"], [data-testid="real-vertical-note"]').count()) === 0, `${tag}: no Mock | Real control or mode chip; the hidden marker says mock (no .env), and the rule-19 marker is there`);
      check(/^Workspace: w-[0-9a-f]{16}$/.test(await t('workspace').innerText()), `${tag}: the header shows the workspace id`);
      check((await page.getByRole('tab').allInnerTexts()).join('|') === 'Agent|Run history|Diagram|Talk track', `${tag}: the side nav holds only the agent's own areas`);
      check((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === null, `${tag}: Auto theme sets no data-theme`);
      if (width < 600) {
        const top = await page.evaluate(() => Math.round(document.querySelector('main').getBoundingClientRect().top + window.scrollY));
        console.log(`INFO  ${tag}: the content starts ${top} px from the top`);
        check(top < 560, `${tag}: the header leaves the content to start above 560 px (${top})`); // this lab's shell bar carries the Demo guide button too, so it wraps one more row on phones
        const nav = await page.evaluate(() => { const l = document.querySelector('[data-testid="nav"]'); return { sw: l.scrollWidth, cw: l.clientWidth }; });
        check(nav.sw <= nav.cw, `${tag}: all four nav tabs fit with no clipping (${nav.sw} of ${nav.cw})`);
      }

      await pick('UC1'); await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'PERMIT' && (await t('matches').innerText()).includes('matches the catalog label'), `${tag}: UC1 runs, PERMIT, matches the catalog label`);
      const evCount = await t('evidence-count').innerText();
      check((await page.getByTestId(/^row-\d+$/).count()) === 16 && evCount.includes('16 hops') && evCount.includes('+5 not in this run'), `${tag}: the Sequence draws the 16 hops that ran; 5 more are not in this path (AI-DEMO2's reel order) and the count says so (${evCount})`);
      check((await t('hop').count()) === 0 && (await t('hops-toggle').count()) === 0 && !(await page.locator('.sq-actors').first().isVisible()) && !(await page.locator('.sq-prog').first().isVisible()), `${tag}: one hop view only: no second list of collapsed hops, no actor tiles or progress bar above the Sequence`);
      check((await t('sequence-view').innerText()).includes('Identity provider'), `${tag}: the run names its identity provider as the Identity provider`);
      check(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(await t('run-traceparent').innerText()), `${tag}: the run has a W3C traceparent`);
      if (name === 'phone') {
        const gwLane = page.getByRole('button', { name: 'Gateway actor details (top)' });
        await gwLane.scrollIntoViewIfNeeded(); await gwLane.click();
        const sheet = page.getByRole('dialog', { name: 'Gateway actor details' });
        const sb = await sheet.boundingBox();
        check((await sheet.getAttribute('data-narrow')) === 'true' && Math.round(sb.width) === width && Math.round(sb.y + sb.height) === height, `${tag}: on a phone the actor card is a full-width bottom sheet (${Math.round(sb.width)} px)`);
        await sheet.getByRole('button', { name: 'Close Gateway details' }).click();
      }
      await t('evtab-tokens').click();
      const token = t('token').first();
      check((await token.getByTestId('mock-tag').count()) === 0 && /^eyJ/.test(await token.getByTestId('token-raw').innerText()) && (await token.getByTestId('token-claims').innerText()).includes('sub'), `${tag}: the token carries no MOCK chip, and is shown raw and decoded`);
      if (tag === 'desktop-light') await walk(page, `${tag}: the tokens tab after a run`);
      await t('evtab-sequence').click();
      if (tag === 'desktop-light') await walk(page, `${tag}: the agent page after a run`);
      check((await t('nav-page-consent').count()) === 1, `${tag}: UC1 brought in the Consent and step-up page`);
      await pick('UC7'); await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'PERMIT' && (await t('decision-word').innerText()) === 'ALLOWED' && (await t('risk-strip').locator('li').count()) === 5, `${tag}: the domestic $380 booking is PERMIT, the card says ALLOWED, and the strip has five rungs (the airline pack)`);
      check((await t('actor-authorize').count()) === 1 && !(await t('actor-authorize').innerText()).includes('P1AZ') && !(await t('evidence-column').innerText()).includes('PingOne Authorize (P1AZ)'), `${tag}: a booking the lab's own fare rule decided draws its decision on a lane named plainly Authorize, never PingOne Authorize (P1AZ)`);
      await pick('UC8'); await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'CONSTRAINED' && (await t('decision-word').innerText()) === 'CONSTRAINED' && (await t('decision-seat').innerText()) === 'business asked, economy booked' && (await t('mp-deny').count()) === 0, `${tag}: the same $380, international, is CONSTRAINED: business asked, economy booked, and no phone opens`);
      check((await page.locator('[data-testid="risk-strip"] [aria-current="step"]').getAttribute('data-testid')) === 'risk-2' && (await t('risk-strip').getAttribute('aria-label')).includes('five controls'), `${tag}: the five-rung strip lights rung two for CONSTRAINED and says five in its label`);
      check((await t('decision-policy').innerText()).startsWith("the lab's fare rule, not a PingOne Authorize outcome"), `${tag}: the policy row says the lab's own fare rule decided, never a PingOne Authorize outcome`);
      await pick('UC27'); await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'STEP_UP' && (await t('nav-page-approval').count()) === 1, `${tag}: a claimed approval is STEP_UP (a second factor first) and brings in Human approval`);
      // The hold opens the phone (owner 2026-11-13); deny it so the run can continue.
      await t('mp-deny').click(); await t('mp-outcome').waitFor();
      check((await t('mp-outcome').innerText()).includes('Denied'), `${tag}: the held booking opened the phone and a deny was recorded`);
      // The persona the use case needs is selected by the use case itself: the default Run of UC21 permits and UC9 denies, as the README says.
      await pick('UC21');
      check((await t('persona').inputValue()) === 'premium', `${tag}: picking UC21 selects the premium persona it needs`);
      await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'PERMIT' && (await t('matches').innerText()).includes('matches the catalog label'), `${tag}: UC21 with its default persona is PERMIT and matches the catalog label`);
      await pick('UC9');
      check((await t('persona').inputValue()) === 'standard', `${tag}: picking UC9 selects the standard persona`);
      await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'DENY_403' && (await t('matches').innerText()).includes('matches the catalog label'), `${tag}: UC9 with its default persona is DENY_403 and matches the catalog label`);
      // What Privilege did (rule 25): UC9 reached the gateway, so its trace sits under the Run result; the refusal is the first FAIL decision, and the basis line says the lab computed the decisions.
      const gwPanel = t('gateway-trace');
      check((await gwPanel.count()) === 1 && (await gwPanel.getByRole('heading', { name: 'What Privilege did' }).count()) === 1 && (await t('gateway-trace-basis').innerText()) === "These decisions were computed by the lab's own gateway steps, in the order a gateway runs them.", `${tag}: UC9's Run shows the What Privilege did panel with the neutral basis line`);
      check((await page.evaluate(() => { const r = document.querySelector('[data-testid="result"]'); const g = document.querySelector('[data-testid="gateway-trace"]'); return Boolean(r && g && (r.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING)); })) === true, `${tag}: the panel is under the Run result`);
      // keyboard and landmarks: focus stays on Run, one main landmark holding the tabpanel, no dangling aria-controls, Cmd/Ctrl+P is not presenter mode
      await t('run').focus(); await page.keyboard.press('Enter');
      check((await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'run', `${tag}: focus stays on the Run button after Enter`);
      await t('result').waitFor(); await sleep(150);
      check((await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'run', `${tag}: focus is still on Run when the result lands`);
      check((await page.getByRole('main').count()) === 1 && (await page.getByRole('main').getByRole('tabpanel').count()) === 1, `${tag}: one main landmark, with the tabpanel inside it`);
      check((await page.evaluate(() => [...document.querySelectorAll('[aria-controls]')].filter((e) => !document.getElementById(e.getAttribute('aria-controls'))).length)) === 0, `${tag}: no aria-controls points at a missing element`);
      await page.keyboard.press('Control+p'); await page.keyboard.press('Meta+p');
      check((await t('presenter').getAttribute('aria-pressed')) === 'false', `${tag}: Ctrl+P and Cmd+P do not toggle presenter mode`);
      check((await t('run-announce').innerText()).startsWith('Group / entitlement check finished: DENY_403'), `${tag}: the live region holds the outcome line only`);
      await pick('UC-LEARN2'); await t('run').click(); await t('guided-note').waitFor();
      check((await t('guided-note').innerText()) === 'guided, not computed' && (await t('matches').count()) === 0, `${tag}: a guided run says guided, not computed`);
      check((await t('gateway-trace').count()) === 0, `${tag}: a guided run reaches no gateway, so no trace panel is drawn`);
      // the one link allowed is the shared Shelf button in the header (a.shelf-link, the family's launcher); link-outs are plain labels
      check((await page.locator('a[href]:not(.shelf-link)').count()) === 0 && (await page.locator('a.shelf-link').count()) <= 1 && (await page.locator('.shell-bar a.shelf-link').count()) === (await page.locator('a.shelf-link').count()), `${tag}: no link anywhere but the header Shelf button (link-outs are plain labels)`);
      await t('nav-more').selectOption('page-approval'); await t('extra-approval').waitFor();
      check((await overflow()) <= 0, `${tag}: the extra page does not scroll sideways (${await overflow()} px)`);
      await t('nav-agent').click();
      await t('vertical').selectOption('government'); await pick('UC1'); await t('run').click(); await t('refusal').waitFor();
      check((await t('refusal').getAttribute('data-code')) === 'vertical_stub' && (await t('refusal').innerText()).includes('Not built'), `${tag}: a stub vertical shows the honest not built state (HTTP 501)`);
      // banking stays selectable and unchanged: one UC1 run in it (its own read tool in the evidence), then back to the default
      await t('vertical').selectOption('banking'); await pick('UC1'); await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'PERMIT' && (await page.getByTestId('evidence-column').innerText()).includes('get_account_balance'), `${tag}: banking is still selectable and runs its own read tool`);
      check((await t('risk-strip').locator('li').count()) === 4, `${tag}: banking draws the four-rung strip, unchanged`);
      // software stays selectable and unchanged too: its own read tool in the evidence, four rungs, no airline wording
      await t('vertical').selectOption('software'); await pick('UC1'); await t('run').click(); await t('result').waitFor();
      check((await t('outcome').innerText()) === 'PERMIT' && (await page.getByTestId('evidence-column').innerText()).includes('get_my_issues') && (await t('risk-strip').locator('li').count()) === 4 && !/Larkspur|CONSTRAINED/.test(await page.getByTestId('evidence-column').innerText()), `${tag}: software is still selectable and runs its own read tool with a four-rung strip`);
      await t('vertical').selectOption('airline');
      // With no .env Real is refused by the server contract (rule 19: POST /api/mode answers 409 and says what to fill in), and the page stays on the lab's own steps.
      const refusedReal = await modeCall(page, 'real');
      check(refusedReal.status === 409 && /^Real is not configured: fill PINGONE_ENVIRONMENT_ID, AAG_USER_CLIENT_ID, AAG_USER_CLIENT_SECRET, AAG_AGENT_CLIENT_ID, AAG_AGENT_CLIENT_SECRET, AAG_DEMO_USERNAME in this app's \.env/.test(refusedReal.body?.message || '') && /need a PingOne environment \(PINGONE_ENVIRONMENT_ID and the AAG_\* apps\)\.$/.test(refusedReal.body?.message || '') && !/PingFederate/.test(refusedReal.body?.message || '') && (await modeMarker(page, 'mock').count()) === 1, `${tag}: with no .env Real is refused (HTTP 409), the answer says what to fill in, and the page stays on its own steps`);
      check((await overflow()) <= 0, `${tag}: the agent page does not scroll sideways (${await overflow()} px)`);
      if (tag === 'desktop-light') await page.screenshot({ path: path.join(shots, 'run.png'), fullPage: true });

      await t('nav-runs').click(); await t('history').waitFor();
      check((await t('history-row').count()) >= 3, `${tag}: run history lists the runs`);

      await t('nav-diagram').click();
      const before = requests.length;
      for (const dn of ['delegation-chain', 'gateway-refusals']) {
        await t(`dg-${dn}`).click(); await page.locator('.react-flow__node').first().waitFor(); await sleep(600);
        const o = await page.evaluate(overlapScript);
        // The delegation chain has nine arrows (the tool server and its path to PingOne Authorize are the last two before HIVE's dashed one) and six for the refusals.
        const want = dn === 'delegation-chain' ? 9 : 6;
        check(o.overlaps === 0 && o.labels === want, `${tag}: ${dn} has ${o.labels} labels (want ${want}) and ${o.overlaps} overlaps`);
        if (dn === 'delegation-chain') check((await page.locator('.dnode[data-represented="true"]').count()) === 1 && (await page.locator('.dedge--dashed').count()) === 1, `${tag}: HIVE is one dashed box and one dashed arrow`);
        // P1AZ is visible (owner request): the Authorize node says PingOne Authorize (P1AZ) in both diagrams, and the delegation chain draws the lab's tool server.
        const nodeTexts = (await page.locator('.dnode').allInnerTexts()).map((x) => x.replace(/\s+/g, ' '));
        check(nodeTexts.some((x) => x.includes('PingOne Authorize (P1AZ)')) && !nodeTexts.some((x) => /^Authorize( \(policy decision\))?$/.test(x.trim())), `${tag}: ${dn} draws the node "PingOne Authorize (P1AZ)"`);
        if (dn === 'delegation-chain') {
          const edgeTexts = (await page.locator('.dk-label').allInnerTexts()).join(' | ');
          // an arrow is labelled with its step's title (number first), so the two new arrows read "7. Lab tool server" and "8. PingOne Authorize (P1AZ): booking decision"
          check(nodeTexts.some((x) => x.includes('Lab tool server (own tools, local)')) && edgeTexts.includes('7. Lab tool server') && edgeTexts.includes('8. PingOne Authorize (P1AZ): booking decision') && edgeTexts.includes('9. HIVE (represented, not called)'), `${tag}: the delegation chain draws the lab tool server and its path to PingOne Authorize, then HIVE last`);
          check((await page.locator('.dedge--dashed').count()) === 1, `${tag}: the new arrows are solid (HIVE's stays the one dashed arrow)`);
        }
        check((await overflow()) <= 0, `${tag}: the diagram page does not scroll sideways`);
      }
      check(requests.slice(before).some((u) => u.includes('/api/diagram?') && u.includes('name=gateway-refusals')), `${tag}: the diagram was loaded by name from the server`);
      // The Compare page: two runs side by side, with a risk strip in each decision card, and no sideways scroll at any viewport.
      await page.evaluate(() => { window.location.hash = '#compare'; });
      await t('page-compare').waitFor();
      for (let i = 0; i < 60 && !((await t('decision-card').count()) === 2 && (await t('compare-running').count()) === 0); i++) await sleep(200);
      check((await t('decision-card').count()) === 2 && (await t('risk-strip').count()) === 2, `${tag}: Compare shows two decision cards, each with a risk strip`);
      check((await overflow()) <= 0, `${tag}: the Compare page does not scroll sideways`);
      await t('back-to-chat').click(); await t('nav-diagram').click(); await t('dg-delegation-chain').waitFor(); // back where the flow continues
      await t('dg-delegation-chain').click(); await page.locator('.react-flow__node').first().waitFor(); await sleep(600);
      if (width < 600) {
        check(await t('diagram-hint').isVisible(), `${tag}: the diagram says it is wider than the screen and how to pan`);
        const fit = await page.evaluate(() => {
          const c = document.querySelector('[data-testid="diagram-canvas"]').getBoundingClientRect();
          return [...document.querySelectorAll('.react-flow__node')].slice(0, 2).map((n) => { const r = n.getBoundingClientRect(); return r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom; });
        });
        check(fit.length === 2 && fit.every(Boolean), `${tag}: the first view shows the first two boxes whole (${fit.join(',')})`);
        console.log(`INFO  ${tag}: first-view node font ${await page.evaluate(() => { const n = document.querySelector('.react-flow__node .dnode'); const z = Number(/matrix\(([^,]+)/.exec(getComputedStyle(document.querySelector('.react-flow__viewport')).transform)?.[1] || 1); return `${(parseFloat(getComputedStyle(n).fontSize) * z).toFixed(1)}px on screen (zoom ${z.toFixed(2)})`; })}`);
      } else check(!(await t('diagram-hint').isVisible()), `${tag}: the pan hint is for phones only`);
      if (tag === 'desktop-dark') await page.screenshot({ path: path.join(shots, 'diagram-dark.png'), fullPage: true });
      await t('speed').selectOption('800'); await t('simulate').click(); await t('diagram-now').waitFor(); await sleep(1100);
      check(/Step [2-6]:/.test(await t('diagram-now').innerText()), `${tag}: Simulate advances at the chosen speed`);
      await t('diagram-reset').click();
      await page.locator('.react-flow__node').first().scrollIntoViewIfNeeded(); // the drag needs the box inside the viewport, whatever sits above it
      const box = await page.locator('.react-flow__node').first().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 }); await page.mouse.up();
      check((await t('diagram-moved').innerText()).includes('Moved: 1 box'), `${tag}: a box can be moved`);
      await t('diagram-reset').click(); await sleep(200);
      check((await t('diagram-moved').innerText()).includes('Moved: 0 box'), `${tag}: Reset restores the box positions`);

      await t('theme-select').selectOption('dark');
      check((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark', `${tag}: the theme picker sets data-theme=dark`);
      await t('theme-select').selectOption('auto');
      check((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === null, `${tag}: the theme picker back on Auto clears data-theme`);
      await t('nav-agent').click(); await page.keyboard.press('p'); await t('presenter-say').waitFor();
      check((await t('nav').count()) === 0 && (await t('banner').isVisible()), `${tag}: presenter mode hides the nav and keeps the banner`);
      check((await overflow()) <= 0, `${tag}: presenter mode does not scroll sideways (${await overflow()} px)`);
      check((await page.locator('main').boundingBox()).width > width * 0.8, `${tag}: presenter mode gives the content the full width`);
      await page.keyboard.press('Escape'); await t('nav').waitFor();

      await t('reset').click(); await sleep(500);
      check((await t('nav-page-consent').count()) === 0 && (await t('nav-page-approval').count()) === 0, `${tag}: Reset removed the extra pages`);
      await t('nav-runs').click(); await t('history-empty').waitFor();
      check(true, `${tag}: Reset emptied the run history`);
      check(external.length === 0, `${tag}: no request to another origin (${external.length})`);
      check(errors.length === 0, `${tag}: no unexpected console error (${errors.slice(0, 2).join(' | ')})`);
      await ctx.close();
    }
  }

  // ---- The agent page layout (Step 1 review): three columns, fitted sequence, hand-off in the conversation, What to type, one-row header ----
  for (const [width, height] of [[1280, 900], [1440, 900], [1600, 900]]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `agent-${width}-${scheme}`;
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/status of (403|409|501)/.test(m.text())) errors.push(m.text()); });
      const t = (id) => page.getByTestId(id);
      const pick = async (uc) => { const sel = t('wtt-select'); await sel.waitFor(); await sel.selectOption(uc); };
      const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height } : null; }, sel);
      // every direct part of the shell bar sits on one row: their vertical ranges all overlap
      const oneRow = () => page.evaluate(() => {
        const parts = [...document.querySelectorAll('.shell-bar > *')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0);
        // Cluster tops within 8 px: parts on the same visual row share a top even if their heights differ.
        const tops = parts.map((r) => r.top).sort((a, b) => a - b);
        const rows = tops.reduce((n, t, i) => (i === 0 || t - tops[i - 1] > 8 ? n + 1 : n), 0);
        // This lab's shell bar also carries the Demo guide button; at 1280 it may wrap to two rows. At most two, never three.
        return rows <= 2;
      });
      await page.goto(`${base}/`);
      await t('wtt-select').waitFor();
      await t('theme-select').selectOption(scheme);
      check(await oneRow(), `${tag}: the shell bar is one row`);
      const wtt = await t('what-to-type').innerText();
      check((await t('wtt-heading').innerText()).toUpperCase() === 'WHAT TO TYPE · AIRLINE · LARKSPUR AIR' && wtt.includes('show my upcoming trips'), `${tag}: What to type names the vertical and lists its prompts`);
      check((await t('wtt-select').locator('optgroup[label="Opens its own app"]').count()) >= 1, `${tag}: What to type has an Opens its own app group`);

      await pick('UC1'); await t('turn-answer').waitFor(); await sleep(300);
      // a chat turn is the message and one reply (owner 2026-11-09): no reasoning, token cards or hop pills; those stay in the evidence column
      const lastTurn = () => page.getByTestId('turn').last();
      const onlyReply = async () => { const tx = await lastTurn().innerText(); return (await lastTurn().getByRole('button', { name: /^Hop \d/ }).count()) === 0 && !/Reasoning|Tokens used|Step 1|routing table/i.test(tx); };
      check(await onlyReply() && (await lastTurn().getByTestId('turn-who').innerText()).toUpperCase() === 'AGENT' && (await lastTurn().getByTestId('turn-answer-text').innerText()) === 'You have 2 upcoming trips: LK 214 to Denver on Friday, seat 14C; and LK 560 to Boston on December 4, seat 22A. You also have 18,400 miles on file.', `${tag}: UC1 is the message and the agent's answer only, a real sentence with lab-invented amounts`);
      // go deeper and the use case panel are in the evidence column, not the chat (owner 2026-11-09)
      check((await lastTurn().getByTestId('go-deeper').count()) === 0 && (await t('agent-column').getByTestId('uc-panel').count()) === 0 && (await t('evidence-column').getByTestId('go-deeper').innerText()).toLowerCase().includes('go deeper in') && (await t('evidence-column').getByTestId('uc-panel').count()) === 1, `${tag}: go deeper and the use case panel sit in the evidence column, not the reply`);
      check((await t('evidence-why').innerText()).includes('Matched your words to “Delegated access (consent only)”') && (await t('evidence-count').innerText()).startsWith('Delegated access (consent only) ·'), `${tag}: the reasoning and the hops are in the evidence column`);
      await pick('UC13'); await page.getByTestId('turn').nth(1).getByTestId('turn-answer').waitFor();
      // Owner 2026-11-16: use-case ids mean nothing in the demo; the page says each use case in words. After two runs, nothing visible (text, tooltips, labels) names one by id.
      const idsShown = await page.evaluate(() => { const re = /\bUC[-\w.]*\d\w*/; const hit = []; const els = document.body.querySelectorAll('*');
        for (const e of els) { const r = e.getBoundingClientRect(); if (!r.width && !r.height) continue; const own = [...e.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ');
          for (const v of [own, e.getAttribute('title'), e.getAttribute('aria-label'), e.getAttribute('placeholder')]) if (v && re.test(v)) hit.push(v.trim().slice(0, 60)); } return hit.slice(0, 3); });
      check(idsShown.length === 0, `${tag}: no use-case id is shown anywhere on the page, only words (${idsShown.join(' | ')})`);
      check(await onlyReply() && (await lastTurn().getByTestId('turn-who').innerText()).toUpperCase() === 'AUTHORIZE' && (await lastTurn().getByTestId('turn-answer-text').innerText()).startsWith('Authorize refused this request'), `${tag}: the forged actor is Authorize's refusal in plain words`);
      await pick('UC1'); await page.getByTestId('turn').nth(2).getByTestId('turn-answer').waitFor(); await sleep(300);
      const [side, agent, ev] = [await rect('.setup'), await rect('.agentcol'), await rect('.evcol')];
      check(Math.abs(side.t - agent.t) < 2 && Math.abs(agent.t - ev.t) < 2 && side.r <= agent.l && agent.r <= ev.l, `${tag}: sidebar | agent | evidence side by side (lefts ${Math.round(side.l)}, ${Math.round(agent.l)}, ${Math.round(ev.l)})`);
      check(agent.w >= 370 && agent.w <= 480 && ev.w > agent.w, `${tag}: agent column ${Math.round(agent.w)} px (380-470), evidence wider (${Math.round(ev.w)} px)`);
      const fit = () => page.evaluate(() => {
        const sc = document.querySelector('.sq-scroll'); const box = sc.getBoundingClientRect();
        const lanes = [...sc.querySelectorAll('.sq-lane')].map((g) => g.getBoundingClientRect());
        return { sw: sc.scrollWidth, cw: sc.clientWidth, zoom: document.querySelector('[data-testid="sequence-svg"]').getAttribute('data-zoom'), lanes: lanes.length, inside: lanes.every((r) => r.left >= box.left - 1 && r.right <= box.right + 1) };
      });
      let f = await fit();
      check(f.zoom === 'fit' && f.sw <= f.cw && f.lanes >= 4 && f.inside, `${tag}: the embedded sequence fits at the default zoom (${f.lanes} lanes, ${f.sw} of ${f.cw} px, all in view)`);
      await page.getByRole('button', { name: 'Zoom in' }).click(); await page.getByRole('button', { name: 'Zoom in' }).click();
      check((await page.getByTestId('sequence-svg').getAttribute('data-zoom')) !== 'fit', `${tag}: + overrides the fit`);
      await t('seq-fit').click(); f = await fit();
      check(f.zoom === 'fit' && f.sw <= f.cw, `${tag}: Fit returns to the fitted view`);
      check(await oneRow(), `${tag}: the shell bar is still one row with the More menu (${await t('nav-more').count()})`);

      // the actor card is a FloatingDialog (owner 2026-11-09): drag it by the title bar, it has Pop out, and the pop-out is a live same-origin window
      await page.getByRole('button', { name: 'Gateway actor details (top)' }).click();
      const card = page.getByRole('dialog', { name: 'Gateway actor details' });
      await card.waitFor();
      check(await card.getByRole('button', { name: 'Pop out to a new window' }).isVisible(), `${tag}: the actor card has a Pop out button`);
      const before = await card.boundingBox();
      const bar = card.getByTestId('fd-titlebar').locator('.fd-title');
      const b = await bar.boundingBox();
      await page.mouse.move(b.x + 20, b.y + b.height / 2); await page.mouse.down();
      await page.mouse.move(b.x - 100, b.y + b.height / 2 + 80, { steps: 6 }); await page.mouse.up();
      const after = await card.boundingBox();
      check(Math.round(before.x - after.x) === 120 && Math.round(after.y - before.y) === 80, `${tag}: the actor card drags by its title bar (moved ${Math.round(after.x - before.x)}, ${Math.round(after.y - before.y)})`);
      await card.getByTestId('fd-titlebar').focus(); await page.keyboard.press('ArrowRight');
      check(Math.round((await card.boundingBox()).x - after.x) === 10, `${tag}: arrow keys on the focused title bar move the card`);
      if (width === 1280) await page.screenshot({ path: path.join(shots, `actor-card-${scheme}.png`) });
      if (width === 1280) {
        const [pop] = await Promise.all([page.waitForEvent('popup'), card.getByRole('button', { name: 'Pop out to a new window' }).click()]);
        await pop.getByRole('dialog', { name: 'Gateway actor details' }).waitFor();
        check(pop.url() === 'about:blank' && (await pop.getByTestId('actor-card').innerText()).includes('Checks every call'), `${tag}: Pop out opens a same-origin blank window showing the card`);
        check((await t('fd-placeholder').innerText()).includes('open in a separate window') && (await page.getByRole('dialog').count()) === 0, `${tag}: the page shows the placeholder while the card is popped out`);
        check(await pop.evaluate(() => getComputedStyle(document.querySelector('.fd-popout-layout')).display === 'flex'), `${tag}: the popped-out window has the page's stylesheets`);
        await pop.close(); await card.waitFor();
        check((await t('fd-placeholder').count()) === 0, `${tag}: closing the window brings the card back into the page`);
        const [pop2] = await Promise.all([page.waitForEvent('popup'), card.getByRole('button', { name: 'Pop out to a new window' }).click()]);
        await pop2.getByRole('dialog', { name: 'Gateway actor details' }).waitFor();
        check(await pop2.evaluate(() => document.activeElement?.classList.contains('fd-popout-layout')), `${tag}: the popped-out card has focus`);
        const closed = pop2.waitForEvent('close', { timeout: 5000 }).catch(() => {});
        await pop2.keyboard.press('Escape').catch(() => {}); await closed; // the window closes mid-press
        check(pop2.isClosed() && (await page.getByRole('dialog').count()) === 0 && (await t('fd-placeholder').count()) === 0, `${tag}: Escape in the popup, with nothing clicked there, closes it and the card`);
        await page.getByRole('button', { name: 'Gateway actor details (top)' }).click(); await card.waitFor();
      }
      await page.keyboard.press('Escape');
      check((await page.getByRole('dialog').count()) === 0, `${tag}: Escape closes the actor card`);
      await pick('UC27'); await t('turn-approval').waitFor();
      check(await onlyReply() && (await lastTurn().getByTestId('turn-who').innerText()).toUpperCase() === 'FARE RULE', `${tag}: the second-factor hold is labelled with the lab's fare rule (not Authorize) and carries no reasoning or pills`);
      check((await lastTurn().getByTestId('turn-approval-say').innerText()) === "I'm ready to book a business seat on LK 704 to Paris for $2,400.", `${tag}: the held booking says what the agent is ready to do, with the flight and the fare`);
      // The hold opened the mock phone; deny it so the rest of the flow is not behind its backdrop.
      if (await t('mp-deny').isVisible().catch(() => false)) { await t('mp-deny').click(); await t('mp-outcome').waitFor(); }
      check(!/mock result of|Here is what I found/.test(await t('agent-column').innerText()), `${tag}: nothing in the chat says mock result of`);
      check(await oneRow(), `${tag}: the shell bar is still one row after a second extra page`);
      check((await page.evaluate(() => [...document.querySelectorAll('[data-testid="nav-more"] option')].length)) === 3, `${tag}: both extra pages are in the More menu`);
      if (scheme === 'light') await page.screenshot({ path: path.join(shots, `agent-${width}.png`) });

      // a hand-off chip: the reply is one line and the card's buttons in the conversation, in view; why it hands off is in the evidence column
      const visibleCard = () => page.evaluate(() => {
        const cards = document.querySelectorAll('[data-testid="turn"] [data-testid="handoff-card"]'); const c = cards[cards.length - 1];
        if (!c) return { ok: false };
        const r = c.getBoundingClientRect(); const box = c.closest('.agentcol__scroll').getBoundingClientRect();
        return { ok: r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.bottom <= window.innerHeight, top: Math.round(r.top), bottom: Math.round(r.bottom), box: [Math.round(box.top), Math.round(box.bottom)] };
      });
      await pick(await t('wtt-select').locator('optgroup[label="Opens its own app"] option').first().getAttribute('value')); await sleep(300);
      let v = await visibleCard();
      check(v.ok, `${tag}: a hand-off chip shows the hand-off card in the conversation, in view without scrolling (${v.top}-${v.bottom} in ${v.box})`);
      check(await onlyReply() && (await lastTurn().getByTestId('turn-handoff-say').innerText()).startsWith('This is handled in ') && (await t('handoff-why').innerText()).includes('runs in its own app'), `${tag}: the hand-off reply is one line; its reasoning is in the evidence column`);
      check((await t('agent-status').innerText()) === 'Ready to hand off', `${tag}: the agent status reads Ready to hand off`);
      await t('search').fill('UC2.6'); await t('uc-UC2.6').click(); await t('search').fill(''); await sleep(300);
      v = await visibleCard();
      check(v.ok && (await page.getByTestId('turn').last().getByTestId('turn-said').innerText()).startsWith('A2A generalist mismatch'), `${tag}: a hand-off picked in the sidebar answers in the conversation with the card in view`);
      if (scheme === 'light') await page.screenshot({ path: path.join(shots, `agent-${width}-handoff.png`) });
      check((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${tag}: the agent page does not scroll sideways`);

      // resume: the tab leaves for the other app and comes Back with ?returned=: the chat is restored (words and outcomes, no run), a note says so, the query is gone
      const turnsBefore = await page.getByTestId('turn').count();
      await page.goto(`${base}/?returned=a2a-lab&uc=UC2.6`); await t('turn-note').waitFor();
      check((await page.getByTestId('turn').count()) === turnsBefore && (await t('turn-note').innerText()) === 'Back from a2a-lab' && (await page.evaluate(() => window.location.search)) === '', `${tag}: Back from a2a-lab restores ${turnsBefore} turns, adds the note and cleans the address bar`);
      check((await t('turn-restored').first().innerText()).includes('run it again') && (await page.getByTestId('turn-tokens').count()) === 0 && !(await page.evaluate(() => Object.values(sessionStorage).join(''))).includes('eyJ'), `${tag}: restored runs say run it again; no token on the page or in sessionStorage`);

      await t('full-sequence').click(); await t('page-sequence').waitFor();
      if (!(await t('sequence-view').count())) { await page.getByTestId('uc-UC1').click(); await t('sequence-view').waitFor(); }
      f = await fit();
      check(f.zoom === 'fit' && f.sw <= f.cw && f.inside, `${tag}: the full-page sequence fits at the default zoom (${f.sw} of ${f.cw} px)`);
      check(errors.length === 0, `${tag}: no unexpected console error (${errors.slice(0, 2).join(' | ')})`);
      await ctx.close();
    }
  }

  // ---- Today's demo set: the lab opens on All use cases; "Today's demo (8)" narrows the airline pack to its eight cases, and the choice is remembered ----
  {
    const tag = 'demo-set';
    const ctx = await rawContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { window.localStorage.setItem('aag.setup', '0'); } catch { /* storage blocked */ } });   // the sidebar opens collapsed: this block drives its picker
    const page = await ctx.newPage();
    const t = (id) => page.getByTestId(id);
    await page.goto(`${base}/`); await t('uc-UC1').waitFor(); // on All use cases the first track is open and the others are folded
    check((await t('set-all').getAttribute('aria-pressed')) === 'true' && (await t('set-demo').innerText()).includes('(8)'), `${tag}: the page opens on All use cases, with Today's demo (8) one click away`);
    check((await t('uc-UC1').count()) === 1 && (await t('wtt-select').locator('option[value="UC1"]').count()) === 1, `${tag}: a use case outside the eight is listed, in the list and in What to type`);
    await t('set-demo').click();
    check((await t('set-demo').getAttribute('aria-pressed')) === 'true' && (await t('uc-UC1').count()) === 0 && (await t('uc-UC6').count()) === 1, `${tag}: Today's demo (8) lists only the eight`);
    check((await t('wtt-select').locator('option[value="UC1"]').count()) === 0 && (await t('wtt-select').locator('option[value="UC7"]').count()) === 1, `${tag}: What to type lists only the eight`);
    await page.reload(); await t('uc-UC7').waitFor();
    check((await t('set-demo').getAttribute('aria-pressed')) === 'true' && (await t('uc-UC1').count()) === 0, `${tag}: the choice is remembered after a reload`);
    await t('set-all').click(); await t('uc-UC1').waitFor();
    check((await t('set-all').getAttribute('aria-pressed')) === 'true' && (await t('wtt-select').locator('option[value="UC1"]').count()) === 1, `${tag}: All use cases brings the rest back`);
    await ctx.close();
  }

  // ---- The airline walkthrough (the default pack, Larkspur Air): the seven steps, the rule in one breath, step 6's nine buttons with the five rungs, Compare, no use case id, no banned word ----
  for (const [width, height, name] of [[1280, 900, 'desktop'], [375, 800, 'phone']]) {
    const tag = `airline-walkthrough-${name}`;
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    const errors = []; const external = [];
    page.on('request', (r) => { if (!r.url().startsWith(base) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of (403|409|501)/.test(m.text())) errors.push(m.text()); });
    const t = (id) => page.getByTestId(id);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const lit = async () => page.locator('[data-testid="risk-strip"] [aria-current="step"]').getAttribute('data-testid');
    const idsShown = () => page.evaluate(() => { const re = /\bUC[-\w.]*\d\w*/; const hit = []; for (const e of document.body.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (!r.width && !r.height) continue; const own = [...e.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' '); for (const v of [own, e.getAttribute('title'), e.getAttribute('aria-label'), e.getAttribute('placeholder')]) if (v && re.test(v)) hit.push(v.trim().slice(0, 60)); } return hit.slice(0, 3); });
    await page.goto(`${base}/`); await t('uc-UC1').waitFor();
    check((await t('vertical').inputValue()) === 'airline' && (await t('wtt-heading').innerText()).toUpperCase().includes('LARKSPUR AIR'), `${tag}: the page opens on the airline pack (Larkspur Air) by default`);
    check((await t('vertical').locator('option').first().innerText()).includes('Larkspur Air'), `${tag}: the vertical menu lists Larkspur Air first`);
    const starters = (await t('starters').innerText()).toUpperCase();
    check(['PERMIT', 'CONSTRAINED'].every((w) => starters.includes(w)), `${tag}: the starter cards show the airline outcomes, CONSTRAINED among them`);
    // the Demo guide's own words for steps 5 and 6 (the airline overrides), read before Presenter mode
    await t('help-link').click(); await t('demo-guide').waitFor();
    const guideAllow = await t('guide-step-allow').innerText(); const guideEscalate = await t('guide-step-escalate').innerText();
    check(guideAllow.includes('five controls') && !guideAllow.includes('four controls'), `${tag}: the Demo guide's step 5 says five controls`);
    check(guideEscalate.includes('a domestic booking up to $400 is allowed as asked; an international booking, or one over $400 and up to $1,500, is booked but only in economy; over $1,500, domestic or international, a person approves'), `${tag}: the Demo guide's step 6 carries the rule in one breath, with the numbers the cast owns`);
    check(guideEscalate.includes("the lab's own") && !/\bUC\d/.test(guideAllow + guideEscalate) && !/mock|simulat|engine|scripted/i.test(guideAllow + guideEscalate), `${tag}: the guide says the limits are the lab's own and shows no use case id or banned word`);
    await walk(page, `${tag}: the Demo guide`);
    await page.keyboard.press('Escape'); await t('demo-guide').waitFor({ state: 'detached' }).catch(() => {});
    await page.keyboard.press('p'); await t('agenda-steps').waitFor();
    const ids = ['start', 'identity', 'call', 'evaluate', 'allow', 'escalate', 'audit'];
    check((await Promise.all(ids.map((id) => t(`agenda-pill-${id}`).count()))).every((n) => n === 1), `${tag}: the seven walkthrough steps are there`);
    await walk(page, `${tag}: Presenter mode, step 1`);
    await t('agenda-pill-escalate').click();
    const labels = await Promise.all(['run-UC7', 'run-UC8', 'run-UC48', 'run-UC6', 'run-UC27', 'run-UC31', 'run-UC13', 'compare-careful-poisoned', 'compare-same-fare'].map((k) => t(`agenda-${k}`).innerText()));
    check(labels.join('|') === ['Allowed as asked: domestic, up to $400', 'Constrained: international, business becomes economy', 'Constrained: over $400, business becomes economy', "Needs a person's approval: over $1,500", 'Approval claimed, not proven: needs a second factor', 'Out of scope: refused', 'Manipulated agent: refused', 'Poisoned instructions: a person must approve', 'Compare: same fare, domestic against international'].join('|'), `${tag}: step 6 has the nine buttons in order (${labels.join(' | ')})`);
    // the five rungs: each button's run lands on its own rung, in words
    const expected = [['UC7', 'ALLOWED', 'risk-1'], ['UC8', 'CONSTRAINED', 'risk-2'], ['UC48', 'CONSTRAINED', 'risk-2'], ['UC6', 'ESCALATED', 'risk-4'], ['UC27', 'ESCALATED', 'risk-3'], ['UC31', 'DENIED', 'risk-5'], ['UC13', 'DENIED', 'risk-5']];
    for (const [uc, word, rung] of expected) {
      await t(`agenda-run-${uc}`).click();
      await page.waitForFunction((w) => document.querySelector('[data-testid="decision-word"]')?.textContent === w, word, { timeout: 15000 });
      await page.waitForFunction((r) => document.querySelector('[data-testid="risk-strip"] [aria-current="step"]')?.getAttribute('data-testid') === r, rung, { timeout: 5000 }).catch(() => {});
      check((await t('decision-word').innerText()) === word && (await lit()) === rung && (await t('risk-strip').locator('li').count()) === 5, `${tag}: the ${uc === 'UC48' ? 'over-the-limit booking' : uc} run says ${word} and lights ${rung} of five`);
      if (uc === 'UC8' || uc === 'UC48') check((await t('decision-seat').innerText()) === 'business asked, economy booked' && (await t('mp-deny').count()) === 0, `${tag}: the narrowed booking says business asked, economy booked, and opens no phone`);
      if (uc === 'UC6' && (await t('mp-approve').isVisible().catch(() => false))) {
        await t('mp-approve').click(); await t('mp-outcome').waitFor();
        const o = await t('mp-outcome').innerText();
        check(/recorded/.test(o) && /not run/.test(o) && !/proceeds/.test(o), `${tag}: the phone's approval on the held booking says it is recorded and not run, never that the lab proceeds`);
      }
      if (await t('mp-deny').isVisible().catch(() => false)) { await t('mp-deny').click(); await t('mp-outcome').waitFor(); }
    }
    // typed words that change the rule never run the staged booking (review fix): number words, another cabin, no number
    for (const typed of ['book a business seat to Denver for five hundred dollars', 'book a first class seat to Denver for $380']) {
      const before = await t('turn').count();
      await t('composer-input').fill(typed); await t('composer-send').click(); await t('turn-nomatch').last().waitFor();
      check((await t('turn').count()) === before + 1 && (await t('turn-nomatch').last().innerText()).startsWith('I have no answer for that'), `${tag}: "${typed}" matches nothing, so the staged $380 booking does not run`);
    }
    check((await t('turn-narrowed').count()) >= 1 && (await t('turn-narrowed').first().innerText()) === 'Narrowed: business to economy', `${tag}: the chat shows the chip Narrowed: business to economy`);
    if (width < 600) {
      await t('agenda-run-UC8').click(); await page.waitForFunction(() => document.querySelector('[data-testid="decision-word"]')?.textContent === 'CONSTRAINED');
      const g = await page.evaluate(() => { const strip = document.querySelector('[data-testid="risk-strip"]'); const box = strip.getBoundingClientRect(); const r = [...strip.querySelectorAll('li')].map((l) => l.getBoundingClientRect()); return { strip: Math.round(box.width), w: r.map((x) => Math.round(x.width)), tops: r.map((x) => Math.round(x.top)) }; });
      check(g.w.length === 5 && g.tops[0] === g.tops[1] && g.tops[2] === g.tops[3] && g.tops[4] > g.tops[3] && g.w[4] >= g.strip - 2 && g.w[0] < g.strip * 0.6, `${tag}: at 375 px the five rungs read 2 + 2 + 1 (widths ${g.w.join(',')} in ${g.strip})`);
    }
    await walk(page, `${tag}: Presenter mode, step 6 after the runs`);
    // Compare: the same fare, domestic against international
    await t('agenda-compare-same-fare').click(); await t('page-compare').waitFor();
    for (let i = 0; i < 60 && !((await t('decision-card').count()) === 2 && (await t('compare-running').count()) === 0); i++) await sleep(200);
    check((await t('compare-presets').getByRole('button').allInnerTexts()).join('|') === 'Allowed vs denied|Same fare, domestic vs international|Same ask, two fares|Same tool, different person|Careful vs poisoned instructions', `${tag}: Compare lists the airline's five pairs`);
    check((await t('decision-card').count()) === 2 && (await t('risk-strip').count()) === 2 && (await t('risk-strip').first().locator('li').count()) === 5, `${tag}: Compare shows two decision cards with five-rung strips`);
    const diff = async (k) => (await t(`compare-row-${k}`).getAttribute('data-diff')) === 'true';
    check((await diff('verdict')) && (await diff('policy')) && (await diff('decision')) && (await diff('seat')) && !(await diff('agent')) && !(await diff('principal')) && !(await diff('tool')), `${tag}: same fare, domestic against international: verdict, policy, decision and seat rows differ; agent, principal and tool do not`);
    check((await t('compare-why').innerText()).includes('The flag, not the price, made the difference.'), `${tag}: the pair says the flag, not the price, made the difference`);
    await t('compare-two-fares').click();
    for (let i = 0; i < 60 && !((await t('decision-card').count()) === 2 && (await t('compare-running').count()) === 0); i++) await sleep(200);
    check((await diff('seat')) && (await t('compare-why').innerText()).includes('$780 is over it'), `${tag}: the two-fares pair differs on the seat row`);
    await t('compare-careful-poisoned').click();
    for (let i = 0; i < 60 && !((await t('decision-card').count()) === 2 && (await t('compare-running').count()) === 0); i++) await sleep(200);
    check((await t('compare-why').innerText()).includes('a person must approve it') && (await t('compare-side-1').getByTestId('decision-word').innerText()) === 'ESCALATED', `${tag}: poisoned instructions end in a person's approval (ESCALATED), not a refusal`);
    check((await overflow()) <= 0, `${tag}: Compare does not scroll sideways (${await overflow()} px)`);
    await walk(page, `${tag}: Compare`);
    check((await idsShown()).length === 0, `${tag}: no use case id is shown anywhere (${(await idsShown()).join(' | ')})`);
    check(external.length === 0 && errors.length === 0, `${tag}: no request to another origin and no console error (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }

  // ---- The Agent to agent page (owner, 2026-11-09: keep #page-a2a): UC2's chip runs here, opens the page, and offers going deeper in a2a-lab ----
  {
    const tag = 'a2a-page';
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of (403|409|501)/.test(m.text())) errors.push(m.text()); });
    const t = (id) => page.getByTestId(id);
    await page.goto(`${base}/`); await t('wtt-select').waitFor();
    check((await t('nav-page-a2a').count()) === 0, `${tag}: no Agent to agent page before a run`);
    await t('composer-input').fill('hand my trip question to the bookings specialist'); await t('composer-send').click();
    const turn = page.getByTestId('turn').last();
    await turn.getByTestId('turn-answer').waitFor();
    check((await turn.getAttribute('data-status')) === 'done' && (await turn.getByTestId('handoff-card').count()) === 0, `${tag}: "hand my trip question to the bookings specialist" runs UC2 here (no hand-off card)`);
    check((await turn.getByTestId('go-deeper').count()) === 0 && (await t('evidence-column').getByTestId('go-deeper').textContent()).includes('Go deeper in a2a-lab'), `${tag}: the evidence column (not the reply) offers going deeper in a2a-lab`);
    check((await turn.getByTestId('turn-answer-text').innerText()).startsWith('The bookings specialist answered for you: your next trip is LK 214'), `${tag}: UC2's reply is the specialist's trip answer, never the sensitive record`);
    check((await t('nav-page-a2a').innerText()) === 'Agent to agent', `${tag}: the Agent to agent page is in the More menu`);
    await t('nav-more').selectOption('page-a2a');
    const a2a = t('extra-a2a');
    await a2a.waitFor();
    const text = async () => a2a.textContent(); // textContent: headings are styled
    const pageOk = async () => { const x = await text(); return x.includes('Agent to agent') && x.includes('Opened by “A2A delegation”') && x.includes('agent-card, delegation and trust hops') && x.includes('PERMIT') && x.includes('Hops for this page') && (await a2a.getByTestId(/^row-\d+$/).count()) === 4; }; // the same Sequence as the Agent page, drawn from the page's four hops only
    check((await page.evaluate(() => window.location.hash)) === '#page-a2a' && (await pageOk()), `${tag}: the page shows its label, what it is, the outcome and only the four delegation hops of “A2A delegation”`);
    // the More menu shows the selected page's whole label (it was cut to "Agent to a"), and the shell bar still fits at 1280 and 375 px
    const moreLabel = () => page.evaluate(() => {
      const sel = document.querySelector('[data-testid="nav-more"]'); const cs = getComputedStyle(sel);
      const c = document.createElement('canvas').getContext('2d'); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const need = c.measureText(sel.selectedOptions[0].textContent).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 16; // + the arrow
      const bar = document.querySelector('.shell-bar').getBoundingClientRect();
      return { label: sel.selectedOptions[0].textContent, need: Math.ceil(need), have: Math.floor(sel.getBoundingClientRect().width), inBar: sel.getBoundingClientRect().right <= bar.right + 1, noSideScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
    });
    for (const w of [1280, 375]) {
      await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150);
      const m = await moreLabel();
      check(m.label === 'Agent to agent' && m.have >= m.need && m.inBar && m.noSideScroll, `${tag}: at ${w} px the More menu shows "${m.label}" whole (${m.have} px for ${m.need}) inside the shell bar, no sideways scroll`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await t('nav-agent').click(); await t('agent-column').waitFor();
    await page.goto(`${base}/#page-a2a`); await a2a.waitFor();
    check(await pageOk(), `${tag}: opening ${base}/#page-a2a after the run shows the page`);
    await page.screenshot({ path: path.join(shots, 'a2a-page.png') });
    check(errors.length === 0, `${tag}: no unexpected console error (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }

  // ---- The identity-provider-only path against the fake PingOne (the lab opens on its own steps here; the tab is switched with POST /api/mode) -------------------------------------------------------------------------------------------
  for (const [width, height, name] of [[1280, 900, 'desktop'], [375, 800, 'phone']]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `live-${name}-${scheme}`;
      fake.seen.length = 0; fake.state.behaviour = 'ok';
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
      const page = await ctx.newPage();
      const external = []; const errors = [];
      page.on('request', (r) => { if (!r.url().startsWith(liveBase) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const t = (id) => page.getByTestId(id);
      const watch = watchRuns(page);
      const pick = async (id) => { await t('search').fill(id); await page.locator(`[data-testid="uc-${id}"]`).click(); await t('search').fill(''); };
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.goto(`${liveBase}/`);
      await t('uc-UC1').waitFor();
      await modeMarker(page, 'mock').waitFor({ state: 'attached' });
      check((await t('mode-select').count()) === 0 && (await t('banner').innerText()) === BANNER_LOCAL, `${tag}: an identity-provider-only worker client keeps the lab on its own steps at first, with no mode control and the same neutral banner`);
      const toReal = await switchMode(page, 'real');
      check(toReal.status === 200 && toReal.body?.source === 'real' && (await t('banner').innerText()) === BANNER_LOCAL && (await t('banner').getAttribute('data-state')) === 'info', `${tag}: POST /api/mode real is allowed, the marker says live, and the banner is the same neutral line`);
      await t('search').fill('UC7'); await page.locator('[data-testid="uc-UC7"]').click(); await t('search').fill('');
      check(await t('live-persona-note').isVisible() && (await t('persona').count()) === 0 && (await t('lab-inputs').count()) === 0, `${tag}: the persona and the lab inputs are hidden in live and the note says why`);
      await t('run').click(); await t('result').waitFor();
      const liveRun = await watch.next(0);
      check((await t('outcome').innerText()) === 'LIVE_OK' && (await t('live-note-tag').count()) === 0 && (await t('matches').count()) === 0, `${tag}: UC7 here is LIVE_OK, with no source chip and no catalog-match claim`);
      check((await page.getByTestId(/^row-\d+$/).count()) === 2 && (await t('hop-source').count()) === 0 && (await t('hop-sources').count()) === 0 && liveRun?.hops?.map((h) => h.source).join() === 'real,real', `${tag}: two hops, no source chip on the page, and both hops are source real in the data`);
      await t('evtab-tokens').click();
      check((await t('token-raw').innerText()) === FAKE_TOKEN && (await t('token-claims').innerText()).includes(CLIENT_ID), `${tag}: the token is shown raw (owner 2026-11-14: not redacted) and its claims are decoded`);
      const not = await t('not-run').innerText();
      check(not.startsWith('Not run (') && not.includes('authorize-decision') && not.includes('identity provider only') && (await t('not-run').getByRole("listitem").count()) >= 1, `${tag}: the steps that were not run are listed`);
      check((await t('nav-page-approval').count()) === 0, `${tag}: a live run of UC7 opens no extra page`);
      const text = await page.locator('body').innerText();
      check(![CLIENT_SECRET, Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')].some((x) => text.includes(x)), `${tag}: the page holds no client secret (the token is shown, the secret never is)`);
      check(fake.seen.length === 2 && fake.seen[0].method === 'GET' && fake.seen[1].method === 'POST', `${tag}: the fake PingOne saw exactly two calls (GET discovery, POST token)`);
      check((await overflow()) <= 0, `${tag}: the live result does not scroll sideways (${await overflow()} px)`);
      if (tag === 'live-desktop-light' || tag === 'live-phone-dark') await page.screenshot({ path: path.join(shots, `${tag}.png`), fullPage: true });
      fake.state.behaviour = 'bad-secret';
      await t('run').click(); await page.waitForFunction(() => document.querySelector('[data-testid="outcome"]').textContent === 'LIVE_REFUSED');
      await t('evtab-sequence').click();
      const denied = (await t('row-2').getAttribute('data-verdict')) === 'deny';
      await t('evtab-tokens').click();
      check(denied && (await t('tokens').count()) === 0 && (await t('no-tokens').count()) === 1, `${tag}: a refused client secret shows a deny hop and no token`);
      await t('nav-runs').click(); await t('history').waitFor();
      check((await t('history-row').count()) === 2 && (await t('history-row').first().innerText()).includes('n/a'), `${tag}: run history lists both runs`);
      await t('nav-diagram').click(); await page.locator('.react-flow__node').first().waitFor();
      check((await overflow()) <= 0, `${tag}: the diagram page in live does not scroll sideways`);
      const toMock = await switchMode(page, 'mock');
      const seenBefore = fake.seen.length; const runsBefore = watch.runs.length;
      await t('nav-agent').click(); await pick('UC7'); await t('run').click();
      const ownRun = await watch.next(runsBefore);
      await page.waitForFunction(() => { const o = document.querySelector('[data-testid="outcome"]'); return o && !o.textContent.startsWith('LIVE_'); });
      check(toMock.status === 200 && ownRun?.mode === 'mock' && (await t('refusal').count()) === 0 && fake.seen.length === seenBefore, `${tag}: back on the lab's own steps without a restart, a run signs in with the demo persona and runs (outcome ${await t('outcome').innerText()}), no call to the fake`);
      if (await t('mp-deny').isVisible().catch(() => false)) { await t('mp-deny').click(); await t('mp-outcome').waitFor(); }
      const again = await switchMode(page, 'real');
      check(again.status === 200 && (await modeMarker(page, 'live').count()) === 1, `${tag}: and the identity-provider-only path again, same server, no restart`);
      await switchMode(page, 'mock');
      check(external.filter((u) => !u.startsWith(liveBase)).length === 0, `${tag}: the browser made no request to another origin (${external.length})`);
      check(errors.every((e) => /status of (403|409)/.test(e)), `${tag}: no unexpected console error (${errors.filter((e) => !/status of (403|409)/.test(e)).slice(0, 2).join(' | ')})`);
      await ctx.close();
    }
  }

  // ---- Full Real against the fakes: the lab OPENS in Real (the settings are complete); sign in through the modal (pi.flow), run a use case through the gateway, see the reply, a DENY, then the lab's own steps ----
  for (const [width, height, name, scheme] of [[1280, 900, 'desktop', 'light'], [375, 800, 'phone', 'dark']]) {
    const tag = `full-${name}-${scheme}`;
    // A clean slate: an explicit Sign out also forgets the lab's PingOne session (owner 2026-11-16), so this case starts signed out whatever ran before.
    await fetch(`${fullBase}/api/signout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: fullBase, 'x-workspace': 'w-eeeeeeeeeeeeeeee' }, body: '{}' });
    fullGw.seen.length = 0; fullP1.seen.length = 0; fullGw.state.behaviour = 'ok';
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
    const page = await ctx.newPage();
    const external = []; const errors = []; const navs = [];
    page.on('request', (r) => { if (!r.url().startsWith(fullBase) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(f.url()); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const t = (id) => page.getByTestId(id);
    const watch = watchRuns(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.goto(`${fullBase}/`);
    await t('uc-UC1').waitFor();
    await modeMarker(page, 'live').waitFor({ state: 'attached', timeout: 15000 });
    check((await t('mode-select').count()) === 0 && (await t('banner').innerText()) === BANNER_LOCAL && (await t('sign-in').isVisible()), `${tag}: with the full settings the lab opens in Real by itself (marker live, no mode control, the same neutral banner) and shows the Sign in button`);
    // The default airline vertical runs Real on the lab's own tool server (phase B): its reads run as the signed-in person, so no persona and no inputs and the note says so;
    // a use case that stays on the lab's own steps (UC48, the over-the-limit booking: its approval is staged by the lab) keeps its persona and inputs and has no note.
    await t('search').fill('UC1'); await page.locator('[data-testid="uc-UC1"]').click(); await t('search').fill('');
    const airCounts = [await t('persona').count(), await t('lab-inputs').count(), await t('live-persona-note').count(), await t('gateway-status').count()];
    check(airCounts.join() === '0,0,1,0', `${tag}: an airline use case the lab's own tool server answers runs as the signed-in person while the lab opens in Real: no persona, no inputs, the note says so and no gateway line is drawn (persona, inputs, note, gateway line: ${airCounts})`);
    await t('search').fill('UC22'); await page.locator('[data-testid="uc-UC22"]').click(); await t('search').fill('');
    check((await t('persona').count()) === 1 && (await t('live-persona-note').count()) === 0 && (await t('gateway-status').count()) === 1, `${tag}: an airline use case that stays on the lab's own steps keeps its persona while the lab opens in Real, with no sign-in note`);
    // The software vertical runs Real on the lab's own tool server (owner 2026-11-16): its reads run as the signed-in person, so no persona and no inputs and the
    // note says so; a use case that stays on the lab's own steps (UC25, enterprise-managed MCP: it needs an AI-DEMO2 feature flag) keeps its persona and has no note.
    await t('vertical').selectOption('software');
    await t('search').fill('UC1'); await page.locator('[data-testid="uc-UC1"]').click(); await t('search').fill('');
    check((await t('persona').count()) === 0 && (await t('lab-inputs').count()) === 0 && (await t('live-persona-note').count()) === 1, `${tag}: a software use case the lab's own tool server answers runs as the signed-in person while the lab opens in Real: no persona, no inputs, and the note says so`);
    await t('search').fill('UC25'); await page.locator('[data-testid="uc-UC25"]').click(); await t('search').fill('');
    check((await t('persona').count()) === 1 && (await t('live-persona-note').count()) === 0, `${tag}: a software use case that stays on the lab's own steps keeps its persona while the lab opens in Real, with no sign-in note`);
    // The SE gateway serves banking, healthcare and retail: the checks of its path below pick the Banking vertical.
    await t('vertical').selectOption('banking');
    await t('search').fill('UC1'); await page.locator('[data-testid="uc-UC1"]').click(); await t('search').fill('');
    await t('run').click();
    await t('signin-dialog').waitFor();
    await walk(page, `${tag}: the sign-in dialog`);
    check((await t('refusal').count()) === 0 || !/\breal\b/i.test(await t('refusal').innerText()), `${tag}: the signed-out refusal never names Real as a mode`);
    check(await t('persona').count() === 0 && await t('live-persona-note').isVisible(), `${tag}: banking UC1 goes through the gateway as the signed-in person: no persona, the note says so`);
    check((await t('signin-username').inputValue()) === DEMO_USERNAME && (await t('signin-username').getAttribute('readonly')) !== null, `${tag}: a Real run before sign-in opens the Sign in modal with the username filled in, read-only`);
    check((await t('signin-password').getAttribute('type')) === 'password' && (await t('signin-dialog').getAttribute('role')) === 'dialog', `${tag}: the modal is a dialog with a password field`);
    const geo = await page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
      const dlg = document.querySelector('[data-testid="signin-dialog"]');
      return { body: box(dlg.querySelector('.fd-body')), panel: box(dlg), pw: box(dlg.querySelector('[data-testid="signin-password"]')), submit: box(dlg.querySelector('[data-testid="signin-submit"]')), vh: window.innerHeight };
    });
    check(geo.pw.top >= geo.body.top && geo.pw.bottom <= geo.body.bottom, `${tag}: the Password field is fully inside the modal body, not clipped (${Math.round(geo.pw.top)}-${Math.round(geo.pw.bottom)} in ${Math.round(geo.body.top)}-${Math.round(geo.body.bottom)})`);
    check(geo.pw.bottom <= geo.submit.top && geo.submit.top >= geo.body.bottom && geo.submit.bottom <= geo.panel.bottom && geo.panel.bottom <= geo.vh, `${tag}: the Sign in button sits below the Password field and the body (nothing covers a field) and the whole modal is in the window`);
    if (tag === 'full-desktop-light' || tag === 'full-phone-dark') await page.screenshot({ path: path.join(shots, `${tag}-signin.png`), fullPage: false });
    if (tag === 'full-desktop-light' || tag === 'full-phone-dark') {
      // "Forgot password?" in the real browser (owner 2026-11-17): the dialog drives PingOne's recovery (the fake's flows API), then the waiting run continues.
      const NEW_PW = ['Brand', 'New-', 'Pass-', '77'].join('');
      const sentBefore = fullP1.state.recovery.sent;
      await t('signin-forgot').waitFor(); // shown once the lab has asked PingOne whether its sign-on policy offers recovery
      await t('signin-forgot').click();
      await t('signin-recover-form').waitFor();
      await walk(page, `${tag}: the recovery step of the sign-in dialog`);
      check((await t('signin-username').inputValue()) === DEMO_USERNAME && (await t('signin-username').getAttribute('readonly')) !== null && (await t('signin-new').getAttribute('type')) === 'password' && (await t('signin-confirm').getAttribute('type')) === 'password', `${tag}: Forgot password? opens the recovery step: the username read-only, the code field and two new-password fields`);
      const rgeo = await page.evaluate(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
        const dlg = document.querySelector('[data-testid="signin-dialog"]');
        // The body scrolls on a short window (the buttons are the footer, outside it): each field must be reachable by scrolling and then sit inside the body.
        const fields = ['signin-code', 'signin-new', 'signin-confirm'].map((id) => { const el = dlg.querySelector(`[data-testid="${id}"]`); el.scrollIntoView({ block: 'nearest' }); return box(el); });
        return { body: box(dlg.querySelector('.fd-body')), fields, submit: box(dlg.querySelector('[data-testid="signin-submit"]')), panel: box(dlg), vh: window.innerHeight };
      });
      check(rgeo.fields.every((f) => f.top >= rgeo.body.top - 1 && f.bottom <= rgeo.body.bottom + 1) && rgeo.submit.top >= rgeo.body.bottom - 1 && rgeo.panel.bottom <= rgeo.vh, `${tag}: each recovery field can be scrolled into the modal body, the button stays below it and the modal is in the window`);
      if (tag === 'full-desktop-light') await page.screenshot({ path: path.join(shots, `${tag}-recovery.png`), fullPage: false });
      if (tag === 'full-desktop-light') { // one email per 20 seconds for the whole lab (one mailbox): the second tag does not ask again
        await t('signin-send-code').click();
        await t('signin-info').waitFor({ timeout: 15000 });
        check(fullP1.state.recovery.sent === sentBefore + 1 && /recovery code was sent/.test(await t('signin-info').innerText()), `${tag}: Email me a code asks PingOne to send the code once and says so`);
      }
      const recoveredBefore = fullP1.state.recovery.recover.length;
      await t('signin-code').fill(RECOVERY_CODE); await t('signin-new').fill(NEW_PW); await t('signin-confirm').fill(NEW_PW + 'x');
      await t('signin-submit').click();
      await page.waitForFunction(() => /not the same/.test(document.querySelector('[data-testid="signin-error"]')?.textContent || ''), null, { timeout: 10000 });
      check(/not the same/.test(await t('signin-error').innerText()) && fullP1.state.recovery.recover.length === recoveredBefore, `${tag}: two different new passwords are refused in the dialog before anything is sent`);
      await t('signin-code').fill(RECOVERY_CODE); await t('signin-new').fill(NEW_PW); await t('signin-confirm').fill(NEW_PW);
      await t('signin-submit').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="outcome"]')?.textContent === 'REAL_PERMIT', null, { timeout: 20000 });
      check(fullP1.state.recovery.recover.length === recoveredBefore + 1 && fullP1.state.recovery.recover.at(-1).code === RECOVERY_CODE && !(await page.content()).includes(NEW_PW), `${tag}: the code and the new password went to PingOne once and are on no part of the page`);
      fullP1.state.password = DEMO_PASSWORD; // the later sign-ins of this run use the fake's own password
    } else {
      await t('signin-password').fill(DEMO_PASSWORD);
      await t('signin-submit').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="outcome"]')?.textContent === 'REAL_PERMIT', null, { timeout: 20000 });
    }
    check((await t('signin-dialog').count()) === 0 && (await t('who').innerText()).includes(DEMO_USERNAME), `${tag}: signed in, the modal closed and the header names the user`);
    // The PingOne session (owner 2026-11-16): a second tab (a new workspace) is signed in with no password and no dialog.
    const passwordsBefore = fullP1.seen.filter((c) => c.method === 'POST' && /\/flows\//.test(c.url)).length;
    const tab2 = await ctx.newPage();
    await tab2.goto(`${fullBase}/`);
    await tab2.getByTestId('uc-UC1').waitFor();
    await tab2.getByTestId('who').waitFor({ timeout: 10000 }); // a new tab opens in Real by itself
    check((await tab2.getByTestId('who').innerText()).includes(DEMO_USERNAME) && (await tab2.getByTestId('signin-dialog').count()) === 0 && fullP1.seen.filter((c) => c.method === 'POST' && /\/flows\//.test(c.url)).length === passwordsBefore, `${tag}: a second tab is signed in from the PingOne session: the header names the user, no dialog, no password sent again`);
    await tab2.close();
    const authz = fullP1.seen.filter((x) => x.url.includes('/as/authorize'));
    check(authz.length >= 1 && authz.every((x) => new URL(x.url, 'http://x').searchParams.get('response_mode') === 'pi.flow' && new URL(x.url, 'http://x').searchParams.get('code_challenge_method') === 'S256'), `${tag}: the sign-in was pi.flow with PKCE S256`);
    check(navs.length === 1 && navs[0].startsWith(fullBase), `${tag}: the page never navigated (no redirect login): ${navs.join(' | ')}`);
    const realRun = await watch.next(0);
    const srcs = (realRun?.hops || []).map((h) => h.source);
    check(srcs.length === 9 && srcs.every((x) => x === 'real') && (await t('hop-source').count()) === 0 && (await t('hop-sources').count()) === 0, `${tag}: nine hops (two token exchanges), every one source real in the data, and no source chip or "where each hop ran" list on the page (${srcs.join(',')})`);
    const seqText = await t('sequence-view').innerText();
    check((await page.getByTestId(/^row-\d+$/).count()) === 9 && seqText.includes('PingOne'), `${tag}: the Sequence draws all nine hops and names the identity provider PingOne`);
    await t('row-3').click();
    const exDetail = await t('step-detail').innerText();
    check(/eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(exDetail) && !exDetail.includes('[redacted') && exDetail.includes('act.sub'), `${tag}: the exchange step shows the real tokens whole (nothing redacted) and its key facts name the act`);
    const titles = realRun.hops.map((h) => h.title || h.label);
    check(titles[2].includes('Exchange 1: act = agent') && titles[3].includes('Exchange 2: for the gateway') && /Exchange 1: act = agent/.test(await t('sequence-view').innerText()), `${tag}: the two exchanges are named in the run and in the Sequence (${titles.slice(2, 4).join(' | ')})`);
    const tx = fullP1.seen.filter((x) => x.method === 'POST' && x.url.endsWith('/as/token')).map((x) => Object.fromEntries(new URLSearchParams(x.body))).filter((f) => f.grant_type === 'urn:ietf:params:oauth:grant-type:token-exchange');
    check(tx.length === 2 && tx[0].actor_token && !tx[1].actor_token && tx.every((f) => f.audience === undefined) && tx[0].scope === 'agent:invoke' && tx[1].scope === 'fake:mcp:invoke', `${tag}: PingOne saw exchange 1 (user + agent actor, agent:invoke) and exchange 2 (no actor, no audience, the gateway scope)`);
    // The gateway's 401 challenge hop is a call with no token on purpose (tools/list or initialize); every OTHER gateway call must carry the exchange-2 token, which has act.
    const gwAuthed = fullGw.seen.filter((c) => c.headers.authorization);
    const gwBare = fullGw.seen.filter((c) => !c.headers.authorization);
    check(gwAuthed.length > 0 && gwAuthed.every((c) => fullP1.issued.delegated.has(c.headers.authorization.slice(7))) && gwBare.every((c) => ['tools/list', 'initialize'].includes(c.rpc?.method)), `${tag}: every gateway call carried the exchange-2 token, which has act (the only token-less calls are the 401 challenge: ${gwBare.length})`);
    await t('evtab-tokens').click();
    check((await t('token').count()) === 4 && (await t('token-act').count()) === 2 && (await t('token-no-act').count()) === 0, `${tag}: the Tokens tab lists the user, agent, exchange-1 and delegated tokens; both exchange tokens show their act`);
    check((await t('turn-answer-text').last().innerText()).includes('balance 1200.5') && (await t('turn-who').last().textContent()) === 'Agent', `${tag}: the reply is the real tool result, in the Agent's voice`);
    check(fullGw.seen.map((c) => c.rpc.method).join(',') === 'initialize,notifications/initialized,tools/list,tools/call,tools/call', `${tag}: the gateway saw initialize, tools/list and tools/call`);
    check(fullGw.seen.every((c) => TRUSTED_HEADERS.every((h) => c.headers[h] === undefined) && c.headers['x-token-validation'] === 'jwks'), `${tag}: no trusted-caller header reached the gateway`);
    const body = await page.locator('body').innerText();
    check(![DEMO_PASSWORD, USER_CLIENT_SECRET, AGENT_CLIENT_SECRET, CLIENT_SECRET].some((x) => body.includes(x)) && !(await page.content()).includes(DEMO_PASSWORD), `${tag}: the page holds no password and no client secret`);
    check((await overflow()) <= 0, `${tag}: the Real result does not scroll sideways (${await overflow()} px)`);
    await page.screenshot({ path: path.join(shots, `${tag}.png`), fullPage: true });
    // The gateway scope's resource stops passing act through: the lab stops BEFORE the gateway and says so.
    const gwBefore = fullGw.seen.length; fullP1.state.resources.gateway.act = 'absent';
    await t('run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="outcome"]')?.textContent === 'REAL_NO_ACT', null, { timeout: 20000 });
    check(fullGw.seen.length === gwBefore, `${tag}: a delegated token with no act never reached the gateway`);
    check((await t('turn-answer-text').last().innerText()).includes("the delegated token carries no act claim: check the agent:invoke resource's act attribute") && (await t('token-no-act').count()) === 1, `${tag}: the reply says the delegated token carries no act claim and the token is flagged`);
    fullP1.state.resources.gateway.act = 'passthrough';
    fullGw.state.behaviour = 'deny';
    await t('run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="outcome"]')?.textContent === 'REAL_DENY', null, { timeout: 20000 });
    check((await t('turn-who').last().textContent()) === 'Authorize' && (await t('turn-answer-text').last().innerText()).startsWith('Authorize denied this request (HTTP 403'), `${tag}: a 403 from the gateway is the Authorize DENY reply`);
    fullGw.state.behaviour = 'down';
    await t('run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="outcome"]')?.textContent === 'REAL_UNREACHABLE', null, { timeout: 20000 });
    check((await t('turn-answer-text').last().innerText()).includes('answered HTTP 503 and did not complete the call'), `${tag}: a 503 is an honest refusal saying the service did not complete the call, with no advice to leave Real`);
    // A use case the gateway cannot serve (UC2, agent-to-agent) runs whole on the lab's own steps inside a Real page: the gateway is not called, the page shows it like any
    // other run (no label, no notice), and the data says so (run.realGate, hop.source).
    const gwFallback = fullGw.seen.length; const rn = watch.runs.length;
    await t('search').fill('UC2'); await page.locator('[data-testid="uc-UC2"]').click(); await t('search').fill('');
    await t('run').click();
    const fbRun = await watch.next(rn);
    await t('result').waitFor({ timeout: 20000 });
    const fsrc = (fbRun?.hops || []).map((h) => h.source);
    check(fullGw.seen.length === gwFallback && fbRun?.realGate?.real === false && fbRun?.mode === 'mock' && fsrc.length > 0 && fsrc.every((x) => x === 'mock' || x === 'not-run') && (await t('mock-in-real').count()) === 0 && (await t('hop-source').count()) === 0, `${tag}: a use case the gateway cannot serve runs whole on the lab's own steps in a Real page: no gateway call, realGate.real false, every hop source mock or not-run in the data, and nothing on the page says so (${new Set(fsrc).size} source kinds)`);
    await walk(page, `${tag}: a whole-run fallback shown like any other run`);
    const seen = fullGw.seen.length; const rn2 = watch.runs.length;
    const toOwn = await switchMode(page, 'mock');
    await t('search').fill('UC1'); await page.locator('[data-testid="uc-UC1"]').click(); await t('search').fill('');
    await t('run').click();
    const ownRun = await watch.next(rn2);
    await page.waitForFunction(() => { const o = document.querySelector('[data-testid="outcome"]'); return o && !o.textContent.startsWith('REAL_'); });
    const msrc = (ownRun?.hops || []).map((h) => h.source);
    check(toOwn.status === 200 && ownRun?.mode === 'mock' && fullGw.seen.length === seen && msrc.length > 0 && msrc.every((x) => x === 'mock' || x === 'not-run'), `${tag}: switched with POST /api/mode, no restart: the run is on the lab's own steps, no gateway call, every hop source mock or not-run`);
    check(external.length === 0, `${tag}: the browser made no request to another origin (${external.length})`);
    check(errors.every((e) => /status of (401|403|409)/.test(e)), `${tag}: no unexpected console error (${errors.filter((e) => !/status of (401|403|409)/.test(e)).slice(0, 2).join(' | ')})`);
    await ctx.close();
  }

  // ---- Real on two providers (owner 2026-11-16): the software vertical on the lab's own tool server, against the fake PingOne (the tools resource, ES256 JWKS) -------------
  // The lab's child process (the tool server, the enforcer and the approval service, loopback only) validates the fake PingOne's tokens against its JWKS. The page says
  // nothing about who answered; the DATA does (hop.provider, hop.answeredBy) and the step detail shows it as the key fact "Answered by". No real tenant, no SE.
  {
    const tag = 'local-provider';
    await fetch(`${fullBase}/api/signout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: fullBase, 'x-workspace': 'w-eeeeeeeeeeeeeeee' }, body: '{}' });
    fullGw.seen.length = 0; fullGw.state.behaviour = 'ok'; fullP1.state.full.exchange = 'ok'; fullP1.state.resources.gateway.act = 'passthrough';
    const setGroups = (g) => { fullP1.state.tools = fullP1.state.tools || {}; fullP1.state.tools.groups = g; };
    setGroups([]);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const external = []; const errors = []; const approvalStarts = [];
    page.on('request', (r) => { if (!r.url().startsWith(fullBase) && !/^(data|blob):/.test(r.url())) external.push(r.url()); if (r.method() === 'POST' && r.url().endsWith('/api/approval/start')) approvalStarts.push(JSON.parse(r.postData() || '{}')); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|409|501)/.test(m.text())) errors.push(m.text()); });
    page.on('response', async (r) => { if (r.status() === 400) console.log(`INFO  ${tag}: HTTP 400 from ${r.request().method()} ${new URL(r.url()).pathname}: ${(await r.text().catch(() => '')).slice(0, 200)} request body ${String(r.request().postData() || '').slice(0, 300)}`); });
    const t = (id) => page.getByTestId(id);
    const watch = watchRuns(page);
    const pick = async (id) => { await t('search').fill(id); await page.locator(`[data-testid="uc-${id}"]`).click(); await t('search').fill(''); };
    // Run the picked use case; when Real asks for the sign-in, sign in (the password is the fake's); return the run the page received.
    const runIt = async () => {
      const n = watch.runs.length;
      await t('run').click();
      for (let i = 0; i < 300 && !watch.runs.slice(n).some(Boolean); i++) {
        if (await t('signin-dialog').isVisible().catch(() => false)) { await t('signin-password').fill(DEMO_PASSWORD); await t('signin-submit').click(); await t('signin-dialog').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); }
        await sleep(100);
      }
      const run = await watch.next(n);
      await sleep(400);
      return run;
    };
    const runUc = async (id) => { await pick(id); return runIt(); };
    const answered = (run) => (run?.hops || []).filter((h) => h.provider !== undefined);
    const textOf = async (id) => (await t(id).innerText()).replace(/\s+/g, ' ');
    const infoOf = async (b) => (await (await fetch(`${b}/api/info`, { headers: { 'x-workspace': 'w-eeeeeeeeeeeeeeee' } })).json());

    await page.goto(`${fullBase}/`);
    await t('uc-UC1').waitFor();
    await modeMarker(page, 'live').waitFor({ state: 'attached', timeout: 15000 });
    await t('vertical').selectOption('software'); // the default is airline (its own block, local-airline, follows): this block is the software pack's own tool server
    const info = await infoOf(fullBase);
    check(info.provider?.setting === 'auto' && info.provider?.local?.state === 'ready' && info.provider?.toolsSe === false && info.provider?.hosted === false && !/https?:|secret|token|127\.0\.0\.1|localhost/i.test(JSON.stringify(info.provider)), `${tag}: /api/info says the provider setting is auto and the lab's own tool server is ready, with no URL, port, secret or token`);
    // The local services are a child process of the lab (the tool server, the enforcer and the approval service are one process, loopback only, no published port).
    const kids = spawnSync('pgrep', ['-P', String(fullServer.pid)], { encoding: 'utf8' });
    if (kids.error) console.log('INFO  pgrep is not available here: the child-process checks are skipped');
    else check(kids.stdout.trim().split('\n').filter(Boolean).length === 1, `${tag}: the lab has exactly one child process (the local services) on the Real-configured instance`);

    // UC1: a software read, real, through the lab's own tool server
    let run = await runUc('UC1');
    const seq = (run?.hops || []).map((h) => h.source);
    const th = toolHop(run);
    check(run?.kind === 'real' && run.mode === 'live' && run.outcome === 'REAL_PERMIT' && run.provider === 'local' && run.providerWhy === 'auto-se-not-configured', `${tag}: UC1 on the software vertical runs real (REAL_PERMIT) and the data says provider local, chosen by auto because no SE tool server URL is set (${run?.outcome} ${run?.provider} ${run?.providerWhy})`);
    check(seq.length > 0 && seq.every((x) => x === 'real' || x === 'not-run') && th?.provider === 'local' && th?.source === 'real' && th?.answeredBy === 'tool server (local)', `${tag}: the tool hop is source real and provider local, answered by "tool server (local)" (provider is separate from source: ${th?.source} ${th?.provider})`);
    check(answered(run).length >= 2 && answered(run).every((h) => h.provider === 'local' && h.answeredBy === 'tool server (local)') && (run?.hops || []).every((h) => h.provider !== 'se') && (run?.hops || []).filter((h) => h.source === 'not-run').every((h) => h.provider === undefined && h.answeredBy === undefined), `${tag}: every hop the provider answered says local, none says SE, and a hop that did not run names no provider (${answered(run).length} hops)`);
    check(Array.isArray(run?.gatewayTrace) && run.gatewayTrace.length === 0 && (await t('gateway-trace').count()) === 0, `${tag}: a tool server run builds no gateway trace and the page draws no What Privilege did panel`);
    const tex = fullP1.seen.filter((x) => x.method === 'POST' && x.url.endsWith('/as/token')).map((x) => Object.fromEntries(new URLSearchParams(x.body))).filter((f) => f.grant_type === 'urn:ietf:params:oauth:grant-type:token-exchange');
    const ex2 = tex[tex.length - 1];
    check(tex.length >= 2 && ex2?.scope === 'issues:read' && ex2.audience === undefined && !ex2.actor_token, `${tag}: exchange 2 asked PingOne for ONE tool scope from the one tools resource, with no audience and no actor (${ex2?.scope})`);
    check(!(await t('turn-answer-text').last().innerText()).includes('lab-invented') && (await t('turn-who').last().textContent()) !== 'Authorize', `${tag}: the reply does not say the tool data is lab-invented (owner 2026-11-18) and is not the Authorize voice`);
    check(fullGw.seen.length === 0, `${tag}: the SE gateway was not called for a software use case`);
    await t('row-' + th.n).click(); await t('step-detail').waitFor();
    const detail = await textOf('step-detail');
    check(detail.includes('Answered by') && detail.includes('tool server (local)') && (await t('hop-source').count()) === 0 && (await t('hop-provider').count()) === 0, `${tag}: the step detail of the tool hop shows the key fact "Answered by: tool server (local)" and no chip`);
    await walk(page, `${tag}: a software run answered by the lab's own tool server, step detail open`);
    await t('evtab-tokens').click(); await sleep(300);
    await walk(page, `${tag}: its tokens`);
    check(/eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(await t('token').last().innerText()) || (await t('token-raw').last().innerText()).startsWith('eyJ'), `${tag}: the delegated token is shown raw (a PingOne-issued JWT; the lab made no token)`);
    await t('evtab-sequence').click();

    // UC6: the lab's own refusal, labelled lab policy, not PingOne Authorize
    run = await runUc('UC6');
    const dh = (run?.hops || []).find((h) => h.kind === 'authorize-decision' && h.source === 'real');
    check(run?.outcome === 'REAL_DENY' && dh?.decision?.by === 'lab policy (local), not PingOne Authorize' && /^Lab policy/.test(dh?.title || '') && dh.from === 'toolserver' && dh.to === 'toolserver' && (run.hops || []).every((h) => h.to !== 'authorize' && h.to !== 'gateway' && h.from !== 'gateway'), `${tag}: UC6 (2500 issues) is REAL_DENY; the decision hop says "lab policy (local), not PingOne Authorize" and no hop is drawn to Authorize (${dh?.decision?.by})`);
    check((await t('decision-word').innerText()) === 'DENIED' && (await textOf('decision-policy')).includes('lab policy (local), not PingOne Authorize') && (await t('turn-who').last().textContent()) === 'Tool server' && (await t('turn-answer-text').last().innerText()).includes('not PingOne Authorize'), `${tag}: the page reads it as DENIED by lab policy, in the Tool server's voice`);
    check(!(await textOf('decision-card')).includes('Agent Authorize') && (await t('gateway-trace').count()) === 0, `${tag}: the decision card never credits Authorize or a gateway with the lab's own rule`);
    await walk(page, `${tag}: a refusal by the lab's own policy`);

    // UC7: held for a second factor (no challenge, nothing to approve here)
    run = await runUc('UC7');
    check(run?.outcome === 'REAL_HOLD' && !run.challenge && run.reply?.approval?.head === 'Held for step-up' && run.provider === 'local', `${tag}: UC7 (600 issues) is held for step-up: REAL_HOLD, no challenge, the reply says Held for step-up`);
    check((await t('decision-word').innerText()) === 'ESCALATED' && (await t('risk-2').getAttribute('aria-current')) === 'step', `${tag}: the decision card says ESCALATED on the second rung (a second factor)`);
    await t('mp-deny').waitFor({ timeout: 10000 }); await t('mp-deny').click(); await t('mp-outcome').waitFor();

    // UC8: held for a person, approved on the phone, the retry carries the receipt and completes (the lab's own approval service)
    const before = watch.runs.length;
    await pick('UC8');
    await t('run').click();
    await t('mp-approve').waitFor({ timeout: 20000 });
    const held = await watch.next(before);
    check(held?.outcome === 'REAL_HOLD' && typeof held.challenge === 'string' && held.provider === 'local' && held.reply?.approval?.head === 'Held for approval', `${tag}: UC8 (300 issues) is held for a person: REAL_HOLD with a challenge, provider local`);
    check(approvalStarts.length >= 1 && approvalStarts[approvalStarts.length - 1].provider === 'local' && approvalStarts[approvalStarts.length - 1].kind === 'real', `${tag}: the page told the server which service minted the challenge (provider local)`);
    await t('mp-approve').click();
    const retried = await watch.next(before + 1); // the page retries the held use case by itself once the phone approves
    check(retried?.outcome === 'REAL_PERMIT' && retried.provider === 'local' && toolHop(retried)?.answeredBy === 'tool server (local)', `${tag}: after the phone approves, the retry with the receipt completes (REAL_PERMIT) through the lab's own approval service (${retried?.outcome}: ${String(retried?.reply?.text || retried?.narration || '').slice(0, 160)})`);
    await walk(page, `${tag}: after the approval`);

    // UC9 and UC21: the tier group. Outside it UC21 is NOT OFFERED (the tool is not listed, never called) and UC9 calls it anyway and is refused; inside it both are allowed.
    run = await runUc('UC21');
    check(run?.outcome === 'REAL_NOT_LISTED' && !(run.hops || []).some((h) => ['tool-dispatched', 'tool-held', 'tool-refused'].includes(h.kind) && h.source === 'real') && (await t('decision-word').innerText()) === 'NOT OFFERED', `${tag}: outside the tier group UC21 is NOT OFFERED and the tool is never called`);
    run = await runUc('UC9');
    check(run?.outcome === 'REAL_DENY' && (await t('decision-word').innerText()) === 'DENIED' && (await textOf('decision-policy')).includes('lab policy (local), not PingOne Authorize'), `${tag}: outside the tier group UC9 calls the tool anyway and is refused by lab policy (${run?.outcome})`);
    setGroups(['Software_EnterpriseTier']);
    run = await runUc('UC21');
    const memberOk21 = run?.outcome === 'REAL_PERMIT';
    run = await runUc('UC9');
    check(memberOk21 && run?.outcome === 'REAL_PERMIT', `${tag}: with the tier group in the delegated token's groups claim both UC21 and UC9 are allowed`);
    setGroups([]);

    // UC24: a public call with no token, then a protected call with no token that the tool server must refuse with a real 401
    run = await runUc('UC24');
    const probe = (run?.hops || []).find((h) => h.kind === 'tool-refused');
    check(run?.outcome === 'REAL_PERMIT' && probe?.verdict === 'deny' && /401/.test(JSON.stringify(probe?.response || {})) && !(run.hops || []).some((h) => h.kind === 'token-exchange'), `${tag}: UC24 calls the public tool with no token and sees the protected one refused with a real 401; no exchange ran`);

    // UC30, UC31, UC42: the tool server's own edge rules
    run = await runUc('UC30');
    const scanOk = run?.outcome === 'REAL_PERMIT';
    run = await runUc('UC31');
    check(scanOk && run?.outcome === 'REAL_DENY' && (await textOf('decision-policy')).includes('lab policy (local), not PingOne Authorize'), `${tag}: the repository allow-list: the scan of an allowed repository runs, the other is refused by lab policy`);
    run = await runUc('UC42');
    check(run?.outcome === 'REAL_DENY' && !JSON.stringify(run).toLowerCase().includes('bitcoin'), `${tag}: a blocked term in a search is refused by lab policy and the term is not echoed`);

    // A tampered token: the tool server answers a real 401 and nobody falls back to anything
    tamperTools = true;
    run = await runUc('UC1');
    tamperTools = false;
    check(run?.outcome === 'REAL_TOKEN_PROBLEM' && JSON.stringify(run.hops).includes('signature_invalid') && (await t('turn-answer-text').last().innerText()).includes('did not accept the delegated token') && run.provider === 'local', `${tag}: a delegated token tampered on the way gets a real 401 from the tool server (signature_invalid), the run ends REAL_TOKEN_PROBLEM and nothing falls back (${run?.outcome})`);
    await walk(page, `${tag}: a refused token`);

    // The same use case again, no tampering: the lab recovers (the next run is a fresh run, the provider is chosen again, once)
    run = await runUc('UC1');
    check(run?.outcome === 'REAL_PERMIT' && run.provider === 'local', `${tag}: the next run with an untampered token is REAL_PERMIT again`);
    check(external.length === 0, `${tag}: the browser made no request to another origin (${external.length})`);
    check(errors.length === 0, `${tag}: no unexpected console error (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }

  // ---- Real airline tools on the lab's own tool server (phase B, owner 2026-11-16/17): the default Larkspur Air vertical, against the fake PingOne (the tools resource of eleven scopes) ----
  // The booking rule is enforced by the tool server (a separate process) from the verified token: 200 booked, 200 booked with the cabin narrowed, 428 held. The page says
  // nothing about who answered; the DATA does. No real tenant, no SE: the fakes prove the lab's reading only.
  {
    const tag = 'local-airline';
    await fetch(`${fullBase}/api/signout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: fullBase, 'x-workspace': 'w-eeeeeeeeeeeeeeee' }, body: '{}' });
    fullGw.seen.length = 0; fullGw.state.behaviour = 'ok'; fullP1.state.full.exchange = 'ok'; fullP1.state.resources.gateway.act = 'passthrough';
    const setGroups = (g) => { fullP1.state.tools = fullP1.state.tools || {}; fullP1.state.tools.groups = g; };
    setGroups([]);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const external = []; const errors = []; const approvalStarts = [];
    page.on('request', (r) => { if (!r.url().startsWith(fullBase) && !/^(data|blob):/.test(r.url())) external.push(r.url()); if (r.method() === 'POST' && r.url().endsWith('/api/approval/start')) approvalStarts.push(JSON.parse(r.postData() || '{}')); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|409|501)/.test(m.text())) errors.push(m.text()); });
    const t = (id) => page.getByTestId(id);
    const watch = watchRuns(page);
    const pick = async (id) => { await t('search').fill(id); await page.locator(`[data-testid="uc-${id}"]`).click(); await t('search').fill(''); };
    const runIt = async () => {
      const n = watch.runs.length;
      await t('run').click();
      for (let i = 0; i < 300 && !watch.runs.slice(n).some(Boolean); i++) {
        if (await t('signin-dialog').isVisible().catch(() => false)) { await t('signin-password').fill(DEMO_PASSWORD); await t('signin-submit').click(); await t('signin-dialog').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); }
        await sleep(100);
      }
      const run = await watch.next(n);
      await sleep(400);
      return run;
    };
    const runUc = async (id) => { await pick(id); return runIt(); };
    const textOf = async (id) => (await t(id).innerText()).replace(/\s+/g, ' ');
    const exchangeScopes = () => fullP1.seen.filter((x) => x.method === 'POST' && x.url.endsWith('/as/token')).map((x) => Object.fromEntries(new URLSearchParams(x.body))).filter((f) => f.grant_type === 'urn:ietf:params:oauth:grant-type:token-exchange');
    const lastEx2 = () => { const e = exchangeScopes(); return e[e.length - 1]; };
    const idsShown = () => page.evaluate(() => { const re = /\bUC[-\w.]*\d\w*/; const hit = []; for (const e of document.body.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (!r.width && !r.height) continue; const own = [...e.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' '); for (const v of [own, e.getAttribute('title'), e.getAttribute('aria-label'), e.getAttribute('placeholder')]) if (v && re.test(v)) hit.push(v.trim().slice(0, 60)); } return hit.slice(0, 3); });
    const BY = 'lab policy (local), not PingOne Authorize';
    const bookingTool = (run) => (run?.hops || []).find((h) => h.kind === 'tool-dispatched' && h.source === 'real');
    const cardWords = async (label) => { await walk(page, label); const ids = await idsShown(); check(ids.length === 0, `${label}: no use case id is visible (${ids.join(' | ')})`); };

    await page.goto(`${fullBase}/`);
    await t('uc-UC1').waitFor();
    await modeMarker(page, 'live').waitFor({ state: 'attached', timeout: 15000 });
    check((await t('vertical').inputValue()) === 'airline', `${tag}: the page is on the airline vertical (the default; it is not selected here)`);

    // UC1: the trip list, real, answered by the lab's own tool server; no persona and no lab inputs, the sign-in note says the run is made as the person who signed in
    await pick('UC1');
    check((await t('persona').count()) === 0 && (await t('lab-inputs').count()) === 0 && (await t('live-persona-note').count()) === 1, `${tag}: an airline use case the tool server answers runs as the signed-in person: no persona, no lab inputs, and the sign-in note is there`);
    let run = await runIt();
    let th = toolHop(run);
    check(run?.kind === 'real' && run.outcome === 'REAL_PERMIT' && run.provider === 'local' && run.vertical === 'airline' && run.real?.tool === 'get_airline_bookings', `${tag}: UC1 reads the traveller's trips for real (REAL_PERMIT, provider local, tool get_airline_bookings): ${run?.outcome} ${run?.provider} ${run?.real?.tool}`);
    check(th?.provider === 'local' && th?.answeredBy === 'tool server (local)' && th?.source === 'real' && fullGw.seen.length === 0, `${tag}: the tool step says it was answered by "tool server (local)" and the SE gateway was never called`);
    check(lastEx2()?.scope === 'trips:read' && lastEx2().audience === undefined && !lastEx2().actor_token, `${tag}: exchange 2 asked PingOne for ONE scope, trips:read, from the one tools resource (no audience, no actor): ${lastEx2()?.scope}`);
    check(run?.fareRule?.limit === 400 && run.fareRule.hold === 1500 && run.fareRule.from === 'business' && run.fareRule.to === 'economy' && !run.booking && !run.constrained, `${tag}: the run carries the fare rule (five rungs) and no booking`);
    check(Array.isArray(run?.gatewayTrace) && run.gatewayTrace.length === 0 && (await t('gateway-trace').count()) === 0, `${tag}: no What Privilege did panel for a tool server run`);
    check(!(await t('turn-answer-text').last().innerText()).includes('lab-invented') && (await t('risk-strip').locator('li').count()) === 5, `${tag}: the reply does not say the data is lab-invented and the strip draws five rungs`);
    await t('row-' + th.n).click(); await t('step-detail').waitFor();
    check((await textOf('step-detail')).includes('Answered by') && (await textOf('step-detail')).includes('tool server (local)'), `${tag}: the step detail shows the key fact "Answered by: tool server (local)"`);
    await cardWords(`${tag}: an airline trip list answered by the tool server, step detail open`);
    // Every token a step shows raw is also shown decoded (owner 2026-11-18): open every step of this real run and count the JWTs in the detail against the decoded blocks.
    {
      const JWT = /eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g; let seen = 0; const gaps = [];
      for (const r of await page.locator('[data-testid^="row-"]').all()) {
        await r.click().catch(() => {}); if (!(await t('step-detail').count())) continue;
        const raw = new Set(((await t('step-detail').first().textContent()) || '').match(JWT) || []);
        const decoded = await t('step-detail').first().getByTestId('decoded-token').count();
        seen += raw.size; if (raw.size > decoded) gaps.push(`${raw.size} tokens, ${decoded} decoded`);
      }
      await t('row-' + th.n).click(); await t('step-detail').waitFor(); // back on the tool step for the checks that follow
      check(seen > 0 && gaps.length === 0, `${tag}: every raw token in a step of this real run is also shown decoded (${seen} tokens seen${gaps.length ? '; gaps: ' + gaps.join(' | ') : ''})`);
    }
    // The detail box pops out (owner 2026-11-18): docked by default, a Pop out button floats it as a draggable window, Dock puts it back.
    check((await t('sdp-popout').count()) === 1 && (await t('step-detail-window').count()) === 0, `${tag}: the step detail is docked under the sequence with a Pop out button`);
    await t('sdp-popout').click();
    await t('step-detail-window').waitFor();
    check((await t('step-detail').count()) === 1 && (await textOf('step-detail-window')).includes('Answered by') && (await t('sdp-floating-note').count()) === 1, `${tag}: Pop out floats the same detail in its own window and leaves a note`);
    if (!tag.includes('phone')) { // a narrow window shows it as a sheet, which is not draggable
      const w0 = await t('step-detail-window').boundingBox(); const bar = await t('step-detail-window').getByTestId('fd-titlebar').boundingBox();
      await page.mouse.move(bar.x + 60, bar.y + bar.height / 2); await page.mouse.down(); await page.mouse.move(bar.x + 60 - 90, bar.y + bar.height / 2 + 50, { steps: 8 }); await page.mouse.up();
      const w1 = await t('step-detail-window').boundingBox();
      check(Math.abs((w0.x - w1.x) - 90) <= 4 && Math.abs((w1.y - w0.y) - 50) <= 4, `${tag}: the floating step detail is dragged by its title bar (moved ${Math.round(w0.x - w1.x)} left, ${Math.round(w1.y - w0.y)} down)`);
    }
    await t('sdp-dock-button').click();
    check((await t('step-detail-window').count()) === 0 && (await t('sdp-popout').count()) === 1 && (await t('step-detail').count()) === 1, `${tag}: Dock puts the step detail back under the sequence`);

    // UC7: Denver, $380 domestic: allowed as asked
    run = await runUc('UC7');
    let bt = bookingTool(run);
    check(run?.outcome === 'REAL_PERMIT' && run.booking?.flight === 'LK 214' && run.booking.fare === 380 && run.booking.asked === 'business' && run.booking.booked === 'business' && !run.constrained, `${tag}: the Denver booking is REAL_PERMIT, booked business as asked (${JSON.stringify(run?.booking)})`);
    check(lastEx2()?.scope === 'flights:book' && !lastEx2().audience, `${tag}: exchange 2 asked for the single scope flights:book`);
    check((await t('decision-word').innerText()) === 'ALLOWED' && (await t('risk-strip').locator('li').count()) === 5 && (await t('risk-1').getAttribute('aria-current')) === 'step' && (await textOf('decision-seat')).includes('business asked, business booked'), `${tag}: the card says ALLOWED on the first of five rungs, business asked, business booked`);
    // PingOne Authorize settings absent: the lab's own rule answers and says so, and the data carries no Authorize claim (phase C)
    const offDh = (run?.hops || []).find((h) => h.kind === 'authorize-decision' && h.source === 'real');
    check(run?.decidedBy === 'lab-policy-local' && offDh?.decidedBy === 'lab-policy-local' && run.authorize === undefined && offDh.authorize === undefined && offDh.to !== 'authorize' && (await textOf('decision-policy')).includes(BY) && !(await page.locator('body').innerText()).includes('PingOne Authorize decided'), `${tag}: with the Authorize settings absent the Denver booking is decided by the lab policy (data: decidedBy lab-policy-local, no authorize field, never "PingOne Authorize decided")`);
    check((await t('actor-authorize').count()) === 0, `${tag}: and its Sequence has no Authorize lane`);
    check(/^Booked: a business seat on LK 214 from ORD to DEN, confirmation LKR-[0-9A-F]{6}/.test(await t('turn-answer-text').last().innerText()) && !/\$|fare|price/i.test(await t('turn-answer-text').last().innerText()), `${tag}: the reply is built from the tool server's answer and names no price`);
    const sent = JSON.stringify(bt?.request || {});
    check(sent.includes('LK 214') && sent.includes('business') && !/"(fare|price|amount|international|confirmation)"/.test(sent), `${tag}: the booking call carried only the flight and the cabin, never a fare, price, amount or international flag`);

    // UC8: Toronto, $380 international: booked, economy only (CONSTRAINED), decided by the tool server
    run = await runUc('UC8');
    bt = bookingTool(run);
    const dh = (run?.hops || []).find((h) => h.kind === 'authorize-decision' && h.source === 'real');
    check(run?.outcome === 'REAL_CONSTRAINED' && run.provider === 'local' && run.constrained?.asked === 'business' && run.constrained.granted === 'economy' && run.constrained.by === BY && Array.isArray(run.constrained.because) && run.constrained.because.join() === 'international', `${tag}: the Toronto booking is REAL_CONSTRAINED, business narrowed to economy because it is international, by "${BY}"`);
    check(run?.booking?.booked === 'economy' && run.booking.asked === 'business' && run.booking.international === true && lastEx2()?.scope === 'flights:book', `${tag}: run.booking says business asked, economy booked (${JSON.stringify(run?.booking)})`);
    check(dh?.decision?.outcome === 'CONSTRAINED' && dh.decision.by === BY && dh.decision.basis === 'observed' && dh.from === 'toolserver' && dh.to === 'toolserver' && !/checked/i.test(JSON.stringify(dh.decision)), `${tag}: the decision hop is CONSTRAINED, observed from the tool server's answer, by "${BY}", never "checked"`);
    check((await t('decision-word').innerText()) === 'CONSTRAINED' && (await t('decision-card').getAttribute('data-tone')) === 'info' && (await textOf('decision-policy')).includes(BY) && (await textOf('decision-seat')).includes('business asked, economy booked'), `${tag}: the card says CONSTRAINED (blue, not red), names "${BY}" as the policy and shows business asked, economy booked`);
    check((await t('risk-strip').locator('li').count()) === 5 && (await t('risk-2').getAttribute('aria-current')) === 'step' && (await t('risk-2').innerText()).toLowerCase().includes('this run'), `${tag}: the strip has five rungs and rung two is marked "this run"`);
    check((await textOf('turn-narrowed')) === 'Narrowed: business to economy' && /^Booked in economy, not business: this trip is international\./.test(await t('turn-answer-text').last().innerText()), `${tag}: the chat chip says "Narrowed: business to economy" and the reply says why`);
    check(JSON.stringify(bt?.request || {}).includes('business') && JSON.stringify(bt?.response || {}).includes('economy') && !/(mock|simulat|engine)/i.test(String(bt?.note || '')), `${tag}: the tool step shows the cabin asked (business) and the cabin booked (economy)`);
    await t('row-' + dh.n).click(); await t('step-detail').waitFor();
    check((await textOf('step-detail')).includes('Answered by') && (await textOf('step-detail')).includes(BY), `${tag}: the decision step names the tool server and "${BY}"`);
    await cardWords(`${tag}: the Toronto booking, decision step open`);
    await t('evtab-sequence').click(); await sleep(300);
    await cardWords(`${tag}: its Sequence tab`);
    await page.setViewportSize({ width: 375, height: 800 }); await sleep(400);
    check((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0 && (await t('risk-strip').locator('li').count()) === 5, `${tag}: at 375 px wide the five rungs fit and the page does not scroll sideways`);
    await page.setViewportSize({ width: 1280, height: 900 }); await sleep(300);

    // UC6: Paris, $2,400: held for a person (428), approved on the phone, retried with the receipt and booked AS ASKED (an approval beats a narrowing)
    const before = watch.runs.length;
    await pick('UC6');
    await t('run').click();
    await t('mp-approve').waitFor({ timeout: 20000 });
    const held = await watch.next(before);
    check(held?.outcome === 'REAL_HOLD' && typeof held.challenge === 'string' && held.provider === 'local' && held.booking?.booked === null && held.booking.fare === 2400 && held.reply?.approval?.head === 'Held for approval', `${tag}: the Paris booking is held for a person (REAL_HOLD, a challenge, booking.booked null, the fare the rule judged is 2400)`);
    check((await t('decision-word').innerText()) === 'ESCALATED' && (await t('risk-4').getAttribute('aria-current')) === 'step' && (await textOf('decision-seat')).includes('business asked, not booked yet (held)'), `${tag}: the card says ESCALATED on the fourth rung, business asked, not booked yet`);
    check((await t('mock-phone').innerText()).includes('2,400'), `${tag}: the phone opens showing the fare the rule judged ($2,400)`);
    check(approvalStarts.length >= 1 && approvalStarts[approvalStarts.length - 1].provider === 'local' && approvalStarts[approvalStarts.length - 1].kind === 'real', `${tag}: the page told the server which service minted the challenge (provider local)`);
    check(!JSON.stringify({ hops: held.hops, tokens: held.tokens, gatewayTrace: held.gatewayTrace, reply: held.reply }).includes(held.challenge), `${tag}: the challenge id is in no hop, no token and not in the reply (it is a field of the run only)`);
    await t('mp-approve').click();
    const retried = await watch.next(before + 1);
    check(retried?.outcome === 'REAL_PERMIT' && retried.booking?.booked === 'business' && !retried.constrained && retried.provider === 'local', `${tag}: after the phone approves, the retry books business as asked: REAL_PERMIT, no narrowing (${retried?.outcome} ${retried?.booking?.booked})`);
    await sleep(500);
    // The retry is not a new chat turn (the page retries the held use case by itself); the evidence column shows its run and its data carries the reply.
    check(typeof retried?.reply?.text === 'string' && retried.reply.text.startsWith('Booked as approved: a business seat on LK 704 from ORD to CDG, confirmation LKR-') && (await t('decision-word').innerText()) === 'ALLOWED' && (await textOf('decision-seat')).includes('business asked, business booked'), `${tag}: the retry's reply says "Booked as approved" and the card says ALLOWED, business asked, business booked (${String(retried?.reply?.text || '').slice(0, 70)})`);
    await cardWords(`${tag}: after the approval`);

    // The tier group of the airline vertical: the private traveller record
    run = await runUc('UC21');
    check(run?.outcome === 'REAL_NOT_LISTED' && (await t('decision-word').innerText()) === 'NOT OFFERED' && !(run.hops || []).some((h) => ['tool-dispatched', 'tool-held', 'tool-refused'].includes(h.kind) && h.source === 'real'), `${tag}: outside Airline_OrbitTier the private record is NOT OFFERED and the tool is never called`);
    run = await runUc('UC9');
    check(run?.outcome === 'REAL_DENY' && JSON.stringify(run.hops).includes('group_required') && JSON.stringify(run.hops).includes('Airline_OrbitTier') && (await textOf('decision-policy')).includes(BY), `${tag}: outside the group UC9 calls the record anyway and the tool server refuses it (group_required, Airline_OrbitTier), by "${BY}"`);
    setGroups(['Software_EnterpriseTier']);
    run = await runUc('UC9');
    check(run?.outcome === 'REAL_DENY', `${tag}: the software tier group alone does not unlock the airline record (each vertical has its own group)`);
    setGroups(['Airline_OrbitTier']);
    run = await runUc('UC21');
    const memberOk = run?.outcome === 'REAL_PERMIT';
    run = await runUc('UC9');
    check(memberOk && run?.outcome === 'REAL_PERMIT' && lastEx2()?.scope === 'travellers:read', `${tag}: with Airline_OrbitTier in the delegated token's groups claim the private record is offered and allowed (scope travellers:read)`);
    setGroups([]);

    // UC24: the public airport list with no token, then the protected trip list probed with no token (a real 401); no agent token and no exchange
    run = await runUc('UC24');
    const probe = (run?.hops || []).find((h) => h.kind === 'tool-refused');
    check(run?.outcome === 'REAL_PERMIT' && probe?.verdict === 'deny' && /401/.test(JSON.stringify(probe?.response || {})) && !(run.hops || []).some((h) => h.kind === 'token-exchange' || (h.kind === 'actor-token' && h.source === 'real')), `${tag}: UC24 lists airports with no token and sees the protected trip list refused with a real 401; no token was made`);

    // The tool server's own 401 for a tampered token
    tamperTools = true;
    run = await runUc('UC1');
    tamperTools = false;
    check(run?.outcome === 'REAL_TOKEN_PROBLEM' && JSON.stringify(run.hops).includes('signature_invalid') && run.provider === 'local', `${tag}: a delegated token tampered on the way gets a real 401 from the tool server (signature_invalid) and nothing falls back (${run?.outcome})`);

    // What stays on the lab's own steps for the airline: the approval claims and the second-factor claim
    for (const id of ['UC22', 'UC27']) {
      run = await runUc(id);
      check(run?.realGate?.real === false && run.mode === 'mock' && (run.hops || []).every((h) => h.provider === undefined) && /human approval|lab only/.test(run.realGate?.reason || ''), `${tag}: ${id} stays on the lab's own steps and says why (${run?.realGate?.reason})`);
      if (await t('mp-deny').isVisible().catch(() => false)) { await t('mp-deny').click(); await t('mp-outcome').waitFor().catch(() => {}); }
    }
    const via = await page.evaluate(async (b) => { const r = await fetch(`${b}/api/run/UC48`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace': 'w-eeeeeeeeeeeeeeee' }, body: JSON.stringify({ vertical: 'airline', persona: 'standard' }) }); return { status: r.status, run: (await r.json()).run || null }; }, fullBase);
    check(via.status === 200 && via.run?.realGate?.real === false && via.run.mode === 'mock', `${tag}: the over-the-limit walkthrough booking stays on the lab's own steps (data: realGate.real false)`);

    // No SE gateway call, no foreign origin, no error, and software and banking Real are checked by their own blocks
    check(fullGw.seen.length === 0, `${tag}: the SE gateway was never called for an airline use case`);
    check(external.length === 0, `${tag}: the browser made no request to another origin (${external.length})`);
    check(errors.length === 0, `${tag}: no unexpected console error (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }

  // ---- Real with only the lab's own provider: no SE gateway name at all, AAG_PROVIDER=local (the lab runs standalone on another machine) -----------------------------------
  {
    const tag = 'local-only';
    await fetch(`${soloBase}/api/signout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: soloBase, 'x-workspace': 'w-eeeeeeeeeeeeeeee' }, body: '{}' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const external = []; const errors = [];
    page.on('request', (r) => { if (!r.url().startsWith(soloBase) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|409|501)/.test(m.text())) errors.push(m.text()); });
    const t = (id) => page.getByTestId(id);
    const watch = watchRuns(page);
    const pick = async (id) => { await t('search').fill(id); await page.locator(`[data-testid="uc-${id}"]`).click(); await t('search').fill(''); };
    const runIt = async () => {
      const n = watch.runs.length;
      await t('run').click();
      for (let i = 0; i < 300 && !watch.runs.slice(n).some(Boolean); i++) {
        if (await t('signin-dialog').isVisible().catch(() => false)) { await t('signin-password').fill(DEMO_PASSWORD); await t('signin-submit').click(); await t('signin-dialog').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); }
        await sleep(100);
      }
      const run = await watch.next(n);
      await sleep(400);
      return run;
    };
    await page.goto(`${soloBase}/`);
    await t('uc-UC1').waitFor();
    await modeMarker(page, 'live').waitFor({ state: 'attached', timeout: 15000 });
    await t('vertical').selectOption('software'); // the default is airline: this check is the software pack on the lab's own tool server
    const info = await (await fetch(`${soloBase}/api/info`, { headers: { 'x-workspace': 'w-eeeeeeeeeeeeeeee' } })).json();
    check(info.provider?.setting === 'local' && info.provider?.gateway === false && info.provider?.toolsSe === false && info.provider?.local?.state === 'ready' && info.real?.level === 'full', `${tag}: with the five app names and no gateway name Real is configured; the lab's own tool server is ready and the SE gateway is not set up`);
    await pick('UC1');
    let run = await runIt();
    check(run?.outcome === 'REAL_PERMIT' && run.provider === 'local' && run.providerWhy === 'forced' && toolHop(run)?.answeredBy === 'tool server (local)' , `${tag}: the software vertical runs real on the lab's own provider alone; AAG_PROVIDER=local says forced (${run?.outcome} ${run?.providerWhy})`);
    await t('vertical').selectOption('banking'); await pick('UC1');
    run = await runIt();
    check(run?.realGate?.real === false && run.mode === 'mock' && /airline and software verticals only|SE gateway is not set up/.test(run.realGate?.reason || '') && (run.hops || []).every((h) => h.provider === undefined), `${tag}: banking, healthcare and retail say the SE gateway is not served here and run on the lab's own steps (${run?.realGate?.reason})`);
    await walk(page, `${tag}: a banking run with no SE gateway`);
    check(external.length === 0, `${tag}: the browser made no request to another origin (${external.length})`);
    check(errors.length === 0, `${tag}: no unexpected console error (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }

  // ---- PingOne Authorize decides the airline booking (phase C, owner decision 2026-11-17): the sixth instance, a fake decision endpoint on loopback --------------------------
  // With the three AAG_AUTHORIZE_* names set the tool server asks PingOne Authorize and applies the statement code. The page says "PingOne Authorize decided" only then; a silent
  // Authorize is NO DECISION (nothing booked, the lab's own rule NOT used). The fake proves the lab's reading of an answer, not the real endpoint (UNVERIFIED until the owner's probe).
  {
    const tag = 'authorize-on';
    const az = authP1.authorize;
    az.reset(); az.setMode('ok');
    await fetch(`${authBase}/api/signout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: authBase, 'x-workspace': 'w-eeeeeeeeeeeeeeee' }, body: '{}' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const external = []; const errors = []; const approvalStarts = [];
    page.on('request', (r) => { if (!r.url().startsWith(authBase) && !/^(data|blob):/.test(r.url())) external.push(r.url()); if (r.method() === 'POST' && r.url().endsWith('/api/approval/start')) approvalStarts.push(JSON.parse(r.postData() || '{}')); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|409|501|503)/.test(m.text())) errors.push(m.text()); });
    const t = (id) => page.getByTestId(id);
    const watch = watchRuns(page);
    const pick = async (id) => { await t('search').fill(id); await page.locator(`[data-testid="uc-${id}"]`).click(); await t('search').fill(''); };
    const runIt = async () => {
      const n = watch.runs.length;
      await t('run').click();
      for (let i = 0; i < 400 && !watch.runs.slice(n).some(Boolean); i++) {
        if (await t('signin-dialog').isVisible().catch(() => false)) { await t('signin-password').fill(DEMO_PASSWORD); await t('signin-submit').click(); await t('signin-dialog').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); }
        await sleep(100);
      }
      const run = await watch.next(n);
      await sleep(400);
      return run;
    };
    const runUc = async (id) => { await pick(id); return runIt(); };
    const textOf = async (id) => (await t(id).innerText()).replace(/\s+/g, ' ');
    const idsShown = () => page.evaluate(() => { const re = /\bUC[-\w.]*\d\w*/; const hit = []; for (const e of document.body.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (!r.width && !r.height) continue; const own = [...e.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' '); for (const v of [own, e.getAttribute('title'), e.getAttribute('aria-label'), e.getAttribute('placeholder')]) if (v && re.test(v)) hit.push(v.trim().slice(0, 60)); } return hit.slice(0, 3); });
    const cardWords = async (label) => { await walk(page, label); const ids = await idsShown(); check(ids.length === 0, `${label}: no use case id is visible (${ids.join(' | ')})`); };
    const decisionHop = (run) => (run?.hops || []).find((h) => h.kind === 'authorize-decision' && h.source === 'real');
    const AZ_BY = 'PingOne Authorize (policy Larkspur Air Booking Authorization)';
    // PingOne Authorize returns PERMIT with a statement; `read` is what the lab did with the code (its own word is never put in Authorize's mouth)
    const LINE = (code, read) => `${AZ_BY} returned PERMIT with the statement ${code}; the lab read that as ${read} and applied it`;
    const NOT = (x) => !/\b(ALLOWED|DENIED|ESCALATED|CONSTRAINED)\b/.test(x);
    const calls = () => az.seen.length;
    const expectParams = (fare, intl, cabin, approval) => ({ AirLabMarker: 'larkspur-air', ToolName: 'book_airline_flight', UserId: USER_SUB, AirFare: fare, AirIsInternational: intl, AirCabinAsked: cabin, AirApproval: approval });

    await page.goto(`${authBase}/`);
    await t('uc-UC1').waitFor();
    await modeMarker(page, 'live').waitFor({ state: 'attached', timeout: 15000 });
    const info = await (await fetch(`${authBase}/api/info`, { headers: { 'x-workspace': 'w-eeeeeeeeeeeeeeee' } })).json();
    check(info.provider?.setting === 'local' && info.provider?.gateway === false && info.provider?.local?.state === 'ready' && info.provider?.authorize === true, `${tag}: Real is configured with the lab's own provider and PingOne Authorize is on (data: provider.authorize)`);

    // Denver: $380 domestic, asked in business: PingOne Authorize answers permit, the lab books as asked
    let run = await runUc('UC7');
    let dh = decisionHop(run);
    check(run?.outcome === 'REAL_PERMIT' && run.decidedBy === 'pingone-authorize' && dh?.decidedBy === 'pingone-authorize' && dh.to === 'authorize' && dh.from === 'toolserver' && dh.authorize?.code === 'airline-permit-as-asked' && run.authorize?.asked === true && run.authorize.answered === true && run.authorize.code === 'airline-permit-as-asked' && run.booking?.booked === 'business', `${tag}: the Denver booking is REAL_PERMIT and the data says PingOne Authorize decided it (code airline-permit-as-asked, hop drawn to the authorize lane)`);
    check(calls() === 1 && JSON.stringify(az.seen[0].parameters) === JSON.stringify(expectParams('380', 'false', 'business', 'none')) && az.seen[0].bearer === true, `${tag}: the fake decision endpoint saw exactly ONE call with exactly the seven canonical parameters (${JSON.stringify(az.seen[0]?.parameters)})`);
    check((await t('decision-word').innerText()) === 'ALLOWED' && (await textOf('decision-policy')).includes(LINE('airline-permit-as-asked', 'book as asked')) && !(await textOf('decision-policy')).includes('not PingOne Authorize'), `${tag}: the card says ALLOWED and its policy row is the line "${LINE('airline-permit-as-asked', 'book as asked')}"`);
    check(dh?.decision?.by === AZ_BY && dh.decision.basis === 'observed' && !/checked/i.test(JSON.stringify(dh.decision)) && dh.decision.line === LINE('airline-permit-as-asked', 'book as asked'), `${tag}: the decision hop is observed, never "checked", by "${AZ_BY}"`);
    check((await t('actor-authorize').count()) === 1 && (await t('actor-authorize').innerText()).includes('PingOne Authorize (P1AZ)') && (await t(`row-${dh.n}`).locator('.sq-msg').count()) === 1, `${tag}: the Sequence has the lane "PingOne Authorize (P1AZ)" and the decision is an arrow to it`);
    await t(`row-${dh.n}`).click(); await t('step-detail').waitFor();
    // The hybrid pane renders the raw request/response objects as collapsed sections: open every ancestor <details> before reading deep values.
    await page.evaluate(() => { document.querySelectorAll('[data-testid="step-detail"] details').forEach((d) => { d.open = true; }); });
    const detail = await textOf('step-detail');
    check(detail.includes('Bearer (worker token, not shown)') && ['AirLabMarker', 'ToolName', 'UserId', 'AirFare', 'AirIsInternational', 'AirCabinAsked', 'AirApproval', 'larkspur-air', 'book_airline_flight'].every((x) => detail.includes(x)) && detail.includes('airline-permit-as-asked') && detail.includes('Decided by') && detail.includes(AZ_BY), `${tag}: the decision step shows the raw request (seven parameters, "Bearer (worker token, not shown)"), the raw answer with the statement code, and "Decided by"`);
    check(!JSON.stringify(run).includes(authorizeSettings().AAG_AUTHORIZE_CLIENT_SECRET) && !(await page.content()).includes(authorizeSettings().AAG_AUTHORIZE_CLIENT_SECRET) && !/Bearer eyJ/.test(JSON.stringify(dh.request || {})), `${tag}: the Authorize client secret and the worker bearer are in no run, no page and no request pane`);
    await cardWords(`${tag}: the Denver booking decided by PingOne Authorize, decision step open`);

    // A run that does NOT ask Authorize (a read): the lab's own rule, never credited to Authorize, and the fake saw nothing
    const before = calls();
    run = await runUc('UC1');
    const rd = decisionHop(run);
    check(run?.outcome === 'REAL_PERMIT' && run.decidedBy === 'lab-policy-local' && rd?.decidedBy === 'lab-policy-local' && rd.authorize === undefined && rd.to !== 'authorize' && calls() === before && !(await page.locator('body').innerText()).includes('PingOne Authorize decided'), `${tag}: a read does not ask PingOne Authorize: decidedBy lab-policy-local, no Authorize call, never "PingOne Authorize decided"`);

    // Toronto: $380 international: Authorize answers the narrowing statement and the lab applies it
    run = await runUc('UC8');
    dh = decisionHop(run);
    check(run?.outcome === 'REAL_CONSTRAINED' && run.decidedBy === 'pingone-authorize' && run.constrained?.asked === 'business' && run.constrained.granted === 'economy' && run.constrained.by === AZ_BY && run.constrained.because?.join() === 'international' && run.booking?.booked === 'economy' && dh?.authorize?.code === 'airline-economy-intl', `${tag}: the Toronto booking is REAL_CONSTRAINED by PingOne Authorize (airline-economy-intl): business narrowed to economy because it is international`);
    check((await t('decision-word').innerText()) === 'CONSTRAINED' && (await textOf('decision-policy')).includes(LINE('airline-economy-intl', 'economy only')) && (await textOf('decision-seat')).includes('business asked, economy booked'), `${tag}: the card says CONSTRAINED and its policy row says "returned PERMIT with the statement airline-economy-intl; the lab read that as economy only and applied it"`);
    check(az.seen[az.seen.length - 1].parameters.AirIsInternational === 'true' && az.seen[az.seen.length - 1].parameters.AirApproval === 'none', `${tag}: the fake saw AirIsInternational true and AirApproval none`);
    await cardWords(`${tag}: the Toronto booking decided by PingOne Authorize`);

    // Paris: $2,400: Authorize says a person must approve (428), the phone approves on the lab's own approval service, the retry carries the receipt and Authorize answers approved
    const start = watch.runs.length;
    await pick('UC6');
    await t('run').click();
    await t('mp-approve').waitFor({ timeout: 30000 });
    const held = await watch.next(start);
    check(held?.outcome === 'REAL_HOLD' && held.decidedBy === 'pingone-authorize' && decisionHop(held)?.authorize?.code === 'airline-approval-required' && (await t('decision-word').innerText()) === 'ESCALATED' && (await textOf('decision-policy')).includes(LINE('airline-approval-required', 'hold for a person to approve')), `${tag}: the Paris booking is held for a person because PingOne Authorize answered airline-approval-required (the approval itself runs on the lab's own approval service)`);
    await t('mp-approve').click();
    const retried = await watch.next(start + 1);
    await sleep(500);
    const parisCalls = az.seen.filter((x) => x.parameters.AirFare === '2400').map((x) => x.parameters.AirApproval);
    check(retried?.outcome === 'REAL_PERMIT' && retried.decidedBy === 'pingone-authorize' && retried.booking?.booked === 'business' && !retried.constrained && decisionHop(retried)?.authorize?.code === 'airline-approved-as-asked', `${tag}: after the phone approves, the retry books business as asked, decided by PingOne Authorize (airline-approved-as-asked)`);
    check(parisCalls.join() === 'none,verified', `${tag}: the fake saw AirApproval none, then verified (${parisCalls.join()})`);
    await cardWords(`${tag}: after the approval`);

    // PingOne Authorize silent: NO DECISION, nothing booked, the lab's own rule NOT used (the same Denver booking its own rule would permit)
    for (const [mode, words] of [['timeout', 'it did not reply in time'], ['only-unmatched', 'its answer said no airline booking rule matched']]) {
      az.setMode(mode);
      run = await runUc('UC7');
      dh = decisionHop(run);
      const word = await t('decision-word').innerText();
      const card = await textOf('decision-card');
      check(run?.outcome === 'REAL_NO_DECISION' && run.decidedBy === 'none' && dh?.decidedBy === 'none' && dh.verdict === 'error' && dh.to === 'toolserver' && run.authorize?.answered === false && !run.constrained && !run.booking?.booked, `${tag}: with the endpoint in "${mode}" the run is REAL_NO_DECISION, decidedBy none, nothing booked, no narrowing`);
      check(word === 'NO DECISION' && card.includes(`PingOne Authorize gave no decision: ${words}`) && NOT(card.replace(/NO DECISION/g, '')) && card.includes('did not use its own rule instead'), `${tag}: the card says NO DECISION with the reason "${words}" and none of ALLOWED, DENIED, ESCALATED or CONSTRAINED`);
      // the chat keeps the earlier turns (the held Paris booking says "PingOne Authorize decided that a person must approve"), so only this run's evidence and this run's reply are read
      check((await t('actor-authorize').count()) === 0 && !(await t('evidence-column').innerText()).includes('PingOne Authorize decided') && !(await t('turn-answer-text').last().innerText()).includes('PingOne Authorize decided'), `${tag}: nothing is drawn on the Authorize lane and this run's evidence and reply never say PingOne Authorize decided`);
      check(!(JSON.stringify((run?.hops || []).filter((h) => h.source === 'real' && h.kind === 'tool-dispatched'))).includes('confirmation'), `${tag}: no booking confirmation exists in the run (the lab did not substitute its own rule)`);
      await cardWords(`${tag}: a no-decision booking (${mode})`);
    }
    az.setMode('ok');
    run = await runUc('UC7');
    check(run?.outcome === 'REAL_PERMIT' && run.decidedBy === 'pingone-authorize', `${tag}: with the endpoint back to normal the next booking is decided by PingOne Authorize again`);

    // The Diagram page: P1AZ is drawn, and the step text says the lab's own policy answers when the settings are absent
    await t('nav-diagram').click(); await t('dg-delegation-chain').click(); await page.locator('.react-flow__node').first().waitFor(); await sleep(600);
    const nodes = (await page.locator('.dnode').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ')).join(' | ');
    check(nodes.includes('PingOne Authorize (P1AZ)') && nodes.includes('Lab tool server (own tools, local)'), `${tag}: the Diagram page draws "PingOne Authorize (P1AZ)" and "Lab tool server (own tools, local)"`);
    const dgs = await (await fetch(`${authBase}/api/diagram?name=delegation-chain`, { headers: { 'x-workspace': 'w-eeeeeeeeeeeeeeee' } })).json();
    const steps = JSON.stringify(dgs).replace(/\\"/g, '"');
    check(steps.includes('PingOne Authorize (P1AZ): booking decision') && steps.includes("Without them, or in the hosted build, the lab's own policy answers and the page says so."), `${tag}: the diagram's step text says the lab's own policy answers when the Authorize settings are absent`);
    await walk(page, `${tag}: the Diagram page`);
    check(external.length === 0, `${tag}: the browser made no request to another origin (${external.length})`);
    check(errors.length === 0, `${tag}: no unexpected console error (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }

  // ---- NO-MOCK-WORDS (owner 2026-11-16): a Real-configured lab, opened in Real, walked page by page with runs on it ----------------------------------------
  // One use case the gateway cannot serve (it runs whole on the lab's own steps), one held use case with the phone open, one guided page, then a use case through
  // the gateway; after the runs, the four evidence tabs, a step detail, the RFC column, the Why list, Compare, the Demo guide, Quick Config, Presenter and the talk
  // track. Everything a person can read must pass the word scan (see EXCEPTIONS above for the named ones).
  {
    const tag = 'no-mock-words';
    await fetch(`${fullBase}/api/signout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: fullBase, 'x-workspace': 'w-eeeeeeeeeeeeeeee' }, body: '{}' });
    fullGw.seen.length = 0; fullGw.state.behaviour = 'ok';
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|409|501)/.test(m.text())) errors.push(m.text()); });
    const t = (id) => page.getByTestId(id);
    const watch = watchRuns(page);
    const pick = async (id) => { await t('search').fill(id); await page.locator(`[data-testid="uc-${id}"]`).click(); await t('search').fill(''); };
    // Run the picked use case; when Real asks for the sign-in, sign in (the dialog is walked once); return the run the page received.
    let dialogWalked = false;
    const runIt = async () => {
      const n = watch.runs.length;
      await t('run').click();
      for (let i = 0; i < 200 && !watch.runs.slice(n).some(Boolean); i++) {
        if (await t('signin-dialog').isVisible().catch(() => false)) {
          if (!dialogWalked) { dialogWalked = true; await walk(page, `${tag}: the sign-in dialog`); }
          await t('signin-password').fill(DEMO_PASSWORD); await t('signin-submit').click(); await t('signin-dialog').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
        }
        await sleep(100);
      }
      const run = await watch.next(n);
      await sleep(400);
      return run;
    };
    await page.goto(`${fullBase}/`);
    await t('uc-UC1').waitFor();
    await modeMarker(page, 'live').waitFor({ state: 'attached', timeout: 15000 });
    check(true, `${tag}: the lab is opened in Real (marker live, nothing on the page says so)`);
    await walk(page, `${tag}: the Agent page before any run`);

    // a use case on the lab's own steps: agent-to-agent is banking only, so in the software and airline packs the whole run is the lab's own steps
    await pick('UC2');
    let run = await runIt();
    check(run?.realGate?.real === false && run?.mode === 'mock', `${tag}: UC2 in the airline pack runs whole on the lab's own steps (data: realGate.real false)`);
    await walk(page, `${tag}: an engine run, Sequence tab`);
    for (const v of ['reel', 'topology', 'tokens', 'sequence']) {
      await t(`evtab-${v}`).click(); await sleep(400);
      if (v !== 'sequence') await walk(page, `${tag}: an engine run, ${v} tab`);
    }
    await t('row-2').click(); await t('step-detail').waitFor();
    await walk(page, `${tag}: the step detail`);
    if (await t('rfc-toggle').count()) { await t('rfc-toggle').click(); await sleep(300); await walk(page, `${tag}: the step detail with the RFC column`); await t('rfc-toggle').click(); }
    check((await t('evidence-why').count()) >= 1, `${tag}: the Why list is on the page and was read in the scans above`);

    // a held use case with the phone dialog open
    await pick('UC27');
    run = await runIt();
    await t('mp-deny').waitFor({ timeout: 10000 });
    await walk(page, `${tag}: a held use case with the phone open`);
    await t('mp-deny').click(); await t('mp-outcome').waitFor();
    await walk(page, `${tag}: after the phone answer`);

    // a use case the lab's own tool server answers (software, Real): the page, its step detail with "Answered by", and its tokens
    await t('vertical').selectOption('software'); // the default is airline: this check is the software pack
    await pick('UC1');
    run = await runIt();
    check(run?.outcome === 'REAL_PERMIT' && run.provider === 'local' && toolHop(run)?.answeredBy === 'tool server (local)', `${tag}: UC1 in the software pack ran on the lab's own tool server (data: provider local)`);
    await walk(page, `${tag}: a run answered by the lab's own tool server`);
    await t('row-' + toolHop(run).n).click(); await t('step-detail').waitFor();
    await walk(page, `${tag}: the step detail of a tool server run (Answered by)`);
    await t('evtab-tokens').click(); await sleep(300);
    await walk(page, `${tag}: the tokens of a tool server run`);
    await t('evtab-sequence').click();

    // a guided page
    await pick('UC-LEARN2');
    await t('run').click(); await t('guided-note').waitFor();
    await walk(page, `${tag}: a guided page`);

    // a use case through the gateway (banking: the SE gateway serves its tools)
    await t('vertical').selectOption('banking');
    await pick('UC1');
    run = await runIt();
    check(run?.kind === 'real' && run.mode === 'live' && (run.hops || []).length > 0 && run.hops.every((h) => h.source === 'real' || h.source === 'not-run'), `${tag}: UC1 in the banking pack ran through the gateway (data: every hop source real)`);
    await walk(page, `${tag}: a run through the gateway`);
    await t('evtab-tokens').click(); await sleep(300);
    await walk(page, `${tag}: the tokens of a run through the gateway`);
    await t('evtab-sequence').click(); await t('row-3').click(); await t('step-detail').waitFor();
    await walk(page, `${tag}: a step detail of a run through the gateway`);
    await t('vertical').selectOption('airline');

    // Compare, the Demo guide, Quick Config, Presenter, the talk track
    await page.evaluate(() => { window.location.hash = '#compare'; });
    await t('page-compare').waitFor();
    for (let i = 0; i < 60 && !((await t('decision-card').count()) === 2 && (await t('compare-running').count()) === 0); i++) await sleep(200);
    await walk(page, `${tag}: Compare`);
    await t('back-to-chat').click(); await t('nav-agent').click(); await t('uc-UC1').waitFor();
    await t('help-link').click(); await t('demo-guide').waitFor();
    await walk(page, `${tag}: the Demo guide`);
    await page.keyboard.press('Escape'); await t('demo-guide').waitFor({ state: 'detached' }).catch(() => {});
    await t('qc-open').click(); await t('quick-config').waitFor();
    await walk(page, `${tag}: Quick Config`);
    await t('qc-close').click();
    await page.keyboard.press('p'); await t('presenter-say').waitFor();
    await walk(page, `${tag}: Presenter mode`);
    await page.keyboard.press('Escape'); await t('nav').waitFor();
    // The talk track opens in its own window by default (owner 2026-11-18: second monitor, never over the chat); the page keeps a placeholder
    const [pop] = await Promise.all([page.waitForEvent('popup'), t('nav-talk').click()]);
    const tp = (id) => pop.getByTestId(id);
    await tp('talk-track').waitFor();
    check(await t('fd-placeholder').isVisible(), `${tag}: the talk track opens in its own window by default (the page shows its placeholder)`);
    await walk(pop, `${tag}: the talk track`);
    // The eight cases on the left of the talk track: each one shows the agenda requirement, the words to type, what happens and the talking points
    await tp('talk-cases').waitFor();
    const casePicks = await pop.locator('[data-testid^="case-pick-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('case-pick-', '')));
    check(casePicks.length === 8, `${tag}: the talk track lists eight cases on the left (${casePicks.length})`);
    for (const id of casePicks) {
      await tp(`case-pick-${id}`).click();
      // the popped-out window is rendered by its own React root, a tick after the page's state changes: wait for the case to show
      await pop.locator(`[data-testid="case-detail"][data-case="${id}"]`).waitFor({ timeout: 5000 }).catch(() => {});
      check((await tp('case-detail').getAttribute('data-case')) === id, `${tag}: picking ${id} shows that case`);
      check((await tp('case-requirement').innerText()).length > 20 && (await tp('case-prompt').innerText()).length > 5 && (await tp('case-explain').innerText()).length > 20 && (await tp('case-say').locator('li').count()) >= 1, `${tag}: ${id} shows the requirement, the prompt, what happens and the talking points`);
      await walk(pop, `${tag}: the talk track case ${id}`);
    }
    await tp('case-pick-audit-trail').click(); await tp('case-run').click(); await t('history').waitFor();
    check(await t('history').isVisible() && !pop.isClosed(), `${tag}: the audit case opens Run history in the page and the popped-out talk track stays open`);
    await walk(page, `${tag}: Run history from the audit case`);
    await pop.close();
    await t('nav-runs').click(); await t('history').waitFor();
    await walk(page, `${tag}: Run history`);
    await t('nav-diagram').click(); await page.locator('.react-flow__node').first().waitFor();
    await walk(page, `${tag}: the Diagram page`);
    check(errors.length === 0, `${tag}: no unexpected console error (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }

  // ---- The talk track at the standard 2200 px screen with the pop-out window blocked: it stays docked, clear of the nav, and Run closes it --------------------
  {
    const tag = 'talk-track-2200';
    const ctx = await browser.newContext({ viewport: { width: 2200, height: 1200 } });
    await ctx.addInitScript(() => { window.open = () => null; });
    const page = await ctx.newPage();
    const t = (id) => page.getByTestId(id);
    await page.goto(`${fullBase}/`); await t('uc-UC1').waitFor();
    await t('nav-talk').click(); await t('talk-cases').waitFor();
    const geo = await page.evaluate(() => { const d = document.querySelector('[data-testid=talk-track-dialog]').getBoundingClientRect(); const n = document.querySelector('[data-testid=nav]').getBoundingClientRect(); return { top: d.top, width: d.width, navBottom: n.bottom, wide: document.documentElement.scrollWidth > window.innerWidth }; });
    check(geo.top >= geo.navBottom, `${tag}: the docked dialog opens below the nav (top ${Math.round(geo.top)}, nav bottom ${Math.round(geo.navBottom)})`);
    check(geo.width <= 2200 * 0.5 && !geo.wide, `${tag}: the docked dialog takes at most half of the 2200 px screen and the page has no sideways scroll (${Math.round(geo.width)} px)`);
    await t('case-pick-audit-trail').click(); await t('case-run').click(); await t('history').waitFor();
    check((await t('talk-track-dialog').count()) === 0, `${tag}: Run closes the docked talk track so the result is not covered`);
    await ctx.close();
  }

  // ---- The hosted build: no Mock | Real control, the hosted banner, runs on the lab's own steps; the server still refuses Real ----------
  for (const [width, height, name] of [[1280, 900, 'desktop'], [375, 800, 'phone']]) {
    for (const scheme of ['light', 'dark']) {
      const tag = `hosted-${name}-${scheme}`;
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
      const page = await ctx.newPage();
      const external = []; const errors = []; let watching = false; const modeCalls = [];
      page.on('request', (r) => {
        if (!r.url().startsWith(hostedBase) && !/^(data|blob):/.test(r.url())) external.push(r.url());
        if (watching && new URL(r.url()).pathname === '/api/mode' && r.method() !== 'GET') modeCalls.push(`${r.method()} ${r.url()}`);
      });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/status of 409/.test(m.text())) errors.push(m.text()); });
      const t = (id) => page.getByTestId(id);
      const watch = watchRuns(page);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.goto(`${hostedBase}/`);
      await t('uc-UC1').waitFor();
      await modeMarker(page, 'mock').waitFor({ state: 'attached' });
      check((await t('banner').innerText()) === BANNER_HOSTED && (await t('banner').getAttribute('data-state')) === 'hosted', `${tag}: the hosted banner is the neutral hosted line (data-state hosted)`);
      check((await t('mode-select').count()) === 0 && (await t('real-hosted-note').count()) === 0 && (await t('mode-real').count()) === 1, `${tag}: no Mock | Real control and no hosted Real note; only the rule-19 marker`);
      watching = true;
      await t('search').fill('UC1'); await page.locator('[data-testid="uc-UC1"]').click(); await t('search').fill('');
      await t('run').click(); await t('result').waitFor();
      const hostedRun = await watch.next(0);
      check((await t('outcome').innerText()) === 'PERMIT' && hostedRun?.mode === 'mock' && modeCalls.length === 0, `${tag}: a use case runs on the hosted copy (PERMIT, no /api/mode write by the page: ${modeCalls.join(' | ')})`);
      await walk(page, `${tag}: the hosted page after a run`);
      if (tag === 'hosted-desktop-light') {
        // Hosted never starts the lab's own services: the data says hosted, and the server process has no child.
        const hinfo = await (await fetch(`${hostedBase}/api/info`, { headers: { 'x-workspace': 'w-eeeeeeeeeeeeeeee' } })).json();
        const hkids = spawnSync('pgrep', ['-P', String(hostedServer.pid)], { encoding: 'utf8' });
        check(hinfo.provider?.hosted === true && hinfo.provider?.local?.state === 'hosted' && hinfo.provider?.local?.tools === 0 && hinfo.provider?.gateway === false && hinfo.provider?.toolsSe === false, `${tag}: /api/info says the build is hosted and the lab's own services are not there (state hosted, no tools)`);
        if (hkids.error) console.log('INFO  pgrep is not available here: the hosted child-process check is skipped');
        else check(hkids.stdout.trim() === '', `${tag}: the hosted server has no child process (the local services never start in the hosted build)`);
      }
      const refused = await modeCall(page, 'real');
      check(refused.status === 409 && (await modeMarker(page, 'mock').count()) === 1, `${tag}: the server still refuses Real on the hosted build (HTTP ${refused.status}), the marker stays mock`);
      check((await overflow()) <= 0, `${tag}: the hosted page fits the ${width}px viewport`);
      if (tag === 'hosted-phone-dark' || tag === 'hosted-desktop-light') await page.screenshot({ path: path.join(shots, `${tag}.png`), fullPage: false });
      check(external.length === 0, `${tag}: the browser made no request to another origin (${external.length})`);
      check(errors.length === 0, `${tag}: no console error (${errors.slice(0, 2).join(' | ')})`);
      await ctx.close();
    }
  }
  // The hosted HTML carries the banner before any script runs: the same prefix the deploy script and the image workflow grep for.
  const hostedHtml = await (await fetch(`${hostedBase}/`)).text();
  const deploySh = fs.readFileSync(path.join(root, 'deploy', 'k8s', 'deploy.sh'), 'utf8'); const imageYml = fs.readFileSync(path.join(root, '.github', 'workflows', 'image.yml'), 'utf8');
  check(/banner">Hosted copy\. The back-end platform, HIVE/.test(hostedHtml) && deploySh.includes('banner">Hosted copy\\. The back-end platform, HIVE') && imageYml.includes('banner">Hosted copy\\. The back-end platform, HIVE'), 'hosted: the served HTML opens its banner with the text deploy.sh and image.yml grep for');
  console.log(`INFO  the word scan read ${wordsRead} strings in all`);
} finally { if (browser) await browser.close(); server.kill(); liveServer.kill(); hostedServer.kill(); fullServer.kill(); soloServer.kill(); authServer.kill(); await fake.close(); await fullP1.close(); await soloP1.close(); await authP1.close(); await fullGw.close(); fs.rmSync(settingsDir, { recursive: true, force: true }); fs.rmSync(noEnvDir, { recursive: true, force: true }); }
console.log(`\n${checks - failures} of ${checks} checks passed`);
process.exit(failures ? 1 : 0);
