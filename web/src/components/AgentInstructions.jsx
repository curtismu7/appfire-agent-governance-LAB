import { overridesIn } from "../instructions";
import { Tag } from "./Bits";

// The agent's instructions (its system prompt): shown, editable, with a poisoned preset. They ride along with the run and the agent
// obeys override phrases (LAB-INVENTED, see server/src/instructions.js); policy decides from the call either way. `text` is the edited text, or null
// while the default is in use.
export default function AgentInstructions({ config, text, onText }) {
  if (!config) return null;
  const shown = text ?? config.default;
  const found = overridesIn(shown, config.phrases);
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
        {found.length > 0 && <p className="instr__found" data-testid="instructions-found">Override phrases found: {found.join(", ")}. The agent will propose a risky write instead of what the customer asks; policy decides from the call.</p>}
        <p className="muted instr__note" data-testid="instructions-note">
          The agent obeys override phrases (LAB-INVENTED). Policy decides from the call, never from the instructions.
        </p>
      </div>
    </details>
  );
}
