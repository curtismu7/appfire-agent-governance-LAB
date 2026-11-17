// Presenter captions: what to say, and what to point at, for each step (hop) of a run, so the person presenting can walk the Sequence one step at a time
// without improvising the words. One entry per hop kind the lab emits (a test in server/test/captions.test.js fails when the engine emits a kind with no
// caption). Customer-safe by rule: plain words, no tenant or client identifiers, no numbers the lab invented, and HIVE only in the session brief's own words
// (back-end data policy and which MCP servers may be used; never called here). `agenda` ties a step to one of the seven walkthrough steps in demoGuide.js.
// `deny` and `held` replace `say` when the step ended that way; a step the run never went through (verdict skip) always gets NOT_IN_PATH.
// No imports on purpose: the server test loads this file as plain ESM.

export const NOT_IN_PATH = {
  say: "This step is not part of this run. The lab lists it so you can say what it would do in a flow that needs it, and that it was not used here.",
  point: "The NOT RUN tag on the step. Nothing was called and no token was issued for it.",
};

export const CAPTIONS = {
  website: { agenda: "start", say: "The person is in the Appfire application, signed in as themselves. Nothing about the agent is trusted yet.", point: "Who is on the left of the diagram: the person's browser, not the agent." },
  "sign-in": { agenda: "start", say: "The person proves who they are to the identity provider. Everything the agent does later traces back to this sign-in.", point: "The token the person gets: the sub claim is the person." },
  prompt: { agenda: "start", say: "They ask for something in plain words. This is only a request; it carries no permission.", point: "The message in the request body. Note there is no agent credential on it." },
  "agent-receive": { agenda: "start", say: "The application hands the request to the AI agent. From here the agent works on the person's behalf, but it is not the person.", point: "The agent is a separate actor in the diagram, with its own lane." },
  "tools-list-challenge": { agenda: "call", say: "The agent asks the gateway what tools exist, without a token. The gateway refuses. An agent with no identity sees nothing.", point: "The 401 and the WWW-Authenticate header in the response." },
  "tools-list": { agenda: "call", say: "With a token, the gateway answers with the tools on offer to this agent. HIVE keeps its back-end role: data policy and which MCP servers may be used.", point: "The list of tools in the response." },
  "llm-plan": { agenda: "call", say: "The model decides what it wants to try. It proposes a call; it does not get to make it.", point: "The tool the model chose. It is a proposal that still has to pass the gateway.", },
  consent: { agenda: "identity", say: "The person agrees to let this agent act for them. The agent's access starts from that consent and goes no further.", point: "The scopes the person agreed to." },
  "actor-token": { agenda: "identity", say: "The agent gets its own token, as itself. It is its own identity: not the person, not the application.", point: "The client in the token. This is the agent, with no person in it yet." },
  "token-exchange": { agenda: "identity", say: "The person's token and the agent's token are exchanged for one delegated token. It says both things at once: whose request this is, and who is acting.", point: "In the new token, sub is the person and act names the agent. Narrower scopes than the person's own." },
  "authorize-decision": {
    agenda: "evaluate",
    say: "Before the gateway lets anything through, the policy engine evaluates this call: who the agent is, whose permission it carries, the action, the resource and the risk. It is a decision, not a prompt the model answers.",
    deny: "The policy engine says no. The decision is made before the tool is touched, so a manipulated agent still meets the same answer.",
    held: "The policy engine does not refuse and does not wave it through. It asks for more: a second factor or a person.",
    constrained: "The lab's fare rule does not refuse and does not stop for anyone. It allows the call with a limit: the booking may go ahead, but only in economy. The agent's ask for business is not granted. This outcome is the lab's own, not a PingOne Authorize one.",
    point: "The decision and the policy named on it.",
  },
  "tools-call-challenge": { agenda: "call", say: "The agent tries the tool call. With no token the gateway turns it away. The enforcement point is the gateway, not the model.", point: "The 401 on the tools/call request." },
  "gateway-check": {
    agenda: "evaluate",
    say: "The gateway checks the delegated token: signature, audience, expiry, that an agent is acting for a person, and that the scope covers this tool.",
    deny: "A check failed and the gateway stops the call here. Nothing is forwarded to the tool.",
    held: "The gateway holds the call. It waits for approval before anything is forwarded.",
    point: "The filter chain: each check passes or the first one that fails.",
  },
  "tool-dispatched": { agenda: "allow", say: "The call is allowed and goes through. A low-risk read like this one needs nobody's approval, and the record is still written.", constrained: "The call goes through with the narrowed arguments: economy, not the business the agent asked for. Nobody was asked, and the record says what was narrowed.", point: "The tool result and the allowed decision. Nobody was asked." },
  "tool-refused": { agenda: "escalate", say: "The call is refused. Nothing reached the tool and no data moved. The agent gets a clear no.", point: "The refusal and the reason it names." },
  "tool-held": { agenda: "escalate", say: "A risky write stops here. It waits for a second factor or a person, and nothing is changed until that happens.", point: "The held status and what it is waiting for." },
  "api-call": { agenda: "allow", say: "The tool calls the Appfire back-end with the person's delegated access. The service sees who it is acting for, not just that an agent called.", constrained: "The back end receives the narrowed booking: economy. It never sees the business the agent asked for.", point: "The request to the resource server and its answer." },
  "agent-reply": { agenda: "audit", say: "The agent answers in plain words. Behind that sentence is every step you just saw, and each one is recorded.", point: "The reply, then the decision card: agent, person, tool, policy, outcome." },
  "step-up": { agenda: "escalate", say: "A riskier write needs a second factor from the person before it goes ahead.", point: "The step-up request and the person's answer." },
  "intent-binding-verified": { agenda: "escalate", say: "The approval is tied to this exact action. An approval for one action cannot be reused for another.", point: "The intent the approval was bound to." },
  "vault-key-inject": { agenda: "evaluate", say: "The gateway adds the tool's own key. The agent never holds it.", point: "The key is added by the gateway, not present on the agent's request." },
  "api-key-swap": { agenda: "evaluate", say: "The gateway swaps the agent's token for the credential the back-end expects. The back-end never sees the agent's token.", point: "The two different credentials on either side of the gateway." },
  "database-query": { agenda: "allow", say: "The data layer is reached only through the service, never by the agent directly.", point: "The service as the only caller of the database." },
  guided: { agenda: "start", say: "This use case is a guided page, not a computed run. It shows the idea and what to say about it; the outcome is the catalog's label.", point: "The 'guided, not computed' label." },
  "a2a-agent-card": { agenda: "identity", say: "Before one agent delegates to another, it reads the other agent's published card: who it is and what it offers.", point: "The agent card the other agent publishes." },
  "a2a-exchange-1": { agenda: "identity", say: "The first agent's authority is narrowed for the first delegation. Each hop can only reduce what it was given.", point: "The act chain growing and the scopes shrinking." },
  "a2a-exchange-2": { agenda: "identity", say: "A second delegation. The chain now names every agent that acted, in order.", point: "The nested act claims." },
  "a2a-protocol-message": { agenda: "call", say: "The agents talk to each other over the agent-to-agent protocol, carrying the delegated token with them.", point: "The message and the token it carries." },
  "a2a-protocol-bearer": { agenda: "call", say: "The receiving agent checks the bearer token like the gateway does: the chain, the audience and the scope.", point: "The checks on the received token." },
  "a2a-mismatch-probe": { agenda: "evaluate", say: "A probe with a token meant for someone else. It is refused: a token is good only for the party it was issued to.", point: "The refusal and the mismatched audience.", deny: "A probe with a token meant for someone else. It is refused: a token is good only for the party it was issued to." },
  "personal-agent-lookup": { agenda: "identity", say: "The system looks up which agents this person has registered. An agent that is not registered does not get in.", point: "The registry's answer: is this agent registered for this person." },
  "enterprise-managed-mode": { agenda: "evaluate", say: "The organization's policy decides which agents may act at all, whatever an individual user would prefer.", point: "The enterprise policy applied." },
  "hitl-receipt": { agenda: "escalate", say: "A person approved this action, and the approval is a record: who approved what, and when.", point: "The approval receipt.", held: "A person approved this action, and the approval is a record: who approved what, and when." },
  "sim-rar-armed": { agenda: "escalate", say: "The request names exactly what it wants to do, so what the person approves is that action and not a general permission.", point: "The detailed authorization request." },
  "id-jag-issued": { agenda: "identity", say: "The identity provider issues a short-lived assertion that the person's session can be used by this agent against another trust domain.", point: "The assertion and its short lifetime." },
  "id-jag-redeemed": { agenda: "identity", say: "The other domain redeems the assertion for its own access token, after checking the issuer.", point: "The access token issued in exchange." },
  "verified-trust-issuance": { agenda: "identity", say: "The agent presents a signed statement of what it is. The receiver can verify it without calling back.", point: "The signed assertion." },
  "ciba-authorize": { agenda: "escalate", say: "The person is asked for approval out of band, on their own device, while the agent waits.", point: "The approval request sent to the person." },
  "ciba-poll": { agenda: "escalate", say: "The person approved on their device and the agent now has what it needs to continue.", point: "The approved result and the token it unlocks." },
  "exchange-skipped": { agenda: "evaluate", say: "The exchange did not happen, so there is no delegated token. The gateway will not take the person's token in its place.", point: "The refusal and that no act claim was ever issued.", deny: "The exchange did not happen, so there is no delegated token. The gateway will not take the person's token in its place." },
  "privilege-gateway-leg": { agenda: "evaluate", say: "The call passes through the gateway that enforces the agent's own grants, which sit on top of the person's.", point: "The gateway's decision on the agent's grant." },
  "credential-swap": { agenda: "evaluate", say: "The gateway puts the tool's own credential on the call. The agent never holds it.", point: "The credential on the downstream call." },
};

