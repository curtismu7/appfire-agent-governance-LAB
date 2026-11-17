# Design addendum: PingOne Authorize decides the airline booking (phase C), reconciled against the merged code and the live facts

Status: AUTHORITATIVE for phase C. Written 2026-11-17 on `feat/airline-authorize` (base `origin/main` 8da4504, which holds phase B: the airline pack runs Real on the lab's
own tool server, #31). Owner decision 2026-11-17 "do real authorize".

Two builders work in parallel from the same base, in separate worktrees, and never talk, so every name, string, number and JSON shape below is the contract.
Builder S = server (parent module, child process, settings, compose, every server test, the fake decision endpoint, the golden check). Builder W = web, diagram data,
owner probe, e2e, docs. The coordinator merges, regenerates the generated files and runs the integration list (section E.4).

Precedence, highest first: (1) the LIVE FACTS in section 0 (measured by the main session against the owner's real tenant with decision calls only); (2) this file;
(3) the merged code (where this file and the code differ, the code wins and the builder says so in one line in the report); (4) `design.md` of the airline-authorize
scratchpad (the skeptic-reviewed first design; NOT in the repository; sections 0 to 3, 5 and 6 are reconciled below). `docs/design-real-local.md` and
`docs/design-airline-real.md` are frozen and edited by nobody.

Nothing here was run against a tenant by the author of this file. Words on the page and in every string the page shows: never mock, simulated, offline, engine,
scripted-as-a-claim, never a use case id, never "checked" for a Real reading. A Real decision is `observed` or `inferred`.

Note on the request "I need a new p1az import file": the policy 'Larkspur Air Booking Authorization' is ALREADY imported and published in the owner's shared tree (a
decision endpoint 'Larkspur Air Booking' exists, "Use latest" on). This build does NOT generate, validate or import a policy file (the design's section 1.5 to 1.9 is
dropped: section A.4). The lab depends only on the nine statement codes, the seven parameter names and the outcome mapping in sections C and F. A regenerated import
file is a separate task (skill `p1az-import-generator`) and must keep exactly that contract: section G.3 lists it.

---

## 0. The live facts (they win over everything else)

- Call: `POST https://api.pingone.<tld>/v1/environments/<envId>/decisionEndpoints/<endpointId>` with `Authorization: Bearer <token>`, `Content-Type: application/json`,
  body `{"parameters": {...}}`, every value a string. The token is a `client_credentials` token from `https://auth.pingone.<tld>/<envId>/as/token` (HTTP Basic
  `client_id:secret`, NO scope, NO audience) for a WORKER-type app. HTTP 200; JSON `{ decision: PERMIT|DENY|NOT_APPLICABLE|INDETERMINATE, statements: [{ code, name, ...payload }], ... }`.
  Accept any `+json` media type. A "use latest" endpoint is rate limited (about 1 request per second): on HTTP 429 retry ONCE after 1.5 s, then "no decision". Timeouts:
  5 s connect, 10 s read. Never retry a 5xx.
- The endpoint evaluates the WHOLE shared tree, not just our policy. Every response also carries other demos' codes (always `transaction-approved`, sometimes
  `HITL_CONSENT` for the airline tool). The reader IGNORES every code that is not one of ours and NEVER sends shared attributes (no `Amount`, no `DecisionContext`, no `ActClientId`).
- The request is EXACTLY these seven string parameters, always all of them, canonical:

| Parameter | Value | Source |
|---|---|---|
| `AirLabMarker` | `larkspur-air` (constant) | the tool server |
| `ToolName` | `book_airline_flight` (constant) | the tool server |
| `UserId` | the verified token `sub`, non-empty | the tool server, from the verified token |
| `AirFare` | the fare from the flights table as a decimal string, greater than 0 (`"380"`) | `FLIGHTS[flight].fare`, never the caller |
| `AirIsInternational` | exactly `true` or `false` (the engine is LENIENT: `maybe` reads false, `True` reads true; send exactly these two) | `isInternational(FLIGHTS[flight])` from the airports table |
| `AirCabinAsked` | `business` or `economy`, never empty | the call's `cabin` argument |
| `AirApproval` | `none` or `verified`. `verified` ONLY when the lab's own approval service has verified a receipt for this subject, tool and arguments, by a NON-consuming check; the receipt is spent only after Authorize answered `airline-approved-as-asked` | `hitl.check` in the child |

- Our codes. The eight specific ones (PERMIT decisions with static advice statements, except the one DENY): `airline-permit-as-asked`, `airline-economy-intl`,
  `airline-economy-over-limit`, `airline-economy-intl-over-limit`, `airline-approval-required`, `airline-approved-as-asked`, `airline-second-factor-required`,
  `airline-booking-refused` (the only DENY). Plus the catch-all `airline-unmatched`: it appears NEXT TO the specific code on every in-gate request and is ignored. The
  older policy build has no catch-all: the reader behaves identically with or without it.
- NO DECISION = a response with ONLY `airline-unmatched` (unknown cabin, unknown approval over the hold), or NO `airline-` code at all (malformed fare, empty user, out of
  our gate), or NOT_APPLICABLE, INDETERMINATE, any error, timeout, 429 after the retry, non-JSON, oversize, foreign content type, or TWO different specific codes. On no decision
  the lab never books, never refuses as if Authorize had denied, never falls back to its own rule once Authorize is configured (a silent substitution), and says plainly
  `PingOne Authorize gave no decision` with the reason.
