# Rulebook amendments for the owner to apply

Owner decision, 2026-11-16: "Get rid of the mock calls, everything should be real mode. Stop calling out mock, demo watchers do not need to know."
Chosen design: hide the labels, keep the engine. The lab opens in Real when Real is fully configured; a use case the SE gateway cannot serve runs whole on the
engine and is shown like any other run; the hosted build is engine-only. The page says nothing about mock, simulated, offline, engine or scripted, and has no
Mock | Real control.

`~/Development/STANDALONE-RULES.md` and the `standalone-demo` skill are the owner's files, so this lab did not edit them. Until they are amended, this lab no
longer follows the letter of rules 2, 4, 11 and 19 (and rule 5's button name, and section 6's banner wording). `conformance.mjs` still passes (the vendored
TopMenu and `POST /api/mode` are present, and the hidden `mode-real` marker is there), and the lab's own tests pin what it does instead.

## What the lab does instead, rule by rule

| Rule | What the rule says now | What this lab does instead |
|---|---|---|
| 2 Simulation honesty | A banner on every tab, also in presenter mode, says what is simulated | ONE neutral banner stays first on every page and in presenter mode (`data-testid="banner"`). It says what is represented and whose numbers they are, not how the lab runs: "HIVE, Appfire's platform, is represented here and never called. Thresholds, personas and amounts are the lab's own (lab-invented); the use cases come from the AI-DEMO2 catalog." Product claims still need a source, else UNVERIFIED, and the LAB-INVENTED tags, the UC15 lab-simulated chip, the NOT_DEMONSTRATED lines and "guided, not computed" all stay. |
| 4 Tokens shown raw | Mock-issued tokens (labelled) and decoded claims are visible | Tokens are still shown raw with decoded claims, and secrets stay write-only. The "(MOCK)" label suffix, the MOCK chip and the "MOCK token ... public mock key" notice are gone. The data still identifies an engine-issued token: `token.mock` is true, the issuer is `idp.mock.example`, the key id is `mock-key-1`. |
| 5 Diagrams | ReactFlow, movable boxes, Simulate, Reset, speed control | The button is still named Simulate (`data-testid="simulate"`) because the rule names it; only the "Simulated." sentence in the drag hint was removed. The test lists it as a named exception. If the owner wants it renamed (for example "Walk through"), amend the rule and the lab changes one label. |
| 11 Personas and mode | "the header shows the mode (mock or live)" | The header shows no mode. The mode is in `GET /api/info` (`mode`, `source`, `realAvailable`), in `npm run doctor`, and in a hidden marker `<span hidden data-testid="mode" data-mode="mock|live">` that tests read. The mock sign-in guards (`IDP=mock` AND `ALLOW_MOCK_SIGNIN=1`, loopback, no proxy header) are unchanged. |
| 19 Mock, Real and a toggle | "a visible Mock / Real control in the header of every page, pressed = current mode" | There is no visible control. The lab follows the default half ("Real if configured, else Mock"): it opens in Real when the full Real settings are present, the build is not hosted and nothing refuses Real. The server contract is unchanged: `POST /api/mode` with exactly `{source: "mock"\|"real"}`, `GET /api/info` with `source` and `realAvailable`, 409 when Real is not available, and `scripts/toggle-proof.mjs` proves both directions. The vendored TopMenu is untouched (its `mode` prop is omitted), and the hidden `mode-real` marker keeps the conformance grep satisfied. |
| 25 What Privilege did | `GatewayTrace`; each decision marked checked, observed or inferred; "a real-mode trace must never present an inferred decision as if the gateway had reported it" | Unchanged in substance. The lab passes the component's `basisNote` prop, chosen by the run's source and never naming a mode. A run that went through the gateway keeps the Real caveat word for word: "The requests and responses are exact. The gateway answers with a status and a body, not a per-check breakdown, so decisions marked "inferred" are read from the outcome; the gateway log is the authoritative record." A run on the lab's own steps says "These decisions were computed by the lab's own gateway steps, in the order a gateway runs them." Only the component's default "Simulated: ... Real mode shows the actual gateway." sentence is replaced. The vendored component still picks "The gateway's own record" or "The gateway log line this call produces" by `source`. |
| 1 Runs fully offline | "works fully offline" (mock) | Still true whenever Real is not configured, and always for the hosted build. A lab with the full Real settings opens in Real, and then a use case the gateway serves needs the network; `AAG_LAB_MODE=mock` or `POST /api/mode {source:"mock"}` keeps it offline. A lab that opens in Real answers a request the live guard refuses (for example behind a proxy header) on its own steps, and an explicit `AAG_LAB_MODE=live` with no usable Real path opens on its own steps too (start-up says so). |
| 6 (section) SE k8s mock deployment | "the simulation banner (rule 2) must say it is hosted and simulated" | The hosted banner says it is the hosted copy and that nothing live is reached: "Hosted copy. HIVE, Appfire's platform, is represented and never called. Thresholds, personas and amounts are the lab's own (lab-invented). No tenant or live system is reached." It does not use the word simulated. |
| standalone-demo skill, step 6 | "every page has real and mock with a visible toggle" | See the proposed wording below. |

