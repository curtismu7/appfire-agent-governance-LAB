// The step-by-step demo guide, in the order of the Appfire session agenda ("Demo walkthrough": one agent workflow, request to audit record,
// shown alongside HIVE's back-end role). One entry per step. Each carries three customer-safe fields: what the step is (req, the agenda's words),
// how this lab shows it (prove, naming the use case to run and the thing to point at) and the talking points the presenter says (say).
// `ucs` wires the Run buttons: one button per use case; a step with none is a look-and-listen step.
export const DEMO_GUIDE = [
  {
    id: "start",
    prompts: ["UC1"],
    short: "Start",
    title: "1 · A person or application starts an AI-assisted workflow",
    req: "An authenticated user or application starts an AI-assisted workflow.",
    prove: "Run “show my balance”. The sequence opens with the sign-in and prompt hops: alex.morgan signs in to the Appfire app and asks for something. The simulation banner says what is mock; HIVE is never called.",
    say: "The workflow starts the way it does today: a person signs in to an application and asks for something. Nothing about the agent is trusted yet.",
    ucs: [{ uc: "UC1", label: "Start the workflow: a balance request" }],
  },
  {
    id: "identity",
    prompts: ["UC1"],
    short: "Identity",
    title: "2 · The agent gets its own identity and acts on behalf of the person",
    req: "The agent receives its own identity and acts on behalf of the requesting principal.",
    prove: "Open the Tokens tab: the person's token, the agent's own token (client credentials) and the delegated token, whose sub is the person and whose act names the agent. The Decision card repeats it: which agent acted, on whose behalf.",
    say: "The agent is its own identity: not the user, not the application. The delegated token says both things at once: who asked, and who acted for them.",
    ucs: [{ uc: "UC1", label: "Run the workflow, then open Tokens" }],
  },
  {
    id: "call",
    prompts: ["UC1"],
    short: "Tool call",
    title: "3 · The agent tries to call an MCP tool",
    req: "The agent attempts to call an MCP tool or access a protected resource.",
    prove: "In the sequence, find the tools/call hops: first with no token (the gateway answers 401), then with the delegated token. The tool the model proposed is on the Decision card. The dashed HIVE lane at the far right is where Appfire's back-end policy and MCP-server eligibility sit; the lab never calls it.",
    say: "The agent proposes the call. It does not get to decide it. HIVE keeps its back-end role: data policy and which MCP servers may be used. What Ping adds is everything in front of that.",
    ucs: [{ uc: "UC1", label: "Run the workflow, then find the tool call" }],
  },
  {
    id: "evaluate",
    prompts: ["UC21", "UC9"],
    short: "Evaluate",
    title: "4 · Ping evaluates the call",
    req: "Ping evaluates the request using agent identity, delegated permissions, the requested action, the resource and risk context.",
    prove: "The highlighted step in the sequence is the decision. Run “Entitlement-tiered capability” twice, as the premium customer and as the standard customer: same tool, same data, a different person, a different decision. In Real mode the tier is your PingOne group: flip your user in or out of the premium-tier group in PingOne, Sign out, sign in again and run it again. The Decision card names the policy that applied.",
    say: "Every call gets its own decision: identity, entitlement, action, resource, risk. It is a policy evaluation you can audit, not a prompt the model answers.",
    ucs: [{ uc: "UC21", label: "Evaluate a call: entitlement tiers" }],
  },
  {
    id: "allow",
    prompts: ["UC1"],
    short: "Allowed",
    title: "5 · A low-risk read is allowed automatically",
    req: "A low-risk, read-only request is allowed automatically.",
    prove: "Run “show my balance”: the Decision card says ALLOWED, the tool ran, and nobody was asked. The strip under it shows which of the four controls it landed on. Press Compare to see it beside a denied call.",
    say: "Reads flow. Nobody approves a balance check, and the record is still written.",
    ucs: [{ uc: "UC1", label: "Run a low-risk read" }],
  },
  {
    id: "escalate",
    prompts: ["UC7", "UC8", "UC6", "UC13"],
    short: "Risk",
    title: "6 · A higher-risk request is denied, constrained or sent for approval",
    req: "A higher-risk write or sensitive-data request is denied, constrained or routed for approval, based on policy.",
    prove: "Run the buttons in order. $600 steps up (ESCALATED: a second factor). $300 needs a person (ESCALATED: approve it on the mock phone). $2500 is refused (DENIED), and so is the third-party call outside what the agent may use. The actor-injection attack is refused too: nothing is dispatched. “Poisoned instructions” and “Compare two runs” open the Compare page (always Mock) side by side: a careful agent against one told to ignore its limits, and a held write against a refused one. The amounts are the lab's own; Appfire sets the real ones in policy.",
    say: "Controlled autonomy. A risky write stops for a second factor, a riskier one for a person, and an out-of-bounds one is refused. A manipulated agent still meets the same decision, because the enforcement point is not the model.",
    ucs: [
      { uc: "UC7", label: "Higher risk: needs a second factor" },
      { uc: "UC8", label: "Higher risk: needs a person's approval" },
      { uc: "UC6", label: "Out of bounds: refused" },
      { uc: "UC31", label: "Out of scope: refused" },
      { uc: "UC13", label: "Manipulated agent: refused" },
      // These two do not run a use case: they open the Compare page (always Mock) at the named pair.
      { compare: "careful-poisoned", label: "Poisoned instructions: refused" },
      { compare: "ask-refuse", label: "Compare two runs" },
    ],
  },
  {
    id: "audit",
    prompts: ["UC35", "UC34"],
    short: "Audit",
    title: "7 · The decision history is there for audit",
    req: "The full decision history is available for audit and investigation: which agent acted, on whose behalf, which tool or resource, which policy applied, and whether access was allowed, denied or escalated.",
    prove: "Open Run history: every run is listed with its outcome, and each opens into the sequence with every hop's raw request, raw response and trace id. The Decision card shows the same five facts for the run on screen.",
    say: "Every call you saw is a record: agent, person, tool, policy, decision, trace id. When AI Governance asks what that agent did and who allowed it, the answer is a query, not an investigation.",
    ucs: [],
  },
];

