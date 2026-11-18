# Owner steps: Real on two providers

Short guide, in order. Agents never run these: they change a real PingOne environment and the lab's `.env`. Nothing in the repository was run against a tenant;
the fakes in the tests prove the lab's reading, not Ping's behaviour, so your live run is the only evidence.

## 1. PingOne: the tools resource

From the repo root (admin credentials come from `~/.config/demo-kit/provisioning.json`; `STANDALONE_CRED_FILE` overrides):

```
node scripts/owner/pingone-real-setup.mjs --apply     # the two apps, once (already done if full Real worked before)
node scripts/owner/pingone-tools-setup.mjs            # dry run: reads PingOne, writes nothing, prints the plan
node scripts/owner/pingone-tools-setup.mjs --apply    # creates what is missing; never edits what exists
```

It makes the resource "Appfire Work Suite Tools" (audience `appfire-work-tools`), its eleven scopes (six software, five airline), the `act` and `groups` attributes, the two empty groups
`Software_EnterpriseTier` and `Airline_OrbitTier` and the agent app's grant of all eleven. Re-running is safe: on a tenant that already holds them all it writes nothing. An attribute that exists with another value is reported as DRIFT and left alone.
Then add the users who should get the premium tier to `Software_EnterpriseTier`, and the premium traveller to `Airline_OrbitTier`, in the console (the script never edits a membership). `docs/owner-tools-resource.md` describes every item.

## 2. The lab's `.env`

Put these in the app's own `.env` beside `docker-compose.yml` (a shell variable is not read on a host run). With the five app names and the environment id already
there, **nothing new is required**: the software and airline verticals run for real on the lab's own tool server.

```
PINGONE_ENVIRONMENT_ID=<your environment id>
AAG_USER_CLIENT_ID=...  AAG_USER_CLIENT_SECRET=...  AAG_AGENT_CLIENT_ID=...  AAG_AGENT_CLIENT_SECRET=...  AAG_DEMO_USERNAME=...    # as before
```

Optional names, with the values the lab uses when you leave them out:

```
AAG_PROVIDER=auto
AAG_TOOLS_AUDIENCE=appfire-work-tools
AAG_TOOLS_TIER_GROUP=Software_EnterpriseTier
AAG_TOOLS_TIER_GROUP_AIRLINE=Airline_OrbitTier
```

- `AAG_PROVIDER`: `auto` (use an SE tool server when `AAG_TOOLS_SE_URL` is set and answers an unauthenticated MCP `initialize` with 200 or 401, otherwise the lab's own), `local` (always the lab's own:
  set this on a standalone machine) or `se`. Chosen once per run.
- `AAG_TOOLS_SE_URL`: leave it unset. Nothing on SE speaks the tool server's wire format yet.
- `AAG_AGENT_GATEWAY_URL`, `AAG_GATEWAY_AUDIENCE`, `AAG_GATEWAY_SCOPE`: now optional as a group. Keep them to run banking, healthcare and retail through the SE
  Agent Gateway; leave all three out on a machine with no SE.

Docker passes these five tool-server names by `${NAME:-}` substitution like the others: after editing `.env`, run `HOST_PORT=5603 docker compose up --build -d` again.
The local tool server runs inside the same container, loopback only, and publishes no port.

## 3. Verify live (in this order)

1. Sign in, run the "Delegated access" use case on the software vertical. Each tool step's detail shows **Answered by: tool server (local)**. The Tokens tab shows
   the exchange-2 token: an RS256 or ES256 JWT, `iss` your environment's `/as` address, `aud` `appfire-work-tools`, `act.sub` the agent's client id, one scope.
2. The group-gated use cases, with your user in and then out of `Software_EnterpriseTier` (sign out and in again after changing it): out of the group the tool is not
   offered and one use case calls it anyway and is refused; in the group both are allowed. This needs the `groups` claim in the exchanged token: UNVERIFIED.
