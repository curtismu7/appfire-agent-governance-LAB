// The airline pack's own logic on the page, kept in one file so decision.js, lib.js and App.jsx carry only one-line hooks (each marked `// fare:`).
// Everything here reads the run the server sent; it decides nothing. The two limits and the international flag are the lab's own (LAB-INVENTED); CONSTRAINED
// is the lab's own fare rule and is never presented as a PingOne Authorize outcome. No imports on purpose: decision.js imports this file, never the reverse.

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

// What the page says about who narrowed a booking when the server did not say (it always does on the lab's own steps; a Real run names its own tool server).
export const FARE_BY = "the lab's fare rule, not a PingOne Authorize outcome";

// The five controls an airline call can end in, from "nobody is asked" to "refused". RISK_RUNGS (decision.js) keeps the four every other pack draws.
export const FARE_RUNGS = [
  { level: 1, control: "Proceeds automatically", word: "PERMIT" },
  { level: 2, control: "Allowed with a limit", word: "CONSTRAINED" },
  { level: 3, control: "Second factor first", word: "STEP_UP" },
  { level: 4, control: "A person approves", word: "HITL_REQUIRED" },
  { level: 5, control: "Refused", word: "DENY" },
];
export const NUMBER_WORD = { 4: "four", 5: "five" };

// The strip a run draws: five rungs only when the run carries the fare rule (every run of the airline pack, Real or not); four otherwise.
export const riskRungsOf = (run, base) => (run?.fareRule ? FARE_RUNGS : base);

export const isConstrainedOutcome = (outcome) => outcome === "CONSTRAINED" || outcome === "REAL_CONSTRAINED";
export const isConstrained = (run) => isConstrainedOutcome(String(run?.outcome || ""));

// Which rung an airline run landed on; null when the run made no decision (guided, identity only, not completed). Only called for a run with `fareRule`.
export function fareLevelOf(run) {
  const o = String(run?.outcome || "");
  if (run?.kind === "guided" || run?.computed === false || run?.kind === "live") return null;
  if (isConstrainedOutcome(o)) return 2;
  // A booking approved on the traveller's own phone ends PERMIT, but its decision was CIBA: a person approved it, so it sits on the person rung.
  if ((run?.hops || []).some((h) => h?.kind === "authorize-decision" && h.verdict !== "skip" && h.response?.body?.decision === "CIBA")) return 4;
  if (o === "PERMIT" || o === "DELEGATE_AND_EXECUTE" || o === "REAL_PERMIT") return 1;
  if (o === "STEP_UP") return 3;
  if (o === "HITL_REQUIRED" || o === "CIBA" || o === "REAL_HOLD") return 4;
  if (o.startsWith("DENY") || o === "PERMIT_THEN_DENY" || o === "REAL_DENY") return 5;
  return null;
}

// What was asked and what was granted, from the run's own `constrained` field (the decision hop's `constraint` is the fallback). null when nothing was narrowed.
export function narrowedOf(run) {
  if (!isConstrained(run)) return null;
  const c = run?.constrained;
  const hop = (run?.hops || []).find((h) => h?.kind === "authorize-decision" && h.verdict !== "skip");
  const k = hop?.response?.body?.constraint;
  const asked = text(c?.asked) || text(k?.asked);
  const granted = text(c?.granted) || text(k?.granted);
  return asked && granted ? { asked, granted, field: text(c?.field) || text(k?.field) || "cabin" } : null;
}

// The reason line of a constrained card: the policy's own reason (it already says what was narrowed and why), then only the asked/granted pair.
export function constrainedReason(run, why) {
  const n = narrowedOf(run);
  const pair = n ? ` The booking went through; the agent asked for ${n.asked} and was granted ${n.granted}.` : " The booking went through, narrowed.";
  return `Allowed with a limit${why ? `: ${why}` : ""}.${pair}`;
}

// The policy row of an airline booking decision: every outcome of the fare rule (allowed as asked, narrowed, held for a second factor, a person or a phone) is
// decided by the lab's own rule, and the card says so, so a reader never takes any of them for a PingOne Authorize outcome. null for every other run (a refusal
// before the booking decision, a read, another pack), so the caller falls through.
export function constrainedPolicy(run, azBody) {
  const constrained = isConstrained(run);
  if (!constrained && !(run?.fareRule && run?.booking && text(azBody?.reason))) return null;
  const reason = text(azBody?.reason) || text(run?.constrained?.reason) || "the booking was narrowed";
  return { by: text(run?.constrained?.by) || FARE_BY, reason, decision: constrained ? "CONSTRAINED" : text(azBody?.decision) || "PERMIT" };
}

// Who a held booking's chat card names: the lab's fare rule on an airline booking, Authorize elsewhere.
export const approverOf = (run) => (run?.fareRule && run?.booking ? "Fare rule" : "Authorize");

// "Asked for, and what was booked": read from run.booking only (never scraped from hop bodies). null when the run has no booking.
export function seatFields(run) {
  const b = run?.booking;
  if (!b || typeof b !== "object") return [];
  const asked = text(b.asked) || "business";
  const value = text(b.booked) ? `${asked} asked, ${b.booked} booked` : `${asked} asked, not booked yet (held)`;
  return [{ key: "seat", label: "Asked for, and what was booked", value }];
}

// The chip under a constrained reply in the chat: "Narrowed: business to economy". null otherwise.
export function narrowedChip(run) {
  const n = narrowedOf(run);
  return n ? `Narrowed: ${n.asked} to ${n.granted}` : null;
}

// Typed numbers (chat.js strictNumbers): on a booking prompt the number IS the rule and the staged fare, never the typed one, decides. So a CLOSE match is refused
// when the typed text carries a number the matched prompt does not, AND when the matched prompt carries a number at all: only the exact prompt runs it. (A close
// match could drop or replace the number with words, "five hundred" or "free", or swap the cabin or the trip, and still run the staged booking.) A number is any
// token with a digit; "$500" and "500" are the same number.
const numberTokens = (tokens) => tokens.filter((t) => /\d/.test(t)).map((t) => t.replace(/^\$/, ""));
export function carriesNewNumber(typedTokens, promptTokens) {
  const known = new Set(numberTokens(promptTokens));
  return numberTokens(typedTokens).some((n) => !known.has(n));
}
export const refuseClose = (typedTokens, promptTokens) => carriesNewNumber(typedTokens, promptTokens) || numberTokens(promptTokens).length > 0;
// "$2,400" is the number 2400: thousands separators are removed from what was typed before it is matched (the prompts carry none).
export const plainThousands = (s) => String(s ?? "").replace(/(\d),(?=\d{3}(?!\d))/g, "$1");

// The phone's answer on an airline hold: the approval is recorded, and nothing is released after it, so the sentence never says the lab proceeds.
export const FARE_PHONE_APPROVED = "Approved on the phone. The approval is recorded here. The booking was not run: the lab stops at the hold, so the Decision card still shows it held.";

// What a run is checked against: the catalog's label, or the pack's own label where the airline pack overrides it (labelSource "lab").
export const labelWord = (labelSource) => (labelSource === "lab" ? "the lab's label" : "the catalog label");
