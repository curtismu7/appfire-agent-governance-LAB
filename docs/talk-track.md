# Talk track

<!-- Generated from server/src/data.js by `npm run talk-track`. Do not edit by hand. -->

> HIVE, Appfire's platform, is represented here and never called. Thresholds, personas and amounts are the lab's own (lab-invented); the use cases come from the AI-DEMO2 catalog.

## Appfire today: the split between HIVE and Ping

HIVE manages Appfire's backend authorization rules and MCP-server eligibility. This lab shows the front end Ping governs: the agent travel-assistant at Larkspur Air gets an identity, receives delegated privileges from the principal it acts for (elena.novak), and every tool call gets a policy decision — enforced and recorded. In this vertical the agent works with trips and bookings. The two layers complement each other; neither replaces the other.

## Step 2 · The agent gets its own identity

Run “Delegated access (consent only)”: elena.novak signs in, consents once, and RFC 8693 token exchange mints a delegated token whose sub is the USER and whose act names travel-assistant — open the Tokens tab to read both claims raw. “Non-human (agent) identity lifecycle” shows the agent's own credential enrolled, rotated and retired as a first-class identity. The point: delegation, not impersonation — the agent never pretends to be the user, and every action traces back to a real human's consent.

## Step 3 · The agent tries a tool call: privilege is scoped per task

Run “Overscoped agent”: the agent holds a scope its task never needed and the extra privilege is stripped before dispatch. Then “third-party MCP server, out-of-scope call”: the gateway refuses a call outside the agent's grant — DENY, nothing reaches the tool. “JIT / ephemeral credentials” shows privilege issued just in time, narrowed to the task, instead of standing access. The point: privilege is defined per agent per task and enforced at the gateway — never trusted to the model's judgement.

## Step 4 · Ping evaluates the call

Run “Entitlement-tiered capability” (permits) and then “Group / entitlement check” (denied): same sensitive tool, different person — the decision changes with who asks and what they are entitled to. “Authz denied” and the third-party MCP-server cases show the same evaluation for MCP-server calls. Each hop shows the raw authorize request and response. The point: a policy evaluation you can audit on every call — never a prompt the model might follow.

## Step 5 · A low-risk read is allowed automatically

Run a low-risk read, then a domestic booking up to $400: the decision card says ALLOWED, the tool ran as asked and nobody was asked. The risk strip shows it landed on the first of its five controls. The record is still written. Where the vertical lists a third-party MCP call the agent may use, run it next: the gateway lets it through, and step 6 shows the same kind of call refused.

## Step 6 · A higher-risk request is denied, constrained or approved

A domestic booking up to $400 is allowed as asked. An international booking, or any booking over $400 and up to $1,500, is booked but only in economy. Over $1,500, domestic or international, a person approves. Run them in that order. “Booking within the limit” is ALLOWED: business, as asked, and nobody is asked. “International booking, economy only” costs the same but is international, so it is CONSTRAINED: the agent asked for business, the traveller gets economy, and the answer and the Decision card say exactly that. “Consumer Agent — governed flight booking” is over $400 by its price alone and is CONSTRAINED the same way. “Booking over the higher limit” goes to a person: approve it on the phone. “Approval claimed, not proven” says a manager already approved, but a claim is not an approval: it asks for a second factor first and, because the booking is over $1,500, a person still approves. The two limits and the international flag are the lab's own, and CONSTRAINED is the lab's own fare rule, not a PingOne Authorize outcome: Larkspur Air would set the real limits in policy.

## Step 6 · Limiting damage from a manipulated agent

Run “confused-deputy actor injection” (a forged actor claim is refused), “intent exceeded” (the agent tries more than the pushed authorization allows), “raw user-token forwarding” (zero-trust refusal), “token theft / replay”, and a request for another person's private trip (refused: the token's subject does not own it). Eleven attacks run here and every one ends in DENY with nothing dispatched. Then poison the agent's instructions: it proposes a $2,500 business booking, over $1,500, so a person must approve it. That run is not one of the eleven; it shows that the decision comes from the call, never from the prompt. A manipulated agent cannot talk its way past the tool, data and action layers: permissions are enforced there, not left to the model to follow instructions.

## Step 7 · The decision history is there for audit

Run “Agent observability and traceability”, then open Run history: every run is a record — which agent acted, on whose behalf, which tool or MCP server it tried, what policy decision applied, and whether access was allowed, denied or escalated. Every hop carries its raw request, response and a W3C traceparent. When Doug's CISO org asks what an agent did and who allowed it, the answer is a query, not an investigation.

## What runs when you sign in

When you sign in with PingOne, “Delegated access” and the other use cases the lab can serve run the actual chain — the agent's own token, two RFC 8693 exchanges at PingOne, then the SE Agent Gateway or the lab's own tool server, and the tool itself. The two approval use cases then add a human-approval loop: the gateway mints a challenge, you approve on the phone, the approval is recorded with the HITL service and the call is retried with the verified receipt. The SE gateway hosts only some verticals' tools, so the other use cases keep running on the lab's own steps. Sign in appears only on a local lab with the PingOne settings filled in; the hosted copy reaches no tenant.

## What the lab does not call

HIVE is Appfire's platform and is never called: its side of the split is represented, not run. The thresholds, personas and amounts are the lab's own (lab-invented). The two limits, the international flag and the CONSTRAINED word are the lab's own. The step-up second factor is not completed here, and a use case that needs a feature flag or a trusted-caller header keeps running on the lab's own steps (the picker tags the flag).

## Why it matters: governed agent autonomy for Appfire

Challenge: Appfire's HIVE platform already manages the backend: data policy and which MCP servers may be used. The open question is the agent-facing front end: who or what the agent is, what it is allowed to do, under which conditions, and how each decision is enforced and recorded — without a person approving every step. Technical: Ping governs the front end: the agent gets its own identity, receives delegated privileges (RFC 8693 act chain), and every tool call, MCP-server hop and data access gets a policy decision with a risk-based outcome — auto-allow for low-risk reads, step-up or human approval for risky writes, deny for out-of-scope actions — all enforced at the tool, data and action layers, not left to the model. Business: Controlled autonomy: low-risk actions proceed inside policy, higher-risk ones are constrained or approved, and every decision leaves an audit record naming the agent, the principal it acted for, the resource and the decision — the visibility Appfire's AI Governance program is asking for, complementing (not replacing) HIVE. (Lab summary of the AI-DEMO2 catalog text, not a Ping claim.)

## Not demonstrated

- Anything about how a real identity provider, gateway or policy engine behaves: nothing here ran against one.
- The identity-provider-only path reaches the identity provider only (discovery and the agent's client-credentials token). Sign-in, token exchange, gateway, authorize and tool steps are not run on it, and it does not recompute the use case's outcome.
- The path through a real tenant has not been run by the builder: UNVERIFIED. The owner runs it.
- The thresholds that decide step-up, approval and deny (lab-invented), the events that stage each attack, the persona that drives group checks, and the two fare limits and the international flag.
- The outcome word CONSTRAINED and the narrowing of a request argument: the lab's own rule, not a PingOne Authorize outcome; how a product policy would express it is not claimed.
- The airline booking limits: the lab's own two limits and international flag. Read from the product's code and docs, not run (UNVERIFIED): its reference airline setup holds bookings for a person's consent and refuses on its own spend limits (a different rule), so none of the booking outcomes here may be what that setup would answer.
- Six verticals are data stubs (a name only); only airline, software, banking, healthcare and retail have full packs.
- Guided use cases (learning pages, presenter guides, A2A reviews, the NHI inventory): the lab opens a stand-in step and does not recompute their outcome.
