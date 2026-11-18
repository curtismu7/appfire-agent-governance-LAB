import { useState } from "react";
import FloatingDialog from "../floating-dialog/FloatingDialog";
import StepDetailPanel from "../evidence/StepDetailPanel";
import { readPref, txt, writePref } from "../evidence/lanes";

// The detail box under the sequence (owner, 2026-11-18): it stays docked under the diagram by default, and its Pop out button floats it as a
// draggable, resizable window (FloatingDialog: drag by the title bar, resize from any edge, its own pop-out to a separate browser window, the
// position remembered). Dock puts it back. The choice is remembered in the browser, so the next step opens the same way. Closing the window
// (or Escape in it) docks it again; the panel's own × still clears the selection.
const FLOAT_KEY = "aag.stepdetail.floating";
const floatingPref = () => readPref(FLOAT_KEY, (v) => v === "1" || v === "0", "0") === "1";

export default function StepDetail({ hops = [], selected = null, onSelect, onClose }) {
  const [floating, setFloating] = useState(floatingPref);
  const set = (on) => { writePref(FLOAT_KEY, on ? "1" : "0"); setFloating(on); };
  const hop = hops.find((x) => x.n === selected);
  if (!hop) return null;
  if (!floating) {
    return <StepDetailPanel hops={hops} selected={selected} onSelect={onSelect} onClose={onClose}
      headExtra={<button type="button" onClick={() => set(true)} aria-label="Pop out the step detail into its own window" data-testid="sdp-popout">Pop out</button>} />;
  }
  return (
    <>
      <p className="muted" data-testid="sdp-floating-note">The step detail is in its own window. <button type="button" className="signin__link" onClick={() => set(false)} data-testid="sdp-dock">Dock it here</button></p>
      <FloatingDialog isOpen noBackdrop onClose={() => set(false)} closeAriaLabel="Dock the step detail" title={`Step ${hop.n}: ${txt(hop.title)}`} ariaLabel="Step detail"
        placement="right" defaultWidth={760} defaultHeight={620} minWidth={420} minHeight={280} storageKey="aag.stepdetail" testId="step-detail-window" footer={null}>
        <StepDetailPanel hops={hops} selected={selected} onSelect={onSelect} onClose={onClose}
          headExtra={<button type="button" onClick={() => set(false)} aria-label="Dock the step detail under the sequence" data-testid="sdp-dock-button">Dock</button>} />
      </FloatingDialog>
    </>
  );
}
