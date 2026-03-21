# Kokoro PDF Reader — Chrome Extension Implementation Plan

> **Project**: A Chrome extension that reads academic PDFs aloud using a locally self-hosted Kokoro TTS model on Mac (Apple Silicon).
> **Philosophy**: Fully local, zero cloud dependencies. Privacy-first.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Tech Stack & Justifications](#2-tech-stack--justifications)
3. [Project Structure](#3-project-structure)
4. [Epic & Sprint Breakdown](#4-epic--sprint-breakdown)
5. [Known Gotchas & Risk Mitigations](#5-known-gotchas--risk-mitigations)
6. [Complexity Estimates](#6-complexity-estimates)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Browser                        │
│                                                         │
│  ┌──────────────┐    ┌─────────────────────────────┐   │
│  │  Extension    │    │  Content Script (PDF page)   │   │
│  │  Popup/Panel  │◄──►│  - PDF text extraction       │   │
│  │  - Play/Pause │    │  - Sentence highlighting     │   │
│  │  - Speed ctrl │    │  - Floating player overlay   │   │
│  │  - Voice sel  │    │  - Audio playback (Web Audio)│   │
│  │  - Status     │    │                              │   │
│  └──────┬───────┘    └──────────┬────────────────────┘   │
│         │                       │                        │
│         └───────┬───────────────┘                        │
│                 │ chrome.runtime messages                 │
│         ┌───────▼───────┐                                │
│         │ Service Worker │                                │
│         │ (background)   │                                │
│         │ - TTS queue    │                                │
│         │ - State mgmt   │                                │
│         │ - Chunk mgr    │                                │
│         └───────┬────────┘                                │
└─────────────────┼────────────────────────────────────────┘
                  │ HTTP (localhost:8880)
                  │ fetch() to local API
                  │
┌─────────────────▼────────────────────────────────────────┐
│              Local Kokoro-FastAPI Server                   │
│              (Docker on Mac, CPU mode)                     │
│                                                           │
│  Endpoints:                                               │
│  POST /v1/audio/speech  → streamed audio (mp3/pcm/wav)   │
│  GET  /v1/audio/voices  → list available voices           │
│  GET  /v1/models        → model info                      │
│                                                           │
│  Model: Kokoro-82M (82M params, runs on CPU fine)         │
│  Port:  8880 (default)                                    │
│  CORS:  enabled by default in Kokoro-FastAPI              │
└───────────────────────────────────────────────────────────┘
```

### Data flow for reading a PDF:

1. User opens a PDF in Chrome and clicks "Play"
2. Content script extracts text from the PDF using pdf.js (bundled with extension)
3. Text is cleaned: headers/footers stripped, columns re-ordered, equations replaced with "[equation]"
4. Cleaned text is split into sentences/chunks (~200-400 chars each for low latency)
5. Service worker sends chunks sequentially to `localhost:8880/v1/audio/speech`
6. Audio streams back; content script plays it via Web Audio API and highlights the current sentence
7. Playback position is saved to `chrome.storage.local` keyed by PDF URL

### Why this architecture:

- **Kokoro-FastAPI** is the best wrapper — it already provides an OpenAI-compatible REST API with streaming, speed control, voice selection, and CORS. No need to build a custom Python server.
- **Service worker** manages the TTS queue and state so playback survives popup open/close.
- **Content script** handles DOM interaction (highlighting, overlay UI) directly on the PDF page.
- **No data leaves the machine** — all requests go to localhost.

---

## 2. Tech Stack & Justifications

### Local TTS Server

| Choice | Alternative | Why |
|--------|-------------|-----|
| **Kokoro-FastAPI** (Docker, CPU image) | Custom FastAPI + kokoro pip package | Kokoro-FastAPI is battle-tested, has arm64 support, baked-in models, OpenAI-compatible API, streaming, speed param, voice listing. No point rebuilding. |
| **Docker** | Native Python venv | Docker is cleaner for isolation, one `docker run` command, auto-downloads models. Alternatively, `uv` (the UV runner scripts) can run it natively — we'll support both. |

**Key Kokoro-FastAPI details (from research):**
- Image: `ghcr.io/remsky/kokoro-fastapi-cpu:latest` (has arm64/multi-arch support)
- Port: 8880 (configurable)
- Speed param: `0.5` to `2.0` (passed in request body as `"speed": 1.0`)
- Voice list: `GET /v1/audio/voices` returns `{"voices": [...]}` — voices like `af_bella`, `af_sky`, `am_adam`, `am_echo`, `bf_emma`, `bm_george`, etc.
- Streaming: POST with `stream: true` returns chunked audio
- Audio formats: mp3, wav, opus, flac, pcm
- CORS: enabled by default in the FastAPI middleware
- Apple Silicon note: must use CPU image (no CUDA). Performance is ~5x real-time on M3 Pro CPU, which is sufficient.
- Max chunk: model handles ~510 phonemized tokens per chunk; server auto-splits at ~175-250 tokens. We should pre-chunk at the sentence level (~200-400 chars) on our side for better control.

### Chrome Extension

| Choice | Alternative | Why |
|--------|-------------|-----|
| **Manifest V3** | V2 | V2 is deprecated. V3 is required. |
| **pdf.js** (Mozilla, bundled) | Chrome's built-in PDF viewer DOM scraping | Chrome's PDF viewer doesn't expose text in the DOM in a reliable way. Bundling pdf.js gives us full control over text extraction with x,y coordinates — essential for column detection. |
| **Web Audio API** | `<audio>` element | Web Audio API gives precise control over playback timing, which we need for sentence-level sync. Falls back to `<audio>` if needed. |
| **chrome.storage.local** | localStorage | Extension storage persists across sessions and is accessible from service worker. localStorage isn't available in service workers. |

### PDF Text Extraction Strategy

This is the hardest part of the project. Academic PDFs are notoriously difficult.

**Approach: Hybrid extraction pipeline**

1. **Primary: pdf.js `getTextContent()`** — extracts text items with x,y positions, font info, and transform matrices.
2. **Column detection**: Analyze x-coordinates of text items. If there's a clear bimodal distribution (gap in the middle of the page), split into left/right columns. Read left column top-to-bottom, then right column.
3. **Header/footer stripping**: Text items in the top ~10% or bottom ~10% of the page with repeating content across pages (page numbers, author names, journal headers) get stripped.
4. **Equation detection**: Look for text items using math fonts (CMR, CMSY, Symbol, etc.) or sequences that look like LaTeX fragments. Replace with "[equation]" or skip.
5. **Figure/table captions**: Detect "Figure N:" or "Table N:" patterns — read them inline.
6. **References section**: Detect "References" or "Bibliography" heading — optionally skip or summarize.

**Fallback**: If pdf.js extraction fails (scanned PDF), show an error suggesting the user try a different PDF viewer or OCR tool. We won't bundle Tesseract — too heavy.

---

## 3. Project Structure

```
kokoro-pdf-reader/
├── README.md
├── LICENSE
│
├── server/                          # Local TTS server setup
│   ├── docker-compose.yml           # One-command Kokoro-FastAPI launch
│   ├── start-server.sh              # Helper script (Docker or native)
│   ├── stop-server.sh               # Stop helper
│   ├── install-native.sh            # Non-Docker setup with uv
│   └── com.kokoro-pdf.tts.plist     # macOS LaunchAgent for auto-start
│
├── extension/                       # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── icons/
│   │   ├── icon16.png
│   │   ├── icon48.png
│   │   └── icon128.png
│   │
│   ├── background/
│   │   └── service-worker.js        # TTS queue, state machine, API calls
│   │
│   ├── content/
│   │   ├── content-script.js        # Main content script (injected into PDF pages)
│   │   ├── pdf-extractor.js         # PDF text extraction with column detection
│   │   ├── text-cleaner.js          # Header/footer/equation cleaning
│   │   ├── sentence-splitter.js     # Smart sentence splitting for TTS chunks
│   │   ├── highlighter.js           # Sentence highlighting on the PDF
│   │   ├── overlay-player.js        # Floating player UI (play/pause/speed/voice)
│   │   └── overlay-player.css       # Player styling
│   │
│   ├── popup/
│   │   ├── popup.html               # Extension popup UI
│   │   ├── popup.js                 # Popup logic
│   │   └── popup.css                # Popup styling
│   │
│   ├── lib/
│   │   ├── pdf.min.js               # pdf.js library (bundled)
│   │   └── pdf.worker.min.js        # pdf.js web worker
│   │
│   ├── utils/
│   │   ├── tts-client.js            # Kokoro API client (fetch wrapper)
│   │   ├── audio-player.js          # Web Audio API playback manager
│   │   ├── storage.js               # chrome.storage helpers (position, settings)
│   │   └── constants.js             # Config constants (server URL, defaults)
│   │
│   └── options/
│       ├── options.html             # Settings page
│       ├── options.js               # Settings logic
│       └── options.css              # Settings styling
│
└── docs/
    ├── SETUP.md                     # Full setup instructions
    └── TROUBLESHOOTING.md           # Common issues & fixes
```

---

## 4. Epic & Sprint Breakdown

### Epic 1: Local TTS Server Setup (Sprint 1)

**Goal**: Get Kokoro-FastAPI running reliably on Mac with one command, and auto-start on boot.

#### Story 1.1: Docker-based server setup
- **Tasks**:
  - Create `docker-compose.yml` with the CPU image (`ghcr.io/remsky/kokoro-fastapi-cpu:latest`), port 8880, volume mounts for model cache
  - Create `start-server.sh` that checks if Docker is installed, starts the container
  - Create `stop-server.sh`
  - Test on Apple Silicon (M-series) — confirm arm64 image works
- **Acceptance criteria**: Running `./start-server.sh` brings up Kokoro-FastAPI. `curl http://localhost:8880/v1/audio/voices` returns voice list. `curl -X POST http://localhost:8880/v1/audio/speech -d '{"model":"kokoro","input":"Hello world","voice":"af_bella"}' --output test.mp3` produces valid audio.
- **Estimate**: 2-3 hours

#### Story 1.2: Native (non-Docker) alternative setup
- **Tasks**:
  - Create `install-native.sh` that installs uv, clones Kokoro-FastAPI, runs `start-cpu.sh`
  - Document `brew install espeak` dependency
  - Test that native mode also works on M-series
- **Acceptance criteria**: Same curl tests pass without Docker
- **Estimate**: 2-3 hours

#### Story 1.3: macOS LaunchAgent for auto-start
- **Tasks**:
  - Create `com.kokoro-pdf.tts.plist` LaunchAgent that starts the Docker container (or native server) on login
  - Create install/uninstall scripts for the LaunchAgent
  - Ensure it handles graceful restarts
- **Acceptance criteria**: After `launchctl load`, the server starts automatically on Mac login. `launchctl list | grep kokoro` shows it running.
- **Estimate**: 1-2 hours

#### Story 1.4: Health check and server verification
- **Tasks**:
  - Add a health-check endpoint test to `start-server.sh` (poll until ready)
  - Measure and document: time from cold start to first audio generation (expect ~30-60s for first run due to model loading, ~5s for subsequent starts)
  - Document expected performance: generation speed on M1/M2/M3
- **Acceptance criteria**: Script waits for server to be healthy before exiting. Performance baselines documented.
- **Estimate**: 1 hour

**Sprint 1 total: ~1-2 days**

---

### Epic 2: Chrome Extension Scaffold & Basic Playback (Sprint 2)

**Goal**: Minimal extension that can extract text from a PDF in Chrome and play it through Kokoro.

#### Story 2.1: Extension manifest and scaffold
- **Tasks**:
  - Create `manifest.json` (Manifest V3) with permissions: `activeTab`, `scripting`, `storage`, `tabs`
  - Host permissions: `http://localhost:8880/*`, `http://127.0.0.1:8880/*`
  - Content script matching: `*://*/*.pdf`, `file:///*.pdf`, `chrome-extension://*/pdf*`
  - Create basic popup (HTML/CSS/JS) with a single "Play" button
  - Create service worker skeleton
  - Create content script skeleton
  - Set up icons
- **Acceptance criteria**: Extension loads in Chrome via `chrome://extensions` (developer mode). Popup opens. No errors in console.
- **Estimate**: 2-3 hours

#### Story 2.2: PDF text extraction with pdf.js
- **Tasks**:
  - Bundle pdf.js (latest stable) into the extension's `lib/` folder
  - In content script: detect if current page is a PDF (check URL, content type, or DOM structure)
  - If Chrome's built-in PDF viewer is active: get the PDF URL, fetch the raw PDF bytes, feed them to pdf.js
  - Extract all text items with positions: `page.getTextContent()` returns items with `{str, dir, transform, width, height, fontName}`
  - Build a data structure: `Array<{pageNum, items: Array<{text, x, y, width, height, fontName}>}>`
  - Log extracted text to console for debugging
- **Gotcha**: Chrome's built-in PDF viewer uses `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/` which makes content script injection tricky. **Solution**: Match on `*://*/*.pdf` and also inject via `chrome.scripting.executeScript` from the service worker when a PDF tab is detected. Alternatively, we can use the `offscreen` API or fetch the PDF URL directly.
- **Acceptance criteria**: Open any academic PDF in Chrome. The extension extracts text and logs it. Verify on at least 3 different PDFs (single-column, two-column, and a scanned one — expect scanned to fail gracefully).
- **Estimate**: 4-6 hours

#### Story 2.3: Basic text-to-speech pipeline
- **Tasks**:
  - Create `tts-client.js`: wrapper around `fetch('http://localhost:8880/v1/audio/speech', ...)` that sends text and receives audio (mp3 blob)
  - Create `audio-player.js`: takes an audio blob, creates an `Audio` element or AudioContext, plays it
  - Wire it up: popup "Play" button → message to content script → extract first paragraph → send to TTS → play audio
  - Handle server-not-running case: show clear error in popup ("Kokoro server not found. Start it with ./start-server.sh")
- **Acceptance criteria**: Click play → hear the first paragraph of the PDF read aloud. If server is down, see a friendly error.
- **Estimate**: 3-4 hours

#### Story 2.4: Sequential playback with chunking
- **Tasks**:
  - Create `sentence-splitter.js`: split extracted text into sentences using regex + heuristics (split on `. `, `? `, `! ` but not on `Dr.`, `Fig.`, `et al.`, etc.)
  - Group sentences into chunks of ~200-400 characters (sweet spot for Kokoro latency vs quality)
  - Implement a playback queue in the service worker: pre-fetch the next chunk while the current one plays (double-buffering)
  - Play chunks sequentially without gaps
- **Acceptance criteria**: Click play → entire PDF plays through sequentially. Audio transitions between chunks are smooth (no noticeable gaps > 200ms).
- **Estimate**: 4-6 hours

**Sprint 2 total: ~2-3 days**

---

### Epic 3: Smart PDF Processing (Sprint 3)

**Goal**: Handle multi-column layouts, strip headers/footers, handle equations.

#### Story 3.1: Multi-column layout detection
- **Tasks**:
  - Analyze x-coordinates of text items on each page
  - Detect columns: compute a histogram of x-positions. If there's a clear gap (> 10% of page width) in the middle, it's two-column
  - For two-column pages: partition items into left and right sets based on x-position threshold
  - Sort each column top-to-bottom
  - Handle edge cases: full-width title/abstract at top of first page transitioning to two-column body
  - Handle spanning figures/tables (items whose width crosses the column boundary)
- **Acceptance criteria**: Test on 5 two-column academic PDFs (IEEE, ACM, Nature formats). Text reads in correct order (left column then right column). Full-width elements (title, abstract) read at the correct position.
- **Estimate**: 6-8 hours

#### Story 3.2: Header/footer/page number stripping
- **Tasks**:
  - For each page, identify text items in the top margin zone (top ~8%) and bottom margin zone (bottom ~8%)
  - Compare margin text across pages — if text repeats (journal name, page numbers, running headers), mark as header/footer
  - Strip page numbers (detect patterns: bare numbers, "Page N", "N of M")
  - Strip conference/journal running headers
  - Keep footnotes (they're usually in the body area, not the extreme bottom)
- **Acceptance criteria**: Headers, footers, and page numbers don't get read aloud. Footnotes still work.
- **Estimate**: 3-4 hours

#### Story 3.3: Equation and special content handling
- **Tasks**:
  - Detect math content by font name: fonts containing "Math", "Symbol", "CM" (Computer Modern), "CMSY", "CMMI", "CMEX" are math fonts
  - Detect inline equations: short sequences of math-font characters surrounded by regular text → replace with "[equation]"
  - Detect display equations: blocks of math-font-only text on their own lines → replace with "equation" or skip
  - Detect LaTeX remnants: sequences like `\alpha`, `\sum`, `_{`, `^{` → replace with "[equation]"
  - Handle citations: `[1]`, `[1,2,3]`, `(Author, 2024)` → read as-is (they're short enough)
  - Handle URLs: long URLs → say "link" instead of reading the full URL
- **Acceptance criteria**: Math-heavy PDFs (e.g., ML papers from arXiv) don't produce garbage speech. Equations are replaced with brief spoken notes.
- **Estimate**: 4-5 hours

#### Story 3.4: Section detection and smart navigation
- **Tasks**:
  - Detect section headings by font size (larger than body text) and font weight (bold)
  - Build a section map: `[{title: "Introduction", sentenceIndex: 0}, {title: "Methods", sentenceIndex: 42}, ...]`
  - Store section map for UI navigation (jump to section)
  - Detect "References" or "Bibliography" section — mark it (optionally skip during playback)
  - Detect "Abstract" section — make it available as a quick-read option
- **Acceptance criteria**: Section boundaries are correctly identified. User can see section list.
- **Estimate**: 3-4 hours

**Sprint 3 total: ~3-4 days**

---

### Epic 4: Player UI & Controls (Sprint 4)

**Goal**: Polished floating player overlay with all controls, plus sentence highlighting.

#### Story 4.1: Floating player overlay
- **Tasks**:
  - Create a floating player UI injected by the content script onto the PDF page
  - Position: bottom-right corner, draggable, collapsible
  - Controls: play/pause button, stop button, skip forward/back (sentence), progress indicator (current position / total sentences)
  - Minimize state: just a small play button when collapsed
  - Style: dark semi-transparent background, clean modern look, doesn't obscure PDF content
  - Z-index: above PDF viewer but below Chrome UI
- **Acceptance criteria**: Player appears on PDF pages. All buttons are clickable. Player can be dragged. Minimizes to small button.
- **Estimate**: 4-5 hours

#### Story 4.2: Speed control
- **Tasks**:
  - Add speed slider/dropdown to overlay: 0.75x, 1.0x, 1.25x, 1.5x, 1.75x, 2.0x
  - Pass `speed` parameter to Kokoro API on each chunk request
  - Persist speed preference in `chrome.storage.local`
  - Speed change takes effect on the next chunk (don't re-generate current chunk)
- **Acceptance criteria**: Changing speed audibly changes playback rate. Preference persists across sessions.
- **Estimate**: 1-2 hours

#### Story 4.3: Voice selection
- **Tasks**:
  - On extension load, fetch voice list from `GET /v1/audio/voices`
  - Populate a dropdown in the player overlay and popup
  - Group voices by language/gender if possible (parse voice ID naming: `af_` = American Female, `am_` = American Male, `bf_` = British Female, etc.)
  - Pass selected voice to each TTS request
  - Persist voice preference in `chrome.storage.local`
  - Handle case where selected voice is no longer available (fallback to `af_bella`)
- **Acceptance criteria**: User can switch between voices. Voice names are human-readable. Selection persists.
- **Estimate**: 2-3 hours

#### Story 4.4: Sentence highlighting
- **Tasks**:
  - Map each sentence back to its source text items (with x,y positions on the page)
  - Create highlight overlays on the PDF page that match the position of the current sentence being read
  - Scroll the PDF to keep the highlighted sentence visible
  - Clear highlight when sentence finishes, highlight next sentence
  - Handle cross-page sentences (sentence spans page break)
- **Gotcha**: Chrome's built-in PDF viewer renders PDFs in a shadow DOM or embedded frame, making direct DOM overlay difficult. **Solution**: Use the pdf.js rendering canvas coordinates. If using Chrome's viewer, we may need to calculate positions relative to the viewer's scroll container.
- **Acceptance criteria**: Current sentence is visually highlighted. PDF auto-scrolls to follow playback. Highlighting is accurate to within ~1 line.
- **Estimate**: 6-8 hours (this is one of the hardest parts)

#### Story 4.5: Section navigation in player
- **Tasks**:
  - Add a section list dropdown/panel to the player overlay
  - Clicking a section jumps playback to that section
  - Show current section name in the player
  - Add previous/next section buttons
- **Acceptance criteria**: User can jump between sections. Current section displays correctly.
- **Estimate**: 2-3 hours

**Sprint 4 total: ~3-4 days**

---

### Epic 5: Persistence & State Management (Sprint 5)

**Goal**: Remember playback position, handle edge cases, robust state management.

#### Story 5.1: Playback position persistence
- **Tasks**:
  - Save current position (sentence index, page number) to `chrome.storage.local` keyed by PDF URL (or a hash of the first page content for `file://` URLs)
  - On PDF open, check for saved position
  - Show "Resume from [Section Name], page N?" prompt if position exists
  - Auto-save position every 5 seconds during playback and on pause/close
  - Implement position expiry (e.g., clear positions older than 30 days)
- **Acceptance criteria**: Close a PDF mid-read, reopen it, resume from where you left off.
- **Estimate**: 3-4 hours

#### Story 5.2: Robust server connection handling
- **Tasks**:
  - On extension load, check server health (`GET http://localhost:8880/v1/models`)
  - Show server status indicator in popup and overlay (green dot = connected, red = disconnected)
  - If server goes down mid-playback: pause, show error, auto-retry every 5 seconds
  - When server comes back, offer to resume
  - "How to start the server" help text with platform-specific instructions
- **Acceptance criteria**: Extension gracefully handles server being down. Clear user messaging. Auto-reconnects.
- **Estimate**: 2-3 hours

#### Story 5.3: Playback state machine
- **Tasks**:
  - Implement proper state machine in service worker: `idle → loading → playing → paused → stopped`
  - Handle all state transitions cleanly
  - Handle tab close during playback (clean up resources)
  - Handle multiple PDF tabs (only one playback at a time)
  - Handle extension popup open/close without interrupting playback
  - Handle service worker sleep/wake (Manifest V3 service workers can be killed after ~30s of inactivity — use `chrome.alarms` or keepalive patterns for active playback)
- **Gotcha**: Service worker termination is the biggest Manifest V3 challenge for long-running audio. **Solution**: Keep audio playback in the content script (not the service worker). Service worker only manages the queue and makes API calls. Content script plays audio and sends heartbeat messages to keep the service worker alive during playback.
- **Acceptance criteria**: Playback survives popup close, tab switch, and service worker restart.
- **Estimate**: 4-5 hours

#### Story 5.4: Settings/options page
- **Tasks**:
  - Create options page with: server URL (default: `http://localhost:8880`), default voice, default speed, auto-resume toggle, reading preferences (skip references, skip equations, etc.)
  - Sync settings via `chrome.storage.sync` (syncs across Chrome instances)
  - Apply settings to all future playback sessions
- **Acceptance criteria**: Settings page works. Changes apply immediately to playback behavior.
- **Estimate**: 2-3 hours

**Sprint 5 total: ~2-3 days**

---

### Epic 6: Streaming & Performance Optimization (Sprint 6)

**Goal**: Minimize latency. Pre-buffer audio. Smooth playback.

#### Story 6.1: Streaming audio from Kokoro
- **Tasks**:
  - Switch from "fetch entire audio blob then play" to streaming: use `fetch()` with `ReadableStream` and pipe chunks to an AudioContext
  - Kokoro-FastAPI supports streaming: POST with `stream: true`, response is chunked audio
  - Use PCM format for streaming (lowest overhead) — `response_format: "pcm"` returns raw 24kHz 16-bit PCM
  - Feed PCM chunks into Web Audio API's `AudioBufferSourceNode` or use `MediaSource` API
  - Handle buffer underruns gracefully (brief silence rather than glitch)
- **Acceptance criteria**: Time from pressing play to first audio < 1 second (on warm server). No audible gaps between streamed chunks.
- **Estimate**: 6-8 hours

#### Story 6.2: Pre-buffering pipeline
- **Tasks**:
  - While chunk N plays, start generating chunk N+1 (and optionally N+2)
  - Maintain a buffer of 2-3 upcoming audio chunks
  - Cancel pre-buffered chunks if user skips forward/backward
  - Monitor buffer health — if buffer runs dry, show a brief loading indicator
- **Acceptance criteria**: Transitions between sentences are seamless. No perceptible gaps during normal playback.
- **Estimate**: 3-4 hours

#### Story 6.3: Adaptive chunking
- **Tasks**:
  - Monitor actual generation time vs playback time
  - If server is slow (generation time > 50% of playback time), increase chunk size to reduce overhead
  - If server is fast, use smaller chunks for better sentence-level sync
  - Log performance metrics to console for debugging
- **Acceptance criteria**: Playback adapts gracefully to varying server performance.
- **Estimate**: 2-3 hours

**Sprint 6 total: ~2-3 days**

---

### Epic 7: Polish & Edge Cases (Sprint 7)

**Goal**: Handle remaining edge cases, improve UX, prepare for daily use.

#### Story 7.1: Keyboard shortcuts
- **Tasks**:
  - Space: play/pause (when extension is focused)
  - Left/Right arrows: skip sentence back/forward
  - Up/Down arrows: adjust speed
  - Escape: stop playback
  - Register shortcuts via `chrome.commands` API
- **Acceptance criteria**: All shortcuts work on PDF pages.
- **Estimate**: 2-3 hours

#### Story 7.2: Handle scanned/image-based PDFs
- **Tasks**:
  - Detect when pdf.js extraction returns very little text (< 100 chars per page)
  - Show informative message: "This PDF appears to be scanned/image-based. Text extraction is limited. For best results, use a PDF with selectable text."
  - Suggest alternatives (e.g., use an OCR tool first)
- **Acceptance criteria**: Scanned PDFs show helpful error instead of reading garbage.
- **Estimate**: 1-2 hours

#### Story 7.3: Handle special PDF types
- **Tasks**:
  - Password-protected PDFs: detect and show error
  - PDFs with unusual encodings: handle gracefully
  - Very long PDFs (100+ pages): test performance, add page range selection
  - PDFs opened from local files (`file://` URLs): ensure extension has permission
- **Acceptance criteria**: No crashes or hangs on edge-case PDFs.
- **Estimate**: 2-3 hours

#### Story 7.4: Extension popup improvements
- **Tasks**:
  - Show current PDF title and reading progress
  - Show estimated remaining time (based on average reading speed)
  - "Read Abstract Only" quick action
  - "Skip to Section" dropdown
  - Mini player controls in popup (mirrors overlay)
- **Acceptance criteria**: Popup is informative and functional. All actions work.
- **Estimate**: 3-4 hours

#### Story 7.5: Testing & documentation
- **Tasks**:
  - Test on 10+ diverse academic PDFs (IEEE, ACM, Nature, arXiv, Springer, single-column, two-column, three-column)
  - Document all setup steps in SETUP.md
  - Create TROUBLESHOOTING.md for common issues
  - Create a short demo video/GIF
  - Write clear README.md
- **Acceptance criteria**: Extension works reliably on common academic PDF formats. Documentation is complete.
- **Estimate**: 3-4 hours

**Sprint 7 total: ~2-3 days**

---

## 5. Known Gotchas & Risk Mitigations

### PDF Text Extraction (HIGH RISK)

| Issue | Impact | Mitigation |
|-------|--------|------------|
| Chrome's PDF viewer uses an embedded plugin/frame that blocks content scripts | Can't extract text | Fetch the PDF URL directly with `fetch()` from the content script, feed raw bytes to bundled pdf.js. Don't rely on the viewer DOM. |
| Multi-column detection fails on 3-column layouts | Garbled reading order | Support configurable column count; detect by analyzing x-position histogram with configurable gap threshold |
| pdf.js text extraction returns text in non-reading order | Wrong sentence flow | Sort text items by y-position (descending) then x-position (ascending) within each column zone |
| Ligatures and special characters cause extraction artifacts | Garbage text | Post-process: normalize Unicode, fix common ligature splits (fi, fl, ff, etc.) |
| Some PDFs have text as outlines/paths (not extractable) | No text to read | Detect and show clear error message |

### Chrome Extension / Manifest V3 (MEDIUM RISK)

| Issue | Impact | Mitigation |
|-------|--------|------------|
| Service worker can be killed after ~30s of inactivity | Playback stops | Keep audio playback in content script. Service worker only does API calls. Use `chrome.alarms` as keepalive during active playback. |
| Content scripts can't be injected into `chrome-extension://` URLs (PDF viewer) | Can't inject into Chrome's PDF viewer | Use `chrome.scripting.executeScript` with `activeTab` permission. Alternative: detect PDF and open in our own viewer (using pdf.js). |
| `host_permissions` for `localhost` may show scary permission warning | Users confused | Document in README that this is for local-only communication. |
| CORS for `localhost` requests from extension | Requests blocked | Kokoro-FastAPI has CORS enabled by default. If issues arise, the service worker can proxy requests (service workers aren't subject to CORS). |

### Kokoro-FastAPI (LOW RISK)

| Issue | Impact | Mitigation |
|-------|--------|------------|
| First request after cold start is slow (~5-10s model loading) | Delay on first play | Show loading indicator. Pre-warm server on extension install. Send a dummy request on extension startup. |
| Docker image is ~2-5GB | Large download | Document this clearly. Offer native (non-Docker) alternative. |
| Model produces rushed speech on long text chunks | Audio quality | Pre-chunk text to 200-400 characters (well under the 510-token limit). |
| `espeak` dependency on Mac | Setup friction | `brew install espeak` — document clearly. Native install script handles this. |
| Audio artifacts at chunk boundaries | Audible glitches | Add tiny silence padding between chunks. Use sentence boundaries for natural pauses. |

### Highlighting / UI (MEDIUM RISK)

| Issue | Impact | Mitigation |
|-------|--------|------------|
| Chrome's PDF viewer renders in a way that's hard to overlay | Can't highlight | Option A: Overlay a transparent canvas on top of the viewer. Option B: Open PDFs in our own pdf.js-based viewer (adds complexity but gives full control). Start with Option A, fall back to B if needed. |
| Sentence-to-position mapping is imprecise | Highlight wrong area | Use fuzzy matching: find the best-matching text range in the pdf.js text items for each sentence. Accept ~1 line accuracy. |

---

## 6. Complexity Estimates

### Overall Project Estimate

| Epic | Days | Difficulty |
|------|------|------------|
| 1. Server Setup | 1-2 | Easy |
| 2. Extension Scaffold & Basic Playback | 2-3 | Medium |
| 3. Smart PDF Processing | 3-4 | Hard |
| 4. Player UI & Controls | 3-4 | Medium-Hard |
| 5. Persistence & State Management | 2-3 | Medium |
| 6. Streaming & Performance | 2-3 | Hard |
| 7. Polish & Edge Cases | 2-3 | Medium |
| **Total** | **~15-22 days** | |

### Recommended Build Order

**Phase 1 — Proof of Concept (Epics 1 + 2)**: ~3-5 days
Get the server running and a minimal extension that can extract text from a PDF and play it through Kokoro. This validates the entire architecture.

**Phase 2 — Core Functionality (Epics 3 + 4)**: ~6-8 days
Make it actually useful for academic papers: handle columns, clean text, build the player UI, add highlighting.

**Phase 3 — Production Ready (Epics 5 + 6 + 7)**: ~6-9 days
Make it reliable: persistence, streaming, edge cases, polish.

### What to Build First

1. `docker-compose.yml` + `start-server.sh` (validate Kokoro works on your Mac)
2. `manifest.json` + basic content script (validate extension loads)
3. PDF text extraction with pdf.js (validate you can get text out)
4. End-to-end: extract → send to Kokoro → play audio (validate the full pipeline)
5. Everything else builds on top of this working foundation.

---

## Appendix A: Kokoro-FastAPI API Reference (Quick Reference)

### List Voices
```
GET http://localhost:8880/v1/audio/voices
→ {"voices": ["af_bella", "af_sky", "am_adam", "am_echo", "bf_emma", "bm_george", ...]}
```

### Generate Speech
```
POST http://localhost:8880/v1/audio/speech
Content-Type: application/json

{
  "model": "kokoro",
  "input": "Text to speak",
  "voice": "af_bella",
  "response_format": "mp3",   // mp3, wav, opus, flac, pcm
  "speed": 1.0,               // 0.5 to 2.0
  "stream": false              // true for chunked streaming
}

→ Binary audio data (Content-Type depends on format)
```

### Generate Speech (Streaming)
```
POST http://localhost:8880/v1/audio/speech
Content-Type: application/json

{
  "model": "kokoro",
  "input": "Long text to speak with streaming...",
  "voice": "af_bella",
  "response_format": "pcm",
  "speed": 1.0,
  "stream": true
}

→ Chunked transfer encoding, PCM audio data (24kHz, 16-bit, mono)
```

### Voice Naming Convention
| Prefix | Meaning |
|--------|---------|
| `af_` | American Female |
| `am_` | American Male |
| `bf_` | British Female |
| `bm_` | British Male |
| `jf_` | Japanese Female |
| `jm_` | Japanese Male |

Voice combination: `"af_bella+af_sky"` blends two voices. Weighted: `"af_bella(2)+af_sky(1)"` = 67% bella, 33% sky.

---

## Appendix B: macOS LaunchAgent Template

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.kokoro-pdf.tts</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/docker</string>
        <string>run</string>
        <string>--rm</string>
        <string>-p</string>
        <string>8880:8880</string>
        <string>ghcr.io/remsky/kokoro-fastapi-cpu:latest</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/kokoro-tts.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/kokoro-tts.err</string>
</dict>
</plist>
```

Install: `cp com.kokoro-pdf.tts.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.kokoro-pdf.tts.plist`

---

## Appendix C: Manifest V3 — Key Decisions

### PDF Access Strategy

Chrome's built-in PDF viewer (`chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/`) is a special extension that renders PDFs. Content scripts can't easily inject into it. Our strategy:

1. **Detect PDF tabs** in the service worker by checking the URL (ends in `.pdf` or has `Content-Type: application/pdf`)
2. **Inject content script** via `chrome.scripting.executeScript` with `activeTab` permission
3. **Fetch the PDF bytes** using `fetch(tabUrl)` from the content script (same-origin for the tab URL)
4. **Process with bundled pdf.js** in the content script context
5. **Overlay UI** on top of Chrome's PDF viewer using high z-index positioned elements

If Chrome's viewer proves too restrictive, fallback plan: open PDFs in a custom viewer page (`chrome-extension://[our-id]/viewer.html?url=...`) using our own pdf.js rendering. This gives full control but changes the user's viewing experience.

### Service Worker Keepalive

During active playback, the content script sends a `chrome.runtime.sendMessage({type: "heartbeat"})` every 20 seconds to prevent the service worker from being terminated. The service worker also uses `chrome.alarms.create("keepalive", {periodInMinutes: 0.4})` as a backup.

---

*This plan will be refined as we build. Each epic will get a detailed implementation plan before development begins.*