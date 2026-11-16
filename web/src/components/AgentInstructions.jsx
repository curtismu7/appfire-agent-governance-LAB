import { overridesIn } from "../instructions";
import { Tag } from "./Bits";

// The agent's instructions (its system prompt): shown, editable, with a poisoned preset. In Mock they ride along with the run and the simulated agent
// obeys override phrases (LAB-INVENTED, see server/src/instructions.js); policy decides from the call either way. A Real run sends nothing to a model,
// so the panel says it is not used there. `text` is the edited text, or null while the default is in use.
export default function AgentInstructions({ config, text, onText, mode }) {
  if (!config) return null;
  const shown = text ?? config.default;
  const found = overridesIn(shown, config.phrases);
  const real = mode === "live";
  const word = found.length ? "steers the agent" : text === null ? "default" : "edited";
  return (
    <details className="instr" data-testid="instructions">
      <summary className="instr__sum">
        <span className="kicker">Agent instructions</span> <Tag state={found.length ? "warn" : "info"} testId="instructions-state">{word}</Tag>
      </summary>
      <div className="instr__body">
        <label className="sr-only" htmlFor="instr-text">Agent instructions</label>
        <textarea id="instr-text" className="instr__text" rows={4} maxLength={config.max} value={shown} onChange={(e) => onText(e.target.value === config.default ? null : e.target.value)} data-testid="instructions-text" />
        <div className="seg" role="group" aria-label="Instruction presets" data-testid="instructions-presets">
          {config.presets.map((p) => (
            <button key={p.id} type="button" aria-pressed={shown === p.text} onClick={() => onText(p.id === "default" ? null : p.text)} data-testid={`instructions-preset-${p.id}`}>{p.title}</button>
          ))}
        </div>
        {found.length > 0 && <p className="instr__found" data-testid="instructions-found">Override phrases found: {found.join(", ")}. The simulated agent will propose a risky write instead of what the customer asks; policy decides from the call.</p>}
        <p className="muted instr__note" data-testid="instructions-note">
          {real ? "Real runs do not send these: no model reads them there. They apply to Mock runs and to Compare." : "The simulated agent obeys override phrases (LAB-INVENTED); a real model would react less predictably. Policy decides from the call, never from the instructions."}
        </p>
      </div>
    </details>
  );
}
