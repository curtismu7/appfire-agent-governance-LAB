// The child's own netguard: only loopback and the one allowed issuer name pass; everything else is refused and recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dns from 'node:dns';
import dgram from 'node:dgram';
import http from 'node:http';
import { installGuard } from '../src/local/guard.js';
import { startRig } from './localHarness.js';

const RESERVED = ['192', '0', '2', '1'].join('.');   // TEST-NET-1, never routed

test('with nothing allowed, every way out is refused and recorded', async () => {
  const g = installGuard({ allowHosts: [] });
  try {
    await assert.rejects(fetch('https://blocked.example/', { signal: AbortSignal.timeout(1500) }), /network blocked/);
    await assert.rejects(fetch(new URL(`http://${RESERVED}/`), { signal: AbortSignal.timeout(1500) }), /network blocked/);
    assert.throws(() => net.connect({ host: RESERVED, port: 80 }), /network blocked/);
    assert.throws(() => net.connect(80, 'blocked.example'), /network blocked/);
    assert.throws(() => net.connect({ host: '0.0.0.0', port: 80 }), /network blocked/);
    assert.throws(() => net.connect('/tmp/some.sock'), /network blocked/);
    assert.throws(() => http.get({ host: RESERVED, port: 80 }), /network blocked/);
    await assert.rejects(new Promise((res, rej) => dns.lookup('blocked.example', (e) => (e ? rej(e) : res()))), /network blocked/);
    await assert.rejects(dns.promises.lookup('blocked.example'), /network blocked/);
    await assert.rejects(dns.promises.resolve4('blocked.example'), /network blocked/);
    await assert.rejects(new Promise((res, rej) => dns.resolve4('blocked.example', (e) => (e ? rej(e) : res()))), /network blocked/);
    await assert.rejects(new dns.promises.Resolver().resolve4('blocked.example'), /network blocked/);
    const sock = dgram.createSocket('udp4');
    try { assert.throws(() => sock.send('x', 9, 'blocked.example'), /network blocked/); assert.throws(() => sock.send('x', 9, RESERVED), /network blocked/); } finally { sock.close(); }
    const a = g.attempts.join(' ');
    for (const want of ['fetch:blocked.example', `fetch:${RESERVED}`, `socket:${RESERVED}`, 'socket:blocked.example', 'socket:0.0.0.0', 'socket:unix-socket', 'dns:blocked.example', 'udp:blocked.example', `udp:${RESERVED}`]) assert.ok(a.includes(want), want);
  } finally { g.restore(); }
});

test('allowHost allows exactly one DNS name: not a subdomain, not an IP literal, not a pattern', () => {
  const g = installGuard({ allowHosts: ['auth.pingone.com'] });
  try {
    assert.equal(g.isPermitted('auth.pingone.com'), true);
    assert.equal(g.isPermitted('AUTH.PINGONE.COM'), true);
    assert.equal(g.isPermitted('evil.auth.pingone.com'), false);
    assert.equal(g.isPermitted('pingone.com'), false);
    assert.equal(g.isPermitted('auth.pingone.com.evil.example'), false);
    for (const bad of [RESERVED, '*.pingone.com', '0.0.0.0', 'localhost', 'a b', '', null, undefined, '::1', '[::1]']) assert.equal(g.allowHost(bad), false, String(bad));
    assert.deepEqual(g.allowedHosts(), ['auth.pingone.com']);
    assert.equal(g.isPermitted(RESERVED), false);
    for (const loop of ['127.0.0.1', 'localhost', '::1', '[::1]', '127.0.0.2']) assert.equal(g.isPermitted(loop), true, loop);
    assert.equal(g.allowHost('second.example.com'), true, 'a later name can be added');
  } finally { g.restore(); }
});

test('an allowed name passes the connect guard, an unallowed one does not (checked without touching the network)', () => {
  const realConnect = net.Socket.prototype.connect;
  const g = installGuard({ allowHosts: ['allowed.example'] });
  try {
    // The guard throws "network blocked" before connecting; for the allowed name the underlying connect is what runs, so the error is anything else.
    let err = null;
    const s = new net.Socket();
    s.on('error', () => {});
    try { s.connect({ host: 'allowed.example', port: 1, lookup: (_h, _o, cb) => cb(new Error('no lookup in a test')) }); } catch (e) { err = e; }
    assert.ok(!err || !/network blocked/.test(err.message));
    s.destroy();
    assert.throws(() => new net.Socket().connect({ host: 'other.example', port: 1 }), /network blocked: other.example/);
  } finally { g.restore(); }
  assert.equal(net.Socket.prototype.connect === realConnect, true, 'restore puts the real function back');
});

test('the attempts list keeps the last 200 only', async () => {
  const g = installGuard({ allowHosts: [] });
  try {
    for (let i = 0; i < 260; i += 1) await fetch(`https://h${i}.example/`).catch(() => {});
    assert.equal(g.attempts.length, 200);
    assert.equal(g.attempts.at(-1), 'fetch:h259.example');
    assert.equal(g.attempts[0], 'fetch:h60.example');
  } finally { g.restore(); }
});

test('a full valid flow against the loopback issuer leaves zero attempts', async () => {
  const g = installGuard({ allowHosts: [] });
  const rig = await startRig();
  try {
    const tok = rig.token({});
    const r = await rig.call('get_my_issues', {}, { tok });
    assert.equal(r.status, 200);
    assert.equal((await rig.call('bulk_update_issues', { project: 'PLAT', issue_count: 300 }, { tok })).status, 428);
    assert.deepEqual(g.attempts, []);
    assert.equal((await fetch(`${rig.origin}/health`)).status, 200, 'global fetch to loopback still works under the guard');
  } finally { await rig.close(); g.restore(); }
});

test('installing twice returns the same guard and restore leaves nothing patched', () => {
  const connect = net.Socket.prototype.connect; const lookup = dns.lookup; const f = globalThis.fetch;
  const a = installGuard({ allowHosts: [] });
  const b = installGuard({ allowHosts: ['again.example'] });
  assert.equal(a, b);
  assert.equal(a.isPermitted('again.example'), true);
  a.restore();
  assert.equal(net.Socket.prototype.connect, connect); assert.equal(dns.lookup, lookup); assert.equal(globalThis.fetch, f);
});
