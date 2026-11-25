// Real in Docker (owner, 2026-11-10): compose passes the four PINGONE_* names by ${VAR:-} substitution plus AAG_LIVE_FROM_ENV=1. These tests start the
// real entry point as a child with FAKE values only (fakePingone.js) and never make a call: a run is never asked for, so nothing reaches PingOne.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_KEYS, REAL_KEYS, liveSettingsFor, takeLiveSettingsFromEnv } from '../src/settings.js';
import { fullSettingsFor, settingsFor } from './fakePingone.js';

const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-docker-'));
const empty = path.join(dir, 'empty.env');
fs.writeFileSync(empty, '', { mode: 0o600 });
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// How a child ended: by a signal (no exit code) or by its exit code. Used for every "the lab ended" message.
function endReason({ code, signal }) {
  return signal ? `killed by ${signal}` : `exited with ${code}`;
}

// Starts the lab like the container does (no settings file: AAG_ENV_FILE is an empty one), waits for it, returns its first log line and /api/info.
// An answer counts only when this child printed its own address for this port (index.js prints it after it is listening) and the child has not ended,
// so a process that already holds the port is never read as the lab. The end is taken from 'close', which fires after stdout and stderr are drained,
// so the reason (EADDRINUSE and the like) is complete when it is thrown.
async function boot(port, extra, probe) {
  const env = { ...process.env, PORT: String(port), AAG_ENV_FILE: empty, ALLOW_MOCK_SIGNIN: '1', ...extra };
  for (const k of ['CALAB_BIND', 'AAG_LAB_MODE', 'IDP', 'AAG_ALLOW_LIVE', 'AAG_LIVE_TEST_BASE', 'AAG_DEPLOY_MODE', ...REAL_KEYS]) if (!(k in extra)) delete env[k];
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = ''; let ended = null;
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });
  child.once('close', (code, signal) => { ended = { code, signal }; });
  const endError = () => new Error(`the lab ${endReason(ended)} before it started on ${port}: ${err.trim().slice(0, 400)}`);
  try {
    const announced = `lab at http://127.0.0.1:${port}/`;
    for (let i = 0; i < 200; i++) {
      if (ended) throw endError();
      if (out.includes(announced)) {
        let info = null; let mode = null;
        try {
          info = await (await fetch(`http://127.0.0.1:${port}/api/info`)).json();
          mode = await (await fetch(`http://127.0.0.1:${port}/api/mode`)).json();
        } catch { /* not answering yet */ }
        if (info && mode) {
          if (ended) throw endError();
          return { log: out.split('\n')[0], info, mode, probe: probe ? await probe(`http://127.0.0.1:${port}`) : undefined };
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`the lab did not start on ${port}: ${err.trim().slice(0, 400)}`);
  } finally { child.kill(); }
}

test('takeLiveSettingsFromEnv: only with AAG_LIVE_FROM_ENV=1, only the four names, empty values are not set, and they leave the environment', () => {
  const shell = { ...settingsFor(), OTHER: 'x' };
  assert.equal(takeLiveSettingsFromEnv(shell), null, 'a host run never takes PINGONE_* from a shell');
  assert.ok(LIVE_KEYS.every((k) => k in shell), 'and leaves them alone');
  const env = { AAG_LIVE_FROM_ENV: '1', ...settingsFor(), PINGONE_REGION: '', PINGONE_ADMIN_PASSWORD: 'nope' };
  assert.deepEqual(Object.keys(takeLiveSettingsFromEnv(env)).sort(), ['PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET', 'PINGONE_ENVIRONMENT_ID']);
  assert.ok(LIVE_KEYS.every((k) => !(k in env)), 'deleted from the environment at once');
  assert.equal(env.PINGONE_ADMIN_PASSWORD, 'nope', 'nothing else is touched');
  assert.deepEqual(Object.keys(liveSettingsFor({})).sort(), ['PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET', 'PINGONE_ENVIRONMENT_ID'], 'the process then uses the taken ones');
});

test('Docker with the PingOne settings: Real is available, Mock sign-in too, and the netguard allows only the PingOne host', async () => {
  const r = await boot(7820, { AAG_LIVE_FROM_ENV: '1', AAG_PUBLISH: 'loopback', ...settingsFor() });
  assert.equal(r.info.realAvailable, true); assert.equal(r.info.guards.live, 'allowed'); assert.equal(r.info.guards.mockSignIn, 'allowed');
  assert.equal(r.mode.liveReason, null);
  assert.match(r.log, /Real \(identity provider only\) is on: outbound only to https:\/\/auth\.pingone\.com\)/, 'the one host the netguard allows');
  assert.equal(r.info.real.level, 'idp-only', 'no AAG_* settings: the old two-call path, labelled identity provider only');
  assert.equal(r.info.mode, 'mock'); assert.equal(r.mode.mode, 'mock'); assert.match(r.log, /opens in mock mode/, 'an identity-provider-only worker client keeps opening on the lab\'s own steps');
  assert.doesNotMatch(r.log, new RegExp(settingsFor().PINGONE_ENVIRONMENT_ID), 'the log names the host, never the environment id');
});

