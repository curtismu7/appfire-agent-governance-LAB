// A fake tool server (MCP over Streamable HTTP) on a loopback port, for the provider tests. It speaks the WIRE contract of design-real-local.md B.3 to B.7 and
// nothing more: it does NOT check a signature (isDelegated decides whether a bearer counts), it reads the scope and groups claims from the bearer's payload, and
// it applies the lab policy in a few lines. It is not server/src/local (PROVIDER never imports LOCAL's server in these tests): it proves the lab's reading of the
// wire shapes, which is also the contract an SE-hosted instance of the tool server would have to meet (R2a).
//   state.behaviour: 'ok' | 'token' (401 invalid_token with state.reason on every call that carries a token) | 'jwks' (503 jwks_unavailable on initialize)
//   | 'down' (503 on initialize) | 'redirect' (307 on initialize) | 'tool-error' (a JSON-RPC error on tools/call)
// GET /health answers 200 (state.health = 200 | 500) so the SE probe has something to read. /hitl/challenges/:id/respond records a decision (header
// x-hitl-internal-secret must equal HITL_SECRET) and a retry with the challenge id as _hitl_challenge_id is verified once.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

export const TOOL_SESSION_ID = 'fake-tool-session-0001';
export const HITL_SECRET = ['fake', '-hitl-', 'secret-', 'for-tests-', '00ff00ff00ff00ff'].join('');
const SCOPES = { get_my_issues: 'issues:read', bulk_update_issues: 'issues:write', get_project_security_settings: 'security:read', get_release_summary: 'release:read', list_marketplace_apps: null, get_deployment_status: 'deploy:read', request_admin_access: 'admin:request', scan_repository: 'security:read', brave_news_search: 'issues:read', code_search: 'issues:read',
  get_airline_bookings: 'trips:read', get_flight_status: 'flights:read', book_airline_flight: 'flights:book', sensitive_passenger_record: 'travellers:read', list_airports: null, request_change_fee_waiver: 'fees:request' };
// The airline pack's flights (a copy of the table the real tool server holds): the fake applies the same booking rule in a few lines.
export const FLIGHTS = { 'LK 109': ['ORD', 'DEN', 150], 'LK 214': ['ORD', 'DEN', 380], 'LK 322': ['ORD', 'YYZ', 380], 'LK 330': ['ORD', 'SFO', 400], 'LK 331': ['ORD', 'SEA', 401], 'LK 560': ['ORD', 'BOS', 780], 'LK 650': ['ORD', 'LAX', 1500], 'LK 651': ['ORD', 'HNL', 1501], 'LK 704': ['ORD', 'CDG', 2400], 'LK 800': ['ORD', 'LHR', 1100] };
export const COUNTRY = { ORD: 'US', DEN: 'US', YYZ: 'CA', SFO: 'US', SEA: 'US', BOS: 'US', LAX: 'US', HNL: 'US', CDG: 'FR', LHR: 'GB' };
const GROUPED = { get_project_security_settings: 'software', sensitive_passenger_record: 'airline' };
const ISSUES = [{ key: 'PLAT-412', summary: 'Rate limiter returns 500 on burst', status: 'In Progress', priority: 'High' }, { key: 'PLAT-418', summary: 'Upgrade build image to Node 26', status: 'To Do', priority: 'Medium' }, { key: 'BILL-77', summary: 'Invoice rounding on partial refunds', status: 'To Do', priority: 'Medium' }];
const claimsOf = (t) => { try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; } };
const scopesOf = (c) => (Array.isArray(c.scope) ? c.scope : typeof c.scope === 'string' ? c.scope.split(' ') : []);
const groupsOf = (c) => (Array.isArray(c.groups) ? c.groups : typeof c.groups === 'string' ? [c.groups] : []);

