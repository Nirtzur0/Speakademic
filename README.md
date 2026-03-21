# Kokoro PDF Reader

A Chrome extension that reads academic PDFs aloud using a locally self-hosted Kokoro TTS model. Fully local, zero cloud dependencies, privacy-first.

## Features

- **PDF text extraction** with multi-column layout detection (IEEE, ACM, Nature formats)
- **Smart text processing**: strips headers/footers, handles equations, detects sections
- **Floating player overlay** on PDF pages with full playback controls
- **Keyboard shortcuts**: Space (play/pause), arrows (skip/speed), Escape (stop)
- **Voice selection** with multiple voices grouped by language/gender
- **Speed control** from 0.75x to 2.0x
- **Section navigation** — jump to any detected section
- **Position persistence** — resume from where you left off
- **Adaptive chunking** — adjusts to server performance automatically
- **Pre-buffering** — 3 chunks ahead for seamless playback

## Requirements

- macOS with Apple Silicon (M1/M2/M3/M4) or Intel
- Docker Desktop (recommended) or Python 3.10+
- Google Chrome

## Quick Start

### 1. Start the TTS server

```bash
cd server
./start-server.sh
```

This pulls the Kokoro-FastAPI Docker image and starts it on port 8880. First run downloads the model (~200MB).

### 2. Load the extension

1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select the `extension/` folder
4. For local PDFs: click the extension details and enable "Allow access to file URLs"

### 3. Read a PDF

1. Open any PDF in Chrome
2. Click the Kokoro extension icon or press `Alt+Shift+P`
3. Click Play

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play / Pause |
| Right Arrow | Skip forward one chunk |
| Left Arrow | Skip back one chunk |
| Up Arrow | Increase speed |
| Down Arrow | Decrease speed |
| Escape | Stop playback |
| Alt+Shift+P | Toggle play/pause (global) |
| Alt+Shift+S | Stop (global) |

## Architecture

```
Chrome Browser
  Extension Popup ←→ Service Worker ←→ Content Script
                         ↓                    ↓
                    Kokoro API          Audio Playback
                  (localhost:8880)      (Web Audio API)
```

- **Service Worker**: state machine, TTS API calls, text extraction (pdf.js), chunk queue
- **Content Script**: audio playback via `<Audio>`, keyboard shortcuts
- **Overlay Player**: floating UI injected on PDF pages
- **Popup**: quick controls and status

## Project Structure

```
server/                     Local TTS server setup
  docker-compose.yml        One-command Kokoro-FastAPI launch
  start-server.sh           Start with health check polling
  stop-server.sh            Stop the server
  install-native.sh         Non-Docker alternative

extension/                  Chrome extension (Manifest V3)
  manifest.json
  background/               Service worker (ES module)
  content/                  Content scripts (IIFE)
    overlay-player.js/css   Floating player UI
    pdf-extractor.js        PDF text extraction pipeline
    column-detector.js      Multi-column layout detection
    text-cleaner.js         Header/footer/equation handling
    section-detector.js     Section heading detection
    sentence-splitter.js    Smart sentence splitting
  popup/                    Extension popup
  options/                  Settings page
  utils/                    Shared utilities
  lib/                      Vendored pdf.js
```

## Settings

Right-click the extension icon → Options, or go to `chrome://extensions` → Kokoro PDF Reader → Details → Extension options.

- **Server URL**: default `http://localhost:8880`
- **Default voice and speed**
- **Auto-resume**: resume from last position when reopening a PDF
- **Skip References**: stop reading before the References section

## License

MIT
