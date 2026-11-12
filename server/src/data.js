// Story data. Every string may carry {{cast}} tokens; cast.js fills them from a vertical pack. A test fails on any token a pack does not define.
// Labels with the tokens castOutcome, castTitle, castPersona, agentName and again are filled by the engine at run time (see EXTRA_TOKENS).
export const TITLE = 'Appfire Agent Governance LAB';
export const SOURCE_LABEL = 'built for the Appfire agentic-AI briefing: the Ping front-end controls (agent identity, privilege, authorize decisions, audit) over the simulated HIVE back-end split, from the customer-agent use-case catalog (recorded commit in data/usecases.json)';
export const EXTRA_TOKENS = ['castOutcome', 'castTitle', 'castPersona', 'agentName', 'again'];

export const BANNER = {
  mock: 'SIMULATED, MOCK mode: a mock engine produces every token, hop and decision offline. Tokens are labelled MOCK and signed with a public mock key. Thresholds, personas and event staging are the lab\'s own (lab-invented); the use cases come from the AI-DEMO2 catalog. No tenant, gateway or identity provider is touched.',
  live: 'REAL mode (the owner\'s settings): with the full-Real settings, you sign in for real (pi.flow, in the Sign in dialog), then a run gets the agent\'s own token and two RFC 8693 token exchanges (the first stamps act = the agent, the second is for the gateway) from your PingOne environment and calls the SE Agent Gateway over MCP, for the use cases the SE MCP server serves; the other use cases run Mock and say why, and every hop is labelled REAL, MOCK or NOT RUN. The HITL approval is always simulated. With only the old worker client: two real calls (discovery and a client-credentials token, shown masked), identity provider only.',
};
// The hosted build's banner (AAG_DEPLOY_MODE=hosted, rulebook section 6): it replaces both banners above, on the page and in the served HTML.
export const HOSTED_BANNER = 'HOSTED AND SIMULATED: this is the hosted copy of the lab, mock only. A mock engine produces every token, hop and decision; tokens are labelled MOCK. No tenant, gateway, identity provider or model is reached, and Real mode is not available here. Your runs are kept apart from other visitors\' by a workspace id in this browser tab.';

// Hop labels, one per hop kind (the keys flow.js passes to hop()).
export const LABELS = {
  'sign-in': '{{castPersona}} signs in to {{castBrand}} (mock persona picker)',
  consent: 'Consent: the customer lets {{castAgent}} act for them (may_act)',
  'actor-token': 'The agent {{agentName}} gets its own token (client credentials)',
  'token-exchange': 'Token exchange (RFC 8693): user token + agent token become a delegated token with an act claim',
  'a2a-exchange-1': 'Delegation 1: {{castAgent}} acts for the customer (act chain starts)',
  'a2a-exchange-2': 'Delegation 2: {{castAgent2}} acts under {{castAgent}} (act chain nested, scope narrowed)',
  'gateway-check': 'Gateway check{{again}}: signature, audience, expiry, act, scope and edge policy',
  'authorize-decision': 'Authorize decision for {{castAction}} on the {{castAsset}}',
  'tool-dispatched': 'Tool dispatched to the MCP server',
  'tool-held': 'Write held: not dispatched until the obligation is satisfied',
  'tool-refused': 'Tool call refused: nothing reached the MCP server',
  'a2a-mismatch-probe': 'Probe: {{castAgent3}} (not a registered agent) tries to act in the chain',
  'a2a-protocol-bearer': 'A2A call carries the nested-act token as its bearer',
  'a2a-agent-card': 'A2A agent card fetched from {{castAgent2}}',
  'a2a-protocol-message': 'A2A message sent to {{castAgent2}}',
  'ciba-authorize': 'CIBA: back-channel authentication request',
  'ciba-poll': 'CIBA: the customer approves on the mock phone and the agent collects the token',
  'hitl-receipt': 'Human approval receipt checked',
  'sim-rar-armed': 'PAR: pushed authorization_details bound the payment',
  'intent-binding-verified': 'Intent binding: the call is checked against the pushed bound',
  'exchange-skipped': 'The BFF tries to forward the raw user token without an exchange',
  'privilege-gateway-leg': 'The agent reaches the Privilege gateway with its bearer',
  'credential-swap': 'The gateway swaps the caller bearer for the operator credential',
  'enterprise-managed-mode': 'Enterprise IdP group policy decides issuance for {{castUser}}',
  'id-jag-issued': 'ID-JAG assertion issued (single use)',
  'id-jag-redeemed': 'ID-JAG redeemed for an MCP access token',
  'verified-trust-issuance': 'A signed agent assertion is issued for {{castAgent}}',
  'personal-agent-lookup': 'The workload agent {{castAgent}} is looked up in the registry',
  guided: 'Guided page: the lab opens it; the product shows its own demo',
  website: 'The browser loads {{castBrand}}: an HttpOnly session cookie, no token',
  prompt: 'The customer types a request: only the message goes to the BFF',
  'agent-receive': '{{castAgent}} receives the request and matches it to a use case',
  'tools-list-challenge': 'tools/list with no token: the gateway answers 401 and names its metadata',
  'tools-list': 'tools/list with a token: the gateway returns the tools this caller may use',
  'llm-plan': 'Agent: intent match and tool choice (the model proposes, policy decides)',
  'tools-call-challenge': 'tools/call with no token: the gateway answers 401, nothing runs',
  'api-call': 'The MCP server calls the resource server with the delegated token',
  'agent-reply': '{{castAgent}} composes the reply shown in the chat',
  'step-up': 'Step-up: the customer approves again (MFA, CIBA or a person)',
  'vault-key-inject': 'Vault: the API key bound to this tool route',
  'api-key-swap': 'API-key path: the bearer is swapped for a service key',
  'database-query': 'Database: the back end queries its data store',
  narration: '{{castPersona}} asks {{castAgent}} at {{castBrand}}: "{{castTitle}}". The engine computed the outcome {{castOutcome}}.',
};