## Proposed rewording (exact text for the owner to paste)

Rule 2, replace the Rule column text with:

> Honesty banner: one neutral banner on every tab, also in presenter mode, says what is represented and whose numbers are the lab's own (for example HIVE is represented, never called; thresholds, personas and amounts are lab-invented). It need not say how the lab runs. Product claims need a source, else labelled UNVERIFIED; anything the lab does not compute is labelled (LAB-INVENTED, guided, not computed, NOT RUN).

Rule 4, replace "Mock-issued tokens (labelled) and decoded claims are visible" with:

> Tokens and decoded claims are visible, whoever issued them. A token the lab itself issued is identified in the data (a `mock` flag, the issuer host, the key id), not by a label on the page.

and in the Exception, replace "when it is labelled as mock and is never a real credential" with "when it is identified as a lab credential in the data and is never a real credential".

Rule 5, only if the owner wants the button renamed, replace "Simulate" with "Walk through (or Simulate)".

Rule 11, replace "the header shows the mode (mock or live)" with:

> the mode is reported by `GET /api/info` and `doctor` (a header chip is optional)

Rule 19, replace "**Toggle** = a visible Mock / Real control in the header of every page, pressed = current mode, switching back and forth without a restart." with:

> **Toggle** = the server can switch a workspace between Mock and Real back and forth without a restart (`POST /api/mode`); a visible Mock / Real control in the header is optional when the app opens in Real whenever Real is configured and the page does not need to say which it is running.

and replace "the toggle calls it, then reloads all data. Real not configured: button disabled with a how-to tooltip, server answers 409." with:

> a visible toggle, when there is one, calls it and reloads all data. Real not configured: the server answers 409 with a how-to, and a visible Real button, when there is one, is disabled with the same tooltip. A hidden `data-testid="mode-real"` marker keeps the conformance check.

and replace "A toggle that only shows the launch mode does not meet this." with "A server that only has the launch mode does not meet this."

Rule 25, add: "The `basisNote` prop may replace the component's default 'Simulated:' sentence, as long as a run that went through the real gateway keeps the caveat that inferred decisions are read from the outcome and the gateway log is the record."

Section 6 (SE k8s mock deployment), replace "the simulation banner (rule 2) must say it is hosted and simulated" with:

> the banner (rule 2) must say it is the hosted copy and that no tenant or live system is reached

Skill `standalone-demo`, step 6 ("Done means all of"), replace "every page has real and mock with a visible toggle" with:

> the app opens in Real when Real is configured and runs on its own steps otherwise, and the server switches between them (`POST /api/mode`, 409 when Real is not available)

## Open items outside this repo

- Three sentences in the shared hop catalog (`server/src/vendor/hop-catalog.json`, vendored from AI-DEMO-Standalone) still say "(mock)" or "the engine": the llm-plan "Why" card, and the two teaching "failure" lines "A DENY proves the engine answered, not which rule fired" and "Nothing here was decided by the engine". Change them in the shared catalog first, then re-vendor; the tests and the e2e name them as exceptions until then.
- `docs/use-case-routing.md` is the owner's table, copied unchanged and pinned by a test. Its "Here" row still says "the mock engine decides"; it is a document for the owner, not the page.
- The shelf entry in demo-shelf-LAB (`data/demos.json`) and the shelf's `simulated` tag are a separate PR; this lab's `docs/shelf-entry.json` already drops the words, and keeps the tag until the owner decides on that facet.
