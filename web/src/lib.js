// Labels and small pure helpers shared by the components. No colours here: state words go to data-state attributes and the stylesheet maps them to tokens.

export const TRACK_LABELS = {
  foundations: "Foundations",
  learn: "Learn",
  controls: "Controls",
  hitl: "Human in the loop",
  demo: "Demos",
  attacks: "Attacks",
  tools: "Tools",
  nhi: "Federated identity (NHI)",
};

export const NEEDS_LABELS = {
  idp: "identity provider",
  gw: "gateway",
  authz: "policy decision",
  mfa: "step-up (MFA)",
  llm: "language model",
  privilege: "Privilege",
  bff: "app backend (BFF)",
  a2a: "agent to agent",
};

// Extra pages a use case can open (the manifest's `opens` field). They are not in the side nav until a run brings one in, and Reset removes them.
// `kinds` picks which hops of the run belong on that page (prefix match when it ends in a dash); an empty match shows every hop.
export const EXTRAS = {
  consent: { label: "Consent and step-up", about: "The product shows the consent and step-up screens on their own page. Here you see the sign-in, consent and actor-token hops of your run.", kinds: ["sign-in", "consent", "actor-token"] },
  approval: { label: "Human approval", about: "The product holds a risky write until a person approves it. Here you see the hops that decide, hold and release it.", kinds: ["authorize-decision", "tool-held", "hitl-receipt", "ciba-authorize", "ciba-poll"] },
  a2a: { label: "Agent to agent", about: "The product shows agent-to-agent calls on their own page. Here you see the agent-card, delegation and trust hops of your run.", kinds: ["a2a-", "verified-trust-issuance", "personal-agent-lookup", "id-jag-", "privilege-gateway-leg"] },
  "group-board": { label: "Group policy", about: "The product shows which group may use a sensitive tool on a group-policy board. Here you see the decision and the tool hops of your run.", kinds: ["authorize-decision", "tool-refused", "tool-dispatched"] },
  obo: { label: "On behalf of", about: "The product shows the on-behalf-of exchange on its own page. Here you see the token-exchange hops of your run.", kinds: ["token-exchange", "actor-token", "id-jag-", "exchange-skipped"] },
  "learning-link": { label: "Learning page", about: "This use case is a guided page in the product. The lab does not recompute it; it shows the page the product would open, as a plain label.", kinds: ["guided"] },
};

export const extraHops = (opens, hops) => {
  const spec = Object.hasOwn(EXTRAS, opens) ? EXTRAS[opens].kinds : [];
  const hit = hops.filter((h) => spec.some((k) => (k.endsWith("-") ? h.kind.startsWith(k) : h.kind === k)));
  return hit.length ? hit : hops;
};

// Hop counts count the hops that ran; the not-in-path ones (verdict skip) are named as "+M not in this run" wherever a total is shown.
export const ranCount = (hops) => (hops || []).filter((h) => h.verdict !== "skip").length;
export const notRunText = (hops, sep = " · ") => { const m = (hops || []).length - ranCount(hops); return m > 0 ? `${sep}+${m} not in this run` : ""; };

// An outcome word to a state. The word is always shown, so colour never carries the meaning alone.
export function outcomeState(outcome) {
  const o = String(outcome || "");
  if (o === "CONSTRAINED" || o === "REAL_CONSTRAINED") return "info"; // fare: a booked trip is never painted red (every other REAL_ word is)
  if (o.startsWith("DENY") || o === "PERMIT_THEN_DENY") return "bad";
  if (o === "STEP_UP" || o === "HITL_REQUIRED" || o === "CIBA") return "warn";
  if (o === "PERMIT" || o === "DELEGATE_AND_EXECUTE" || o === "LIVE_OK" || o === "REAL_PERMIT") return "ok";
  if (o === "REAL_HOLD" || o === "REAL_NO_DECISION") return "warn"; // no decision is neither a pass nor a refusal
  if (o.startsWith("REAL_")) return "bad";
  if (o.startsWith("LIVE_")) return "bad";
  return "info";
}

export const verdictState = (v) => (v === "ok" ? "ok" : v === "held" ? "warn" : v ? "bad" : "info");

// What the trigger of a use case is, as plain text. A link is a path inside the AI-DEMO2 product: shown as a label, never as a link.
export function triggerText(t) {
  if (!t) return "";
  if (t.type === "chip") return `chat chip: "${t.text}"`;
  if (t.type === "attack") return `staged attack: ${t.sim}`;
  if (t.type === "link") return `AI-DEMO2 page (label only): ${t.path}`;
  if (t.type === "edu") return `AI-DEMO2 panel (label only): ${t.panel}${t.tab ? ` / ${t.tab}` : ""}`;
  return String(t.type);
}

export const HOP_RE = /^[a-z0-9-]+$/;

