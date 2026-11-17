// The local tool server's own netguard. It copies the idea of the lab's netguard, not its file (this directory imports nothing from the lab).
// Only a loopback address or an EXACT allowed DNS name (the issuer host) passes. Everything else is refused and recorded in `attempts`.
import dns from 'node:dns';
import net from 'node:net';
import dgram from 'node:dgram';
import { isLoopbackHost, isPlainDnsName } from './util.js';

let active = null;
const MAX_ATTEMPTS = 200;
const RESOLVERS = ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'];

export function installGuard({ allowHosts = [] } = {}) {
  if (active) { for (const h of allowHosts) active.allowHost(h); return active; }
  const attempts = [];                       // the last MAX_ATTEMPTS refusals: fetch:<host>, socket:<host>, dns:<host>, udp:<host>
  const record = (entry) => { attempts.push(entry); if (attempts.length > MAX_ATTEMPTS) attempts.shift(); };
  const allowed = new Set();
  const permitted = (h) => isLoopbackHost(h) || allowed.has(String(h).toLowerCase());
  const real = { connect: net.Socket.prototype.connect, lookup: dns.lookup, fetch: globalThis.fetch, send: dgram.Socket.prototype.send, plookup: dns.promises.lookup };
  const blocked = (host) => new Error(`network blocked: ${host}`);

  // The resolver family and Resolver instances are loopback-only (never the allowed name: lookup() is what connect uses).
  const savedResolvers = [];
  const guardedResolve = (label, target) => function resolveGuard(host, ...rest) {
    const h = String(host);
    if (isLoopbackHost(h)) return target.apply(this, [host, ...rest]);
    record(`dns:${h}`);
    const cb = rest.find((r) => typeof r === 'function');
    if (label === 'cb') { if (cb) return cb(blocked(h)); throw blocked(h); }
    return Promise.reject(blocked(h));
  };
  for (const [label, holder] of [['cb', dns], ['promise', dns.promises], ['cb', dns.Resolver.prototype], ['promise', dns.promises.Resolver.prototype]]) {
    for (const name of RESOLVERS) {
      if (typeof holder[name] !== 'function') continue;
      savedResolvers.push([holder, name, holder[name]]);
      holder[name] = guardedResolve(label, holder[name]);
    }
  }

  const hostOf = (rawArgs) => {
    const args = Array.isArray(rawArgs[0]) ? rawArgs[0] : rawArgs;       // net.connect hands connect() a normalised array
    const a = args[0];
    if (a && typeof a === 'object' && !Array.isArray(a)) return a.path ? 'unix-socket' : (a.host || 'localhost');
    if (typeof a === 'string' && Number.isNaN(Number(a))) return 'unix-socket';
    return typeof args[1] === 'string' ? args[1] : 'localhost';
  };
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const host = hostOf(args);
    if (!permitted(host)) { record(`socket:${host}`); throw blocked(host); }
    return real.connect.apply(this, args);
  };
  dns.lookup = function guardedLookup(host, ...rest) {
    if (!permitted(host)) {
      record(`dns:${host}`);
      const cb = rest.find((r) => typeof r === 'function');
      if (cb) return cb(blocked(host));
      throw blocked(host);
    }
    return real.lookup.call(dns, host, ...rest);
  };
  dns.promises.lookup = async function guardedPromiseLookup(host, ...rest) {
    if (!permitted(host)) { record(`dns:${host}`); throw blocked(host); }
    return real.plookup.call(dns.promises, host, ...rest);
  };
  globalThis.fetch = async function guardedFetch(input, init) {
    let host;
    try { host = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname; } catch { host = 'invalid'; }
    if (!permitted(host)) { record(`fetch:${host}`); throw blocked(host); }
    return real.fetch(input, init);
  };
  dgram.Socket.prototype.send = function guardedSend(...args) {
    const rest = args.slice(1);
    const addr = typeof rest[1] === 'number' ? rest[3] : rest[1];
    const ok = addr === undefined || typeof addr === 'function' || (typeof addr === 'string' && isLoopbackHost(addr));
    if (!ok) { record(`udp:${addr}`); throw blocked(addr); }
    return real.send.apply(this, args);
  };

  active = {
    attempts,
    // One exact DNS name. An IP literal, a wildcard or a pattern is refused (returns false) and allows nothing.
    allowHost(host) {
      if (!isPlainDnsName(host)) return false;
      allowed.add(String(host).toLowerCase());
      return true;
    },
    allowedHosts: () => [...allowed],
    isPermitted: permitted,
    restore() {
      allowed.clear();
      for (const [holder, name, orig] of savedResolvers) holder[name] = orig;
      dns.promises.lookup = real.plookup;
      net.Socket.prototype.connect = real.connect; dns.lookup = real.lookup; globalThis.fetch = real.fetch; dgram.Socket.prototype.send = real.send;
      active = null;
    },
  };
  for (const h of allowHosts) active.allowHost(h);
  return active;
}
