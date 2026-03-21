# Setup Guide

## Prerequisites

- macOS (Apple Silicon or Intel)
- Docker Desktop ([download](https://www.docker.com/products/docker-desktop/))
- Google Chrome

## TTS Server Setup

### Option A: Docker (recommended)

```bash
cd server
./start-server.sh
```

This will:
1. Check Docker is installed and running
2. Pull `ghcr.io/remsky/kokoro-fastapi-cpu:latest` (first run only)
3. Start the container on port 8880
4. Poll until the server is healthy

**Verify**: `curl http://localhost:8880/v1/audio/voices`

To stop: `./stop-server.sh`

### Option B: Native (no Docker)

```bash
cd server
./install-native.sh
```

This installs `espeak-ng` via Homebrew, `uv` for Python, clones Kokoro-FastAPI, and starts it natively.

**Requires**: Homebrew, git

### Auto-start on login

```bash
cd server
./install-launchagent.sh
```

To remove: `./uninstall-launchagent.sh`

## Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder from this project
5. The Kokoro PDF Reader icon appears in the toolbar

### File URL access

To read local PDF files (`file://` URLs):

1. Go to `chrome://extensions`
2. Click **Details** on Kokoro PDF Reader
3. Enable **Allow access to file URLs**

## Verify Everything Works

1. Ensure the TTS server is running
2. Open any PDF in Chrome (try: https://arxiv.org/pdf/2301.00001)
3. Click the extension icon
4. The floating player appears on the page
5. Click Play in the floating player
6. You should hear the PDF read aloud

## Performance Notes

- **First run**: model download takes 1-2 minutes
- **Cold start**: server takes 30-60 seconds to load the model
- **Warm server**: first audio plays within 1-2 seconds
- **Generation speed**: ~5x real-time on Apple Silicon CPU
- **Memory**: server uses ~500MB, extension <50MB during playback
