import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the entry installs the netguard first, before it can open any socket', () => {
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const m = /^(?:const guard = )?installNetguard\(\);/m.exec(src);
  assert.ok(m, 'installNetguard() is called as a statement');
  for (const later of ['runChecks()', 'startHttpServer({', 'applySharedSettings(', 'guard.allowHost(']) assert.ok(src.indexOf(later) > m.index, `${later} comes after the guard`);
});

test('no source file evals, uses vm or Function, builds a regular expression from input, writes a file, uses a worker or child process, or reads process.env.MODE', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const code = fs.readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/\beval\(|new Function\(|\bvm\./.test(code), `${f}: no eval, Function or vm`);
    assert.ok(!/writeFile|appendFile|createWriteStream|mkdirSync|rmSync|unlinkSync/.test(code), `${f}: the server writes no file`);
    assert.ok(!/new RegExp\(/.test(code.replace(/new RegExp\(`\^0\{\$\{n\}\}\$`\)/, '')), `${f}: no regular expression is built from input`);
    assert.ok(!/process\.env\.MODE\b|env\.MODE\b/.test(code), `${f}: a bare MODE is never read`);
    // The lab's own tool server is forked by localServices.js and nowhere else, and only with `fork` (never spawn, exec or a shell).
    if (f === 'localServices.js') {
      assert.ok(/import \{ fork as nodeFork \} from 'node:child_process';/.test(code) && !/\b(spawn|spawnSync|exec|execSync|execFile|execFileSync)\b/.test(code) && !/worker_threads|node:cluster/.test(code), `${f}: only fork from node:child_process`);
    } else assert.ok(!/child_process|worker_threads|node:cluster/.test(code), `${f}: no child process or worker`);
  }
});

test('key material is built with createECDH + createPrivateKey; generateKeyPair (sync or async) is never used in app or test code', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(new URL(`${e.name}/`, dir))) : [new URL(e.name, dir)]));
  const files = [...walk(new URL('../', import.meta.url)), ...walk(new URL('../../scripts/', import.meta.url))].filter((u) => /\.m?js$/.test(u.pathname));
  assert.ok(files.length > 10);
  for (const u of files) {
    if (u.pathname.endsWith('entry.test.js')) continue;
    const code = fs.readFileSync(u, 'utf8');
    assert.ok(!/generateKeyPair(Sync)?\s*\(/.test(code), `${u.pathname}: no generateKeyPair`);
  }
  const jwt = fs.readFileSync(new URL('../src/mockjwt.js', import.meta.url), 'utf8');
  assert.match(jwt, /createECDH\('prime256v1'\)/); assert.match(jwt, /createPrivateKey\(/);
});

test('step 3: no source reads a credential from process.env; the one credential (the worker client secret) is read from the settings file by settings.js and held by live.js alone', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'credentials.js' && x !== 'mask.js')) {
    const code = fs.readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/process\.env\.[A-Z_]*(TOKEN|SECRET|PASSWORD|KEY)/.test(code), `${f}: no credential env var`);
    assert.equal(/CLIENT_SECRET|clientSecret/.test(code), ['settings.js', 'live.js', 'real.js', 'authorize.js'].includes(f), `${f}: only settings.js, live.js, real.js and authorize.js (the PingOne Authorize worker client) touch a client secret`);
  }
  const idx = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(idx.indexOf('liveRefusal(') < idx.indexOf('guard.allowHost('), 'the netguard allows the PingOne host only after the live opt-in check');
  assert.ok(!/process\.env\[[^\]]*\]\s*=|env\.PINGONE/.test(fs.readFileSync(new URL('../src/live.js', import.meta.url), 'utf8')), 'live.js never writes or reads the environment for the client');
});

test('full Real: real.js and mcpClient.js never log and never read the environment; the password is a function argument only', () => {
  for (const f of ['real.js', 'mcpClient.js', 'realGate.js', 'provider.js', 'localServices.js']) {
    const code = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.ok(!/console\./.test(code), `${f}: no console output`);
    assert.ok(!/process\.env/.test(code.replace(/^\s*\/\/.*$/gm, '')), `${f}: reads no environment variable`);
  }
  const real = fs.readFileSync(new URL('../src/real.js', import.meta.url), 'utf8');
  assert.ok(!/session\s*=\s*\{[^}]*password/.test(real) && !/sessions\.set\([^)]*password/.test(real), 'the session never holds the password');
});

test('the lab\'s own tool server: forked only by localServices.js, only when not hosted, with the parent\'s environment never passed on', () => {
  const idx = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(/!hosted && fullOn && real\.providerSetting\(\) !== 'se' \? createLocalServices\(/.test(idx), 'index.js builds the service only when not hosted, Real is on and the setting is not se');
  assert.equal(idx.match(/createLocalServices\(/g).length, 1);
  for (const f of fs.readdirSync(new URL('../src/', import.meta.url)).filter((x) => x.endsWith('.js') && x !== 'localServices.js')) assert.ok(!/createLocalServices/.test(fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')) || f === 'index.js', `${f}: nothing but index.js builds the service`);
  const svc = fs.readFileSync(new URL('../src/localServices.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/process\.env|\.\.\.process|env: process/.test(svc), 'the child gets NODE_ENV and an optional CA path, never the parent environment');
  assert.ok(!/CLIENT_SECRET|clientSecret/.test(svc), 'localServices.js never names a client secret');
});

// PingOne Authorize (2026-11-17): the parent process makes the call and holds the secret; the child never does.
test('Authorize wiring: index.js builds it once, never in the hosted build, hands it to real.js (evidence) and localServices (the IPC), and nothing in server/src/local names it', () => {
  const idx = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.equal(idx.match(/createAuthorize\(/g).length, 1);
  assert.ok(/const authorize = !hosted && realCfg\?\.authorize \? createAuthorize\(\{ config: realCfg\.authorize \}\) : null;/.test(idx), 'only when not hosted and all three settings are valid');
  assert.ok(/createReal\(\{ config: realCfg, missing: missingFull\(liveSettings\), wanted, authorize \}\)/.test(idx), 'real.js gets the evidence reader');
  assert.ok(/createLocalServices\(\{ config: real\.localConfig\(\), hosted, caCertsPath: caCerts, authorize \}\)/.test(idx), 'the IPC side gets the parent module');
  assert.ok(idx.indexOf('createAuthorize(') > idx.indexOf('installNetguard()'), 'after the netguard');
  const src = new URL('../src/', import.meta.url);
  for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.js') && x !== 'index.js')) {
    const code = fs.readFileSync(new URL(f, src), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/createAuthorize\(/.test(code.replace(/export function createAuthorize\(/, '')), `${f}: only index.js builds it`);
  }
  const local = new URL('../src/local/', import.meta.url);
  for (const f of fs.readdirSync(local).filter((x) => x.endsWith('.js'))) {
    const code = fs.readFileSync(new URL(f, local), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/authorize\.js|decisionEndpoints|api\.pingone|decisionUrl|tokenUrl|AAG_AUTHORIZE|client_credentials/.test(code), `${f}: the child holds no URL, no setting name and no grant`);
  }
  const az = fs.readFileSync(new URL('../src/authorize.js', import.meta.url), 'utf8');
  assert.ok(!/\bfetch\(/.test(az.replace(/globalThis\.fetch/g, '')), 'the only network call goes through the injected fetch');
});
