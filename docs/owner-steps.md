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
