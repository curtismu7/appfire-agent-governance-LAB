// The Story script: one entry per caption key, in the order the recorded video walks the lab. Pure data, no DOM:
// the page wiring (storyWiring.js) turns each entry into an engine step. The wording is in video/captions.md; the
// parity test checks the two agree, and that the order and the numbered-bubble counts equal the take's.
//
//   target   a CSS selector, or { selector } with a guard. A bubble whose target is not there is skipped.
//   prompt   { press } the viewer (or Play) presses that existing button.
//   lines    the name of a live value the page reads for the bubble's fact lines (the page wiring).
//   modes    ['real'] or ['mock']: shown only there. sampleKey: the Mock wording key.

export const STEPS = [
  { key: 'opening', type: 'slide', trigger: 'load' },

  { key: 'hero_run_prompt', type: 'bubble', trigger: 'load', target: '[data-testid=wtt-UC1]', prefer: 'right', prompt: { press: ['[data-testid=wtt-UC1]'] } },
  { key: 'hero_panel', type: 'bubble', trigger: 'run-done', target: { roPanel: true }, prefer: 'left' },
  { key: 'hero_summary', type: 'bubble', trigger: 'run-done', target: { roSummary: true }, prefer: 'above', lines: 'summary' },
  { key: 'hero_chain', type: 'bubble', trigger: 'run-done', target: { roChain: true }, prefer: 'left' },
  { key: 'hero_streams', type: 'bubble', trigger: 'run-done', target: { roStreams: true }, prefer: 'left' },

  { key: 'the_cast', type: 'slide', trigger: 'load' },

  { key: 'turn_overlimit', type: 'bubble', trigger: 'run-done', target: { roSummary: true }, prefer: 'above', lines: 'summary', prompt: { press: ['[data-testid=wtt-UC27]'] } },
  { key: 'turn_hold', type: 'bubble', trigger: 'run-done', target: { roSummary: true }, prefer: 'above', lines: 'summary', prompt: { press: ['[data-testid=wtt-UC6]'] } },
  { key: 'turn_denied', type: 'bubble', trigger: 'run-done', target: { roSummary: true }, prefer: 'above', lines: 'summary', prompt: { press: ['[data-testid=wtt-UC13]'] } },
  { key: 'turn_blocked', type: 'bubble', trigger: 'run-done', target: { roSummary: true }, prefer: 'above', lines: 'summary', prompt: { press: ['[data-testid=wtt-UC31]'] } },
  { key: 'turn_compare', type: 'bubble', trigger: 'run-done', target: { roPanel: true }, prefer: 'left' },

  { key: 'closing', type: 'slide', trigger: 'load' },
];

// Wording only the video uses.
export const VIDEO_ONLY = ['video_products_wall'];

// Bubbles only Story has (the video has no such scene): the order and count checks against take.py leave them out.
export const STORY_ONLY = ['hero_panel', 'hero_chain'];

// What the parity test hands to captions.js parity(): the caption keys this script needs.
export function scriptKeys() {
  return {
    steps: STEPS.filter((s) => s.type === 'bubble').map((s) => s.key),
    slides: STEPS.filter((s) => s.type === 'slide').map((s) => s.key),
    videoOnly: VIDEO_ONLY,
    storyOnly: STORY_ONLY,
  };
}