// Search text for one use case, lower-cased.
export const haystack = (u) => `${u.id} ${u.title} ${u.track} ${u.buyerStory} ${u.expectedOutcome} ${u.needs.join(" ")} ${u.flag || ""} ${triggerText(u.trigger)}`.toLowerCase();

// A fresh W3C traceparent for the browser's call (rule 14). The server continues this trace, so the run's trace id is the one the browser started.
export function newTraceparent() {
  const bytes = new Uint8Array(24);
  const c = typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues ? window.crypto : { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) };
  c.getRandomValues(bytes);
  bytes[0] |= 1; bytes[16] |= 1; // never an all-zero id
  const h = (a) => [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `00-${h(bytes.slice(0, 16))}-${h(bytes.slice(16))}-01`;
}

// Rule 24: keys that matter in THIS lab's payloads, marked on the JSON panes (`hot`) beside the defaults (sub, act, aud, scope, ...):
// what the gateway was asked to run and what it did with it (decision, reason and error already show in the alert colour).
export const HOT_CALL = ["tool", "action", "name", "method", "obligation", "granted", "approved", "dispatched", "refused_by", "routing", "matched", "www-authenticate", "x-gw-audit-trail", "X-Gw-Audit-Trail"];
// ...and in the decoded tokens: the intent and authentication-methods claims the staged events add.
export const HOT_CLAIMS = ["intent", "amr"];

// The one neutral line that opens every page (rule 2): what is represented, and whose numbers these are. The hosted copy adds that nothing live is reached.
// The server serves the same two sentences (the story and the hosted banner); the page shows these when the server has not answered yet.
export const BANNER_LOCAL = "HIVE, Appfire's platform, is represented here and never called. Thresholds, personas and amounts are the lab's own (lab-invented); the use cases come from the AI-DEMO2 catalog.";
export const BANNER_HOSTED = "Hosted copy. HIVE, Appfire's platform, is represented and never called. Thresholds, personas and amounts are the lab's own (lab-invented). No tenant or live system is reached.";
// The vertical the page opens on (owner, 2026-11-16: the invented airline, Larkspur Air). The server's default (cast.js DEFAULT_VERTICAL) is the same id; the picker starts here.
export const DEFAULT_VERTICAL = "airline";
// The full packs whose own tool names the lab uses for a held write (server: the pack's `castToolServer`, the tool server the lab ships; the airline pack names its own booking tool too); the other packs keep the catalog's tool name.
export const OWN_TOOL_VERTICALS = ["software", "airline"]; // fare: the airline pack names its own booking tool

// Vertical names for prose. "sporting-goods" is "Sporting goods"; the full packs are the ones the server lists with pack "full", so a sentence that names them
// never goes stale when a pack is added.
export const verticalName = (id) => String(id || "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
export const joinOr = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`);
export const fullPackNames = (verticals) => (verticals || []).filter((v) => v.pack === "full").map((v) => verticalName(v.id));
// "Pick Software, Banking, Healthcare or Retail", from the loaded list; before it loads, a generic line.
export const pickFullPack = (verticals) => { const n = fullPackNames(verticals); return n.length ? `Pick ${joinOr(n)}` : "Pick one of the full-pack verticals"; };

// The hop the evidence opens on after a run: the one that decided or stopped it, else none (the visitor clicks).
export const focusHop = (run) => (run?.hops || []).find((h) => h.decision || (h.verdict && h.verdict !== "ok" && h.verdict !== "skip"))?.n ?? null;

// What the phone says it is asking about (owner, 2026-11-16: a use-case id means nothing to an audience): the agenda's words for the control that held
// the call, never the catalog id or title.
export function holdWords(outcome) {
  if (outcome === "STEP_UP") return "A higher-risk write needs a second factor";
  if (outcome === "HITL_REQUIRED") return "A higher-risk write needs a person to approve it";
  return "The gateway holds this call for approval";
}

// Use-case ids mean nothing to an audience (owner, 2026-11-16: "use cases are supposed to be removed, just use words for each use case"). The page shows each
// use case by its title; the id stays in the data, the API and the test ids. The titles are registered when the catalog loads, so a place that only holds an
// id (a history row, a session, a sentence in the catalog's own text) can still say the words.
let TITLES = {};
export const setUseCaseTitles = (list) => { TITLES = Object.fromEntries((list || []).map((u) => [u.id, u.title])); };
export const titleOfUc = (id) => (Object.hasOwn(TITLES, id) ? TITLES[id] : "a use case");
// Free text that names a use case by its id (the catalog's own sentences, a server message) says its title instead.
export const noIds = (text) => String(text ?? "").replace(/\bUC[-\w.]*\d\w*/g, (m) => (Object.hasOwn(TITLES, m) ? `“${TITLES[m]}”` : "another use case"));

