// The lab's own tool server and approval service, forked as ONE child process (owner decision 2026-11-16, design-real-local.md B.1). The child
// (server/src/local/main.js) listens on 127.0.0.1 on an ephemeral port that nothing publishes, validates PingOne-issued tokens against the issuer's JWKS and
// enforces the lab's own policy. It is never built in the hosted build.
//
// The only use of node:child_process in server/src is the one `fork` below (entry.test.js pins that). The child inherits NO environment variable except
// NODE_ENV and, when the parent has one, NODE_EXTRA_CA_CERTS (a path to extra trusted CAs, not a secret); it receives no secret in env or argv. The approval
// secret is made here per start and crosses the IPC channel only; it never reaches a log, a hop, an API answer or a trace. This module reads no environment.
import { fork as nodeFork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const TOOL_NAME = /^[a-z0-9_]{1,64}$/;
const RESERVED_LO = 7814;
const RESERVED_HI = 7839;
const MAX_TOOLS = 50;
const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS = 3;
const SKEW_SECONDS = 60;

const validPort = (p) => Number.isInteger(p) && p >= 1024 && p <= 65535 && !(p >= RESERVED_LO && p <= RESERVED_HI);
const validTools = (t) => Array.isArray(t) && t.length <= MAX_TOOLS && t.every((n) => typeof n === 'string' && TOOL_NAME.test(n));

export function createLocalServices({
  config, hosted = false, modulePath = new URL('./local/main.js', import.meta.url).pathname, forkImpl = nodeFork, caCertsPath = undefined,
  now = Date.now, startTimeoutMs = 10_000, backoffMs = [1000, 2000, 4000], retryAfterMs = 30_000, pingMs = 15_000, pingTimeoutMs = 3_000, fetchImpl = (...a) => globalThis.fetch(...a),
} = {}) {
  let state = 'off'; // 'off' | 'starting' | 'ready' | 'failed'
  let child = null; let port = null; let tools = []; let secret = null;
  let stopping = false; let starting = null; // the pending start() promise
  let restarts = []; // times of the supervised restarts, newest last
  let timer = null; let restartTimer = null; let pingTimer = null;
  let settle = null; // resolves the pending start() promise
  let supervising = false; // true from the first `ready` on: an exit or a failed start after that is a crash to restart, not a first-start failure
  let failedAt = -Infinity; // when the supervisor last gave up; start() tries again once retryAfterMs has passed (a slow retry, so a standalone machine recovers)

  const caPath = typeof caCertsPath === 'string' && caCertsPath.length > 0 && caCertsPath.length <= 1024 ? caCertsPath : null;
  const forkOptions = () => ({
    cwd: path.dirname(modulePath),
    env: { NODE_ENV: 'production', ...(caPath ? { NODE_EXTRA_CA_CERTS: caPath } : {}) },
    execArgv: ['--max-old-space-size=96'],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    serialization: 'json',
    windowsHide: true,
  });
  const clearTimers = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const clearPing = () => { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } };
  const giveUp = () => { clearPing(); secret = null; port = null; tools = []; state = 'failed'; failedAt = now(); };
  const send = (c, msg) => { try { c.send(msg); return true; } catch { return false; } };
  const kill = (c) => { try { c.kill('SIGKILL'); } catch { /* already gone */ } };
  const finish = (result) => { if (settle) { const s = settle; settle = null; s(result); } };
  const fail = (c, reason) => {
    clearTimers(); clearPing();
    if (c) { c.removeAllListeners?.('message'); kill(c); }
    if (c === child) child = null;
    // A restart attempt that fails (no ready in time, a bad ready, a dead channel) is a crash like any other: it spends the restart budget instead of ending the service.
    if (supervising && !stopping) { finish({ ok: false, reason }); crashed(); return; }
    giveUp();
    finish({ ok: false, reason });
  };

  // An unexpected end of a child that was serving (or of a restart attempt): restart up to 3 times inside 60 s (1 s, 2 s, 4 s backoff), with a new port and a new secret.
  function crashed() {
    clearPing();
    port = null; tools = [];
    restarts = restarts.filter((t) => now() - t < RESTART_WINDOW_MS);
    if (restarts.length >= MAX_RESTARTS) { giveUp(); return; }
    restarts.push(now());
    secret = null; state = 'starting';
    restartTimer = setTimeout(() => { restartTimer = null; if (!stopping) launch(); }, backoffMs[Math.min(restarts.length - 1, backoffMs.length - 1)] ?? 1000);
    restartTimer.unref?.();
  }

  // A child that is alive but wedged (stopped, or its event loop stuck) never exits on its own: two missed health answers in a row kill it, and the crash path restarts it.
  function watch(c) {
    if (!(pingMs > 0)) return;
    let misses = 0;
    pingTimer = setInterval(async () => {
      if (c !== child || state !== 'ready') return;
      const url = urlOf('/health');
      let ok = false;
      try { const r = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(pingTimeoutMs) }); ok = r.status === 200; try { await r.body?.cancel(); } catch { /* nothing to read */ } } catch { ok = false; }
      if (c !== child || state !== 'ready') return;
      misses = ok ? 0 : misses + 1;
      if (misses >= 2) { clearPing(); kill(c); }
    }, pingMs);
    pingTimer.unref?.();
  }

  function launch() {
    secret = randomBytes(32).toString('hex');
    let c;
    try { c = forkImpl(modulePath, [], forkOptions()); } catch { if (supervising && !stopping) { finish({ ok: false, reason: 'fork_failed' }); crashed(); return; } giveUp(); finish({ ok: false, reason: 'fork_failed' }); return; }
    child = c; state = 'starting';
    timer = setTimeout(() => fail(c, 'start_timeout'), startTimeoutMs);
    timer.unref?.();
    c.on('message', (m) => {
      if (c !== child || !m || typeof m !== 'object') return;
      if (m.type === 'ready' && state === 'starting') {
        if (!validPort(m.port) || !validTools(m.tools)) return fail(c, 'ready_invalid');
        clearTimers();
        port = m.port; tools = [...m.tools]; state = 'ready'; supervising = true;
        watch(c);
        finish({ ok: true, port });
      } else if (m.type === 'error') fail(c, 'init_failed');
    });
    c.on('error', () => { if (c === child && !stopping) fail(c, 'child_error'); });
    c.on('exit', () => {
      if (c !== child) return;
      child = null; clearTimers(); clearPing();
      if (stopping) return;
      if (!supervising) { giveUp(); finish({ ok: false, reason: 'exited' }); return; }
      crashed();
    });
    if (!send(c, { type: 'init', config: { issuer: config?.issuer, audience: config?.audience, allowedActors: config?.allowedActors, tierGroup: config?.tierGroup, hitlSecret: secret, clockSkewSeconds: SKEW_SECONDS } })) fail(c, 'send_failed');
  }

  function start() {
    if (hosted) return Promise.resolve({ ok: false, reason: 'hosted' }); // defence in depth: nothing is ever forked in the hosted build
    if (state === 'ready') return Promise.resolve({ ok: true, port });
    if (state === 'starting' && starting) return starting;
    if (state === 'failed') {
      // Failed stays failed for a cool-down, then one more try with a fresh restart budget (the supervisor gave up; a later run may find the cause gone).
      if (now() - failedAt < retryAfterMs) return Promise.resolve({ ok: false, reason: 'failed' });
      restarts = []; supervising = false; state = 'off';
    }
    stopping = false;
    starting = new Promise((resolve) => { settle = resolve; });
    launch();
    return starting;
  }

  // Waits up to waitMs for a child that is starting (a restart after a crash takes 1 to 4 s), and tries once more when the supervisor has given up and its cool-down has
  // passed. True when the service is ready. A run asks this before it picks a provider, so a restart window is not a silent switch to the lab's own steps.
  async function ready(waitMs = 5000) {
    if (hosted || state === 'off') return false;
    if (state === 'failed') await start();
    const t0 = Date.now();
    while (state === 'starting' && Date.now() - t0 < waitMs) await new Promise((r) => { const t = setTimeout(r, 40); t.unref?.(); });
    return state === 'ready';
  }

  async function stop() {
    stopping = true; supervising = false;
    clearTimers(); clearPing();
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    const c = child;
    child = null; port = null; tools = []; secret = null; state = 'off';
    finish({ ok: false, reason: 'stopped' });
    if (!c) return;
    await new Promise((resolve) => {
      const t = setTimeout(() => { kill(c); resolve(); }, 2000);
      t.unref?.();
      c.once('exit', () => { clearTimeout(t); resolve(); });
      if (!send(c, { type: 'shutdown' })) { kill(c); resolve(); }
    });
  }

  const urlOf = (suffix) => (state === 'ready' && port ? `http://127.0.0.1:${port}${suffix}` : null);
  return {
    start, stop, ready,
    state: () => state,
    mcpUrl: () => urlOf('/mcp'),
    hitl: () => (state === 'ready' && port && secret ? { url: `http://127.0.0.1:${port}/hitl`, secret } : null),
    toolNames: () => [...tools],
    healthUrl: () => urlOf('/health'),
  };
}
