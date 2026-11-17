import { useRef } from "react";

// The JSON pane (Form | JSON, Rule 24) lives in the vendored JsonPane.jsx; it is re-exported here so every caller keeps one import.
export { Json } from "./JsonPane";

// A small word-tag. The state only colours the border; the words carry the meaning.
export const Tag = ({ state = "info", children, title, testId }) => <span className="tag" data-state={state} title={title} data-testid={testId}>{children}</span>;

// A hop that did not run in this run says so. Where a hop was produced is data (hop.source), never a chip on the page.
export const NotRunTag = () => <Tag state="info" testId="notrun-tag" title="This step did not run in this run">NOT RUN</Tag>;
export function SourceTag({ source }) {
  return source === "not-run" ? <NotRunTag /> : null;
}
export const InventedTag = ({ children = "LAB-INVENTED" }) => <Tag state="warn" testId="invented-tag" title="The catalog does not say this; the lab made it up so the run has something to compute">{children}</Tag>;

// Stale-response guard: run() returns a function that says whether a newer request has started since.
export function useSeq() {
  const seq = useRef(0);
  return () => { const mine = ++seq.current; return () => mine === seq.current; };
}
