import { Json as Pane, parseJsonText } from "./JsonPane";
import { visible } from "../safeText";
import { HOT_CLAIMS } from "../lib";

// THE JSON pane of this lab (owner, 2026-11-18: "we need to decode the token, not just display the json ... I am sure there are more of these ... do we need a reusable
// component so we do not hard code each one"). It is the shared, vendored Form | JSON pane (JsonPane.jsx, never edited here) plus, under it, every whole JWT the value
// carries, decoded: a block per token named by its field path, header and claims in the same panes. Every screen that shows a value as JSON imports `Json` from here
// (Bits re-exports it), so a new screen gets the decoding without any code of its own; a repo test fails when a component imports the bare pane instead.
//   decode={false}  for a pane that IS a decoded part of a token (the header or the claims of a block, TokenView's own header and claims), so a token is never decoded twice.
// A token that is cut short or is not a JWT is skipped; at most six per pane and eight levels deep; every string is rendered as text.
const WHOLE_JWT = /^(?:(?:Bearer|DPoP) )?(eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*)$/;
function decodeSegment(seg) {
  const t = seg.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const v = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}
export function decodedTokensIn(v, path = "", out = [], depth = 0) {
  if (out.length >= 6 || depth > 8) return out;
  if (typeof v === "string") {
    const m = WHOLE_JWT.exec(v.trim());
    if (m) {
      if (!out.some((o) => o.raw === m[1])) {
        try { const [h, c] = m[1].split("."); const header = decodeSegment(h); const claims = decodeSegment(c); if (header && claims) out.push({ name: path || "token", raw: m[1], header, claims }); } catch { /* not a decodable JWT */ }
      }
      return out;
    }
    // JSON that arrives as text (a body, a log line) is searched too, as the pane itself would show it.
    const inner = depth < 3 ? parseJsonText(v) : undefined;
    if (inner !== undefined) return decodedTokensIn(inner, path, out, depth + 1);
    return out;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => decodedTokensIn(x, `${path}[${i}]`, out, depth + 1)); return out; }
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) decodedTokensIn(x, path ? `${path}.${k}` : k, out, depth + 1);
  return out;
}

// One token laid out the way a reader expects (the jwt.io order, owner 2026-11-18): Header, Payload, Signature. The signature is shown as sent; the receiving server
// is the one that checks it. A token the lab only has a masked form of (the old identity-provider-only path) shows no signature.
export function TokenParts({ header, claims, raw, label, claimsTestId }) {
  const m = typeof raw === "string" ? WHOLE_JWT.exec(raw.trim()) : null;
  const signature = m ? m[1].split(".")[2] : null;
  return (
    <>
      <p className="http__h">Header</p>
      <Pane value={header} label={`${label} header`} />
      <p className="http__h">Payload</p>
      <Pane value={claims} label={`${label} payload`} testId={claimsTestId} hot={HOT_CLAIMS} />
      <p className="http__h">Signature</p>
      {signature ? <Pane value={signature} label={`${label} signature`} /> : <p className="muted">{m ? "This token has no signature segment." : "The signature is not shown for this token."}</p>}
    </>
  );
}

export function DecodedTokens({ value, label }) {
  const toks = decodedTokensIn(value);
  if (!toks.length) return null;
  return (
    <div className="http__decoded" role="group" aria-label={`${label || "JSON"} decoded tokens`} data-testid="decoded-tokens">
      <p className="http__h">Decoded {toks.length === 1 ? "token" : "tokens"}</p>
      {toks.map((t) => (
        <article key={`${t.name}-${t.raw.slice(-12)}`} className="panel panel--inner" data-testid="decoded-token">
          <p className="field-label">{visible(t.name)}</p>
          <TokenParts header={t.header} claims={t.claims} raw={t.raw} label={`${label || "JSON"} ${t.name}`} />
        </article>
      ))}
    </div>
  );
}

export function Json({ decode = true, ...props }) {
  return decode ? <><Pane {...props} /><DecodedTokens value={props.value} label={props.label} /></> : <Pane {...props} />;
}
export default Json;
