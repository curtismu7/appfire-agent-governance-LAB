import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCaptions } from './story/captions.js';

// Story mode (shared pattern: AI-DEMO-Standalone/shared/story/README.md). The wording lives in video/captions.md, the ONE file the recorded
// video and the live Story both read. The parser is the vendored, pinned copy in story/captions.js; this file is the lab's own glue: it reads
// the file (again whenever its bytes change), parses it, and answers GET /api/story. Nothing here makes a network call.

export const CAPTIONS_PATH = fileURLToPath(new URL('../../video/captions.md', import.meta.url));

let cached = null;

/** The wording AND the SHA-256 of the exact bytes it was parsed from: one read of the file, so the two can never describe different contents.
 *  Cached by hash, so an edit shows on the next request and an unchanged file is not re-parsed. A broken file throws (CaptionsError names it). */
export function loadCaptionsWithHash(path = CAPTIONS_PATH) {
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (path === CAPTIONS_PATH && cached && cached.sha === sha256) return { captions: cached.parsed, sha256 };
  const parsed = parseCaptions(bytes.toString('utf8'));
  if (path === CAPTIONS_PATH) cached = { sha: sha256, parsed };
  return { captions: parsed, sha256 };
}

export const loadCaptions = (path = CAPTIONS_PATH) => loadCaptionsWithHash(path).captions;

export function resetCaptionsCache() { cached = null; }

/** GET /api/story: the wording only, plus the hash of the file it came from (the video checks it reads the file it thinks it is). */
export function storyResponse(path = CAPTIONS_PATH) {
  try {
    const { captions, sha256 } = loadCaptionsWithHash(path);
    return { status: 200, body: { ...captions, sourceSha256: sha256 } };
  } catch (e) {
    // A wording problem names itself so the editor can fix it. Anything else (a missing file) is logged and never sent: its text holds server paths.
    if (e instanceof Error && e.name === 'CaptionsError') return { status: 500, body: { error: `Story wording could not be read: ${e.message}` } };
    console.error('story: captions.md could not be read:', e instanceof Error ? e.message : e);
    return { status: 500, body: { error: 'Story wording could not be read: the wording file is missing or unreadable.' } };
  }
}
