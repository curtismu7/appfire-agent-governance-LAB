<!--
  THE OBSERVABILITY STORY (working title: "One run, six products, one pane")

  The wording for the Observability Story in appfire-agent-governance-LAB — the hero lab for
  the cross-Ping observability demo. The lab serves this file at GET /api/story (the shared
  Story parser); the live Story and take.py both read it, and take.py fills in the live
  values (a verdict word, a tool count, a decision outcome) around whatever is written here;
  it never touches this file itself.

  Rules for editing safely (the shared parser's heading contract):
  - The first page has a "## Header" naming the demo (rule 29); keep it on the Opening Slide
    and on any slide a mode shows first.
  - Don't rename "# Opening Slide" / "# Closing Slide" / "# Slide: <key>" / "# Step: <key>",
    or a "## Header" / "## Title" / "## Text" / "## Lead" / "## Verdict" heading.
  - "---" on its own line separates sections. Keep those.
  - PUBLIC-SAFE: no internal hostnames, tenant ids, keys, or person data. The cast names are
    the lab's own invented cast.

  THE ARC (five acts):
    1. The problem — an agent acted; who saw what?
    2. The cast — six layers, six Ping products (the lane model)
    3. One run, one pane — the hero moment (a real run, the panel fills)
    4. The turn — break it adversarially; the same pane holds the truth
    5. The close — from demo to audit (the stdout line, the same record)

  STORY_ONLY keys (bubbles the video does not need, the live panel is the star):
    hero_panel, hero_chain, hero_streams
  VIDEO_ONLY keys (video-only scenes the live Story skips):
    video_products_wall
-->

# Opening Slide

## Header
Observability across Ping: one run, six products, one pane

## Title
When an AI agent acts, who saw what?

## Lead
An agent's one run crosses six trust boundaries. Six Ping products each hold one piece of the truth. This demo assembles them into one honest answer — live, per run.

## Column A: The old way
- Six consoles, six logs, six timelines
- Correlate by hand, after the fact
- Every product says "my part worked"

## Column B: This demo
- One pane: the run, in order, per layer
- The chain drawn as it happened
- Refusals and pauses counted honestly

## Verdict
This is a real run against a real gateway — not a slide.

---

# Slide: the_cast

## Title
The cast: six layers, six products

## Lead
Learn the lanes once; every run in every lab uses the same six.

## Column A: Who the run touches
- **Person** — PingOne sign-in (and PingID when a human approves)
- **Agent** — the agent runtime: what the agent planned
- **Authorize** — PingOne Authorize: may it?

## Column B: What stands in the way
- **Privilege** — agent identity, scopes and keys
- **Agent gateway** — the Privilege AI Gateway: checked at the door
- **Resource** — the MCP server: what actually happened

## Verdict
Person → Agent → Authorize → Privilege → Gateway → Resource. One run, in that order.

---

# Step: hero_run_prompt

## Title
Run a real use case

## Text
Pick a governed use case and run it — the agent will plan, exchange tokens, ask Authorize, pass the gateway and call the tool. Watch the pane under the run fill as the run settles.

---

# Step: hero_panel (STORY_ONLY)

## Title
One pane, one run

## Text
"What each layer logged for this run": every hop of this run, one row per hop, in the layer that spoke — sign-in under Person, the plan under Agent, the decision under Authorize, the door under Gateway, the tool call under Resource.

---

# Step: hero_summary

## Title
The count is honest

## Text
Read the summary line out loud: allowed, refused, blocked — and "for information". Information is not a pass: a pause for a human or a repeated decision is counted, never claimed as a win.

---

# Step: hero_chain (STORY_ONLY)

## Title
The chain: User → Agent → Scopes → Policy

## Text
The chain view draws who the run was for and what it was allowed to hold — User, Agent, Scopes, Policy — linked because each row carries the same agent identifier. A name never links two steps; an identity does.

---

# Step: hero_streams

## Title
Where the logs live

## Text
Open "Where these logs live and where they stream": each product's stdout, one line per decision, streamable to your own collector. The demo and your audit trail are the same record.

---

# Slide: video_products_wall (VIDEO_ONLY)

## Title
One pane, many labs

## Lead
Every lab in this family vendors the same panel — the same UX federated across the demos, not six consoles to learn.

## Column A: In this lab
- 87 use cases across six tracks
- Every one leaves the same per-run record

## Column B: Across the family
- The same six lanes, the same chain
- The same honesty rules everywhere

## Verdict
One component, one contract, every lab.

---

# Step: turn_overlimit

## Title
The turn: ask for too much

## Text
Run it again, adversarially — an amount over the band. Authorize answers with an obligation, and the pane says what a good pane must say: a step-up row is a pause for a human, not a verdict on the call.

---

# Step: turn_hold

## Title
The human approves

## Text
The hold is real: the call waits at the gateway until a person approves it (here, the lab's own HITL flow; in production, PingID). When the approval lands, the same rows continue — nothing restarts, nothing is re-run.

---

# Step: turn_denied

## Title
The turn: the wrong agent

## Text
Now the attack: a confused-deputy actor injection — an agent id that is not registered. Privilege's chain is where it shows: the agent step does not correlate, the Authorize layer refuses, and the tool call row never appears. Nothing ran, and the pane proves it.

---

# Step: turn_blocked

## Title
The turn: the blocked door

## Text
Point the run at a door whose policy blocks it: the gateway answers refused, the Resource layer shows honestly that no tool call was served, and the refusal is quoted in the gateway's own words — never invented.

---

# Step: turn_compare

## Title
Same pane, every outcome

## Text
Success, hold, refusal, block — four runs, one pane, no new screen. That is the point: you do not learn a new tool for failure. The truth holds in the same view.

---

# Closing Slide

## Header
Observability across Ping: one run, six products, one pane

## Title
From demo to audit

## Lead
The pane, the stdout line and the auditor's record are the same artifact: one run, six layers, counted honestly.

## Column A: What you saw
- A live run, drawn per layer as it happened
- The chain: who, what it held, which policy
- Refusals and holds in the same pane as success

## Column B: What you take home
- One component, vendored into every lab
- One line per decision, streamable to your SIEM
- The honesty rules: information is not a pass

## Verdict
Your agents are already crossing six boundaries. The only question is whether you can see it.

---

# Step: closing_next

## Title
Where to go next

## Text
Try it yourself: run any use case in the picker, then break it on purpose. Every lab in this family shows the same pane — the hero run here, the HITL approval in its own lab, the stolen token in another.