// The session agenda's seven timed topics (the 60 minutes). Only two are run in the lab; the rest are covered in the slide deck.
export const TOPICS = [
  { time: "0:00", title: "Welcome and objectives", inLab: false },
  { time: "0:05", title: "Appfire today", inLab: false },
  { time: "0:15", title: "Agent identity and least privilege", inLab: false },
  { time: "0:25", title: "Demo: authorizing agent and MCP actions", inLab: true },
  { time: "0:40", title: "Risk-based approval and prompt-injection containment", inLab: true },
  { time: "0:50", title: "Model gateway and routing", inLab: false },
  { time: "0:55", title: "Next steps", inLab: false },
];

// The timed topic a walkthrough step belongs to: steps 1 to 5 are the 0:25 demo, steps 6 and 7 are the 0:40 topic. Unknown step: null.
export function topicOfStep(stepId) {
  if (["start", "identity", "call", "evaluate", "allow"].includes(stepId)) return TOPICS.find((t) => t.time === "0:25");
  if (["escalate", "audit"].includes(stepId)) return TOPICS.find((t) => t.time === "0:40");
  return null;
}

// A step's button is either a run (`uc`) or the Compare page at a named pair (`compare`). The key and test id name whichever it is.
export const buttonKey = (b) => b.uc ?? `compare-${b.compare}`;

// The typed prompts (What to type) that belong to a step, in the step's order, from the vertical's own list. `prompts` on a step names use cases; the words
// come from data/prompts.json, so every vertical (and a future industry pack) follows the same walkthrough.
export const promptsOfStep = (stepId, list) => {
  const step = DEMO_GUIDE.find((g) => g.id === stepId);
  return (step?.prompts || []).map((uc) => (list || []).find((p) => p.uc === uc)).filter(Boolean);
};
// The same list grouped by the first step each prompt belongs to, in agenda order, then the prompts no step uses. (A prompt shared by several steps is listed once.)
export function promptGroups(list) {
  const placed = new Set();
  const groups = DEMO_GUIDE.map((g, i) => ({ id: g.id, n: i + 1, short: g.short, items: promptsOfStep(g.id, list).filter((p) => !placed.has(p.uc) && placed.add(p.uc)) })).filter((g) => g.items.length);
  const more = (list || []).filter((p) => !placed.has(p.uc));
  return { groups, more };
}