- Mapping: `airline-permit-as-asked` book as asked (200). The three `airline-economy-*` book in ECONOMY (constrained; the lab applies the narrowing the code names; the
  reason comes from the code: international, over-limit or both; the limit shown comes from `FARE_RULE`). `airline-approval-required` hold for a person (428 with the
  lab's approval service challenge, as phase B). `airline-approved-as-asked` book as asked (approved; spend the receipt). `airline-second-factor-required` step-up hold
  (428 `step_up_required`). `airline-booking-refused` refused (403). In v1 the lab's inputs never produce second-factor or refusal; the reader maps them and a test covers them.
- Statement payloads are static advice: display evidence only. The CODE decides; if a payload contradicts the code, no decision.
- Test calls appear in the owner's "recent decisions" list (recording is on): the lab sends no user-identifying data beyond the `sub` it already has.
- Settings (new, optional; Authorize is ON only when all three are set): `AAG_AUTHORIZE_ENDPOINT_ID`, `AAG_AUTHORIZE_CLIENT_ID`, `AAG_AUTHORIZE_CLIENT_SECRET` (write-only).
  The environment id and region come from the existing `PINGONE_ENVIRONMENT_ID` and `PINGONE_REGION`. Absent = the lab policy answers and says so, exactly as today.

---

## R. Reconciliation of `design.md` against the merged code and the facts

Legend: CONFIRMED = true as written. CORRECTED = changed; the right statement is given. SUPERSEDED = replaced by an owner decision or by the facts. DROPPED = not built.
Builder names in `design.md`: P (policy side) and L (lab) are replaced by W and S (section A).

| `design.md` | Verdict | Reconciled statement |
|---|---|---|
| 0.1 four answers on the import file | SUPERSEDED | The owner imported and published the policy into the shared tree and measured the endpoint (section 0). No import file is built here. |
| 0.2 #1 parent-brokered call over IPC, child has no network and no secret | CONFIRMED | The merged child is `server/src/local/main.js` (separate loopback child, no env, netguard, 12-file pin) and the parent `localServices.js` already receives child messages. Message names are CORRECTED to `authorize` / `authorize-result` (B). |
| 0.2 #2 narrowing carried by the statement CODE, payload only a cross-check | CONFIRMED, tightened | Also the limit: the payload's `limit` and `hold` numbers are NEVER read. The displayed limit is the lab's `FARE.limit`. |
| 0.2 #3 "the policy has no catch-all permit" and fare default -1 | SUPERSEDED | The live policy has a catch-all statement `airline-unmatched` and the endpoint evaluates the shared tree (foreign codes always present). Fail-closed behaviour moves into the reader (C). |
| 0.2 #4 receipt: non-consuming `hitl.check`, spend only on `approved` | CONFIRMED | The approval service is INSIDE the child (`local/hitl.js`), so `hitl.check` is added there (B.5). |
| 0.2 #5 second factor and refusal mapped but not produced by v1 inputs | CONFIRMED | Matches the facts. The probe cannot produce them (F: not probed, G.2). |
| 0.2 #6 only `book_airline_flight` asks Authorize | CONFIRMED | Every other tool, every refusal before the booking decision, keeps the lab policy label. |
| 0.2 #7 configured and failing never falls back | CONFIRMED | |
| 0.3 O-1 worker token on the page | CONFIRMED (default) | `Authorization: Bearer (worker token, not shown)`. |
| 0.3 O-2 Modules, O-3 endpoint pinning, O-5 isolation target | SUPERSEDED | The endpoint is "Use latest" and evaluates the shared tree (facts). O-3 is moot: the call paces itself (B.4). |
| 0.3 O-4 worker role | CONFIRMED, text changed | `docs/owner-steps.md` says plainly: the owner measured the decision API works with the worker app's Environment Admin role; the least-privilege custom role with `authz:authorize:decisionendpoint` is UNVERIFIED (G.2). |
| 1.1 eleven `LabAirline*` parameters | SUPERSEDED | Seven parameters, names and values in section 0. No `LabAirlineRequestId`, no actor, no flight id, no source marker: the correlation is the trace id carried over IPC, not a request parameter. |
| 1.2 Trust Framework objects, statement table, rules R1 to R8 | SUPERSEDED | The owner's policy is live. The statement CODES survive and match (section 0). The payload JSON of 1.2 is NOT assumed: the reader tolerates any payload that does not contradict the code (C.3). |
| 1.3 expected response shape | CORRECTED | `payload` shape unknown (G.2); `status` may be absent; extra top-level fields (`_links`, `authorizationVersion`, `correlationId`, `elapsedMicroseconds`, timestamps) are ignored. |
| 1.4 parity table P1 to P13, A1 to A3, N1 to N6, X1 to X3 | CORRECTED | Re-cut as the 21-case matrix of section F (13 positive rows kept; A and X rows dropped because their inputs are not in the facts; leniency and gate rows added from the facts). |
| 1.5 to 1.9 generator, validator, evaluator, import procedure, rollback | DROPPED | Nothing imports a file. `scripts/owner/lib/authorize-*.mjs`, `build-authorize-import.mjs` and `authorizeParity.test.js` are not built. |
| 2.1 settings, all three or none, `AAG_AUTHORIZE_ENVIRONMENT_ID` | CONFIRMED for the three; the fourth is DROPPED | Environment and region come from `PINGONE_*` (facts). A partial set is an `authorizeProblem`, never "wanted". |
| 2.2 parent module `server/src/authorize.js` | CONFIRMED, API CORRECTED | New API in B.3 (no `ATTRS`/11 keys; `PARAMS`, `CODES`, `normalizeParams`, `readDecision`, `createAuthorize`). |
| 2.3 token, call, timeouts, limits | CORRECTED | 5 s connect and 10 s read (was one 6 s deadline); 429 retried ONCE after a fixed 1.5 s (was `Retry-After` capped); one 401 refresh; decision calls are serialised and paced (use-latest cap, B.4) instead of "4 in flight". Content type rule CONFIRMED (a `+json` media type is accepted). 64 KB response cap CONFIRMED. No decision cache CONFIRMED. |
| 2.4 IPC `decide`/`decision`, init flag | CORRECTED | Messages `authorize` and `authorize-result` with the field names of B.1. `init.authorize` boolean CONFIRMED. The child's wait is 24 s (the tool call limit of `mcpClient.js` is 30 s). |
| 2.5 response mapping table | CORRECTED | Codes, catch-all, foreign codes and the extended reason list are in C. |
| 2.6 child branch, stamping rule, `hitl.check`, `constrained.rule` is the code | CONFIRMED | Real shape of `local/policy.js`: `decide` is synchronous and its tests call it directly, so the Authorize branch is a new exported async function and `decide` keeps its signature (B.5). |
| 2.7 decider label from the answer, never from the provider | CONFIRMED | Data field names fixed in D.1: `hop.decidedBy`, `run.decidedBy`. |
| 2.8 raw request and response in the step detail | CONFIRMED | Evidence ring of 50, keyed by trace id; shapes in B.6. |
| 2.9 child calls Authorize itself | NOT TAKEN | A secret in the smallest process; stays out. |
| 2.10 fallback and parity | CONFIRMED | Settings absent: lab policy answers and says so. The runtime never compares the two rules. |
| 3.1 to 3.3 owner scripts (generator, probe, app creator) | REPLACED | One script: `scripts/owner/authorize-probe.mjs` (A, F). The app is created by the owner in the console (G.1): no `pingone-authorize-app.mjs`. |
| 4.x tests | RE-CUT | Section E. |
| 5 honesty, "may say" and "may not say" | CONFIRMED | D.6. |
| 6 ownership | REPLACED | Section A. |
| 8 UNVERIFIED list | REPLACED | Section G. |

---

## A. File ownership (no file owned twice)

### A.1 Builder S (server, tests, plumbing)

New:
- `server/src/authorize.js` (B.3, C). Parent side only; `node:` built-ins only; reads no environment; no `console`.
- `server/test/fakeAuthorize.js` (E.1) and the tests `server/test/authorize.test.js`, `server/test/local-authorize.test.js`, `server/test/authorize-real.test.js`.

Edited (only where the section says):
- `server/src/local/policy.js` (the Authorize booking branch, B.5), `local/mcp.js` (await, the `authorize` option, audit `source`), `local/main.js` (IPC wiring), `local/server.js`
  (`validateInit` accepts `authorize`, passes the broker), `local/hitl.js` (`check`), `local/util.js` (the broker, B.2). NO new file in `server/src/local/`: it stays at 12 files.
- `server/src/localServices.js` (parent side of the IPC), `real.js` (config, endpoints, hop building, labels, `mapAnswer`, reply, evidence attach), `provider.js` (`info().authorize`),
  `settings.js`, `doctor.js`, `index.js` (wiring), `data.js` (the NOT_DEMONSTRATED line, D.7), `mcpClient.js` ONLY if `parseAuditTrail` needs to expose a field (expected: no).
- `docker-compose.yml`, `.env.example`, `scripts/compose.test.mjs`.
- `scripts/golden-capture.mjs`: ONLY the diagram section (E.3). `server/test/golden.test.js` only if it hashes diagrams itself. `server/test/golden/fourPacks.json` is NEVER regenerated.
- `server/test/**` otherwise: `fakePingone.js` (mounts the fake, E.1), `localHarness.js`, `fakeLocalChild.js`, `fakeToolServer.js`, `localParity.test.js`, `local-*.test.js`,
  `real.test.js`, `settings.test.js`, `doctor.test.js`, `localServices.test.js`, `entry.test.js`, `wordScan.js`.
- Expected NO edit: `app.js`, `flow.js`, `policy.js`, `situations.js`, `verticalText.js`, `cast.js`, `realGate.js`, `data/**`, `Dockerfile`, `server/src/vendor/**`.

### A.2 Builder W (web, diagrams, owner, e2e, docs)

New:
- `scripts/owner/authorize-probe.mjs` and `scripts/authorize-probe.test.mjs` (F, E.2).

Edited:
- `web/src/**`: `evidence/lanes.js`, `fare.js`, `decision.js`, `captions.js`, `lib.js` and their tests (D).
- `server/diagrams/delegation-chain.json` and `server/diagrams/gateway-refusals.json` (D.5) and, because they pin the labels, `server/test/diagrams.test.js` is S's: see A.3.
- `scripts/e2e.mjs` (E.2), `scripts/repo.test.mjs` only if a pin of docs breaks.
- `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `HANDOFF.md`, `docs/owner-steps.md` (G.1). `docs/design-authorize-lab.md` is this file: nobody edits it in parallel.
- Generated, NOT edited by hand: `content-pack.json` and `docs/talk-track.md`: W regenerates them in its own tree only to keep its tests green; THE COORDINATOR regenerates them again after the merge
  (they depend on S's `data.js`), commits the result and `git add`s it.
- `server/src/vendor/**`, the vendored hop catalog, `TopMenu`, `gateway-trace`, `JsonPane` are NEVER edited by anyone. The lab's own overrides are used (as phase B did).

### A.3 The one cross-over, stated

`server/test/diagrams.test.js` pins diagram data and belongs to S's tests, but W changes the data. Resolution: S edits the test only to match the exact strings of D.5 (they are fixed
here, so S needs nothing from W); W edits no file under `server/test/`. If a W test needs a server fixture it uses a literal copy of the strings in D.

### A.4 Not built (so no builder starts them)

A policy import generator, a snapshot validator or evaluator, `authorizeParity.test.js`, `pingone-authorize-app.mjs`, the module and endpoint procedure, the optional fourth setting.

### A.5 Cross-builder dependencies (the only ones, all by literal contract, no imports between the builders' new files)

1. W's e2e uses S's fake through the literal API of E.1 (`startFakePingOne({ authorize: true })`, `fake.authorize.setMode`, `fake.authorize.seen`, `authorizeSettings()`). The e2e cannot run
   until S has merged: W writes it to the contract and the coordinator runs it (E.4).
2. W's web tests use hand-written run fixtures containing the data fields of D.1 and the strings of D.2 to D.4.
3. S's `golden-capture.mjs` undo function (E.3) and W's diagram JSON use the same list in D.5.

---

## B. The IPC contract (child to parent to child)

### B.1 Messages

`init` (parent to child, existing) gains ONE boolean: `authorize: true|false`. No secret, no URL. `validateInit` accepts it (absent means false; anything else not a boolean makes init invalid).
`localServices.js` sends `authorize: Boolean(config?.authorize)`; `real.localConfig()` returns it as `Boolean(config.authorize)`. `server/test/localServices.test.js` pins the init key list: it gains `authorize`.

Child to parent, at most 1 KB, JSON:

```json
{ "type": "authorize", "id": 17, "trace": "0af7651916cd43dd8448eb211c80319c",
  "params": { "AirLabMarker": "larkspur-air", "ToolName": "book_airline_flight", "UserId": "<sub>", "AirFare": "380",
              "AirIsInternational": "true", "AirCabinAsked": "business", "AirApproval": "none" } }
```

`id`: an integer 1 to 2147483647, unique per child process, never reused. `trace`: 32 lowercase hex (the trace id of the `traceparent` of this tools/call) or `null`. (`trace` is the one field added to the
shape in the task text: the parent needs it to attach the raw request and answer to the right hop, B.6.) `params`: exactly the seven keys above, all strings, in this key order.

Parent to child:

```json
{ "type": "authorize-result", "id": 17, "outcome": "narrow", "code": "airline-economy-intl", "reason": null, "correlationId": "5b1c...", "elapsedMs": 412 }
```

`outcome` is one of the enum `permit | narrow | approval | approved | second_factor | deny | no_decision`. `code` is the specific statement code, or `null` when `outcome` is `no_decision`.
`reason` is `null` unless `outcome` is `no_decision`, then one of the enum of C.2. `correlationId`: a string matching `^[A-Za-z0-9-]{1,64}$` copied from the Authorize answer, or `null`.
`elapsedMs`: a finite integer 0 to 600000, or `null`. No other key. No Authorize text, URL, token, secret or payload ever crosses this channel.

The outcome and code pairs are fixed (the child and the parent each hold a copy and a test pins them equal):

| `outcome` | the only allowed `code` | `because` the child derives |
|---|---|---|
| `permit` | `airline-permit-as-asked` | none |
| `narrow` | `airline-economy-intl` | `["international"]` |
| `narrow` | `airline-economy-over-limit` | `["over-limit"]` |
| `narrow` | `airline-economy-intl-over-limit` | `["international","over-limit"]` |
| `approval` | `airline-approval-required` | none |
| `approved` | `airline-approved-as-asked` | none |
| `second_factor` | `airline-second-factor-required` | none |
| `deny` | `airline-booking-refused` | none |
| `no_decision` | `null` | none |

### B.2 The child side (`local/util.js` broker, wired in `local/main.js`)

`createBroker({ send, waitMs = 24000, maxPending = 8, setTimeoutImpl, clearTimeoutImpl })` returns `{ ask(params, trace) -> Promise<result>, onMessage(msg) }`.
- `ask` assigns the next id, stores `{ resolve, timer }` in a `Map`, sends the `authorize` message and resolves with a result object `{ outcome, code, reason, correlationId, elapsedMs }`.
- If `maxPending` are already waiting, the call resolves `no_decision` / `busy` WITHOUT sending. If `send` fails (no channel) it resolves `no_decision` / `unavailable`.
- After `waitMs` with no reply the call resolves `no_decision` / `timeout` and its id is forgotten. THE CHILD NEVER TURNS SILENCE INTO A PERMIT.
- `onMessage` accepts only `type: 'authorize-result'`. A reply with an id that is not pending (unknown, already answered, or timed out) is DROPPED, so a late reply never answers a
  different call and a duplicate never answers twice. A reply whose shape fails (extra or missing key, `outcome` not in the enum, a `code` not allowed for that `outcome` by the table in B.1,
  `reason` not in the C.2 enum, a non-null `reason` on a decision) resolves that call `no_decision` / `malformed`.
- Concurrency: two bookings at once get two ids and two independent promises; the parent may answer in either order; a reply binds ONLY by id.
- `main.js` creates the broker only after a valid `init` with `authorize: true`; with `authorize` false the broker does not exist and `process.on('message')` ignores `authorize-result`.
  `startLocalServer({ config, authorize })` passes `broker.ask` to `createMcp({ ..., authorize })`.

### B.3 The parent side: `server/src/authorize.js` and `localServices.js`

`localServices.js` takes a new option `authorize` (the object of `createAuthorize`, or `null`). On a child message `type: 'authorize'`:
- `id` not an integer in range: ignore (no reply). More than 8 requests outstanding for this child: reply `no_decision` / `busy` at once.
- `trace` not `null` and not 32 lowercase hex, or `params` failing `normalizeParams`: reply `no_decision` / `malformed` at once (the child must not wait 24 s for a bad message).
- `authorize` is `null` (a wiring fault, or the setting vanished): reply `no_decision` / `unavailable`.
- Otherwise `const r = await authorize.decide(params, { trace })` and `send(child, { type: 'authorize-result', id, ...r })`. An exception becomes `no_decision` / `unavailable`. The reply goes ONLY to the
  child that asked (a replaced child's pending asks are dropped). The parent never forwards child text anywhere except the fixed request builder.

`server/src/authorize.js` exports (pure where possible, I/O injected):

```js
export const POLICY_NAME = 'Larkspur Air Booking Authorization';          // the lab's constant: the owner's policy name, shown on the card (G.2)
export const PARAMS = ['AirLabMarker','ToolName','UserId','AirFare','AirIsInternational','AirCabinAsked','AirApproval'];
export const CODES = { /* the table of B.1 and C.1: code -> { outcome, decision, word } */ };
export const REASON_WORDS = { /* C.2 */ };
export function normalizeParams(p)            // { ok: true, params } | { ok: false }. Exactly the seven keys, all strings, patterns below, fresh object in key order
export function readDecision({ status, contentType, text, sent })   // pure; C
export function createAuthorize({ config, fetchImpl = (...a) => globalThis.fetch(...a), now = Date.now, sleep })   // -> { configured, decide, evidenceFor }
```

`normalizeParams` patterns (all anchored): `AirLabMarker` `^larkspur-air$`; `ToolName` `^book_airline_flight$`; `UserId` `^[^\u0000-\u001f\u007f]{1,200}$`; `AirFare` `^(?!0+(\.0+)?$)\d{1,6}(\.\d{1,2})?$`
(greater than 0); `AirIsInternational` `^(true|false)$`; `AirCabinAsked` `^(business|economy)$`; `AirApproval` `^(none|verified)$`. Any other key, a missing key, a non-string or a `__proto__` key: `{ ok: false }`.

`config` (built by `real.js realConfig`, parent only): `{ tokenUrl, decisionUrl, clientId, clientSecret }`. `tokenUrl` is exactly `${config.base}/as/token`. `decisionUrl` is exactly
`<apiOrigin>/v1/environments/<PINGONE_ENVIRONMENT_ID>/decisionEndpoints/<AAG_AUTHORIZE_ENDPOINT_ID>`, where `apiOrigin` is `https://api.pingone.<tld>` with the same `REGION_TLD` table as the auth host
(`com`, `eu`, `ca`, `asia`) and, under `AAG_LIVE_TEST_BASE` (tests only), the origin of that loopback base. The child cannot choose, change or see either URL.
`createAuthorize` re-asserts both URLs equal the config values before every request and refuses redirects (`redirect: 'manual'`; a 3xx is `endpoint`).

