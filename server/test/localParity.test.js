// The two copies of the tool tables (design-real-local.md E.2): provider.js (the lab's side) and local/registry.js, policy.js (the child's side) must agree. The
// child's code is read-only here (the one allowed import).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_TOOLS, TOOL_SCOPES, PUBLIC_TOOLS, GROUP_GATED_TOOLS } from '../src/provider.js';
import { BANDS, GATEWAY, SCANNER_REPOS as LAB_SCANNER_REPOS } from '../src/policy.js';
import { situationOf } from '../src/situations.js';
import { SE_MCP_TOOLS } from '../src/realGate.js';

const reg = await import('../src/local/registry.js');   // a missing registry is a failing test (an import error), never a skipped one

test('the tool names, the scope each needs, the public tool and the group-gated tool are the same in both copies', () => {
  const names = Object.keys(reg.TOOL_META);
  assert.equal(names.length, 10); assert.deepEqual([...LOCAL_TOOLS].sort(), [...names].sort());
  assert.deepEqual(Object.fromEntries(Object.entries(TOOL_SCOPES).sort()), Object.fromEntries(names.map((n) => [n, reg.TOOL_META[n].scope]).sort()));
  assert.deepEqual([...PUBLIC_TOOLS].sort(), names.filter((n) => reg.TOOL_META[n].public).sort());
  assert.deepEqual([...GROUP_GATED_TOOLS].sort(), names.filter((n) => reg.TOOL_META[n].group).sort());
  // Every scope a tool needs is one of the six scopes of the PingOne resource, and every scope is used by some tool.
  assert.deepEqual([...new Set(Object.values(TOOL_SCOPES).filter(Boolean))].sort(), [...reg.SCOPES].sort());
  // The tools the SE gateway also serves under the same names (the third-party two) are not a second copy of anything here.
  for (const n of ['brave_news_search', 'code_search']) assert.ok(SE_MCP_TOOLS.has(n));
});

test('the lab\'s bands are the engine\'s bands minus the reserved CIBA band; the scanner repositories and the blocked terms are the engine\'s', () => {
  assert.deepEqual(reg.BANDS.map(({ min, decision }) => ({ min, decision })), BANDS.money.filter((b) => b.decision !== 'CIBA'));
  assert.deepEqual(reg.BANDS.map((b) => b.rule), ['lab-band-deny', 'lab-band-step-up', 'lab-band-hold']);
  assert.deepEqual(reg.SCANNER_REPOS, LAB_SCANNER_REPOS); assert.deepEqual(reg.BLOCKED_TERMS, GATEWAY.blockedTerms);
});

test('every in-scope write amount is outside the reserved CIBA band [100, 200), and lands in the band the use case is about', () => {
  const band = (n) => reg.BANDS.find((b) => n >= b.min)?.decision ?? 'PERMIT';
  for (const [id, want] of [['UC6', 'DENY'], ['UC7', 'STEP_UP'], ['UC8', 'HITL_REQUIRED']]) {
    const n = situationOf(id, 'software').amount; assert.ok(Number.isFinite(n), id); assert.ok(!(n >= 100 && n < 200), `${id}: ${n} is in the reserved CIBA band`); assert.equal(band(n), want, id);
  }
  assert.equal(band(25), 'PERMIT', 'the default amount');
});

test('the situations the tool server\'s edge rules need: UC30 scans an allowed repository, UC31 a refused one, UC42 a blocked term', () => {
  assert.ok(reg.SCANNER_REPOS.includes(situationOf('UC30', 'software').args?.repo ?? 'platform')); assert.ok(!reg.SCANNER_REPOS.includes(situationOf('UC31', 'software').args.repo));
  const q = situationOf('UC42', 'software').args.query.toLowerCase(); assert.ok(reg.BLOCKED_TERMS.some((t) => q.includes(t)));
});