// Fallback for a kind with no entry (a new hop kind before its caption is written): say what the step is without inventing anything.
// A run answered by a tool server (hop.capability "tools", the server's own data) has no gateway and no policy engine in it: these replace the captions that name them.
const TOOL_SERVER_CAPTIONS = {
  "authorize-decision": {
    say: "Before the tool runs, the tool server applies its rules to this call: who the agent is, whose permission it carries, the scope, the tier group and the size of the change. It is a rule decision, not a prompt the model answers.",
    deny: "The tool server says no. The decision is made before the tool is touched, so a manipulated agent still meets the same answer.",
    held: "The tool server does not refuse and does not wave it through. It asks for more: a second factor or a person.",
    point: "The decision and the rule named on it.",
  },
  "gateway-check": {
    say: "The tool server checks the delegated token: signature against the issuer's keys, audience, expiry, that an agent is acting for a person, and that the scope covers this tool.",
    deny: "A check failed and the tool server stops the call here. Nothing reaches the tool.",
    held: "The tool server holds the call. It waits for approval before anything runs.",
    point: "The checks: each passes or the first one that fails.",
  },
};

// A decision PingOne Authorize really made on an airline booking (hop.decidedBy "pingone-authorize"), or one it was asked for and did not make ("none"). NOT part of
// CAPTIONS (the golden hashes that table). The division of labour is always: Authorize answers, the tool server enforces, the lab's own approval service approves.
export const AUTHORIZE_CAPTIONS = {
  say: "The tool server sent PingOne Authorize the booking: the fare, whether the trip is international, the cabin asked and whether a person has approved. PingOne Authorize answers with a decision and the tool server enforces it. The model has no say.",
  deny: "PingOne Authorize says no. The tool server refuses the booking and nothing is run.",
  held: "PingOne Authorize returned PERMIT with a statement the lab reads as: a person or a second factor must come first. The tool server holds the booking. The approval itself runs on the lab's own approval service.",
  constrained: "PingOne Authorize returned PERMIT with a statement the lab reads as: economy only. The tool server applies it, so the agent's ask for business is not granted. The rule is the policy the owner wrote in PingOne Authorize.",
  nodecision: "PingOne Authorize gave no decision. The tool server booked nothing and did not use its own rule instead.",
  point: "The decision, the statement code PingOne Authorize returned, and the raw request and answer.",
};

