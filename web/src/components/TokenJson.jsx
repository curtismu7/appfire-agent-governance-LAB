// Re-export of the shared pane (Rule 24b, meta #396): the decoding lives in the vendored JsonPane now,
// so this wrapper is a thin alias kept for the lab's imports (Bits, HttpMessage, ExchangeList,
// StepDetailPanel, TokenView). `decode`, `TokenParts`, `DecodedTokens` and `decodedTokensIn` come from
// the shared module too. The repo test still fails when a component imports the bare pane instead of this.
export { Json, TokenParts, DecodedTokens, decodedTokensIn, decodeSegment, default } from "./JsonPane.jsx";
