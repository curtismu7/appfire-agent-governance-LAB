# The PingOne tools resource (owner reference)

The software and airline verticals run for real on the lab's own tool server. That server never makes or signs a token: it validates the access token your own PingOne
issued, against that PingOne's signing keys. This page says what the PingOne side must hold. `node scripts/owner/pingone-tools-setup.mjs` makes every item below
that is missing and changes nothing that exists (a dry run by default; add `--apply`). Nothing here is tied to one tenant: the values are fixed names. The airline's booking rule is the lab's own and lives in the tool server (`lab policy (local), not PingOne Authorize`); PingOne holds no airline policy and nothing in this list expresses one.

## What PingOne holds

| Item | Value |
|---|---|
| Resource | `Appfire Work Suite Tools`, a custom resource |
| Audience | `appfire-work-tools` (the lab's `AAG_TOOLS_AUDIENCE`; the tool server requires it in the token's `aud`) |
| Scopes | eleven. Software: `issues:read`, `issues:write`, `security:read`, `release:read`, `deploy:read`, `admin:request`. Airline: `trips:read`, `flights:read`, `flights:book`, `travellers:read`, `fees:request` |
| Attribute `act` | the subject token's `act`, passed through, so the delegated token keeps the agent in `act.sub` (the same pass-through the gateway resource uses) |
| Attribute `groups` | the user's group names (`memberOfGroupNames`), which the tool server compares with the tier group |
| Groups | two, each the premium tier of its vertical. `Software_EnterpriseTier` (the lab's `AAG_TOOLS_TIER_GROUP`) and `Airline_OrbitTier` (the lab's `AAG_TOOLS_TIER_GROUP_AIRLINE`). The script creates each empty; adding a user is yours, and it never edits a membership |
| Grant | the lab's agent app ("Appfire Agent Governance LAB Agent") holds all eleven scopes on this one resource |
| Access tokens | signed JWTs (RS256 or ES256) with a `kid` found in the issuer's JWKS; the tool server accepts nothing else |

## Exchange 2 and why there is one resource

The lab does two token exchanges at PingOne. Exchange 1 (the user's token, the agent as actor, the agent scope) stamps `act`. Exchange 2 (the exchange-1 token as
subject, no actor, no `audience` parameter) asks for **one** tool scope from **this** resource: PingOne refuses a request that names scopes from two resources.
The resource picks the audience and passes `act` through. The two verticals share this one resource and never a token: each call asks for the one scope its tool needs (the airline booking asks for `flights:book`, a trip list for `trips:read`). The tool server then checks, in order: signature (the algorithm is RS256 or ES256, never `none` or
HS*, the key comes from the issuer's discovery document and JWKS, never from the token), `iss`, `aud`, `exp` and `nbf` with 60 seconds of skew, `sub`, `act.sub`
(it must be the agent app's client id), then the scope for the tool, then the group for a group-gated tool (the software tier group for a software tool, `Airline_OrbitTier` for the airline's private traveller record).

## UNVERIFIED (the owner's live run is the only evidence)

- The `groups` expression the script posts is `${user.memberOfGroupNames}`. That the `groups` claim appears in an **exchanged** token has not been seen (only a
  client-credentials token was checked). If the claim is absent, the lab says so ("groups claim: ABSENT") and the tier use cases cannot show the premium path.
- That the `groups` claim holds `Airline_OrbitTier` in an exchanged token (the same open point as the software group).
- PingOne accepting exchange 2 for a single tool scope with no `audience` parameter, now for each of the eleven scopes.
- That the objects you made by hand equal what the script would make: run its dry run and it reports any difference (an existing object is never edited).
- The discovery document's `issuer` and `jwks_uri`, and the shape of the `scope` claim in an access token (a string or a list: the tool server accepts both).
- PingFederate is design only: the verifier does not care which issuer it is, but there is no PingFederate sign-in or exchange in this lab.
