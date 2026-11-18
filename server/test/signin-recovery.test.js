// "Forgot password?" and the forced password change in the Sign in dialog (owner 2026-11-17), against the FAKE PingOne only: the flows API's forgot,
// sendRecoveryCode, recover and reset actions, and the MUST_CHANGE_PASSWORD / PASSWORD_EXPIRED states. Nothing reaches a real PingOne.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReal, realConfig, RealRefused } from '../src/real.js';
import { DEMO_PASSWORD, DEMO_USERNAME, RECOVERY_CODE, fullSettingsFor, startFakePingOne } from './fakePingone.js';
import { get, post, withServer } from './helpers.js';

const TP = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const NEW_PW = ['Brand', 'New-', 'Pass-', '77'].join('');
const OTHER_PW = ['Another-', 'New-', 'Pass-', '88'].join('');
const WS = 'w-aaaaaaaaaaaaaaaa';

// A lab-side `real` against the fake, with a clock the test can move. fn(real, { p1, clock }).
async function withReal(fn, { setup } = {}) {
  const p1 = await startFakePingOne();
  if (setup) setup(p1);
  const clock = { t: 1_000_000 };
  const real = createReal({ config: realConfig(fullSettingsFor('http://127.0.0.1:9/mcp'), { AAG_LIVE_TEST_BASE: p1.base }), missing: [], wanted: true, now: () => clock.t });
  try { await fn(real, { p1, clock }); } finally { await p1.close(); }
}
const noSecrets = (out, ...secrets) => { const text = JSON.stringify(out); for (const s of secrets) assert.ok(!text.includes(s), `a typed secret is in the answer: ${s.slice(0, 4)}...`); };

test('forgot: the lab asks PingOne to look its own user up, keeps a waiting flow, and sends no email until asked', async () => {
  await withReal(async (real, { p1 }) => {
    const out = await real.forgot(WS, TP);
    assert.equal(out.ok, false); assert.equal(out.more, 'recovery_code'); assert.match(out.message, /recovery code/i);
    assert.deepEqual(p1.state.recovery.forgot, [{ username: DEMO_USERNAME }], 'the username is the lab\'s own setting, never typed in the dialog');
    assert.equal(p1.state.recovery.sent, 0, 'forgot only looks the user up; the code is sent by its own step');
    assert.ok(out.steps.some((s) => /forgot password/.test(s.step)));
    assert.equal(real.session(WS), null);
  });
});

test('forgot: PingOne refuses (unknown user, no email) -> a fixed refusal, nothing waits', async () => {
  await withReal(async (real, { p1 }) => {
    p1.state.full.forgot = 'unknown';
    const out = await real.forgot(WS, TP);
    assert.equal(out.ok, false); assert.equal(out.error, 'recovery_not_started'); assert.equal(out.more, undefined);
    assert.equal((await real.recover(WS, RECOVERY_CODE, NEW_PW, TP)).error, 'no_signin_waiting');
  });
});

test('sendCode: one email per call, at most one every 20 seconds, and only while a recovery waits', async () => {
  await withReal(async (real, { p1, clock }) => {
    assert.equal((await real.sendCode(WS)).error, 'no_signin_waiting', 'nothing waits yet');
    await real.forgot(WS, TP);
    const a = await real.sendCode(WS); assert.equal(a.more, 'recovery_code'); assert.equal(p1.state.recovery.sent, 1);
    await assert.rejects(() => real.sendCode(WS), (e) => e instanceof RealRefused && e.code === 'too_soon' && e.status === 429);
    assert.equal(p1.state.recovery.sent, 1);
    clock.t += 21_000;
    assert.equal((await real.sendCode(WS)).more, 'recovery_code'); assert.equal(p1.state.recovery.sent, 2);
  });
});

test('sendCode: no email address / no mail service on the PingOne user -> a fixed refusal that says what to check', async () => {
  await withReal(async (real, { p1 }) => {
    p1.state.full.forgot = 'no-mail';
    await real.forgot(WS, TP);
    const out = await real.sendCode(WS);
    assert.equal(out.error, 'code_not_sent'); assert.match(out.message, /email/);
  });
});

