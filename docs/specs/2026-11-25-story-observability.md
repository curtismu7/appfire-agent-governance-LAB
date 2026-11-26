# Observability Story spec (appfire-agent-governance-LAB)

**Status:** draft — wording agreed, build not started   **Owner:** Curtis (decides scope)
**Process tier:** 2 (a demo colleagues and customers see): spec first, tests per fix, /code-review, deploy on the owner's go.
**Contract:** `AI-DEMO-Standalone/shared/story/README.md`. Runbook: `shared/story/ADDING-TO-A-LAB.md`.

## Goal
The cross-Ping observability demo as a Story: a guided walk of the six-lane pane — a hero run, the chain view, then the adversarial turn (over-limit → hold → approval; confused-deputy → refusal; blocked door) — ending on the "demo to audit" close. The five-act arc lives in `video/captions.md` (drafted, parses clean).

## The five acts (what the audience takes away)
1. **Problem:** an agent acted; six products each hold one piece of the truth.
2. **Cast:** Person (PingOne) → Agent → Authorize → Privilege → Gateway → Resource — the lane model.
3. **Hero:** one real run, the pane fills, the chain draws, the count is honest ("information is not a pass").
4. **Turn:** over-limit (obligation → hold → approval), wrong agent (chain does not correlate, refusal), blocked door (Resource shows nothing ran) — same pane every time.
5. **Close:** the stdout line is the auditor's record; demo and compliance artifact are the same thing.

## Steps and targets (all exist on the page today)
| key | target | trigger |
|---|---|---|
| hero_run_prompt | the use-case picker / run button | load |
| hero_panel (STORY_ONLY) | `[data-testid=run-observability]` | run-done |
| hero_summary | `[data-testid=ro-summary]` | run-done |
| hero_chain (STORY_ONLY) | `[data-testid=ro-chain]` | run-done |
| hero_streams | `[data-testid=ro-streams]` summary | run-done |
| turn_* (5) | same targets after the adversarial runs | run-done |

## Mock/offline
The lab's Mock computes every hop in-process (the engine), so Story works offline with `sample_*` wording keys marking the mock rows as the lab's stand-in. No simulated-run replay needed (unlike the A2A lab).

## Acceptance criteria
1. Pin ok; parity both ways (every caption key has a script step and vice versa; STORY_ONLY = hero_panel, hero_chain; VIDEO_ONLY = video_products_wall).
2. take.py-derived tests: bubble order, numbered count (8 bubbles), Mock mapping.
3. `GET /api/story` serves the wording; rule-29 headers on the Opening and Closing slides.
4. Demo mode unchanged; `npm test` green; walk.py Mock at both sizes, screenshots read; Real walked if the gateway is up.
5. Play for me presses Run and never advances past an unfinished run.

## Unhappy paths
- A run errors: `run-end { ok: true }` still fires (the rows show it); turn_* steps show the rows or skip quietly.
- No run yet when a turn step shows: target missing → skipped.
- Mode switched mid-story: restart, as the A2A lab does.

## Out of scope
Recording the video (owner, after this merges); changing the panel or the engine; other labs' Stories.

## Protected
Demo mode and its tests; the vendored pins (story, run-observability, standalone-ui.css, JsonPane, gateway-trace); no tenant ids or keys in the repo; the engine's wording exception (rows may say mock/real) is already covered by the e2e scan's named exceptions.
