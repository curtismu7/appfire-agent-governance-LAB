// Catalog text a pack words its own way. data/usecases.json is generated from AI-DEMO2 and read only, and its titles, stories and chat chips are
// banking-flavoured ("My mortgage", "transfer $600 from checking to savings"). A pack with an entry here shows these words instead, everywhere the
// catalog's words reach the page or a run: the use case list, the starter cards, the tooltips, the Why list, the run panel, the history, the hop
// narratives, the narration and the Demo guide. A pack with no entry (banking, healthcare, retail) is untouched, byte for byte.
// The expected outcome, the track, the tool role and every number stay the catalog's: only words move. Chat chip text is not here: it comes from the
// pack's own What to type list (data/prompts.json), see `localize` in routes.js.
export const VERTICAL_TEXT = {
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