export const WHY = {
  id: 'why-appfire-agent-governance',
  title: 'Why it matters: governed agent autonomy for Appfire',
  challenge: 'Appfire\'s HIVE platform already manages the backend: data policy and which MCP servers may be used. The open question is the agent-facing front end: who or what the agent is, what it is allowed to do, under which conditions, and how each decision is enforced and recorded — without a person approving every step.',
  technical: 'Ping governs the front end: the agent gets its own identity, receives delegated privileges (RFC 8693 act chain), and every tool call, MCP-server hop and data access gets a policy decision with a risk-based outcome — auto-allow for low-risk reads, step-up or human approval for risky writes, deny for out-of-scope actions — all enforced at the tool, data and action layers, not left to the model.',
  business: 'Controlled autonomy: low-risk actions proceed inside policy, higher-risk ones are constrained or approved, and every decision leaves an audit record naming the agent, the principal it acted for, the resource and the decision — the visibility Appfire\'s AI Governance program is asking for, complementing (not replacing) HIVE.',
};
export const WHY_TEXT = `Challenge: ${WHY.challenge} Technical: ${WHY.technical} Business: ${WHY.business} (Lab summary of the AI-DEMO2 catalog text, not a Ping claim.)`;

export const TALK_TRACK = [
  { id: 'say-first', title: 'Start with the split', say: 'HIVE manages Appfire\'s backend authorization rules and MCP-server eligibility. This lab shows the front end Ping governs: the agent {{castAgent}} gets an identity, receives delegated privileges from the principal it acts for ({{castUser}}), and every tool call gets a policy decision — enforced and recorded. The two layers complement each other; neither replaces the other.' },
  { id: 'tracks', title: 'Eight tracks, 87 scenarios', say: 'The catalog has 87 use cases in eight tracks: foundations (15), learn (23), controls (16), hitl (4), demo (8), attacks (11), tools (8) and nhi (2). Map them to what Doug asked for: Agent Privilege (controls), Agent IAM Core (foundations, nhi), Agent Authorize (controls, attacks). Pick any one and run it: every hop shows the raw request and response and a W3C traceparent.' },
  { id: 'delegation', title: 'Agent identity, not impersonation', say: '{{castUser}} consents, the identity provider exchanges the user token and the agent token (RFC 8693) for a delegated token whose act claim names {{castAgent}}. Agent identity, initiating principal and downstream resource stay distinct — the core of Agent IAM Core — and the gateway checks that chain on every call.' },
  { id: 'obligations', title: 'Risk-based approval, not per-action approval', say: 'A low-risk read-only {{castAction}} proceeds automatically inside policy. A riskier one needs step-up, a riskier one still needs a human approval receipt, and out-of-scope is denied. The thresholds are the lab\'s own — the point is the model: controlled autonomy, not a person approving every step.' },
  { id: 'attacks', title: 'Prompt injection and a compromised agent', say: 'Eleven attacks run in mock: wrong scope, wrong audience, a replayed proof, a forged actor, an exceeded intent, a missing act claim, a burst of calls, a validation outage. A manipulated agent cannot talk its way past the tool, data and action layers: permissions are enforced there, not left to the model to follow instructions.' },
  { id: 'audit', title: 'The audit trail', say: 'Every decision is recorded: which agent acted, on whose behalf, which tool or MCP server it tried, what policy decision applied, and whether access was allowed, denied or escalated. That is the visibility for governance and investigation.' },
  { id: 'live', title: 'Mock and live', say: 'Mock runs a whole use case offline. Live, which the owner switches on, makes two real calls to one identity provider environment: its discovery document and the agent\'s own token. It stops there, with no user sign-in, no gateway and no tool call, and it lists the steps it did not run. That is what this lab can honestly show against a real tenant.' },
  { id: 'honesty', title: 'What is simulated', say: 'In Mock, everything — including HIVE itself: HIVE is Appfire\'s platform and is never called. The tokens are mock and labelled. The use cases and their expected outcomes are the catalog\'s; the amounts, the events and the persona that make each one happen are the lab\'s. Use cases that need a feature flag run in mock and say what live feature they need.' },
  { id: 'why-appfire-agent-governance', title: WHY.title, say: WHY_TEXT },
];

export const NOT_DEMONSTRATED = [
  'Anything about how a real identity provider, gateway or policy engine behaves: nothing here ran against one.',
  'Live mode reaches the identity provider only (discovery and the agent\'s client-credentials token). Sign-in, token exchange, gateway, authorize and tool steps are not run live, and a live run does not recompute the use case\'s outcome.',
  'The live path has not been run against a real tenant by the builder: UNVERIFIED. The owner runs it.',
  'The thresholds that decide step-up, approval and deny (lab-invented), the events that stage each attack, and the persona that drives group checks.',
  'Seven verticals are data stubs (a name only); only banking, healthcare and retail have full packs.',
  'Guided use cases (learning pages, presenter guides, A2A reviews, the NHI inventory): the lab opens a stand-in step and does not recompute their outcome.',
];

export function rawStory() { return { title: TITLE, banner: BANNER, labels: LABELS, talkTrack: TALK_TRACK, why: WHY, notDemonstrated: NOT_DEMONSTRATED }; }
