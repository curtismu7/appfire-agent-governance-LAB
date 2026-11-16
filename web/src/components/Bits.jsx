import { useRef } from "react";

// The JSON pane (Form | JSON, Rule 24) lives in the vendored JsonPane.jsx; it is re-exported here so every caller keeps one import.
export { Json } from "./JsonPane";

// A small word-tag. The state only colours the border; the words carry the meaning.
export const Tag = ({ state = "info", children, title, testId }) => <span className="tag" data-state={state} title={title} data-testid={testId}>{children}</span>;

// Where a hop ran (rule 19: REAL or MOCK by what actually ran, never mixed within a hop; NOT RUN when it did not run at all).
export const RealTag = () => <Tag state="ok" testId="real-tag" title="A real call to a real server (PingOne or the Agent Gateway), not produced by this lab">REAL</Tag>;
export const NotRunTag = () => <Tag state="info" testId="notrun-tag" title="This step did not run in this run">NOT RUN</Tag>;
// Owner, 2026-11-16: the Mode switch and the banner already say REAL or MOCK, so a REAL or MOCK chip on every hop adds nothing when the whole run is
// one kind. The chips show only when they tell something the page does not: a MIXED run (some hops real, some on the mock engine), or a Real-mode
// page whose use case cannot run Real and ran on the mock engine. NOT RUN and LAB-INVENTED always show. `show` defaults to true so a caller that
// has no run to judge keeps the chip.
export const hopSource = (h, run) => h.source || (h.mock ? "mock" : run?.kind === "real" || run?.kind === "live" ? "real" : "mock");
export const mixedRun = (run) => new Set((run?.hops || []).map((h) => hopSource(h, run)).filter((s) => s !== "not-run")).size > 1;
export const chipsNeeded = (run) => mixedRun(run) || Boolean(run?.realGate && run.realGate.real === false);
export function SourceTag({ source, show = true }) {
  if (source === "not-run") return <NotRunTag />;
  if (!show) return null;
  if (source === "real") return <RealTag />;
  if (source === "mock") return <MockTag />;
  return null;
}
export const MockTag = () => <Tag state="info" testId="mock-tag" title="Issued or produced by this lab, not by a real system">MOCK</Tag>;
export const LiveTag = () => <Tag state="ok" testId="live-tag" title="A real call to your PingOne environment, not produced by this lab">LIVE</Tag>;
export const InventedTag = ({ children = "LAB-INVENTED" }) => <Tag state="warn" testId="invented-tag" title="The catalog does not say this; the lab made it up so the engine has something to compute">{children}</Tag>;

// Stale-response guard: run() returns a function that says whether a newer request has started since.
export function useSeq() {
  const seq = useRef(0);
  return () => { const mine = ++seq.current; return () => mine === seq.current; };
}
