import { useRef, useState } from "react";
import { visible } from "../safeText";

// One coloured token of a formatted JSON view. The kinds map to css classes (tokens only); the text itself is escaped
// by React, so no markup is ever injected (repo rule).
function JTok({ kind, text }) {
  return <span className={`jtok jtok--${kind}`}>{text}</span>;
}

// Tokenize a JSON string into coloured spans. A tiny scanner (no eval, no regex HTML): strings, numbers, literals and
// punctuation. Anything unparsable falls back to one plain token, so the function is total.
function jTokens(text) {
  const out = [];
  let i = 0;
  const nextMeaning = (from) => { let j = from; while (j < text.length && /\s/.test(text[j])) j += 1; return text[j]; };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1; let esc = false;
      while (j < text.length) { if (esc) esc = false; else if (text[j] === "\\") esc = true; else if (text[j] === '"') break; j += 1; }
      const str = text.slice(i, j + 1);
      const isKey = nextMeaning(j + 1) === ":";
      out.push({ kind: isKey ? "key" : "string", text: str });
      i = j + 1;
      continue;
    }
    if (/[-0-9]/.test(ch)) {
      let j = i; while (j < text.length && /[-0-9.eE+]/.test(text[j])) j += 1;
      out.push({ kind: "number", text: text.slice(i, j) });
      i = j;
      continue;
    }
    const word = text.slice(i).match(/^(true|false|null)/);
    if (word) { out.push({ kind: word[1] === "null" ? "null" : "bool", text: word[1] }); i += word[1].length; continue; }
    if (/[{}\[\],:]/.test(ch)) { out.push({ kind: "punct", text: ch }); i += 1; continue; }
    let j = i; while (j < text.length && !/["{}\[\],:]/.test(text[j])) j += 1;
    out.push({ kind: "plain", text: text.slice(i, j) });
    i = j;
  }
  return out;
}

// Raw JSON or text, rendered as text only (never markup), with a Raw | Formatted toggle (owner 2026-11-13):
// Formatted colours keys, strings, numbers, booleans and null; Raw is the exact text. Control and
// bidirectional-format characters are shown as visible escapes either way. Text values (plain strings) have no
// formatted view: the toggle only appears for JSON-looking values.
export function Json({ value, label, testId, toggle = true }) {
  const raw = visible(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  const isJson = typeof value === "object" && value !== null;
  const [formatted, setFormatted] = useState(true);
  const tokens = isJson ? jTokens(raw) : null;
  const shown = isJson && formatted
    ? tokens.map((t, i) => <JTok key={i} kind={t.kind} text={visible(t.text)} />)
    : visible(raw);
  return (
    <div className="jsonbox" data-testid={testId ? `${testId}-box` : undefined}>
      {isJson && toggle && (
        <span className="jsonbox__toggle" role="group" aria-label={`${label || "JSON"} view`}>
          <button type="button" aria-pressed={formatted} onClick={() => setFormatted(true)} data-testid={testId ? `${testId}-formatted` : undefined}>Formatted</button>
          <button type="button" aria-pressed={!formatted} onClick={() => setFormatted(false)} data-testid={testId ? `${testId}-raw` : undefined}>Raw</button>
        </span>
      )}
      <pre className={`json${isJson && formatted ? " json--fmt" : ""}`} tabIndex={0} aria-label={label} data-testid={testId}>{shown}</pre>
    </div>
  );
}

// A small word-tag. The state only colours the border; the words carry the meaning.
export const Tag = ({ state = "info", children, title, testId }) => <span className="tag" data-state={state} title={title} data-testid={testId}>{children}</span>;

// Where a hop ran (rule 19: REAL or MOCK by what actually ran, never mixed within a hop; NOT RUN when it did not run at all).
export const RealTag = () => <Tag state="ok" testId="real-tag" title="A real call to a real server (PingOne or the Agent Gateway), not produced by this lab">REAL</Tag>;
export const NotRunTag = () => <Tag state="info" testId="notrun-tag" title="This step did not run in this run">NOT RUN</Tag>;
export function SourceTag({ source }) {
  if (source === "real") return <RealTag />;
  if (source === "not-run") return <NotRunTag />;
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