### B.4 The call (what `decide` does)

1. `normalizeParams`; on failure `no_decision` / `malformed`.
2. Queue. Decision calls run ONE AT A TIME, in arrival order, each starting at least 1100 ms after the previous call started (the use-latest cap, so two bookings in a row do not 429).
   At most 4 requests wait or run; a fifth is `no_decision` / `busy`. One `decide` has a total deadline of 20 s counted from its arrival (queue wait, token fetch, every request and the 429 wait
   share it); passing it is `no_decision` / `timeout`.
3. Token: `POST tokenUrl`, `Authorization: Basic base64(clientId:clientSecret)`, `Content-Type: application/x-www-form-urlencoded`, body `grant_type=client_credentials` (no scope, no audience). Response cap 16 KB;
   it must be JSON with a string `access_token` of 1 to 8192 characters. Cached in memory until `expires_in - 60` s (never less than 30 s, never beyond `expires_in - 5` s; 300 s when `expires_in` is absent);
   single-flight; never logged, returned, put in a hop, an evidence entry or an IPC message. Token endpoint answered 400 or 401: `no_decision` / `refused_credential`; network failure: `unreachable`.
4. Decision: `POST decisionUrl`, `Authorization: Bearer <token>`, `Content-Type: application/json`, `Accept: application/json, application/hal+json`, body `JSON.stringify({ parameters })`.
   Timeouts: 5 s from the start of the request until the response HEADERS arrive (connect plus first byte), then 10 s to read the body (implemented with an AbortController and two timers). Body cap 64 KB.
5. Status handling: `200` goes to `readDecision`. `401`: drop the cached token, fetch ONE new token, repeat the post ONCE; a second 401 is `refused_credential`. `403`: `refused_credential`. `429`: wait 1500 ms (when the
   20 s deadline allows) and repeat ONCE; a second 429 is `rate_limited`. Other 4xx and 3xx: `endpoint`. `5xx`: `server_error`, NEVER retried. Network error: `unreachable`. Timer: `timeout`. At most three posts per `decide`
   (the first, one after a 401 refresh, one after a 429).
6. Nothing is cached between calls except the token. There is NO decision cache.
7. Logging: none. The module has no `console`; an error becomes a fixed reason word, never a message, never a header, never the body.

### B.5 The child's booking branch (`local/policy.js`, `local/mcp.js`, `local/hitl.js`)

`decide` keeps its synchronous signature and results for every call when `config.authorize !== true` (every phase B test passes unchanged, byte for byte, with `source: 'lab-policy'`).
S extracts steps 2 to 5 of `decide` (scope, arguments, group gate, edge rules) into `precheck(ctx)` that both use. New export:

```js
export async function decideBookingWithAuthorize({ name, rawArgs, auth, config, hitl, now, authorize, trace })   // used by mcp.js only when config.authorize === true and name === 'book_airline_flight'
```

`mcp.js` calls it with `await`; every other tool, and every call when `config.authorize` is false, keeps calling `decide`. Steps:

1. `precheck`: any refusal (scope, arguments, group) returns exactly as today with `source: 'lab-policy'`. Authorize is NOT asked, and the page must not credit it.
2. `f = FLIGHTS[args.flight]`, `digest = argsDigest(rawArgs)`, `approval = 'none'`. If a receipt was sent: `c = hitl.check(receipt, { sub, tool, argsDigest: digest })`; valid gives `approval = 'verified'`, invalid keeps `'none'` and remembers `c.reason`.
3. `params = { AirLabMarker: 'larkspur-air', ToolName: name, UserId: sub, AirFare: String(f.fare), AirIsInternational: isInternational(f) ? 'true' : 'false', AirCabinAsked: args.cabin, AirApproval: approval }`.
   The fare, the international flag and the cabin come ONLY from the table and the enum-checked argument; a caller who sends `fare`, `amount` or `price` already gets `-32602` (unknown field). `r = await authorize(params, trace)`.
