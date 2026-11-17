# Design lock: Real on two providers (SE and local)

Status: LOCKED 2026-11-16. Three builders implement this in parallel and never talk to each other, so every interface below is exact. Where this file and a
builder's taste differ, this file wins. If a builder finds a contradiction or a gap, they do the smallest reading that keeps the contract, and say so in
their final report (one line per case); they never change a name, a status code, a JSON key or a file owner here.

Sources: owner decisions 2026-11-16 (1 to 7, restated in section 0), `feasibility-plan.json`, `research.json`, `skeptics.json`, the lab's own code at
`e0633ae`. Nothing here was run against a tenant or SE. Every statement about PingOne, PingFederate or SE behaviour is UNVERIFIED until the owner's live run
(section G).

## 0. Owner decisions this design implements (2026-11-16, final)

1. Real use cases are built for real. Software tools run on a lab-shipped local tool server; SE services are used when they work. Hosting is BOTH: every real
   capability has an SE provider and a local provider shipped in the lab's own image, so the lab runs standalone on another machine. The DATA (never the
   page's words) says which answered. `auto` = SE when its settings are present and a cheap health probe passes, else local. `AAG_PROVIDER=auto|se|local`
   overrides. Chosen ONCE per run, never switches mid-run.
2. The issuer is ALWAYS the user's own PingOne and/or PingFederate. NEVER a local issuer or lab-made signer on the real path. Local services validate P1/PF
   tokens against the issuer's JWKS from discovery (iss, aud, exp/nbf with skew, scope, act.sub, alg allow-list RS256/ES256, kid or x5t). PingFederate is
   design-only: the verifier is issuer-neutral (section B.4), but there is no PF sign-in or exchange lane, and a PF-only user gets the plain note
   `NEEDS_PINGONE_NOTE` (section C.9).
3. "Software is mock-only" is reversed (`castMockOnly` is removed). The SE gateway URL, audience and scope become OPTIONAL so Real can start with only the
   local provider.
4. The lab ships its own gateway-style enforcer and approval (HITL) service in the same container: loopback only, no published port, never started in hosted
   mode, secrets over IPC not env, its own netguard.
5. NOT in scope, stay on the engine with their current reasons: UC5, UC11, UC12, UC13, UC14, UC14b, UC18, UC27, UC2.6, UC2.7, UC37, UC10, UC34, UC35, UC48.
   UC22 (CIBA) is a LATER wave: not built, but the provider interface must be able to host it (section C.10).
6. The page never says mock / simulated / engine and has no Mock | Real control (the hide-mock-labels rule: `scripts/e2e.mjs` word scan and the server
   `noMockWords` test stay green). The provider is shown in the DATA (`hop.provider` `'se'|'local'`, separate from `hop.source`) and in the step detail key
   facts as `Answered by: tool server (local)` / `Agent Gateway (SE)`. It is not a chip.
7. Honesty: Real decisions are `inferred` or `observed`, never `checked`. A local refusal is labelled `lab policy (local), not PingOne Authorize` wherever the
   lab's own rule produced it. The lab's tool data is lab-invented and says so. LAB-INVENTED tags stay.

### Readings I made (the owner may overrule; each is also in section G)

- R1. The local provider serves the SOFTWARE vertical's tools only. Banking, healthcare and retail keep needing the SE gateway (there is no local banking tool
  server). So "runs completely standalone on another machine" is true for the software vertical, which is the default vertical.
- R2. "SE provider" for the software tools = an SE-hosted instance of the same tool server (same image, same protocol), reached at `AAG_TOOLS_SE_URL`. If it
  is unset, the software vertical has only the local provider. A real Agent Gateway in front of software tools does not exist today.
