// The step-by-step demo guide for the Appfire briefing (owner request 2026-11-12). One entry per requirement in the
// Appfire Agentic AI Demo Brief, in presentation order. Each step carries three customer-safe fields: what Appfire asked
// for (req), how this lab proves it (prove, naming the use case to run and the hop/evidence to point at), and the talking
// points the presenter says out loud (say). The uc field wires the Run button; steps without one are look-and-listen steps.
export const DEMO_GUIDE = [
  {
    id: "split",
    title: "1 · The split: HIVE manages the backend, Ping governs the front end",
    req: "Appfire's HIVE manages backend data policy and which MCP servers may be used. Doug asked how Ping manages the agent-facing front end: who or what the agent is, what it may do, under which conditions, and how each decision is enforced and recorded.",
    prove: "Look at the header and the banner. This lab is the front end: agent identity, delegated privilege, policy decisions, audit. HIVE is never called — it stays Appfire's. The Topology evidence view draws the boundary: Ping's hops in front, the HIVE-managed MCP eligibility behind the gateway.",
    say: "Nothing here replaces HIVE. HIVE stays the brain for backend data policy and MCP-server eligibility. What Ping adds is the front door: every agent action arrives with a proven identity and gets its own policy decision before HIVE or any MCP server is ever touched. Complement, not overlap.",
    uc: null,
  },
  {
    id: "identity",
    title: "2 · Agent IAM Core: the agent gets its own identity (delegation, not impersonation)",
    req: "How agents receive identity, authenticate, and operate with least-privilege access — with the agent's identity distinct from the user it acts for and from the downstream resource.",
    prove: "Run “show my balance” (UC1), then open the Tokens tab. You will see three tokens: the user's token (no act claim), the agent's own token (client credentials), and the delegated token whose act claim names triage-agent and whose sub is still the user. RFC 8693 token exchange — the hop list shows it.",
    say: "The agent is a first-class identity with its own token — it never pretends to be the user. After consent, a standards-based token exchange mints a delegated token that carries both facts: who it acts for, and which agent is acting. Every downstream system can see both, on every call.",
    uc: "UC1",
  },
  {
    id: "privilege",
    title: "3 · Agent Privilege: least privilege, scoped to the task",
    req: "How agent permissions and delegated privileges are defined and constrained — an agent given more scope than its task needs is the failure mode Doug called out.",
    prove: "Run UC4 “Overscoped agent”: the agent holds a scope its task never needed and the extra privilege is stripped before dispatch. Then run UC31 (third-party MCP server, out-of-scope call): the gateway refuses a call outside the agent's grant — DENY, nothing reaches the tool.",
    say: "Privilege is defined per agent per task, and enforced at the gateway — not trusted to the model's judgement. If the agent holds a scope its task doesn't need, you can watch it get narrowed. If it asks for something outside its grant, the gateway refuses before any tool runs.",
    uc: "UC4",
  },
  {
    id: "authorize",
    title: "4 · Agent Authorize: a policy decision on every action",
    req: "Authorization decisions for agent actions, tool calls, MCP servers, and data access — evaluated with identity, delegated permissions, requested action, resource, and risk context.",
    prove: "Run “check my sensitive account details for tier access” (UC21, PERMIT) and then UC9 (same resource, standard persona, DENY_403). Same tool, same data — the decision changes with who is asking and what they are entitled to. Each hop shows the raw authorize request and response.",
    say: "Every single call gets a decision: identity, entitlement, action, resource, risk. Here the same sensitive-data tool permits a premium-tier customer and denies a standard one. The decision is a policy evaluation you can audit — not a prompt the model might follow.",
    uc: "UC21",
  },
  {
    id: "hitl",
    title: "5 · Risk-based approval — controlled autonomy, not per-action approval",
    req: "Appfire does not want a human approving every agent action. Low-risk read-only actions proceed automatically; higher-risk actions need step-up or human approval; policy distinguishes read, write, sensitive data, and production.",
    prove: "Three runs, one story. UC1 (read) auto-PERMITs — nobody was asked. “transfer $600” (UC7) is STEP_UP: MFA before the write. “transfer $300 from a step-up context” (UC8) is HITL_REQUIRED: a human approval receipt is checked before the tool dispatches. The obligation is visible on the held hop.",
    say: "This is the heart of it: controlled autonomy. Reads flow with no human in the loop. A risky write stops for step-up. A riskier one stops for an actual human approval, and the approval is a receipt the gateway verifies — not a checkbox in the chat. The policy, not a person per click, decides which is which.",
    uc: "UC7",
  },
  {
    id: "injection",
    title: "6 · Prompt injection and the compromised agent",
    req: "Reduce the blast radius of a manipulated agent by enforcing permissions at the tool, data, and action layers — not by trusting the model to follow instructions.",
    prove: "Run the attacks: UC13 (confused-deputy actor injection — a forged actor claim is refused), UC14 (intent exceeded — the agent tries more than the pushed authorization allows), UC16b (raw user-token forwarding — zero-trust refusal). Every one ends in DENY with nothing dispatched.",
    say: "Assume the agent will be manipulated eventually — prompt injection is a when, not an if. So the enforcement point is not the model. A compromised agent still carries the same scopes, still hits the same gateway, still gets the same policy decision. The worst case is a denied call and an audit record, not a data breach.",
    uc: "UC13",
  },
  {
    id: "audit",
    title: "7 · Visibility and auditability: who did what, for whom, and why",
    req: "Which agent acted, on whose behalf, which tool or data it tried, what policy decision applied, whether access was allowed / denied / escalated — and a trail you can investigate.",
    prove: "Open Run history: every run is listed with its outcome. Click any run into the Sequence view: each hop carries its raw request, raw response, a W3C traceparent, and a REAL/MOCK tag. The Tokens tab shows the full act chain. This is the governance record, per action.",
    say: "Every hop you have seen today is also a record: agent, principal, tool, decision, verdict, trace id. When your AI Governance team or Doug's CISO org asks “what did that agent do and who allowed it”, the answer is a query, not an investigation.",
    uc: null,
  },
  {
    id: "close",
    title: "8 · Close: standards today, HIVE tomorrow",
    req: "Appfire wants standards for deploying and operating agents across environments, and clarity on how Ping complements the existing AI Governance program.",
    prove: "Recap with the Diagram tab: the same delegation chain drawn end to end (movable boxes, Simulate walks it hop by hop). Everything shown runs on OAuth 2.0 / OIDC, RFC 8693 token exchange, and MCP — standards Appfire can adopt per environment without a fork in the architecture.",
    say: "Everything you saw is standard protocols — OIDC sign-in, RFC 8693 delegation, MCP tool calls — so it deploys the same in dev and production. HIVE keeps the backend; Ping gives every agent action an identity, a decision, and a record. That is governed autonomy without approving every step.",
    uc: null,
  },
];