test('recover: the right code and a new password sign the workspace in; the secrets are in no answer, and the new password then works on its own', async () => {
  await withReal(async (real, { p1 }) => {
    await real.forgot(WS, TP); await real.sendCode(WS);
    const out = await real.recover(WS, RECOVERY_CODE, NEW_PW, TP);
    assert.equal(out.ok, true, JSON.stringify(out)); assert.equal(out.user.name, DEMO_USERNAME);
    assert.ok(real.session(WS), 'the workspace has a session');
    noSecrets(out, RECOVERY_CODE, NEW_PW, DEMO_PASSWORD);
    const step = out.steps.find((s) => /recover the password/.test(s.step));
    assert.ok(step, 'the recovery is one of the sign-in steps'); assert.match(JSON.stringify(step.request.body), /typed by you in the Sign in dialog/);
    assert.deepEqual(p1.state.recovery.recover, [{ code: RECOVERY_CODE, newPassword: NEW_PW }]);
    real.signOut(WS);
    assert.equal((await real.signIn(WS, NEW_PW, TP)).ok, true, 'the new password signs in');
    assert.equal((await real.signIn('w-bbbbbbbbbbbbbbbb', DEMO_PASSWORD, TP)).error, 'signin_rejected', 'the old one no longer does');
  });
});

test('recover: a wrong code or a weak password is refused, the flow keeps waiting, and the right try then works', async () => {
  await withReal(async (real) => {
    await real.forgot(WS, TP);
    const bad = await real.recover(WS, 'WRONG123', NEW_PW, TP);
    assert.equal(bad.error, 'recovery_rejected'); assert.equal(bad.status, 401); noSecrets(bad, 'WRONG123', NEW_PW);
    const weak = await real.recover(WS, RECOVERY_CODE, 'short', TP);
    assert.equal(weak.error, 'recovery_rejected');
    assert.equal((await real.recover(WS, RECOVERY_CODE, NEW_PW, TP)).ok, true);
  });
});

test('recover: PingOne asks for a sign-in with the new password (USERNAME_PASSWORD_REQUIRED) -> "password" step; or for another change; or for MFA -> unsupported', async () => {
  await withReal(async (real, { p1 }) => {
    p1.state.recovery.next = 'password';
    await real.forgot(WS, TP);
    const a = await real.recover(WS, RECOVERY_CODE, NEW_PW, TP);
    assert.equal(a.more, 'password'); assert.match(a.message, /Sign in with the new password/);
    assert.equal((await real.signIn(WS, NEW_PW, TP)).ok, true);
    real.signOut(WS);
    p1.state.recovery.next = 'must-change';
    await real.forgot(WS, TP);
    const b = await real.recover(WS, RECOVERY_CODE, OTHER_PW, TP);
    assert.equal(b.more, 'change_password');
    p1.state.recovery.next = 'mfa';
    await real.forgot('w-cccccccccccccccc', TP);
    const c = await real.recover('w-cccccccccccccccc', RECOVERY_CODE, NEW_PW + '1', TP);
    assert.equal(c.error, 'signin_step_unsupported'); assert.equal(c.status, 409);
  });
});

test('a temporary password (MUST_CHANGE_PASSWORD) or an expired one (PASSWORD_EXPIRED) -> the dialog is asked for a new one; wrong current is refused and the change then signs in', async () => {
  for (const mode of ['must-change', 'expired']) {
    await withReal(async (real, { p1 }) => {
      p1.state.full.signin = mode;
      const first = await real.signIn(WS, DEMO_PASSWORD, TP);
      assert.equal(first.ok, false); assert.equal(first.more, 'change_password', mode); noSecrets(first, DEMO_PASSWORD);
      assert.equal(real.session(WS), null);
      const wrong = await real.changePassword(WS, 'not-the-current-1', NEW_PW, TP);
      assert.equal(wrong.error, 'change_rejected'); noSecrets(wrong, 'not-the-current-1', NEW_PW);
      const same = await real.changePassword(WS, DEMO_PASSWORD, DEMO_PASSWORD, TP);
      assert.equal(same.error, 'change_rejected', 'PingOne refuses an unchanged password');
      p1.state.full.signin = 'ok';
      const done = await real.changePassword(WS, DEMO_PASSWORD, NEW_PW, TP);
      assert.equal(done.ok, true, JSON.stringify(done)); assert.ok(real.session(WS));
      noSecrets(done, DEMO_PASSWORD, NEW_PW);
      assert.deepEqual(p1.state.recovery.reset.map((r) => r.newPassword), [NEW_PW, DEMO_PASSWORD, NEW_PW], 'the lab sent the wrong try, the unchanged try and the good one');
      assert.equal(p1.state.password, NEW_PW);
    });
  }
});

