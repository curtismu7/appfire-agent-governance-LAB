// Story wiring: the lab's own glue between the shared Story engine (web/src/story/, vendored) and this page. It turns the script (storyScript.js)
// into engine steps and gives the engine a `host` that reads and drives the page. It never edits the page's own markup; it clicks the page's own
// Run button with a script-made event (isTrusted is false, so Play for me is not mistaken for the viewer's own input).
//
// The page (App.jsx) announces runs with appfire:run-start and appfire:run-end ({ ok }): ok is false only when the request itself failed. A run the
// gateway refused (a 4xx with rows) completes normally — the rows show it — so it is a run that ended ok. run-end goes out after the rows are on the
// page (two animation frames), so the run-done steps read the panel as soon as it is drawn.

import { STEPS } from './storyScript.js';

const text = (el) => (el && el.textContent ? el.textContent.trim() : '');

export function createHost({ win = window, doc = document, mode = () => 'mock', settleMs = 500 } = {}) {
  const runs = { starts: 0, ends: 0, lastOk: true };
  const waiters = new Set();
  const timers = new Set();
  const watchers = new Set();
  const onStart = () => { runs.starts += 1; watchers.forEach((f) => f()); };
  const onEnd = (e) => {
    runs.ends += 1; runs.lastOk = e.detail ? e.detail.ok !== false : true;
    for (const w of [...waiters]) w(runs.lastOk);
    watchers.forEach((f) => f());
  };
  win.addEventListener('appfire:run-start', onStart);
  win.addEventListener('appfire:run-end', onEnd);

  const q = (sel) => doc.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    mode,
    query: q,
    mark: () => ({ starts: runs.starts, ends: runs.ends }),
    runStarted: (m) => runs.starts > m.starts,
    runInFlight: () => runs.starts > runs.ends,
    onRun: (cb) => { watchers.add(cb); return () => watchers.delete(cb); },
    waitForRun(m, timeoutMs) {
      return new Promise((resolve) => {
        const finish = (r) => { clearTimeout(t); timers.delete(t); waiters.delete(check); resolve(r); };
        const done = (ok, reason) => finish(ok ? { ok: true } : { ok: false, reason: reason || 'The run failed. Press Next to carry on, or Exit.' });
        const check = (ok, reason) => { if (reason || runs.ends > m.ends) done(ok, reason); };
        const t = setTimeout(() => finish({ ok: false, reason: 'The run did not finish in time. Press Next to carry on, or Exit.' }), timeoutMs);
        timers.add(t);
        if (runs.ends > m.ends) { done(runs.lastOk); return; }
        waiters.add(check);
      });
    },
    prefill(step) { /* this lab prompts by pressing its Run control, not filling a box */ },
    send(step) {
      const presses = step.prompt && step.prompt.press;
      if (!presses) return;
      for (const sel of (Array.isArray(presses) ? presses : [presses])) {
        const el = q(sel);
        if (!el || el.disabled) throw new Error(`the control ${sel} is not available: pick a use case first`);
        el.click();
      }
    },
    assetUrl: () => null,   // no screenshot ships; a slide is text-only
    dispose() { win.removeEventListener('appfire:run-start', onStart); win.removeEventListener('appfire:run-end', onEnd); timers.forEach(clearTimeout); timers.clear(); waiters.clear(); watchers.clear(); },
    _sleep: sleep, _settleMs: settleMs,
  };
}

// ---- finding what a bubble points at
function targetFor(doc, t) {
  if (!t) return null;
  if (typeof t === 'string') return t;
  if (t.roSummary) {
    // The panel's summary line, only when the panel has rows: the narrow element a bubble sits beside.
    return () => {
      const p = doc.querySelector('[data-testid=run-observability]');
      if (!p || p.querySelector('[data-testid=ro-empty]') || p.querySelector('[data-testid=ro-no-run]') || p.querySelector('[data-testid=ro-problem]')) return null;
      return p.querySelector('[data-testid=ro-summary]') || p;
    };
  }
  if (t.roChain) {
    return () => {
      const c = doc.querySelector('[data-testid=ro-chain]');
      if (!c || c.querySelector('[data-testid=ro-chain-none]')) return null;
      return c;
    };
  }
  if (t.roStreams) {
    return () => {
      const s = doc.querySelector('[data-testid=ro-streams]');
      if (!s) return null;
      s.open = true;
      return s;
    };
  }
  if (t.roPanel) {
    return () => doc.querySelector('[data-testid=run-observability]');
  }
  if (t.selector) {
    return () => doc.querySelector(t.selector) || null;
  }
  return null;
}

// ---- the live fact lines a bubble shows (what the video's take reads from the page)
function linesFor(doc, step) {
  const summary = () => {
    const s = doc.querySelector('[data-testid=ro-summary]');
    if (!s) return [];
    const m = /^([\d,]+ allowed[^.]*\.)\s*Window/.exec(text(s));
    return [m ? m[1] : text(s).split(' Window')[0]];
  };
  switch (step.lines) {
    case 'summary': return summary;
    default: return undefined;
  }
}

// Steps left out of the walk-through: none.
export const NOT_YET = [];

/** The script as engine steps. */
export function buildSteps({ host, doc = document, win = window, script = STEPS, notYet = NOT_YET } = {}) {
  return script.filter((s) => !notYet.includes(s.key)).map((s) => {
    const step = { key: s.key, type: s.type, trigger: s.trigger, modes: s.modes, sampleKey: s.sampleKey, prefer: s.prefer, place: s.place, fixedSecs: s.fixedSecs, frameTimeoutMs: s.frameTimeoutMs };
    if (s.prompt) step.prompt = s.prompt;
    if (s.type === 'bubble') {
      step.target = targetFor(doc, s.target);
      const lines = linesFor(doc, s);
      if (lines) step.lines = lines;
    }
    return step;
  });
}
