// Catalog text a pack words its own way. data/usecases.json is generated from AI-DEMO2 and read only, and its titles, stories and chat chips are
// banking-flavoured ("My mortgage", "transfer $600 from checking to savings"). A pack with an entry here shows these words instead, everywhere the
// catalog's words reach the page or a run: the use case list, the starter cards, the tooltips, the Why list, the run panel, the history, the hop
// narratives, the narration and the Demo guide. A pack with no entry (banking, healthcare, retail) is untouched, byte for byte.
// The expected outcome, the track, the tool role and every number stay the catalog's: only words move (the one exception is OUTCOME_OVERRIDES below). Chat chip text is not here: it comes from the
// pack's own What to type list (data/prompts.json), see `localize` in routes.js.
export const VERTICAL_TEXT = {
  // The airline pack (Larkspur Air, an invented airline, the lab's default). The six that carry the story (UC7, UC8, UC6, UC27, UC22, UC48) are the lab's own
  // words for the lab's own fare rule, none is a product claim; UC48's solution sentence says so because the catalog's own says the product HOLDS that booking.
  airline: {
    UC33: {
      title: 'Flight status',
      buyerStory: "Delegated-access proof can't be special-cased per tool: every kind of trip data the agent touches needs the same chain of custody, not just the everyday trip lookup.",
      pingOneSolution: 'The same RFC 8693 delegated token (act={agent}) authorizes every tool call, including less-common ones such as a flight status check: one token exchange covers the whole tool surface.',
    },
    UC7: {
      title: 'Booking within the limit',
      buyerStory: "A traveller's agent books a domestic business seat at or under the price limit: nothing in policy restricts it.",
      pingOneSolution: "The lab's own fare rule allows it as asked; the delegated token and the gateway checks still run and the call is recorded.",
    },
    UC8: {
      title: 'International booking, economy only',
      buyerStory: 'The agent asks for business on an international trip. The booking goes through, but only in economy, and the answer says exactly that.',
      pingOneSolution: "The lab's own fare rule returns a permit that narrows the cabin from business to economy; whether a product policy can narrow a request argument this way is not claimed here.",
    },
    UC6: {
      title: 'Booking over the higher limit',
      buyerStory: 'A booking above the second limit is not decided by the agent or the rule alone: a person approves it.',
      pingOneSolution: 'The decision is an approval obligation; the booking waits until a person approves, and the approval is a receipt the gateway verifies.',
    },
    UC27: {
      title: 'Approval claimed, not proven',
      buyerStory: 'The request says a manager already approved the trip, but nothing proves it.',
      pingOneSolution: 'A claim is not an approval: the lab asks for a second factor first, and because the booking is over the second limit a person still has to approve it. The claim never lowers the control.',
    },
    UC22: {
      title: 'Approval on your own phone',
      buyerStory: "A change to an existing booking is approved on the traveller's own device while the agent waits.",
      pingOneSolution: 'The decision is a CIBA obligation: the backend asks the identity provider to approve out of band, then retries the call.',
    },
    UC48: {
      buyerStory: 'A consumer agent asked to "book me a business seat to Boston for $780" must prove who it acts for, accept the price policy, and is booked in economy because the fare is over the limit.',
      pingOneSolution: "The lab's own fare rule narrows this booking to economy. The catalog's reference setup for this use case instead holds a booking for a person's approval; this run does not show that.",
    },
    UC10: { title: 'Resource-ownership / trip takeover' },
    UC14b: {
      buyerStory: 'A booking that stays within its PAR (RFC 9126) request_uri authorization cap is verified and permitted: the legitimate counterpart to the PAR overage attack.',
      pingOneSolution: 'RFC 9126 PAR authorization details bind the booking to a fare cap; the MCP gateway and PingOne Authorize verify the requested booking against it before permitting.',
    },
    UC28: {
      pingOneSolution: 'The tool catalog itself is the authorization boundary: no tool can GRANT a waiver, so none can be promised, no matter what the LLM says.',
    },
    'UC-MUSE1': {
      buyerStory: 'Customers already run their own agents (Muse, Grok, LM Studio, LibreChat, ChatGPT) and want to use them against their trips and bookings without handing over credentials or losing protection.',
      pingOneSolution: 'The agent connects to the MCP external door: RFC 9728 discovery, RFC 7591 DCR self-registration, PKCE login in the user’s browser, then a delegated token (sub=user, act=agent) through PingGateway and PingOne Authorize on every tool call.',
    },
    'UC-LEARN3': {
      buyerStory: 'Explore the demo’s own MCP server the same way you would any MCP endpoint.',
      pingOneSolution: 'Inspects the demo’s MCP server: tool discovery, schema-driven invocation, and the live tool-call pipeline with token-exchange and Authorize gates.',
    },
    'UC-LEARN7': {
      buyerStory: 'The "before" picture: an AI agent rides the user’s logged-in browser session and books trips through the airline’s own site: full user power, no identity, no scope, no consent, no audit.',
      pingOneSolution: 'The contrast that motivates the Agent Gateway: session-riding tools like OpenCLI carry no agent identity or delegated token, so the demo records the booking as an ordinary user session, indistinguishable from the human. Governed access adds the RFC 8693 act-chain, PingOne Authorize decision, and an agent-attributed audit trail.',
    },
    'UC-LEARN13': {
      title: 'PingFederate RAR — the authorization server refuses an out-of-policy booking',
      buyerStory: 'An AI agent asks to book a flight for a traveller. The airline wants the authorization server, not the agent, to hold the line on whose trips, how much and in which cabin.',
    },
  },
  software: {
    UC33: {
      title: 'Deployment status',
      buyerStory: "Delegated-access proof can't be special-cased per tool: every kind of release data the agent touches needs the same chain of custody, not just the everyday issue lookup.",
      pingOneSolution: 'The same RFC 8693 delegated token (act={agent}) authorizes every tool call, including less-common ones such as a deployment status check: one token exchange covers the whole tool surface.',
    },
    UC10: { title: 'Resource-ownership / project takeover' },
    UC14b: {
      buyerStory: 'A bulk edit that stays within its PAR (RFC 9126) request_uri authorization cap is verified and permitted: the legitimate counterpart to the PAR overage attack.',
      pingOneSolution: 'RFC 9126 PAR authorization details bind the bulk edit to a cap on the number of issues; the MCP gateway and PingOne Authorize verify the requested edit against it before permitting.',
    },
    UC22: {
      buyerStory: "An AI agent has no browser to prompt for step-up. When it performs a sensitive action, approval must be requested out-of-band on the user's own device, driven by the action and the agent context, not by the size of the change alone.",
      pingOneSolution: 'Because an agent is acting (no browser redirect) on a sensitive bulk edit, PingOne Authorize returns a CIBA obligation. The backend calls bc-authorize and polls for the auth_req_id, proceeding only after the user approves out-of-band on their phone.',
    },
    UC28: {
      pingOneSolution: 'The tool catalog itself is the authorization boundary: no tool can GRANT site admin, so none can be promised, no matter what the LLM says.',
    },
    'UC-MUSE1': {
      buyerStory: 'Customers already run their own agents (Muse, Grok, LM Studio, LibreChat, ChatGPT) and want to use them against their work tools without handing over credentials or losing protection.',
      pingOneSolution: 'The agent connects to the MCP external door: RFC 9728 discovery, RFC 7591 DCR self-registration, PKCE login in the user’s browser, then a delegated token (sub=user, act=agent) through PingGateway and PingOne Authorize on every tool call.',
    },
    'UC-LEARN3': {
      buyerStory: 'Explore the demo’s own MCP server the same way you would any MCP endpoint.',
      pingOneSolution: 'Inspects the demo’s MCP server: tool discovery, schema-driven invocation, and the live tool-call pipeline with token-exchange and Authorize gates.',
    },
    'UC-LEARN7': {
      buyerStory: 'The "before" picture: an AI agent rides the user’s logged-in browser session and changes issues through the product’s own UI: full user power, no identity, no scope, no consent, no audit.',
      pingOneSolution: 'The contrast that motivates the Agent Gateway: session-riding tools like OpenCLI carry no agent identity or delegated token, so the demo records the bulk edit as an ordinary user session, indistinguishable from the human. Governed access adds the RFC 8693 act-chain, PingOne Authorize decision, and an agent-attributed audit trail.',
    },
    'UC-LEARN13': {
      title: 'PingFederate RAR — the authorization server refuses an out-of-policy bulk edit',
      buyerStory: 'An AI agent asks to change many issues for a user. The company wants the authorization server, not the agent, to hold the line on whose projects, how many issues and for which change.',
      pingOneSolution: 'PingFederate 13.1 receives the bulk edit as an authorization detail through PAR and runs a custom processor. It checks the request shape when it is pushed; after the user signs in it checks that the user is the one named, that both projects are theirs and that the number of issues is within their limit. A request that fails is refused.',
    },
    UC48: {
      buyerStory: 'A consumer agent asked to "book me a flight to Paris under 800 dollars" must prove who it acts for, accept the price policy, and pause for the human when the transaction is consequential.',
    },
  },
};

// The airline pack's expected outcomes that are NOT the catalog's label (the catalog has no CONSTRAINED use case, and its UC7, UC8, UC6 and UC48 labels
// describe the banking thresholds). Applied by `localize` in routes.js: the use case then carries labelSource 'lab' so the page says "the lab's label".
// Everything else the engine decides on stays the catalog's.
export const OUTCOME_OVERRIDES = { airline: { UC7: 'PERMIT', UC8: 'CONSTRAINED', UC6: 'HITL_REQUIRED', UC48: 'CONSTRAINED' } };
