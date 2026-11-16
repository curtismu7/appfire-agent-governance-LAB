import { Fragment } from "react";
import { privilegeOf } from "../privilege";
import { visible } from "../safeText";
import { SourceTag, chipsNeeded } from "./Bits";

// The privilege settings that applied to this run, read from its own tokens and hops (privilege.js). Collapsed to one summary line.
export default function PrivilegePanel({ run }) {
  const p = privilegeOf(run);
  if (!p) return null;
  return (
    <details className="priv" data-testid="privilege-panel">
      <summary className="priv__sum"><span className="kicker">Privilege settings in effect</span> <SourceTag source={p.source} show={chipsNeeded(run)} /> <span className="muted" data-testid="privilege-summary">{visible(p.summary)}</span></summary>
      <dl className="kv" data-testid="privilege-rows">
        {p.rows.map((r) => (
          <Fragment key={r.key}>
            <dt>{r.label}</dt>
            <dd data-testid={`privilege-${r.key}`}>{visible(r.value)}</dd>
          </Fragment>
        ))}
      </dl>
      <p className="muted priv__gap" data-testid="privilege-gap">{p.notShown}</p>
    </details>
  );
}