test('Docker with no .env (compose passes empty values): Mock only, Real disabled with the how-to, and the netguard allows nothing', async () => {
  const blank = Object.fromEntries(REAL_KEYS.map((k) => [k, '']));
  const r = await boot(7821, { AAG_LIVE_FROM_ENV: '1', AAG_PUBLISH: 'loopback', AAG_ALLOW_LIVE: '', ...blank });
  assert.equal(r.info.realAvailable, false); assert.equal(r.info.guards.mockSignIn, 'allowed');
  assert.match(r.mode.liveReason, /^Real is not configured: fill PINGONE_ENVIRONMENT_ID, AAG_USER_CLIENT_ID, AAG_USER_CLIENT_SECRET, AAG_AGENT_CLIENT_ID, AAG_AGENT_CLIENT_SECRET, AAG_DEMO_USERNAME in this app's \.env/);
  assert.deepEqual(r.info.real.missing, ['PINGONE_ENVIRONMENT_ID', 'AAG_USER_CLIENT_ID', 'AAG_USER_CLIENT_SECRET', 'AAG_AGENT_CLIENT_ID', 'AAG_AGENT_CLIENT_SECRET', 'AAG_DEMO_USERNAME']);
  assert.match(r.log, /no outbound network/);
  assert.equal(r.info.mode, 'mock'); assert.equal(r.mode.mode, 'mock');
});

test('takeLiveSettingsFromEnv takes and removes every Real setting, the AAG_* secrets included', () => {
  const env = { AAG_LIVE_FROM_ENV: '1', ...fullSettingsFor('https://gw.lab-test.net/mcp'), OTHER: 'x' };
  const taken = takeLiveSettingsFromEnv(env);
  assert.deepEqual(Object.keys(taken).sort(), Object.keys(fullSettingsFor('https://gw.lab-test.net/mcp')).sort());
  assert.deepEqual(Object.keys(env).sort(), ['AAG_LIVE_FROM_ENV', 'OTHER'], 'no Real setting is left in the environment');
});

test('Docker with the full-Real settings (and the old worker client too): full Real, the netguard allows the PingOne and gateway hosts only, the worker client ignored', async () => {
  const r = await boot(7825, { AAG_LIVE_FROM_ENV: '1', AAG_PUBLISH: 'loopback', ...settingsFor(), ...fullSettingsFor('https://gw.lab-test.net/mcp') });
  assert.equal(r.info.realAvailable, true); assert.equal(r.info.real.level, 'full'); assert.deepEqual(r.info.real.missing, []);
  assert.equal(r.info.liveSettings.configured, false, 'the old worker-client path is not built');
  assert.match(r.log, /full Real is on: outbound only to https:\/\/auth\.pingone\.com and https:\/\/gw\.lab-test\.net\)/);
  assert.doesNotMatch(r.log, new RegExp(settingsFor().PINGONE_ENVIRONMENT_ID), 'the log names hosts, never the environment id');
});

