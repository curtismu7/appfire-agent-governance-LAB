# Talk track

<!-- Generated from server/src/data.js by `npm run talk-track`. Do not edit by hand. -->

> SIMULATED. SIMULATED, MOCK mode: a mock engine produces every token, hop and decision offline. Tokens are labelled MOCK and signed with a public mock key. Thresholds, personas and event staging are the lab's own (lab-invented); the use cases come from the AI-DEMO2 catalog. No tenant, gateway or identity provider is touched.

## Appfire today: the split between HIVE and Ping

HIVE manages Appfire's backend authorization rules and MCP-server eligibility. This lab shows the front end Ping governs: the agent release-assistant at Appfire Work Suite gets an identity, receives delegated privileges from the principal it acts for (maya.chen), and every tool call gets a policy decision — enforced and recorded. In this vertical the agent works with projects and issues. The two layers complement each other; neither replaces the other.

## Step 2 · The agent gets its own identity

Run “Delegated access (consent only)”: maya.chen signs in, consents once, and RFC 8693 token exchange mints a delegated token whose sub is the USER and whose act names release-assistant — open the Tokens tab to read both claims raw. “Non-human (agent) identity lifecycle” shows the agent's own credential enrolled, rotated and retired as a first-class identity. The point: delegation, not impersonation — the agent never pretends to be the user, and every action traces back to a real human's consent.

## Step 3 · The agent tries a tool call: privilege is scoped per task

Run “Overscoped agent”: the agent holds a scope its task never needed and the extra privilege is stripped before dispatch. Then “third-party MCP server, out-of-scope call”: the gateway refuses a call outside the agent's grant — DENY, nothing reaches the tool. “JIT / ephemeral credentials” shows privilege issued just in time, narrowed to the task, instead of standing access. The point: privilege is defined per agent per task and enforced at the gateway — never trusted to the model's judgement.

## Step 4 · Ping evaluates the call

Run “Entitlement-tiered capability” (permits) and then “Group / entitlement check” (denied): same sensitive tool, different person — the decision changes with who asks and what they are entitled to. “Authz denied” and the third-party MCP-server cases show the same evaluation for MCP-server calls. Each hop shows the raw authorize request and response. The point: a policy evaluation you can audit on every call — never a prompt the model might follow.

## Step 5 · A low-risk read is allowed automatically

Run a low-risk read: the decision card says ALLOWED, the tool ran and nobody was asked. The risk strip shows it landed on the first control. The record is still written. Where the vertical lists a third-party MCP call the agent may use, run it next: the gateway lets it through, and step 6 shows the same kind of call refused.

## Step 6 · A higher-risk request is denied, constrained or approved

The read you just saw needed nobody. Now the writes: “MFA step-up” (a bulk edit above the first threshold) stops for a second factor. “MFA + HITL consent” (a smaller bulk edit) stops for an actual human: approve it on the mock phone and, in Real mode, the approval is recorded with the HITL service and the call is retried with the verified receipt. A bulk edit above the limit is refused outright. A claim that someone 'already approved it' changes nothing: only a verified approval counts. The thresholds are the lab's own — the point is the model: controlled autonomy, not a person approving every step.

## Step 6 · Limiting damage from a manipulated agent

Run “confused-deputy actor injection” (a forged actor claim is refused), “intent exceeded” (the agent tries more than the pushed authorization allows), “raw user-token forwarding” (zero-trust refusal), “token theft / replay”, and a request for another person's private project (refused: the token's subject does not own it). Eleven attacks run in mock and every one ends in DENY with nothing dispatched. A manipulated agent cannot talk its way past the tool, data and action layers: permissions are enforced there, not left to the model to follow instructions.

## Step 7 · The decision history is there for audit

Run “Agent observability and traceability”, then open Run history: every run is a record — which agent acted, on whose behalf, which tool or MCP server it tried, what policy decision applied, and whether access was allowed, denied or escalated. Every hop carries its raw request, response and a W3C traceparent. When Doug's CISO org asks what an agent did and who allowed it, the answer is a query, not an investigation.

## Real mode: this is live, not slides

Switch the toggle to Real and sign in (pi.flow): “Delegated access” and the other Real use cases run the actual chain — the agent's own token, two RFC 8693 exchanges at PingOne, the SE Agent Gateway, a PingOne Authorize decision and the tool itself. The two approval use cases add the real HITL loop: the gateway mints a challenge, you approve on the mock phone, the approval is recorded with the HITL service and the call is retried with the verified receipt. Real calls the SE gateway, which hosts only some verticals' tools: pick one it serves for a Real run (the vertical menu notes which); a vertical it does not serve stays on the labelled mock engine and every hop says MOCK and why.

## What is simulated

HIVE is Appfire's platform and is never called — its side of the split is represented, not run. In Mock, everything else is too: the tokens are mock and labelled. In Real mode the PingOne, gateway and HITL hops are real; the step-up second factor and the mock phone's MFA read are simulated and labelled. Use cases that need a feature flag or a trusted-caller header run in mock and say why.

## Why it matters: governed agent autonomy for Appfire

Challenge: Appfire's HIVE platform already manages the backend: data policy and which MCP servers may be used. The open question is the agent-facing front end: who or what the agent is, what it is allowed to do, under which conditions, and how each decision is enforced and recorded — without a person approving every step. Technical: Ping governs the front end: the agent gets its own identity, receives delegated privileges (RFC 8693 act chain), and every tool call, MCP-server hop and data access gets a policy decision with a risk-based outcome — auto-allow for low-risk reads, step-up or human approval for risky writes, deny for out-of-scope actions — all enforced at the tool, data and action layers, not left to the model. Business: Controlled autonomy: low-risk actions proceed inside policy, higher-risk ones are constrained or approved, and every decision leaves an audit record naming the agent, the principal it acted for, the resource and the decision — the visibility Appfire's AI Governance program is asking for, complementing (not replacing) HIVE. (Lab summary of the AI-DEMO2 catalog text, not a Ping claim.)

## Not demonstrated

- Anything about how a real identity provider, gateway or policy engine behaves: nothing here ran against one.
- Live mode reaches the identity provider only (discovery and the agent's client-credentials token). Sign-in, token exchange, gateway, authorize and tool steps are not run live, and a live run does not recompute the use case's outcome.
- The live path has not been run against a real tenant by the builder: UNVERIFIED. The owner runs it.
- The thresholds that decide step-up, approval and deny (lab-invented), the events that stage each attack, and the persona that drives group checks.
- Seven verticals are data stubs (a name only); only software, banking, healthcare and retail have full packs.
- Guided use cases (learning pages, presenter guides, A2A reviews, the NHI inventory): the lab opens a stand-in step and does not recompute their outcome.
