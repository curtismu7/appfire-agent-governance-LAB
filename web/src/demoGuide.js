// The step-by-step demo guide, in the order of the Appfire session agenda ("Demo walkthrough": one agent workflow, request to audit record,
// shown alongside HIVE's back-end role). One entry per step. Each carries three customer-safe fields: what the step is (req, the agenda's words),
// how this lab shows it (prove, naming the use case to run and the thing to point at) and the talking points the presenter says (say).
// `ucs` wires the Run buttons: one button per use case; a step with none is a look-and-listen step.
// Every string may carry {{castUser}}-style tokens (the vertical's cast) and {{prompt:UC1|fallback}} (that use case's typed prompt in the vertical's
// What to type list); `guideStep` / `fillGuide` fill them, so one walkthrough reads naturally in every vertical (software, banking, healthcare, retail).
export const DEMO_GUIDE = [
  {
    id: "start",
    prompts: ["UC1"],
    short: "Start",
    title: "1 · A person or application starts an AI-assisted workflow",
    req: "An authenticated user or application starts an AI-assisted workflow.",
    prove: "Run {{prompt:UC1|a low-risk read}}. The sequence opens with the sign-in and prompt hops: {{castUser}} signs in to {{castBrand}} and asks {{castAgent}} for something. HIVE is never called.",
    say: "The workflow starts the way it does today: a person signs in to an application and asks for something. Nothing about the agent is trusted yet.",
    ucs: [{ uc: "UC1", label: "Start the workflow: a low-risk read" }],
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
    prove: "The highlighted step in the sequence is the decision. Run {{prompt:UC21|“Entitlement-tiered capability”}} twice, as the premium customer and as the standard customer: same tool, same {{castAsset}}, a different person, a different decision. With a PingOne sign-in the tier is your PingOne group: flip your user in or out of the {{castGroup}} group in PingOne, Sign out, sign in again and run it again. The Decision card names the policy that applied.",
    say: "Every call gets its own decision: identity, entitlement, action, resource, risk. It is a policy evaluation you can audit, not a prompt the model answers.",
    ucs: [{ uc: "UC21", label: "Evaluate a call: entitlement tiers" }],
  },
  {
    id: "allow",
    prompts: ["UC1", "UC30"],
    short: "Allowed",
    title: "5 · A low-risk read is allowed automatically",
    req: "A low-risk, read-only request is allowed automatically.",
    prove: "Run {{prompt:UC1|a low-risk read}}: the Decision card says ALLOWED, the tool ran, and nobody was asked. The strip under it shows which of the four controls it landed on. Press Compare to see it beside a denied call. Where What to type lists a third-party MCP call the agent is allowed to use, run it too: the gateway's edge policy lets it through, and the next step shows the same tool refused.",
    say: "Reads flow. Nobody approves a read, and the record is still written.",
    ucs: [{ uc: "UC1", label: "Run a low-risk read" }],
  },
  {
    id: "escalate",
    prompts: ["UC7", "UC8", "UC22", "UC6", "UC31", "UC10", "UC27", "UC13"],
    short: "Risk",
    title: "6 · A higher-risk request is denied, constrained or sent for approval",
    req: "A higher-risk write or sensitive-data request is denied, constrained or routed for approval, based on policy.",
    prove: "Run the buttons in order. {{prompt:UC7|The first write}} steps up (ESCALATED: a second factor). {{prompt:UC8|The next write}} needs a person (ESCALATED: approve it on the phone). {{prompt:UC6|The largest write}} is refused (DENIED), and so is the third-party call outside what the agent may use. The actor-injection attack is refused too: nothing is dispatched. The typed prompts for this step add more refusals where the vertical lists them: another person's private {{castAsset}}, an approval the agent forged, and a lower rung of human approval. “Poisoned instructions” and “Compare two runs” open the Compare page side by side: a careful agent against one told to ignore its limits, and a held write against a refused one. The amounts are the lab's own; Appfire sets the real ones in policy.",
    say: "Controlled autonomy. A risky write stops for a second factor, a riskier one for a person, and an out-of-bounds one is refused. A manipulated agent still meets the same decision, because the enforcement point is not the model.",
    ucs: [
      { uc: "UC7", label: "Higher risk: needs a second factor" },
      { uc: "UC8", label: "Higher risk: needs a person's approval" },
      { uc: "UC6", label: "Out of bounds: refused" },
      { uc: "UC31", label: "Out of scope: refused" },
      { uc: "UC13", label: "Manipulated agent: refused" },
      // These two do not run a use case: they open the Compare page at the named pair.
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

// The airline pack's own words for the steps that talk about the fare rule (applied when the cast has `castFareRule`; every other pack keeps DEMO_GUIDE byte for byte).
// The rule in one breath is the same sentence everywhere; its two numbers are the cast's `castFareLimit` and `castFareHold`, never typed here. The limits are the lab's own.
export const GUIDE_OVERRIDES = {
  // Step 4: the airline pack runs UC21 on the lab's own steps, where the tier is the persona; no PingOne group of this pack exists to flip (it waits for the Real airline tools).
  evaluate: {
    prove: DEMO_GUIDE.find((g) => g.id === "evaluate").prove.replace(/ With a PingOne sign-in the tier is your PingOne group:.*?run it again\./, "").replace("premium customer and as the standard customer", "premium {{castPerson}} and as the standard {{castPerson}}"),
  },
  allow: {
    prove: DEMO_GUIDE.find((g) => g.id === "allow").prove.replace("which of the four controls", "which of the five controls"),
  },
  escalate: {
    prove: "The rule is two limits and one flag, and you can say it in one breath: a domestic booking up to {{castFareLimit}} is allowed as asked; an international booking, or one over {{castFareLimit}} and up to {{castFareHold}}, is booked but only in economy; over {{castFareHold}}, domestic or international, a person approves. Run the buttons in order. {{prompt:UC7|The first booking}} is ALLOWED: business, as asked. {{prompt:UC8|The next booking}} costs the same but is international, so it is CONSTRAINED: the agent asked for business, the traveller gets economy, and the Decision card says exactly that. The booking over {{castFareLimit}} is CONSTRAINED too, by its price. {{prompt:UC6|The largest booking}} goes to a person (ESCALATED: approve it on the phone). A request that only claims a manager's approval cannot show one, so it asks for a second factor first, and a person still approves a booking that large. The third-party call outside what the agent may use, the forged actor and another traveller's {{castAsset}} are refused (DENIED). “Poisoned instructions” makes the agent propose a $2,500 business booking: it is over {{castFareHold}}, so a person must approve it. “Compare two runs” opens the same fare side by side, domestic against international. The limits are the lab's own; Larkspur Air would set the real ones in policy.",
    say: "Controlled autonomy with one narrowing. A booking inside the limit just goes through. An international booking, or a pricier one, still goes through but only in economy, and the answer says what was narrowed. A very large one waits for a person. A claim of approval gets a second factor, and an out-of-bounds request is refused. A manipulated agent meets the same decision, because the enforcement point is not the model.",
    ucs: [
      { uc: "UC7", label: "Allowed as asked: domestic, up to {{castFareLimit}}" },
      { uc: "UC8", label: "Constrained: international, business becomes economy" },
      { uc: "UC48", label: "Constrained: over {{castFareLimit}}, business becomes economy" }, // runs from this button (guideRun runs a hand-off use case); picking it in the use-case list shows the hand-off card instead
      { uc: "UC6", label: "Needs a person's approval: over {{castFareHold}}" },
      { uc: "UC27", label: "Approval claimed, not proven: needs a second factor" },
      { uc: "UC31", label: "Out of scope: refused" },
      { uc: "UC13", label: "Manipulated agent: refused" },
      { compare: "careful-poisoned", label: "Poisoned instructions: a person must approve" },
      { compare: "same-fare", label: "Compare: same fare, domestic against international" },
    ],
  },
};

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
// `fare` (the airline pack): a prompt whose use case opens its own app never sits in a step's chips, so every chip under a step runs here (those prompts are listed
// under "Opens its own app"; the walkthrough's buttons still run them where a step has one).
export const promptsOfStep = (stepId, list, { fare = false } = {}) => {
  const step = DEMO_GUIDE.find((g) => g.id === stepId);
  return (step?.prompts || []).map((uc) => (list || []).find((p) => p.uc === uc)).filter((p) => p && !(fare && p.route === "Hand off"));
};
// The same list grouped by the first step each prompt belongs to, in agenda order, then the prompts no step uses. (A prompt shared by several steps is listed once.)
export function promptGroups(list, { fare = false } = {}) {
  const placed = new Set();
  const groups = DEMO_GUIDE.map((g, i) => ({ id: g.id, n: i + 1, short: g.short, items: promptsOfStep(g.id, list, { fare }).filter((p) => !placed.has(p.uc) && placed.add(p.uc)) })).filter((g) => g.items.length);
  const more = (list || []).filter((p) => !placed.has(p.uc));
  return { groups, more };
}


// ---- Filling the walkthrough for the vertical on screen ----
// Words used while the cast has not loaded yet, or when a vertical's cast lacks a key. They are vertical-neutral on purpose.
const CAST_FALLBACK = { castPerson: "customer", castUser: "the signed-in person", castUser2: "the premium person", castAgent: "the agent", castBrand: "the app", castAsset: "resource", castAction: "write", castGroup: "premium-tier" };
const GUIDE_TOKEN = /\{\{(prompt:UC[\d.]+|\w+)(?:\|([^{}]*))?\}\}/g;

// Fill {{castX}} from the vertical's cast and {{prompt:UCn|fallback}} from its What to type list (the prompt in curly quotes; the fallback, never quoted, when
// the vertical lists none). An unknown token is left as it is, so a typo shows up in a test instead of being swallowed. ctx = { cast, prompts }.
export function fillGuide(text, ctx = {}) {
  const cast = ctx.cast || {};
  return String(text).replace(GUIDE_TOKEN, (m, key, fallback) => {
    if (key.startsWith("prompt:")) {
      const hit = (ctx.prompts || []).find((p) => p.uc === key.slice(7));
      return hit?.text ? `“${hit.text}”` : fallback ?? "the matching prompt in What to type";
    }
    if (typeof cast[key] === "string" && cast[key]) return cast[key];
    if (Object.hasOwn(CAST_FALLBACK, key)) return CAST_FALLBACK[key];
    return m;
  });
}

// A walkthrough step with its words filled for the vertical: the same shape as the step, so a component reads it exactly as it read the static one.
export function guideStep(base, ctx) {
  if (!base) return base;
  const step = ctx?.cast?.castFareRule && Object.hasOwn(GUIDE_OVERRIDES, base.id) ? { ...base, ...GUIDE_OVERRIDES[base.id] } : base; // fare: the airline pack's words
  return { ...step, title: fillGuide(step.title, ctx), req: fillGuide(step.req, ctx), prove: fillGuide(step.prove, ctx), say: fillGuide(step.say, ctx), ucs: step.ucs.map((b) => ({ ...b, label: fillGuide(b.label, ctx) })) };
}