// Owner, 2026-11-16: AAG_LAB_MODE unset or empty opens in Real when the full Real settings are complete and nothing refuses it.
test('opening mode: empty AAG_LAB_MODE + full Real settings opens in Real (info, /api/mode, the log), and Reset returns to it; an explicit mock wins', async () => {
  const full = fullSettingsFor('https://gw.lab-test.net/mcp');
  const reset = async (base) => {
    const h = { 'content-type': 'application/json', origin: base, 'x-workspace': 'w-open' };
    const before = await (await fetch(`${base}/api/mode`, { headers: h })).json();
    await fetch(`${base}/api/mode`, { method: 'POST', headers: h, body: JSON.stringify({ source: 'mock' }) });
    const switched = await (await fetch(`${base}/api/mode`, { headers: h })).json();
    const r = await fetch(`${base}/api/reset`, { method: 'POST', headers: h, body: '{}' });
    const after = await (await fetch(`${base}/api/mode`, { headers: h })).json();
    return { before: before.mode, switched: switched.mode, reset: r.status, after: after.mode };
  };
  const live = await boot(7827, { AAG_LIVE_FROM_ENV: '1', AAG_PUBLISH: 'loopback', AAG_LAB_MODE: '', ...full }, reset);
  assert.equal(live.info.mode, 'live'); assert.equal(live.info.source, 'real'); assert.equal(live.mode.mode, 'live'); assert.match(live.log, /opens in live mode/);
  assert.deepEqual(live.probe, { before: 'live', switched: 'mock', reset: 200, after: 'live' }, 'a new workspace opens in Real, can leave it, and Reset returns to the derived mode');
  const unset = await boot(7828, { AAG_LIVE_FROM_ENV: '1', AAG_PUBLISH: 'loopback', ...full });
  assert.equal(unset.info.mode, 'live', 'unset is the same as empty');
  const forced = await boot(7829, { AAG_LIVE_FROM_ENV: '1', AAG_PUBLISH: 'loopback', AAG_LAB_MODE: 'mock', ...full });
  assert.equal(forced.info.mode, 'mock'); assert.equal(forced.info.source, 'mock'); assert.equal(forced.info.realAvailable, true, 'Real is still there to switch to');
  const refused = await boot(7830, { AAG_LIVE_FROM_ENV: '1', AAG_PUBLISH: 'loopback', AAG_ALLOW_LIVE: '0', ...full });
  assert.equal(refused.info.mode, 'mock', 'a refusing guard keeps the opening mode on the lab\'s own steps');
});

test('Docker with only some full-Real settings: Real disabled, the missing ones named, the worker client ignored', async () => {
  const partial = { ...fullSettingsFor('https://gw.lab-test.net/mcp') }; delete partial.AAG_AGENT_CLIENT_SECRET; delete partial.AAG_DEMO_USERNAME;
  const r = await boot(7826, { AAG_LIVE_FROM_ENV: '1', AAG_PUBLISH: 'loopback', ...settingsFor(), ...partial });
  assert.equal(r.info.realAvailable, false); assert.deepEqual(r.info.real.missing, ['AAG_AGENT_CLIENT_SECRET', 'AAG_DEMO_USERNAME']);
  assert.match(r.log, /no outbound network/);
});

test('Docker with the settings and AAG_ALLOW_LIVE=0: Real is off and the netguard allows nothing', async () => {
  const r = await boot(7822, { AAG_LIVE_FROM_ENV: '1', AAG_PUBLISH: 'loopback', AAG_ALLOW_LIVE: '0', ...settingsFor() });
  assert.equal(r.info.realAvailable, false); assert.match(r.mode.liveReason, /AAG_ALLOW_LIVE=0/);
  assert.match(r.log, /no outbound network/);
});

test('a host run ignores PINGONE_* exported in the shell (no AAG_LIVE_FROM_ENV): Mock only', async () => {
  const r = await boot(7823, { ...settingsFor() });
  assert.equal(r.info.realAvailable, false); assert.match(r.log, /no outbound network/);
});

test('the hosted build still refuses Real even with the settings in its environment', async () => {
  const r = await boot(7824, { AAG_DEPLOY_MODE: 'hosted', AAG_LIVE_FROM_ENV: '1', ...settingsFor() });
  assert.equal(r.info.realAvailable, false); assert.match(r.mode.liveReason, /hosted build/); assert.match(r.log, /no outbound network/);
  assert.equal(r.info.mode, 'mock', 'hosted always opens on the lab\'s own steps, whatever the settings'); assert.equal(r.info.hosted, true);
});

// A port another process holds must not be read as the lab: the answer has to come from the child this boot started (its own announced address).
test('boot refuses a port another process answers: the child fails to bind, and its own reason is named', async () => {
  const squatter = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"squatter":true}'); });
  await new Promise((r) => squatter.listen(7836, '127.0.0.1', r));
  try {
    await assert.rejects(boot(7836, { AAG_LIVE_FROM_ENV: '1', AAG_PUBLISH: 'loopback' }), (e) => /EADDRINUSE/.test(e.message));
  } finally { await new Promise((r) => squatter.close(r)); }
});

// boot() must report a lab killed by a signal by the signal's name (a signal has no exit code). The child is killed by SIGTERM from a preloaded module,
// before it listens, so the signal path of boot() itself is what runs, not a helper.
test('boot() reports a lab killed by a signal by its signal name', async () => {
  const kill = `data:text/javascript,${encodeURIComponent("process.kill(process.pid, 'SIGTERM')")}`;
  await assert.rejects(boot(7837, { NODE_OPTIONS: `--import ${kill}`, AAG_LIVE_FROM_ENV: '1', AAG_PUBLISH: 'loopback' }),
    (e) => /killed by SIGTERM/.test(e.message) && !/did not start/.test(e.message));
});
