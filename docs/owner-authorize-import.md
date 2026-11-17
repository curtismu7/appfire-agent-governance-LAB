# Owner procedure: the Larkspur Air booking rule in PingOne Authorize

The airline booking rule can be decided by PingOne Authorize instead of the lab. This page is how you load that rule into your Authorize environment
without changing what the other demos see. Agents never run the console steps: they change a real tenant. Nothing in the repository was run against a
tenant, and the console's import has not been exercised with this file (see "What only your console can settle").

The rule is the lab's own, with the lab's own numbers (LAB-INVENTED, `FARE_RULE` in `server/src/policy.js`): a domestic booking up to $400 is allowed as
asked; an international booking, or one over $400 and up to $1,500, is booked with the cabin narrowed from business to economy; over $1,500 a person
approves. The generator reads those numbers from `policy.js`; none is written in it.

## What the file is

`~/Downloads/export-p1az-larkspur-air.snapshot` is **your export plus only our objects**. Every byte of every object that is not ours is the same
characters as in your export (the generator splices text; it never re-writes yours). There is **no new policy set** and no second root: a second root in
the shared tree is the one shape known to go wrong. Our policy is added as one more **child of your existing root policy set** (the only `PolicySet` in your export; the build prints its name, and it is called "the root" below).

So exactly **one** existing element changes: the root policy set, by (1) one child appended (our policy) and (2) a new `version` (an unchanged version
makes an import silently skip the object). Everything else in your export is identical.

Ours are 36 objects, each with a fixed id and a name that starts with `Air` (attributes) or `Larkspur Air` (everything else):

| Type | Count | Names |
| --- | --- | --- |
| Attribute | 5 | `AirLabMarker`, `AirFare`, `AirIsInternational`, `AirCabinAsked`, `AirApproval` (request attributes the lab sends) |
| Condition | 12 | `Larkspur Air - Is A Booking Request`, `... Cabin Known`, `... Request Complete`, `... Fare Over Hold`, `... Fare Over Limit`, `... Route International`, `... Business Asked`, `... Narrowable`, `... Approval None`, `... Approval Verified`, `... Approval Claimed`, `... Approval Denied` |
| Statement | 9 | `Larkspur Air Stmt - Permit As Asked`, `... Economy Only International`, `... Economy Only Over Limit`, `... Economy Only Both Reasons`, `... Approval Required`, `... Approved As Asked`, `... Second Factor Required`, `... Booking Refused`, and the catch-all's `... Unmatched` (code `airline-unmatched`) |
| Rule | 9 | `Larkspur Air - <the same eight names>`, one rule per statement, then `Larkspur Air - Unmatched`, the catch-all permit, listed LAST (statements carry `Stmt` in their prefix so no statement shares a name with a rule) |
| Policy | 1 | `Larkspur Air Booking Authorization` |

Differences from the design review, so nobody searches the console for the wrong thing: the design called the objects `Lab Airline - ...`; they are
`Larkspur Air ...` here so the generator can find its own objects by prefix. The audit-only attributes (flight, actor, request id) and the design's
`Route Known` and `Route Domestic` conditions are not created (nothing reads them: a boolean is always known, and domestic is `not(international)`). The
three narrowing outcomes are named by reason (`International`, `Over Limit`, `Both Reasons`), and every name is 46 characters or fewer (the longest name
in your export is 47).

Why other demos are not affected:

* **The policy applies only to the lab.** Its condition requires the new attribute `AirLabMarker` to equal `larkspur-air` AND `ToolName` to equal
  `book_airline_flight` (and a known `UserId`, and a fare that resolved). No other demo sends the marker, so for every other request our policy is *not
  applicable* and contributes nothing: same decision, same statements.
* **The fare fails closed.** It is a new attribute, `AirFare`, default `0`, and every rule needs `AirFare > 0` (the same shape as the shared `Amount`: default `0`, `GreaterThan 0`; a fare of 0 is not a booking). The shared `Amount` is not used. A
  request that omits the fare, sends nonsense, omits the cabin or the user matches no rule.