export async function startFakeToolServer({ behaviour = 'ok', isDelegated = () => true, tierGroup = 'Software_EnterpriseTier', tierGroupAirline = 'Airline_OrbitTier', reason = 'aud_mismatch' } = {}) {
  const seen = [];
  const state = { behaviour, reason, health: 200, hits: { health: 0 } };
  const challenges = new Map(); // id -> { status, sub, tool, digest, used }
  const digest = (args) => JSON.stringify(Object.fromEntries(Object.entries(args ?? {}).filter(([k]) => k !== '_hitl_challenge_id').sort(([a], [b]) => (a < b ? -1 : 1))));
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let rpc = null; try { rpc = JSON.parse(text); } catch { rpc = null; }
      seen.push({ method: req.method, url: req.url, headers: req.headers, rpc });
      const send = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(obj === null ? '' : JSON.stringify(obj)); };
      const audit = (decision, rule, tool) => ({ 'x-gw-audit-trail': JSON.stringify({ decision, source: 'lab-policy', rule, tool, trace: null }) });
      if (req.url === '/health') { state.hits.health += 1; return send(state.health, { ok: true, service: 'fake-tool-server' }); }
      // The approval service (the secret is required on every route).
      const hm = /^\/hitl\/challenges\/([A-Za-z0-9-]+)\/respond$/.exec(req.url);
      if (hm) {
        if (req.headers['x-hitl-internal-secret'] !== HITL_SECRET) return send(401, { error: 'unauthorized' });
        const ch = challenges.get(hm[1]); if (!ch) return send(404, { error: 'unknown_challenge' });
        let b = {}; try { b = JSON.parse(text); } catch { /* bad */ }
        if (ch.status !== 'pending') return send(409, { error: 'already_answered', status: ch.status });
        ch.status = b.decision === 'approved' ? 'approved' : 'denied';
        return send(200, { id: hm[1], status: ch.status, decision: ch.status, respondedAt: new Date().toISOString() });
      }
      if (req.method !== 'POST' || req.url !== '/mcp' || !rpc) return send(404, { error: 'not_found' });
      const b = state.behaviour;
      const bearer = /^Bearer (.+)$/i.exec(String(req.headers.authorization || ''))?.[1] ?? null;
      if (b === 'down' && rpc.method === 'initialize') return send(503, { error: 'unavailable' });
      // 'down-after-probe': the provider's unauthenticated probe finds it up, the run's own initialize (it carries a bearer) finds it down.
      if (b === 'down-after-probe' && bearer && rpc.method === 'initialize') return send(503, { error: 'unavailable' });
      if (b === 'redirect' && rpc.method === 'initialize') return send(307, null, { location: '/elsewhere' });
      if (b === 'jwks' && bearer) return send(503, { error: 'jwks_unavailable', message: 'fixed', reason: 'jwks_unavailable', by: 'tool server' }, { 'retry-after': '5' });
      if (bearer && (b === 'token' || !isDelegated(bearer))) return send(401, { error: 'invalid_token', message: 'fixed', reason: state.reason, by: 'tool server' }, { 'www-authenticate': `Bearer realm="appfire-tools-local", error="invalid_token", error_description="${state.reason}"` });
      const claims = bearer ? claimsOf(bearer) : null;
      if (rpc.method === 'initialize') return send(200, { jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'fake-tool-server', version: '1' } } }, { 'mcp-session-id': TOOL_SESSION_ID });
      if (rpc.method === 'notifications/initialized') { res.writeHead(202); res.end(); return undefined; }
      if (req.headers['mcp-session-id'] !== TOOL_SESSION_ID) return send(404, { error: 'session_unknown' });
      if (rpc.method === 'tools/list') {
        const mine = Object.entries(SCOPES).filter(([name, scope]) => scope === null || (claims && scopesOf(claims).includes(scope) && (!Object.hasOwn(GROUPED, name) || groupsOf(claims).includes(GROUPED[name] === 'airline' ? tierGroupAirline : tierGroup)))).map(([name]) => name);
        return send(200, { jsonrpc: '2.0', id: rpc.id, result: { tools: mine.map((name) => ({ name, inputSchema: { type: 'object' } })) } });
      }
      if (rpc.method !== 'tools/call') return send(200, { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: 'unknown method' } });
      const name = rpc.params?.name; const args = rpc.params?.arguments ?? {};
      if (b === 'tool-error') return send(200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'invalid arguments: limit' } });
      const refuse = (status, error, ruleId, extra = {}) => send(status, { error, message: 'fixed', reason: ruleId, by: 'tool server', ...extra }, audit(status === 428 ? (error === 'step_up_required' ? 'STEP_UP' : 'HITL_REQUIRED') : 'DENY', ruleId, name));
      if (!Object.hasOwn(SCOPES, name)) return bearer ? send(200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'unknown tool' } }) : send(401, { error: 'no_token', message: 'fixed', reason: 'no_token', by: 'tool server' }, { 'www-authenticate': 'Bearer realm="appfire-tools-local"' });
      if (SCOPES[name] !== null && !bearer) return send(401, { error: 'no_token', message: 'fixed', reason: 'no_token', by: 'tool server' }, { 'www-authenticate': 'Bearer realm="appfire-tools-local"' });
      if (SCOPES[name] !== null && !scopesOf(claims).includes(SCOPES[name])) return refuse(403, 'insufficient_scope', 'lab-scope');
      if (Object.hasOwn(GROUPED, name) && !groupsOf(claims).includes(GROUPED[name] === 'airline' ? tierGroupAirline : tierGroup)) return refuse(403, 'group_required', 'lab-group-gate', { required_group: GROUPED[name] === 'airline' ? tierGroupAirline : tierGroup });
      let narrow = null; let bookAudit = null;
      if (name === 'book_airline_flight') {
        // The same rule as the real tool server (section 4.3), in a few lines: the fare is the table's, a receipt is bound to the exact arguments, an approval beats a narrowing.
        if (!Object.hasOwn(FLIGHTS, args.flight)) return send(200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'invalid arguments: flight is not valid' } });
        const [from, to, fare] = FLIGHTS[args.flight]; const cabin = args.cabin ?? 'economy'; const intl = COUNTRY[from] !== COUNTRY[to];
        if (fare > 1500) {
          const id = args._hitl_challenge_id;
          if (typeof id === 'string') {
            const ch = challenges.get(id);
            const ok = ch && ch.status === 'approved' && !ch.used && ch.sub === claims.sub && ch.digest === digest(args);
            if (!ok) return send(403, { error: 'hitl_receipt_rejected', message: 'fixed', reason: !ch ? 'receipt_unknown' : ch.status === 'pending' ? 'receipt_pending' : ch.status === 'denied' ? 'receipt_denied' : ch.used ? 'receipt_used' : 'receipt_binding_mismatch', by: 'tool server' });
            ch.used = true; bookAudit = audit('PERMIT', 'lab-fare-approved', name);
          } else {
            const id2 = randomUUID(); challenges.set(id2, { status: 'pending', sub: claims.sub, tool: name, digest: digest(args), used: false, amount: fare });
            return send(428, { error: 'approval_required', message: 'fixed', reason: 'lab-fare-hold', by: 'tool server', challengeId: id2, expiresAt: new Date(Date.now() + 300_000).toISOString(), tool: name, fare_judged: fare, international: intl }, audit('HITL_REQUIRED', 'lab-fare-hold', name));
          }
        } else if (cabin === 'business' && (intl || fare > 400)) {
          narrow = [...(intl ? ['international'] : []), ...(fare > 400 ? ['over-limit'] : [])];
          bookAudit = audit('CONSTRAINED', 'lab-fare-constrained', name);
        }
      }
      if (name === 'scan_repository' && !['platform', 'billing', 'mobile'].includes(String(args.repo || '').toLowerCase())) return refuse(403, 'repo_not_allowed', 'lab-repo-allowlist');
      if (name === 'brave_news_search' && /bitcoin|crypto/i.test(String(args.query || ''))) return refuse(403, 'blocked_term', 'lab-blocked-term');
      if (name === 'bulk_update_issues') {
        const n = Number(args.issue_count);
        if (n >= 2000) return refuse(403, 'access_denied', 'lab-band-deny');
        if (n >= 500) return refuse(428, 'step_up_required', 'lab-band-step-up');
        if (n >= 200) {
          const id = args._hitl_challenge_id;
          if (typeof id === 'string') {
            const ch = challenges.get(id);
            const ok = ch && ch.status === 'approved' && !ch.used && ch.sub === claims.sub && ch.digest === digest(args);
            if (!ok) return send(403, { error: 'hitl_receipt_rejected', message: 'fixed', reason: !ch ? 'receipt_unknown' : ch.status === 'pending' ? 'receipt_pending' : ch.status === 'denied' ? 'receipt_denied' : ch.used ? 'receipt_used' : 'receipt_binding_mismatch', by: 'tool server' });
            ch.used = true;
          } else {
            const id2 = randomUUID(); challenges.set(id2, { status: 'pending', sub: claims.sub, tool: name, digest: digest(args), used: false });
            return send(428, { error: 'approval_required', message: 'fixed', reason: 'lab-band-hold', by: 'tool server', challengeId: id2, expiresAt: new Date(Date.now() + 300_000).toISOString(), tool: name }, audit('HITL_REQUIRED', 'lab-band-hold', name));
          }
        }
      }
      const payloads = {
        get_my_issues: () => ({ signed_in_sub: claims?.sub ?? null, total: 8, returned: Math.min(Number(args.limit) || 5, 3), issues: ISSUES.slice(0, Number(args.limit) || 5) }),
        bulk_update_issues: () => ({ project: args.project, field: args.field, value: args.value, issue_count: args.issue_count, status: 'applied', change_id: 'CHG-ab12cd', note: 'Applied to synthetic lab data only.' }),
        get_project_security_settings: () => ({ project: args.project ?? 'PLAT', visibility: 'private', two_step_verification: 'required', permission_scheme: 'Standard' }),
        list_marketplace_apps: () => ({ total: 2, apps: [{ name: 'Sprint Pulse', vendor: 'Example Vendor', category: 'Reporting', installs: 1200 }, { name: 'Release Radar', vendor: 'Example Vendor', category: 'Automation', installs: 980 }] }),
        get_deployment_status: () => ({ environment: args.environment, service: 'platform-api', version: '2026.11.2', status: 'healthy' }),
        request_admin_access: () => ({ request_id: 'REQ-0a1b2c', status: 'pending', role: args.role, project: args.project, requested_by: claims?.sub ?? null, note: 'A request only. Nothing was granted.' }),
        scan_repository: () => ({ repo: args.repo, summary: { critical: 0, high: 0, medium: 1, low: 2 } }),
        brave_news_search: () => ({ query: args.query, results: [{ title: 'Jira workflow automation (example)', url: 'https://news.example/a' }] }),
        code_search: () => ({ query: args.query, matches: [{ repo: 'platform', path: 'src/limiter.js', line: 42 }] }),
        get_release_summary: () => ({ project: 'PLAT', release: '2026.11.2', status: 'on track' }),
        get_airline_bookings: () => ({ signed_in_sub: claims?.sub ?? null, total: 2, returned: 2, trips: [{ flight: 'LK 214', route: 'ORD to DEN', cabin: 'business', status: 'confirmed' }, { flight: 'LK 560', route: 'ORD to BOS', cabin: 'economy', status: 'confirmed' }], miles: 18400 }),
        get_flight_status: () => ({ flight: args.flight, route: 'ORD to DEN', status: 'on time', gate: 'B12', departs: 'Friday 8:15 am' }),
        book_airline_flight: () => {
          const [from, to, fare] = FLIGHTS[args.flight]; const cabin = args.cabin ?? 'economy';
          return { status: 'booked', confirmation: 'LKR-3F9A21', flight: args.flight, from, to, international: COUNTRY[from] !== COUNTRY[to], fare_judged: fare, cabin_asked: cabin, cabin_booked: narrow ? 'economy' : cabin,
            ...(narrow ? { constrained: { field: 'cabin', asked: cabin, granted: 'economy', because: narrow, limit: 400, rule: 'lab-fare-constrained' } } : {}), note: 'Booked on synthetic lab data only.' };
        },
        sensitive_passenger_record: () => ({ passport_last4: '4471', known_traveller_number: 'on file (hidden)', card_last4: '4821', note: 'Full numbers are never returned by this tool.' }),
        list_airports: () => ({ total: 11, airports: [{ code: 'MDW', name: 'Midway', miles_away: 14 }, { code: 'ORD', name: "O'Hare", miles_away: 17 }] }),
        request_change_fee_waiver: () => ({ request_id: 'CFW-0a1b2c', status: 'pending review', flight: args.flight ?? 'LK 214', requested_by: claims?.sub ?? null, note: 'This tool only files a request; no tool here can grant a waiver.' }),
      };
      const payload = { ...payloads[name](), lab_invented: true };
      return send(200, { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload, isError: false } }, SCOPES[name] === null ? {} : (bookAudit ?? audit('PERMIT', 'lab-no-restriction', name)));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { seen, state, challenges, port, url: `http://127.0.0.1:${port}/mcp`, hitlUrl: `http://127.0.0.1:${port}/hitl`, origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

// A stand-in for createLocalServices() (server/src/localServices.js) that points at a fake tool server: the same API, no child process.
export const stubLocal = (fake, { state = 'ready' } = {}) => ({
  start: async () => ({ ok: true, port: fake.port }), stop: async () => {},
  state: () => state, mcpUrl: () => (state === 'ready' ? fake.url : null), healthUrl: () => (state === 'ready' ? `${fake.origin}/health` : null),
  hitl: () => (state === 'ready' ? { url: fake.hitlUrl, secret: HITL_SECRET } : null), toolNames: () => Object.keys(SCOPES),
});