4. By `r.outcome`:

| `outcome` | Child answer | Audit header |
|---|---|---|
| `permit` | 200, tool runs as asked. A receipt, valid or not, is ignored and unspent. | `PERMIT`, source `pingone-authorize`, rule = the code |
| `narrow` | requires `args.cabin === 'business'` (else treat as `no_decision` / `unrecognised`). 200, tool runs with cabin economy and `constrained { field:'cabin', asked:'business', granted:'economy', because (from the code), limit: FARE.limit, rule: <the code> }`. A receipt is ignored and unspent. | `CONSTRAINED`, `pingone-authorize`, the code |
| `approval` | If a receipt was sent and it was invalid: 403 `hitl_receipt_rejected` with the lab's reason (phase B parity), NO audit header. Else `hitl.create` and 428 `approval_required` with the challenge, `fare_judged`, `international` (phase B body). | `HITL_REQUIRED`, `pingone-authorize`, the code (428 case only) |
| `approved` | only valid when `approval` was `'verified'`. `hitl.verify` (spends). If it now fails (a race) 403 `hitl_receipt_rejected`, no tool run, no audit header. Else 200, tool runs as asked, no `constrained`. | `PERMIT`, `pingone-authorize`, the code |
| `second_factor` | 428 `step_up_required` (existing body and words). | `STEP_UP`, `pingone-authorize`, the code |
| `deny` | 403 `access_denied`, fixed text, nothing run. | `DENY`, `pingone-authorize`, the code |
| `no_decision` | 503, nothing run, no receipt spent, NO audit header. Body: `{ "error": "authorize_no_decision", "message": "PingOne Authorize gave no decision.", "reason": "<C.2 enum>", "by": "tool server" }` (fixed text; nothing echoed). | none |

   The literal `'pingone-authorize'` appears in exactly ONE place in `server/src/local/` (a source-scan test). `audit.rule` for these answers is the code (`[a-z-]`); `decision` still matches `/^[A-Za-z_ -]{1,40}$/`.
   When the parent's reply carried `correlationId` and `elapsedMs`, the header also carries `"correlation": "<id>"` and `"elapsed_ms": <int>` (the page reads them only as a fallback when the evidence ring has no entry).
5. The lab NEVER compares Authorize's answer with its own phase B rule and NEVER substitutes it. With `authorize: true` and Authorize silent, the same $380 domestic booking the lab rule would permit is a 503.
6. `hitl.check(id, { sub, tool, argsDigest })` is the body of `verify` with no state change; it returns `{ valid: true }` or `{ valid: false, reason }` with the SAME reasons as `verify` (`receipt_unknown`,
   `receipt_binding_mismatch`, `receipt_used`, `receipt_expired`, `receipt_pending`, `receipt_denied`). `verify` is refactored to call `check` and then consume, so the reasons cannot drift.

### B.6 Evidence for the step detail (parent to `real.js`, never over IPC)

`createAuthorize` keeps a ring of 50 entries keyed by the 32-hex trace id (a missing or null trace keeps nothing). `evidenceFor(trace)` returns the entry and forgets it.

```json
{ "trace": "0af7...", "request": { "method": "POST", "url": "<the decision URL>",
    "headers": { "authorization": "Bearer (worker token, not shown)", "content-type": "application/json", "accept": "application/json, application/hal+json" },
    "body": { "parameters": { "...the seven...": "..." } } },
  "response": { "status": 200, "contentType": "application/json", "body": { "...the raw JSON...": "..." }, "elapsedMs": 412 },
  "posts": 1, "tokenRefreshed": false }
```
`response.body` is the parsed JSON when the raw text is at most 4096 characters, else `{ "truncated": true, "text": "<the first 4000 characters>" }`; text that is not JSON is `{ "text": "<first 400 characters>" }`.
It is untrusted: the page renders it as text (the JsonPane). The bearer token, the client id and the client secret are never in an entry. `real.js` is given the object of `createAuthorize` as a `createReal({ authorize })` option
and calls `authorize.evidenceFor(traceIdOf(last.traceparent))` once, after the tools/call returned; no entry means the hop is drawn without the request and response panes (never invented).

---

## C. The reader (`readDecision`) and the exact wording for each answer

### C.1 Code table (exact, case-sensitive, no trimming)

| Statement code | `outcome` | Required top-level `decision` | Extra consistency rule (against what the lab SENT) |
|---|---|---|---|
| `airline-permit-as-asked` | `permit` | PERMIT | none |
| `airline-economy-intl` | `narrow` | PERMIT | `AirCabinAsked` was `business` |
| `airline-economy-over-limit` | `narrow` | PERMIT | `AirCabinAsked` was `business` |
| `airline-economy-intl-over-limit` | `narrow` | PERMIT | `AirCabinAsked` was `business` |
| `airline-approval-required` | `approval` | PERMIT | `AirApproval` was `none` |
| `airline-approved-as-asked` | `approved` | PERMIT | `AirApproval` was `verified` |
| `airline-second-factor-required` | `second_factor` | PERMIT | none |
| `airline-booking-refused` | `deny` | DENY | none |

No consistency rule compares a code with the fare NUMBER or the limit: the owner may edit the limit in the console and the lab follows. Ignored (never a decision): `airline-unmatched`, and every code that
does not start with the exact characters `airline-`. A code that starts with `airline-` and is neither in the table nor `airline-unmatched` is NOT ours to guess: `unrecognised`.

### C.2 The reason enum and the words the page uses (fixed strings; nothing from the answer is ever copied into them)