* **Foreign requests still match nothing.** The catch-all (below) lives INSIDE our policy, behind the same gate (marker, tool, known user, fare above 0). A
  request without the marker, with another tool, with no user or with no fare finds the whole policy not applicable, so the catch-all does not fire
  either. The proof (`--check`, 184,968 evaluations of requests without the marker) says the root answers them exactly as before.
* **Fail-safe defaults.** Every attribute our conditions read has a `defaultValue`, ours (`AirLabMarker` empty, `AirFare` `0`, `AirIsInternational` `false`,
  `AirCabinAsked` empty, `AirApproval` `none`) and the two shared ones we read (`ToolName` and `UserId`, both `none` in your export). Without a default an
  omitted attribute makes the decision INDETERMINATE instead of a clean answer. The generator enforces it: it refuses to build, and `--check` fails, if any
  attribute our conditions read has no default, whoever owns the attribute.
* We read only two existing attributes, by id, and never change them: `ToolName` and `UserId`. (`Amount`, `ActClientId` and `HitlApproved` must exist in
  your export, the generator checks, but our rules do not read them.)
* The eight outcome rules are disjoint, so at most one SPECIFIC outcome statement comes back. The ninth rule is the catch-all (next section).

## The catch-all rule (read this before the lab reads a decision)

The import skill requires exactly one catch-all permit rule per policy, listed last, so nothing falls through unresolved. Ours is `Larkspur Air - Unmatched`:
condition empty (always true), effect `unconditionalPermit`, statement `Larkspur Air Stmt - Unmatched` with code `airline-unmatched` (PERMIT, applies if
PATH_MATCHES, not obligatory, a flat static payload `{"outcome":"unmatched"}`, no hold words in the code).

**What that means for the answer.** The catch-all fires on EVERY request that passes our policy's gate (marker, tool, user, fare), so `airline-unmatched` appears
NEXT TO the specific outcome code on every permit:

* `airline-permit-as-asked`, `airline-economy-*`, `airline-approval-required`, `airline-approved-as-asked`, `airline-second-factor-required`: the decision is
  PERMIT and the statements are the specific code plus `airline-unmatched`.
* `airline-booking-refused` is a DENY (DenyOverrides): the answer carries only that code. The catch-all's statement is a PERMIT statement, so it is not
  returned with a DENY.
* A request that passes the gate but matches NO outcome (an unknown cabin, a missing cabin, an unknown `AirApproval` value at ANY fare): the
  decision is PERMIT and the only statement is `airline-unmatched`.

**The reader contract.** The lab decides ONLY from the specific outcome codes (the eight in the table below). It ignores `airline-unmatched` when a specific
code is present. A decision that carries only `airline-unmatched` (no specific outcome code) means **no outcome matched**: the lab treats it as **no decision**
and NEVER as a permit, even though the engine's decision word is PERMIT. The lab's reader is therefore: take the statements whose code starts `airline-`,
drop `airline-unmatched`, and require exactly one left; zero left (with or without `airline-unmatched`) is "no decision"; two or more is "no decision" too.

The reader, step by step (the lab-side reader and the probe script both follow it; there is no other path to a booking):

1. The decision word must be `PERMIT` or `DENY`. `INDETERMINATE`, `NOT_APPLICABLE`, a `status.code` other than `OKAY`, or any other word: **no decision**
   (statements ride only on PERMIT and DENY anyway).
2. From the statements, keep those whose code starts `airline-`. Statements from the shared policies (`transaction-approved`, `HITL_CONSENT`, any code without the
   `airline-` prefix) are ignored: they never decide, and they are never an error.
3. Drop `airline-unmatched`. It is never an outcome, it only marks that our policy's gate passed.
4. Exactly one statement must be left, and its code must be one of the eight specific outcome codes in the table below (exact, case-sensitive match). Zero left,
   two or more left, or one left that is not one of the eight (a code this file does not generate): **no decision**. An extra specific code beside the expected one
   is never "pick the first" and never "pick the most permissive".
