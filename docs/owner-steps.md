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

It makes the resource "Appfire Work Suite Tools" (audience `appfire-work-tools`), its six scopes, the `act` and `groups` attributes, the empty group
`Software_EnterpriseTier` and the agent app's grant. Re-running is safe. An attribute that exists with another value is reported as DRIFT and left alone.
Then add the users who should get the premium tier to `Software_EnterpriseTier` in the console. `docs/owner-tools-resource.md` describes every item.

## 2. The lab's `.env`

Put these in the app's own `.env` beside `docker-compose.yml` (a shell variable is not read on a host run). With the five app names and the environment id already
there, **nothing new is required**: the software vertical runs for real on the lab's own tool server.

```
PINGONE_ENVIRONMENT_ID=<your environment id>
AAG_USER_CLIENT_ID=...  AAG_USER_CLIENT_SECRET=...  AAG_AGENT_CLIENT_ID=...  AAG_AGENT_CLIENT_SECRET=...  AAG_DEMO_USERNAME=...    # as before
```

Optional names, with the values the lab uses when you leave them out:

```
AAG_PROVIDER=auto
AAG_TOOLS_AUDIENCE=appfire-work-tools
AAG_TOOLS_TIER_GROUP=Software_EnterpriseTier
```

- `AAG_PROVIDER`: `auto` (use an SE tool server when `AAG_TOOLS_SE_URL` is set and answers an unauthenticated MCP `initialize` with 200 or 401, otherwise the lab's own), `local` (always the lab's own:
  set this on a standalone machine) or `se`. Chosen once per run.
- `AAG_TOOLS_SE_URL`: leave it unset. Nothing on SE speaks the tool server's wire format yet.
- `AAG_AGENT_GATEWAY_URL`, `AAG_GATEWAY_AUDIENCE`, `AAG_GATEWAY_SCOPE`: now optional as a group. Keep them to run banking, healthcare and retail through the SE
  Agent Gateway; leave all three out on a machine with no SE.

Docker passes these four tool-server names by `${NAME:-}` substitution like the others: after editing `.env`, run `HOST_PORT=5603 docker compose up --build -d` again.
The local tool server runs inside the same container, loopback only, and publishes no port.

## 3. Verify live (in this order)

1. Sign in, run the "Delegated access" use case on the software vertical. Each tool step's detail shows **Answered by: tool server (local)**. The Tokens tab shows
   the exchange-2 token: an RS256 or ES256 JWT, `iss` your environment's `/as` address, `aud` `appfire-work-tools`, `act.sub` the agent's client id, one scope.
2. The group-gated use cases, with your user in and then out of `Software_EnterpriseTier` (sign out and in again after changing it): out of the group the tool is not
   offered and one use case calls it anyway and is refused; in the group both are allowed. This needs the `groups` claim in the exchanged token: UNVERIFIED.
3. The write bands: refused (a lab rule, labelled **lab policy (local), not PingOne Authorize**), held for a second factor, held for a person (approve on the phone, the
   call is retried with the receipt and completes), the token-less probe, the access request, the repository allow-list and the blocked-term refusal.
4. Another machine with only its own PingOne: set `AAG_PROVIDER=local`, no SE names; the software vertical answers locally and the other verticals say the SE gateway
   is not set up.
5. Check the lab's clock against PingOne's (the tool server allows 60 seconds), and `NODE_EXTRA_CA_CERTS` if a proxy inspects TLS.
6. If a group-gated use case says the tool was not offered even for a user in `Software_EnterpriseTier`, read the decision card: it says when the delegated token has no `groups` claim (then the tier cannot be read at all, which is a PingOne attribute problem, not the user's group). Run at most two use cases at once (a third is refused with HTTP 429).

What stays on the lab's own steps is listed in the README ("Real on two providers"). The tool data is invented and says so; a local refusal says nothing about PingOne Authorize.
