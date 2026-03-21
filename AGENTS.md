# agents.md

## Project

Kokoro PDF Reader — Chrome extension that reads academic PDFs aloud via local Kokoro TTS.

## Stack

- Chrome Extension (Manifest V3)
- Vanilla JS (no framework, no build step)
- Kokoro-FastAPI (localhost:8880)
- pdf.js (bundled)

## Code Standards

Write code as if it ships to production at Google. Clarity over cleverness. No dead code. No TODOs in main branch.

### Style

- ES modules where supported, otherwise IIFE to avoid globals
- `const` by default, `let` when rebinding is necessary, never `var`
- Single quotes for strings
- 2-space indent
- Semicolons always
- Max 80 chars per line, hard limit 100
- No abbreviations in names except universal ones (`url`, `id`, `err`, `msg`)
- Functions do one thing. If you need a comment to explain a block, extract it into a named function
- No nested ternaries
- No magic numbers — use named constants in `constants.js`

### Naming

```
files:          kebab-case.js
classes:        PascalCase
functions:      camelCase (verb-first: getVoices, parseColumn, handleClick)
constants:      UPPER_SNAKE_CASE
private:        _prefixed
events/messages: UPPER_SNAKE_CASE type field (e.g. { type: 'PLAY_CHUNK' })
booleans:       is/has/should prefix (isPlaying, hasPosition, shouldSkip)
```

### File Structure

Each file exports a single responsibility. Max ~200 lines. If a file grows past that, split it.

```
// Good: one clear export per file
// pdf-extractor.js → extractTextFromPdf()
// sentence-splitter.js → splitIntoSentences()
// tts-client.js → class TtsClient
```

### Error Handling

Every async call gets a try/catch or `.catch()`. Never swallow errors.

```javascript
// Good
try {
  const audio = await ttsClient.synthesize(text);
  return audio;
} catch (err) {
  console.error('[TTS] Synthesis failed:', err.message);
  throw new TtsError('synthesis_failed', err);
}

// Bad
const audio = await ttsClient.synthesize(text).catch(() => null);
```

Custom error classes for each domain: `TtsError`, `PdfError`, `PlaybackError`. Always include a machine-readable code and the original error.

### Logging

Prefix all logs with the module name in brackets. Three levels only.

```javascript
console.log('[Player] Chunk 3/47 playing');      // normal flow
console.warn('[PDF] No text found on page 5');    // recoverable
console.error('[TTS] Server unreachable:', err);  // broken
```

No `console.debug` in production code. No log spam — one log per significant state change, not per iteration.

### Chrome Extension Messaging

All messages between service worker, content script, and popup use a strict typed contract:

```javascript
// messages.js — single source of truth
const MSG = {
  PLAY: 'PLAY',
  PAUSE: 'PAUSE',
  STOP: 'STOP',
  SKIP_FORWARD: 'SKIP_FORWARD',
  SKIP_BACK: 'SKIP_BACK',
  SET_SPEED: 'SET_SPEED',
  SET_VOICE: 'SET_VOICE',
  STATUS_UPDATE: 'STATUS_UPDATE',
  SERVER_STATUS: 'SERVER_STATUS',
  CHUNK_READY: 'CHUNK_READY',
  ERROR: 'ERROR',
};
```

Every message has `{ type, payload }`. Nothing else at the top level.

### State Management

One canonical state object in the service worker. Content script and popup receive copies via messages, never mutate directly.

```javascript
const state = {
  status: 'idle',        // idle | loading | playing | paused | error
  pdfUrl: null,
  currentChunk: 0,
  totalChunks: 0,
  speed: 1.0,
  voice: 'af_bella',
  serverOnline: false,
};
```

### API Calls

All Kokoro API interaction goes through `TtsClient`. No raw `fetch()` to the TTS server anywhere else.

```javascript
class TtsClient {
  constructor(baseUrl = 'http://localhost:8880') { ... }
  async checkHealth() { ... }
  async getVoices() { ... }
  async synthesize(text, { voice, speed, stream } = {}) { ... }
}
```

### DOM / Content Script

Never query the DOM more than once for the same element — cache it. Clean up all injected elements on teardown. Use `data-kokoro-*` attributes to identify our injected elements.

```javascript
// Good: namespace our DOM
overlay.setAttribute('data-kokoro-role', 'player');

// Good: single cleanup
function teardown() {
  document.querySelectorAll('[data-kokoro-role]')
    .forEach(el => el.remove());
}
```

### CSS

All injected styles scoped under a single parent class `.kokoro-reader`. No global styles. Use CSS custom properties for theming.

```css
.kokoro-reader {
  --kr-bg: rgba(24, 24, 27, 0.92);
  --kr-text: #fafafa;
  --kr-accent: #3b82f6;
  --kr-radius: 8px;
}
```

### Testing Approach

Manual testing matrix per sprint. Test each feature against:
- Single-column PDF (e.g. thesis)
- Two-column PDF (e.g. IEEE/ACM paper)
- Math-heavy PDF (e.g. arXiv ML paper)
- Scanned PDF (expect graceful failure)

### Git

Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`. One logical change per commit. Squash before merge if messy.

### Performance Budgets

- Extension popup opens in < 100ms
- First audio plays within 2s of pressing play (warm server)
- Content script injection + text extraction < 3s for a 20-page PDF
- Memory overhead of extension < 50MB during playback