5. The decision word must agree with the code: `airline-booking-refused` only with `DENY`, the other seven only with `PERMIT`. A disagreement (a `PERMIT` carrying
   the refusal code, a `DENY` carrying a permit code, or a `DENY` with no `airline-` code at all, which is another policy's refusal): **no decision**.
6. The payload is evidence only. A payload that contradicts its code: **no decision**.

"No decision" shows as "no decision", never books, never "denied" and never "allowed". The lab never falls back to its own rule when this reader says no decision.

## The master file

You said nobody else edits the policies and I build the export file, so the file is the **living master**; a fresh re-export before every build is not
needed:

* **First build:** the base is your original export, `~/Downloads/export-p1az.snapshot`. Keep that file untouched: it is also your rollback.
* **Every later build:** the base is the last build. The generator finds our objects by their fixed ids and name prefixes and replaces exactly those with
  freshly generated ones (a rule that changes gets a new version, one that does not keeps its version), adds new ones and removes any of ours it no
  longer generates. Building twice from the same input gives the same bytes; building from your original or from our last build gives the same result.

**One caution, said once:** if anyone ever edits the policies in the console, export again and build from THAT export. A build from an older master would
re-import the older policies (an older snapshot once dropped an accepted audience and denied every agent call).

## The overlay: one master file, not two

An import replaces the whole tree, so whichever file you import last wins entirely. Two files that both claim to be "the" policy therefore compete: you
imported the AI-DEMO2 generator's snapshot at some point, and the tenant (and your 17 November export) still does not hold its one real change. That change
is not in the tenant (how it got lost is not known here; a later import of a file without it would do it). To stop that, the generator can fold the change into THIS master with an explicit,
allow-listed overlay:

```sh
node scripts/owner/build-authorize-import.mjs --base ~/Downloads/export-p1az.snapshot --update-from <the AI-DEMO2 snapshot> --out ~/Downloads/export-p1az-larkspur-air.snapshot
```

The build order is: **your original export, then the overlay, then ours.** What the overlay does, and does not do:

* **Two objects only**, named in `OVERLAY_ALLOW` in the script: the condition `HasValidMcpAudience` (it gains one branch, the Muse Privilege MCP audience, so
  it has 8 OR branches instead of 7, and a new description) and the statement `MCP Denied — Invalid Audience` (a new `payload`: the Muse audience is added to the accepted-audience list in two places, the readable sentence and the list field; the placeholders are unchanged). Each is matched by type,
  **id and name** in both files. Nothing else in the update is read, whatever else differs (the retyped `0` versus `"0"`, `True` versus `"true"` values and
  the eight airline rule objects with other ids are all ignored, and your tenant's versions of those stay).
* **String splice.** The update's element text replaces the base's element text; no other element is re-serialised. The id is the base's (they match),
  the `version` is the update's, and it must differ from the base's (an import skips an object whose version is unchanged), or the build refuses.
* **The guard.** Before splicing, the generator compares the update's element with the base's, ignoring `version` and key order. Only `description` and the
  OR-branch list (the condition), or `payload` (the statement) may differ, and the branch list may only gain exactly one Equals comparison of an attribute
  the existing branches already read, with every existing branch unchanged (the new one may sit anywhere in the list). Any other difference refuses the
  build with the paths named (never the values), so a drifting update cannot drag other changes in. It also refuses when an allow-listed object is missing,
  appears twice, or has another id or name in either file.
* **Repeatable.** Building from its own output with the same update changes nothing (the base already carries the update's text: "overlay: nothing to take").
* **After the overlay, only three non-ours elements differ from your original:** `HasValidMcpAudience`, `MCP Denied — Invalid Audience` and the root `AI Demo
  Policies`. `--check` fails if anything else differs, prints the overlay objects with their old and new version prefixes, and proves that the audience the
  update adds makes `HasValidMcpAudience` true in the output and not in the input (the value itself is not printed).

**Rollback, and what `--strip` restores.** The file does not store your original, so `--strip` cannot know the old text of the two overlay objects. Decision:

* `--strip <built file> --out <file>` takes ours out and restores the root, and **leaves the two overlay objects as the file has them** (the base as the
  build saw it, with the Muse change). It says so.
* `--strip <built file> --out <file> --base-original ~/Downloads/export-p1az.snapshot` restores the overlay objects from that original too and gives your
  **original export back byte for byte**. It refuses, and writes nothing, if the result is not exactly that original (the file was built from something
  else).

**Recommendation (not done here): the AI-DEMO2 repo's own snapshot should from now on be regenerated FROM this master, or retired, so two files never
compete.**

## Procedure

1. **Build.** Reads `FARE_RULE`, refuses on a bad base, verifies itself after writing:

   ```sh
   node scripts/owner/build-authorize-import.mjs --base ~/Downloads/export-p1az.snapshot --out ~/Downloads/export-p1az-larkspur-air.snapshot
   ```

   To carry the Muse update at the same time, add `--update-from <the AI-DEMO2 snapshot>` (see "The overlay"). Then it prints the same line with `3 shared
   objects changed: the root PolicySet "<its name>" and the overlay` and `overlay: taken from the update: "HasValidMcpAudience", "MCP Denied — Invalid Audience"`;
   on a rebuild from its own output with the same update it prints `overlay: nothing to take`.

   For a later build use the last build as `--base` and a NEW file name for `--out` (the script refuses to overwrite its own base):

   ```sh
   node scripts/owner/build-authorize-import.mjs --base ~/Downloads/export-p1az-larkspur-air.snapshot --out ~/Downloads/export-p1az-larkspur-air-2.snapshot
   ```

   It prints `N added, M updated, K removed (all ours), ... exactly 1 non-ours changed: the root PolicySet "<its name>" (one child appended, version
   changed)` (after a rebuild from a previous build: `no non-ours element changed`, or the root's version changes if our policy's content did). It
   refuses, and writes nothing, when the base is not a version 2 snapshot, is not complete (an id that points at nothing), has a non-ours object that takes
   one of our names or ids, has no single root policy set, or lacks one of the five attributes above.

2. **Check** the file you are about to import (this also ran at the end of step 1; run it on the exact file):

   ```sh
   node scripts/owner/build-authorize-import.mjs --check ~/Downloads/export-p1az-larkspur-air.snapshot --base ~/Downloads/export-p1az.snapshot --update-from <the AI-DEMO2 snapshot>
   ```

   (Without `--update-from` the check cannot know the overlay is allowed and fails on the two changed shared objects; without `--base` it only proves the
   two objects are exactly the update's.)

   Expect `ALL CHECKS PASSED`. It prints the object table, our objects with their ids, and the evaluation table (every flight in the README through our
   policy against the lab's own rule).

3. **See the difference yourself** (one line; with the overlay expect `3` removed lines, the root and the two overlay objects, and `39` added, our 36 plus
   those three; without the overlay `1` and `37`):

   ```sh
   diff <(perl -pe 's/\},(?=\{"(?:objectType|type|\@class)"|\{"id":"[0-9a-f-]{36}","version")/},\n/g' ~/Downloads/export-p1az.snapshot) <(perl -pe 's/\},(?=\{"(?:objectType|type|\@class)"|\{"id":"[0-9a-f-]{36}","version")/},\n/g' ~/Downloads/export-p1az-larkspur-air.snapshot) | grep -cE '^[<>]'
   ```

   (42 in total with the overlay; 38 without it.) To take ours out again: `node scripts/owner/build-authorize-import.mjs --strip <built file> --out <file>`; add
   `--base-original ~/Downloads/export-p1az.snapshot` to get your original back byte for byte when the overlay was used.

4. **Import** the built file in the console. Read the dialog (next section) before you confirm, and import only
   `export-p1az-larkspur-air.snapshot`: your Downloads folder also holds an older export, `p1az-export.snapshot`, and importing an older snapshot once
   dropped an accepted audience and denied every agent call. After the import, open the policy tree: the root shows four children, the last is
   `Larkspur Air Booking Authorization` with its 9 rules, the last being `Larkspur Air - Unmatched`. The Trust Framework shows 5 `Air...` attributes and 12 `Larkspur Air - ...` conditions.

5. **Run the console's policy test** (free, no endpoint) with the lab's parameters: `ToolName` `book_airline_flight`, `UserId` any, `AirLabMarker`
   `larkspur-air`, `AirFare` `380`, `AirIsInternational` `true`, `AirCabinAsked` `business`, `AirApproval` `none`. Expect the statements
   `airline-economy-intl` and `airline-unmatched` (plus a shared one, see below). Then `AirFare` `99` (expect `airline-permit-as-asked` and `airline-unmatched`), `1000` (`airline-economy-over-limit`),
   `999` with `AirIsInternational` `false` (`airline-economy-over-limit`): these catch a text-versus-number comparison. Then `AirCabinAsked` `first`: expect `airline-unmatched` ALONE (no outcome matched). Then `AirApproval` `maybe` at fare `380` and at `2400`: expect `airline-unmatched` ALONE both times. Then leave `AirFare` out, and try `AirFare` `0`: expect no
   `airline-` statement at all, the catch-all included, both times (this is the fail-closed default; if the console refuses the default `0`, tell me). Then add a stray `Amount` `380` to the first case:
   the specific `airline-` code must still be there. Then send `AirFare` `abc` with **no** `AirLabMarker`: nothing may change for it (the other demos never send our
   attributes). Then send `AirFare` `abc` WITH the marker (and `AirFare` `1e3`, and `AirIsInternational` `True` or `yes` on a `380` business request): note what the engine answers; my evaluator
   gives INDETERMINATE for these (no decision), a lenient engine may read `yes` as false and book the `380` business request as asked. The lab must therefore send exactly `true` or `false`
   and treat INDETERMINATE, or any word other than PERMIT/DENY, as no decision. If a boolean must be sent as `true`/`false` rather than text, note which the test tool accepts.

6. **Decision endpoint.** This is the only manual console object. Point a **new** decision endpoint at the root policy set (it is the only
   root; our policy is inside it, there is no separate `Larkspur Air Policies` set). A new endpoint is recommended so the lab has its own id and nothing
   about the endpoints the other demos use is touched; using the existing endpoint also works, because our policy is inert for them. Then **deploy** the
   version so the endpoint serves the imported tree (a deploy publishes the whole tree; for the other demos the only difference is our inert policy).
   Copy back **the endpoint id (the UUID)**. Never a secret or a token. It goes into the lab's settings as the Authorize endpoint (`AAG_AUTHORIZE_ENDPOINT_ID`
   in the design).

7. **Probe** (read only decisions) with the table below, then run Denver, Toronto and Paris in the lab. The probe judges each row with the same reader as the lab
   (see "The reader contract"): a row passes only when the reader returns the row's one specific code (or "no decision" for the rows that say so), never because the
   decision word is PERMIT, and never because `airline-unmatched` is present. A row whose expected answer is "no decision" fails if the reader returns a code.

## Import with the overlay: what the console should show

Imported over your tenant as it is now (your original export plus nothing of ours), the file with the overlay should list:

* **New (36):** our 5 attributes, 12 conditions, 9 statements, 9 rules and the policy `Larkspur Air Booking Authorization`.
* **Changed (3):** `HasValidMcpAudience`, `MCP Denied — Invalid Audience` and the root policy set `AI Demo Policies` (one child more, a new version). These are the
  only objects of yours that change. If the dialog shows any other changed object, stop and tell me.
* **Unchanged:** every other object of yours, with the same text and version as in your export.

Over the previous Larkspur Air build (36 of ours already there, no overlay) the tally is **2 changed shared objects** (the two overlay objects) and nothing
else: our 36 and the root keep their text and versions. After the import a decision request for the Muse audience passes `HasValidMcpAudience` instead of
being denied as `mcp-invalid-audience`. That is what the generator's evaluator proves about the file; only a live call proves it on the tenant.

## Re-import: you already imported the previous version

> This section is history. The current expectation is in "Import with the overlay: what the console should show" above.

You imported the previous build (34 of ours, no catch-all). This build adds the catch-all, the fail-safe check and the known-approval requirement, and nothing else. Build it from your
original export or from the previous build: the bytes are the same either way. When you import it, the console should show:

* **New (2):** the rule `Larkspur Air - Unmatched` and the statement `Larkspur Air Stmt - Unmatched`.
* **Changed (3):** the condition `Larkspur Air - Request Complete` (it now also requires a known `AirApproval` value, so a malformed approval matches no outcome at
  any fare; the rules reference it by id, so the rules keep their versions), our policy `Larkspur Air Booking Authorization` (it gains the new rule as its ninth and last child, so its version changes) and the root
  policy set `AI Demo Policies` (its version follows our policy's version; its children are the same). The root is the only non-ours object that changes,
  as in the first import.
* **Unchanged:** the other 32 of our objects (5 attributes, 11 conditions, 8 statements, 8 rules) and every object of yours keep the same text and the
  same version, so the console should list them as unchanged or skip them.

The tally: 2 new, 3 changed (that condition, the policy, the root), everything else unchanged. If the dialog shows any other changed object, stop and tell me. In a merge the root conflicts again (its version differs from the one in your branch):
choose the snapshot's version, as the first time. After the import the policy tree shows our policy with 9 rules, the last `Larkspur Air - Unmatched`.
Update the lab's reader first or together with this import (it must drop `airline-unmatched`, see the catch-all section): a reader that still expects
exactly one `airline-` code would call every decision ambiguous.

## The import dialog: new branch, merge or replace

I cannot see your console's dialog; read it. The public docs I could reach describe the **PingAuthorize policy editor** (the same editor family), not a
PingOne Authorize page, so what follows is documented for the editor and **unverified in your console**:

* **Import snapshot** creates a **new branch** under a name you give. Safe for this file (it holds every object of your export, same bytes, same
  versions, plus ours). The branch you deploy to the decision endpoint must be the new one.
* **Merge snapshot** adds or updates entities in the **current** branch and decides by **version**: an entity whose version in the branch differs from
  the snapshot's is a **conflict** and you pick keep local or overwrite. For this file expect **exactly one conflict: the root policy set** (our child and
  its new version). **Choose the snapshot's version (overwrite) for it.** If you keep local, our 36 objects arrive but the root never lists our policy,
  so the lab sees no `airline-` code. **Any other conflict means the console changed since your export: stop**, export again and build from that export.
* A mode that **replaces** the working tree with the file is also safe: nothing is lost (the completeness check below proves every id referenced in your
  export resolves inside the file, and the output keeps all 172 of your elements). If the tree it replaces is newer than your export (someone edited it
  since), STOP: export again and build from that export.
* Not documented anywhere I found: what happens to objects absent from the file, whether any mode deletes, whether an older version can overwrite a newer one. This
  file is safe either way (everything is in it), and the first import will show which it is.

**Rollback:** re-import your original export (`export-p1az.snapshot`, untouched); in a merge the root will conflict again, take the snapshot's version
(the original root, without our child). That restores the root's child list, so nothing but the root ever pointed at our policy. If the console keeps
our objects (5 attributes, 12 conditions, 9 statements, 9 rules, 1 policy), they are inert and you can delete them by hand; the earlier import notes say
a re-import can leave added objects behind. Or deploy the previous branch.

## What the lab reads: statement code to outcome

The lab reads the **specific outcome code** among the `airline-` statements (never `airline-unmatched`: see the catch-all section). The narrowing is carried by the code (the payload is evidence only; a payload that contradicts the
code means "no decision"). The endpoint answer will also contain statements from the shared policies: the shared transaction policy applies to any request
that has no MCP decision context, so a lab request also gets its `transaction-approved` permit statement. The lab must pick the statements whose code starts
`airline-`, drop `airline-unmatched`, expect exactly one left, and ignore the rest.

| Statement code | Outcome | What the lab does |
| --- | --- | --- |
| `airline-permit-as-asked` | allowed as asked | books the cabin asked |
| `airline-economy-intl` | constrained: international | books economy and tells the traveller (business to economy) |
| `airline-economy-over-limit` | constrained: over the limit | books economy and tells the traveller |
| `airline-economy-intl-over-limit` | constrained: international and over the limit | books economy and tells the traveller |
| `airline-approval-required` | hold for a person | refuses the call with 428 `approval_required` and a challenge |
| `airline-approved-as-asked` | approved (a person approved, the lab vouches) | books as asked, then spends the receipt |
| `airline-second-factor-required` | second factor first | refuses with 428 `step_up_required` (the lab's v1 inputs do not produce it) |
| `airline-booking-refused` | refused (DENY) | refuses with 403 `access_denied` (the lab's v1 inputs do not produce it) |
| only `airline-unmatched` (no specific code), or no `airline-` code at all, or a decision other than PERMIT/DENY | no decision | shows "no decision"; never books. A cabin that is not business or economy, a missing cabin, and an `AirApproval` other than `none`, `verified`, `claimed`, `denied` (at any fare) answer `airline-unmatched` alone; an incomplete or foreign request (no marker, another tool, no user, a fare of 0 or less or absent) answers no `airline-` code at all. **Without a specific code the booking is not allowed**, never a permit, whatever the decision word says |
| two or more specific codes, an `airline-` code not in this table, or a decision word that disagrees with the code (refusal code on a PERMIT, permit code on a DENY, a DENY with no `airline-` code) | no decision | shows "no decision"; never books |
| `airline-unmatched` next to a specific code | ignored | nothing: it is on every permit that passes the gate, the lab reads the specific code |

The lab sends these request attributes (all text): `ToolName`, `UserId`, `AirLabMarker` = `larkspur-air`, `AirFare` (above 0), `AirIsInternational`
(`true`/`false`), `AirCabinAsked` (**always**, `business` or `economy`: the lab's own rule treats a missing cabin as business, this policy matches nothing
without it, so the lab must send it with every booking), `AirApproval` (`none` or `verified`; the policy also understands `claimed` and `denied`; exactly these four words, lower case: any other value, an empty one included, matches no outcome at any fare).

**The request must never carry a shared attribute** (`Amount`, `DecisionContext`, `IntentEnforce`, `ActClientId`, `HitlApproved`, `AgentClass`,
`MandateMaxAmount` and the like), and the lab needs a test that fails if it does. Why: the shared policies are gated on those attributes. The MCP and
Intent policies are off only because `DecisionContext` and `IntentEnforce` are absent; if the lab sent them, shared DENY rules (invalid actor chain, invalid
token audience, missing user, no consent) would apply and win over our permit under DenyOverrides. `Amount` makes the transaction rules read it: for
example `Amount` 380 also returns the shared `HITL_CONSENT` statement (a code your gateway reads as a hold), and `Amount` 2500 returns a shared DENY. A booking
fare goes in `AirFare`, never `Amount`. The approval for a retry goes in `AirApproval = verified`, never `HitlApproved` (the shared flag cannot approve a
booking; this is intended).

Probe table (numbers follow `FARE_RULE`; fares are the lab's flights):

| Case | Fare | International | Cabin | Approval | Expected codes (the lab reads the specific one; `airline-unmatched` rides along on every PERMIT) |
| --- | --- | --- | --- | --- | --- |
| Denver | 380 | no | business | none | `airline-permit-as-asked` + `airline-unmatched` |
| Toronto | 380 | yes | business | none | `airline-economy-intl` + `airline-unmatched` |
| Boston | 780 | no | business | none | `airline-economy-over-limit` + `airline-unmatched` |
| Paris | 2400 | yes | business | none | `airline-approval-required` + `airline-unmatched` |
| Paris, approved | 2400 | yes | business | verified | `airline-approved-as-asked` + `airline-unmatched` |
| edge 400 / 401 | 400 / 401 | no | business | none | `airline-permit-as-asked` / `airline-economy-over-limit` (each + `airline-unmatched`) |
| edge 1500 / 1501 | 1500 / 1501 | no | business | none | `airline-economy-over-limit` / `airline-approval-required` (each + `airline-unmatched`) |
| both reasons | 1100 | yes | business | none | `airline-economy-intl-over-limit` + `airline-unmatched` |
| economy asked | 380 | yes | economy | none | `airline-permit-as-asked` + `airline-unmatched` |
| claimed approval | 2400 | yes | business | claimed | `airline-second-factor-required` + `airline-unmatched` |
| declined | 2400 | yes | business | denied | `airline-booking-refused` alone (DENY) |
| unknown cabin | 380 | no | first | none | `airline-unmatched` alone: no decision |
| cabin omitted | 380 | no | (absent) | none | `airline-unmatched` alone: no decision |
| unknown approval | 2400 | yes | business | maybe | `airline-unmatched` alone: no decision |
| unknown approval, under the second limit | 380 | no | business | maybe (also empty, `Verified`) | `airline-unmatched` alone: no decision (a malformed approval never books, at any fare) |
| declined, under the second limit | 380 | no | business | denied | `airline-permit-as-asked` + `airline-unmatched` (a valid approval value is only read over the second limit, as in the lab's own rule) |
| fare omitted, or 0 | (absent) | no | business | none | no `airline-` code at all (the catch-all included) |
| no marker | 380 | no | business | none | no `airline-` code at all (the catch-all included) |

The generator's `--check` prints the same table computed over your file (`PASS` per row against the lab's own rule). That is the file read by a small
evaluator in this repo, not by PingOne: the console test in step 5 is what shows PingOne reads it the same way.

## Proof that the other demos are not changed

`--check` prints these (all `PASS` on your file):

1. **Completeness.** Your export is itself complete: every id referenced anywhere in it resolves inside it, every policy child exists, no duplicate id (284
   references checked). Our output keeps all 172 of your elements, so an import that replaces the working state loses nothing.
2. **No behaviour change.** No existing object is modified except the root policy set; no existing object references ours except the root's one child;
   no new policy set exists; and 184,968 evaluations (every tool name, amount, user, actor, approval and context value your conditions read, plus requests
   that carry some `Air...` values but never the marker; the catch-all sits behind our gate, so it never fires for them) give the same decision, statements and payloads through your root and through the output's. With
   the marker on, no answer that was a DENY becomes anything else.
3. **Snapshot metadata.** The package header has no counts, only `snapshotId`, `snapshotFileVersion` 2 and the application version, and the last element
   is a `digest`. I kept the header, the id and the digest exactly as exported. Reason: your other snapshots show different content importing with one
   fixed `snapshotId` and one fixed digest (the generator-made Muse and Super Banking files), so neither is a per-content check on import; and changing
   either would change a non-ours element, which the rule forbids. The risk is on the other side (the digest cannot be recomputed here: I could not reproduce it as a
   plain hash of the file), so if your console rejects the file as corrupt, that is the cause: tell me. Two fallbacks: create the objects by hand from the
   console checklist, or (with your OK, because it changes a non-ours element) replace the digest with a plain label string, the way your earlier
   generator-made files did. Do not edit the digest by hand. The only evidence that it is not checked is second-hand (your Muse and Super Banking
   generator files, and the earlier import that reused an export's header and digest around changed content); treat your first import as the test, and
   rely on it only after you have watched it succeed.

## What only your console can settle

See the list below; the ones that matter on import day are 1 to 3.

1. Whether the console checks the footer digest on import. If it refuses the file as "corrupt" or "invalid", that is why (see the fallbacks above).
2. Whether the import offers a new branch, a merge (one expected conflict, the root: take the snapshot's version) or a replace, and that the branch you
   deploy is the one you imported.
3. Whether a **new condition shape** is accepted, and a rule with an **empty condition** (the catch-all; yours already have empty conditions, this is the
   skill's shape). Everything used already occurs in your export, but a few combinations are new: rule conditions that are an
   `and` of three to five children (yours have one), `not` over a condition reference inside such an `and`, and `and` with an `or` of two comparisons
   beside a comparison (yours have `or` of three). They are logically trivial; if the console rejects one on import or shows an empty condition, tell me
   which.
4. Whether a longer or shorter name matters: ours are at most 46 characters; no name is used by two objects.
5. Whether the test tool accepts booleans as text `true`/`false` for `AirIsInternational`, and whether a type error (`AirFare` = `abc`) is isolated to our
   policy (my evaluator says it is: without the marker our policy is not applicable).
6. Whether the real engine returns the statements of every permitting rule under the root (the root combines with `evaluateAll`). The lab needs our
   `airline-` statement beside the shared one; if only one comes back, tell me.
7. Statement payloads are static JSON strings (no interpolation) and the engine may return them as objects or strings.

If anyone ever edits the policies in the console, export again and build from that export (see "The master file").
