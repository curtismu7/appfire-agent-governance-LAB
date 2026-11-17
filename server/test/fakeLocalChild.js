// A stand-in for server/src/local/main.js that speaks the IPC protocol of design-real-local.md B.1, so localServices.js can be tested without the real child.
// Two uses. (1) As a script: `fork(thisFile)`; the behaviour is picked by the `tierGroup` the parent sends in `init` (the only free-text field of init):
//   'ok' (default) | 'silent' (never answers) | 'error' (sends an init error) | 'bad-port' | 'reserved-port' | 'bad-tool' | 'die-after-ready' (exits 1 once ready)
//   | 'report-env' (answers ready with the child's own environment variable names as its tool names, lower-cased) | 'echo-secret' (answers with the secret length).
// (2) makeFakeFork(script): a forkImpl for in-process tests that records every call and drives a fake child by hand (no process, no clock).
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const READY = (extra = {}) => ({ type: 'ready', port: 41234, pid: process.pid, tools: ['get_my_issues', 'bulk_update_issues'], ...extra });

if (typeof process.send === 'function' && process.argv[1] === fileURLToPath(import.meta.url)) {
  const behave = (init) => {
    const how = init.config?.tierGroup;
    if (how === 'silent') return;
    if (how === 'error') { process.send({ type: 'error', code: 'init_invalid', detail: 'fixed text' }); process.exit(1); }
    if (how === 'bad-port') return process.send(READY({ port: 80 }));
    if (how === 'reserved-port') return process.send(READY({ port: 7820 }));
    if (how === 'bad-tool') return process.send(READY({ tools: ['Not A Tool!'] }));
    if (how === 'report-env') return process.send(READY({ tools: Object.keys(process.env).map((k) => k.toLowerCase()) }));
    process.send(READY());
    if (how === 'die-after-ready') setTimeout(() => process.exit(1), 20);
  };
  process.on('message', (m) => {
    if (m?.type === 'init') behave(m);
    if (m?.type === 'shutdown') process.exit(0);
  });
  process.on('disconnect', () => process.exit(0));
}

// In-process: forkImpl(modulePath, args, options) returns an emitter with send/kill, and `calls` keeps what was asked.
export function makeFakeFork() {
  const calls = []; const children = [];
  const forkImpl = (modulePath, args, options) => {
    const child = new EventEmitter();
    child.sent = []; child.killed = false; child.connected = true;
    child.send = (m) => { if (!child.connected) throw new Error('closed'); child.sent.push(m); };
    child.kill = () => { child.killed = true; child.connected = false; setImmediate(() => child.emit('exit', null, 'SIGKILL')); return true; };
    calls.push({ modulePath, args, options }); children.push(child);
    return child;
  };
  return { forkImpl, calls, children, last: () => children[children.length - 1] };
}
