// The child process entry (forked by the lab). It reads NO environment variable: everything it needs arrives in ONE `init` IPC message
// (the issuer, the audience, the allowed actor, the tier group and the approval secret). It speaks IPC only to its parent: `init` in; `ready`,
// `error` out; `shutdown` in. It writes one fixed line on a fatal error and never a value, a stack or a message.
import { installGuard } from './guard.js';
import { startLocalServer, validateInit } from './server.js';

// The guard first: before any server, any fetch, any message. It allows nothing but loopback until init names the issuer host.
const guard = installGuard({ allowHosts: [] });

const fatal = () => { try { process.stderr.write('appfire-tools-local: fatal error\n'); } catch { /* nothing to report to */ } process.exit(1); };
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

const send = (m) => { try { process.send(m); return true; } catch { return false; } };
// Says something to the parent and exits 1 once the message is flushed (an exit right after send() can lose it).
const sendAndExit = (m) => {
  let done = false;
  const end = () => { if (!done) { done = true; process.exit(1); } };
  setTimeout(end, 500);
  try { process.send(m, undefined, undefined, end); } catch { end(); }
};
let running = null;
let stopping = false;

async function stop(code) {
  if (stopping) return;
  stopping = true;
  try { if (running) await running.close(); } catch { /* exiting anyway */ }
  process.exit(code);
}

if (typeof process.send !== 'function') { process.stderr.write('appfire-tools-local: needs an IPC channel\n'); process.exit(1); }

const initTimer = setTimeout(() => process.exit(1), 5000);
let initDone = false;

process.on('message', async (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'shutdown') { await stop(0); return; }
  if (m.type !== 'init' || initDone) return;
  initDone = true;
  clearTimeout(initTimer);
  const checked = validateInit(m.config);
  if (!checked.ok) { sendAndExit({ type: 'error', code: 'init_invalid', detail: 'the init message was refused' }); return; }
  if (checked.issuerHost) guard.allowHost(checked.issuerHost);
  try {
    running = await startLocalServer({ config: checked.config });
  } catch {
    sendAndExit({ type: 'error', code: 'listen_failed', detail: 'the server could not listen on loopback' });
    return;
  }
  send({ type: 'ready', port: running.port, pid: process.pid, tools: running.toolNames });
});

process.on('disconnect', () => { void stop(0); });
process.on('SIGTERM', () => { void stop(0); });
process.on('SIGINT', () => { void stop(0); });
