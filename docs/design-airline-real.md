# Design addendum: Real for the airline pack (phase B), reconciled against the merged code

Status: AUTHORITATIVE for phase B. Written 2026-11-17 on `feat/airline-real-tools` (base `origin/main` d06d3ef, which holds #29 real-local and #30 airline).
It replaces section 5 and the "builder R" lines of section 9 of the airline design (`design.md`, written before #29 and #30 merged). Where this file and that
one differ, this file wins; where this file and the merged code differ, the merged code wins and the builder says so in one line in the report.
`docs/design-real-local.md` (the merged real-local design) is read-only background and is not edited by anyone.

Two builders work in parallel from the same base, in separate worktrees, and never talk to each other, so every name, string, number and JSON shape below is the
contract. Builder S = server, data, compose and every server test. Builder W = web, owner script, docs, e2e and the generated content. The coordinator merges,
then runs the integration list (section 8). Nothing here was run against a tenant or SE: evidence comes from code, docs and the lab's own fakes.

Words on the page (and in every string the page shows, including API text): never mock, simulated, offline, engine, scripted-as-a-claim, never a "UC" id, never
"PingOne Authorize" as the decider of a lab rule. The local rule is always `lab policy (local), not PingOne Authorize`. A Real decision is `observed` (read from
the tool server's own answer or audit header) or `inferred` (read from a status code), never `checked`. All airline data is LAB-INVENTED and says so.

How this file was checked: the merged files named below were read in full; the gate matrix in 3.4 was computed by importing the merged `realGate.js` with a copy of
the airline cast that has `castToolServer` and with the six names added to `LOCAL_TOOLS` in memory only (script in the scratchpad, no repository file changed).

---

## 1. Reconciliation of design section 5 against the merged code

Legend: CONFIRMED = true as written. CORRECTED = the merged code differs; the right statement is given.

### 5.1 What the SE gateway serves for airline

| Statement | Verdict | Note |
|---|---|---|
| Nothing was run against SE; the whole 5.1 table is UNVERIFIED | CONFIRMED | Stays in `design.md`. Not repeated, not claimed on any page. |
| `SE_MCP_TOOLS` lists `book_airline_flight`, `redeem_miles`, `view_coverage`; not `get_airline_bookings`, `get_flight_status`, `sensitive_passenger_record` | CONFIRMED (`realGate.js` lines 21 to 24) | Builder S does NOT edit `SE_MCP_TOOLS`. Once the airline cast has `castToolServer` the airline pack never reaches that set (capability is `tools`). |
| D9: airline Real is the lab's own tool server (local, or an SE-hosted instance of it), never the SE gateway | CONFIRMED | `provider.js` `choose({capability:'tools'})` is unchanged and serves both packs. |
| The existing guard `if (cast?.castFareRule && capability !== 'tools') return {real:false, reason:"this vertical runs on the lab's own steps here"}` (`realGate.js:55`) | CORRECTED | Keep the line (harmless: a cast with `castFareRule` and no `castToolServer` cannot ship), but it is no longer reachable for the shipped pack. `server/test/review.airline.test.js:54` pins it for `realGate(UC1, VERTICALS.airline)` with no options and MUST change: see 3.4 and D.S6. |

### 5.2 The local tool registry for airline

| Statement | Verdict | Note |
|---|---|---|
| `TOOL_META` in `server/src/local/registry.js` gains six rows with a `pack` field | CORRECTED | `TOOL_META` rows today are exactly `{ scope, role, public, group }` (pinned in key order by `local-isolation.test.js:~66`). `pack` is added to ALL sixteen rows as the LAST key: `{ scope, role, public, group, pack }`, existing ten rows get `pack: 'software'`. |
| Roles `read, status, write, sensitive, public, request` | CONFIRMED | Existing roles in use: `read write sensitive a2a public status request scan search`. The airline pack has no `a2a` row of its own: `castA2aTool` is `sensitive_passenger_record` (same tool as `castSensitiveTool`); UC2.x stay on the lab's own steps. |
| `provider.js` `LOCAL_TOOLS`, `TOOL_SCOPES`, `PUBLIC_TOOLS`, `GROUP_GATED_TOOLS` mirror the registry, pinned by `localParity.test.js` | CONFIRMED | Real shapes: `LOCAL_TOOLS` is a `Set`, `TOOL_SCOPES` a plain object `{tool: scope|null}`, `PUBLIC_TOOLS` and `GROUP_GATED_TOOLS` are `Set`s. Two NEW exports are added (3.1): `TOOL_PACK` and `PACK_OF_TOOL_SERVER`. |
| `SCOPES` gains five entries, eleven in all | CONFIRMED | `SCOPES` today has six; `localParity.test.js` pins `new Set(Object.values(TOOL_SCOPES).filter(Boolean))` equal to `SCOPES`, so every one of the eleven must be used by some tool (they are: 4.1). |
| The group gate reads `config.tierGroups[meta.pack]`; IPC `init` gains the airline group | CORRECTED | Today `config.tierGroup` (one string) is used in `local/policy.js` `decide` (step 4) and `listedFor(name, auth, tierGroup)` (called from `local/mcp.js:102`). To keep every software test and fixture byte-for-byte valid, `tierGroup` stays the SOFTWARE group and ONE new optional field `tierGroupAirline` is added. No `tierGroups` object. Exact contract in 4.4. |
| New setting `AAG_TOOLS_TIER_GROUP_AIRLINE`, default `Airline_OrbitTier` | CONFIRMED | Read in `real.js` `realConfig` (like `AAG_TOOLS_TIER_GROUP`, which is read there, not in `settings.js`); named in `settings.js` `PROVIDER_KEYS`; passed in compose. 4.5. |
| `local/data.js` holds `AIRPORTS`, `FLIGHTS`, `TRIPS`, `TRAVELLER`; `lab_invented: true` last key | CONFIRMED | `data.js` today exports `ISSUES, APPS, NEWS, CODE_MATCHES, SECURITY_SETTINGS` (and nothing else is pinned about it). `lab_invented: true` is appended by `runTool` in `tools.js` (`{ ...SPEC[name].run(args, ctx), lab_invented: true }`), so it is last automatically; a booking `run` never sets it itself. |
| `local/tools.js` `SPEC` entries with strict schemas | CONFIRMED | Real shape: `SPEC[name] = { description, fields: {field: schema}, annotations: {readOnlyHint, destructiveHint}, run(args, ctx) }`; field schema helpers `int(min,max,o)` and `str(minLen,maxLen,o)`; `{ default }` makes optional, `required: true` mandatory; unknown fields are `-32602 invalid arguments: unexpected field`. The airline entries use exactly these helpers. |
| `local/policy.js` `decide` gains one branch for `book_airline_flight` between step 5 (edge rules) and step 7 (run) | CONFIRMED | Real numbering in the merged file: 2 scope, 3 arguments, 4 group gate, 5 edge rules, 6 bands (`bulk_update_issues`), 7 run. The airline branch is "step 6b", placed after the bands block and before step 7. 4.3. |
| `FARE` duplicated in `registry.js` because `local/*` imports only `node:` modules and siblings | CONFIRMED | `local-isolation.test.js` pins the import rule (`/^node:[a-z/]+$/` or `/^\.\/[a-z]+\.js$/`). So `local/*` may not import `../policy.js`. |
| "No `428 step_up_required` for airline" | CONFIRMED | UC27 stays on the lab's own steps (3.4). The airline branch never returns a step-up. |
| The honest label `lab policy (local), not PingOne Authorize`; SE-hosted says `lab policy (SE-hosted), not PingOne Authorize` | CORRECTED | The merged text is `lab policy (local), not PingOne Authorize` for the local provider and, for an SE-hosted instance, `the tool server's own policy (SE), which the lab cannot see` (rule text) / `the tool server (SE); the lab cannot see which policy it applied` (decision `by`). Nothing says `lab policy (SE-hosted)`. Reuse the merged constants in `real.js` (`rule0`, `decidedBy`); invent none. |
| The tool server's answers are scanned by `/mock|simulat|offline|\bengine\b|scripted/i` | CORRECTED | The merged scan is `server/test/wordScan.js` `BANNED = /mock|simulat|offline|\bengine\b/i` over run JSON (raw `request`/`response`/`claims` subtrees exempt). No airline string below contains those words; builder S adds an airline pass to the scan (D.S5). |
| `local/mcp.js` unchanged | CORRECTED | Two edits: `listedFor(n, auth, config)` call (4.4) and `serverInfo.title` becomes the neutral `Lab tool server (local)` (it said `Appfire Work Suite tool server (lab, local)`, which an airline run would show in its `gateway-check` response). No test pins the old title (grep: none). |

### 5.3 Provider side

| Statement | Verdict | Note |
|---|---|---|
| `realGate`: capability follows `castToolServer`; `LOCAL_TOOLS` gets six names | CONFIRMED + CORRECTED | `capability = cast && Object.hasOwn(cast,'castToolServer') ? 'tools' : 'gateway'` (`realGate.js:52`). The airline cast gets `castToolServer: 'larkspur-air'` (software keeps `'work-suite'`, pinned by `real.test.js:401`). `LOCAL_TOOLS` alone is NOT enough: `brave_news_search` and `code_search` are already in `LOCAL_TOOLS` (software, scope `issues:read`), so with only that change UC41, UC42 and UC-TOOL1 would run Real in the airline pack with a software-scope token. A PACK CHECK is required (3.1). |
| `toolArgs` gains an airline block with a new `trip` input from `situationOf(uc.id, vertical).trip` | CONFIRMED | Real signature today: `toolArgs(tool, { vertical, accounts = [], amount, args })`. New: `toolArgs(tool, { vertical, accounts = [], amount, args, trip })`. 3.2. |
| UC24: `list_airports` tokenless, then the pack's read tool tokenless as the 401 probe | CONFIRMED + CORRECTED | The probe is a module constant `PROBE_TOOL = 'get_my_issues'` in `real.js:~38` (software only). It becomes per vertical: `VERTICALS[vertical]?.castReadTool ?? 'get_my_issues'` (3.5). Probe arguments `{ limit: 1 }` are valid for `get_airline_bookings`. |
| Which airline use cases run Real | CONFIRMED with a correction | 14 run Real (3.4), not "UC41/UC42/UC-TOOL1 stay on the lab's own steps for the scope reason": they stay only if the pack check exists. UC30 and UC31 stay because `get_weather` is not a local tool. |
| `real.js` ok branch: `structuredContent.constrained` present means `REAL_CONSTRAINED`, `run.real.constrained`, `run.fareRule` | CORRECTED | There is no `run.real.constrained` (and none is needed): the page reads `run.constrained` and `run.booking` (the engine's shape, `flow.js` `bookingOf` / `bookingConstrained`), never `run.real.*`. The ok branch is the end of `gatewayLeg` (`return { outcome: 'REAL_PERMIT', ... }`, `real.js:~707`), and `tokenlessLeg` (`~748`) never sees a booking. Exact shapes: 5.3. |
| `run.fareRule` / `run.booking` on EVERY airline Real run (ok, held 428, refused 403, not listed, receipt retry) | CONFIRMED, and widened | Every return path of `run()` goes through the local `done()` function (`real.js:~565`), including exchange failures and the tokenless UC24 path, so `fareRule` goes in `done()` (every airline Real run). `booking` is present on every run of a use case whose tool is `book_airline_flight`, whatever the outcome (5.3). |
| `mapAnswer` needs no new case | CONFIRMED | `mapAnswer` is purely status-based. A 428 booking hold maps like any hold (`REAL_HOLD`, challenge id, `Held for approval`). The hold text has no proposal line (the 428 body carries no flight data), and that is accepted: the hop request shows `{flight, cabin}`. |
| `replyText` airline branch: booked, constrained, booked after approval; never a price | CONFIRMED + CORRECTED | `replyText(tool, result, _opts)` already exists (`real.js:~880`, `_opts` unused). The booking branch is added inside it. "Booked after a person's approval" needs to know a receipt was sent, so `replyText` receives `{ provider, approved: Boolean(receipt) }` from `gatewayLeg`. 5.4. |
| Web `decision.js`: `REAL_CONSTRAINED` same branches as CONSTRAINED | CONFIRMED (already merged) | `web/src/fare.js` `isConstrainedOutcome`, `lib.js` `outcomeState`, `decision.js` `verdictOf` already handle it (`fare.test.js` has fixtures). Two gaps remain (builder W): 6.1. |

### 5.4 PingOne changes (the owner script)

| Statement | Verdict | Note |
|---|---|---|
| Same resource, same audience, five scopes added, existing six untouched | CONFIRMED | The owner's session ALREADY did this in the tenant (scopes, group, eleven grants). The script must still match it and be idempotent: running it on that tenant writes nothing. 6.2. |
| Second tier group `Airline_OrbitTier`, made empty, memberships never edited | CONFIRMED | `pingone-tools-setup.mjs` step "f" handles one group (`TIER_GROUP`, `TIER_GROUP_SPEC`); it becomes a loop over two. |
| The grant step covers all eleven | CONFIRMED | Step "g" derives `names` from `TOOLS_SCOPES`; appending five entries is enough, plus the printed line. `ensureGrant` (from `pingone-real-setup.mjs`) tops up and never replaces. |
| `.env.example` / compose gets `AAG_TOOLS_TIER_GROUP_AIRLINE` | CONFIRMED | Plus `settings.js` `PROVIDER_KEYS`, because `compose.test.mjs` requires every `REAL_KEYS` name in the container environment and `settings.test.js` pins `PROVIDER_KEYS` exactly. |
| `scripts/tools-setup.test.mjs` "pins six scopes" | CONFIRMED | It also pins `ENV_HINTS` (3 pairs), one group, the exact write order and the `would grant ...` line. All change (6.2, D.W2). |

### Section 9 (ownership)

The design's builder R owned `server/src/local/*`, provider, realGate, real, localServices, settings, the owner script, docs and tests as ONE builder. This file
splits it in two (section 2) so the owner script, docs, e2e and web stay with W. Names it listed that do not exist and are dropped: `server/src/local/tools.js`
`TOOL_META` (that is `registry.js`), "WT" (merged), `feasibility-plan.json` (not in the repository; UC48 stays on the lab's own steps regardless).

---

## 2. File ownership (no file owned by two builders)

### Builder S (server)

- `server/src/local/registry.js`, `data.js`, `tools.js`, `policy.js`, `mcp.js`, `server.js` (`validateInit`), `main.js` only if needed. NO new file may be added to `server/src/local/`
  (`local-isolation.test.js` pins the 12-file list; keep it at 12).
- `server/src/provider.js`, `localServices.js`, `realGate.js`, `real.js`, `settings.js`, `cast.js` (one key), and only where a line must change: `app.js`, `index.js`, `doctor.js`, `situations.js`, `flow.js`, `policy.js`.
  Expected edits to `app.js`, `index.js`, `doctor.js`, `situations.js`, `flow.js`, `policy.js`: NONE. If one is needed, say why in the report.
- `data/**`: expected NONE.
- `docker-compose.yml`, `Dockerfile` (expected none; `COPY server/src server/src` already ships `server/src/local`), `.env.example`.
- `scripts/compose.test.mjs`.
- Every file under `server/test/**` (including `fakePingone.js`, `fakeToolServer.js`, `localHarness.js`, `localFakeIdp.js`, `golden/**`, `wordScan.js`).

### Builder W (web, owner script, docs, e2e, generated content)

- `web/src/**` (including `testFixtures.js` and every `*.test.*`).
- `scripts/owner/**` (`pingone-tools-setup.mjs`; `pingone-real-setup.mjs` and the two other files are NOT edited), `scripts/tools-setup.test.mjs`, `scripts/e2e.mjs`, `scripts/repo.test.mjs`
  (only the new README-flights test of D.W3), `scripts/owner-setup.test.mjs` only if a pin there breaks (expected none).
- `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `HANDOFF.md`, `docs/**` EXCEPT `docs/design-real-local.md` and `docs/design-airline-real.md` (both frozen). Expected: `docs/owner-steps.md`, `docs/owner-tools-resource.md`, `docs/use-case-routing.md` only if it lists Real use cases (read it; edit only if it does).
- Generated: `content-pack.json` and `docs/talk-track.md`, regenerated LAST with `npm run build` and `git add`ed (`scripts/build-content-pack.mjs`, `scripts/build-talk-track.mjs`).

### Nobody edits

`docs/design-real-local.md`, `docs/design-airline-real.md`, `design.md`, `server/src/vendor/**`, `data/usecases.json`, `data/handoff.json`, `package.json`, `scripts/golden-capture.mjs`,
`scripts/build.mjs`, the vendored hop catalog, AI-DEMO2 (read-only, never imported).

### Cross-builder dependencies (the only ones, all by literal contract, no imports)

- W's e2e and tests use the literal group name `Airline_OrbitTier` and the literal scope names; they do NOT import new exports from S's test files.
  They use existing `fullP1.state.tools.groups` (one list, shared by both packs) and `fullP1.state.resources` as today.
- W's README-flights test (D.W3) imports `FLIGHTS` and `AIRPORTS` from `../server/src/local/data.js`: S must export them with the exact names and shape of 4.2.
- S's `fakePingone.js` exports `TOOLS_SCOPES` with the eleven names in the order of 4.1 and `TIER_GROUP_AIRLINE = 'Airline_OrbitTier'`.

---

## 3. Provider side (builder S): cast, provider, realGate, toolArgs, the gate matrix

### 3.1 `cast.js` and `provider.js`

`server/src/cast.js`, airline pack only: add `castToolServer: 'larkspur-air'` (last key). Update the pack's header comment (it says "has no castToolServer yet").
`OPTIONAL_CAST_KEYS` already lists `castToolServer`. `cast.test.js:33` list of optional keys the airline defines gains `castToolServer`; line 31 (software defines every
optional key except the `castFare*` ones) stays true. Nothing else in `cast.js`.

`server/src/provider.js` (reads no env, imports nothing from real/realGate/app; keep that):

```js
export const LOCAL_TOOLS = new Set([ /* the ten software names, unchanged order */,
  'get_airline_bookings', 'get_flight_status', 'book_airline_flight', 'sensitive_passenger_record', 'list_airports', 'request_change_fee_waiver' ]);   // 16
export const TOOL_SCOPES = { /* ten unchanged */,
  get_airline_bookings: 'trips:read', get_flight_status: 'flights:read', book_airline_flight: 'flights:book',
  sensitive_passenger_record: 'travellers:read', list_airports: null, request_change_fee_waiver: 'fees:request' };
export const PUBLIC_TOOLS = new Set(['list_marketplace_apps', 'list_airports']);
export const GROUP_GATED_TOOLS = new Set(['get_project_security_settings', 'sensitive_passenger_record']);
export const CALL_UNLISTED = new Set(['UC9']);                       // unchanged
// NEW. Which pack each tool belongs to (a copy of registry.js TOOL_META[*].pack; localParity.test.js pins equality) and which pack a cast's castToolServer value names.
export const TOOL_PACK = { get_my_issues: 'software', /* ... all ten software ... */, get_airline_bookings: 'airline', /* ... all six airline ... */ };
export const PACK_OF_TOOL_SERVER = { 'work-suite': 'software', 'larkspur-air': 'airline' };
export const toolPackOf = (tool) => (typeof tool === 'string' && Object.hasOwn(TOOL_PACK, tool) ? TOOL_PACK[tool] : null);
```

Everything else in `provider.js` is unchanged (`createProviders`, `choose`, `snapshot`, `info`). `info().local.tools` becomes 16 because it counts what the child reports.

### 3.2 `realGate.js`

1. Import `TOOL_PACK, PACK_OF_TOOL_SERVER` next to `LOCAL_TOOLS`.
2. In the `capability === 'tools'` block, right after the `LOCAL_TOOLS` check, add:

```js
if (TOOL_PACK[tool] !== PACK_OF_TOOL_SERVER[cast.castToolServer]) return { real: false, reason: `its tool ${tool} is not served by the lab's tool server for this vertical` };
```
   (`Object.hasOwn` guard on both lookups. For software this never fires: every `LOCAL_TOOLS` name resolves to `software` and `work-suite` maps to `software`; the 19-use-case software pin stays exact.)
3. `const GATEWAY_LOCAL_ONLY = 'AAG_PROVIDER=local is set and the local tool server serves the airline and software verticals only';` (was `...software vertical only`). Pins that change: `real.test.js` (the `GW` block near line 397), `scripts/e2e.mjs:1007` (regex `/software vertical only|SE gateway is not set up/`, builder W).
4. `toolArgs(tool, { vertical, accounts = [], amount, args, trip })`, new cases (software cases untouched):

```js
// The airline pack's tool server (design-airline-real.md 3.2). Every value is a string or number this table or a situation fixed, never visitor text.
case 'get_airline_bookings': return { limit: 5 };
case 'get_flight_status': return { flight: typeof trip?.flight === 'string' ? trip.flight : 'LK 214' };
case 'book_airline_flight': return { flight: typeof trip?.flight === 'string' ? trip.flight : 'LK 214', cabin: typeof trip?.cabin === 'string' ? trip.cabin : 'business' };
case 'sensitive_passenger_record': return {};
case 'list_airports': return { limit: 5 };
case 'request_change_fee_waiver': return { flight: 'LK 214', reason: 'Lab request: waive the change fee' };
```
   The booking arguments NEVER carry a fare, amount, price or international flag: the tool server owns them (4.3). `trip` comes only from `situationOf(uc.id, vertical).trip`.
5. `real.js` passes `trip: sit.trip` in BOTH call sites of `toolArgs` (`gatewayLeg` `~657`, `tokenlessLeg` `~728`), with `const sit = situationOf(uc.id, vertical)` read once.

### 3.3 `localServices.js` (IPC init)

`send(c, { type:'init', config: { issuer, audience, allowedActors, tierGroup, tierGroupAirline, hitlSecret, clockSkewSeconds } })`, i.e. one new key
`tierGroupAirline: config?.tierGroupAirline` (undefined is dropped by the JSON serialisation, and the child defaults it). `real.js` `localConfig()` supplies it (4.5).
`localServices.test.js:26` pins the key list: it becomes `['allowedActors','audience','clockSkewSeconds','hitlSecret','issuer','tierGroup','tierGroupAirline']` with `CONFIG` gaining `tierGroupAirline: 'Airline_OrbitTier'`.

### 3.4 The gate matrix (computed, not guessed)

With the cast above and `tools: { se:false, local:true, localState:'ready' }, setting:'auto', a2a:false`, the merged `realGate` plus the pack check gives EXACTLY these
14 use cases Real (`capability: 'tools'`), with the tool the vertical resolves:

| Use case | Tool | Landing in Real (staged by `situations.js` airline overrides) |
|---|---|---|
| UC1, UC3, UC4, UC17, UC19, UC20 | `get_airline_bookings` | `REAL_PERMIT` |
| UC33 | `get_flight_status` | `REAL_PERMIT` (flight `LK 214`) |
| UC24 | `list_airports` | tokenless public call, then the read tool probed with no token: `REAL_PERMIT` (401 on the probe) |
| UC28 | `request_change_fee_waiver` | `REAL_PERMIT` (a request only) |
| UC9 | `sensitive_passenger_record` | out of `Airline_OrbitTier`: tool not listed, the use case calls it anyway (`CALL_UNLISTED`): `REAL_DENY` (403 `group_required`); in the group: `REAL_PERMIT` |
| UC21 | `sensitive_passenger_record` | out of the group: `REAL_NOT_LISTED` (with `groupsClaim` present/absent); in the group: `REAL_PERMIT` |
| UC7 | `book_airline_flight` LK 214, business, $380 domestic | `REAL_PERMIT`, booked business |
| UC8 | `book_airline_flight` LK 322, business, $380 international | `REAL_CONSTRAINED`, booked economy |
| UC6 | `book_airline_flight` LK 704, business, $2,400 international | `REAL_HOLD` (428), phone, retry with the receipt: `REAL_PERMIT`, booked business |

Everything else stays on the lab's own steps (the run says so in `run.realGate.reason`; the strings are the merged ones, byte for byte):

| Use case | Exact `realGate` reason | Where it comes from |
|---|---|---|
| UC22, UC27, UC48 | `its human approval (CIBA or elicitation) is staged by the lab only` | `uc.track === 'hitl'` and not UC7/UC8 (UC48 has `hitl-receipt` in its chain) |
| UC14b | `it stages an attack, which only the lab can stage` | chain holds a `sim-` step |
| UC14 | `it needs the AI-DEMO2 feature flag ff_rar, which is not known to be on in SE` | flag |
| UC13 | `the forced actor is a trusted-caller feature, and this lab never sends trusted-caller headers` | |
| UC18 | `the rate-limit toggle is a trusted-caller feature, and this lab never sends trusted-caller headers` | |
| UC5, UC11, UC12 | `it stages an attack, which only the lab can stage` | |
| UC10, UC15, UC16, UC16b, UC29, UC34, UC35, UC-MUSE1, UC-LOGIN*, UC-AIC-TX, UC-OBO | `it calls no tool, so there is nothing for the SE MCP server to run` | |
| UC2, UC2.5 | `the agent-to-agent (A2A) chain needs the specialist agent's PingOne settings (AAG_A2A_*), which are not set` (or `the specialist agent set up for A2A Real is the banking one` when A2A is configured) | `a2aOpts` is banking-only |
| UC2.6, UC2.7, UC37 | `its agent-to-agent (A2A) steps (the agent card, the protocol messages, a mismatch probe or a signed assertion) are staged by the lab only` | |
| UC30, UC31 | `its tool get_weather is not served by the lab's tool server` | `get_weather` is not a local tool |
| UC41, UC42, UC-TOOL1 | `its tool brave_news_search is not served by the lab's tool server for this vertical` (UC-TOOL1: `code_search`) | NEW pack check (3.2) |
| UC25, UC38, UC39, UC40, UC44, UC45, UC-MUSE2 | the merged flag, personal-agent or Privilege reasons | unchanged |
| every guided page | `it is a guided page: the lab shows it and does not compute it` | |

Hidden consequences S must handle:
- `tools/list` with no token now lists TWO public tools (`list_marketplace_apps`, `list_airports`), and an all-scope software token lists 11 (software ten + `list_airports`), because `list_airports` is `public`. The tool server cannot tell the vertical (no trusted header exists). Accept it; fix the counts in the pins: `local-mcp.test.js:74,86,217` (10 becomes the new counts, see D.S2), `local-process.test.js:51`, `local-isolation.test.js:61`, `localParity.test.js:14`, `provider.test.js:27`, `localE2E.test.js:140` (`local.tools` 16), and the tokenless-listing wording in `real.test.js` UC24 (`listed N tools`).
- `real.test.js` software pins that hold unchanged: the 19 software use cases and their tools (the pack check never fires for software).

### 3.5 `real.js`

Keep every existing behaviour for software. Changes, in order of appearance:

1. Imports: `FARE_RULE` from `./policy.js` (policy.js has no imports: no cycle); `VERTICALS` from `./cast.js`; `toolPackOf` from `./provider.js` next to the existing import.
2. `export const DEFAULT_TIER_GROUP_AIRLINE = 'Airline_OrbitTier';` next to `DEFAULT_TIER_GROUP` (`:143`). `realConfig`: `const toolsTierGroupAirline = optional(settings, 'AAG_TOOLS_TIER_GROUP_AIRLINE', DEFAULT_TIER_GROUP_AIRLINE); if (!plain(toolsTierGroupAirline, 120)) return { problem: 'the app .env has no valid AAG_TOOLS_TIER_GROUP_AIRLINE' };` and `toolsTierGroupAirline` in the returned config. Accessor `toolsTierGroupAirline()` beside `toolsTierGroup()`. `localConfig()` returns `{ issuer, audience, allowedActors, tierGroup: config.toolsTierGroup, tierGroupAirline: config.toolsTierGroupAirline }`.
3. UC21 not-listed text (`~621`): `const tier = toolPackOf(tool) === 'airline' ? config.toolsTierGroupAirline : config.toolsTierGroup;` (all other words unchanged).
4. UC24 probe: replace the constant use `PROBE_TOOL` by `const probeTool = VERTICALS[vertical]?.castReadTool ?? 'get_my_issues'` inside `tokenlessLeg` (it already receives `vertical`).
5. `done()` adds, for an airline vertical (`Boolean(VERTICALS[vertical]?.castFareRule)`): `fareRule: { ...FARE_RULE }` (same four keys as the engine: `limit, hold, from, to`) on EVERY airline Real run, plus `booking` and `constrained` as in 5.3. A non-airline run gets no new key (byte-identical software runs).
6. `gatewayLeg`: details in section 5 (outcome, decision word, notes, reply).
7. `replyText`: the booking branch of 5.4.

`settings.js`: `PROVIDER_KEYS = ['AAG_PROVIDER', 'AAG_TOOLS_AUDIENCE', 'AAG_TOOLS_TIER_GROUP', 'AAG_TOOLS_TIER_GROUP_AIRLINE', 'AAG_TOOLS_SE_URL']` (new name inserted before the url; `settings.test.js:122` pins the list, and `:146-148` require the name in `.env.example` as a commented line `# AAG_TOOLS_TIER_GROUP_AIRLINE=Airline_OrbitTier`).

---

## 4. The tool server (builder S): `server/src/local/**`

### 4.1 `registry.js`

```js
export const TOOL_META = {
  /* the ten software rows, each gains  , pack: 'software' */
  get_airline_bookings:       { scope: 'trips:read',      role: 'read',      public: false, group: false, pack: 'airline' },
  get_flight_status:          { scope: 'flights:read',    role: 'status',    public: false, group: false, pack: 'airline' },
  book_airline_flight:        { scope: 'flights:book',    role: 'write',     public: false, group: false, pack: 'airline' },
  sensitive_passenger_record: { scope: 'travellers:read', role: 'sensitive', public: false, group: true,  pack: 'airline' },
  list_airports:              { scope: null,              role: 'public',    public: true,  group: false, pack: 'airline' },
  request_change_fee_waiver:  { scope: 'fees:request',    role: 'request',   public: false, group: false, pack: 'airline' },
};
export const SCOPES = ['issues:read','issues:write','security:read','release:read','deploy:read','admin:request',
                       'trips:read','flights:read','flights:book','travellers:read','fees:request'];   // eleven; software six first
// The airline pack's fare rule, LAB-INVENTED. A copy of server/src/policy.js FARE_RULE (local/* may not import the lab); localParity.test.js pins equality.
export const FARE = Object.freeze({ limit: 400, hold: 1500, from: 'business', to: 'economy' });
export const DEFAULT_AIRLINE_TIER_GROUP = 'Airline_OrbitTier';
```
The key order of `TOOL_META` becomes software ten, then the six airline names in the order above. `local-isolation.test.js:~64-72` pins: `Object.keys(registry)` becomes `['BANDS','BLOCKED_TERMS','DEFAULT_AIRLINE_TIER_GROUP','FARE','SCANNER_REPOS','SCOPES','TOOL_META']` (sorted), `TOOL_META` length 16, meta keys `['scope','role','public','group','pack']`, SCOPES eleven, public tools `['list_marketplace_apps','list_airports']`, group tools `['get_project_security_settings','sensitive_passenger_record']`.

### 4.2 `data.js` (synthetic; hosts and ids invented; exports pinned for W's test)

```js
// airline pack: LAB-INVENTED. `country` decides `international`; `miles_away` is the lab's invented distance from the traveller.
export const AIRPORTS = {
  MDW: { name: 'Midway', city: 'Chicago', country: 'US', miles_away: 14 },   ORD: { name: "O'Hare", city: 'Chicago', country: 'US', miles_away: 17 },
  DEN: { name: 'Denver', city: 'Denver', country: 'US', miles_away: 920 },   SFO: { name: 'San Francisco', city: 'San Francisco', country: 'US', miles_away: 1840 },
  SEA: { name: 'Seattle-Tacoma', city: 'Seattle', country: 'US', miles_away: 1720 }, BOS: { name: 'Logan', city: 'Boston', country: 'US', miles_away: 860 },
  LAX: { name: 'Los Angeles', city: 'Los Angeles', country: 'US', miles_away: 1750 }, HNL: { name: 'Honolulu', city: 'Honolulu', country: 'US', miles_away: 4240 },
  YYZ: { name: 'Toronto Pearson', city: 'Toronto', country: 'CA', miles_away: 440 }, CDG: { name: 'Charles de Gaulle', city: 'Paris', country: 'FR', miles_away: 4170 },
  LHR: { name: 'Heathrow', city: 'London', country: 'GB', miles_away: 3950 },
};
// One listed fare per flight: the price of the business seat the lab asks for (no fare table by class). The table equals the README's airline table and the situations.
export const FLIGHTS = {
  'LK 109': { from: 'ORD', to: 'DEN', fare: 150,  day: 'Friday',      time: '6:05 am',  gate: 'B4' },
  'LK 214': { from: 'ORD', to: 'DEN', fare: 380,  day: 'Friday',      time: '8:15 am',  gate: 'B12' },
  'LK 322': { from: 'ORD', to: 'YYZ', fare: 380,  day: 'Friday',      time: '9:40 am',  gate: 'C9' },
  'LK 330': { from: 'ORD', to: 'SFO', fare: 400,  day: 'Friday',      time: '7:30 am',  gate: 'B7' },
  'LK 331': { from: 'ORD', to: 'SEA', fare: 401,  day: 'Friday',      time: '10:10 am', gate: 'B9' },
  'LK 560': { from: 'ORD', to: 'BOS', fare: 780,  day: 'December 4',  time: '12:20 pm', gate: 'C3' },
  'LK 650': { from: 'ORD', to: 'LAX', fare: 1500, day: 'Friday',      time: '3:05 pm',  gate: 'B15' },
  'LK 651': { from: 'ORD', to: 'HNL', fare: 1501, day: 'Friday',      time: '11:55 am', gate: 'B18' },
  'LK 704': { from: 'ORD', to: 'CDG', fare: 2400, day: 'November 28', time: '9:30 pm',  gate: 'C22' },
  'LK 800': { from: 'ORD', to: 'LHR', fare: 1100, day: 'Friday',      time: '6:45 pm',  gate: 'C25' },
};
export const FLIGHT_IDS = Object.keys(FLIGHTS);
// DERIVED, never stored and never taken from the caller.
export const isInternational = (f) => AIRPORTS[f.from].country !== AIRPORTS[f.to].country;
export const TRIPS = [   // the signed-in traveller's trips: one fixed list for everyone, like the software issues list
  { flight: 'LK 214', route: 'ORD to DEN', departs: 'Friday 8:15 am',      seat: '14C', cabin: 'business', status: 'confirmed' },
  { flight: 'LK 560', route: 'ORD to BOS', departs: 'December 4 12:20 pm', seat: '22A', cabin: 'economy',  status: 'confirmed' },
];
export const MILES = 18400;
export const TRAVELLER = { passport_last4: '4471', card_last4: '4821' };
```
`AIRPORTS`, `FLIGHTS`, `FLIGHT_IDS`, `isInternational`, `TRIPS`, `MILES`, `TRAVELLER` are the exports. `FLIGHTS` ids, `from`, `to`, `fare` equal the README airline table (the engine's `situations.js` airline overrides must agree: parity test D.S3).

### 4.3 `tools.js` `SPEC` additions and `policy.js` `decide`

Descriptions (plain, no banned word; `annotations` as shown):

| Tool | `description` | `fields` | `annotations` |
|---|---|---|---|
| `get_airline_bookings` | `List the signed-in traveller's upcoming trips (lab data, the same fixed list for everyone).` | `limit: int(1, 10, { default: 5 })` | `readOnlyHint: true, destructiveHint: false` |
| `get_flight_status` | `Read the status of a flight (lab data).` | `flight: str(1, 10, { enum: FLIGHT_IDS, default: 'LK 214' })` | read-only |
| `book_airline_flight` | `Book a seat on a flight. The lab's fare rule applies: a booking over the second limit is held for a person, and an international or over-limit booking is booked in economy only.` | `flight: str(1, 10, { enum: FLIGHT_IDS, required: true })`, `cabin: str(1, 10, { enum: ['business','economy'], default: 'economy' })` | `readOnlyHint: false, destructiveHint: false` |
| `sensitive_passenger_record` | `Read the traveller's private record (masked). Offered to the orbit tier group only.` | none | read-only |
| `list_airports` | `List airports near the traveller. Public: no token is needed.` | `limit: int(1, 10, { default: 5 })` | read-only |
| `request_change_fee_waiver` | `Ask for a change fee to be waived. This only files a request; this tool server has no tool that grants a waiver.` | `flight: str(1, 10, { enum: FLIGHT_IDS, default: 'LK 214' })`, `reason: str(1, 80, { required: true })` | `readOnlyHint: false, destructiveHint: false` |

Because `additionalProperties` is false and unknown fields are refused, `fare`, `amount`, `price`, `international` and `confirmation` in a call are `-32602 invalid arguments: unexpected field` (the fare is NEVER the caller's).
An unknown flight or a bad cabin is `-32602 invalid arguments: flight is not valid` / `... cabin is not valid` (fixed text; the request is never echoed).

Answers (`run(args, ctx)`; `lab_invented: true` is appended by `runTool`). `hex6()` is the existing helper.

```js
get_airline_bookings       -> { signed_in_sub: ctx.sub, total: TRIPS.length, returned: Math.min(a.limit, TRIPS.length), trips: TRIPS.slice(0, a.limit).map((t) => ({ ...t })), miles: MILES }
get_flight_status          -> { flight, route: 'ORD to DEN', status: 'on time', gate: 'B12', departs: 'Friday 8:15 am' }                 // from FLIGHTS[a.flight]
sensitive_passenger_record -> { passport_last4: '4471', known_traveller_number: 'on file (hidden)', card_last4: '4821', note: 'Full numbers are never returned by this tool.' }
list_airports              -> { total: 11, airports: [{ code, name, miles_away }] }  // Object.entries(AIRPORTS) in table order, sliced by limit
request_change_fee_waiver  -> { request_id: `CFW-${hex6()}`, status: 'pending review', flight: a.flight, requested_by: ctx.sub, note: 'This tool only files a request; no tool here can grant a waiver.' }
book_airline_flight        -> (below)
```
(`known_traveller_number` is `'on file (hidden)'`, not `[masked]`: the lab's own mask convention prints `[masked...]` for credentials and several tests assert none appears in a reply. `request_id` is random like `request_admin_access`; design.md's fixed `CFW-318` was only the engine's reply value.)

`book_airline_flight` answer, built by `run(a, ctx)` with `ctx = { sub, now, narrow }` where `narrow` is `null` or `{ granted: 'economy', because: [...] }`:

```json
{ "status": "booked", "confirmation": "LKR-3F9A21", "flight": "LK 322", "from": "ORD", "to": "YYZ", "international": true, "fare_judged": 380,
  "cabin_asked": "business", "cabin_booked": "economy",
  "constrained": { "field": "cabin", "asked": "business", "granted": "economy", "because": ["international"], "limit": 400, "rule": "lab-fare-constrained" },
  "note": "Booked on synthetic lab data only.", "lab_invented": true }
```
`constrained` is absent when nothing was narrowed (`cabin_booked` equals `cabin_asked`). `confirmation` is `LKR-` plus `hex6()` (uppercase hex). `because` is a subset of `['international','over-limit']` in that order. `fare_judged` is the table's fare (the fare the rule judged, never a price charged; no field is called `fare`, `price` or `charged`).

`decide` (step "6b", after the bands block, before step 7). `rawArgs` is the caller's object, `args`/`receipt` come from `validateArgs`:

```js
if (name === 'book_airline_flight') {
  const f = FLIGHTS[args.flight];                       // args.flight is an enum member: an own key
  const fare = f.fare; const intl = isInternational(f);
  if (fare > FARE.hold) {                               // over the second limit: a person approves, whatever the cabin and the flag (exactly 1500 does NOT hold)
    const digest = argsDigest(rawArgs);                 // the same digest as the bands: key-sorted JSON without the control field
    if (receipt) {
      const v = hitl.verify(receipt, { sub: auth.claims.sub, tool: name, argsDigest: digest });
      if (!v.valid) return { kind: 'refuse', status: 403, audit: null, body: body('hitl_receipt_rejected', 'The approval receipt was refused.', v.reason) };
      // An approval beats a narrowing: the booking is made AS ASKED. The narrowing below is skipped on this path.
      return { kind: 'permit', audit: audit('PERMIT', 'lab-fare-approved'), payload: runTool(name, args, { sub: auth.claims.sub, now, narrow: null }) };
    }
    const made = hitl.create({ sub: auth.claims.sub, tool: name, argsDigest: digest, amount: fare });
    if (!made.ok) return { kind: 'refuse', status: 503, audit: null, body: body('capacity', 'The approval service is full. Try again later.', 'capacity') };
    return { kind: 'refuse', status: 428, audit: audit('HITL_REQUIRED', 'lab-fare-hold'),
      body: body('approval_required', 'This booking needs a person to approve it.', 'lab-fare-hold', { challengeId: made.id, expiresAt: made.expiresAt, tool: name }) };
  }
  // At or under the second limit a receipt is IGNORED (never verified, never consumed): it cannot lift a narrowing.
  if (args.cabin === FARE.from && (intl || fare > FARE.limit)) {
    const because = [...(intl ? ['international'] : []), ...(fare > FARE.limit ? ['over-limit'] : [])];
    return { kind: 'permit', audit: audit('CONSTRAINED', 'lab-fare-constrained'), payload: runTool(name, args, { sub: auth.claims.sub, now, narrow: { granted: FARE.to, because } }) };
  }
  return { kind: 'permit', audit: audit('PERMIT', 'lab-no-restriction'), payload: runTool(name, args, { sub: auth.claims.sub, now, narrow: null }) };
}
```
Rules the code must satisfy:
- `domestic fare <= 400`: PERMIT as asked. `international` at any fare up to 1500, or `domestic 400 < fare <= 1500`, with cabin business: CONSTRAINED to economy. Cabin `economy` asked: PERMIT (nothing to narrow; never a CONSTRAINED that changes nothing). `fare > 1500` (1501): 428 even when the cabin is economy, even when international.
- The hold uses `argsDigest(rawArgs)` (the existing function), so a receipt is bound to subject, tool name and the exact `{flight, cabin}` the caller sent. A retry with the same arguments plus `_hitl_challenge_id` verifies; a different flight, a different cabin, a different subject or a different tool does not.
- The audit header (`X-Gw-Audit-Trail`, already built in `mcp.js` from `decision.audit`) gets `decision` one of `PERMIT|CONSTRAINED|HITL_REQUIRED` (letters/space/dash/underscore only: the lab reads it with `/^[A-Za-z_ -]{1,40}$/`) and `rule` one of `lab-no-restriction|lab-fare-constrained|lab-fare-hold|lab-fare-approved`. The 403 for a refused receipt carries `audit: null` like the bands.
- No `428 step_up_required` for airline, and no DENY by price (refusals come from scope, group, arguments and receipts only).

### 4.4 The group gate per pack

- `local/policy.js`: `const groupOf = (config, meta) => (meta.pack === 'airline' ? (config.tierGroupAirline ?? DEFAULT_AIRLINE_TIER_GROUP) : config.tierGroup);`
- `listedFor(name, auth, config)` (second change of signature: the third argument is now the whole `config`): `return !meta.group || auth.groups.includes(groupOf(config, meta));`. `mcp.js:102` becomes `listedFor(n, auth, config)`.
- `decide` step 4: `if (meta.group && !(auth && auth.groups.includes(groupOf(config, meta))))` and the 403 body's `required_group: groupOf(config, meta)`.
- `server.js` `validateInit(c)`: optional `tierGroupAirline`: absent means `DEFAULT_AIRLINE_TIER_GROUP`; present must be `str(1,120)` else `{ ok:false }`; the returned `config` carries `tierGroupAirline`. Nothing else in `validateInit` changes.
- Hide-from-list and call-time `403 group_required` behave exactly as for software (a tool the token may not use is not listed; a call is still refused).

### 4.5 Settings (builder S)

- `settings.js` `PROVIDER_KEYS` as in 3.5; `real.js` as in 3.5 (default `Airline_OrbitTier`, plain string 1..120, problem text `the app .env has no valid AAG_TOOLS_TIER_GROUP_AIRLINE`).
- `docker-compose.yml`: one new line in the `environment:` block, `      AAG_TOOLS_TIER_GROUP_AIRLINE: ${AAG_TOOLS_TIER_GROUP_AIRLINE:-}`, directly after `AAG_TOOLS_TIER_GROUP`; the comment at line 15 names it. No new port, volume, `env_file` or `tmpfs`.
- `.env.example`: after the `AAG_TOOLS_TIER_GROUP` line, `# AAG_TOOLS_TIER_GROUP_AIRLINE=Airline_OrbitTier` (commented out; the comment above it says the airline premium tier group).
- `scripts/compose.test.mjs` `COMPOSE_ENV.substituted` gains `'AAG_TOOLS_TIER_GROUP_AIRLINE'` right after `'AAG_TOOLS_TIER_GROUP'` (the test sorts, so position is cosmetic). The test is exact-list: a missing or extra name fails it. The new name is not secret-like (no match for `SECRET|PASSWORD|TOKEN|KEY|PINGONE|CLIENT|USERNAME|GATEWAY|AUDIENCE|SCOPE|HITL`).

---

## 5. The Real run for airline (builder S, `real.js`)

### 5.1 How toolArgs get values

Only from the situation: `sit = situationOf(uc.id, 'airline')` gives `trip` (flight, from, to, city, day, cabin) and `amount`/`international` (used ONLY for `run.booking` display, never sent). Visitor text (`said`) never reaches a tool argument. The call sent for UC7 is exactly
`tools/call { name: 'book_airline_flight', arguments: { flight: 'LK 214', cabin: 'business' } }` (plus `_hitl_challenge_id` on the retry).

### 5.2 Outcomes (the mapping `gatewayLeg` returns)

| Tool server answer | Outcome | Notes |
|---|---|---|
| 200, `status: 'booked'`, no `constrained` | `REAL_PERMIT` | `booking.booked = cabin_booked` |
| 200, `status: 'booked'`, valid `constrained` | `REAL_CONSTRAINED` (NEW) | see below |
| 428 `approval_required` | `REAL_HOLD` with `challenge` (existing code) | `booking.booked = null` |
| 403 `hitl_receipt_rejected` | `REAL_RECEIPT_REJECTED` (existing) | `booking.booked = null` |
| 403 `insufficient_scope` / `group_required` | `REAL_DENY` (existing) | |
| not listed | `REAL_NOT_LISTED` (existing) | |
| 401, 5xx, no answer, exchange failures, no act | existing outcomes | `booking.booked = null` |

`constrainedOf(payload)` (a pure helper in `real.js`, exported for tests) accepts the answer only when ALL hold: `payload.status === 'booked'`; `payload.constrained` is a plain object with
`field === 'cabin'`, `asked` and `granted` each in `['business','economy']` and different, `because` a non-empty array of members of `['international','over-limit']`, `limit` a finite number;
and `payload.cabin_booked === payload.constrained.granted`. Anything else is NOT constrained (outcome `REAL_PERMIT` if booked, else the existing mapping). Strings from the answer are never copied into a hop except these checked enum members and numbers.

On `REAL_CONSTRAINED`, `gatewayLeg` returns `{ outcome: 'REAL_CONSTRAINED', reply, constrained: { field, asked, granted, because: [...], limit }, payload }`.

### 5.3 Run fields (all airline Real runs)

`run.fareRule`: `{ limit: 400, hold: 1500, from: 'business', to: 'economy' }` (a copy of `FARE_RULE`), on EVERY Real run of the airline vertical, for every use case and outcome (the web draws five rungs from it).

`run.booking`: present on every Real run whose tool is `book_airline_flight` (UC6, UC7, UC8), whatever the outcome, with exactly the engine's keys:

```js
{ flight: sit.trip.flight, from: sit.trip.from, to: sit.trip.to,
  fare: Number.isFinite(payload?.fare_judged) ? payload.fare_judged : sit.amount,         // the fare the rule JUDGED, never a price paid
  international: typeof payload?.international === 'boolean' ? payload.international : sit.international === true,
  asked: sit.trip.cabin ?? FARE_RULE.from,
  booked: payload?.status === 'booked' && ['business','economy'].includes(payload.cabin_booked) ? payload.cabin_booked : null }
```
`booked: null` for a hold, a refused receipt, a refusal, an unreachable server and every failure before the tool call. After a successful receipt retry `booked` is `'business'` and there is no `constrained`. The phone reads `run.booking.fare` (`App.jsx:265`), so the hold carries it.

`run.constrained` (only on `REAL_CONSTRAINED`): `{ field, asked, granted, because, limit, by, reason }` where
`by` = `lab policy (local), not PingOne Authorize` when `P.provider === 'local'`, else `the tool server (SE); the lab cannot see which policy it applied`;
`reason` = `the tool server answered 200 with the cabin narrowed from {asked} to {granted}: {words}` where `words` is `this trip is international` | `the fare is over the $400 limit` | `this trip is international and the fare is over the $400 limit` (the `$400` is `FARE_RULE.limit` formatted; a limit is the rule, not a price paid).
The engine's `constrained` has no `reason`; the web reads it optionally.

`run.outcome`, `run.reply` as 5.4. `run.real` stays `{ level: 'full', tool, provider }` (no new key). `run.matchesExpected` stays `null`.

### 5.4 Hops, labels, lanes, notes, reply text

Lanes and hop kinds are unchanged and are the merged tool-server ones (`from`/`to` `toolserver`, `legOf`); the airline pack adds no hop kind, no lane and no label. The decision hop (`authorize-decision`, a note on the tool server's own lane) changes in three places only:

1. The decision word: `const word = audit?.decision ?? (constrained ? 'CONSTRAINED' : decisionOutcome);` used in the label, in `decision.outcome`, and for `basis`: `observed` when the audit header carried the word, `inferred` otherwise. Label: `Lab policy (local) decision: CONSTRAINED, read from the tool server's answer to tools/call (not PingOne Authorize)` (SE-hosted: `Tool server (SE) decision: CONSTRAINED, read from its answer to tools/call`).
2. `decision: { outcome: 'CONSTRAINED', by: 'lab policy (local), not PingOne Authorize', basis: 'observed' }` (for SE-hosted `by` is the existing `the tool server (SE); the lab cannot see which policy it applied`). Never `checked`.
3. The hop `note` for a constrained answer: `The tool server (local) answered 200 and narrowed the cabin from business to economy (lab policy (local), not PingOne Authorize).` (SE: `... (the tool server's own policy (SE), which the lab cannot see).`). The verdict stays `ok`.

The tool hop (`tool-dispatched`) note: booked as asked or any non-constrained tool: unchanged `The tool server ran the tool. The data is lab-invented.`; constrained: `The tool server ran the tool with the cabin narrowed to economy. The data is lab-invented.` (SE: `The tool server (SE) ran the tool with the cabin narrowed to economy.`). Its request shows the arguments as the agent sent them (`cabin: business`); its response shows the answer (`cabin_booked: economy`). The `api-call` hop stays `[NOT RUN]` (`Not run: this tool serves lab-invented data itself; no API sits behind it.`).

`replyText(tool, result, { provider, approved })` booking branch, only for `tool === 'book_airline_flight'` with a payload that is an object, `lab_invented === true` and `status === 'booked'`, built ONLY from the answer's checked fields (`flight` and `from`/`to` must match `^[A-Z]{2} \d{3}$` and `^[A-Z]{3}$`, `confirmation` `^LKR-[0-9A-F]{6}$`, cabins from the enum; else fall through to the generic text) and ending with the usual `LAB_DATA_NOTE` and a period. It never prints a fare or price:

- booked as asked: `Booked: a business seat on LK 214 from ORD to DEN, confirmation LKR-3F9A21 (lab-invented data from the lab's own tool server).`
- constrained: `Booked in economy, not business: this trip is international. LK 322 from ORD to YYZ, confirmation LKR-3F9A21 (lab-invented data from the lab's own tool server).` with `because` words as in 5.3 (`this trip is international` | `the fare is over the $400 limit` | both joined by ` and `).
- booked after a person approved (a receipt was sent): `Booked as approved: a business seat on LK 704 from ORD to CDG, confirmation LKR-3F9A21 (lab-invented data from the lab's own tool server).`
- held: the existing `mapAnswer` hold reply (`Held for approval`, body names `its lab policy (local), not PingOne Authorize`). No proposal line (the 428 carries no flight data).

The agent-reply hop's `response.reply` is the same string. `narration` = `reply.text` (existing).

### 5.5 What the page shows (builder W reads; nothing server-side beyond the above)

Decision card for Real: verdict `CONSTRAINED` (tone info) for `REAL_CONSTRAINED`, `ALLOWED` for `REAL_PERMIT`, `ESCALATED` for `REAL_HOLD`, `DENIED` for `REAL_DENY` and `REAL_RECEIPT_REJECTED`. "Which policy applied" reads `lab policy (local), not PingOne Authorize: <reason>`; the seat row reads from `run.booking` (`business asked, economy booked`, or `business asked, not booked yet (held)`). The risk strip has five rungs for every airline Real run. The chat chip is `Narrowed: business to economy` (from `run.constrained`).

---

## 6. Web, owner script, docs (builder W)

### 6.1 `web/src` (small; the merged web already handles `REAL_CONSTRAINED`)

Verified present (do not rebuild): `fare.js` `isConstrainedOutcome`/`fareLevelOf`/`narrowedOf`/`seatFields`/`narrowedChip`, `lib.js` `outcomeState`, `decision.js` `verdictOf`, `App.jsx` phone `amount: run.booking?.fare`. Work:

1. `fare.js` `fareLevelOf`: add `o === 'REAL_RECEIPT_REJECTED'` to the `5` (refused) line (the card says DENIED; the strip lit nothing).
2. `decision.js` `policyOf`, the tool-server branch (`viaTools`): for a constrained run use the run's own words. Replace `reason: rule || text(az.note) || ...` by `reason: (isConstrainedOutcome(run?.outcome) && text(run?.constrained?.reason)) || rule || text(az.note) || "the tool server's own rule"`. (`isConstrainedOutcome` is already imported.) Result: `lab policy (local), not PingOne Authorize: the tool server answered 200 with the cabin narrowed from business to economy: this trip is international`.
3. Tests: new fixtures in `testFixtures.js` built from section 5.3 and 5.4 (constrained, held, receipt-retry booked, refused): `decisionOf`, `riskLevelOf` (2, 4, 1, 5), `seatFields`, `narrowedChip`, `constrainedPolicy` and the word scan on the card text for each (no mock/simulated/engine, no `UC`, no `checked`).
4. `lib.js` `OWN_TOOL_VERTICALS` already includes airline; do not touch.

### 6.2 Owner script `scripts/owner/pingone-tools-setup.mjs` (dry run default, idempotent, never edits memberships)

Constants (exports; names pinned by W's test):

```js
export const AIRLINE_TIER_GROUP = 'Airline_OrbitTier';
export const AIRLINE_TIER_GROUP_SPEC = { name: AIRLINE_TIER_GROUP, description: 'Appfire Agent Governance LAB: the premium tier of the airline vertical. Members are chosen by the owner.' };
export const TOOLS_SCOPES = [ /* the six software entries, unchanged text */,
  { name: 'trips:read',      description: 'Read the signed-in traveller\'s trips' },
  { name: 'flights:read',    description: 'Read the status of a flight' },
  { name: 'flights:book',    description: 'Book a flight, under the lab fare rule' },
  { name: 'travellers:read', description: 'Read the traveller\'s private record (tier group)' },
  { name: 'fees:request',    description: 'File a change fee waiver request (a request only)' } ];
export const ENV_HINTS = [['AAG_PROVIDER','auto'], ['AAG_TOOLS_AUDIENCE', TOOLS_AUDIENCE], ['AAG_TOOLS_TIER_GROUP', TIER_GROUP], ['AAG_TOOLS_TIER_GROUP_AIRLINE', AIRLINE_TIER_GROUP]];
```
(descriptions use none of `$ + < = > ^ ` | ~`; the existing test scans every description for them). `TIER_GROUP`, `TIER_GROUP_SPEC`, `TOOLS_AUDIENCE`, `TOOLS_RESOURCE_NAME`, `TOOLS_RESOURCE` are unchanged; the resource description text is unchanged.

Flow changes: the header comment and the `d.` loop say eleven scopes; step `f` loops `[[TIER_GROUP, TIER_GROUP_SPEC], [AIRLINE_TIER_GROUP, AIRLINE_TIER_GROUP_SPEC]]` with the same log words (`f. group <name>: found, reused (its members are not touched)` / `would create (empty)` / `created (empty)`) and the same duplicate-name `decisions` entry; it still uses the ONE source occurrence `p1.call('POST', '/groups', spec)` (the test greps the source for POST sites: `POST /resources`, `/scopes`, `/attributes`, `/groups` only, no new site, no DELETE, no PATCH). Step `g` is unchanged code on the eleven names (the printed line `g. grant to the agent app: would grant issues:read ... fees:request on "Appfire Work Suite Tools" ...`). Final lines after `--apply`: the existing `OWNER STEP: add the users who should get the premium tier to the group Software_EnterpriseTier in the PingOne console, then sign out and sign in again in the lab.` stays BYTE-identical, and one NEW line follows: `OWNER STEP: add the users who should get the premium tier of the airline vertical to the group Airline_OrbitTier in the PingOne console, then sign out and sign in again in the lab.` Step `h` prints the four env hints. No secret, id or token is ever printed. The script writes nothing to the lab `.env`.

On the owner's tenant (already done by hand) a dry run reports every scope `present`, both groups `found, reused`, the grant `already granted` and writes nothing.

### 6.3 Docs

- `docs/owner-tools-resource.md`: the table shows eleven scopes (six software, five airline in the order of 4.1), two groups with their env names, the grant "all eleven", and a sentence that exchange 2 still asks ONE scope from this ONE resource so the two packs share a resource and never a token. UNVERIFIED section unchanged plus: that `groups` works for `Airline_OrbitTier` in an exchanged token (same as software).
- `docs/owner-steps.md`: section 1 says eleven scopes and two groups; section 2 optional names gain `AAG_TOOLS_TIER_GROUP_AIRLINE=Airline_OrbitTier`; section 3 gains the airline live steps of section 9 here.
- `README.md` "Real on two providers": the software 19 stay; add the airline list of 3.4 (14 use cases, the two UC22/UC27/UC48 hold-class cases and the rest stay on the lab's own steps), the booking rule lives in the tool server (`lab policy (local), not PingOne Authorize`), the new setting, the fixed-fare statement (the fare is the tool server's own table, never the caller's), and the sentence that a Real decision is observed from the tool server's answer. Fix `README.md:131` (setting list). Do NOT change the airline flights table rows (a test reads them).
- `CLAUDE.md` (Real on two providers paragraph, settings, new test files), `HANDOFF.md` (what shipped, what is unverified), `CHANGELOG.md` (one entry dated 2026-11-17).
- Keep the vocabulary rule: no mock, simulated, engine, UC id on any page; docs may use "the lab's own steps".
- Regenerate `content-pack.json` and `docs/talk-track.md` last (`npm run build`), `git add` them.

---

## 7. Tests

### D.S (builder S), all under `server/test/`; run with `node --test test/*.test.js` style globs, report real counts

1. `fakeToolServer.js`: add the six airline tools to its `SCOPES` map and `payloads`; the booking branch mirrors section 4.3 in a few lines (hold over 1500 with a per-subject challenge, receipt check on `digest`, narrowing, audit header with `CONSTRAINED`); `tierGroupAirline` option (default `Airline_OrbitTier`) gating `sensitive_passenger_record`. `fakePingone.js`: `TOOLS_SCOPES` eleven names in the 4.1 order, `agentGrants` unchanged mechanism, export `TIER_GROUP_AIRLINE`. `localHarness.js` `startRig({ tierGroup, tierGroupAirline })` and config gets both.
2. Hostile-input tests for the booking tool over real HTTP against the REAL tool server (new file `local-airline.test.js`, using `startRig`): token and scope refusals (`flights:read` only, `403 insufficient_scope` with `required_scope: 'flights:book'`); unknown flight (`LK 999`, `lk 214`, `__proto__`, `constructor`, an object, an array, a 10 000-char string): `-32602`, text fixed, request never echoed; bad cabin (`first`, `Business`, `''`, a number): `-32602`; EXTRA FIELDS refused one at a time (`fare`, `amount`, `price`, `international`, `confirmation`, `cabin_booked`, `surprise`): `-32602 invalid arguments: unexpected field` and the answer's `fare_judged` always equals the table's fare; boundary matrix by flight (LK 330 $400 domestic PERMIT, LK 331 $401 CONSTRAINED over-limit, LK 322 $380 international CONSTRAINED because `['international']`, LK 800 $1,100 both because, LK 650 $1,500 CONSTRAINED, LK 651 $1,501 428, LK 704 428), economy asked is PERMIT everywhere under the hold and never carries `constrained`; economy over the hold is still 428; default cabin (omitted) is economy; `cabin_asked`/`cabin_booked`/`constrained.asked`/`granted` consistent; `lab_invented` is the last key and `confirmation` matches `^LKR-[0-9A-F]{6}$`.
   Approval path: 428 body (`error approval_required`, `reason lab-fare-hold`, `by tool server`, `challengeId`, `tool book_airline_flight`, audit `HITL_REQUIRED`); the challenge records `amount: 2400`; approve through `/hitl/challenges/:id/respond`; retry with `_hitl_challenge_id` books `business` with NO `constrained` key (approval beats narrowing, audit `PERMIT` / `lab-fare-approved`); replay of the consumed receipt: `403 hitl_receipt_rejected` reason `receipt_used`; receipt still pending: `receipt_pending`; denied: `receipt_denied`; receipt for ANOTHER subject (token with a different `sub`): `receipt_binding_mismatch`; receipt minted for ANOTHER tool (a `bulk_update_issues` challenge for the same subject) presented on the booking: mismatch; receipt for another flight (LK 704 receipt on LK 651) and for another cabin (business receipt, economy call): mismatch; an invalid control field (`bad id!`): `-32602`; a receipt presented on a call that was NOT held (LK 322 with a valid approved receipt): ignored, still CONSTRAINED, and the receipt is still unspent (it still verifies once on its own tool). Group gate: `sensitive_passenger_record` hidden from `tools/list` and `403 group_required` with `required_group: 'Airline_OrbitTier'` for a token without it; a token holding ONLY the software tier group does not unlock it, and a token holding only `Airline_OrbitTier` does not unlock `get_project_security_settings` (each pack has its own group). `list_airports` with no token works; every other airline tool with no token is `401 no_token`.
3. Parity (`localParity.test.js`, edited): the 16 names/scopes/public/group sets equal between `provider.js` and `registry.js`; `TOOL_PACK` equals `TOOL_META[*].pack` for all 16; `PACK_OF_TOOL_SERVER` covers both cast values; `registry.FARE` deepEquals `policy.js FARE_RULE`; for every flight and cabin the lab engine's `decide({ fareRule: true, role: 'write', tool: 'book_airline_flight', amount: fare, international, cabin })` decision (`PERMIT|CONSTRAINED|HITL_REQUIRED`) equals the tool server's audit decision, and CONSTRAINED `because` equals `constrain.because`; every airline situation with a `trip` (UC6, UC7, UC8, UC14b, UC22, UC27, UC48) has `amount === FLIGHTS[trip.flight].fare`, `international === isInternational(FLIGHTS[trip.flight])` (absent means false), `trip.from`/`trip.to` equal the table's; the README flights are checked by W (D.W3).
4. `realGate` tests (in `real.test.js`): exactly the 14 ids of 3.4 are `real: true, capability: 'tools'` for the airline cast with `{ tools:{se:false,local:true}, setting:'auto' }`; their tools resolve as the 3.4 table; each `real:false` case of 3.4 returns its exact reason string (UC22, UC27, UC48, UC14b, UC14, UC13, UC18, UC30, UC31, UC41, UC42, UC-TOOL1, UC2, UC10, UC34); UC41/UC42/UC-TOOL1 are NOT real for airline and STILL real for software; the software 19 are unchanged; with `setting:'local'` and no local the reason is `AAG_PROVIDER=local is set and the lab's tool server is not running here`; `GATEWAY_LOCAL_ONLY` has the new text; `toolArgs` for all six airline tools equals 3.2 exactly, never contains `fare`/`amount`/`price`, and ignores a `trip` with a non-string flight; `review.airline.test.js:54` changes to `assert.match(g.reason, /tool server/)` for the airline cast with no options (still `doesNotMatch /SE gateway|banking|healthcare|retail/`).
5. `real.test.js` airline walkthrough against the fakes (`withTools` with a `vertical` argument; `fakePingone` tools resource of eleven scopes; `runAir = (url,id,extra) => run(url, id, { vertical: 'airline', ...extra })`): sign in; UC1 `REAL_PERMIT`, exchange 2 asks exactly `scope: 'trips:read'` (no audience, no actor), `delegated.claims.aud === TOOLS_AUDIENCE`; UC7 `REAL_PERMIT`, `run.booking = { flight:'LK 214', from:'ORD', to:'DEN', fare:380, international:false, asked:'business', booked:'business' }`, exchange scope `flights:book`, reply text exactly `Booked: a business seat on LK 214 from ORD to DEN, confirmation LKR-<hex6> (lab-invented data from the lab's own tool server).` (regex for the id); UC8 `REAL_CONSTRAINED`, `run.constrained` keys `{field,asked,granted,because,limit,by,reason}` with `because ['international']`, `by 'lab policy (local), not PingOne Authorize'`, decision hop `{ outcome:'CONSTRAINED', by, basis:'observed' }`, note per 5.4, `run.booking.booked === 'economy'`, reply `Booked in economy, not business: this trip is international. LK 322 from ORD to YYZ, confirmation ...`; the tool call arguments the server saw were exactly `{ flight: 'LK 322', cabin: 'business' }` (no fare field); UC6 `REAL_HOLD` with `challenge`, `booking.booked === null`, `booking.fare === 2400`, the challenge id and secret in no hop; start the phone (`/api/approval/start` `provider: run.provider`), approve, retry with `approvalId`: `REAL_PERMIT`, `booking.booked === 'business'`, no `constrained`, reply starts `Booked as approved:`; a second retry with the same approval id is `REAL_RECEIPT_REJECTED`; a denied approval is `REAL_RECEIPT_REJECTED` (`receipt_denied`); UC9 with groups `[]` `REAL_DENY` (`group_required`, hop note names `Airline_OrbitTier`), with groups `['Airline_OrbitTier']` `REAL_PERMIT`; groups `['Software_EnterpriseTier']` does NOT unlock UC9 airline; UC21 out of the group `REAL_NOT_LISTED` with `groupsClaim: 'present'` and the text naming `Airline_OrbitTier`, claim absent `'absent'`; UC24 NO agent token and NO exchange, the probe is `get_airline_bookings` refused with 401; UC28 `REAL_PERMIT`; UC33 `REAL_PERMIT`; UC22, UC27, UC48, UC41, UC30 run on the lab's own steps with `realGate.reason` as in 3.4; EVERY run above has `fareRule` (4 keys), the booking use cases have `booking`, `run.provider === 'local'`, every provider hop `answeredBy: 'tool server (local)'`; `vocabulary(x)` empty, `findWords` empty, no `checked`, no secret; `gatewayTrace` is `[]`; `fullGw`/gateway never called; a software run in the same server still has no `fareRule`/`booking` key.
6. `localE2E.test.js` (the REAL child process with the fake PingOne's JWKS): add airline UC8 end to end (`REAL_CONSTRAINED`) and UC6 hold, approve, retry (`REAL_PERMIT` booked business). `info.provider.local.tools` becomes 16. `provider.test.js`, `local-process.test.js`, `local-mcp.test.js` (`tools/list` counts with an all-scope token and with no token; `GOOD`/argument tests for the six new tools incl. `lab_invented` last), `local-isolation.test.js` (12 files, the pins of 4.1), `localServices.test.js` (init keys), `settings.test.js` (`PROVIDER_KEYS`, env passing, `.env.example`), `cast.test.js`, `real.test.js` old pins (the tokenless listing count, `GATEWAY_LOCAL_ONLY`) updated.
7. Word scan: `noMockWords.test.js` / `wordScan.js`: run `findWords` over the airline Real runs of item 5 and over the six descriptors (`descriptorOf`) and answers.
8. Unchanged and must stay green: the four old packs' engine runs byte-identical (`node scripts/golden-capture.mjs --check` prints `golden ok`), the software 19, `golden.test.js`, `hosted.test.js`.

### D.W (builder W)

1. `web`: the fixtures and tests of 6.1; `npm test -w web`.
2. `scripts/tools-setup.test.mjs`: `ALL` becomes eleven names (`tools.TOOLS_SCOPES.map(...)`), the fixed-facts test asserts the exact eleven in order and both group names and the four-pair `ENV_HINTS`; dry run prints `scope <n>: would create` for all eleven, `group Software_EnterpriseTier: would create`, `group Airline_OrbitTier: would create` and one `would grant` line listing all eleven; `--apply` on an empty tenant writes in this order and nothing else: `POST /resources`, eleven `POST /resources/r-tools/scopes`, two `POST /resources/r-tools/attributes`, TWO `POST /groups`, one `POST /applications/<agent>/grants`; `state.groups` names are both groups; the grant holds eleven scope ids; the second `--apply` on a finished tenant (resource, eleven scopes, both attributes, both groups, an eleven-scope grant) writes nothing and says `present`/`found, reused`/`already granted`; partial tenant (the six software scopes + software group present, airline absent): only the five scopes, the airline group and the grant top-up (a `PUT`) are written, nothing existing is replaced; the owner-already-did-it tenant (eleven scopes, both groups, grant of eleven): zero writes; no memberships are ever written (no call matching `/members` or `/groupMemberships`); the source-scan test still finds only the four POST sites; output never contains a secret or id; the OWNER STEP lines are both printed after `--apply`; the existing DRIFT and refusal tests stay.
3. `scripts/repo.test.mjs` (new test only): parse the airline table of `README.md` (rows `| LK nnn | ORD to XXX | $n,nnn | yes|no | ... |`), import `FLIGHTS`, `AIRPORTS`, `isInternational` from `../server/src/local/data.js`, and assert the same ids, same `from`/`to`, same fare, and `Intl` column equals `isInternational`. Also assert the README names `AAG_TOOLS_TIER_GROUP_AIRLINE`, `Airline_OrbitTier` and that `docs/owner-steps.md` says eleven scopes.
4. `scripts/e2e.mjs` (run with `E2E_PORT=7826`): update the pins listed in section 8.2, then add the airline Real walkthrough as a block `local-airline` in the `full` instance (the instance that already has the local provider and the fake PingOne): `fullP1.state.tools.groups = []`; pick vertical `airline` (the default; do not select it away); sign in through the dialog; UC1 `REAL_PERMIT` provider `local` with `fullGw.seen.length === 0` and `persona`/`lab-inputs` absent and the sign-in note present; UC7 `REAL_PERMIT` booked business, Decision card `ALLOWED`, five rungs (`risk-strip` has 5 `li`), seat row `business asked, business booked`; UC8 `REAL_CONSTRAINED`, `decision-word` `CONSTRAINED`, the policy row includes `lab policy (local), not PingOne Authorize`, seat row `business asked, economy booked`, the chat chip `Narrowed: business to economy`, rung two marked "this run"; UC6 `REAL_HOLD`, the phone opens with the fare, `approvalStarts` last entry `provider: 'local'`, approve, the retry is `REAL_PERMIT` booked business with the reply starting `Booked as approved:`; UC9 `REAL_DENY` (`group_required`), then `setGroups(['Airline_OrbitTier'])` and UC21 `REAL_PERMIT`; UC24 hops have no `actor-token`; UC22, UC27, UC48 `run.realGate.real === false`, `run.mode === 'mock'`; the word scan `walk(page, ...)` on the Decision card, the Sequence tab and the step detail of the booking hop; no external request (`external` empty); 375px: the five rungs fit (no horizontal scroll). The gateway fake's `seen` stays empty.
5. Everything W runs: `npm test -w web`, `node --test scripts/*.test.mjs`, `npm run build` (content pack and talk track in sync), and the e2e only after the coordinator has merged S (the e2e needs S's server).

---

## 8. Integration (coordinator) and pins that change

### 8.1 Integration order

Merge S and W (disjoint files). Then, locally (the Air is unreachable; the heavy ones flake under load: re-run a failing file alone before calling it a failure):
`npm test -w server` (the docker-live tests bind 7820 to 7822 which other containers hold: they fail locally for that reason only; prove them in a temp copy with ports 7836 to 7839 and restore the file), `npm test -w web`, `node --test scripts/*.test.mjs`, `node scripts/golden-capture.mjs --check` (must say `golden ok`), `npm run build`, `E2E_PORT=7826 npm run e2e`, `scripts/check-no-ai-attribution.sh`, `git add` every new file. Paste real counts.

### 8.2 Existing pins that change (grep, then edit; line numbers are from d06d3ef)

| Pin | File | Owner |
|---|---|---|
| tool counts 10 | `local-isolation.test.js:61`, `local-process.test.js:51`, `local-mcp.test.js:74,86,217`, `localParity.test.js:14`, `provider.test.js:27`, `localE2E.test.js:140` | S |
| registry export list, `TOOL_META` keys/order, `SCOPES`, public/group lists | `local-isolation.test.js:~64-72` | S |
| init keys | `localServices.test.js:26-27` | S |
| `PROVIDER_KEYS`, env and `.env.example` pins | `settings.test.js:117-148` | S |
| exact compose name list | `scripts/compose.test.mjs:73-76` | S |
| airline `realGate` neutral reason | `review.airline.test.js:54` | S |
| `GATEWAY_LOCAL_ONLY` text and the airline cast optional keys | `real.test.js` (~397), `cast.test.js:33` | S |
| tokenless listing count in the UC24 test | `real.test.js` UC24 | S |
| software `serverInfo.title` (if any test reads it: none today) | | S |
| the full instance "airline keeps its persona and inputs, no sign-in note" check | `e2e.mjs:730-732` (airline UC1 now runs Real: persona and inputs absent, note present) | W |
| `/software vertical only\|SE gateway is not set up/` | `e2e.mjs:1007` becomes `/airline and software verticals only\|SE gateway is not set up/` | W |
| comments saying the airline pack has no tool server | `e2e.mjs:875,999,1075`, `cast.js` | W / S |
| `ENV_HINTS`, six scopes, one group, write order, `would grant` | `tools-setup.test.mjs:73-79,123,134,160` | W |

---

## 9. What stays UNVERIFIED, and the owner's live steps

Nothing here was run against PingOne, SE or any live service. The fakes prove the lab's reading, not Ping's behaviour.

UNVERIFIED:
1. That PingOne accepts exchange 2 for each of the five new scopes with no `audience` parameter (the same open point as software, now eleven scopes on one resource).
2. That the `groups` claim appears in an EXCHANGED token and holds `Airline_OrbitTier` (software's same note).
3. That the owner's by-hand tenant objects equal what the script would create (names and scopes were reported by the owner; the script's dry run will show any difference).
4. That `lab policy (local)` narrowing and the 428 hold behave on a real run the way the fakes and the real child process do (the real child, against the fake PingOne's JWKS, is the strongest local evidence, `localE2E.test.js`).
5. Phone approval discharging UC6 on the local approval service in the live lab (proven for software on the same service and for airline only against fakes).
6. The SE-hosted tool server: nothing is deployed; an SE instance that does not serve the airline tools makes the run `REAL_NOT_LISTED` honestly.
7. Product behaviour: that PingOne Authorize can or cannot express "permit, but narrow the cabin" is NOT claimed anywhere; the page says the rule is the lab's.
8. UC22, UC27, UC48, UC14b stay on the lab's own steps: their Real behaviour is not built (CIBA, the forged-claim probe, `hitl-receipt` chains).

Owner's live steps (after merge and redeploy with your env file):
1. `node scripts/owner/pingone-tools-setup.mjs` (dry run): expect every scope, both groups and the grant reported present; nothing to create. Add your premium traveller to `Airline_OrbitTier`; sign out and in.
2. Sign in on the airline vertical. Run Denver (`REAL_PERMIT`, booked business), Toronto (the card says CONSTRAINED, `lab policy (local), not PingOne Authorize`, basis observed, economy booked), Paris (held; approve on the lab phone; the retry books business, "Booked as approved"), the sensitive record out of and in the group (denied, then allowed).
3. Read the delegated token's `groups` claim and the `X-Gw-Audit-Trail` of the Toronto and Paris calls (item 2 above).
4. Confirm the software vertical's live behaviour is unchanged.

---

## 10. Summary of the contracts (for the report)

- Airline cast gets `castToolServer: 'larkspur-air'`; `provider.js` gets 6 tools in `LOCAL_TOOLS`/`TOOL_SCOPES`, `list_airports` public, `sensitive_passenger_record` group-gated, plus `TOOL_PACK` and `PACK_OF_TOOL_SERVER`; `realGate` adds a pack check so UC41/UC42/UC-TOOL1 never run Real for airline; 14 airline use cases run Real; UC22/UC27/UC48/UC14b/UC14/UC30/UC31/UC2.x and the rest keep their merged reasons.
- Tool server: 16 tools, `pack` in every `TOOL_META` row, 11 scopes, `FARE` copy, `FLIGHTS`/`AIRPORTS` (international derived), `book_airline_flight` answers 200 booked / 200 booked+`constrained` / 428 hold / receipt retry books as asked; the fare is never an argument; audit decisions `PERMIT|CONSTRAINED|HITL_REQUIRED`.
- Group gate: `tierGroup` stays software, new optional `tierGroupAirline` (default `Airline_OrbitTier`) in init, `AAG_TOOLS_TIER_GROUP_AIRLINE` setting passed through settings, real.js, compose, `.env.example`.
- Real run: `REAL_CONSTRAINED` (new), `run.fareRule` on every airline Real run, `run.booking` on every booking run, `run.constrained` with `by` and `reason`, reply text from the answer's own fields (no price), decisions `observed`/`inferred`, never `checked`.
- Owner script: five scopes, group `Airline_OrbitTier`, eleven grants, dry run default, idempotent, never touches memberships.
- Ownership: S = server/data/compose/server tests; W = web/owner/docs/e2e/generated content; the two frozen design files are edited by nobody.
