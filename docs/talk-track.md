# Talk track

<!-- Generated from server/src/data.js by `npm run talk-track`. Do not edit by hand. -->

> SIMULATED. SIMULATED, MOCK mode: a mock engine produces every token, hop and decision offline. Tokens are labelled MOCK and signed with a public mock key. Thresholds, personas and event staging are the lab's own (lab-invented); the use cases come from the AI-DEMO2 catalog. No tenant, gateway or identity provider is touched.

## Start with the split

HIVE manages Appfire's backend authorization rules and MCP-server eligibility. This lab shows the front end Ping governs: the agent triage-agent gets an identity, receives delegated privileges from the principal it acts for (alex.morgan), and every tool call gets a policy decision — enforced and recorded. The two layers complement each other; neither replaces the other.

## Eight tracks, 87 scenarios

The catalog has 87 use cases in eight tracks: foundations (15), learn (23), controls (16), hitl (4), demo (8), attacks (11), tools (8) and nhi (2). Map them to what Doug asked for: Agent Privilege (controls), Agent IAM Core (foundations, nhi), Agent Authorize (controls, attacks). Pick any one and run it: every hop shows the raw request and response and a W3C traceparent.

## Agent identity, not impersonation

alex.morgan consents, the identity provider exchanges the user token and the agent token (RFC 8693) for a delegated token whose act claim names triage-agent. Agent identity, initiating principal and downstream resource stay distinct — the core of Agent IAM Core — and the gateway checks that chain on every call.

## Risk-based approval, not per-action approval

A low-risk read-only transfer proceeds automatically inside policy. A riskier one needs step-up, a riskier one still needs a human approval receipt, and out-of-scope is denied. The thresholds are the lab's own — the point is the model: controlled autonomy, not a person approving every step.

## Prompt injection and a compromised agent

Eleven attacks run in mock: wrong scope, wrong audience, a replayed proof, a forged actor, an exceeded intent, a missing act claim, a burst of calls, a validation outage. A manipulated agent cannot talk its way past the tool, data and action layers: permissions are enforced there, not left to the model to follow instructions.

## The audit trail

Every decision is recorded: which agent acted, on whose behalf, which tool or MCP server it tried, what policy decision applied, and whether access was allowed, denied or escalated. That is the visibility for governance and investigation.

## Mock and live

Mock runs a whole use case offline. Live, which the owner switches on, makes two real calls to one identity provider environment: its discovery document and the agent's own token. It stops there, with no user sign-in, no gateway and no tool call, and it lists the steps it did not run. That is what this lab can honestly show against a real tenant.

## What is simulated

In Mock, everything — including HIVE itself: HIVE is Appfire's platform and is never called. The tokens are mock and labelled. The use cases and their expected outcomes are the catalog's; the amounts, the events and the persona that make each one happen are the lab's. Use cases that need a feature flag run in mock and say what live feature they need.

## Why it matters: governed agent autonomy for Appfire

Challenge: Appfire's HIVE platform already manages the backend: data policy and which MCP servers may be used. The open question is the agent-facing front end: who or what the agent is, what it is allowed to do, under which conditions, and how each decision is enforced and recorded — without a person approving every step. Technical: Ping governs the front end: the agent gets its own identity, receives delegated privileges (RFC 8693 act chain), and every tool call, MCP-server hop and data access gets a policy decision with a risk-based outcome — auto-allow for low-risk reads, step-up or human approval for risky writes, deny for out-of-scope actions — all enforced at the tool, data and action layers, not left to the model. Business: Controlled autonomy: low-risk actions proceed inside policy, higher-risk ones are constrained or approved, and every decision leaves an audit record naming the agent, the principal it acted for, the resource and the decision — the visibility Appfire's AI Governance program is asking for, complementing (not replacing) HIVE. (Lab summary of the AI-DEMO2 catalog text, not a Ping claim.)

## Not demonstrated

- Anything about how a real identity provider, gateway or policy engine behaves: nothing here ran against one.
- Live mode reaches the identity provider only (discovery and the agent's client-credentials token). Sign-in, token exchange, gateway, authorize and tool steps are not run live, and a live run does not recompute the use case's outcome.
- The live path has not been run against a real tenant by the builder: UNVERIFIED. The owner runs it.
- The thresholds that decide step-up, approval and deny (lab-invented), the events that stage each attack, and the persona that drives group checks.
- Seven verticals are data stubs (a name only); only banking, healthcare and retail have full packs.
- Guided use cases (learning pages, presenter guides, A2A reviews, the NHI inventory): the lab opens a stand-in step and does not recompute their outcome.