const GENERIC = { agenda: null, say: "This is one step of the run. Open its detail for the request, the response and the decision.", point: "The request and the response below." };

// authorize: PingOne Authorize was asked and no decision came back. `decidedBy: "none"` alone is not enough (a lab-policy run with no answer at all carries it too): the
// hop's own `decision.by` must say that PingOne Authorize gave no decision.
const authorizeNoDecision = (hop) => hop?.kind === "authorize-decision" && hop?.decidedBy === "none" && String(hop?.decision?.by || "").startsWith("PingOne Authorize gave no decision");

const verdictOf = (hop) => {
  if (authorizeNoDecision(hop)) return "nodecision";
  const outcome = typeof hop?.decision?.outcome === "string" ? hop.decision.outcome : "";
  if (hop?.verdict === "deny" || /^deny/i.test(outcome)) return "deny";
  if (hop?.verdict === "held" || /^(held|escalat|hitl)/i.test(outcome)) return "held";
  // fare: the lab's own CONSTRAINED outcome (the decision hop) or the narrowed arguments (the tool and API hops carry a `constraint` row)
  // A Real booking the tool server narrowed: its tool hop carries the server's fixed note (the cabin narrowed to economy), and its decision hop the word CONSTRAINED.
  if (hop?.capability === "tools" && typeof hop?.note === "string" && /cabin narrowed to economy/.test(hop.note)) return "constrained";
  // authorize: PingOne Authorize returned PERMIT with a statement the lab reads as economy only; `decision.outcome` is what it returned, `authorize.outcome` the lab's reading.
  if (hop?.decidedBy === "pingone-authorize" && hop?.authorize?.outcome === "CONSTRAINED") return "constrained";
  if (outcome === "CONSTRAINED" || (Array.isArray(hop?.kv) && hop.kv.some((r) => (Array.isArray(r) ? r[0] : r?.k ?? r?.key) === "constraint"))) return "constrained";
  return "ok";
};