| `reason` | Words (after `PingOne Authorize gave no decision: `) | When |
|---|---|---|
| `not_applicable` | `no policy applied to this request` | decision NOT_APPLICABLE |
| `indeterminate` | `it could not evaluate the request` | decision INDETERMINATE, or `status.code` present and not `OKAY` |
| `no_airline_code` | `its answer held no airline booking decision` | PERMIT or DENY with no `airline-` code at all |
| `only_unmatched` | `its answer said no airline booking rule matched` | only `airline-unmatched` |
| `ambiguous` | `its answer held two different booking decisions` | two or more distinct specific codes |
| `unrecognised` | `its answer was not one this lab recognises` | an unknown `airline-*` code, a decision that contradicts the code, a payload that contradicts the code, an inconsistency with what the lab sent |
| `malformed` | `its answer could not be read` | not JSON, wrong content type, over 64 KB, `decision` not one of the four, `statements` not an array, a statement that is not an object or has no string `code`, or a bad IPC shape |
| `rate_limited` | `it is rate limiting this lab` | 429 after the one retry |
| `refused_credential` | `it refused the lab's worker credential` | 401 after the refresh, 403, token endpoint 400 or 401 |
| `endpoint` | `its decision endpoint is not available` | 404, 400, any other 4xx, a redirect |
| `server_error` | `it answered with a server error` | 5xx (never retried) |
| `unreachable` | `it could not be reached` | connection failure, DNS, TLS |
| `timeout` | `it did not reply in time` | a timer fired (5 s headers, 10 s body, 20 s total, or the child's 24 s wait) |
| `busy` | `the lab could not ask it` | more than 4 queued in the parent, or 8 pending in the child |
| `unavailable` | `the lab could not ask it` | no broker, no channel, an exception |

### C.3 Order of the checks in `readDecision` (HTTP 200 only; every other status is B.4 item 5)

1. Media type (parameters and case ignored): `application/json` or ending in `+json` (`application/hal+json;charset=UTF-8` is accepted). `text/json`, `text/html`, `text/plain`, `application/octet-stream`, none: `malformed`.
2. Length over 64 KB (65536 characters): `malformed`. `JSON.parse` failure or a non-object top level (an array, a string): `malformed`.
3. `decision` must be exactly one of `PERMIT`, `DENY`, `NOT_APPLICABLE`, `INDETERMINATE` (case-sensitive, a string): else `malformed`. NOT_APPLICABLE gives `not_applicable`; INDETERMINATE gives `indeterminate`.
4. `statements`: absent or `null` is an empty list; a non-array is `malformed`. Every element must be an object with a string `code`; else `malformed`. `status`, when it is an object with a string `code` other than `OKAY`: `indeterminate`.
5. Collect the distinct codes that start with `airline-`. Remove `airline-unmatched`. Any left that is not in the table: `unrecognised`. None left: `only_unmatched` when `airline-unmatched` was present, else `no_airline_code`.
   Two or more distinct left: `ambiguous`. The same code in two statements counts once.
6. Exactly one specific code. Its required `decision` (C.1) must equal the answer's `decision`, else `unrecognised` (a DENY from another demo's rule beside our permit code is no decision).
7. The consistency rule of C.1 against `sent` (the parameters the lab sent). A mismatch is `unrecognised`.
8. Payload cross-check, display evidence only: the matching statement's `payload` may be an object or a string; a string is parsed as JSON and, if it does not parse or is not an object, is display text and not checked. For an object, ONLY two fields are read:
   `cabin` (checked only for the three `narrow` codes: when present as a string it must be exactly `economy`, so `first` or `business` is `unrecognised`; for every other code it is ignored) and `outcome` (when it equals one of the words `permit`, `narrow`,
   `approval-required`, `approved`, `second-factor-required`, `refused` and is not the word of this code's row (`permit`, `narrow`, `narrow`, `narrow`, `approval-required`, `approved`, `second-factor-required`, `refused` in the order of C.1), the answer is `unrecognised`; an unknown word is ignored).
   No other payload field is read, copied into a hop beyond the raw pane, or used for a number.
9. Result `{ outcome, code, reason: null, correlationId, elapsedMs }`. `correlationId` is copied from a top-level string `correlationId` only when it matches `^[A-Za-z0-9-]{1,64}$`, else `null`; `elapsedMs` is the lab's own measured round trip.

Hard rules: a PERMIT with no recognised code is never a permit. Foreign codes, extra statement fields, extra top-level fields and `_links` never change the answer. The reader returns the same answer with and without `airline-unmatched`.

---

## D. Labels, data fields, captions, lane, diagram: exact strings

### D.1 Data (builder S, `real.js`)

New fields, all on Real runs answered through a tools provider (`L.tools`). Engine runs and SE gateway runs get none, so the four older packs stay byte-identical.

| Field | Where | Values |
|---|---|---|
| `hop.decidedBy` | the `authorize-decision` hop of a tools run (also its not-run twin: absent there) | `pingone-authorize` (the audit `source` said so, the provider is local, the lab's own settings have Authorize on, the rule is one of the eight codes), `lab-policy-local` (local provider, anything else), `tool-server-se` (SE-hosted tool server: its header is NEVER trusted), `none` (no answer at all, or the 503 `authorize_no_decision`) |
| `run.decidedBy` | the run, same enum | the value of the run's decision hop |
| `hop.authorize` | the Authorize-decided hop only | `{ code, outcome, correlationId, elapsedMs }` (strings and a number read from the audit header or the evidence) |
| `run.authorize` | a run whose tool is `book_airline_flight` on a lab with Authorize configured and the local provider | `{ configured: true, asked: boolean, answered: boolean, code: string or null, reason: string or null }` |
| `run.outcome` | the 503 `authorize_no_decision` | `REAL_NO_DECISION` (new; `mapAnswer` branch on status 503 with body `error: 'authorize_no_decision'`; any other 5xx stays `REAL_UNREACHABLE`) |

`asked` is true when the tool server reached the decision (it answered 200, 403 `access_denied`, 428, or 503 `authorize_no_decision`). A scope, group or argument refusal, an invalid-receipt refusal, and every non-booking tool have
`asked: false` and `decidedBy: lab-policy-local`. A header `source: pingone-authorize` on the SE-hosted provider, on a lab with no Authorize settings, or with a rule outside the eight codes is NOT credited (a test sends one).
Authorize-off: `run.decidedBy` is `lab-policy-local` and every existing string is unchanged.

### D.2 The decision hop (builder S)

- Authorize answered (audit trusted per D.1): `kind: 'authorize-decision'`, `from: 'toolserver'`, `to: 'authorize'` (so the Sequence draws it on the Authorize lane), `shortTitle: 'PingOne Authorize (P1AZ)'`, `factOverride: 'PingOne Authorize decided'`,
  `label: 'PingOne Authorize decision: <WORD>, asked by the tool server (local) and read from its answer to tools/call'` where `<WORD>` is `PERMIT`, `CONSTRAINED`, `HITL_REQUIRED`, `STEP_UP` or `DENY`,
  `decision: { outcome: <WORD>, by: 'PingOne Authorize (policy Larkspur Air Booking Authorization)', basis: 'observed', line: 'PingOne Authorize (policy Larkspur Air Booking Authorization) returned <WORD> (<code>); the lab applied it' }`,
  `request` and `response` from the evidence (B.6) plus `response.tool_call: { status, 'x-gw-audit-trail' }`. `verdict` as today (`ok`, `held`, `deny`).
- Lab policy answered: unchanged strings, `decision.by: 'lab policy (local), not PingOne Authorize'`, a note on the tool server lane (`from === to`), `decidedBy: 'lab-policy-local'`, no `authorize` field, no `line`.
- No decision: `from: 'toolserver'`, `to: 'toolserver'` (a note, never the Authorize lane: nothing answered), `verdict: 'error'`, `decision: { outcome: 'NO DECISION', by: 'PingOne Authorize gave no decision: <C.2 words>', basis: 'inferred' }`,
  `decidedBy: 'none'`, label `PingOne Authorize gave no decision, read from the tool server's answer to tools/call`.

Notes (fixed; `<code>` is the audit rule; `<where>` is `local`):
- permit: `PingOne Authorize answered permit (<code>). The tool server (local) ran the tool as asked.`
- narrow: `PingOne Authorize answered permit with the statement <code>, which this lab reads as economy only. The tool server (local) applied it: the cabin was narrowed from business to economy.`
- hold: `PingOne Authorize answered that a person must approve this booking (<code>). The approval itself runs on the lab's own approval service.`
- approved: `PingOne Authorize answered permit once the lab's approval service vouched for the receipt (<code>). The approval was given on the lab's own approval service.`
- second factor: `PingOne Authorize answered that a second factor is needed (<code>). This lab cannot complete a step-up, so nothing was run.`
- deny: `PingOne Authorize answered deny (<code>). The tool server (local) refused the booking and nothing was run.`
- no decision: `PingOne Authorize gave no decision: <C.2 words>. The tool server (local) booked nothing and did not use its own rule instead.`
- basis note appended to every Authorize-decided note: ` Read from the tool server's audit header (source pingone-authorize); the lab sees the statement code, not the rule that produced it.`

The page never says a VALUE came from the statement payload. The vendored hop catalog is not edited: `toolsSpecFor(kind, lab, airline, authorizeDecided)` gets a fourth parameter; for `authorize-decision` with `authorizeDecided`:
`mandate: 'No RFC defines the decision itself. PingOne Authorize is a policy decision point: a caller sends it attributes and it answers with a decision and statements.'`,
`why: 'The tool server sends PingOne Authorize the fare, whether the trip is international, the cabin asked and whether a person has approved, reads its answer and enforces it. The policy the owner wrote in PingOne Authorize decides.'`,
`failure: 'Reading the answer as if PingOne Authorize had run the tool or the approval. It answers; the tool server enforces and the lab's own approval service approves.'`

### D.3 Run-level and reply strings (builder S)

- `run.constrained` (Authorize narrowed): `by: 'PingOne Authorize (policy Larkspur Air Booking Authorization)'`, `reason: 'PingOne Authorize answered permit with the statement <code> and the tool server applied it: <becauseWords>'`
  (the phase B `becauseWords`). Lab policy keeps today's `by` and `reason`.
- Held booking reply body (`mapAnswer`, 428 hold, Authorize decided): `The tool server answered 428: PingOne Authorize decided that a person must approve this booking. Approve (or deny) on the phone: the answer is recorded with the lab's own approval service and the call is retried with the receipt.`
  Step-up 428: `The tool server answered 428: PingOne Authorize decided that a second factor is needed. This lab cannot complete a step-up, so nothing was run.` 403 deny: `The tool server refused this booking (HTTP 403) because PingOne Authorize answered deny. Nothing was run.`
  `REAL_NO_DECISION` reply: `PingOne Authorize gave no decision (<C.2 words>). Nothing was booked, and the lab did not use its own rule instead.` `mapAnswer(c, { provider, capability, authorizeOn })` takes the new option.
- Booked and narrowed replies keep phase B's text (`bookingReply`).
- `real.js` `hosts()`/`origins()` include the decision URL's origin ONLY when `config.authorize` is set and valid (`endpoints()` gains `config.authorize?.decisionUrl`); the token host is the auth host already allowed.

### D.4 Web (builder W)

- `web/src/fare.js`: `approverOf(run)` returns `PingOne Authorize` when `run.decidedBy === 'pingone-authorize'`, else today's value. `FARE_BY` unchanged.
- `web/src/decision.js` `policyOf`: when the tools-run decision hop carries `decision.line`, the card's policy row value is that line, verbatim (today it composes `${by}: ${reason}`). When `hop.decidedBy === 'lab-policy-local'` the row is
  unchanged (`lab policy (local), not PingOne Authorize: <reason>`). Outcome `REAL_NO_DECISION`: `verdict: 'no-decision'`, `word: 'NO DECISION'`, `tone: 'warn'`, `level: null`, `reason: 'PingOne Authorize gave no decision: <the words in run.authorize.reason>. Nothing was booked, and the lab did not use its own rule instead.'`,
  policy row `PingOne Authorize gave no decision: <words>`, decision row `no decision`. The words are looked up by `run.authorize.reason` in a fixed table that is a literal copy of C.2 (never from free text). A card never says ALLOWED, DENIED or ESCALATED for it.
- `web/src/captions.js`: a NEW export `AUTHORIZE_CAPTIONS` (NOT added to `CAPTIONS`: the golden hashes `CAPTIONS`), used by `captionFor` when `hop.kind === 'authorize-decision'` and `hop.decidedBy` is `pingone-authorize` or `none`:
  `say`: `The tool server sent PingOne Authorize the booking: the fare, whether the trip is international, the cabin asked and whether a person has approved. PingOne Authorize answers with a decision and the tool server enforces it. The model has no say.`
  `deny`: `PingOne Authorize says no. The tool server refuses the booking and nothing is run.`
  `held`: `PingOne Authorize does not refuse and does not wave it through: a person or a second factor must come first. The approval itself runs on the lab's own approval service.`
  `constrained`: `PingOne Authorize permits the booking with a limit: economy only. The tool server applies it, so the agent's ask for business is not granted. The rule is the policy the owner wrote in PingOne Authorize.`
  `nodecision`: `PingOne Authorize gave no decision. The tool server booked nothing and did not use its own rule instead.`
  `point`: `The decision, the statement code PingOne Authorize returned, and the raw request and answer.`
  `verdictOf` gains: `hop.decidedBy === 'none'` gives `nodecision`.
- `web/src/evidence/lanes.js`: `ACTORS.authorize` becomes `label: 'PingOne Authorize (P1AZ)'`, `initials: 'AZ'` (unchanged), `lane: 'authorize'` (unchanged),
  `role: 'PingOne Authorize, the policy decision point. It answers PERMIT, DENY or a step-up for each call. On the SE gateway runs the gateway asks it; on an airline booking the lab's tool server asks it directly and applies the answer.'`,
  `sees: 'the attributes the caller sends (for an airline booking: the user id, the fare, the route, the cabin asked and the approval state)'`, `never: 'the token itself'`.
  A booking decided by Authorize draws on this lane (the hop has `to: 'authorize'`); a lab-policy decision draws as today, a note on the tool server lane; banking, healthcare and retail SE-gateway runs are unchanged apart from the label.
- A hop with `decidedBy: 'pingone-authorize'` shows the key fact `Decided by: PingOne Authorize` (the existing `Decided by` fact reads `hop.decision.by`; nothing new to build).

### D.5 The diagram (builder W edits the JSON; builder S pins it in `diagrams.test.js` and in the golden undo)

`server/diagrams/delegation-chain.json` (`lede` unchanged):
1. Node `az`: `label` becomes `PingOne Authorize (P1AZ)` (was `Authorize (policy decision)`). Position unchanged.
2. New node appended LAST in `nodes`: `{ "id": "ts", "label": "Lab tool server (own tools, local)", "group": "tool", "x": 0, "y": 600 }`.
3. Two new edges appended LAST in `edges` (indices 7 and 8, so the seven existing indices do not move), both solid (no `dashed`):
   edge 7 `{ "source": "bff", "target": "ts", "label": "tool call with the delegated token (lab's own tools)" }`;
   edge 8 `{ "source": "ts", "target": "az", "label": "booking decision request (PingOne Authorize)" }`.
4. Two new steps inserted in `steps` immediately BEFORE the HIVE step (the HIVE step stays last; the existing test pins it):
   `{ "title": "Lab tool server", "what": "On the lab's own tools (the airline and software packs) the delegated token goes to the lab's tool server, which checks it itself. No gateway is in this path.", "hop": "gateway-check", "edges": [7] }` and
   `{ "title": "PingOne Authorize (P1AZ): booking decision", "what": "With the Authorize settings set, the lab's own tool server asks PingOne Authorize about an airline booking (fare, international or not, cabin, approval state) and applies the answer: a real call, drawn solid. Without them, or in the hosted build, the lab's own policy answers and the page says so.", "hop": "authorize-decision", "edges": [8] }`.
   Both `what` strings are at most 300 characters (validator limit; check with `validateDiagram`).
5. Step 5 (`Authorize decision`) and every other existing title and `what` are unchanged.

`server/diagrams/gateway-refusals.json`: node `az` `label` becomes `PingOne Authorize (P1AZ)` (was `Authorize`). Nothing else.

Golden intended changes (E.3): per vertical, the `/api/diagram` answers differ from the four-pack baseline ONLY by exactly these items: delegation-chain: node `az` label, node `ts`, edges with `n` 7 and 8, the two new steps;
gateway-refusals: node `az` label.

### D.6 What the page may say

`PingOne Authorize decided` only for a run whose booking decision hop has `decidedBy: 'pingone-authorize'`, and only on that hop and in a run-level sentence worded `PingOne Authorize decided the booking`, never `this run`.
Everything else keeps the phase B words (`lab policy (local), not PingOne Authorize`). The division of labour is always: Authorize answers; the tool server enforces; the approval runs on the lab's own approval service.
Never: that Authorize narrowed, enforced, ran the approval or sent a push; anything about other demos' policies; latency or price numbers; `checked`; the words mock, simulated, offline, engine, scripted as a claim; a use case id. The numbers are LAB-INVENTED.

### D.7 Static text (builder S, `data.js`, and builder W, README and CLAUDE.md)

`NOT_DEMONSTRATED` line 5 of the list becomes: `The outcome word CONSTRAINED and the narrowing of a request argument: with the PingOne Authorize settings set, the lab's tool server asks PingOne Authorize (one policy the owner wrote) and applies its answer; with them absent, or on any run that does not ask it, the lab's own rule answers and says so. How a product policy expresses a narrowing natively is not claimed.`
(It is a shared line: the four older packs' golden `notDemonstrated` hashes are INFO-only by design.) The engine airline path and every non-Real airline run keep `FARE_BY`.

---

## E. Tests

### E.1 Builder S

`server/test/fakeAuthorize.js` (a decision-endpoint handler mounted by `fakePingone.js`):
- Exports `createFakeAuthorize()` returning `{ handle(req, res, url) -> boolean, setMode(name), mode(), seen: [{ at, parameters, bearer: boolean }], tokenRequests: number, reset() }`.
- `fakePingone.js` exports `AUTHORIZE_CLIENT_ID`, `AUTHORIZE_CLIENT_SECRET` (assembled from parts at run time like the others, so no secret-shaped literal sits in the repository), `AUTHORIZE_ENDPOINT_ID` (a UUID) and
  `authorizeSettings(extra = {})` returning `{ AAG_AUTHORIZE_ENDPOINT_ID, AAG_AUTHORIZE_CLIENT_ID, AAG_AUTHORIZE_CLIENT_SECRET, ...extra }`. `startFakePingOne` gains an option `authorize` (default false); when true the instance has `.authorize`
  (the controller above), serves `POST /v1/environments/<ENV_ID>/decisionEndpoints/<AUTHORIZE_ENDPOINT_ID>` (NOT under `/<ENV_ID>/as`) and accepts a `client_credentials` request at `/<ENV_ID>/as/token` for the Authorize client (Basic checked, wrong secret 401, no
  scope accepted, a short-lived token that `unauthorized-then-ok` can expire). The route requires `Authorization: Bearer <a token it minted>` (else 401), `Content-Type: application/json` (else 415), a body of exactly `{ parameters }` with exactly the seven
  string values (else 400), a UUID endpoint id (else 400) and a known one (else 404).
- Modes (exact names; one `answer(mode, parameters)` function so a shape correction is one edit):

| Mode | Answer |
|---|---|
| `ok` (default) | S's OWN hand-written reading of the F table from the parameters, a PERMIT (or the one DENY) with the specific statement, `airline-unmatched` next to it, ALWAYS a foreign `transaction-approved` statement and sometimes a foreign `HITL_CONSENT`, `status: { code: 'OKAY' }`, `correlationId`, `elapsedMicroseconds`; payloads are strings of flat JSON; an incomplete or foreign request gets the F no-decision shapes |
| `ok-no-catchall` | `ok` without `airline-unmatched` (the older policy build) |
| `hal-json` | `ok` with `Content-Type: application/hal+json;charset=UTF-8`, `_links`, `authorizationVersion` and extra top-level fields |
| `second-factor`, `deny` | the specific code `airline-second-factor-required` (PERMIT) or `airline-booking-refused` (DENY), whatever the parameters |
| `only-unmatched`, `no-airline-code`, `not-applicable`, `indeterminate` | those shapes (`no-airline-code`: PERMIT with only foreign codes) |
| `two-specific-codes` | PERMIT with two different specific codes |
| `unknown-airline-code` | a code `airline-cabin-first` (unknown but `airline-` prefixed) |
| `decision-code-mismatch` | DENY with `airline-permit-as-asked`; and PERMIT with `airline-booking-refused` |
| `payload-contradicts-code` | `airline-economy-intl` whose payload says cabin `first`; `airline-permit-as-asked` whose payload outcome is `refused` |
| `permit-extra-fields` | a valid permit with extra statement fields, `__proto__` and `constructor` members, a 5 KB code in a foreign statement |
| `bad-json`, `wrong-content-type` (`text/html`, `text/json`, `text/plain`), `oversize` (over 64 KB), `redirect` | hostile transports |
| `429-then-ok`, `429-always` | 429 once then the `ok` answer; 429 every time |
| `5xx` | 500 and 503 variants (`5xx`), never retried (the test counts requests) |
| `timeout` | never answers (headers deadline) and `slow-body` (headers then a stalled body) |
| `unauthorized-then-ok` | the first bearer is rejected 401 (a "bearer missing or expired" case), a new token is fetched, the second post answers `ok` (proves ONE refresh, and that the token request count is 2) |
| `forbidden`, `not-found`, `bad-request` | 403, 404, 400 |

Tests (counts are pasted in the report, never estimated):
- `authorize.test.js`: `normalizeParams` (12 keys, 6 keys, a number value, a `__proto__` key, a control character, a 201-character `UserId`, fare `0`, `"0.00"`, `"-5"`, `"abc"`, `"1e3"`, a boolean as text other than true/false); `readDecision` over EVERY fake mode and the C.3 order
  (each C.2 reason reachable; the SAME answer with and without `airline-unmatched`; foreign codes ignored; a code in the wrong case or with a trailing space is not ours; `decision` lowercase or an array is `malformed`; `statements` an object is `malformed`;
  a narrow code when `economy` was asked is `unrecognised`; `approved` when `none` was sent; `approval` when `verified` was sent; `application/json; charset=utf-8` and `application/hal+json` accepted, `text/json`, `text/html`, `text/plain`, `application/octet-stream` refused);
  the call (token cached and reused; one refresh on 401; 429 retried once after 1500 ms with an injected clock and never twice; 5xx not retried; deadline 20 s; 5 s headers and 10 s body timers; at most three posts; calls are serial and 1100 ms apart; the fifth queued is `busy`);
  the secret and the token appear in no evidence entry, no result, no thrown text (a sentinel scan); the decision URL is never built from a child value (a `params` that looks like a URL leaves `seen` paths unchanged); the netguard allows the API host exactly once when
  the three settings are set and not otherwise; a call to any other host from the module throws.
- `local-authorize.test.js` (the REAL child process with a fake parent, then the real parent and the fake endpoint): B.2 rules (unknown, duplicate and late ids dropped; a reply with another call's id does not answer this call; a reply with a wrong shape is `malformed`; 9 pending is `busy` without sending;
  a parent that never answers gives `timeout` and a 503, never a 200; two bookings at once resolve independently, out of order); B.5 for the full F positive table (status, audit header `source: pingone-authorize`, answer fields, `constrained.rule` is the code, `fare_judged` equals the table even when the
  caller sends `fare`, `amount` or `price`, which are `-32602`); NO SILENT PERMIT: for every fake mode other than `ok`, `ok-no-catchall`, `hal-json`, `second-factor`, `deny` the booking tool does not run (no `confirmation`, run counter zero), status 503 `authorize_no_decision`, never 200 and never 403,
  and the same $380 domestic booking with the endpoint hung gives 503; settings absent: the phase B suite passes unchanged and `source` is `lab-policy`; receipt flows (P12 spends the receipt exactly once and only after `approved`; an invalid receipt over the hold is 403 `hitl_receipt_rejected` and the fake saw `none`;
  a valid receipt at or under the hold is unspent and the fake saw `verified`; Authorize down after a valid receipt was checked leaves the receipt unspent and the same receipt works once Authorize is back); the stamping rule (scope, group and argument refusals, an invalid receipt, every non-booking tool and every no decision never carry `pingone-authorize`; a source scan finds the literal in one place).
- `authorize-real.test.js` and `real.test.js` additions (airline walkthrough with the three settings, through the real child and `fakePingone({ authorize: true })`): hop and run fields of D.1 and D.2 for P01, P02, P04, P12 and a no decision; the evidence ring attaches the raw request (bearer line exactly `Bearer (worker token, not shown)`) and raw response;
  an SE-hosted fake tool server that sends `source: 'pingone-authorize'` is NOT credited (`decidedBy` `tool-server-se`); a software run on the same lab keeps `lab-policy-local`; the vocabulary walk: the word `Authorize` appears only in a hop whose `decision.by` starts `PingOne Authorize` or in the no-decision phrase, and a lab-policy run contains `Authorize` only inside `not PingOne Authorize`;
  no mock, simulated, offline, engine, `checked` and no use case id in any string (`wordScan.js` gains the Authorize-on pass); no `AAG_AUTHORIZE_CLIENT_SECRET` value, no token, in any hop, reply, log, run JSON or IPC message (a message recorder in the harness).
- Plumbing: `settings.test.js` (`AUTHORIZE_KEYS` exact, in `OPTIONAL_KEYS` and `REAL_KEYS`, never in `fullWanted`; a partial set is a named `authorizeProblem` and never makes Real wanted; placeholders count as unset; `takeLiveSettingsFromEnv` removes them; `.env.example` lists the three commented with placeholders);
  `compose.test.mjs` (the exact list gains the three, none is `env_file`); `doctor.test.js` (`authorize` check: `pass` with all three naming only the API host, `info` with none, `info` naming the missing NAMES when partial; values never printed); `localServices.test.js` (init key list includes `authorize`);
  `localParity.test.js` (the child's table of B.1 equals `authorize.js` `CODES`); `local-isolation.test.js` (12 files, no env, no console, no `CLIENT_SECRET`); `entry.test.js` (the allowHost ordering pin); `diagrams.test.js` (D.5 strings, HIVE still last and the only dashed step).

### E.2 Builder W

- `scripts/authorize-probe.test.mjs` (against an in-test loopback server, never a tenant): the dry run prints the plan and calls nothing; `--run` against a stub that answers every F row correctly prints 21 PASS and exits 0; each failure class is reported and exits 1 (a wrong code, a specific code on a negative row,
  two specific codes, INDETERMINATE on a positive row); 429 is retried and never recorded as an answer, a surviving 429 or an unreachable endpoint exits 3; a missing setting name exits 2 and names it; the request builder sends exactly the seven keys of section 0 for every row and NEVER `Amount`, `DecisionContext` or `ActClientId` (asserted on what the stub received);
  `--record <dir>` refuses a directory inside a git repository and writes one JSON file per case; the output never contains the secret, the token or a full endpoint id (a sentinel scan); the source has no `process.env` read of a secret other than through `readSettings`, no `console.log` of a request header, no POST to any path except the token and decision paths.
- Web unit tests (vitest) from hand-written run fixtures: `decision.js` (the policy row line verbatim, the `REAL_NO_DECISION` card, lab-policy rows unchanged), `fare.js` `approverOf`, `captions.js` (`AUTHORIZE_CAPTIONS` for `pingone-authorize` and `none` hops, other hops unchanged, `CAPTIONS` unchanged), `lanes.js` (label), a Sequence test that an Authorize-decided hop draws on the authorize lane and a lab-policy hop does not, the no-mock-words walk, `web/src/no-mock-words.test.jsx` still green.
- `scripts/e2e.mjs`: the port check becomes `port < 7814 || port > 7834` (the sixth instance is `port + 5`, inside 7814-7839) and the error text says so. A SIXTH instance, `authorizePort = port + 5`: the local-only settings plus `authorizeSettings()`, its own `startFakePingOne({ authorize: true })`, `AAG_PROVIDER=local`, no gateway. Checks: Denver (ALLOWED; the Decision card policy row is exactly the D.2 line; the step detail shows the raw request with `Bearer (worker token, not shown)` and the seven parameters and the raw answer; the Sequence has an Authorize lane with that hop; the fake saw exactly one decision call); Toronto (CONSTRAINED, economy booked, row says `returned CONSTRAINED (airline-economy-intl); the lab applied it`);
  Paris (held, phone approval, the retry books business, the fake saw `none` then `verified`); then `fake.authorize.setMode('timeout')` and a Denver run: NO DECISION card with the C.2 words, nothing booked, no ALLOWED, DENIED or ESCALATED word, the lab did not substitute its rule; `setMode('only-unmatched')`: the same with the `only_unmatched` words; mode back to `ok`.
  The existing local-only instance (Authorize OFF) is unchanged and still shows `lab policy (local), not PingOne Authorize` for the same three runs and never the words `PingOne Authorize decided`. The Diagram page shows the node `PingOne Authorize (P1AZ)`, the node `Lab tool server (own tools, local)` and the step text of D.5; the Sequence lane label is `PingOne Authorize (P1AZ)`.
  The visible text of every Authorize-on run contains no mock, simulated, offline, engine, scripted or use case id.

### E.3 The golden (builder S): four older packs byte-identical

`server/test/golden/fourPacks.json` is NOT regenerated. `scripts/golden-capture.mjs` gets one pure function `undoIntendedDiagram(name, d)` applied to every `/api/diagram` answer BEFORE hashing, at capture and at check: it renames node `az` back (`PingOne Authorize (P1AZ)` to `Authorize (policy decision)` in
`delegation-chain`, to `Authorize` in `gateway-refusals`), drops node `ts`, drops edges with `n >= 7` and steps with `edge >= 7` in `delegation-chain`. `--check` prints these as INFO lines `intended diagram change: <name> <what>` and still fails on any other difference. The other intended changes stay INFO-only: the story's `notDemonstrated` lines (D.7).
`node scripts/golden-capture.mjs --check` must print `golden ok`. A test proves the undo is exact: a diagram with one extra, unlisted node or a changed unlisted label FAILS the check.

### E.4 The integration list (coordinator, after both merge; real counts pasted)

`npm test -w server`; `npm test -w web`; `node --test scripts/*.test.mjs`; `npm run build` (regenerates `content-pack.json` and `docs/talk-track.md`; `git add` them; then `git status` shows no other change);
`E2E_PORT=7826 npm run e2e`; `node scripts/golden-capture.mjs --check` (`golden ok`); `node ~/Development/demo-kit-base/scripts/conformance.mjs <worktree> --new`; `scripts/check-no-ai-attribution.sh`. The docker-live tests bind 7820, 7821, 7822 (sometimes 7838): when another process holds them, prove them in a temp copy
with free ports 7831 to 7833 and restore the file (never at the same time as the e2e: its sixth instance with `E2E_PORT=7826` is on 7831). A heavy file that fails under load is re-run alone before it is called a failure. Tests run locally. Nothing contacts a tenant: the owner verifies live.

---

## F. The 21-case matrix (the probe, section E.2; written fresh)

Every row sends all seven parameters (the row lists only the ones that differ from the base): `AirLabMarker=larkspur-air`, `ToolName=book_airline_flight`, `UserId=lab-probe-subject`, and the flights table values. Order: the 13 positive rows, then the 6 negative rows, then the 2 leniency rows.
`PASS` means: exactly ONE distinct specific code from our eight, equal to the expected one (foreign codes and `airline-unmatched` ignored), the top-level `decision` as C.1 requires. A negative row PASSES when the answer has NO specific code (foreign codes, `airline-unmatched`, NOT_APPLICABLE all fine); a specific code on a negative row FAILS as `UNEXPECTED CODE`.
INDETERMINATE FAILS every row except N01 (a malformed fare may legitimately be INDETERMINATE: it passes and is printed `PASS (INDETERMINATE, a no decision)`). The probe also prints, per row, the foreign code NAMES it saw and ignored, and the first narrowing row's raw `statements` once (code, name, payload type and keys), so the owner sees what the payload really is.

| # | Case | Flight | `AirFare` | `AirIsInternational` | `AirCabinAsked` | `AirApproval` | Other change | Expected specific code | Lab outcome on the page |
|---|---|---|---|---|---|---|---|---|---|
| 1 | P01 Denver | LK 214 | `380` | `false` | `business` | `none` | | `airline-permit-as-asked` | 200 booked business |
| 2 | P02 Toronto | LK 322 | `380` | `true` | `business` | `none` | | `airline-economy-intl` | 200 economy, constrained |
| 3 | P03 Boston | LK 560 | `780` | `false` | `business` | `none` | | `airline-economy-over-limit` | 200 economy, constrained |
| 4 | P04 Paris | LK 704 | `2400` | `true` | `business` | `none` | | `airline-approval-required` | 428, a person approves |
| 5 | P05 edge 400 | LK 330 | `400` | `false` | `business` | `none` | | `airline-permit-as-asked` | 200 business |
| 6 | P06 edge 401 | LK 331 | `401` | `false` | `business` | `none` | | `airline-economy-over-limit` | 200 economy |
| 7 | P07 edge 1500 | LK 650 | `1500` | `false` | `business` | `none` | | `airline-economy-over-limit` | 200 economy |
| 8 | P08 edge 1501 | LK 651 | `1501` | `false` | `business` | `none` | | `airline-approval-required` | 428 |
| 9 | P09 both reasons | LK 800 | `1100` | `true` | `business` | `none` | | `airline-economy-intl-over-limit` | 200 economy, both reasons |
| 10 | P10 economy asked, international | LK 322 | `380` | `true` | `economy` | `none` | | `airline-permit-as-asked` | 200 economy, not constrained |
| 11 | P11 economy asked over the hold | LK 651 | `1501` | `false` | `economy` | `none` | | `airline-approval-required` | 428 |
| 12 | P12 approved retry | LK 704 | `2400` | `true` | `business` | `verified` | | `airline-approved-as-asked` | 200 business, receipt spent |
| 13 | P13 receipt at or under the hold | LK 322 | `380` | `true` | `business` | `verified` | | `airline-economy-intl` | 200 economy, receipt unspent |
| 14 | N01 malformed fare | LK 214 | `abc` | `false` | `business` | `none` | | none (INDETERMINATE allowed) | 503 no decision |
| 15 | N02 empty user | LK 214 | `380` | `false` | `business` | `none` | `UserId=` (empty) | none | 503 no decision |
| 16 | N03 out of our gate | LK 214 | `380` | `false` | `business` | `none` | `AirLabMarker=other` | none | 503 no decision |
| 17 | N04 unknown cabin | LK 214 | `380` | `false` | `first` | `none` | | none (only `airline-unmatched`, or nothing) | 503 no decision |
| 18 | N05 unknown approval over the hold | LK 704 | `2400` | `true` | `business` | `maybe` | | none (only `airline-unmatched`, or nothing) | 503 no decision |
| 19 | N06 other tool name (ASSUMED) | LK 214 | `380` | `false` | `business` | `none` | `ToolName=other_tool` | none; a different result is reported as `NOTE`, not `FAIL`, because the facts do not say `ToolName` is part of the gate | 503 no decision |
| 20 | L01 lenient true | LK 322 | `380` | `True` | `business` | `none` | | `airline-economy-intl` (the engine reads `True` as true) | the lab never sends this |
| 21 | L02 lenient false | LK 322 | `380` | `maybe` | `business` | `none` | | `airline-permit-as-asked` (the engine reads `maybe` as false) | the lab never sends this |

Rows 14 to 21 are probe-only (the lab never sends them): the reader's no-decision handling is tested with the fake modes of E.1. Rows 1 to 13 are the only rows the tool server can produce. NOT PROBED, with the reason: `airline-second-factor-required` and `airline-booking-refused` (the facts give no input that produces them;
the reader and the tool server map them and the fake covers them). Pacing: at least 1200 ms between rows; a 429 is retried up to 3 times with 1500 ms times the attempt number and never recorded as an answer.
The table also pins the expected CODE for the lab's own phase B rule in `server/test/authorize-real.test.js`: for every flight and cabin the code maps (through `CODES`) to the same class and the same `because` as phase B's `local/policy.js` answer (permit, constrained, hold), so a disagreement between the two readings fails a test.

---

## G. UNVERIFIED items, the policy contract, and the owner's live steps

### G.1 Owner steps (builder W writes them into `docs/owner-steps.md`, section "PingOne Authorize decides the booking"; agents never run them)

1. In the PingOne console create a WORKER-type application for the lab (a dedicated one: never the sign-in or agent app). Give it only the permission the decision endpoint needs: the documented `authz:authorize:decisionendpoint` permission through a custom role if the console allows it.
   Say plainly what the owner measured: the decision API accepted the worker token while the same app held Environment Admin; the least-privilege custom role is UNVERIFIED. Say plainly why it matters: the secret sits in the lab's `.env` and its container, and Environment Admin lets anyone holding it administer the whole environment.
2. Put the three names in the lab's own `.env` (never a shell variable, never a shared file): `AAG_AUTHORIZE_ENDPOINT_ID` (the decision endpoint `Larkspur Air Booking`), `AAG_AUTHORIZE_CLIENT_ID`, `AAG_AUTHORIZE_CLIENT_SECRET`. All three or none.
3. `node scripts/owner/authorize-probe.mjs` (dry run: what it will call, nothing sent), then `node scripts/owner/authorize-probe.mjs --run` (21 rows, 1.2 s apart, decision calls only). Read the table. Every row must say PASS. It writes nothing to the repository.
4. Recreate the container so it reads the new names: `HOST_PORT=5603 docker compose up --build -d`.
5. Live checks, in this order: Denver (ALLOWED, `PingOne Authorize decided`, the policy row names the policy); Toronto (CONSTRAINED, economy, the statement code in the step detail); Paris (held; approve on the lab phone; the retry books business); open one step detail and read the raw request (seven parameters, the bearer line says worker token, not shown) and the raw answer;
   then break the secret on purpose once (or stop the endpoint) and see NO DECISION (never a booking, never a refusal); then remove the three names, recreate, and see `lab policy (local), not PingOne Authorize` again. Test calls appear in the endpoint's recent decisions list.
6. The Diagram page shows `PingOne Authorize (P1AZ)` and the lab tool server path; the Sequence shows the lane with that name on a booking decided by Authorize.

### G.2 UNVERIFIED (what the lab expects, not something it has seen; the fakes prove only the lab's own reading)

1. The real answer's `payload`: its type (string or object), its content, and whether it carries `outcome` or `cabin` words. The reader tolerates all of them (C.3 item 8). The probe prints the first narrowing row's raw statements once. If the policy's payloads use other vocabulary nothing changes.
2. Whether the answer always carries `status`, `correlationId`, `elapsedMicroseconds`; whether it carries `_links` or `authorizationVersion`; the exact media type (`application/json` or `application/hal+json`). Handled either way. Live fixtures: the owner's probe `--record <dir outside any repo>` writes the raw answers; the coordinator may later add them as `server/test/fixtures/authorize-live/*.json` and a replay test (skipped with a visible line until they exist).
3. That `airline-second-factor-required` and `airline-booking-refused` return for the inputs the owner expects (the lab never sends one: v1 inputs cannot produce them).
4. That a least-privilege custom role with `authz:authorize:decisionendpoint` can call the endpoint; the `api.pingone.<tld>` host for regions other than `com`, `eu`, `ca`, `asia`; that the endpoint's rate limit allows the lab's 1100 ms pace.
5. The policy name `Larkspur Air Booking Authorization` shown on the card is the lab's constant, supplied by the owner: the lab does not read it from the answer, so a policy renamed in the console keeps the old name on the page until `POLICY_NAME` changes.
6. That `ToolName` is part of the policy's gate (row N06 is therefore ASSUMED and reports `NOTE`, not `FAIL`).
7. That a later edit of the policy in the console (a new limit) is picked up by the lab on the next booking (the endpoint is "Use latest"): the lab shows the code it got and applies the narrowing the code names; the displayed limit stays the lab's `FARE.limit` until the owner edits `FARE_RULE`.
8. The worker token's lifetime and that the lab's refresh-on-401 path ever fires live (proven only against the fake).

### G.3 The contract a regenerated policy import file must keep (so the lab keeps working)

Request attributes: the seven names of section 0, read from the request by name (a request resolver). Statement codes and decisions: exactly the table of C.1, plus the optional catch-all `airline-unmatched`. For a complete request exactly one specific code per answer (never two). A request outside the gate (marker not `larkspur-air`, empty `UserId`,
fare not a positive number) must yield NO specific airline code. Statement payloads: any text; the lab never depends on them. No statement on the shared tree's other policies may reuse a code that starts with `airline-`. The thresholds ($400 and $1,500, strict greater-than at both) and the leniency of `AirIsInternational` are the policy's own; the lab's table copy (`FARE_RULE`) is for display and for the phase B rule only.
