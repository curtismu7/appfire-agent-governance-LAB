# Talk track

<!-- Generated from server/src/data.js by `npm run talk-track`. Do not edit by hand. -->

> SIMULATED. SIMULATED, MOCK mode: a mock engine produces every token, hop and decision offline. Tokens are labelled MOCK and signed with a public mock key. Thresholds, personas and event staging are the lab's own (lab-invented); the use cases come from the AI-DEMO2 catalog. No tenant, gateway or identity provider is touched.

## Start with the split

HIVE manages Appfire's backend authorization rules and MCP-server eligibility. This lab shows the front end Ping governs: the agent triage-agent gets an identity, receives delegated privileges from the principal it acts for (alex.morgan), and every tool call gets a policy decision — enforced and recorded. The two layers complement each other; neither replaces the other.

## Ask 1 — Agent Privilege: how agent permissions are defined and constrained

Run UC4 Overscoped agent: the agent holds a scope its task never needed and the extra privilege is stripped before dispatch. Then UC31 (third-party MCP server, out-of-scope call): the gateway refuses a call outside the agent's grant — DENY, nothing reaches the tool. UC17 JIT / ephemeral credentials shows privilege issued just in time, narrowed to the task, instead of standing access. The point: privilege is defined per agent per task and enforced at the gateway — never trusted to the model's judgement.

## Ask 2 — Agent IAM Core: how agents receive identity and authenticate

Run UC1 Delegated access (consent only): alex.morgan signs in, consents once, and RFC 8693 token exchange mints a delegated token whose sub is the USER and whose act names triage-agent — open the Tokens tab to read both claims raw. UC19 Non-human (agent) identity lifecycle shows the agent's own credential enrolled, rotated and retired as a first-class identity. The point: delegation, not impersonation — the agent never pretends to be the user, and every action traces back to a real human's consent.

## Ask 3 — Agent Authorize: how decisions are made for every action

Run UC21 Entitlement-tiered capability (PERMIT) and then UC9 Group / entitlement check (DENY_403): same sensitive tool, different person — the decision changes with who asks and what they are entitled to. UC6 Authz denied and UC30/UC31 show the same evaluation for MCP-server calls. Each hop shows the raw authorize request and response. The point: a policy evaluation you can audit on every call — never a prompt the model might follow.

## Theme — Risk-based approval, not per-action approval

Three runs tell it: UC1 (a read) auto-PERMITs — nobody was asked. UC7 MFA step-up (a $600 write) stops for a second factor. UC8 MFA + HITL consent stops for an actual human: approve it on the mock phone and, in Real mode, the approval is recorded with the HITL service and the call is retried with the verified receipt. The thresholds are the lab's own — the point is the model: controlled autonomy, not a person approving every step.

## Theme — Prompt injection and the compromised agent

Run UC13 confused-deputy actor injection (a forged actor claim is refused), UC14 intent exceeded (the agent tries more than the pushed authorization allows), UC16b raw user-token forwarding (zero-trust refusal), UC12 token theft / replay. Eleven attacks run in mock and every one ends in DENY with nothing dispatched. A manipulated agent cannot talk its way past the tool, data and action layers: permissions are enforced there, not left to the model to follow instructions.

## Theme — Visibility and auditability

Run UC20 Agent observability and traceability, then open Run history: every run is a record — which agent acted, on whose behalf, which tool or MCP server it tried, what policy decision applied, and whether access was allowed, denied or escalated. Every hop carries its raw request, response and a W3C traceparent. When Doug's CISO org asks what an agent did and who allowed it, the answer is a query, not an investigation.

## Real mode: this is live, not slides

Switch the toggle to Real and sign in (pi.flow): UC1 and the other Real-gated use cases run the actual chain — the agent's own token, two RFC 8693 exchanges at PingOne, the SE Agent Gateway, a PingOne Authorize decision and the tool itself. UC7/UC8 add the real HITL loop: the gateway mints a challenge, you approve on the mock phone, the approval is recorded with the HITL service and the call is retried with the verified receipt.

## What is simulated

HIVE is Appfire's platform and is never called — its side of the split is represented, not run. In Mock, everything else is too: the tokens are mock and labelled. In Real mode the PingOne, gateway and HITL hops are real; the step-up second factor and the mock phone's MFA read are simulated and labelled. Use cases that need a feature flag or a trusted-caller header run in mock and say why.

## Why it matters: governed agent autonomy for Appfire

Challenge: Appfire's HIVE platform already manages the backend: data policy and which MCP servers may be used. The open question is the agent-facing front end: who or what the agent is, what it is allowed to do, under which conditions, and how each decision is enforced and recorded — without a person approving every step. Technical: Ping governs the front end: the agent gets its own identity, receives delegated privileges (RFC 8693 act chain), and every tool call, MCP-server hop and data access gets a policy decision with a risk-based outcome — auto-allow for low-risk reads, step-up or human approval for risky writes, deny for out-of-scope actions — all enforced at the tool, data and action layers, not left to the model. Business: Controlled autonomy: low-risk actions proceed inside policy, higher-risk ones are constrained or approved, and every decision leaves an audit record naming the agent, the principal it acted for, the resource and the decision — the visibility Appfire's AI Governance program is asking for, complementing (not replacing) HIVE. (Lab summary of the AI-DEMO2 catalog text, not a Ping claim.)

## Not demonstrated

- Anything about how a real identity provider, gateway or policy engine behaves: nothing here ran against one.
- Live mode reaches the identity provider only (discovery and the agent's client-credentials token). Sign-in, token exchange, gateway, authorize and tool steps are not run live, and a live run does not recompute the use case's outcome.
- The live path has not been run against a real tenant by the builder: UNVERIFIED. The owner runs it.
- The thresholds that decide step-up, approval and deny (lab-invented), the events that stage each attack, and the persona that drives group checks.
- Seven verticals are data stubs (a name only); only banking, healthcare and retail have full packs.
- Guided use cases (learning pages, presenter guides, A2A reviews, the NHI inventory): the lab opens a stand-in step and does not recompute their outcome.