test('a waiting flow lasts ten minutes, holds no secret, is replaced by a fresh sign-in and ended by cancel and sign-out', async () => {
  await withReal(async (real, { clock }) => {
    await real.forgot(WS, TP);
    clock.t += 10 * 60 * 1000 + 1;
    assert.equal((await real.recover(WS, RECOVERY_CODE, NEW_PW, TP)).error, 'no_signin_waiting', 'ten minutes later it is gone');
    await real.forgot(WS, TP); real.cancelSignIn(WS);
    assert.equal((await real.sendCode(WS)).error, 'no_signin_waiting', 'cancel ends it');
    await real.forgot(WS, TP);
    assert.equal((await real.signIn(WS, DEMO_PASSWORD, TP)).ok, true, 'a fresh password sign-in works while a recovery waited');
    assert.equal((await real.recover(WS, RECOVERY_CODE, NEW_PW, TP)).error, 'no_signin_waiting', 'and it replaced the waiting flow');
    await real.forgot('w-dddddddddddddddd', TP); real.signOut('w-dddddddddddddddd');
    assert.equal((await real.sendCode('w-dddddddddddddddd')).error, 'no_signin_waiting', 'sign-out ends it');
  });
});

test('an authorization server that echoes what it was sent cannot put the code or a password in an answer', async () => {
  await withReal(async (real, { p1 }) => {
    await real.forgot(WS, TP);
    p1.state.full.signin = 'echo-pw';
    const out = await real.recover(WS, RECOVERY_CODE, NEW_PW, TP);
    assert.equal(out.ok, false); noSecrets(out, RECOVERY_CODE, NEW_PW);
    p1.state.full.signin = 'must-change';
    await real.signIn('w-eeeeeeeeeeeeeeee', DEMO_PASSWORD, TP);
    p1.state.full.signin = 'echo-pw';
    const ch = await real.changePassword('w-eeeeeeeeeeeeeeee', DEMO_PASSWORD, NEW_PW, TP);
    assert.equal(ch.ok, false); noSecrets(ch, DEMO_PASSWORD, NEW_PW);
  });
});

test('recoveryOffered: PingOne says so itself (the password.forgot link in its flow); the answer is cached five minutes and holds no flow', async () => {
  await withReal(async (real, { p1, clock }) => {
    const authorizes = () => p1.seen.filter((c) => c.url.includes('/as/authorize')).length;
    assert.equal(await real.recoveryOffered(TP), true);
    assert.equal(await real.recoveryOffered(TP), true); assert.equal(authorizes(), 1, 'the second answer comes from the cache');
    assert.equal((await real.sendCode(WS)).error, 'no_signin_waiting', 'asking holds no flow for the person');
    p1.state.full.forgot = 'not-offered';
    assert.equal(await real.recoveryOffered(TP), true, 'still the cached answer');
    clock.t += 5 * 60 * 1000 + 1;
    assert.equal(await real.recoveryOffered(TP), false, 'five minutes later PingOne is asked again: its policy offers no recovery'); assert.equal(authorizes(), 2);
  });
});

test('a sign-on policy with no recovery: forgot is refused with a fixed message, nothing waits, and the answer is remembered', async () => {
  await withReal(async (real, { p1 }) => {
    p1.state.full.forgot = 'not-offered';
    const out = await real.forgot(WS, TP);
    assert.equal(out.ok, false); assert.equal(out.error, 'recovery_not_offered'); assert.equal(out.status, 409); assert.match(out.message, /does not offer password recovery/);
    assert.equal(p1.state.recovery.forgot.length, 0, 'PingOne was never asked to start a recovery');
    assert.equal(await real.recoveryOffered(TP), false);
    assert.equal((await real.sendCode(WS)).error, 'no_signin_waiting');
  });
});

test('recoveryOffered: PingOne cannot be asked -> unknown (null), nothing cached, the link stays hidden', async () => {
  const clock = { t: 1_000_000 };
  const real = createReal({ config: realConfig(fullSettingsFor('http://127.0.0.1:9/mcp'), { AAG_LIVE_TEST_BASE: 'http://127.0.0.1:9' }), missing: [], wanted: true, now: () => clock.t });
  assert.equal(await real.recoveryOffered(TP), null);
  assert.equal(await createReal({ missing: [], wanted: false }).recoveryOffered(TP), null, 'not configured');
});

// ---- over HTTP: the routes, their strict bodies and the whole round trip
async function withLab(fn, opts) {
  await withReal(async (real, ctx) => { await withServer((url) => fn(url, ctx), { env: { ALLOW_MOCK_SIGNIN: '1' }, real }); }, opts);
}
const H = { 'x-workspace': WS };
const json = async (r) => ({ status: r.status, body: await r.json() });
async function realOn(url) { assert.equal((await post(url, '/api/mode', { source: 'real' }, H)).status, 200); }

