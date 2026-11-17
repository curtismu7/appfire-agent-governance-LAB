import { Json, Tag } from "./Bits";
import { visible } from "../safeText";
import { HOT_CLAIMS } from "../lib";

// Tokens are shown raw (rule 4: education), with the decoded header and claims. Only client secrets and the password are never sent to the page.
// The act claim (RFC 8693: who is acting for the user), when the claims carry one: an object that names the actor in a non-empty string sub (the same rule as
// the server's, so the chip never contradicts the reply: an empty object or a blank sub is no act).
const actOf = (t) => (t.claims && typeof t.claims.act === "object" && t.claims.act !== null && !Array.isArray(t.claims.act) && typeof t.claims.act.sub === "string" && t.claims.act.sub !== "" ? t.claims.act : null);

export default function TokenView({ tokens }) {
  if (!tokens?.length) return <p className="muted" data-testid="no-tokens">This run minted no token.</p>;
  return (
    <div className="tokens" data-testid="tokens">
      {tokens.map((t, i) => (
        <article key={`${t.label}-${i}`} className="panel panel--inner" data-testid="token">
          <h4 className="panel__sub">{t.label}
            {t.expectAct && (actOf(t)
              ? <> <Tag state="ok" testId="token-act" title="The act claim (RFC 8693): the agent that is acting for the user">act.sub = {visible(actOf(t).sub)}</Tag></>
              : <> <Tag state="bad" testId="token-no-act" title="This token should carry an act claim naming the agent, and it does not">NO act claim</Tag></>)}
          </h4>
          {t.notice && <p className="muted">{t.notice}</p>}
          <p className="field-label">Raw token</p>
          <Json value={t.raw} label={`${t.label} raw`} testId="token-raw" />
          <p className="field-label">Decoded header</p>
          <Json value={t.header} label={`${t.label} header`} />
          <p className="field-label">Decoded claims</p>
          <Json value={t.claims} label={`${t.label} claims`} testId="token-claims" hot={HOT_CLAIMS} />
        </article>
      ))}
    </div>
  );
}