- R2a (SKEPTIC FIX, an ownership gap): `main.js` is a child that needs an IPC `init`, so nothing in this design builds a standalone entry for an "SE-hosted instance of the same tool server". `AAG_TOOLS_SE_URL` is therefore a WIRE CONTRACT (B.3 to B.7, including that
  an answer's `by` and audit `source` carry no `(local)`), proven only by PROVIDER's `fakeToolServer.js`. The SE provider path is exercised against that fake and nowhere else until someone deploys a server that speaks it.
- R3. UC9 and UC21 semantics (SKEPTIC FIX 2026-11-16: the first draft listed the group-gated tool to everyone and mapped a call-time 403 to "not offered",
  which says the opposite of what the hops hold). The tool server HIDES the group-gated tool from `tools/list` for a token without the tier group (so "not
  listed" is literally true) and still answers a `tools/call` for it with 403 `group_required` (the call-time refusal stays, lab policy). UC21 honours the
  list: not listed ends `REAL_NOT_LISTED` (NOT OFFERED, never a DENY), as the owner's 2026-11-16 UC21 semantics say, using the code path `real.js` already has
  for every unlisted tool. UC9 is the probe: it calls the tool even when it is not listed (`CALL_UNLISTED = new Set(['UC9'])` in `provider.js`) and shows the
  403 (DENY, lab policy). A member of the tier group gets PERMIT on both. No `group_required` 403 is ever mapped to `REAL_NOT_LISTED`.
- R4. UC2 and UC2.5 on the software vertical stay on the engine (A2A is banking-only, `A2A_VERTICAL`). `get_release_summary` is registered for later; no
  in-scope use case calls it today.
- R5. The local enforcer has three bands (deny, step-up, hold). The CIBA band (100 to 199 issues) is reserved and not enforced locally; no in-scope use case
  sends an amount in it.

## A. File ownership (no file has two owners)

Rule of thumb: LOCAL owns a process boundary (`server/src/local/**`). PROVIDER owns everything else under `server/` that is not a test of LOCAL. WEB owns the
page, the owner scripts, the e2e and the prose.

### A.1 Builder LOCAL

- `server/src/local/**` (new). Exact files, all ESM, Node 26, no dependency beyond `node:` built-ins:
  `main.js` (child entry), `server.js`, `verify.js`, `jwks.js`, `guard.js`, `mcp.js`, `registry.js`, `tools.js`, `policy.js`, `hitl.js`, `data.js`, `util.js`.
- `server/test/local-*.test.js` (new, top-level in `server/test/` because the runner glob is `test/*.test.js`) and `server/test/localFakeIdp.js`,
  `server/test/localKeys.js` (new test support).
- Isolation rule (pinned by `server/test/local-isolation.test.js`, LOCAL's own): files under `server/src/local/` import only `node:` modules and each other;
  never `../*.js`; no `process.env` read except `process.env.NODE_ENV`; no `console.` (fixed single-line `process.stderr.write` for fatal init errors only,
  never a value); no `eval`, `new Function`, `vm`, `worker_threads`, `child_process`, file writes; the words `CLIENT_SECRET` and `clientSecret` never appear.

### A.2 Builder PROVIDER

- Every other file under `server/src/` (not `server/src/vendor/**` and not the vendored `gatewayTrace.js`: never edited): `provider.js` (new),
  `localServices.js` (new), `real.js`, `realGate.js`, `mcpClient.js`, `settings.js`, `app.js`, `index.js`, `cast.js`, `flow.js`, `policy.js`, `situations.js`,
  `config.js`, `doctor.js`, `approval.js`, `netguard.js`, `gatewayExchanges.js`, `data.js` (the talk-track text and `HOSTED_BANNER` stay word for word),
  `health.js`, `safety.js`, `story.js`, `instructions.js` and the rest.
- `data/**`, `docker-compose.yml`, `Dockerfile`, `.env.example`, `scripts/compose.test.mjs`, `scripts/doctor.mjs`.
- Every server test that is not `server/test/local-*.test.js` / `localFakeIdp.js` / `localKeys.js`: `real.test.js`, `settings.test.js`, `entry.test.js`,
  `hosted.test.js`, `noMockWords.test.js`, `wordScan.js`, `fakePingone.js`, `fakeGateway.js`, `doctor.test.js`, `api.test.js`, `gateway-trace.test.js` and the
  rest; new `server/test/provider.test.js`, `server/test/localServices.test.js`, `server/test/fakeLocalChild.js`, `server/test/fakeToolServer.js`, `server/test/localParity.test.js`,
  `server/test/localE2E.test.js`.
- `data/usecases.json` is generated and is NOT edited.
- Generated or nobody's (SKEPTIC FIX, files that were owned by no one): `content-pack.json` and `docs/talk-track.md` are regenerated only by the coordinator at E.4 (`npm run content-pack`, `npm run talk-track`) and no builder edits them;
  `.github/**`, `.gitleaksignore`, `package.json`, `package-lock.json`, `server/package.json` and `web/package.json` are not edited by anyone (no dependency is added: the local services use `node:` built-ins only).

### A.3 Builder WEB

- `web/src/**` (not the vendored files: `JsonPane*`, `VerifyMark*`, `gateway-trace/**`, `styles/standalone-ui.css`, `src/vendor` equivalents; their `.sha256`
  pins stay green), all `web/` tests.
- `scripts/owner/**`, `scripts/e2e.mjs`, and every other file in `scripts/` except `compose.test.mjs` and `doctor.mjs` (so `owner-setup.test.mjs`,
  `repo.test.mjs`, `prompts.test.mjs`, `gen-manifest*.mjs`, `build*.mjs` are WEB's).
- `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `HANDOFF.md`, `docs/**` except this file (`docs/use-case-routing.md` is the owner's table and is NOT edited;
  `docs/talk-track.md` is regenerated by the integration step, section E.4).
- `deploy/**` is not edited by anyone (hosted manifests stay as they are).

Cross-builder dependencies are by CONTRACT only. A builder never imports a file another builder owns, except these two read-only imports:
PROVIDER's `localServices.js` forks `server/src/local/main.js` by path, and PROVIDER's `localParity.test.js` imports `server/src/local/registry.js` (the test
`skip`s itself while that file does not exist).

## B. The local services process

### B.1 Start, stop, IPC (PROVIDER side: `server/src/localServices.js`)

```js
export function createLocalServices({
  config,                 // { issuer, audience, allowedActors, tierGroup }  (no secret; section C.2 builds it)
  hosted = false,         // defence in depth: when true, start() returns { ok: false, reason: 'hosted' } and NEVER calls forkImpl (index.js also never builds the service when hosted)
  modulePath = new URL('./local/main.js', import.meta.url).pathname,
  forkImpl = child_process.fork,          // the ONLY use of node:child_process in server/src (entry.test.js pin, E.2)
  caCertsPath = undefined,                // the parent's NODE_EXTRA_CA_CERTS value, passed in by index.js (localServices.js reads no environment itself)
  now = Date.now, startTimeoutMs = 10_000,
}) -> {
  start(): Promise<{ ok: true, port: number } | { ok: false, reason: string }>,   // resolves on the child's `ready` message or on timeout
  stop(): Promise<void>,
  state(): 'off' | 'starting' | 'ready' | 'failed',
  mcpUrl(): string | null,        // `http://127.0.0.1:${port}/mcp`
  hitl(): { url: string, secret: string } | null,   // url = `http://127.0.0.1:${port}/hitl`; the secret never leaves the process
  toolNames(): string[],          // from the child's `ready` message
  healthUrl(): string | null,     // `http://127.0.0.1:${port}/health`
}
```

Fork call, exactly: `forkImpl(modulePath, [], { cwd: path.dirname(modulePath), env: { NODE_ENV: 'production', ...(caCertsPath ? { NODE_EXTRA_CA_CERTS: caCertsPath } : {}) }, execArgv: ['--max-old-space-size=96'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'json', windowsHide: true })`.
The child inherits NO environment variable except `NODE_ENV` and, only when the parent's own `NODE_EXTRA_CA_CERTS` is set, that one (SKEPTIC FIX: a path to extra
trusted CAs, not a secret; without it a machine behind a TLS-inspecting proxy, where the parent reaches PingOne, would get `jwks_unavailable` from the child with no
way to tell why). `index.js` passes `process.env.NODE_EXTRA_CA_CERTS` as `caCertsPath` (a string of at most 1024 characters, else undefined). The child receives NO secret in `env` or `argv`.
Parent-side validation of what the child says: `ready.port` must be an integer 1024 to 65535 and not in 7814 to 7839; `ready.tools` an array of at most 50
strings each matching `^[a-z0-9_]{1,64}$`; anything else is treated as `error` (`state()` `'failed'`). `mcpUrl()` and the other URLs are built only from the
validated port. Every `child.send` is wrapped in try/catch (a closed channel is a failure, never a throw into a request).

IPC messages (JSON, one object each):

Parent to child:
```json
{ "type": "init", "config": { "issuer": "https://auth.pingone.com/11111111-2222-4333-8444-555555555555/as", "audience": "appfire-work-tools", "allowedActors": ["88888888-9999-4aaa-8bbb-cccccccccccc"], "tierGroup": "Software_EnterpriseTier", "hitlSecret": "<64 hex chars, random per start, made by the parent>", "clockSkewSeconds": 60 } }
```
```json
{ "type": "shutdown" }
```
Child to parent:
```json
{ "type": "ready", "port": 41234, "pid": 99, "tools": ["get_my_issues", "bulk_update_issues"] }
```
```json
{ "type": "error", "code": "init_invalid" , "detail": "fixed text, never a value" }
```
`error.code` is one of `init_invalid`, `listen_failed`. After `error` the child exits with code 1.

Rules:
- The parent sends `init` once, right after fork. The child sends nothing before `init`, and ignores every other message type.
- `hitlSecret` is `crypto.randomBytes(32).toString('hex')` made by `localServices.js` per start. It crosses IPC only. It is held by the parent in
  `hitl()` and by the child in memory. It is never in a log, hop, API answer, trace or error (PROVIDER pin test, E.2).
- The child exits on `shutdown`, on the IPC `disconnect` event (parent died) and on SIGTERM/SIGINT. If no `init` arrives within 5 s it exits 1.
- `init` validation (`init_invalid` on any failure): `issuer` is an `https:` URL (`http:` only when the host is a loopback address) with no credentials, query or fragment,
  a path, and a host that is a DNS name or a loopback address (a non-loopback IP-literal issuer is refused: the guard can only allow names, B.5); `audience` string 1..300;
  `allowedActors` array of 1..5 non-empty strings of at most 200 chars; `tierGroup` string 1..120; `hitlSecret` exactly 64 lowercase hex chars; `clockSkewSeconds` integer 0..300.
  After `listen` the child checks `server.address().address === '127.0.0.1'` and exits 1 (`listen_failed`) otherwise.
- Fatal handlers (SKEPTIC FIX: a stack trace or a JSON parse message can quote a slice of the token or the request): `main.js` installs
  `process.on('uncaughtException')` and `process.on('unhandledRejection')` that write ONE fixed line (`appfire-tools-local: fatal error`, no message, no stack) with
  `process.stderr.write` and exit 1; `server.on('clientError')` answers a fixed 400 and writes nothing. Every `JSON.parse`, base64 decode and key import in `verify.js`,
  `jwks.js` and `server.js` is inside try/catch and turns into a fixed reason code, never a rethrown message.
- Supervision: an unexpected exit restarts the child up to 3 times inside 60 s with a 1 s, 2 s, 4 s backoff (a restart makes a new port and a new empty
  challenge store; the secret is re-made). After the third failure `state()` is `'failed'` and stays so until the process restarts.
- `index.js` handles SIGTERM and SIGINT by calling `local.stop()` before exit.
- Ports are ephemeral (`listen(0, '127.0.0.1')`): nothing in 7814-7839 is used, nothing is published.

### B.2 The child's HTTP surface (LOCAL)

One `node:http` server bound to `127.0.0.1` only. Every request, before any route:
1. `req.socket.remoteAddress` must be `127.0.0.1` or `::ffff:127.0.0.1`, else 403 `{"error":"remote_refused"}`.
2. `Host` must be `127.0.0.1:<port>` or `localhost:<port>`, else 403 `{"error":"host_refused"}`.
3. A request with an `Origin` header is refused 403 `{"error":"origin_refused"}` (a browser must never call this server).
4. Body at most 65536 bytes (413 `{"error":"too_large"}`), `Content-Type: application/json` on POST bodies (415 `{"error":"unsupported_media_type"}`),
   `server.requestTimeout = 10000`, `headersTimeout = 5000`, `maxHeaderSize = 16384`, at most 32 requests in flight (503 `{"error":"busy"}`).

Routes:

| Route | Auth | Purpose |
|---|---|---|
| `POST /mcp` | the JWT rules of B.4 | MCP Streamable HTTP: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. JSON answers only (never SSE). `GET /mcp` is 405 with `Allow: POST`; `DELETE /mcp` ends the session named by `Mcp-Session-Id` (204). |
| `POST /hitl/challenges`, `POST /hitl/challenges/:id/respond`, `POST /hitl/challenges/:id/verify`, `GET /hitl/challenges/:id` | header `x-hitl-internal-secret`, constant-time compare, else 401 `{"error":"unauthorized"}` | the approval service (B.7) |
| `GET /health` | none | `{"ok":true,"service":"appfire-tools-local","version":1,"issuer":"<configured issuer>","jwks":"unknown"|"ok"|"unavailable","tools":10}` (no secret, no port; `jwks` is the last fetch result, `unknown` until the first token is checked: the child never fetches keys on its own at start). Any other path: 404 `{"error":"not_found"}`. The `x-hitl-internal-secret` compare hashes both sides with SHA-256 first and uses `crypto.timingSafeEqual` on the digests (so a wrong length leaks nothing). |

### B.3 MCP protocol details

- `initialize`: result `{ "protocolVersion": <the client's if it is one of "2025-06-18","2025-03-26","2024-11-05", else "2025-06-18">, "capabilities": { "tools": { "listChanged": false } }, "serverInfo": { "name": "appfire-tools-local", "title": "Appfire Work Suite tool server (lab, local)", "version": "1" } }` and header `Mcp-Session-Id: <randomUUID>`. A session is bound to the token's `sub`
  (or `anon` with no token), lives 15 minutes idle, at most 200 sessions (the oldest idle one is dropped).
- `notifications/initialized`: 202, empty body.
- `ping`: result `{}`.
- Every other method after initialize needs `Mcp-Session-Id`. A missing or unknown id, or one bound to another `sub`, is 404 `{"error":"session_unknown"}`.
- `tools/list`: `{ "tools": [ <descriptor>, ... ] }` where a tool is listed when it is public, or when the validated token's scopes include the tool's scope AND,
  for a group-gated tool, the token's `groups` claim contains `config.tierGroup` (R3: a tool the tier does not get is not listed; a call to it is still refused, B.6 rule 4).
  No token lists the public tools only. Tool lookups everywhere use `Object.hasOwn(TOOL_META, name)` (a request may name `__proto__` or `constructor`). Descriptor: `{ name, description, inputSchema, annotations: { readOnlyHint, destructiveHint }, _meta: { requiredScope, labInvented: true } }`.
- `tools/call`: `params: { name, arguments }`. Success: HTTP 200, `{ "jsonrpc":"2.0", "id": n, "result": { "content": [ { "type": "text", "text": "<JSON.stringify(payload)>" } ], "structuredContent": <payload>, "isError": false } }`.
- RPC-level failures (valid token, nothing for policy to decide) are HTTP 200 JSON-RPC errors: unknown tool `-32602 "unknown tool"`, bad arguments `-32602 "invalid arguments: <fixed text naming the field>"`, unknown method `-32601`, bad JSON `-32700` (HTTP 400), batch array `-32600` (HTTP 400). `real.js` already reads these as a tool error.
- Policy-level refusals (401, 403, 428, 503) are NOT JSON-RPC wrapped. They are plain JSON with a top-level `error` string, the same shape SE's PingGateway answers (research: `p1az-decision.groovy` puts `error` as a string and `challengeId` beside it). Shape for every one of them:
  `{ "error": "<code>", "message": "<fixed sentence>", "reason": "<code or rule id>", "by": "tool server", ...extra }`. SKEPTIC FIX: `by` (and the audit `source` below)
  carry NO `(local)`: the same code may be the SE-hosted instance (R2), and a hop's raw JSON must not say "local" for an SE answer. Whether the lab says `(local)` or
  `(SE)` comes from the pick only (`answeredBy`, C.1); `mapAnswer` never reads `by` for wording, it is data.
- Response header `X-Gw-Audit-Trail` (JSON text, at most 2000 characters, latin1-safe) on every `tools/call` that got past token validation:
  `{"decision":"PERMIT","source":"lab-policy","rule":"lab-no-restriction","tool":"get_my_issues","trace":"<32-hex trace id from the request traceparent, or null>"}`.
  `decision` is one word from `PERMIT`, `DENY`, `HITL_REQUIRED`, `STEP_UP` (matches `parseAuditTrail`'s `^[A-Za-z_ -]{1,40}$`). `source` is always
  `lab-policy`. `rule` is one of the ids in B.6. No audit header on a 401 (a token problem is not a policy decision), and none on a
  `hitl_receipt_rejected` 403 (same as SE: its absence tells a receipt refusal from a policy DENY).
- 401 always carries `WWW-Authenticate`. With no token: `Bearer realm="appfire-tools-local"`. With a bad token: `Bearer realm="appfire-tools-local", error="invalid_token", error_description="<reason code>"`. A 403 `insufficient_scope` carries `Bearer realm="appfire-tools-local", error="insufficient_scope", scope="<required scope>"`.
- `traceparent` in the request is read only for the audit `trace` field (a valid W3C `00-<32hex>-<16hex>-<2hex>` or null).

### B.4 JWT validation: exact order and fixed reason codes (LOCAL: `verify.js`, `jwks.js`)

Input: the `Authorization` header (or none), the issuer config, `now()`. Output: `{ ok: true, claims, header, scopes: string[], groups: string[], actSub }` or
`{ ok: false, status, reason }`. Status is 401 unless noted. A token is ALWAYS validated when one is presented, even for a public tool.

Checks, in this order, first failure wins. `reason` is the code, also the `error_description`, also `body.reason`.

| # | Check | Reason | Status |
|---|---|---|---|
| 1 | no `Authorization` header, on a method or tool that needs one. Needs a token: `tools/call` of ANY name except a public tool (an unknown or non-own name such as `constructor` too: with no token the server never says whether a name exists); `initialize`, `ping`, `notifications/*` and `tools/list` do not (tokenless `tools/list` lists the public tools only) | `no_token` | 401 (no `error` attribute in WWW-Authenticate) |
| 2 | header is not `Bearer <token>` (scheme case-insensitive, exactly one space; a repeated or comma-joined `Authorization` header is `bad_scheme`) | `bad_scheme` | 401 |
| 3 | token longer than 8192 bytes | `token_too_large` | 401 |
| 4 | the token does not match `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$` with all three segments non-empty (so decoding leniency never matters); header or payload does not decode to a JSON object; signature segment empty | `malformed_token` | 401 |
| 5 | `header.alg` is not the string `RS256` or `ES256` (covers `none`, `HS256`/`HS384`/`HS512`, `PS*`, missing, non-string, wrong case) | `alg_not_allowed` | 401 |
| 6 | header carries any of `jku`, `x5u`, `jwk`, `x5c`, `crit` (the token must not pick or carry its own key) | `header_not_allowed` | 401 |
| 7 | no usable key id: `header.kid` is not a string of 1 to 128 chars AND neither `x5t` nor `x5t#S256` is a string of 1 to 128 chars | `kid_missing` | 401 |
| 8 | the key set cannot be had: discovery or JWKS fetch failed (network, non-200, redirect, over 64 KB, not JSON, discovery `issuer` is not the configured issuer, `jwks_uri` not on the issuer's origin) and no cached set younger than 1 hour exists | `jwks_unavailable` | 503 (body `error: "jwks_unavailable"`, header `Retry-After: 5`; NOT a token problem: the lab shows "no decision") |
| 9 | no key in the set matches `kid` (or `x5t`/`x5t#S256` when there is no kid), after at most one forced refresh per 30 s. A `kid` that appears on two keys in the set matches neither | `kid_unknown` | 401 |
| 10 | the matched key does not fit: `kty` must be `RSA` for RS256 (modulus at least 2048 and at most 8192 bits) or `EC` with `crv` `P-256` for ES256; `use` if present must be `sig`; `alg` if present must equal `header.alg`; `key_ops` if present must include `verify`; any exception while importing the JWK | `key_mismatch` | 401 |
| 11 | signature does not verify (`crypto.verify('sha256', ...)`; RS256 PKCS1 v1.5; ES256 with `dsaEncoding: 'ieee-p1363'`, and an ES256 signature that is not exactly 64 bytes fails here without calling verify); any exception while verifying | `signature_invalid` | 401 |
| 12 | `payload.iss` is not exactly the configured issuer (string equality, no normalisation) | `iss_mismatch` | 401 |
| 13 | `payload.aud` (string or array of strings) does not contain the configured audience | `aud_mismatch` | 401 |
| 14 | `exp` is not a finite number | `exp_missing` | 401 |
| 15 | `now > exp + skew` (skew 60 s) | `token_expired` | 401 |
| 16 | `nbf` present and `nbf > now + skew`, or `iat` present and `iat > now + skew` | `token_not_yet_valid` | 401 |
| 17 | `sub` is not a non-empty string | `sub_missing` | 401 |
| 18 | `act` is not an object with a non-empty string `sub` (an `act` that is a JSON string is parsed once, as PingOne sometimes serialises it; arrays, empty objects, blank `sub` are refused) | `act_missing` | 401 |
| 19 | `act.sub` is not in `allowedActors` | `act_sub_mismatch` | 401 |
| 20 | no usable scope claim. `scope` is read first: a space-separated string OR an array of strings (SKEPTIC FIX: PingOne's access-token `scope` shape is UNVERIFIED, so both are accepted); if `scope` is absent, `scp` (same two shapes) is read; the two are never merged. Neither present, or a value that is neither a string nor an array of strings | `scope_claim_missing` | 401 |

Only AFTER these pass does the server decide anything about the tool (B.6). Scope and group refusals are 403, not 401.
Time: `now()` is milliseconds (`Date.now`); every claim comparison uses `nowSeconds = Math.floor(now() / 1000)` and `skewSeconds` in seconds. `claims` is read only with
`Object.hasOwn`. The verifier returns `reason` only; no claim value, no token text and no exception message ever leaves `verify.js` in a body, header, log or error.

JWKS source (`jwks.js`): discovery URL is `issuer + '/.well-known/openid-configuration'` (OIDC standard; for PingOne
`https://auth.pingone.com/<env>/as/.well-known/openid-configuration`). The discovery document's `issuer` must equal the configured issuer exactly; its `jwks_uri` must be a string,
https (http only when the issuer host is a loopback address, for the tests), on the SAME origin as the issuer, with no credentials, query or fragment. Fetches: GET,
`accept: application/json`, `redirect: 'error'`, 5 s timeout, 64 KB cap (the cap is enforced while reading the body, not after). The discovery document is cached WITH the key
set (one entry: `{ jwksUri, keys, fetchedAt }`) and is re-read only when the key set is refreshed; the `jwks_uri` is never taken from anywhere else. The key set is cached 300 s; at most 20 keys are kept; only RSA and EC keys that
carry a `kid` or an `x5t` are kept; a forced refresh on an unknown `kid` happens at most once per 30 s (one shared limiter for all callers, so random `kid`s cannot cause more than one fetch pair per 30 s); if a refresh fails the cached set is used while it
is younger than 1 hour, else check 8 applies. Concurrent fetches share one promise. The `x5t` match is a string comparison with the key's own `x5t`
property (never computed from `x5c`). The token never influences a URL: there is no code path from any token field to `fetchImpl`.

The verifier takes everything by injection: `createVerifier({ issuer, audience, allowedActors, skewSeconds = 60, keySource, now = Date.now })` and
`createKeySource({ issuer, fetchImpl = globalThis.fetch, now = Date.now, ttlMs = 300_000, minRefreshMs = 30_000, maxStaleMs = 3_600_000 })`.

### B.5 The child's own netguard (LOCAL: `guard.js`)

`installGuard({ allowHosts: string[] })` is called FIRST in `main.js`, before the server or any fetch, with the issuer host when it is not a loopback address (else
`[]`). It replaces `globalThis.fetch`, `net.Socket.prototype.connect`, `dns.lookup`, `dns.promises.lookup` and `dgram.Socket.prototype.send` so that only a loopback
address or an EXACT allowed DNS name passes; an IP literal that is not loopback, a wildcard, a pattern and any other name are refused and recorded in
`guard.attempts` (a list of `fetch:<host>`, `socket:<host>`, `dns:<host>`). The `dns.resolve*` family and `Resolver` are loopback-only. `allowHost` accepts a plain
DNS name only (never an IP literal), exactly as the parent's `netguard.js` does. The module copies the idea, not the file (the isolation rule forbids importing it).
`guard.attempts` keeps at most the last 200 entries (a bounded list; the parent netguard's is unbounded but only loopback-reachable inputs can grow the child's). A
non-loopback IP-literal issuer cannot work (the guard allows names only), which is why `init` refuses it (B.1). The one allowed name is the ISSUER host; the
discovery `jwks_uri` is required to be on that same origin (B.4), so nothing a token or a discovery document says can widen the allow-list.

### B.6 The tool registry and the lab policy (LOCAL: `registry.js`, `tools.js`, `policy.js`, `data.js`)

`registry.js` exports (PROVIDER duplicates the tool list, the scopes, the public set and the group-gated set, and a parity test compares them; `TOOL_META` is read with `Object.hasOwn` only):

```js
export const TOOL_META = {
  get_my_issues:                { scope: 'issues:read',   role: 'read',      public: false, group: false },
  bulk_update_issues:           { scope: 'issues:write',  role: 'write',     public: false, group: false },
  get_project_security_settings:{ scope: 'security:read', role: 'sensitive', public: false, group: true  },
  get_release_summary:          { scope: 'release:read',  role: 'a2a',       public: false, group: false },
  list_marketplace_apps:        { scope: null,            role: 'public',    public: true,  group: false },
  get_deployment_status:        { scope: 'deploy:read',   role: 'status',    public: false, group: false },
  request_admin_access:         { scope: 'admin:request', role: 'request',   public: false, group: false },
  scan_repository:              { scope: 'security:read', role: 'scan',      public: false, group: false },
  brave_news_search:            { scope: 'issues:read',   role: 'search',    public: false, group: false },
  code_search:                  { scope: 'issues:read',   role: 'search',    public: false, group: false },
};
export const SCOPES = ['issues:read', 'issues:write', 'security:read', 'release:read', 'deploy:read', 'admin:request'];  // the six scopes of the PingOne resource "Appfire Work Suite Tools"
export const BANDS = [ { min: 2000, decision: 'DENY', rule: 'lab-band-deny' }, { min: 500, decision: 'STEP_UP', rule: 'lab-band-step-up' }, { min: 200, decision: 'HITL_REQUIRED', rule: 'lab-band-hold' } ];
export const SCANNER_REPOS = ['platform', 'billing', 'mobile'];
export const BLOCKED_TERMS = ['bitcoin', 'crypto'];
```
(`BANDS`: `policy.js` `BANDS.money` has a 4th band `{ min: 100, decision: 'CIBA' }` that the local enforcer does not enforce: R5.)

Descriptors and strict argument schemas (`additionalProperties: false` on all; every tool also accepts the control field `_hitl_challenge_id`, a string matching `^[A-Za-z0-9-]{1,128}$`, stripped before dispatch):

| Tool | Arguments (type, limits, default) | Result payload (every payload ends with `"lab_invented": true` as its LAST key, so `replyText`'s first six plain fields are the data's own) |
|---|---|---|
| `get_my_issues` | `limit` integer 1..20, default 5 | `{ signed_in_sub, total: 8, returned, issues: [ { key, summary, status, priority } ] }`, first `returned` of the fixed list below |
| `bulk_update_issues` | `project` string `^[A-Z]{2,10}$` (required), `issue_count` integer 1..100000 (required), `field` enum `status`,`assignee`,`labels`,`priority` (default `status`), `value` string 1..80 (default `Done`) | `{ project, field, value, issue_count, status: "applied", change_id: "CHG-<6 hex>", note: "Applied to synthetic lab data only." }` |
| `get_project_security_settings` | `project` string `^[A-Z]{2,10}$`, default `PLAT` | `{ project, visibility: "private", two_step_verification: "required", ip_allowlist: ["203.0.113.0/24"], permission_scheme: "Standard", audit_log_retention_days: 365, secrets_scanning: "enabled" }` |
| `get_release_summary` | `project` default `PLAT`, `release` string 1..40 default `2026.11.2` | `{ project, release, status: "on track", issues_done: 41, issues_open: 6, risks: ["Audit log export latency"], target_date: "2026-11-30" }` |
| `list_marketplace_apps` | `limit` integer 1..10, default 5 | `{ total: 5, apps: [ { name, vendor: "Example Vendor", category, installs } ] }` from `Sprint Pulse` (Reporting, 1200), `Release Radar` (Automation, 980), `Bulk Mover` (Automation, 860), `Audit Trail Plus` (Compliance, 410), `Epic Roadmap` (Planning, 2300) |
| `get_deployment_status` | `environment` enum `staging`,`production`, default `production` | `{ environment, service: "platform-api", version: "2026.11.2", status: "healthy", last_deploy: "2026-11-15T14:02:00Z", commit: "a1b2c3d" }` |
| `request_admin_access` | `role` enum `project-admin`,`site-admin` (required), `project` string `^[A-Z]{2,10}$` default `PLAT`, `reason` string 1..200 (required) | `{ request_id: "REQ-<6 hex>", status: "pending", role, project, requested_by: <token sub>, note: "A request only. Nothing was granted: this tool server has no tool that grants access." }` |
| `scan_repository` | `repo` string 1..60 `^[A-Za-z0-9._-]+$` (required) | `{ repo, findings: [ { id: "SCAN-1", severity: "medium", title: "Outdated dependency (example)" } ], summary: { critical: 0, high: 0, medium: 1, low: 2 }, scanned_at: <clock ISO> }` |
| `brave_news_search` | `query` string 1..200 (required) | `{ query, results: [ { title, url: "https://news.example/<slug>", snippet } ] }` three fixed results whose titles contain `(example)` |
| `code_search` | `query` string 1..200 (required) | `{ query, matches: [ { repo: "platform", path: "src/limiter.js", line: 42, text: "// example match" } ] }` |

Fixed issue list for `get_my_issues` (key, summary, status, priority): `PLAT-412` Rate limiter returns 500 on burst, In Progress, High; `PLAT-418` Upgrade build image to Node 26, To Do, Medium; `PLAT-421` Audit log export times out, In Review, High; `BILL-77` Invoice rounding on partial refunds, To Do, Medium; `BILL-80` Add tax id to checkout form, In Progress, Low; `MOB-203` Crash on rotate in release list, To Do, High; `MOB-205` Dark theme contrast on badges, In Review, Low; `PLAT-430` Document the deploy checklist, Done, Low. All people and hosts are synthetic (`.example`, TEST-NET). The same list is returned for every signed-in user (the data is lab-invented and says so; `signed_in_sub` echoes the token's `sub`).

Decision order for `tools/call` (after the B.4 checks pass), first match wins. Every refusal names its rule id:

1. Unknown tool name (not an own key of `TOOL_META`): JSON-RPC `-32602 "unknown tool"` (HTTP 200). (With NO token an unknown name is 401 `no_token`, B.4 row 1, so this row is reached only with a valid token.)
2. The tool needs a scope and the token's scope set lacks it: 403 `insufficient_scope`, rule `lab-scope`, audit `DENY`.
3. Argument validation fails: JSON-RPC `-32602` (HTTP 200).
4. Group gate (`group: true`): the token's `groups` claim (array of strings, or one string) lacks `config.tierGroup`: 403 `group_required`, rule `lab-group-gate`, audit `DENY`, extra `{ "required_group": "<tierGroup>" }`. This applies whether or not the tool was listed to the caller (the list hides it, the call still refuses).
5. Edge rules: `scan_repository` with `repo` (case-insensitive) not in `SCANNER_REPOS`: 403 `repo_not_allowed`, rule `lab-repo-allowlist`, message `the code scanner is configured for the platform, billing and mobile repositories only`. `brave_news_search` with a `query` containing a blocked term (case-insensitive substring): 403 `blocked_term`, rule `lab-blocked-term`, message `the query contains a blocked term` (the term is never echoed).
6. Bands, only for `bulk_update_issues` on `issue_count`: `>= 2000` 403 `access_denied`, rule `lab-band-deny`, audit `DENY`. `>= 500`: 428 `step_up_required`, rule `lab-band-step-up`, audit `STEP_UP`, no challenge (not dischargeable here). `>= 200`: if the arguments carry `_hitl_challenge_id`, verify it (B.7): valid means continue, invalid means 403 `hitl_receipt_rejected`; with no receipt, mint a challenge (B.7) and answer 428 `approval_required`, rule `lab-band-hold`, audit `HITL_REQUIRED`. Below 200 the receipt, if any, is ignored and not consumed.
7. Otherwise run the tool: 200, audit `PERMIT`, rule `lab-no-restriction`.

Bodies:
```json
{ "error": "step_up_required", "message": "This write needs a stronger authentication (a second factor). The lab policy stops it here.", "reason": "lab-band-step-up", "by": "tool server" }
```
```json
{ "error": "approval_required", "message": "This write needs a person to approve it.", "reason": "lab-band-hold", "by": "tool server", "challengeId": "6f1c9a52-0b7e-4d0e-9f1e-7c3f5a2d8b10", "expiresAt": "2026-11-16T20:30:00.000Z", "tool": "bulk_update_issues" }
```
```json
{ "error": "group_required", "message": "The tier group is missing from the token's groups claim.", "reason": "lab-group-gate", "by": "tool server", "required_group": "Software_EnterpriseTier" }
```
```json
{ "error": "hitl_receipt_rejected", "message": "The approval receipt was refused.", "reason": "receipt_pending", "by": "tool server" }
```
`message` strings are fixed per code (LOCAL picks the words; they never contain a token, a claim value, a secret or the request's text). Every string LOCAL emits
(messages, descriptions, payload text, tool titles) must pass the page's banned-word rule `/mock|simulat|offline|\bengine\b|scripted/i`: `local-policy.test.js` scans every
response body, header and descriptor it produces with that regex. `argsDigest` is computed over the RAW `arguments` object as received, minus `_hitl_challenge_id`, BEFORE defaults
are filled and before validation (so the retry, which sends the same raw arguments plus the receipt, matches).
Receipt reasons: `receipt_unknown`, `receipt_pending`, `receipt_denied`, `receipt_expired`, `receipt_binding_mismatch`, `receipt_used`.

Per-run sanity: the lab's own amounts for the in-scope write use cases are UC6 2500 (DENY), UC7 600 (STEP_UP), UC8 300 (HITL_REQUIRED); the default amount is 25 (PERMIT).

### B.7 The approval (HITL) service (LOCAL: `hitl.js`, routes in `server.js`)

In-memory store, at most 200 challenges (a decided or expired one is evicted first; if all 200 are pending a new one is 503 `{"error":"capacity"}`), TTL 300 s,
checked lazily. A challenge: `{ id: randomUUID(), status: 'pending'|'approved'|'denied'|'expired'|'consumed', sub, tool, argsDigest, amount, createdAt, expiresAt, respondedBy }`.
`argsDigest = sha256 hex of the key-sorted (recursive) JSON.stringify of the arguments WITHOUT _hitl_challenge_id`; `hitl.js` exports `argsDigest(args)`.
The enforcer creates a challenge in-process on a hold (binding: the token's `sub`, the tool, `argsDigest`); the REST routes expose the same functions.
All four routes need `x-hitl-internal-secret`.

| Route | Body | Answer |
|---|---|---|
| `POST /hitl/challenges` | `{ "sub": str, "tool": str, "argsDigest": 64 hex, "amount": number|null }` | 201 `{ "id", "status": "pending", "expiresAt", "ttlSeconds": 300 }` |
| `POST /hitl/challenges/:id/respond` | `{ "decision": "approved"|"denied", "respondedBy": str (1..80) }` | 200 `{ "id", "status": "approved"|"denied", "decision": same, "respondedAt" }`. Pending to decided once. Second answer 409 `{"error":"already_answered","status"}`. Expired 410 `{"error":"expired"}`. Unknown or malformed id 404 `{"error":"unknown_challenge"}`. (`approval.js` already reads `body.status` / `body.decision`.) |
| `POST /hitl/challenges/:id/verify` | `{ "sub", "tool", "argsDigest" }` | always 200 `{ "valid": true, "id", "consumed": true }` or `{ "valid": false, "reason": "<receipt reason>" }`. A valid verify consumes the challenge (single use, status `consumed`). A failed verify (`receipt_pending`, `receipt_denied`, `receipt_expired`, `receipt_binding_mismatch`, `receipt_unknown`) leaves it untouched; a second use says `receipt_used`. |
| `GET /hitl/challenges/:id` | none | 200 `{ "id", "status", "tool", "amount", "createdAt", "expiresAt" }` (no `sub`, no digest). 404 as above. |

The receipt IS the challenge id (as on SE: the lab echoes the challenge id as `_hitl_challenge_id`; it is bound to `sub`, tool and arguments, so another user or another call cannot spend it).

### B.8 Which use cases run on which tools (the 19 that become real on the software vertical)

| Use case | Tool | Arguments the lab sends | Outcome on a normal run |
|---|---|---|---|
| UC1, UC3, UC4, UC17, UC19, UC20 | `get_my_issues` | `{ "limit": 5 }` | PERMIT |
| UC33 | `get_deployment_status` | `{ "environment": "production" }` | PERMIT |
| UC24 | `list_marketplace_apps` (tokenless), then `get_my_issues` tokenless as the probe | `{ "limit": 5 }`, `{ "limit": 1 }` | PERMIT (first call 200, second call 401 `no_token`) |
| UC28 | `request_admin_access` | `{ "role": "project-admin", "project": "PLAT", "reason": "Lab request: approve the release" }` | PERMIT (pending request) |
| UC6 | `bulk_update_issues` | `issue_count` 2500 | DENY (403 `access_denied`) |
| UC7 | `bulk_update_issues` | `issue_count` 600 | held for step-up (428 `step_up_required`) |
| UC8 | `bulk_update_issues` | `issue_count` 300 | held for approval (428 `approval_required`), then PERMIT after the phone and the retry with the receipt |
| UC9 | `get_project_security_settings` | `{ "project": "PLAT" }` | for a user not in the tier group: the tool is not listed, the lab calls it anyway (`CALL_UNLISTED`, R3) and the answer is DENY 403 `group_required`; PERMIT for a member |
| UC21 | `get_project_security_settings` | `{ "project": "PLAT" }` | PERMIT for a member of the tier group; for one who is not, the tool is not listed and the run ends `REAL_NOT_LISTED` (NOT OFFERED) without calling it (R3) |
| UC30 | `scan_repository` | `{ "repo": "platform" }` | PERMIT |
| UC31 | `scan_repository` | `{ "repo": "payroll" }` | DENY 403 `repo_not_allowed` |
| UC41 | `brave_news_search` | `{ "query": "Jira workflow automation best practices" }` | PERMIT |
| UC42 | `brave_news_search` | `{ "query": "crypto-mining script in our build" }` | DENY 403 `blocked_term` |
| UC-TOOL1 | `code_search` | `{ "query": "status" }` | PERMIT |

The `bulk_update_issues` arguments are `{ "project": "PLAT", "issue_count": <amount>, "field": "status", "value": "Done" }`; the default `<amount>` is 25 (PERMIT) when `situations.js` gives none.
`toolArgs` for the local tools is exactly: `get_my_issues` `{ limit: 5 }`; `get_deployment_status` `{ environment: 'production' }`; `get_project_security_settings` `{ project: 'PLAT' }`;
`get_release_summary` `{}`; `list_marketplace_apps` `{ limit: 5 }`; `request_admin_access` the fixed object in the table; `scan_repository` `{ repo: <situationOf(uc.id, vertical).args.repo, else 'platform'> }`
(the software override gives UC30 `platform` and UC31 `payroll`); `brave_news_search` and `code_search` `{ query: <situation args.query, else 'status'> }` (the existing rule; UC42's staged
query holds the blocked term); every value is a string the situation or this table fixed, never visitor text (`said` is not a tool argument). For every other tool not in this table the gate keeps the use case on the engine with its existing reason.

The use cases that stay on the engine and why do not change: UC5, UC11, UC12, UC13, UC14, UC14b, UC18, UC27 (attack probes and the receipt probe), UC22 (CIBA, later), UC2, UC2.5, UC2.6, UC2.7, UC37 (A2A, banking only), UC10, UC34, UC35, UC48, UC25, UC38, UC39, UC40, UC44, UC45, every guided page.

## C. Provider selection, settings, exchange, gate, mapping, labels (PROVIDER)

### C.1 `server/src/provider.js`

```js
export const PROVIDER_SETTINGS = ['auto', 'se', 'local'];
export const providerSettingOf = (raw) => /* '' or undefined -> 'auto'; lower-cased 'auto'|'se'|'local'; anything else -> null (config problem) */;

// Tool names the local tool server serves, with the scope each needs (a copy of local/registry.js TOOL_META; localParity.test.js pins equality).
export const LOCAL_TOOLS = new Set([ 'get_my_issues', 'bulk_update_issues', 'get_project_security_settings', 'get_release_summary', 'list_marketplace_apps', 'get_deployment_status', 'request_admin_access', 'scan_repository', 'brave_news_search', 'code_search' ]);
export const TOOL_SCOPES = { get_my_issues: 'issues:read', bulk_update_issues: 'issues:write', get_project_security_settings: 'security:read', get_release_summary: 'release:read', list_marketplace_apps: null, get_deployment_status: 'deploy:read', request_admin_access: 'admin:request', scan_repository: 'security:read', brave_news_search: 'issues:read', code_search: 'issues:read' };
export const PUBLIC_TOOLS = new Set(['list_marketplace_apps']);
export const GROUP_GATED_TOOLS = new Set(['get_project_security_settings']);   // hidden from tools/list without the tier group (B.3); localParity.test.js pins it equal to registry.js
export const CALL_UNLISTED = new Set(['UC9']);                                 // use cases that call a tool even when tools/list does not offer it (R3)

export function createProviders({ setting = 'auto', real, local = null, toolsSe = null, hosted = false, fetchImpl, now = Date.now, probeTtlMs = 30_000, probeTimeoutMs = 3_000 }) -> {
  setting: 'auto'|'se'|'local',
  snapshot(): { setting, gateway: boolean, tools: { se: boolean, local: boolean } },          // sync, no network: what realGate and /api/usecases use
  choose({ capability: 'gateway'|'tools' }): Promise<Pick | null>,                            // async, may probe SE; called exactly ONCE per run (app.js)
  info(): { setting, hosted, gateway: boolean, toolsSe: boolean, local: { state, tools: number } },   // for /api/info; no URL, no port, no secret
}
// Pick (frozen): the whole per-run choice; real.run never calls choose again.
// { provider: 'se'|'local', capability: 'gateway'|'tools', url, audience, scope, why, answeredBy, label }   (exactly these eight keys; section H agrees)
//   gateway/se : url = AAG_AGENT_GATEWAY_URL, audience = AAG_GATEWAY_AUDIENCE, scope = AAG_GATEWAY_SCOPE
//   tools/se   : url = AAG_TOOLS_SE_URL,      audience = AAG_TOOLS_AUDIENCE,   scope = null (per tool: TOOL_SCOPES)
//   tools/local: url = local.mcpUrl(),        audience = AAG_TOOLS_AUDIENCE,   scope = null (per tool: TOOL_SCOPES)
//   why: 'forced' | 'auto-se-ok' | 'auto-se-probe-failed' | 'auto-se-not-configured' | 'only-option'
//   answeredBy: 'Agent Gateway (SE)' | 'tool server (SE)' | 'tool server (local)'
//   label:      'Agent Gateway [SE]' | 'Tool server [SE]' | 'Tool server [local]'
```

Selection rules, exact:
- `hosted`: `choose` returns `null`, `snapshot()` is all false, `info().local.state` is `'hosted'`. Nothing is forked, nothing probed.
- Module rules (SKEPTIC FIX, pins): `provider.js` reads no environment variable, imports nothing from `real.js`, `realGate.js` or `app.js` (it receives `real` by injection; `realGate.js` imports ITS constants), builds no regular expression from input, and never names a client secret.
- Capability `gateway` (banking, healthcare, retail): only SE exists. `setting='local'` returns `null`. Otherwise it returns the SE pick whenever the gateway
  settings are complete (`why: 'only-option'`, or `'forced'` when `setting='se'`), WITHOUT consulting the probe (there is no alternative to switch to, and a
  wrong probe path must not turn Real off).
- Capability `tools` (software): SE is "usable" when `AAG_TOOLS_SE_URL` is set and valid AND the probe passes; local is "usable" when `local.state() === 'ready'`.
  `setting='se'`: the SE pick, or `null` if `AAG_TOOLS_SE_URL` is unset (no probe consulted: a forced provider is used as is). `setting='local'`: the local pick, or `null`
  if not ready. `setting='auto'`: SE if usable, else local if ready, else `null`. `why` is `'auto-se-ok'`, `'auto-se-probe-failed'` (SE configured, probe failed, local used),
  `'auto-se-not-configured'` (no SE URL, local used) or `'forced'`.
- The probe (changed in the 2026-11-16 review fix): an unauthenticated MCP `initialize` POSTed to the SE tool server's OWN MCP url (not `<origin>/health`: a shared ingress may have no `/health` route or answer it for another service), with only `accept` and `content-type`, `redirect: 'manual'`, 3 s timeout, no body read beyond a cancel. Pass = HTTP 200 or 401 (it answered; 401 means it wants a token). The result is cached 30 s per MCP url and concurrent probes share one promise. A probe never sends a token or any lab header. (UNVERIFIED against the real SE tool server: owner step in section G.)
- Before the pick (and before the gate) a run waits up to 5 s for a local tool server that is `starting` (a restart after a crash), and a `failed` one is asked to try again once its 30 s cool-down has passed (`providers.prepare()`, `localServices.ready()`); the gate's reason names the state ("restarting", "stopped ... tried again on a later run"). Nothing is forked by the provider module.
- `app.js` calls `choose` once per live run BEFORE `real.run` and passes the pick in. A pick is never replaced during that run, even when the provider fails.
  A failure of the picked provider is an honest "no decision" (`REAL_UNREACHABLE`); the lab never tries the other provider in the same run.

### C.2 New settings (exact names; `settings.js`, `docker-compose.yml`, `.env.example`, `scripts/compose.test.mjs`)

| Name | Required | Default | Meaning | Validation (a problem is a fixed sentence naming the setting, never a value) |
|---|---|---|---|---|
| `AAG_PROVIDER` | no | `auto` | `auto`, `se` or `local` | else `the app .env has no valid AAG_PROVIDER (auto, se or local)` |
| `AAG_TOOLS_AUDIENCE` | no | `appfire-work-tools` | the audience of the tools resource (also what the local verifier requires) | plain string 1..300 |
| `AAG_TOOLS_TIER_GROUP` | no | `Software_EnterpriseTier` | the PingOne group that means the premium tier (UC9, UC21), sent to the local server at init | plain string 1..120 |
| `AAG_TOOLS_SE_URL` | no | unset | the MCP endpoint of an SE-hosted tool server (R2) | `https:` (`http:` only on a loopback host), no credentials, query or fragment (same rules as `gatewayUrlProblem`, with this name in the message) |

Changed names: `AAG_AGENT_GATEWAY_URL`, `AAG_GATEWAY_AUDIENCE`, `AAG_GATEWAY_SCOPE` leave `FULL_KEYS` and become `GATEWAY_KEYS` (optional as a group).

`settings.js` after the change:
```js
export const FULL_KEYS = ['AAG_USER_CLIENT_ID', 'AAG_USER_CLIENT_SECRET', 'AAG_AGENT_CLIENT_ID', 'AAG_AGENT_CLIENT_SECRET', 'AAG_DEMO_USERNAME'];
export const GATEWAY_KEYS = ['AAG_AGENT_GATEWAY_URL', 'AAG_GATEWAY_AUDIENCE', 'AAG_GATEWAY_SCOPE'];
export const FULL_REQUIRED = ['PINGONE_ENVIRONMENT_ID', ...FULL_KEYS];
export const PROVIDER_KEYS = ['AAG_PROVIDER', 'AAG_TOOLS_AUDIENCE', 'AAG_TOOLS_TIER_GROUP', 'AAG_TOOLS_SE_URL'];
export const OPTIONAL_KEYS = ['AAG_AGENT_SCOPE', 'AAG_AGENT_TOKEN_AUTH', 'AAG_HITL_SERVICE_URL', 'AAG_HITL_INTERNAL_SECRET', ...GATEWAY_KEYS, ...PROVIDER_KEYS, ...A2A_KEYS];
export const REAL_KEYS = [...LIVE_KEYS, ...FULL_KEYS, ...OPTIONAL_KEYS];
export const fullWanted = (s) => [...FULL_KEYS, ...GATEWAY_KEYS].some((k) => !unset(s, k));   // any AAG_* app or gateway name holds a real value
```
`realConfig` returns `gateway: { url, audience, scope } | null` and `gatewayProblem` (a partial trio: `the app .env sets some of AAG_AGENT_GATEWAY_URL, AAG_GATEWAY_AUDIENCE, AAG_GATEWAY_SCOPE but not <names>`; an invalid value: the existing sentences), plus `provider`, `toolsAudience`, `toolsTierGroup`, `toolsSeUrl | null`, `hitlUrl | null`. Real is `configured()` with the five app names
and `PINGONE_ENVIRONMENT_ID` alone. A gateway problem does not make `configured()` false; it only makes the `gateway` capability unavailable (banking, healthcare and retail then run on the engine with the reason `the SE gateway is not set up here (AAG_AGENT_GATEWAY_URL, AAG_GATEWAY_AUDIENCE, AAG_GATEWAY_SCOPE)`).
`real.hosts()` returns the PingOne auth host plus, when present, the gateway host, the tools SE host and the HITL host (non-IP DNS names only; `index.js` allows them in the netguard). `real.origins()` likewise.
SKEPTIC FIX (netguard widening): `AAG_HITL_SERVICE_URL` is validated with `urlProblem(raw, 'AAG_HITL_SERVICE_URL')` (https, loopback http only, no credentials, query or fragment) in `realConfig`
BEFORE its host reaches `hosts()`; an invalid value gives `hitlUrl: null` and a `hitlProblem` sentence naming the setting, and its host is never allowed. The same holds for `AAG_TOOLS_SE_URL`
(an invalid value is `toolsSeUrl: null` + `toolsSeProblem`, `tools.se` false). Only a validated value can add a host to the guard.
Where `AAG_PROVIDER` and the other four new names are read (SKEPTIC FIX, ambiguity): like every other `REAL_KEYS` name: from the app's `.env` on a host run and from compose substitution in Docker;
a shell `AAG_PROVIDER=local npm start` on a host run is NOT read (the README says so: put it in `.env`).
`notConfiguredText(missing, problem)` (safety.js, PROVIDER) keeps its exact current sentence; `missing` is now `missingFull(settings)` = the names of `FULL_REQUIRED` that are unset, in the order
`PINGONE_ENVIRONMENT_ID, AAG_USER_CLIENT_ID, AAG_USER_CLIENT_SECRET, AAG_AGENT_CLIENT_ID, AAG_AGENT_CLIENT_SECRET, AAG_DEMO_USERNAME`, and `NEEDS_PINGONE_NOTE` is appended after the existing last
sentence. WEB's `scripts/e2e.mjs` line that matches `^Real is not configured: fill ... AAG_GATEWAY_SCOPE in this app's .env` is rewritten to end at `AAG_DEMO_USERNAME` (D.8).
`real.localConfig()` returns `{ issuer: `${base}/as`, audience: toolsAudience, allowedActors: [agent client id], tierGroup }` (no secret).

Where each is listed (all four builders-of-pins agree):
- `settings.js`: `PROVIDER_KEYS`, `GATEWAY_KEYS`, `OPTIONAL_KEYS`, `REAL_KEYS` as above (so `takeLiveSettingsFromEnv` deletes them from `process.env` like the rest).
- `docker-compose.yml`: four new `${NAME:-}` lines (`AAG_PROVIDER`, `AAG_TOOLS_AUDIENCE`, `AAG_TOOLS_TIER_GROUP`, `AAG_TOOLS_SE_URL`). NO new `ports`, no `volumes`, no `env_file`, no `tmpfs`. Comments updated.
- `.env.example`: the three gateway names move under "Optional: the SE Agent Gateway (banking, healthcare, retail)"; a new block for the four names, all commented out with placeholders.
- `scripts/compose.test.mjs`: `COMPOSE_ENV.substituted` gets the four names; the three gateway names stay in the list (still substituted). The test that asserts `Object.keys(env).filter(/SECRET|...|GATEWAY|AUDIENCE|SCOPE|HITL/)` equals `REAL_KEYS` must compare against `REAL_KEYS.filter` by the same regex (`AAG_PROVIDER`, `AAG_TOOLS_SE_URL`, `AAG_TOOLS_TIER_GROUP` do not match the regex). New pins: exactly one published port; no `volumes:`; the Dockerfile still copies `server/src` (so `server/src/local/` ships); `read_only: true` stays.

### C.3 Exchange 2 for the `tools` capability

Exchange 1 is unchanged (user token + agent actor, agent scope). Exchange 2 for `pick.capability === 'tools'`:
`POST {base}/as/token` with the agent client's auth, form `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token=<exchange-1 token>`, `subject_token_type=urn:ietf:params:oauth:token-type:access_token`, `scope=<TOOL_SCOPES[tool]>`. EXACTLY ONE scope, from the one tools resource (PingOne refuses scopes from two
resources in a request). NO `audience`, NO `actor_token`. The tools resource owns the audience (`appfire-work-tools`) and passes `act` through (its `act`
attribute) and adds `groups`. `config.scope` (AAG_GATEWAY_SCOPE) is not used for this capability. The hop is `kind: 'token-exchange'`, `shortTitle: 'Exchange 2: for the tools'`, label `Token exchange 2: for the tools (RFC 8693 at PingOne, the exchange-1 token as subject, no actor, the one scope this tool needs: <scope>)`.
The audience note compares the token's `aud` with `AAG_TOOLS_AUDIENCE` (not the gateway audience). For a group-gated tool the hop note adds `groups claim: <the array>` or `groups claim: ABSENT (check the tools resource's groups attribute)`. A token with no `act` ends `REAL_NO_ACT` before the tool server, as today.
UC24 (`situationOf(uc.id, vertical).public === true` and capability `tools`) runs NO agent token and NO exchange: its hops are sign-in, `gateway-check` (tokenless), `tool-dispatched` (tokenless public call), `tool-refused` (the tokenless protected probe, verdict `deny`), `agent-reply`.

### C.4 `mcpClient.js` changes

- `createGatewaySession({ url, token, ... })`: `token` may be `null`: `gatewayHeaders` then omits `authorization` AND `x-token-validation` and still returns `assertNoTrusted(h)`. `SENT_HEADERS` and `TRUSTED_HEADERS` are NOT changed (a pin test proves both lists byte for byte, plus one new test that a tokenless header set contains no `authorization`).
- `GATEWAY_URL` validation is `urlProblem(raw, name)` (the existing function generalised; `gatewayUrlProblem` stays as `urlProblem(raw, 'AAG_AGENT_GATEWAY_URL')`).
- `shown` response headers also include `retry-after` (shown, never acted on).
- `classify` is unchanged. Each call result gets `provider` (`'se'|'local'`) from the session options.
- Hold reader (the 428 fix), exported as `holdInfo(c)`:
  `err = c.rpc?.error`. `code` = `err` when it is a string; else `err?.data?.error`; else `err?.error`; else `err?.message`; else `c.rpc?.error_code`; each only when a string. `challengeId` = the first of `err?.data?.challengeId`, `err?.challengeId`, `c.rpc?.challengeId`, `c.rpc?.data?.challengeId` that matches `^[A-Za-z0-9-]{1,128}$`. `stepUp = code === 'step_up_required'`. Returns `{ code, challengeId, stepUp }`. `c.body` (a key `send()` never sets) is no longer read.
  SKEPTIC FIX (a leak the first draft would have shipped): `gatewayExchanges.js` `realExchange` builds its scrub list (`secrets`) from `holdInfo(c).challengeId` (every path above), plus `c.rpc?.challengeId` and
  `c.rpc?.error?.challengeId` as today, so the challenge id is scrubbed from a trace wherever the provider put it. (The hop's own `rawText` of a 428 still shows the body as it came, as it does for SE today;
  the receipt and the HITL secret never appear in either.)

### C.5 `mapAnswer(c, ctx)` (real.js)

`mapAnswer(c, { provider = 'se', capability = 'gateway' } = {})`. `who` is `Tool server` when `capability === 'tools'`, else as today. Wording stays free of the forbidden words.
VOCABULARY RULE (SKEPTIC FIX: the existing `mapAnswer` strings say "the gateway", "Authorize" and "the Agent Gateway" in every branch, including `unreachable`, `default` and the 428 bodies, which would
present a local refusal as a gateway or PingOne Authorize decision): for `capability: 'tools'` EVERY string `mapAnswer`, `gatewayLeg` and `real.run` produce (hop notes, labels, titles, replies,
approval head and body) names the tool server (`Tool server (local)` / `Tool server (SE)`) and contains neither `Agent Gateway`, `gateway`, nor the word `Authorize` EXCEPT inside the exact phrase `not PingOne Authorize`.
The rows below give the exact sentences for the branches that differ; for any branch not written out, build it from the SE sentence by replacing the subject with the tool server and deleting every clause
that names a gateway, Authorize or the HITL service of SE (the approval sentence uses `the lab's own approval service`). `real.test.js` walks every string of every tools-capability run
(all outcomes in the E.2 matrix) against `/Agent Gateway|gateway|Authorize/` with `not PingOne Authorize` removed first, and fails on a hit.

| Input | Outcome | Hop note (start) | Reply |
|---|---|---|---|
| 403, SE gateway, body code `hitl_receipt_rejected` | `REAL_RECEIPT_REJECTED` | `The gateway answered 403: it refused the approval receipt (hitl_receipt_rejected), which is not a policy decision.` | `who: 'Gateway'` |
| 403, SE gateway, body code `hitl_service_unavailable` (also if 503) | `REAL_UNREACHABLE` | `no decision: the gateway could not reach the HITL service` | `who: 'Gateway'` |
| 403, SE gateway, any other | `REAL_DENY` | unchanged | unchanged (`who: 'Authorize'`) |
| 403, `capability: 'tools'`, code `hitl_receipt_rejected` | `REAL_RECEIPT_REJECTED` | `The tool server answered 403: it refused the approval receipt (<reason>).` | `who: 'Tool server'` |
| 403, `capability: 'tools'`, any other code | `REAL_DENY` | `The tool server answered 403: refused by lab policy (local), not PingOne Authorize: <rule or code>.` (`(local)` becomes `(SE)` for an SE pick) | `The tool server refused this request (HTTP 403, <code>) under the lab's own policy (<local|SE>), not PingOne Authorize. Nothing was run.` |
| 401, SE gateway | `REAL_TOKEN_PROBLEM` | unchanged | `who: 'Gateway'`, unchanged |
| 401, `capability: 'tools'` | `REAL_TOKEN_PROBLEM` | `The tool server (<local|SE>) answered 401: it did not accept the delegated token (<error_description>).` For `token_expired`, `token_not_yet_valid` add ` This machine's clock may differ from PingOne's by more than 60 seconds.` For `aud_mismatch` add ` The token's aud must be AAG_TOOLS_AUDIENCE.` | `who: 'Tool server'`, `The tool server did not accept the delegated token (HTTP 401, <error_description>). Nothing was run.` |
| 428 with `holdInfo.stepUp`, SE gateway | `REAL_HOLD`, NO `challengeId` | unchanged | `approval.head: 'Held for step-up'`, unchanged body |
| 428 with `holdInfo.stepUp`, `tools` | `REAL_HOLD`, NO `challengeId` | `The tool server (<local\|SE>) answered 428: this write needs a stronger authentication, which the lab cannot complete, so the call is not retried.` | `who: 'Tool server'`, `approval.head: 'Held for step-up'`, `approval.body: 'The tool server answered 428: this call needs step-up authentication under its lab policy (<local\|SE>), not PingOne Authorize. This lab cannot complete a step-up, so nothing was run.'` |
| 428 otherwise, SE gateway | `REAL_HOLD`, `challengeId` from `holdInfo` (absent when none) | unchanged (`challenge minted` or `not minted`) | `approval.head: 'Held for approval'`, unchanged |
| 428 otherwise, `tools` | `REAL_HOLD`, `challengeId` from `holdInfo` (absent when none) | `The tool server (<local\|SE>) answered 428: a person must approve (challenge minted or not minted). Approve on the phone and the lab retries with the receipt.` | `who: 'Tool server'`, `approval.head: 'Held for approval'`, `approval.body: 'The tool server answered 428: this call needs a person to approve it under its lab policy (<local\|SE>), not PingOne Authorize. Approve (or deny) on the phone: the answer is recorded with the lab's own approval service and the call is retried with the receipt.'` |
| 503 with body `error: 'jwks_unavailable'`, `tools` | `REAL_UNREACHABLE` | `The tool server could not get your PingOne's signing keys (jwks_unavailable), so it made no decision.` | `who: 'Tool server'`, `No decision: the tool server could not get your PingOne's signing keys. Check that its network reaches PingOne (and NODE_EXTRA_CA_CERTS if a proxy inspects TLS). Nothing was run.` |
| `unreachable` (no response, 5xx, other 503), `tools` | `REAL_UNREACHABLE` | `The tool server (<local\|SE>) <what>. The lab does not retry.` (`<what>` as today) | `who: 'Tool server'`, `No decision: the tool server <what>.` |
| 429 | `REAL_REFUSED` | `The ... answered HTTP 429 (a rate limit).` | unchanged shape |
| the rest, `tools` | `REAL_REFUSED` | `The tool server (<local\|SE>) answered HTTP <status>.` | `who: 'Tool server'`, `The tool server answered HTTP <status>; the agent stopped there.` |
| the rest, SE gateway | unchanged | unchanged | unchanged |

`REAL_NOT_FOUND`-style new outcome names are not added except `REAL_RECEIPT_REJECTED` (a use case's retry with a refused receipt) and `REAL_NOT_REFUSED` (UC24 only: the tokenless protected probe was NOT answered 401; the hop verdict is `error` and the note says `NOT refused: the protected tool answered without a token`).
A `capability: 'tools'` 403 with code `group_required` is an ordinary `REAL_DENY` (UC9's DENY, lab policy); it is NEVER mapped to `REAL_NOT_LISTED` (R3, SKEPTIC FIX).
NOT LISTED, `capability: 'tools'` (the existing `!listed.includes(tool)` branch in `gatewayLeg`, now provider-aware): UC9 (`CALL_UNLISTED`) does not stop; its `gateway-check` note adds `${tool} is not among them; this use case calls it anyway` and the call goes on to the 403. Every other
use case stops with `REAL_NOT_LISTED` and `rest(0, 'Not run: the tool server does not list <tool> to this token.')`. For UC21 the reply is `{ who: 'Tool server', text: "The tool server did not offer <tool> to this user, so the agent never called it. Lab policy (<local|SE>), not PingOne Authorize: the tool is offered only to the tier group <tierGroup>, and this delegated token's groups claim <does not include it | is ABSENT (check the groups attribute of the tools resource in PingOne)>. Add the user to that group in PingOne, sign out, sign in again and run it again." }`; for any other use case `The tool server does not list the tool <tool> for this token (it holds the scope <TOOL_SCOPES[tool]> only), so the agent did not call it.` The hop verdict for the not-called steps is `skip` as today.

### C.6 `realGate(uc, cast, opts)` (realGate.js, cast.js)

- `cast.js`: `castMockOnly` is REMOVED (from the software pack and from `OPTIONAL_CAST_KEYS`); replaced by `castToolServer: 'work-suite'` (software only; add it to `OPTIONAL_CAST_KEYS`). `server/test/wordScan.js` `RAW_KEYS` and its test follow.
- Signature: `realGate(uc, cast, { a2a = false, a2aWhy = null, tools = { se: false, local: false }, gateway = false, setting = 'auto' } = {})`; the return adds `capability`: `{ real: true, tool, capability: 'gateway'|'tools' }` (A2A keeps `{ real: true, tool, a2a: true, capability: 'gateway' }`). `capability = Object.hasOwn(cast, 'castToolServer') ? 'tools' : 'gateway'`.
- Unchanged, in the same order: guided page; the hitl-track rule (only UC7 and UC8); the approval-chain rule (CIBA, hitl-receipt: UC22, UC27, UC48 stay engine); `TRUSTED_FEATURE` (UC13, UC18); TraT; A2A (banking only); Privilege lanes; personal agent; `sim-` chains (UC5, UC11, UC12, UC14b, UC15...); no tool.
- Changed: the flag rule becomes `if (uc.flag && !(capability === 'tools' && LOCAL_FLAG_OK.has(uc.flag)))` with `LOCAL_FLAG_OK = new Set(['ff_authorize_group_policy'])` (UC9 only: that flag is about AI-DEMO2's policy, and the lab's own tool server enforces the group rule itself). Every other flag (`ciba_enabled`, `ff_rar`, `ff_dpop`, `ff_enterprise_managed_mcp_auth`, `ff_verified_trust_a2a`, `ff_personal_agent_concierge`) still keeps the use case on the engine.
- Tool resolution: capability `tools` needs `LOCAL_TOOLS.has(tool)` else `its tool <tool> is not served by the lab's tool server`; capability `gateway` keeps `SE_MCP_TOOLS`.
- Availability, fixed reasons: `tools`: `setting='se'` needs `tools.se` else `AAG_PROVIDER=se is set and AAG_TOOLS_SE_URL is not`; `setting='local'` needs `tools.local` else `AAG_PROVIDER=local is set and the lab's tool server is not running here`; `auto` needs `tools.se || tools.local` else `the lab's tool server is not running here and AAG_TOOLS_SE_URL is not set`. `gateway`: `setting='local'` gives `AAG_PROVIDER=local is set and the local tool server serves the software vertical only`; otherwise `gateway` must be true, else `the SE gateway is not set up here (AAG_AGENT_GATEWAY_URL, AAG_GATEWAY_AUDIENCE, AAG_GATEWAY_SCOPE)`.
- `app.js` passes `providers.snapshot()` (`tools`, `gateway`, `setting`) plus `a2aOpts(v)` into every `realGate` call (the catalog `view` and the run). After the gate says real it calls `pick = await providers.choose({ capability })`; a `null` pick runs the engine with `reason: 'no provider is available for this run'` (it should not happen when the gate and the pick agree; a test pins that they agree for all four provider states).
- `toolArgs(tool, ctx)` gets the table in B.8 (bulk, issues, security, release, marketplace, deployment, admin, scan, search); the `get_weather` rule stays for the other packs.
- The first-line reply of a tool leg for `capability: 'tools'` uses `replyText(tool, result, { provider })`, which appends ` (lab-invented data from the lab's own tool server)` when the payload has `lab_invented: true`.

### C.7 `real.run` and the hops (real.js)

`run(uc, { vertical, tool, traceparent, session, receipt = null, a2a = false, pick = null })`: `pick = null` means the SE gateway exactly as today (existing tests keep passing; they gain `provider: 'se'`).
- The run object gains `provider` (`'se'|'local'`), `providerWhy`, and `real.provider`. An engine run has none of these.
- Every hop the provider answered carries `provider` (`'se'|'local'`) and `answeredBy` (the exact string from the pick): `gateway-check`, `authorize-decision`, `tool-dispatched`, `tool-held`, `tool-refused`, `api-call`, and the not-run hops that follow them. `source` stays `'real'` or `'not-run'`; `provider` is independent of `source`. Hops that PingOne answered (sign-in, agent token, exchanges) carry no `provider`.
- Labels, exact templates (`L` = `pick.label`):
  - `gateway-check`: `${L}: initialize and tools/list over MCP with the delegated token` (tokenless run: `... without a token`).
  - `authorize-decision`, SE gateway: unchanged text. For `capability: 'tools'`: label `Lab policy (<local|SE>) decision: <OUTCOME>, read from the tool server's answer to tools/call (not PingOne Authorize)`; `decision: { outcome, by: 'lab policy (<local|SE>), not PingOne Authorize' }`.
    SKEPTIC FIX (the first draft kept `to: 'authorize'`): the vendored lane table (`web/src/evidence/lanes.js`) draws `authorize` as the lane "Authorize: The policy decision point", and the vendored hop catalog titles this kind `Authorize` with the fact
    `policy decided`; a local refusal drawn there reads as PingOne Authorize whatever the label says. So for `capability: 'tools'` the hop keeps `kind: 'authorize-decision'` (captions, decision card and hop order depend on the kind) but is
    `from: 'gateway', to: 'gateway'` (the vendored `isNote` rule draws `from === to` as a note on the Gateway lane, which for a tools run is the tool server's own enforcement: no Authorize lane appears in a tools run), its `title` is overridden by
    `shortTitle: 'Lab policy (<local|SE>)'` (the existing `shortTitle` mechanism, applied after `enrichHop`) and, when `verdict === 'ok'`, its `fact` is overridden to `lab policy decided`. The same `shortTitle` rule titles the other tools-run hops:
    `gateway-check` `Tool server (<local|SE>): token and tool list`, `tool-dispatched` / `tool-held` / `tool-refused` `Tool server (<local|SE>)`, `api-call` `Tool data`. The not-run versions (`finishNotRun`, `rest`, the NEEDS_ACCOUNTS branch) use the
    same lanes, titles and the label `Lab policy decision` (never `Authorize decision`) for a tools run.
  - tool hops, SE gateway: unchanged. `tools`: `${L}: tools/call ${tool}`; the dispatched note is `The tool server ran the tool. The data is lab-invented.`
  - `api-call` for `tools`: not-run, note `Not run: this tool serves lab-invented data itself; no API sits behind it.`
- The delegated token's `iss` is not checked by the lab (the tool server checks it). The lab does decode `act`, `aud`, `scope` and `groups` for the hop notes as today.
- Decisions: `observed` when read from the response or the audit trail header; `inferred` when read from the status alone. Never `checked`.
- THE GATEWAY TRACE PANEL (SKEPTIC FIX, honesty): `server/src/gatewayTrace.js` and `GatewayTrace.jsx` are vendored and never edited, and they hard-code "What Privilege did", "the Privilege gateway", `the gateway answered, which it does only after
  authenticating the caller` and `the caller's grant does not allow this app or tool` for a 403: for a tool server's local refusal that text attributes the lab's own rule to a gateway and its grant. So a `capability: 'tools'` run builds NO gateway trace:
  `run.gatewayTrace` is `[]` (the existing `gatewayTrace?.length > 0` guard in `RunPanel.jsx` then draws nothing, no WEB change), and `realExchange` is never called for a tools call. The per-call detail of a tools run is the `calls` list of its hops (the step
  detail's `ExchangeList`), whose `Answered by` and `Decided by` facts say who decided. `gateway-trace.test.js` gains: a tools run has `gatewayTrace: []`; an SE run is byte-identical to today. (Upstream follow-up for the owner, G: a `leadNote` prop on the shared panel.)
- A trace (SE runs) never holds the token, the full session id, the challenge id (every `holdInfo` path, C.4) or the receipt (unchanged), and now also never the HITL secret.
- UC24 (tokenless, `capability: 'tools'`) hop kinds and lanes: `sign-in` (as today), `gateway-check` (`agent` to `gateway`, tokenless `initialize` and `tools/list`), `tool-dispatched` (`gateway` to `mcp`, the tokenless PUBLIC `tools/call`, verdict `ok`), `tool-refused` (`gateway` to `mcp`, the tokenless protected probe, verdict `deny` when 401 `no_token`, else `error` with `REAL_NOT_REFUSED`), `agent-reply`. No `authorize-decision` hop and no token or exchange hops are emitted (UC24's own text says the public path skips them). The run outcome is `REAL_PERMIT` when the public call was 200 and the probe was 401.
- `run.challenge` (REAL_HOLD with a minted challenge) is returned as today, plus `run.provider` so the page can tell `/api/approval/start` which service minted it.

### C.8 Approvals and the HITL host (approval.js, app.js, index.js)

- FINDING F1 (read in `app.js:107` and `settings.js`): `createApprovals` is built from `env.AAG_HITL_SERVICE_URL`/`env.AAG_HITL_INTERNAL_SECRET`, but `takeLiveSettingsFromEnv` deletes both from `process.env` at startup and the host run never copies them in, so the SE HITL URL is always `''` and `decide` always answers `the HITL service is not configured`. PROVIDER fixes it: both come from `liveSettingsFor(process.env)`.
- `createApprovals({ hitl: (provider) => ({ url, secret } | null), fetchImpl })` replaces `hitlUrl`/`hitlSecret`. `'se'` resolves from the settings above, `'local'` from `localServices.hitl()`. A session stores its `provider` (default `'se'`). `POST /api/approval/start` accepts an optional `provider: 'se'|'local'` (a fixed enum, else 400 `bad_provider`); the page sends `run.provider`.
- `decide` for `'local'` posts to `${hitl.url}/challenges/<id>/respond` with `x-hitl-internal-secret`, body `{ decision, respondedBy: 'appfire-agent-governance-lab phone' }`, 15 s timeout, `redirect: 'error'`, and reads `status`/`decision` as today. A non-2xx or a failure is `expired` with a fixed error text (fail closed), never the secret.
- Netguard: `real.hosts()` includes the HITL host so the SE HITL call is no longer blocked (it threw "network blocked" before). Loopback (the local service) needs nothing.

### C.9 Honest wording constants (PROVIDER defines, WEB reads from the API where the page shows them)

- `NEEDS_PINGONE_NOTE = 'Real sign-in and token exchange need a PingOne environment (PINGONE_ENVIRONMENT_ID and the AAG_* apps). PingFederate is not wired into this lab yet.'` Added to the not-configured text (`notConfiguredText`) and to `/api/info.real.note`. A user with no PingOne settings gets exactly this, plus the existing names list.
- A gate reason for a use case on the engine is data in `realGate.reason`; none may contain `mock`, `simulat`, `offline`, `engine`, `scripted` (the existing `noMockWords` walk covers `realGate.reason`).

### C.10 Hooks for the later CIBA wave (nothing built now)

The provider interface already leaves room: `Pick` carries `capability`; `choose({ capability })` accepts any string key and returns `null` for an unknown one; `localServices.js` forwards unknown `ready.tools` names; `hitl()` is per-provider, so a future `capability: 'ciba'` pick and a `ciba.js` client plug in without changing `choose` or the hop fields. `APPROVAL` in `realGate.js` keeps `ciba-poll` and `ciba-authorize` on the engine and UC22 stays gated by `ciba_enabled`. Do not add CIBA settings, routes or hops now.

### C.11 `/api/info` additions (data, no values)

`provider: { setting: 'auto'|'se'|'local', hosted: boolean, gateway: boolean, toolsSe: boolean, local: { state: 'off'|'starting'|'ready'|'failed'|'hosted', tools: number } }` and `real.note` (C.9). No URL, port, secret or token. Hosted: `provider: { setting: 'auto', hosted: true, gateway: false, toolsSe: false, local: { state: 'hosted', tools: 0 } }`.

### C.12 `index.js` and the doctor

- After the existing `allowHosts` loop (so the guard and the settings check come first): `const local = !hosted && fullOn && providerSetting !== 'se' ? createLocalServices({ config: real.localConfig(), hosted, caCertsPath: process.env.NODE_EXTRA_CA_CERTS }) : null; if (local) await local.start();` A failed start prints one line (`local tool server did not start`) and the lab continues (`snapshot().tools.local` is false). The lab never refuses to start because of the child. `createApp({ ..., local })` builds the providers itself from `real`, `local`, the setting and `toolsSe`.
- `doctor.js`: a `provider` check (`pass` with the setting name; `fail` for an invalid `AAG_PROVIDER`, naming the setting only), and the missing-names list for Real now lists only `FULL_REQUIRED` (the gateway trio is reported as an `info` line `SE gateway: not set (banking, healthcare and retail stay on the lab's own steps)` or `set`).

## D. Web (WEB)

All strings are fixed words from the server's data. The page never invents a provider name.

1. Step detail key facts (`web/src/components/HttpMessage.jsx` `factsOf`): when `hop.answeredBy` is a string, push `{ kind: 'info', label: 'Answered by', value: hop.answeredBy }` FIRST in the list (values: `tool server (local)`, `tool server (SE)`, `Agent Gateway (SE)`). When `hop.decision?.by` is a string, push `{ kind: 'info', label: 'Decided by', value: hop.decision.by }` right after the `decision` fact. No chip anywhere; no new tag component. `ExchangeList` (the per-call card view) shows the same `Answered by` line above its first card. `HopList`/hop title already carry the label with `[local]`/`[SE]`.
2. Sequence lanes and the vendored hop catalog are not edited. For a tools run the server sends the `authorize-decision` hop as `from: 'gateway', to: 'gateway'` (a note on the Gateway lane) with the title `Lab policy (local)` (C.7), so no Authorize lane
   or actor card appears in a tools run; no web change beyond reading it. The vendored `GatewayTrace` panel is not drawn for a tools run because the server sends `gatewayTrace: []` (C.7); WEB adds a test that a tools run's Run result shows no "What Privilege did" heading.
   Presenter captions (`captions.js`) are keyed by hop kind and say "the policy engine" without naming a product; WEB adds a `tools` variant only if a caption names Authorize, Privilege or the gateway as the decider for a tools run (today none names Authorize, so the generic text stays).
3. Chat reply labels: `reply.who` may now be `Tool server`; `chat.js` `replyOf` and `decision.js` map it to the label `Tool server` (the same pill style as `Gateway`). New outcomes: `REAL_RECEIPT_REJECTED` reads as DENIED with the reason `The approval receipt was refused`; `REAL_NOT_REFUSED` reads as a finding: `The protected tool answered without a token`. `REAL_NOT_LISTED` is unchanged (NOT OFFERED); for a tools run its reply carries `who: 'Tool server'` and `lab policy (<local|SE>), not PingOne Authorize` in its own words (C.5).
4. REMOVE: every visible sentence that says or implies the software vertical, or any use case, "runs on the lab's own steps because the gateway has no software tools" or that "no use case runs the live chain". Find them with: `grep -rn -i "live chain\|no use case runs\|does not run the live\|serves no\|gateway does not serve\|Banking vertical\|Banking first\|MOCK_ONLY" web/src README.md docs scripts` (the walkthrough/Demo guide text in `web/src/demoGuide.js` and `server/src/data.js` `TALK_TRACK` entry `real` are the likely places; the `real` entry is PROVIDER's file: PROVIDER rewrites its first sentence to `When you sign in with PingOne, “Delegated access” and the other use cases the lab can serve run the actual chain — the agent's own token, two RFC 8693 exchanges at PingOne, then the SE Agent Gateway or the lab's own tool server, and the tool itself.` keeping the rest word for word; WEB regenerates `docs/talk-track.md` at integration). `web/src/lib.js` `MOCK_ONLY_VERTICALS` is renamed `OWN_TOOL_VERTICALS` (same value `["software"]`; its comment and the `App.jsx` use follow). The software vertical's Real notes (`live-persona-note`, no persona, no lab inputs) follow automatically from `realGate.real` for the 19 use cases and stay as they are for the rest.
5. Phone (`MockPhone.jsx`, `App.jsx`): `POST /api/approval/start` sends `provider: run.provider` when the run has one.
6. `scripts/owner/**`: `pingone-real-setup.mjs` must not require or fail on missing gateway names (a missing gateway section prints `SE gateway: not configured (skipped)`); it never creates or edits the tools resource (the owner's session did that). Add `docs/owner-tools-resource.md`: the resource "Appfire Work Suite Tools", audience `appfire-work-tools`, the six scopes, the `act` (subject-token pass-through) and `groups` (memberOfGroupNames) attributes, the group `Software_EnterpriseTier`, the agent app's six grants, RS256/ES256 access tokens with a `kid` in the issuer's JWKS, and the exchange-2 rule (one resource per request). `docs/` text is fixed prose, no tenant value.
7. Prose to update (facts from this file): `CLAUDE.md` (replace the "software ... Engine-only in practice" and `realGate` paragraphs, add the provider and local-services paragraph, the new settings, the honesty rule for local refusals, the new test files), `README.md` (Real section: software runs Real on the lab's own tool server; `AAG_PROVIDER`; standalone on another machine; what the owner must set up), `CHANGELOG.md` (one dated entry), `HANDOFF.md` (what is unverified: section G).
8. `scripts/e2e.mjs`: the word scan and every existing check stay; the software vertical's UC1 now runs Real on the full instance (the old check "a use case the gateway does not serve keeps its persona and inputs (software)" is replaced by one on a software use case that is not in the 19, e.g. UC10); the "Real needs the Banking vertical" step is deleted (software is picked by default); the check at the `^Real is not configured: fill ...` line (about `e2e.mjs:263`) is rewritten to end at `AAG_DEMO_USERNAME` (the gateway trio is no longer required, C.2); new checks listed in E.3. The e2e imports `fullSettingsFor`, `startFakePingOne` and the new `state.tools.groups` from PROVIDER's `fakePingone.js`; PROVIDER keeps every existing export and its signature, and `fullSettingsFor(gatewayUrl = null, extra = {})` omits the three gateway names when `gatewayUrl` is null (so the e2e can run a full instance with the local provider only). The e2e instance spawns `server/src/index.js`, which forks the child; the e2e fake PingOne is PROVIDER's updated `fakePingone.js` (ES256 JWKS). The e2e cannot pass until PROVIDER's and LOCAL's work are merged (integration, E.4).

## E. Test plan

Runners: `npm test -w server` (`node --test test/*.test.js`), `npm test -w web`, `node --test scripts/*.test.mjs`, `npm run build`, `npm run e2e`. Two docker-live tests bind 7820/7821 and fail locally while OrbStack holds those ports: they are ignored and reported as such. Every new test file lists real counts in the builder's report.

### E.1 LOCAL

Key material: `server/test/localKeys.js` holds public-on-purpose TEST keys as JWK objects (RSA 2048 `RSA_A`, a second RSA `RSA_B`, a 1024-bit `RSA_WEAK`, an EC P-256 `EC_A` built from a fixed scalar with `createECDH` + `createPrivateKey` like `mockjwt.js`). The RSA JWKs are generated ONCE by a scratch script outside the repository (`generateKeyPair*` must not appear anywhere in the repo: `entry.test.js` bans it) and pasted as JWK JSON (not PEM).
SKEPTIC FIX (secret scanners): the repo runs gitleaks in CI AND in a pre-commit hook, and its own convention is that credential-shaped test values are assembled at run time ("no such string sits in the repository", `server/test/secrets.js`).
So `localKeys.js` stores each private JWK member (`d`, `p`, `q`, `dp`, `dq`, `qi`) as an array of 8 to 12 chunks joined at load (`chunks.join('')`), names its constants `RSA_A_JWK` etc. (never `key`, `secret`, `token`, `password` in a name or a property),
holds NO compact JWT literal (every token is minted at run time by `localFakeIdp.js`), and the task is not done until the commit of these files passes `gitleaks detect --redact` if the binary is available, else the builder says it could not run it. `localFakeIdp.js`:
`startFakeIdp({ behaviour = 'ok' }) -> { issuer, base, jwksUri, mint(claims, { alg, kid, key, header, omit }) -> compact token, setBehaviour(b), seen, close() }` serving `GET /<env>/as/.well-known/openid-configuration` (`issuer` = `http://127.0.0.1:<port>/<env>/as`, `jwks_uri` on the same origin) and `GET /<env>/as/jwks` (`{ keys: [ public RSA_A with kid 'k-rsa-a', public EC_A with kid 'k-ec-a' ] }`); behaviours `ok`, `jwks-500`, `jwks-html`, `jwks-huge`, `jwks-redirect`, `jwks-slow`, `discovery-500`, `discovery-wrong-issuer`, `jwks-other-origin`, `rotated` (serves RSA_B as `k-rsa-b` only). `defaultClaims({ sub, act: { sub: ACTOR }, aud: 'appfire-work-tools', scope, groups })` with `iss` = the fake's issuer, `exp` +900 s.

Files and cases (`server/test/local-*.test.js`):
- `local-jwt.test.js` (verifier unit, injected clock): the valid RS256 and ES256 tokens pass; then one hostile case per row of B.4 with the exact `reason`/`status`: alg `none` (empty signature and also a bare 2-segment token), HS256 signed with the PUBLIC key's text as the secret (RS256 key confusion), HS256 with a random secret, `alg` `RS384`, `PS256`, lowercase `rs256`, no `alg`; headers with `jku`, `x5u`, `jwk`, `x5c`, `crit`; wrong `aud` (string and array), `aud` missing; wrong `iss` (exact-string, trailing slash, other host); expired (`exp` = now-61 s fails, now-59 s passes: skew); `exp` missing and non-numeric; `nbf` = now+61 s fails, now+59 s passes; `iat` in the future; `sub` missing; `act` missing, `act` empty object, `act` array, `act.sub` blank, `act` as a JSON string that parses (accepted), `act.sub` not in the allow-list; signed by another key with the right `kid` (`signature_invalid`); `kid` unknown (one forced refresh, then `kid_unknown`; a second unknown kid within 30 s does NOT refetch); `kid` missing and no `x5t` (`kid_missing`), `x5t` matching a JWKS key (accepted); a key whose `kty` or `alg`/`use`/`key_ops` do not fit (`key_mismatch`), RSA_WEAK (`key_mismatch`); tampered payload (`signature_invalid`); tampered header; oversized token (8193 bytes) `token_too_large`; `Bearer` with two spaces, `Basic ...`, lowercase `bearer` (accepted); malformed segment counts; signature not base64url; `scope` as a string, as an array, `scp` only, both present (`scope` wins, no merge), neither, and a number (`scope_claim_missing`); duplicate `kid` in the set (`kid_unknown`); an ES256 signature of 63 and 65 bytes; an RSA key of 1024 and of 8200 bits (`key_mismatch`); a 2-part token and a token with a space inside (`malformed_token`); a token that makes `JSON.parse` throw never puts a slice of itself in any returned value (assert the whole returned object contains no 8-char substring of the token). JWKS failures: 500, HTML, huge, redirect (never followed), slow (5 s timeout), `discovery-wrong-issuer`, `jwks-other-origin` all give `jwks_unavailable` / 503 when no cache, and use the cache for up to 1 hour when there is one; a successful rotation after `kid_unknown` works.
- `local-mcp.test.js` (HTTP, real `startLocalServer` on a loopback port with the fake IdP): initialize/session flow; `tools/list` per scope (token with only `issues:read` lists `get_my_issues`, `brave_news_search`, `code_search`, `list_marketplace_apps`; tokenless lists only `list_marketplace_apps`); every tool's strict schema (extra key refused, wrong type refused, defaults applied); the group-gated tool is listed to a token whose `groups` holds the tier group (array and single-string forms) and NOT listed to one without it or with no `groups` claim, while `tools/call` of it by the latter is 403 `group_required` (R3); `tools/call` of `constructor`, `__proto__` and `toString` is `-32602` with a token and 401 `no_token` without one; notifications 202; batch 400; GET 405; host/origin/remote refusals; 413 and 415; session bound to the sub (a token for another sub gets 404); 32-in-flight cap; the 401 `WWW-Authenticate` shapes (`no_token` has no `error=`); no token on a protected tool 401; a bad token on a public tool 401.
- `local-policy.test.js`: every row of B.6 and B.8: bands at 199 (PERMIT), 200 (428 hold), 499, 500 (428 step-up), 1999, 2000 (403), the hold then `respond` then retry with the receipt PERMIT then a second use `receipt_used`; receipt for another sub, another tool, other arguments (`receipt_binding_mismatch`), pending, denied, expired (injected clock), unknown; a receipt on a call below 200 is ignored and not consumed; group gate with `groups` as array, as a single string, missing, wrong group (`group_required`, 403, `required_group`); `scope` missing on the token for the tool (`insufficient_scope` 403 with `WWW-Authenticate scope=`); repo allow-list (case-insensitive); blocked terms (case-insensitive, never echoed); the audit header shape on every outcome (parses with the same rule as `parseAuditTrail`, at most 2000 chars, `source` `lab-policy`); no audit header on 401 and on `hitl_receipt_rejected`; no secret, token or claim value in any body; `get_my_issues` fixed list; `request_admin_access` has no grant tool in `tools/list` (no name starting `grant_`).
- `local-hitl.test.js`: secret required on all four routes (constant-time compare, wrong length, missing); create/respond/verify/get state machine; 409 second respond; 410 expired; capacity 503; ids are UUIDs; `verify` consumes; failed verify does not; argsDigest is key-order independent and ignores `_hitl_challenge_id`.
- `local-guard.test.js`: `installGuard({ allowHosts: [] })` records and refuses `fetch`, socket, dns lookup, `dns.resolve4` and UDP to a non-loopback name, to an IP literal, to `0.0.0.0` as a target; `allowHost('auth.pingone.com')` allows exactly that name and not `evil.auth.pingone.com`, not an IP; zero attempts across a full valid flow against the loopback fake IdP.
- `local-process.test.js`: forks the REAL `server/src/local/main.js` (with `process.execPath`), sends `init`, waits for `ready`, makes a real MCP call with a fake-IdP token, sends `shutdown` and sees exit 0; `init` with a missing or invalid field gives `error: init_invalid` and exit 1; the child, started with a sentinel variable set in the test's own environment and `process.execPath`'s default fork options, sees only `NODE_ENV` (the test starts the child through a tiny wrapper that reports `Object.keys(process.env)` over IPC and asserts it is `['NODE_ENV']`, plus `['NODE_ENV','NODE_EXTRA_CA_CERTS']` when a CA path is passed); an uncaught exception in the child prints only the fixed fatal line (no message, no stack) and exits 1; the static pin in `local-isolation.test.js` proves the child code reads no other variable; the IPC `disconnect` makes the child exit; the port is not in 7814 to 7839.
- `local-isolation.test.js`: static pins of A.1 (imports, env, console, eval, writes, worker, child process, the forbidden words), and that `registry.js` exports exactly the names in B.6 and `TOOL_META` has exactly 10 tools.

### E.2 PROVIDER

- `provider.test.js`: `providerSettingOf`; the full matrix of `choose` for `gateway` and `tools` x `setting` x (SE configured or not, probe pass or fail, local ready or not) with the exact `why`; hosted gives `null` and forks nothing; the choice is made once: a run whose picked provider fails does NOT call `choose` again (spy count 1) and ends `REAL_UNREACHABLE`; the probe sends only `accept`, caches 30 s, shares concurrent calls, treats a redirect as a failure; `snapshot()` never touches the network.
- `localServices.test.js` with `fakeLocalChild.js` (a script that speaks the IPC protocol of B.1): start resolves on `ready`, times out to `failed` on silence, `error` message gives `failed`, restart/backoff with an injected `forkImpl` and clock (3 restarts then `failed`), `stop` sends `shutdown`, the fork options are exactly B.1's (assert `env` equals `{ NODE_ENV: 'production' }`, or that plus `NODE_EXTRA_CA_CERTS` only when `caCertsPath` is given, and `stdio`, `serialization`), `hosted: true` never calls `forkImpl` (spy count 0) and `start()` says `{ ok: false, reason: 'hosted' }`, a `ready` with a port outside 1024 to 65535 or in 7814 to 7839, or a tool name that is not `^[a-z0-9_]{1,64}$`, gives `failed`, the secret is 64 hex chars, differs per start, is sent only in the `init` message, and never appears in `hitl()`'s JSON.stringify of the service object, `/api/info`, any run, any hop, any trace, any log line.
- `realGate` tests (in `real.test.js`, rewritten for the new rules): the 19 use cases of B.8 are `real: true, capability: 'tools'` when `tools.local`; each is `real: false` with the fixed reason under `setting='se'` without `tools.se`, under `setting='local'` without `tools.local`, and under `auto` with neither; UC9 passes only with `capability: 'tools'`; the engine-only list of A (UC5, UC11, UC12, UC13, UC14, UC14b, UC18, UC22, UC27, UC48, UC2.x, UC37, UC10, UC34, UC35, UC25, UC38, UC39, UC40, UC44, UC45) keeps its current reason on the software vertical; banking, healthcare and retail results are byte-identical to today when `gateway: true` and `setting` is `auto` or `se`; `gateway: false` gives the new fixed reason.
- `real.test.js` additions (against the updated `fakePingone.js` and `server/test/fakeToolServer.js`, a new minimal fake MCP tool server in the style of `fakeGateway.js` that speaks the wire shapes of B.3 to B.7; PROVIDER never imports LOCAL's server in these tests): exchange 2 for tools asks exactly one scope, no `audience`, no actor (assert the form); a no-`act` tools token ends `REAL_NO_ACT` before any tool call; UC24 runs no agent token and no exchange and its tokenless request carries no `authorization` header; `mapAnswer` shape tests (C.5): 428 plain JSON with top-level string `error` and top-level `challengeId`; 428 `error.data.challengeId`; 428 `error.challengeId`; string `step_up_required` is step-up with no challenge; 428 with none gives `challenge not minted`; 403 `access_denied` stays `REAL_DENY` for SE; 403 `hitl_receipt_rejected` is not `REAL_DENY`; 503 `jwks_unavailable`; UC21 for a user not in the group stops at tools/list with `REAL_NOT_LISTED` and never calls the tool, while UC9 for the same user calls it anyway and ends `REAL_DENY` (`group_required` is never mapped to `REAL_NOT_LISTED`); both are `REAL_PERMIT` for a member; the groups-ABSENT variant says so in the UC21 reply; every hop of a tools run has `provider` and `answeredBy` and no hop of an SE run lacks them; no outcome ever has a `checked` decision; no hop or trace contains the HITL secret, a receipt or a challenge id; `assertNoTrusted` and the `SENT_HEADERS`/`TRUSTED_HEADERS` pins pass unchanged. Label these tests as mapping tests: they prove the lab's reading, not Ping's behaviour.
- `settings.test.js`, `doctor.test.js`, `entry.test.js` updates: the new names and the optional gateway trio; `fullWanted`; partial trio gives `gatewayProblem` and keeps Real configured; `entry.test.js` "no child process" pin now allows `node:child_process` in `localServices.js` ONLY, and only `fork` there (no `spawn`, `exec`, `execFile`, `execSync`); the "only settings.js, live.js and real.js touch a client secret" pin stays; `localServices.js` never names `CLIENT_SECRET`.
- `approval.test.js` (inside `api.test.js` or new): the HITL settings come from `liveSettingsFor` (F1); the local provider's respond call carries the secret header and fails closed on a non-2xx; the SE HITL host is allowed by the netguard (a run with the guard installed and a non-loopback HITL URL does not throw "network blocked").
- `hosted.test.js`: hosted spawns no child (the entry is started in hosted mode with `AAG_DEPLOY_MODE=hosted` and `/api/info.provider.local.state === 'hosted'`; `localServices.test.js` proves the unit-level spy; `entry.test.js` pins that `index.js` builds `createLocalServices` only under `!hosted`), `/api/mode` Real stays 409.
- Honesty pins (SKEPTIC FIX), in `real.test.js`: for every tools-capability outcome in the matrix (PERMIT, DENY, repo and blocked-term DENY, step-up, hold, hold approved then PERMIT, receipt rejected, token problem for each reason in B.4, `jwks_unavailable`, unreachable, NOT LISTED for UC21, UC9 called anyway then DENY, UC24, not-a-JWT token) no string anywhere in the run (hops: label, title, note, request, response, fact, decision; reply; narration) matches `/Agent Gateway|gateway|Authorize/` once `not PingOne Authorize` is removed from it (the `lane` and `kind` values `gateway`, `gateway-check` and `authorize-decision` are data keys and are exempt: the walk covers string VALUES of `label`, `title`, `note`, `fact`, `narrative`, `text`, `head`, `body`, `by`, `outcome` and `decision`);
  the `authorize-decision` hop of a tools run has `from === to === 'gateway'` and a title starting `Lab policy`; no tools hop has `to: 'authorize'`; `run.gatewayTrace` is `[]`; an SE run is byte-identical to today.
- `localParity.test.js` (skips itself while `server/src/local/registry.js` is missing): `LOCAL_TOOLS`, `TOOL_SCOPES`, `PUBLIC_TOOLS`, `GROUP_GATED_TOOLS` equal `registry.js`; `registry.BANDS` equals `policy.js BANDS.money` minus the CIBA band; `SCANNER_REPOS` and `BLOCKED_TERMS` equal `policy.js` `SCANNER_REPOS` and `GATEWAY.blockedTerms`; every in-scope write amount (`situations.js` UC6, UC7, UC8) is outside `[100, 200)`.
- `localE2E.test.js` (skips itself while `local/main.js` is missing): starts the updated `fakePingone.js`, forks the REAL child through `createLocalServices`, runs UC1, UC6, UC7, UC8 (including the approval and the retry), UC9 and UC21 for a user in and not in the group, UC24, UC30, UC31, UC41, UC42, UC28, UC33 through `createApp`, and asserts outcome, `provider: 'local'`, hop labels and the honest strings of C.5 and C.7. This is the integration gate (E.4).
- `fakePingone.js` (PROVIDER's update, backwards compatible): issue ES256 tokens (a fixed scalar via `createECDH` + `createPrivateKey`, `kid: 'fake-es-1'`) instead of filler signatures; every `iss` is `http://127.0.0.1:<port>/<ENV_ID>/as` (the fake knows its port after `listen`); discovery returns `{ issuer, jwks_uri: '<same origin>/<ENV_ID>/as/jwks', token_endpoint, ... }`; `GET /<ENV_ID>/as/jwks` returns the public JWK `{ kty:'EC', crv:'P-256', x, y, kid:'fake-es-1', use:'sig', alg:'ES256' }`; a third resource `tools` (`audience: 'appfire-work-tools'`, scopes = the six, `act: 'passthrough'`, groups from `state.tools.groups` default `[]`, settable per test); exchange 2 mints for it with `scope` = the requested scope, `groups` claim, `act` passed from the subject; a refusal switch `state.full.exchange = 'refuse-tools'`; the old tests keep working (the user and agent tokens stay as they are, only signed).

### E.3 WEB

- `web/src/` tests: `HttpMessage` key facts show `Answered by` and `Decided by` from the hop and nothing when absent; `ExchangeList`; `chat.js`/`decision.js` for `Tool server`, `REAL_RECEIPT_REJECTED`, `REAL_NOT_REFUSED`; the phone sends `provider`; no word from the forbidden list in any new string (extend `no-mock-words.test.jsx`); the removed sentences are gone (a test greps the built strings); `OWN_TOOL_VERTICALS` rename; vendored `.sha256` pins untouched.
- `scripts/` tests: `owner-setup.test.mjs` (gateway names optional), `repo.test.mjs` (docs and banners agree), `compose.test.mjs` is PROVIDER's.
- `scripts/e2e.mjs` new checks (full instance, software default): UC1 runs Real and the step detail of the tool hop shows `Answered by` = `tool server (local)`; UC6 ends DENIED and its decision hop says `lab policy (local), not PingOne Authorize`; UC7 holds for step-up; UC8 opens the phone, approve, the retry permits; UC9 (called anyway, DENIED, decision hop says lab policy) and UC21 (NOT OFFERED, no tool call) read the group from the fake's `state.tools.groups`, and both PERMIT after it holds the tier group; UC24 shows the 401 probe; the word scan stays green over every new string; no `UC...` id visible; no outbound request to another origin (the child's calls go to the loopback fake IdP).

- `web/src/` test (SKEPTIC FIX): a tools run's Run result draws no "What Privilege did" panel and its Sequence has no Authorize actor; an SE run still draws the panel (`gateway-run.test.jsx` unchanged).

### E.4 Integration (the coordinator, after the three branches are merged)

1. `git add` all new files. 2. `npm run talk-track` and `npm run content-pack` (regenerate `docs/talk-track.md` and `content-pack.json`; `scripts/content-pack.test.mjs` pins both to `server/src/data.js`, so they must be regenerated after PROVIDER's talk-track edit). The words `door` (README, CLAUDE.md, talk track, safety doc) and `mock`/`simulated`/`engine` on the page stay banned in prose WEB writes. 3. `npm test -w server`, `npm test -w web`, `node --test scripts/*.test.mjs`, `npm run build`, `npm run e2e`; the two docker-live tests are reported as failing only because of the held ports (or run on a temporary copy with other ports). 4. `localParity.test.js` and `localE2E.test.js` must RUN (not skip) and pass. 5. A grep for the HITL secret value and for every token in `.data/`, the e2e output and the test logs finds nothing. 6. `scripts/check-no-ai-attribution.sh`.

## F. Wiring in Docker and in hosted

Docker (`docker-compose.yml`, `Dockerfile`):
- Same image, same one process tree: PID 1 is `node server/src/index.js`; it forks `server/src/local/main.js`. The Dockerfile already has `COPY server/src server/src`, so `server/src/local/` ships; no Dockerfile change except a comment line. `USER node`, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges` stay; the child writes no file and needs no tmpfs.
- No new `ports:`. The child listens on an ephemeral loopback port INSIDE the container; nothing publishes it; the compose test pins a single published port and no `volumes`.
- Only the four new names are added to `environment` (by `${NAME:-}` substitution). No secret is added to the child's environment; the child's secret (the HITL secret) is made at runtime and crosses IPC.
- The healthcheck stays the app's `/api/health` (`demo-health/1`); a failed child does not fail the container (the lab degrades to the engine and says so in `/api/info.provider.local.state`).
- `docker stop` sends SIGTERM to PID 1; `index.js` stops the child first. An orphaned child exits on IPC disconnect.

Host run (`npm start`): identical (the child is forked from the same `index.js`).

Hosted (`AAG_DEPLOY_MODE=hosted`): `index.js` never creates `createLocalServices` and `createProviders({ hosted: true })` makes `choose` return `null`; the hosted pod forks nothing, probes nothing, reaches nothing; `deploy/k8s/**` is unchanged; `HOSTED_BANNER` is unchanged word for word.

## G. What the owner must verify live, and what stays UNVERIFIED

Nothing in this build ran against a tenant, SE or PingFederate. The fakes were written by the same people as the code that reads them: they prove the lab's reading, not Ping's behaviour. The owner's real run is the only evidence.

Owner checks (in this order):
1. PingOne tools resource: `Appfire Work Suite Tools`, audience `appfire-work-tools`, six scopes, `act` pass-through and `groups` attributes, the group `Software_EnterpriseTier`, six grants on the agent app (the owner's session did this; confirm).
2. Sign in, run UC1 on the software vertical with `AAG_PROVIDER=local` and no SE settings at all: the hops are real, `Answered by` says `tool server (local)`, the exchange-2 token is an RS256/ES256 JWT with a `kid` in the JWKS, the decoded token has `iss` = `https://auth.pingone.<tld>/<env>/as`, `aud` `appfire-work-tools`, `act.sub` = the agent client id and one scope. UNVERIFIED: PingOne's exchange 2 accepting a single tool scope with no audience parameter; the `groups` claim appearing in an EXCHANGED token (only a client-credentials token was verified); the discovery `issuer` and `jwks_uri` shapes; the verifier's RS256 path against a real PingOne key.
3. UC9 and UC21 with the user in and out of `Software_EnterpriseTier` (sign out and in again after changing it). UNVERIFIED: R3 (hidden from the list without the group, 403 on call: UC9 shows the 403, UC21 shows NOT OFFERED, and the `groups` claim must really be in the exchanged token).
4. UC6, UC7, UC8 (phone, retry with the receipt) and UC24, UC28, UC30, UC31, UC33, UC41, UC42. Local refusals read `lab policy (local), not PingOne Authorize`.
5. The HITL fix F1 on SE: with `AAG_HITL_SERVICE_URL` and its secret set, the SE phone loop on banking UC8 (needs the P1AZ consent rule flipped, `HANDOFF.md:23`; the live loop has never been observed). The 428 plain-JSON shapes (top-level `error` string and `challengeId`) are read from the PingGateway source, not seen live.
6. `AAG_PROVIDER=auto` on a machine with SE settings: the probe (an unauthenticated `initialize` to the MCP url, 200 or 401 = up; UNVERIFIED against a real SE tool server), `AAG_TOOLS_SE_URL` (nothing exists on SE today; R2).
7. Another machine with only its own PingOne (no SE): Real starts with the five app names and `PINGONE_ENVIRONMENT_ID`, the local provider answers; banking, healthcare and retail say the SE gateway is not set up.
8. The ES256 and RS256 verifier against both key types in production tokens; clock skew (60 s) against PingOne's clock.

SKEPTIC additions to the owner's list: (a) the shape of PingOne's access-token `scope` claim (string or array: the verifier accepts both, B.4 row 20); (b) the lab's clock against PingOne's (60 s skew; the 401 note says so);
(c) `NODE_EXTRA_CA_CERTS` forwarding to the child when a proxy inspects TLS; (d) upstream follow-up: a `leadNote` prop on the shared `GatewayTrace` panel so a local tool server could be drawn in it without the word Privilege (until then a tools run draws no panel);
(e) R4: `get_release_summary` is registered and called by no in-scope use case (kept so `castA2aTool` resolves to a served tool; the owner may delete it); (f) the SE provider for tools has no server to talk to (R2a).

STAYS UNVERIFIED or not built, with the reason the page or the report must keep: PingFederate (design-only, no sign-in or exchange lane; the verifier is issuer-neutral but untested against PF); the real gateway's behaviour for every SE use case; UC22 CIBA and the reserved band (R5); the SE tool server (R2); the A2A set (UC2.x, UC37) on software; the attack probes (UC5, UC11, UC12, UC13, UC14, UC14b, UC18, UC27); STEP_UP discharge (no second factor in the sign-in); the local services are lab policy, so a local refusal says nothing about PingOne Authorize and the lab's tool data says nothing about any product; STANDALONE-RULES rule 20 (prefer shared Ping infrastructure) is waived for the lab's own enforcer and HITL service by owner decision 4.

## H. Contract summary table (for quick checks)

| Contract | Value |
|---|---|
| Child entry / fork | `server/src/local/main.js`, `fork` with `env: { NODE_ENV: 'production' }` (plus `NODE_EXTRA_CA_CERTS` only when the parent has one), IPC `init` / `ready` / `error` / `shutdown` |
| Child bind | `127.0.0.1`, ephemeral port, never published |
| MCP | `POST /mcp`, JSON only, `Mcp-Session-Id`, tools: 10 (B.6) |
| Approval | `/hitl/challenges[...]`, header `x-hitl-internal-secret` (constant-time), receipt = challenge id, TTL 300 s, single use |
| Health | `GET /health` on the child (the supervisor asks every 15 s; two misses in a row kill and restart a wedged child); SE probe: unauthenticated `initialize` to the MCP url, 200 or 401, 3 s, cached 30 s |
| Verifier | alg RS256/ES256 only, 20 ordered checks with fixed reason codes, skew 60 s, token max 8192 bytes, JWKS cache 300 s. Known trade-off (security review 2026-11-16, kept on purpose): a key the issuer has rotated out or revoked still verifies until the cache refreshes (up to 5 minutes), and when the issuer is unreachable the last key set keeps verifying for up to 1 hour; tokens are short-lived, so `exp` bounds it. Lower `maxStaleMs` in `jwks.js` to fail closed sooner. |
| Refusal shape | plain JSON `{ error, message, reason, by, ... }`; 401 + `WWW-Authenticate`; 403/428 + `X-Gw-Audit-Trail` (not on 401, not on receipt rejection) |
| Settings | `AAG_PROVIDER`, `AAG_TOOLS_AUDIENCE` (`appfire-work-tools`), `AAG_TOOLS_TIER_GROUP` (`Software_EnterpriseTier`), `AAG_TOOLS_SE_URL`; gateway trio optional |
| Pick | `{ provider, capability, url, audience, scope, why, answeredBy, label }`, chosen once per run |
| Hop data | `hop.provider` `'se'|'local'`, `hop.answeredBy`, `run.provider`, `run.providerWhy`; `hop.source` unchanged |
| Labels | `Agent Gateway [SE]`, `Tool server [SE]`, `Tool server [local]`; `lab policy (local), not PingOne Authorize` |
| New outcomes | `REAL_RECEIPT_REJECTED`, `REAL_NOT_REFUSED` |


## Review fixes, 2026-11-16 (security, honesty and behaviour reviews)

- **Stalled bodies** (`server/src/local/util.js` `readBody`, `server.js`): a request body that has not arrived within 10 s is dropped and its socket destroyed (so its in-flight slot is given back), and the server's connection check runs every 2 s. Before, 32 half-sent bodies held all 32 slots for ever.
- **Approval store** (`hitl.js`): the same held call retried with the same arguments gets the same pending challenge; one caller (token `sub`) keeps at most 5 pending challenges, dropping the oldest of their own first, so one token holder cannot fill the 200-challenge store for everyone.
- **Sessions** (`mcp.js`): tokenless sessions live in their own pool of 20 and are dropped first, so a flood of anonymous `initialize` calls cannot evict a signed-in user's session. (The lab's MCP client opens a fresh session for every run, so a 404 `session_unknown` only ever ends the run it is in.)
- **Blocked terms** (`policy.js`): the query is NFKC-folded with zero-width, soft-hyphen and combining characters removed before the check. It is a teaching rule of the lab, not a security control.
- **Issuer shape** (`server.js` `validateInit`): an issuer with a trailing slash is refused at init (the discovery url would be `.../as//.well-known/...`).
- **Supervisor** (`localServices.js`): a restart attempt that dies while starting spends the restart budget instead of ending the service; `failed` is retried on a later run after a 30 s cool-down with a fresh budget; a child that is alive but wedged is killed after two missed 15 s health checks.
- **Provider on a hop is data about who ANSWERED** (`real.js`): a hop that did not run, or whose call got no answer (verdict `error`, an unreachable server), carries no `provider` or `answeredBy`. Every provider-side hop of a tools run carries `capability: 'tools'` (the path, not the answerer). A hop with no answer says `by: 'no decision: nothing answered'`.
- **SE-hosted tool server wording** (`real.js`): the lab cannot know whose policy an SE-hosted tool server applied, so its refusals read `the tool server's own policy (SE), which the lab cannot see`. Only the lab's own local server says `lab policy (local), not PingOne Authorize`.
- **No gateway words for a tool server**: its hops sit on their own `toolserver` lane (not `gateway`/`mcp`), the catalog's gateway and policy-engine specification lines are replaced for those hops (the vendored catalog is not edited), and the Presenter captions have a tool-server variant.
- **UC21 and the groups claim**: when the delegated token has no `groups` claim the run says `groupsClaim: 'absent'`, and the reply and the decision card say that no tier decision can be read (the claim is UNVERIFIED in a real exchanged token), rather than "not in the group".
- **Reply text**: the user's own `sub` (a UUID) is shown whole, and "returned 5 (and 5 issues)" says the number once.
- **Not-configured refusal**: it says Real needs a PingOne environment; the PingFederate sentence stays in `/api/info` `real.note` and the docs (the lab cannot tell who has PingFederate).
- **AAG_PROVIDER typo**: kept strict on purpose (the lab refuses to start, like every other invalid setting; the doctor names it).
- **Concurrent runs**: at most 2 Real runs at once in the whole process; a third gets HTTP 429 `live_busy`, and the page shows it as a refusal. Tell the presenter not to start several at once.