test('HTTP: forgot -> code -> recover signs the workspace in; the answers carry no secret and the page can read who is signed in', async () => {
  await withLab(async (url) => {
    await realOn(url);
    const f = await json(await post(url, '/api/signin/forgot', {}, H));
    assert.equal(f.status, 200); assert.equal(f.body.signedIn, false); assert.equal(f.body.next, 'recovery_code');
    const c = await json(await post(url, '/api/signin/code', {}, H));
    assert.equal(c.status, 200); assert.equal(c.body.next, 'recovery_code');
    const again = await json(await post(url, '/api/signin/code', {}, H));
    assert.equal(again.status, 429); assert.equal(again.body.error, 'too_soon');
    const r = await post(url, '/api/signin/recover', { recoveryCode: RECOVERY_CODE, newPassword: NEW_PW }, H);
    const text = await r.clone().text(); const body = JSON.parse(text);
    assert.equal(r.status, 200); assert.equal(body.signedIn, true); assert.equal(body.user.name, DEMO_USERNAME);
    for (const s of [RECOVERY_CODE, NEW_PW]) assert.ok(!text.includes(s));
    const who = await (await get(url, '/api/signin', H)).json();
    assert.equal(who.signedIn, true);
  });
});

test('HTTP: the temporary password route, the strict bodies, the fixed errors and the cancel route', async () => {
  await withLab(async (url, { p1 }) => {
    await realOn(url);
    p1.state.full.signin = 'must-change';
    const s = await json(await post(url, '/api/signin', { password: DEMO_PASSWORD }, H));
    assert.equal(s.status, 200); assert.equal(s.body.next, 'change_password'); assert.equal(s.body.signedIn, false);
    assert.equal((await post(url, '/api/signin/change', { currentPassword: DEMO_PASSWORD }, H)).status, 400, 'the new password is required');
    assert.equal((await post(url, '/api/signin/change', { currentPassword: DEMO_PASSWORD, newPassword: NEW_PW, extra: 'x' }, H)).status, 400, 'unknown keys are refused');
    assert.equal((await post(url, '/api/signin/recover', { recoveryCode: 'no spaces!', newPassword: NEW_PW }, H)).status, 400, 'a code is letters and digits');
    assert.equal((await post(url, '/api/signin/recover', { recoveryCode: RECOVERY_CODE, newPassword: 'x'.repeat(300) }, H)).status, 400);
    assert.equal((await post(url, '/api/signin/forgot', { username: 'someone-else' }, H)).status, 400, 'the username is never taken from the page');
    const wrong = await json(await post(url, '/api/signin/change', { currentPassword: 'not-the-current-1', newPassword: NEW_PW }, H));
    assert.equal(wrong.status, 401); assert.equal(wrong.body.error, 'change_rejected');
    p1.state.full.signin = 'ok';
    const done = await json(await post(url, '/api/signin/change', { currentPassword: DEMO_PASSWORD, newPassword: NEW_PW }, H));
    assert.equal(done.status, 200); assert.equal(done.body.signedIn, true);
    assert.equal((await json(await post(url, '/api/signin/cancel', {}, H))).body.cancelled, true);
    assert.equal((await json(await post(url, '/api/signin/recover', { recoveryCode: RECOVERY_CODE, newPassword: NEW_PW }, H))).body.error, 'no_signin_waiting');
  });
});

test('HTTP: without full Real the new routes refuse like /api/signin does', async () => {
  await withServer(async (url) => {
    for (const [path, body] of [['/api/signin/forgot', {}], ['/api/signin/code', {}], ['/api/signin/recover', { recoveryCode: RECOVERY_CODE, newPassword: NEW_PW }], ['/api/signin/change', { currentPassword: DEMO_PASSWORD, newPassword: NEW_PW }]]) {
      const r = await post(url, path, body, H); assert.equal(r.status, 409, path); assert.equal((await r.json()).error, 'real_not_available');
    }
  }, { env: { ALLOW_MOCK_SIGNIN: '1' } });
});

test('HTTP: GET /api/signin/options says whether PingOne offers recovery; false without full Real and for a policy with none', async () => {
  await withLab(async (url, { p1 }) => {
    await realOn(url);
    assert.deepEqual(await (await get(url, '/api/signin/options', H)).json(), { recovery: true });
    p1.state.full.forgot = 'not-offered';
    assert.deepEqual(await (await get(url, '/api/signin/options', H)).json(), { recovery: true }, 'the answer is cached');
  });
  await withLab(async (url) => {
    await realOn(url);
    assert.deepEqual(await (await get(url, '/api/signin/options', H)).json(), { recovery: false });
  }, { setup: (p1) => { p1.state.full.forgot = 'not-offered'; } });
  await withServer(async (url) => {
    assert.deepEqual(await (await get(url, '/api/signin/options', H)).json(), { recovery: false });
  }, { env: { ALLOW_MOCK_SIGNIN: '1' } });
});