3. The write bands: refused (a lab rule, labelled **lab policy (local), not PingOne Authorize**), held for a second factor, held for a person (approve on the phone, the
   call is retried with the receipt and completes), the token-less probe, the access request, the repository allow-list and the blocked-term refusal.
4. Another machine with only its own PingOne: set `AAG_PROVIDER=local`, no SE names; the software and airline verticals answer locally and the other verticals say the SE gateway
   is not set up.
5. Check the lab's clock against PingOne's (the tool server allows 60 seconds), and `NODE_EXTRA_CA_CERTS` if a proxy inspects TLS.
6. If a group-gated use case says the tool was not offered even for a user in `Software_EnterpriseTier`, read the decision card: it says when the delegated token has no `groups` claim (then the tier cannot be read at all, which is a PingOne attribute problem, not the user's group). Run at most two use cases at once (a third is refused with HTTP 429).

### The airline vertical (Larkspur Air, the default)

Run these after the software checks, with `Airline_OrbitTier` made by the script and empty. The booking rule is the lab's own and the tool server enforces it
from the verified token: a domestic booking up to $400 is allowed as asked; an international booking, or one over $400 up to $1,500, is booked but in economy only;
over $1,500 a person approves. All of it is lab-invented data.

1. Sign in, then run the trip list ("Delegated access"). Each tool step's detail shows **Answered by: tool server (local)**; the exchange-2 token has `aud`
   `appfire-work-tools` and the single scope `trips:read`.
2. Denver ($380, domestic): allowed, booked in business as asked. The exchange-2 token has the scope `flights:book`.
3. Toronto ($380, international): the Decision card says CONSTRAINED with the policy row `lab policy (local), not PingOne Authorize`, the seat row reads
   `business asked, economy booked`, the chat chip says `Narrowed: business to economy`, rung two of five is marked. Open the decision step: the audit header
   `X-Gw-Audit-Trail` reads `CONSTRAINED` (observed, never "checked").
4. Paris ($2,400): held for a person (the tool server answers 428). Approve on the lab phone; the call is retried with the receipt and books business as asked
   ("Booked as approved"). A second retry with the same approval is refused.
5. The traveller's private record, with your user out of `Airline_OrbitTier` (the tool is not offered and one use case calls it anyway and is refused) and then in
   the group (allowed). Sign out and in after changing the group. A user who is only in `Software_EnterpriseTier` does not unlock it.
6. The public airport list with no token (allowed), and the trip list probed with no token (refused with 401).
7. Read the delegated token's `groups` claim and confirm the software vertical's live behaviour is unchanged.

UNVERIFIED until your run (the lab's tests prove only its own reading, against its own fakes and a child process): PingOne's exchange 2 for each of the five new scopes
with no audience; the `groups` claim holding `Airline_OrbitTier` in an exchanged token; a phone approval of the Paris hold on a real run; and every result written above
(the audit header, "Answered by", the refused second retry). Each is what the lab expects to see, not something it has seen. Two things to know when you read the evidence:
the tool list of a software run now also names `list_airports`, and an airline run's names `list_marketplace_apps`, because both packs share one tool server and a public
tool is listed to everyone (nothing else of the other pack is listed or callable without its scope); and on `AAG_PROVIDER=auto` the airline vertical always uses the lab's own tool
server when it is up, because an SE-hosted copy is not known to carry the airline tools (`AAG_PROVIDER=se` still forces SE).

Still on the lab's own steps for the airline: the phone-approval claim (UC22), the second-factor claim over $1,500 (UC27), the over-$400 constrained walkthrough
(UC48), the attacks, the agent-to-agent steps, the weather and news tools, and every use case that calls no tool.

What stays on the lab's own steps is listed in the README ("Real on two providers"). The tool data is invented and says so; a local refusal says nothing about PingOne Authorize.

## 4. PingOne Authorize decides the airline booking (optional)

Run this only after section 3 works. It is optional: with the three names below absent, the lab's own fare rule decides the booking and the page says `lab policy (local), not PingOne Authorize`, exactly as before.
The policy "Larkspur Air Booking Authorization" and its decision endpoint "Larkspur Air Booking" ("Use latest") are already published in your shared PingOne Authorize tree; this lab does not create, import or
edit any policy (a regenerated import file is a separate task and must keep the contract in `docs/design-authorize-lab.md` section G.3). Nothing below has been run against your tenant by an agent: the tests use fakes.

1. **A worker app for the lab.** In the PingOne console create a dedicated WORKER-type application (never the sign-in app or the agent app) and note its client id and secret. Give it only the permission the
   decision endpoint needs: the documented `authz:authorize:decisionendpoint` permission, through a custom role if the console allows it. What you measured: the decision API accepted the worker token while the same app held
   Environment Admin; the least-privilege custom role is UNVERIFIED. It matters because the secret sits in the lab's `.env` and its container, and Environment Admin lets anyone who holds it administer the whole environment.
2. **Three names in the lab's own `.env`** (a shell variable is not read on a host run; all three or none, a partial set is reported by `npm run doctor` and Authorize stays off):

   ```
   AAG_AUTHORIZE_ENDPOINT_ID=<the decision endpoint "Larkspur Air Booking">
   AAG_AUTHORIZE_CLIENT_ID=<the worker app's client id>
   AAG_AUTHORIZE_CLIENT_SECRET=<the worker app's secret>
   ```

   The environment id and the region come from `PINGONE_ENVIRONMENT_ID` and `PINGONE_REGION` already in the file. The secret is write-only: the lab never returns, logs or shows it, and only the lab's server process
   holds it (the tool server never does). Docker passes the three names by `${NAME:-}` substitution like the others.
3. **Probe the endpoint before the lab uses it.** From the repo root:

   ```
   node scripts/owner/authorize-probe.mjs                          # dry run: prints what it would call, sends nothing
   node scripts/owner/authorize-probe.mjs --run                    # 21 rows, 1.2 s apart, decision calls only
   node scripts/owner/authorize-probe.mjs --run --record ~/authorize-probe-answers   # also saves the raw answers (a folder OUTSIDE any git repository)
   ```

   Read the table: every row must say PASS (the Larkspur rows 1 to 13 each name exactly one of the policy's codes; rows 14 to 19 must name none; rows 20 and 21 show the engine reads `True` as true and `maybe` as false, which is
   why the lab always sends exactly `true` or `false`). A row that says NOTE (the tool-name row is an assumption) is for you to read, not a failure. The first narrowing row's statements are printed once so you can see what a
   statement really holds. Exit 0 all passed, 1 a row failed, 2 it refused to start (a name is missing, or the record folder is inside a repository), 3 it could not finish (unreachable, the credential was refused, or the
   endpoint kept rate limiting). The probe sends only the lab's seven parameters (never the shared `Amount`, `DecisionContext` or `ActClientId`) and never prints the secret, the token or a full endpoint id. Every call appears
   in the endpoint's "recent decisions" list.
4. **Recreate the container** so it reads the new names: `HOST_PORT=5603 docker compose up --build -d`.
5. **Live checks, in this order.**
   - Denver: ALLOWED, and the Decision card's policy row reads `PingOne Authorize (policy Larkspur Air Booking Authorization) returned PERMIT with the statement airline-permit-as-asked; the lab read that as book as asked and applied it`.
   - Toronto: CONSTRAINED, economy booked, the policy row says `returned PERMIT with the statement airline-economy-intl; the lab read that as economy only and applied it` (PingOne Authorize returns PERMIT and a statement; CONSTRAINED is the lab's word for what it does with that statement, and the narrowing reason names the code's cause, never a dollar figure); open the decision step and read the raw request (the seven parameters; the bearer line says
     `Bearer (worker token, not shown)`) and the raw answer.
   - Paris: held for a person; approve on the lab phone (the approval itself runs on the lab's own approval service, not in PingOne Authorize); the retry books business as asked.
   - Break the secret on purpose once (or stop the endpoint): the Decision card says NO DECISION with the reason, nothing is booked, and nothing says ALLOWED, DENIED or ESCALATED. The lab does not use its own rule instead.
   - Remove the three names, recreate the container: the same runs say `lab policy (local), not PingOne Authorize` again.
6. **The pictures.** The Diagram page shows the node `PingOne Authorize (P1AZ)` and the new node `Lab tool server (own tools, local)` with a solid arrow to it; the Sequence shows a lane `PingOne Authorize (P1AZ)` on a
   booking PingOne Authorize decided (and on a run an SE gateway answered). A booking the lab's own rule decided draws no booking decision on a PingOne Authorize lane from the tool server; an airline run that stays on the lab's own steps still draws the generic lane, named plainly `Authorize`, and its card says the decision is the lab's own rule. The banking, healthcare and retail runs through the SE gateway look as before apart from the lane name.
7. **Partial or unusable settings.** If only some of the three `AAG_AUTHORIZE_*` names are set, the booking runs on the lab's own rule and its decision line says the PingOne Authorize settings are incomplete, so it was not asked; the doctor names the missing one. If the lab's tool server is not running, the airline booking stays on the lab's own steps and the reason says PingOne Authorize is set up but not asked. The reader ignores statements with no string code and every code that is not an `airline-` code of the lab's; an `airline-` code it does not know (a later policy edit) is a NO DECISION on purpose (fail closed).

UNVERIFIED until your run (the lab's tests prove only its own reading, against its own fake decision endpoint): the content of the real statements' payloads (the lab reads the code and never depends on a payload; the probe
prints what one holds); that `airline-second-factor-required` and `airline-booking-refused` come back for the inputs you expect (the lab never sends one: its inputs cannot produce them, so the probe does not ask); that a
least-privilege role works; that your endpoint's rate limit allows the lab's pace (it asks at most once per 1.1 s and retries a 429 once after 1.5 s); that a later edit of a limit in the console is picked up on the next booking
(the endpoint is "Use latest": the lab shows the code it gets and applies the narrowing the code names; the limit it displays stays its own `FARE_RULE` until it is edited there); and that the `ToolName` parameter is part of
the policy's gate. The numbers stay LAB-INVENTED.

### Sign-in: "Forgot password?" and "Choose a new password" (UNVERIFIED against your tenant)

The Sign in dialog drives PingOne's own password actions over pi.flow (no redirect). Check once on your tenant:

0. **Forgot password?** is shown only when PingOne's sign-on policy for the user app offers recovery (the flow carries a `password.forgot` link). A tenant with no recovery or reset shows no link.
1. Click **Forgot password?**. PingOne must accept the lab's username (`AAG_DEMO_USERNAME`) and the dialog switches to the recovery step. The PingOne user needs an email address, a password and a working email service; otherwise the dialog says PingOne could not start the recovery.
2. Click **Email me a code**. PingOne sends an 8-character code that lasts 5 minutes (at most one every 20 seconds). Whether PingOne already emails a code at step 1 is not known; if one arrives, use it.
3. Type the code and a new password twice, then **Set the password and sign in**. The lab never stores or shows either. UNVERIFIED: the state PingOne returns after a successful recovery (the lab handles `COMPLETED`, a plain sign-in step and a forced change; anything else, such as MFA, gets the "this lab does not drive" message).
4. A temporary or expired password: set one in the PingOne console with "force change at next sign-in", sign in, and the dialog asks for the current and a new password.

To keep a demo user ordinary, set a permanent password in the console (do not force a change).

### Opening the lab by a name instead of 127.0.0.1

The lab answers to loopback names and to the names in `LAB_ALLOWED_HOSTS` (the lab's own `.env`, comma separated). To use a name such as `lab.example` (any valid host name that points at this Mac): add `127.0.0.1 lab.example` to `/etc/hosts` (needs sudo), add the name to `LAB_ALLOWED_HOSTS`, recreate the container (`docker compose up -d`), and open `http://lab.example:7814/`. The Docker port stays published on this Mac only, and `127.0.0.1` keeps working. The PingOne sign-in is unaffected: it is pi.flow, the redirect URI is only a parameter and the page is never redirected.

