import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ENV_FILE, AUTHORIZE_KEYS, LIVE_KEYS, SETTINGS_KEYS, applySharedSettings, missingLiveSettings, readLiveSettings, readSharedSettings, settingsPath } from '../src/settings.js';
import { modeFrom, modeOf, openingMode } from '../src/config.js';

const withFile = (text, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-set-'));
  const f = path.join(dir, '.env'); fs.writeFileSync(f, text, { mode: 0o600 });
  try { return fn(f); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('only this lab\'s own key is taken from the app\'s .env; every other key stays out', () => {
  assert.deepEqual(SETTINGS_KEYS, ['AAG_LAB_MODE', 'LAB_ALLOWED_HOSTS', 'SHELF_URL']);
  withFile('PINGONE_CLIENT_SECRET=hunter2hunter2\nMODE=live\nPORT=9999\nAAG_LAB_MODE=live\nAAG_ALLOW_LIVE=1\nALLOW_MOCK_SIGNIN=1\n# a comment\nOTHER_APP_TOKEN="x y"\n', (f) => {
    assert.deepEqual(readSharedSettings(f), { AAG_LAB_MODE: 'live' });
    const env = { HOME: '/x' };
    applySharedSettings(env, f);
    assert.deepEqual(Object.keys(env).sort(), ['AAG_LAB_MODE', 'HOME'], 'the guards\' keys (AAG_ALLOW_LIVE, ALLOW_MOCK_SIGNIN) can never be switched on from the .env');
  });
});

test('the environment wins over the file; a missing, empty or unreadable file is the defaults', () => {
  withFile('AAG_LAB_MODE=live\n', (f) => assert.equal(applySharedSettings({ AAG_LAB_MODE: 'mock' }, f).AAG_LAB_MODE, 'mock'));
  assert.deepEqual(readSharedSettings('/nonexistent/.env'), {});
  withFile('', (f) => assert.deepEqual(readSharedSettings(f), {}));
  withFile('AAG_LAB_MODE=\n', (f) => assert.deepEqual(readSharedSettings(f), {}));
  assert.deepEqual(readSharedSettings(os.tmpdir()), {}, 'a directory is not a settings file');
});

test('openingMode (owner 2026-11-16): explicit mock|live wins; unset or empty is Real only when the full settings are there, the build is local and nothing refuses Real', () => {
  const real = { realFull: true, liveRefusal: null };
  for (const unset of [{}, { AAG_LAB_MODE: '' }]) {
    assert.equal(openingMode(unset, real), 'live', 'full Real settings, local, not refused');
    assert.equal(openingMode(unset, { realFull: false, liveRefusal: null }), 'mock', 'no full Real settings (an identity-provider-only worker client counts as none)');
    assert.equal(openingMode(unset, {}), 'mock', 'nothing known: the lab\'s own steps');
    assert.equal(openingMode(unset, { realFull: true, liveRefusal: 'Real is switched off on this machine (AAG_ALLOW_LIVE=0). Remove it to allow Real.' }), 'mock', 'a refusing guard');
    assert.equal(openingMode(unset, { hosted: true, realFull: true, liveRefusal: null }), 'mock', 'hosted never opens in Real');
    assert.equal(openingMode({ ...unset, AAG_DEPLOY_MODE: 'hosted' }, real), 'mock', 'hosted by the environment too');
  }
  assert.equal(openingMode({ AAG_LAB_MODE: 'mock' }, real), 'mock', 'explicit mock wins over complete Real settings');
  assert.equal(openingMode({ AAG_LAB_MODE: 'live' }, { realFull: false }), 'live', 'explicit live with nothing said about usability is unchanged');
  assert.equal(openingMode({ AAG_LAB_MODE: 'live' }, { realFull: false, liveUsable: false }), 'mock', 'explicit live with no usable Real path opens on the lab\'s own steps (the page has no control to leave a refused Real)');
  assert.equal(openingMode({ AAG_LAB_MODE: 'live' }, { realFull: false, liveUsable: true }), 'live', 'explicit live with a usable path (the identity-provider-only client too) wins');
  assert.throws(() => openingMode({ AAG_LAB_MODE: 'prod' }, real), /not available/);
  assert.throws(() => openingMode({ AAG_DEPLOY_MODE: 'hosted', AAG_LAB_MODE: 'live' }, real), /mock only/, 'hosted plus an explicit live still throws');
});

test('the mode is mock or live; mock is the default; a bare MODE (another app\'s) is ignored; anything else is an error, not a fallback', () => {
  assert.equal(modeFrom({}), 'mock'); assert.equal(modeFrom({ MODE: 'live' }), 'mock'); assert.equal(modeFrom({ AAG_LAB_MODE: 'live' }), 'live'); assert.equal(modeFrom({ AAG_LAB_MODE: '' }), 'mock');
  assert.throws(() => modeFrom({ AAG_LAB_MODE: 'prod' }), /not available/);
  assert.equal(modeOf('mock'), 'mock'); assert.equal(modeOf('live'), 'live');
  for (const bad of ['Mock', 'prod', '', undefined, null, 1, ['mock'], { toString: () => 'mock' }, '__proto__']) assert.equal(modeOf(bad), null);
});

test('step 3: the PingOne settings are read for live.js only, with util.parseEnv and only the four listed keys; they are never copied into the environment', () => {
  assert.deepEqual(LIVE_KEYS, ['PINGONE_ENVIRONMENT_ID', 'PINGONE_REGION', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET']);
  withFile('PINGONE_ENVIRONMENT_ID=env-1\nPINGONE_REGION=eu\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=csec\nPINGONE_ADMIN_PASSWORD=nope\nAAG_ALLOW_LIVE=1\nIDP=pingone\nPORT=1\nPINGONE_CLIENT_SECRET_OLD=x\n', (f) => {
    assert.deepEqual(readLiveSettings(f), { PINGONE_ENVIRONMENT_ID: 'env-1', PINGONE_REGION: 'eu', PINGONE_CLIENT_ID: 'cid', PINGONE_CLIENT_SECRET: 'csec' });
    const env = {}; applySharedSettings(env, f);
    assert.deepEqual(env, {}, 'applySharedSettings copies none of them, and none of the guard keys');
    assert.deepEqual(readSharedSettings(f), {});
  });
  withFile('PINGONE_CLIENT_ID=\n', (f) => assert.deepEqual(readLiveSettings(f), {}));
  assert.deepEqual(readLiveSettings('/nonexistent/.env'), {}); assert.deepEqual(readLiveSettings(os.tmpdir()), {});
});

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('owner 2026-11-09: the settings file is this app\'s own .env at the repo root (beside docker-compose.yml), resolved from the code, not the cwd or the home directory', () => {
  assert.equal(APP_ENV_FILE, path.join(REPO_ROOT, '.env'));
  assert.ok(fs.existsSync(path.join(path.dirname(APP_ENV_FILE), 'docker-compose.yml')), 'the .env sits beside docker-compose.yml');
  assert.equal(settingsPath({}), APP_ENV_FILE);
  assert.equal(settingsPath({ HOME: '/elsewhere', [['STANDALONE', 'ENV'].join('_')]: '/elsewhere/.env' }), APP_ENV_FILE, 'neither HOME nor the retired override variable moves it');
  const cwd = process.cwd();
  try { process.chdir(os.tmpdir()); assert.equal(settingsPath({}), APP_ENV_FILE); } finally { process.chdir(cwd); }
  assert.equal(settingsPath({ AAG_ENV_FILE: '/tmp/x.env' }), '/tmp/x.env', 'AAG_ENV_FILE (tests and e2e) points at another file');
});

test('the names the owner\'s .env holds are the names the lab reads: LAB_ALLOWED_HOSTS and SHELF_URL into the environment, the four PINGONE_* for live.js only (fake values)', () => {
  withFile('LAB_ALLOWED_HOSTS=lab.example\nSHELF_URL=https://shelf.example:8443\nPINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_REGION=com\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=fake-secret\n', (f) => {
    const env = {}; applySharedSettings(env, f);
    assert.deepEqual(env, { LAB_ALLOWED_HOSTS: 'lab.example', SHELF_URL: 'https://shelf.example:8443' });
    assert.deepEqual(Object.keys(readLiveSettings(f)), LIVE_KEYS);
    assert.deepEqual(applySharedSettings({ LAB_ALLOWED_HOSTS: 'shell.example' }, f).LAB_ALLOWED_HOSTS, 'shell.example', 'the shell wins');
  });
});

test('Live config loading from the app\'s .env: present, missing and partial (fake values only)', () => {
  withFile('PINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_REGION=eu\nPINGONE_CLIENT_ID=cid\nPINGONE_CLIENT_SECRET=fake-secret\n', (f) => {
    assert.deepEqual(Object.keys(readLiveSettings(f)), LIVE_KEYS); assert.deepEqual(missingLiveSettings(f), []);
  });
  assert.deepEqual(missingLiveSettings('/nonexistent/.env'), ['PINGONE_ENVIRONMENT_ID', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET'], 'missing file: every required name');
  withFile('PINGONE_ENVIRONMENT_ID=11111111-2222-4333-8444-555555555555\nPINGONE_CLIENT_SECRET=\n', (f) => {
    assert.deepEqual(missingLiveSettings(f), ['PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET'], 'partial: the unset and the empty ones');
  });
  withFile(fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8'), (f) => {
    assert.deepEqual(missingLiveSettings(f), ['PINGONE_ENVIRONMENT_ID', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET'], 'an unfilled copy of .env.example still counts as missing');
    assert.deepEqual(readSharedSettings(f), {}, 'empty placeholders are not taken; the example leaves AAG_LAB_MODE empty (owner 2026-11-16: the lab derives it)');
  });
});

test('.env.example lists the names with placeholder values only; .env is git-ignored and docker-ignored', () => {
  const ex = fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');
  const parsed = Object.fromEntries(ex.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)));
  for (const k of [...LIVE_KEYS, ...SETTINGS_KEYS]) assert.ok(k in parsed, k);
  assert.equal(parsed.LAB_ALLOWED_HOSTS, ''); assert.equal(parsed.AAG_LAB_MODE, '', 'the example leaves the opening mode to the lab');
  assert.equal(parsed.PINGONE_ENVIRONMENT_ID, '00000000-0000-0000-0000-000000000000'); assert.equal(parsed.PINGONE_CLIENT_ID, '00000000-0000-0000-0000-000000000000');
  assert.equal(parsed.PINGONE_CLIENT_SECRET, 'replace-me'); assert.equal(parsed.SHELF_URL, '');
  for (const f of ['.gitignore', '.dockerignore']) assert.match(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'), /^\.env$/m, f);
});

// The provider and gateway names (owner 2026-11-16, design-real-local.md C.2): the SE gateway trio is OPTIONAL, four new names choose the provider.
import { FULL_KEYS, FULL_REQUIRED, GATEWAY_KEYS, OPTIONAL_KEYS, PROVIDER_KEYS, REAL_KEYS, fullWanted, missingFull, takeLiveSettingsFromEnv, liveSettingsFor } from '../src/settings.js';

test('the setting lists: the gateway trio leaves the required names, the five provider names are optional, and every name is read from the app\'s .env', () => {
  assert.deepEqual(FULL_KEYS, ['AAG_USER_CLIENT_ID', 'AAG_USER_CLIENT_SECRET', 'AAG_AGENT_CLIENT_ID', 'AAG_AGENT_CLIENT_SECRET', 'AAG_DEMO_USERNAME']);
  assert.deepEqual(GATEWAY_KEYS, ['AAG_AGENT_GATEWAY_URL', 'AAG_GATEWAY_AUDIENCE', 'AAG_GATEWAY_SCOPE']);
  assert.deepEqual(PROVIDER_KEYS, ['AAG_PROVIDER', 'AAG_TOOLS_AUDIENCE', 'AAG_TOOLS_TIER_GROUP', 'AAG_TOOLS_TIER_GROUP_AIRLINE', 'AAG_TOOLS_SE_URL']);
  assert.deepEqual(FULL_REQUIRED, ['PINGONE_ENVIRONMENT_ID', ...FULL_KEYS]);
  for (const k of [...GATEWAY_KEYS, ...PROVIDER_KEYS]) { assert.ok(OPTIONAL_KEYS.includes(k), `${k} is optional`); assert.ok(REAL_KEYS.includes(k), `${k} is a Real key`); assert.ok(!FULL_REQUIRED.includes(k), `${k} is never required`); }
  assert.equal(new Set(REAL_KEYS).size, REAL_KEYS.length, 'no name twice');
});

test('fullWanted and missingFull: the five app names and the environment id alone make Real; any gateway or app name set means Real is the target; the provider names do not', () => {
  const five = Object.fromEntries(FULL_REQUIRED.map((k) => [k, k === 'PINGONE_ENVIRONMENT_ID' ? '11111111-2222-4333-8444-555555555555' : `value-of-${k.toLowerCase()}`]));
  assert.deepEqual(missingFull(five), [], 'no gateway name needed'); assert.equal(fullWanted(five), true);
  assert.deepEqual(missingFull({}), FULL_REQUIRED, 'in the order environment id, user id, user secret, agent id, agent secret, username');
  assert.equal(fullWanted({}), false); assert.equal(fullWanted({ AAG_GATEWAY_SCOPE: 'x:y' }), true, 'a gateway name alone means the owner wants full Real');
  assert.equal(fullWanted({ AAG_PROVIDER: 'local', AAG_TOOLS_AUDIENCE: 'a', AAG_TOOLS_TIER_GROUP: 'g', AAG_TOOLS_TIER_GROUP_AIRLINE: 'g2', AAG_TOOLS_SE_URL: 'https://x.example/mcp' }), false, 'the provider names alone do not make Real wanted');
  assert.equal(fullWanted({ AAG_USER_CLIENT_ID: 'replace-me' }), false, 'a placeholder is unset');
});

test('Docker: takeLiveSettingsFromEnv takes the five provider names too (and deletes them), so a container behaves like a host run', () => {
  const env = { AAG_LIVE_FROM_ENV: '1', AAG_PROVIDER: 'local', AAG_TOOLS_AUDIENCE: 'appfire-work-tools', AAG_TOOLS_TIER_GROUP: 'Software_EnterpriseTier', AAG_TOOLS_TIER_GROUP_AIRLINE: 'Airline_OrbitTier', AAG_TOOLS_SE_URL: 'https://tools.example/mcp', OTHER: 'x' };
  const taken = takeLiveSettingsFromEnv(env);
  assert.deepEqual(Object.keys(taken).sort(), [...PROVIDER_KEYS].sort()); assert.deepEqual(Object.keys(env).sort(), ['AAG_LIVE_FROM_ENV', 'OTHER']);
  assert.equal(liveSettingsFor({}).AAG_PROVIDER, 'local', 'the process then uses the taken ones');
});

test('.env.example: the gateway trio is under its own optional heading and the provider names are present, commented out, with placeholders only', () => {
  const ex = fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');
  for (const k of [...GATEWAY_KEYS, ...PROVIDER_KEYS]) assert.match(ex, new RegExp(`^#? ?${k}=`, 'm'), `${k} is listed`);
  assert.match(ex, /Optional: the SE Agent Gateway \(banking, healthcare, retail\)/);
  for (const k of PROVIDER_KEYS) assert.match(ex, new RegExp(`^# ?${k}=`, 'm'), `${k} is commented out`);
  assert.ok(!/AAG_TOOLS_SE_URL=https?:\/\/(?!\s*$)[^\s]*\.(se|ping)/i.test(ex), 'no real host');
});

// PingOne Authorize decides the airline booking (2026-11-17): three optional names, all together or none, the secret write-only.
test('Authorize settings: AUTHORIZE_KEYS is exact, optional, a Real key, never required and never makes full Real wanted; a placeholder counts as unset', async () => {
  const { OPTIONAL_KEYS, REAL_KEYS, FULL_REQUIRED, fullWanted, missingAuthorize } = await import('../src/settings.js');
  assert.deepEqual(AUTHORIZE_KEYS, ['AAG_AUTHORIZE_ENDPOINT_ID', 'AAG_AUTHORIZE_CLIENT_ID', 'AAG_AUTHORIZE_CLIENT_SECRET']);
  for (const k of AUTHORIZE_KEYS) { assert.ok(OPTIONAL_KEYS.includes(k), k); assert.ok(REAL_KEYS.includes(k), k); assert.ok(!FULL_REQUIRED.includes(k), k); }
  assert.equal(new Set(REAL_KEYS).size, REAL_KEYS.length);
  assert.equal(fullWanted({ AAG_AUTHORIZE_ENDPOINT_ID: 'e4e4e4e4-5656-4787-8989-b0b0b0b0b0b0', AAG_AUTHORIZE_CLIENT_ID: 'x', AAG_AUTHORIZE_CLIENT_SECRET: 'y' }), false, 'the Authorize names alone never make full Real the target');
  assert.deepEqual(missingAuthorize({}), AUTHORIZE_KEYS); assert.deepEqual(missingAuthorize({ AAG_AUTHORIZE_CLIENT_ID: 'real-looking' }), ['AAG_AUTHORIZE_ENDPOINT_ID', 'AAG_AUTHORIZE_CLIENT_SECRET']);
  assert.deepEqual(missingAuthorize({ AAG_AUTHORIZE_ENDPOINT_ID: '00000000-0000-0000-0000-000000000000', AAG_AUTHORIZE_CLIENT_ID: '00000000-0000-0000-0000-000000000000', AAG_AUTHORIZE_CLIENT_SECRET: 'replace-me' }), AUTHORIZE_KEYS, 'placeholders are unset');
});

test('Authorize settings: read from the app\'s .env like the other Real names, taken from the container environment once and deleted; .env.example lists them commented out with placeholders only', () => {
  withFile('AAG_AUTHORIZE_ENDPOINT_ID=e4e4e4e4-5656-4787-8989-b0b0b0b0b0b0\nAAG_AUTHORIZE_CLIENT_ID=a-worker-id\nAAG_AUTHORIZE_CLIENT_SECRET=a-worker-value\nOTHER=1\n', (f) => {
    assert.deepEqual(Object.keys(readLiveSettings(f)).sort(), [...AUTHORIZE_KEYS].sort());
    assert.deepEqual(Object.keys(readSharedSettings(f)), [], 'never into the process environment');
  });
  const env = { AAG_LIVE_FROM_ENV: '1', AAG_AUTHORIZE_ENDPOINT_ID: 'e4e4e4e4-5656-4787-8989-b0b0b0b0b0b0', AAG_AUTHORIZE_CLIENT_ID: 'a-worker-id', AAG_AUTHORIZE_CLIENT_SECRET: 'a-worker-value', OTHER: 'x' };
  const taken = takeLiveSettingsFromEnv(env);
  assert.deepEqual(Object.keys(taken).sort(), [...AUTHORIZE_KEYS].sort()); assert.deepEqual(Object.keys(env).sort(), ['AAG_LIVE_FROM_ENV', 'OTHER'], 'deleted from the environment');
  const ex = fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');
  for (const k of AUTHORIZE_KEYS) assert.match(ex, new RegExp(`^# ${k}=`, 'm'), `${k} is commented out`);
  assert.match(ex, /^# AAG_AUTHORIZE_ENDPOINT_ID=00000000-0000-0000-0000-000000000000$/m); assert.match(ex, /^# AAG_AUTHORIZE_CLIENT_SECRET=replace-me$/m);
  assert.match(ex, /All three together turn it on/);
});