// The caption for one hop: { say, point, agenda, notInPath, real }. `real` is true only for a hop that really ran on the real path.
export function captionFor(hop) {
  if (!hop || typeof hop !== "object") return null;
  if (hop.verdict === "skip") return { ...NOT_IN_PATH, agenda: CAPTIONS[hop.kind]?.agenda ?? null, notInPath: true, real: false };
  const base = Object.hasOwn(CAPTIONS, hop.kind) ? CAPTIONS[hop.kind] : GENERIC;
  const c = hop.capability === "tools" && Object.hasOwn(TOOL_SERVER_CAPTIONS, hop.kind) ? { ...base, ...TOOL_SERVER_CAPTIONS[hop.kind] } : base;
  const v = verdictOf(hop);
  // authorize: a booking decision PingOne Authorize made (or was asked for and did not make) has its own words; a lab-policy decision keeps the tool server's.
  if (hop.kind === "authorize-decision" && (hop.decidedBy === "pingone-authorize" || authorizeNoDecision(hop))) {
    return { say: (v !== "ok" && AUTHORIZE_CAPTIONS[v]) || AUTHORIZE_CAPTIONS.say, point: AUTHORIZE_CAPTIONS.point, agenda: c.agenda, notInPath: false, real: hop.source === "real" };
  }
  // A booking is a write, not a low-risk read: the airline booking's allowed hop says so in its own words (read from the tool name the hop carries).
  if (hop.kind === "tool-dispatched" && v === "ok" && hop.request?.calls?.[0]?.body?.name === "book_airline_flight") {
    return { say: "The booking is allowed and goes through as asked. A booking within the limits needs nobody's approval, and the record is still written.", point: c.point, agenda: c.agenda, notInPath: false, real: hop.source === "real" };
  }
  return { say: (v !== "ok" && c[v]) || c.say, point: c.point, agenda: c.agenda, notInPath: false, real: hop.source === "real" };
}
